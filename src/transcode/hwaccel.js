/*
 * File: hwaccel.js
 * Created: 2026-09-20
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * S-4 硬件加速分层与缩放参数（运行时编排与 Facade 门面）
 *
 * 设计依据：
 *   docs/S-4-HWACCEL-PLAN-v2-20260920.md   （硬件加速分层方案）
 *   docs/S-4-SCALE-PARAMS-20260920.md      （缩放参数方案，含实测）
 *
 * 模块架构：
 *   - hwaccel_quality.js : 纯计算质量标定表与 codec 族解析
 *   - hwaccel_scale.js   : 纯计算尺寸、滤镜串生成与位深对齐判定
 *   - hwaccel_args.js    : 编码器参数与探测命令行生成
 *   - hwaccel.js         : 运行时探测执行、缓存、分层选择决策主入口，并向后兼容 re-export 子模块符号
 */

import { execa } from "execa"
import which from "which"
import * as log from "../../lib/debug.js"
import { candidateTiers, primaryVendor, SWDEC_ENCODERS_BY_VENDOR } from "./hwdetect.js"
import { nvdecSupportOf } from "./gpu.js"
import { calcLongEdge } from "./hwaccel_scale.js"
import { buildProbeArgs } from "./hwaccel_args.js"

// ---------------------------------------------------------------------------
// 向后兼容 Re-exports（保持对现有调用方和单测 100% 兼容）
// ---------------------------------------------------------------------------

export {
    VMAF_QUALITY_OFFSET,
    calculateOffset,
    codecFamilyOf,
    codecFamilyOfPreset,
    encoderCalibImpl,
    normalizeQualityForEncoder,
} from "./hwaccel_quality.js"

export {
    SPEED_MIN,
    SPEED_MAX,
    toEven,
    calcLongEdge,
    validateSpeed,
    buildScaleFilter,
    scaleFormatOverride,
    needsDepthAlign,
    buildVideoFilters,
    buildAudioFilters,
} from "./hwaccel_scale.js"

export {
    ENCODER_MATRIX,
    ENCODER_RUNTIME_FALLBACK,
    pickRuntimeEncoder,
    buildHwaccelArgs,
    buildEncoderArgs,
    buildLayerArgs,
    buildProbeArgs,
} from "./hwaccel_args.js"

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 支持的解码模式 */
export const DecodeMode = {
    AUTO: "auto", // 按层级链逐层探测降级（默认）
    GPU: "gpu", // 只用显式指定的层，失败即硬失败
    CPU: "cpu", // 直接走 Tier 4，不探测
}

/**
 * 层级定义（按优先级）
 *
 * 每层包含：
 *   name       层标识
 *   hwaccel    -hwaccel 参数（null 表示纯 CPU）
 *   hwFormat   -hwaccel_output_format 参数（null 表示不指定）
 *   filter     滤镜名（{W} {H} 为预计算的偶数尺寸占位）
 *   filterArgs 滤镜附加参数
 *   vendor     归属厂商（用于 Tier1 三选一判定）
 */
export const TIERS = [
    {
        name: "cuda",
        vendor: "nvidia",
        hwaccel: "cuda",
        hwFormat: "cuda",
        filter: "scale_cuda",
        filterArgs: "interp_algo=lanczos,format=cuda",
        requiresFilter: true,
    },
    {
        name: "qsv",
        vendor: "intel",
        hwaccel: "qsv",
        hwFormat: "qsv",
        filter: "scale_qsv",
        // ⚠️ scale_qsv 不支持 force_original_aspect_ratio / h=-2，
        //    且不能混 CPU scale=，必须配 -hwaccel_output_format qsv
        filterArgs: "mode=hq",
        requiresFilter: true,
    },
    {
        name: "amf",
        vendor: "amd",
        hwaccel: "d3d11va", // AMF 无独立解码 hwaccel，解码走 d3d11va
        hwFormat: null,
        filter: "vpp_amf",
        // ⚠️ 本机无 A 卡，此路径仅验证到语法解析层，需 A 卡机器复验
        filterArgs: "scale_type=bicubic",
        requiresFilter: true,
    },
    {
        name: "d3d",
        vendor: "any",
        hwaccel: "d3d11va",
        hwFormat: null,
        // ⚠️ d3d 层必须用 CPU scale=，scale_d3d11 实测不可用
        //    （本机 8bit 对照文件同样失败：Could not create the texture 80070057）
        filter: "scale",
        filterArgs: "flags=lanczos",
        requiresFilter: true,
    },
    {
        // CPU 解码 + CPU scale + 硬件编码（T7 新增）
        //
        // ⚠️ 本层**不加 -hwaccel、不设 hwFormat**：帧全程留在系统内存，
        //    末尾由硬件编码器自己上传（1 次 PCIe 拷贝）。这是"硬解不可用"时的最优形态。
        //    实测（docs/ffmpeg/ffmpeg-hwaccel-support-matrix-20260921.md §3）：
        //      本层形态          27.7x（720p→360p, h264_nvenc）
        //      硬解+下载+CPUscale 17.1x（2 次拷贝，比纯软解还慢）
        //      libx264 全软       10.9x
        // 编码器行由 resolveTiers 按主 GPU 厂商注入（encoderRow），
        // 见 hwdetect.js 的 SWDEC_ENCODERS_BY_VENDOR。
        name: "swdec",
        vendor: "any",
        hwaccel: null,
        hwFormat: null,
        filter: "scale",
        filterArgs: "flags=lanczos",
        requiresFilter: true,
    },
    {
        name: "cpu",
        vendor: "any",
        hwaccel: null,
        hwFormat: null,
        filter: "scale",
        filterArgs: "flags=lanczos",
        requiresFilter: true,
    },
]

// ---------------------------------------------------------------------------
// 探测与降级
// ---------------------------------------------------------------------------

/** 探测缓存（进程内） */
const probeCache = new Map()

/**
 * 探测缓存键
 * 按 (层, 源编码, 位深, 像素格式, 尺寸档, 显式编码器) 缓存，不按文件路径
 * 依据：docs/S-4-HWACCEL-PLAN-v2-20260920.md 4.4 节
 *
 * ⚠️ 位深必须进键（曾缺失导致误判，见 docs/CHANGES-20260920.md）：
 *    mediainfo 的 pixelFormat 是 "ColorSpace+ChromaSubsampling"（如 "YUV4:2:0"），
 *    不含位深 —— 8bit 与 10bit 源同键，8bit 文件探测通过后，
 *    10bit 文件直接复用结果 → 误选 cuda/qsv → h264 编码器打不开而失败。
 *    （h264_nvenc / h264_qsv 只支持 8bit；10bit 源必须降级 cpu 用 libx264）
 *
 * ⚠️ 显式编码器必须进键（T4 新增）：forcedEncoder 参与探测命令的编码器参数，
 *    不同编码器（如 hevc_nvenc vs hevc_qsv）对文件/位深的兼容不同，
 *    缺键会导致不同显式编码器复用同一探测结果而误判。
 *
 * ⚠️ speed/framerate 必须进键（T5 新增）：两者都会改变探测命令的滤镜链
 *    （setpts/atempo/fps），speed≠1 或 framerate 非空时滤镜不同，
 *    缺键会让「带滤镜」与「不带滤镜」的探测结果互相复用而误判。
 *
 * ⚠️ quality 进键：质量值直接参与探测命令的码控参数（-cq/-global_quality/-crf），
 *    长驻进程跨批次换 `--video-quality` 时若复用旧键，
 *    探测结论与实际命令不再同构。
 *    bitrate / maxBitrate **有意不进键**：它们是 calculateDstArgs 按**每个文件**的
 *    分辨率缩放后的值，进键会让同批次每个文件都成为独立键、探测缓存彻底失效
 *    （1000 文件 = 1000 次干跑/层）；而码率大小并不改变「该层能否打开这个文件」。
 */
export function probeCacheKey({
    tierName,
    codec,
    pixFmt,
    codecFamily,
    dimension,
    bitDepth,
    forcedEncoder,
    speed,
    framerate,
    anime = false,
    quality,
}) {
    const speedKey = speed && speed !== 1 ? speed : ""
    const fpsKey = framerate && framerate > 0 ? framerate : ""
    const animeKey = anime ? "anime" : ""
    const qualityKey = Number.isFinite(quality) ? quality : ""
    return `${tierName}|${codec}|${codecFamily}|${pixFmt}|${dimension}|${bitDepth || ""}|${forcedEncoder || ""}|${speedKey}|${fpsKey}|${animeKey}|${qualityKey}`
}

/** 清空探测缓存（测试用） */
export function clearProbeCache() {
    probeCache.clear()
}

/**
 * 探测某一层是否可用
 *
 * 设计要点（对应 v2 方案 4.3 节「探测命令与真实命令同构」）：
 *   1. 探测命令 = 真实命令（同一 buildLayerArgs），只改两处：
 *      限制 `-frames:v`（帧数见 `buildProbeArgs` 注释）、输出改为 `-f null -`
 *   2. 判定只看退出码，不解析 stderr
 *      （实测同一失败在不同版本退出码不同：171 / 69 / 127）
 *   3. 必须带超时：ffmpeg 9 的 -hwaccel auto 对无硬解素材会挂死
 *
 * @param {string} [opts.forcedEncoder] 显式指定的编码器（探测命令必须与真实命令同编码器）
 * @returns {Promise<boolean>}
 */
export async function probeLayer({
    ffmpegPath,
    inputPath,
    tier,
    size,
    pixFmt,
    bitDepth,
    codec = "",
    codecFamily = "h264",
    speed,
    framerate,
    hasAudio,
    quality,
    bitrate,
    maxBitrate,
    forcedEncoder,
    encoders,
    anime = false,
    timeoutMs = 15000,
    useCache = true,
    signal = null,
}) {
    if (signal?.aborted) {
        const error = new Error("Operation cancelled")
        error.name = "AbortError"
        throw error
    }
    const key = probeCacheKey({
        tierName: tier.name,
        codec,
        pixFmt,
        codecFamily,
        // 源宽高缺失时 selectTier 传 null（见其注释），这里按 0 记入缓存键：
        // 与「不缩放」的探测命令形状一致，且不会因访问 null 而崩。
        dimension: size?.w ?? 0,
        bitDepth,
        forcedEncoder,
        speed,
        framerate,
        anime,
        quality,
    })
    if (useCache && probeCache.has(key)) {
        return probeCache.get(key)
    }

    const bin = ffmpegPath || (await which("ffmpeg", { nothrow: true }))
    if (!bin) {
        if (useCache) probeCache.set(key, false)
        return false
    }

    const args = buildProbeArgs({
        tier,
        size,
        speed,
        framerate,
        hasAudio,
        quality,
        bitrate,
        maxBitrate,
        codecFamily,
        pixFmt,
        // ⚠️ bitDepth 必须进探测：mediainfo 的 pixelFormat 不含位深，
        //    缺了它「10bit + h264 目标」不会走 scale 的 format=nv12 对齐，
        //    探测按未对齐的滤镜链跑（会失败）→ 结论与真实命令不一致。
        bitDepth,
        inputPath,
        forcedEncoder,
        encoders,
        anime,
    })
    const full = [bin, ...args]

    let ok
    try {
        const res = await execa(full[0], full.slice(1), {
            reject: false,
            timeout: timeoutMs,
            cleanup: true,
            cancelSignal: signal || undefined,
        })
        // 只看退出码；超时由 execa 抛错或返回非 0
        ok = res.exitCode === 0
    } catch (err) {
        if (signal?.aborted || err?.name === "AbortError" || err?.code === "ABORT_ERR") {
            throw err
        }
        // 超时 / 进程异常 → 判定不可用
        log.debug(`probeLayer ${tier.name} failed: ${err.message}`)
        ok = false
    }

    // 探测结果落盘：排查「为什么某层被选/被弃」的关键数据（曾缺失）
    log.fileLog(
        `Probe tier=${tier.name} ${ok ? "OK" : "FAIL"} src=${String(inputPath).split(/[\\/]/).pop()} key=${key}`,
        "FFCMD",
    )

    // ⚠️ 只缓存「探测成功」：失败不缓存。
    // 失败结果若入缓存，会被同键的正常文件复用（键只含 codec/位深/像素格式/尺寸，
    // 不含「文件是否损坏」）——损坏文件首帧不可解 → 四层全 FAIL → 同键正常文件
    // 被连带降级到 cpu（曾发生在 chromium 测试集，见 CHANGES-20260920.md）。
    // 不缓存失败意味着同键正常文件会自己探测、拿到正确的 OK。
    if (useCache && ok) probeCache.set(key, ok)
    return ok
}

/**
 * 解析候选层（双层决策的**第一层**：只依赖硬件能力，不碰文件）
 *
 * @param {object} opts
 * @param {object} opts.caps detectHardwareCapabilities() 的结果
 * @param {string} [opts.decodeMode] DecodeMode 之一
 * @param {string} [opts.hwaccel] 显式指定层（decodeMode=gpu 时必填）
 * @returns {object[]} 层定义数组（按优先级）
 */
export function resolveTiers({ caps, decodeMode = DecodeMode.AUTO, hwaccel }) {
    if (!caps) {
        throw new Error("resolveTiers: caps is required (run detectHardwareCapabilities first)")
    }
    const names = candidateTiers(caps, { decodeMode, hwaccel })
    const vendor = primaryVendor(caps)
    return names.map((n) => {
        const t = TIERS.find((x) => x.name === n)
        if (!t) throw new Error(`resolveTiers: unknown tier '${n}'`)
        // swdec 层：把「CPU 解码 + 硬件编码」的编码器行按主 GPU 厂商解析后挂到层上。
        // 层名保持单一（swdec），避免把厂商维度泄漏到候选链/`--hwaccel` 值域里；
        // 拿不到厂商行时退回层定义（等价于 cpu 层，不会更差）。
        if (n === "swdec") {
            const row = SWDEC_ENCODERS_BY_VENDOR[vendor]
            if (row) return { ...t, encoderRow: row }
        }
        return t
    })
}

/**
 * 基于 GPU 支持矩阵的解码预筛
 *
 * 当 detectHardwareCapabilities 探测到 NVIDIA 主 GPU（caps.gpuProbe）且
 * 矩阵明确标注该 (代次, codec, 色度, 位深) **不支持硬解**（"no"）时，
 * 跳过该层的 ffmpeg 干跑 —— 结论与真实探测等价（必然失败），省一次代价较高的探测。
 *
 * ⚠️ 收紧规则（保证行为安全，见 lib/gpu.js 口径提醒）：
 *   - 只有矩阵为**明确 no** 才拦截；partial / unknown / 无矩阵数据一律放行；
 *   - 只对 cuda / d3d（NVIDIA 专利层或 NVIDIA NVDEC 驱动解码层）生效，
 *     qsv(Intel) / amf(AMD) 等厂商层不适用 NVIDIA 矩阵；
 *   - 只在 auto 降级链生效：strict 模式（需确定性探测结果）与 gpu 模式
 *     （用户显式指定层，失败信息需真实）不预筛。
 *
 * @param {object} caps detectHardwareCapabilities 的结果
 * @param {object} tier TIERS 中的一层
 * @param {string} codec 源编码（如 h264 / hevc，可含 "h264" 等别名）
 * @param {string} pixFmt 源像素格式（如 yuv422p10le）
 * @param {number|string} [bitDepth] 显式位深（mediainfo 的 BitDepth）
 * @param {"auto"|"gpu"} decodeMode
 * @returns {boolean} true = 应跳过该层探测（矩阵明确不支持）
 */
function gpuBlocksDecode(caps, tier, { codec, pixFmt, bitDepth }, decodeMode) {
    const probe = caps?.gpuProbe
    if (!probe) return false
    if (decodeMode !== DecodeMode.AUTO) return false
    if (tier.name !== "cuda" && tier.name !== "d3d") return false
    const verdict = nvdecSupportOf(probe.generation, codec, pixFmt, bitDepth)
    return verdict === "no"
}

/**
 * 主入口：双层决策 —— 硬件检测筛候选 → 文件探测定层
 *
 * 第一层（硬件）：resolveTiers(caps) 给出这台机器上「理论上可用」的层
 * 第二层（文件）：逐层 probeLayer 干跑，选出真正能吃下这个文件的层
 *
 * @param {object} opts
 * @param {object} opts.caps detectHardwareCapabilities() 的结果
 * @returns {Promise<{tier:object, degraded:boolean, tried:string[], reason:string}>}
 */
export async function selectTier({
    caps,
    ffmpegPath,
    inputPath,
    srcW,
    srcH,
    pixFmt,
    bitDepth,
    codec,
    codecFamily = "h264",
    dimension,
    speed,
    framerate,
    hasAudio,
    quality,
    bitrate,
    maxBitrate,
    forcedEncoder,
    decodeMode = DecodeMode.AUTO,
    hwaccel,
    strict = false,
    anime = false,
    signal = null,
}) {
    if (signal?.aborted) {
        const error = new Error("Operation cancelled")
        error.name = "AbortError"
        throw error
    }
    // ⚠️ 源宽高缺失（0×0，如纯音频轨、探测失败的容器）时 calcLongEdge 会抛
    //    "invalid source size 0x0"，被上层包装成 `plan: ...` 这种费解的错误。
    //    calculateDstArgs 对同样情况已做 >0 保护，这里保持一致：尺寸不可用时按「不缩放」处理
    //    （size=null → buildScaleFilter 只做格式对齐、buildVideoFilters 不产出 scale 段）。
    const hasValidSourceSize =
        Number.isFinite(srcW) && Number.isFinite(srcH) && srcW > 0 && srcH > 0
    const size = hasValidSourceSize ? calcLongEdge(srcW, srcH, dimension) : null
    const tiers = resolveTiers({ caps, decodeMode, hwaccel })
    // 严格模式：不降级。只尝试第一候选层（硬件层），失败直接抛错；
    // 候选链首个就是 cpu（本机无任何硬件加速可用）时同样抛错，除非用户显式指定 cpu。
    // ⚠️ 「硬件层」按 tier.hwaccel 判定，不按层名 —— swdec 层是「CPU 解码 + 硬件编码」，
    //    对 strict 语义（要求硬件*解码*）不成立，不能当作可用硬件层。
    if (strict && decodeMode !== DecodeMode.CPU) {
        const hwTiers = tiers.filter((t) => t.hwaccel)
        if (hwTiers.length === 0) {
            throw new Error(
                `strict mode: no hardware acceleration tier available on this machine ` +
                    `(vendor=${caps.vendor}, usable=${JSON.stringify(caps.usable)}). ` +
                    `Use --decode-mode cpu to force software decode.`,
            )
        }
        const primary = hwTiers[0]
        const ok = await probeLayer({
            ffmpegPath: ffmpegPath || caps.ffmpegPath,
            inputPath,
            tier: primary,
            size,
            pixFmt,
            bitDepth,
            codec,
            codecFamily,
            speed,
            framerate,
            hasAudio,
            quality,
            bitrate,
            maxBitrate,
            forcedEncoder,
            encoders: caps.encoders,
            anime,
            signal,
        })
        if (!ok) {
            throw new Error(
                `strict mode: hwaccel '${primary.name}' unavailable for this input ` +
                    `(size=${srcW}x${srcH}, pix_fmt=${pixFmt}, codec=${codec || "?"}). ` +
                    `Refusing to fall back to CPU; use --decode-mode cpu to force software decode.`,
            )
        }
        return {
            tier: primary,
            size,
            degraded: false,
            tried: [primary.name],
            reason: `matched '${primary.name}' (strict)`,
        }
    }
    const tried = []
    const failures = []

    for (const tier of tiers) {
        tried.push(tier.name)
        // GPU 矩阵预筛：auto 模式下 cuda/d3d 层遇「明确不支持硬解」的格式组合
        // （如 40 系 + H.264 4:2:2）直接跳过干跑，结论与探测失败等价，省一次探测。
        // 预筛与检测到的 GPU 能力绑定：只跳过「矩阵明确 no」的组合，
        // partial / unknown / 非 NVIDIA / strict 与 gpu 模式一律不预筛。
        if (gpuBlocksDecode(caps, tier, { codec, pixFmt, bitDepth }, decodeMode)) {
            log.logInfo(
                "hwdetect",
                `skip probe tier '${tier.name}' (gpu ${caps.gpuProbe.arch} gen${caps.gpuProbe.generation}: ` +
                    `NVDEC no support for ${codec || "?"} ${pixFmt || "?"})`,
            )
            log.fileLog(
                `Probe tier=${tier.name} SKIP(gpu-matrix) src=${String(inputPath).split(/[\\/]/).pop()} ` +
                    `codec=${codec} pixFmt=${pixFmt} gpuGen=${caps.gpuProbe.generation}`,
                "FFCMD",
            )
            failures.push(tier.name)
            continue
        }
        const ok = await probeLayer({
            ffmpegPath: ffmpegPath || caps.ffmpegPath,
            inputPath,
            tier,
            size,
            pixFmt,
            bitDepth,
            codec,
            codecFamily,
            speed,
            framerate,
            hasAudio,
            quality,
            bitrate,
            maxBitrate,
            forcedEncoder,
            encoders: caps.encoders,
            anime,
            signal,
        })
        if (ok) {
            return {
                tier,
                size,
                degraded: tried.length > 1,
                tried,
                reason:
                    tried.length > 1
                        ? `degraded to '${tier.name}' after ${tried.slice(0, -1).join(",")} failed`
                        : `matched '${tier.name}'`,
            }
        }
        failures.push(tier.name)
        // 手动模式：失败即硬失败（不降级）
        if (decodeMode === DecodeMode.GPU) {
            throw new Error(
                `hwaccel '${tier.name}' unavailable for this input ` +
                    `(size=${srcW}x${srcH}, pix_fmt=${pixFmt}, codec=${codec || "?"}). ` +
                    `Try --decode-mode auto or cpu.`,
            )
        }
    }

    // auto 模式：即使全部探测失败也**不抛错**，而是回退到 cpu 层。
    //
    // ⚠️ 此前这里抛错，导致单个畸形文件（如 chromium 的
    //    bear-320x240_corrupted_after_init_segment.webm）让 pMap 整体中断，
    //    后续 300+ 文件全部不处理，且日志因异常冒泡而没落盘。
    //
    //    cpu 层探测失败通常意味着「这个文件本身有问题」，
    //    此时让真实转码去报错更合适：它能进入正常的 catch 流程，
    //    记录日志、标记 ffmpegFailed、走 CPU 重试链路。
    if (strict) {
        // 严格模式：无任何层可用时直接报错，不回退不改写
        throw new Error(
            `strict mode: no decode tier usable for this input ` +
                `(tried=[${tried.join(",")}], size=${srcW}x${srcH}, pix_fmt=${pixFmt}, ` +
                `codec=${codec || "?"}, bitDepth=${bitDepth ?? "?"}). Refusing automatic fallback.`,
        )
    }
    const cpuTier = TIERS.find((t) => t.name === "cpu")
    return {
        tier: cpuTier,
        size,
        degraded: true,
        tried,
        reason: `all tiers failed (${failures.join(", ")}); falling back to cpu for real attempt`,
    }
}

// ---------------------------------------------------------------------------
// 已知未完成项（保留给后续维护，勿按「未实现」重复开发）
// ---------------------------------------------------------------------------
//   - AMF 路径未实测（本机无 A 卡），参数来自 `-h filter=vpp_amf`
//   - 探测超时值 15000ms 为经验值，未在长素材上压测
