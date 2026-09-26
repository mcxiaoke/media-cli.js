/*
 * File: hwaccel_args.js
 * Created: 2026-09-26
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 硬件加速参数拼装与命令行生成（纯数据组装，无外部进程依赖）
 */

import { encoderCalibImpl, normalizeQualityForEncoder } from "./hwaccel_quality.js"
import { buildVideoFilters, buildAudioFilters, needsDepthAlign } from "./hwaccel_scale.js"

/**
 * 编码器矩阵：[层][输出 codec 族] → 编码器名
 *
 * ⚠️ 关键设计（曾犯错，务必保留此说明）：
 *   输出编码器由 **preset 的 codec 族决定**（preset.videoCodecFamily / userArgs.videoCodec），
 *   本矩阵再按「解码层 × 输出族」选出具体编码器名，与 **输入位深无关**。
 *
 *   输入位深只影响「哪一层能解码」——那是 probeLayer 的职责。
 *   `h264 + 10bit` 只是 NVENC **不能硬解**，换一层解码即可，
 *   与输出用什么编码器毫无关系。
 *
 *   此前错误地按输入位深选编码器（10bit → hevc_nvenc），导致
 *   `hevc_2kt` 预设遇到 8bit 输入时输出成了 `h264_nvenc`。
 */
export const ENCODER_MATRIX = {
    cuda: { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "av1_nvenc" },
    qsv: { h264: "h264_qsv", hevc: "hevc_qsv", av1: "av1_qsv", vp9: "vp9_qsv" },
    amf: { h264: "h264_amf", hevc: "hevc_amf", av1: "av1_amf" },
    d3d: { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "av1_nvenc" },
    cpu: { h264: "libx264", hevc: "libx265", av1: "libsvtav1", vp9: "libvpx-vp9" },
}
// ⚠️ 硬件编码器可用性（docs/ffmpeg/ffmpeg-guide-hwaccel-compat.md）：
//   NVENC 无 vp9_nvenc、AMF 无 vp9_amf（vp9_amf 仅是解码器）——
//   这两层缺 vp9 键，由 buildEncoderArgs 的缺失 fallback 走 CPU 编码器（libvpx-vp9）。
//   CPU av1 用 libsvtav1，
//
// swdec 层的字面量兜底行 = CPU 行（拿不到厂商信息时安全回退到原 cpu 层行为，不会更差）；
// 真实取值由 resolveTiers 按主 GPU 厂商注入的 tier.encoderRow 覆盖。
ENCODER_MATRIX.swdec = ENCODER_MATRIX.cpu

/**
 * 各 codec 族的编码器运行时回退候选（按偏好排序）。
 *
 * ⚠️ 编码器可用性与 ffmpeg 构建强相关——静态表 ENCODER_MATRIX 给的是"理想默认"，
 *    不保证该构建真的带着它。实测 P0：cpu 层 AV1 写死 libaom-av1，而常见分发构建
 *    （gyan 等）只有 libsvtav1/librav1e、没有 libaom，AV1 一旦降级到 cpu/swdec 层就
 *    100% `Unknown encoder`。这里用 detectHardwareCapabilities 已探测到的
 *    caps.encoders 做运行时命中，取候选里该构建真实存在的第一个。
 *
 * 仅用于 cpu/swdec 等软件/通用编码器层；硬件层（cuda/qsv/amf）的编码器在候选链
 * 入场时已由 hwdetect.js 用同一份 caps.encoders 静态校验过存在，不受影响。
 */
export const ENCODER_RUNTIME_FALLBACK = {
    h264: ["libx264", "h264_nvenc", "h264_qsv", "h264_amf"],
    hevc: ["libx265", "hevc_nvenc", "hevc_qsv", "hevc_amf"],
    vp9: ["libvpx-vp9", "vp9_qsv"],
    av1: ["libsvtav1", "libaom-av1", "librav1e", "av1_nvenc", "av1_qsv"],
}

/**
 * 依据运行时探测到的编码器集合回退编码器。
 * @param {string} encoder 矩阵选出的理想编码器
 * @param {string} [codecFamily] 输出 codec 族
 * @param {Set<string>|string[]} [encoders] detectHardwareCapabilities 的 caps.encoders
 * @returns {string} 实际可用编码器（encoders 未知或已命中时原样返回）
 */
export function pickRuntimeEncoder(encoder, codecFamily = "h264", encoders) {
    if (
        !encoders ||
        (encoders instanceof Set && encoders.size === 0) ||
        (Array.isArray(encoders) && encoders.length === 0)
    ) {
        return encoder
    }
    const has = (n) => (encoders instanceof Set ? encoders.has(n) : encoders.includes(n))
    if (has(encoder)) return encoder
    const list = ENCODER_RUNTIME_FALLBACK[codecFamily] || [encoder]
    for (const alt of list) {
        if (has(alt)) return alt
    }
    return encoder // 候选全缺 + 原编码器也不在集合里：保持原值（与 encoders 未知时行为一致）
}

/**
 * 生成输入侧硬件加速参数
 * @param {object} tier
 * @returns {string[]}
 */
export function buildHwaccelArgs(tier) {
    if (!tier.hwaccel) return []
    const args = ["-hwaccel", tier.hwaccel]
    if (tier.hwFormat) {
        args.push("-hwaccel_output_format", tier.hwFormat)
    }
    return args
}

/**
 * 编码器参数块（含质量参数）
 *
 * ⚠️ 质量参数**不是通用的**，写错会被静默忽略（详见下方 switch 注释）。
 * 因此必须**整段替换**编码器参数块，不能只换编码器名。
 *
 * 参数说明：
 *   tierName    分层候选的层名（cuda|qsv|amf|d3d|cpu）
 *   forcedEncoder  用户显式指定的编码器（--video-codec / ffargs vc）：
 *                  非空时**跳过 ENCODER_MATRIX**，直接用该编码器，
 *                  并按编码器实现分发质量参数（不依赖 tierName）。
 *
 * @param {string} tierName 层名
 * @param {object} opts
 * @param {number} opts.quality 质量值
 * @param {number} [opts.bitrate] 目标码率（bps，纯数字；已按分辨率 scale 过）
 * @param {number} [opts.maxBitrate] 峰值码率（bps；已按分辨率 scale 过，缺省 = bitrate × 1.5）
 * @param {string} [opts.codecFamily] 输出 codec 族（"h264"|"hevc"）
 * @param {string} [opts.forcedEncoder] 显式指定的编码器名（穿透 ENCODER_MATRIX）
 * @param {Set<string>|string[]} [opts.encoders] caps.encoders，用于运行时编码器回退（cpu/av1 等缺失时）
 * @returns {string[]} 参数数组
 */
export function buildEncoderArgs(
    tierName,
    {
        quality = 24,
        bitrate,
        maxBitrate,
        codecFamily = "h264",
        pixFmt,
        bitDepth,
        forcedEncoder,
        tier,
        encoders,
        anime = false,
    } = {},
) {
    // 显式编码器穿透：跳过 ENCODER_MATRIX，质量按编码器实现换算
    // 矩阵缺失 fallback（ENCODER_MATRIX 缺该层的族键，如 cuda/vp9、amf/vp9）：
    //   该层无该族的硬件编码器 → 回退 CPU 编码器（如 vp9 → libvpx-vp9），
    //   编码用 CPU 但解码仍走该层硬件（层只决定解码路径，见 ENCODER_MATRIX 说明）。
    // tier.encoderRow（swdec 层由 resolveTiers 按厂商注入）优先于静态矩阵行。
    const baseRow = ENCODER_MATRIX[tierName] || ENCODER_MATRIX.cpu
    const familyRow = tier?.encoderRow || baseRow
    const rawEncoder = forcedEncoder || familyRow[codecFamily] || ENCODER_MATRIX.cpu[codecFamily]
    // 运行时回退：矩阵选的理想编码器该构建可能没有（如 cpu/av1→libaom-av1 常见缺失），
    // 用已探测的 caps.encoders 取候选里真实存在的第一个；显式编码器不参与回退。
    const encoder = forcedEncoder
        ? rawEncoder
        : pickRuntimeEncoder(rawEncoder, codecFamily, encoders)
    // 质量按「实际编码器实现」换算（而不是按层名）：
    //   对既有层与旧行为**等价**（cuda/d3d→h264_nvenc→nvenc、qsv→qsv、amf→amf、
    //   cpu→libx264→x264；vp9 回退 libvpx-vp9 同样落到 x264 基准），
    //   对 swdec 层则必需 —— 它的编码器随厂商变化，按层名查表会恒取到兜底键。
    const q = normalizeQualityForEncoder(encoder, codecFamily, quality, pixFmt)
    const args = ["-c:v", encoder]
    // 质量参数按「实际编码器实现」分发：forcedEncoder 直判实现；
    // 非 forced 也按编码器名判实现 —— cuda/amf 层 vp9 无硬件编码器时
    // 矩阵会回退到 libvpx-vp9（CPU），此时必须走 cpu 分支（-crf），
    // 按层名（tierImpl）判会错给 nvenc/amf 参数导致 libvpx-vp9 不认。
    const impl = encoderCalibImpl(encoder)
    // 码率统一用 bps（与 mediainfo/模板 src 码率同源）纯数字计算，仅在最末拼 ffmpeg 时用
    // kb() 格式化为 "xxxK"。bitrate 是预设目标码率、已按分辨率 scale 过（dstVideoBitrate）。
    // 峰值上限 maxBitrate（也已在 calculateDstArgs 随分辨率 scale 过）：
    //   显式声明 → 直接用；缺省 → bitrate×1.5（保持既有行为，随 bitrate 缩放）。
    // 带 K 的模板字段（videoBitrateK/audioBitrateK）是**字符串**，仅供文件名/模板
    // （suffix 等）注入使用，不参与这里的码率计算。
    const kb = (v) => `${Math.round((v || 0) / 1000)}K`
    const b = bitrate || 0
    const m = maxBitrate && maxBitrate > 0 ? Math.round(maxBitrate) : Math.round(b * 1.5)
    const usingVbr = b > 0
    // ⚠️ 编码器参数「精简可靠」原则（docs/ffmpeg/ffmpeg-filter-assembly-20260922.md）：
    //   只施加「官方文档 + 社区公认」的核心质量/码控参数；删除一切臆造的可选调优项。
    //   动因：原实现堆了 spatial-aq/temporal-aq/weighted_pred/b_ref_mode/surfaces、
    //   qsv 的 look_ahead/extbrc/async_depth、x265 的 tune film —— 其中若干在本 build
    //   直接 "Unrecognized option"/与 B 帧冲突 → 每次该编码器探测失败 → auto 全程降级 CPU。
    //   下列保留项均已在真实 build N-126733 逐编码器 1 帧实测通过；amf 无 A 卡未验证，
    //   故只保留最保守的码率控制，其余留待 A 卡复验。
    // 统一按「有无目标码率」分发两种码控模式：
    //   bitrate(bps) > 0 → VBR（目标码率）模式：-b:v = bitrate，-maxrate = maxBitrate（缺省 bitrate×1.5）；
    //   bitrate 为空    → CQ（恒定质量）模式，各编码器用**自己**的质量参数名
    //   （nvenc -cq / qsv -global_quality / amf -qvbr_quality_level / 其余 -crf）。
    // 编码器参数按 N-126733 真机 `-h encoder=X` + data/videos 实测核准，勿凭文档臆造。
    switch (impl) {
        case "nvenc": {
            // NVIDIA：-rc vbr 开启 VBR 码控。-rc-lookahead 是场景自适应关键帧与自适应 B 帧
            //   （-no-scenecut/-b_adapt）生效的前提（默认 0=关闭）。CQ 用 -cq（配 -b:v 0
            //   关码率上限）；VBR 用 -b:v + VBV 上限。实测两模式均可编码。
            args.push("-rc", "vbr", "-tune", "hq", "-rc-lookahead", "30")
            if (usingVbr) {
                args.push("-b:v", kb(b), "-maxrate", kb(m), "-bufsize", kb(m))
            } else {
                args.push("-cq", String(q), "-b:v", "0")
            }
            // 动漫模式：空间与时间自适应量化（平涂色块与稳定线条），N-126733 实测支持
            if (anime) {
                args.push("-spatial-aq", "1", "-temporal-aq", "1")
            }
            break
        }
        case "qsv": {
            // Intel：CQ 用 -global_quality（通用质量选项，触发 ICQ 质量模式）；VBR 用 -b:v。
            // 已删未验证调优项：-look_ahead -look_ahead_depth -async_depth -extbrc。
            if (usingVbr) {
                args.push("-b:v", kb(b), "-maxrate", kb(m))
            } else {
                args.push("-global_quality", String(q), "-b:v", "0")
            }
            break
        }
        case "amf": {
            // AMD：CQ 用 -rc qvbr + -qvbr_quality_level（取值 0..51，语义等价 NVENC -cq）；
            // VBR 用 -rc vbr_peak + -b:v。选项名经 `-h encoder=hxxx_amf` 确认存在；
            // ⚠️ 本机无 A 卡，未实拍验证，待 A 卡复验。
            if (usingVbr) {
                args.push("-rc", "vbr_peak", "-b:v", kb(b), "-maxrate", kb(m))
            } else {
                args.push("-rc", "qvbr", "-qvbr_quality_level", String(q))
            }
            break
        }
        case "cpu":
        default: {
            // CPU：x264/x265 CQ 用 -crf(+preset)，VBR 用 -b:v(+VBV 上限)。
            // av1/vp9（libsvtav1 / libaom-av1 / libvpx-vp9）：CQ 纯 -crf 必须配 -b:v 0；
            //   VBR 直接 -b:v（不可再叠 -maxrate/-bufsize 否则报 "Rate control ... bitrate"）。
            if (codecFamily === "h264" || codecFamily === "hevc") {
                if (usingVbr) {
                    args.push(
                        "-b:v",
                        kb(b),
                        "-preset",
                        "medium",
                        "-maxrate",
                        kb(m),
                        "-bufsize",
                        kb(m),
                    )
                } else {
                    args.push("-crf", String(q), "-preset", "medium")
                }
            } else if (usingVbr) {
                args.push("-b:v", kb(b))
            } else {
                args.push("-crf", String(q), "-b:v", "0")
            }

            // 动漫模式：CPU 编码器专属优化（N-126733 真机实测核准）
            if (anime) {
                if (codecFamily === "h264") {
                    args.push("-tune", "animation")
                } else if (codecFamily === "hevc") {
                    // 关闭 SAO 避免线条边缘变糊，启用 AQ-3 保护线条与纯色平涂
                    args.push("-x265-params", "no-sao=1:aq-mode=3")
                } else if (codecFamily === "av1" && String(encoder).includes("svtav1")) {
                    // tune=0: 视觉质量优先（保留线条锐利度）
                    args.push("-svtav1-params", "tune=0")
                }
            }
            break
        }
    }
    // CQ(恒定质量)模式下显式 maxBitrate → 追加峰值封顶 -maxrate/-bufsize（CRF/CQ + VBV cap）。
    // 真机 8.1 已验证 x264/x265/nvenc/qsv/svtav1 均接受；🅰 amf 无 A 卡未实证，保守只发 -maxrate。
    // 说明：纯质量模式 b=0 → m 仅在 maxBitrate>0 时非 0，故本块只在显式峰值封顶时触发。
    if (!usingVbr && m > 0) {
        args.push("-maxrate", kb(m))
        if (impl !== "amf") args.push("-bufsize", kb(m))
    }

    // swdec 层：源 10bit 而目标 h264 族时，硬件编码器打不开 10bit 输入
    //   （实测 h264_nvenc：Nothing was written into output file；`-h encoder=h264_nvenc`
    //    虽列出 p010le，但驱动不支持）。
    //   swdec 层帧本来就在系统内存，加 -pix_fmt 只是插一次 CPU 格式转换，无下载代价。
    //   不加则整层探测失败 → 白落到 libx264（实测 27.7x vs 10.9x 的差距就丢在这里）。
    //   hevc 族不需要：hevc_nvenc/hevc_qsv 可直接吃 p010。
    //   ⚠️ 判据用 needsDepthAlign（位深未知按"需要对齐"处理，见其注释）；
    //      且**必须传 bitDepth**：mediainfo 路径下 pixelFormat="YUV4:2:0" 不含位深，
    //      只传 pixFmt 会让 10bit 源漏掉对齐（真实片库 169 个 10bit 文件的收益点）。
    if (
        tierName === "swdec" &&
        !forcedEncoder &&
        codecFamily === "h264" &&
        needsDepthAlign(pixFmt, bitDepth)
    ) {
        args.push("-pix_fmt", "yuv420p")
    }
    return args
}

/**
 * 生成单层的完整 ffmpeg 参数（不含输入输出路径）
 *
 * ⚠️ 返回值区分两段：
 *   inputArgs  — 必须放在 `-i` **之前**（-hwaccel 等输入侧选项）
 *   outputArgs — 必须放在 `-i` **之后**（滤镜、编码器）
 *
 * 调用方组装顺序：inputArgs → -i <path> → outputArgs
 *
 * @param {object} opts
 * @param {object} opts.tier
 * @param {{w:number,h:number}} opts.size
 * @param {string} opts.pixFmt 源像素格式
 * @param {number} [opts.speed]
 * @param {number} [opts.framerate]
 * @param {boolean} [opts.hasAudio]
 * @param {number} [opts.quality] 质量参数（nvenc/qsv 的 cq，x264 的 crf）
 * @returns {{inputArgs:string[], outputArgs:string[], encoder:string}}
 */
export function buildLayerArgs({
    tier,
    size,
    speed,
    framerate,
    hasAudio = true,
    quality = 24,
    bitrate,
    maxBitrate,
    codecFamily = "h264",
    pixFmt,
    bitDepth,
    forcedEncoder,
    encoders,
    anime = false,
}) {
    const inputArgs = buildHwaccelArgs(tier)
    const outputArgs = []
    // codecFamily/pixFmt/bitDepth 用于 scale 的位深对齐（scaleFormatOverride）
    const vf = buildVideoFilters({ tier, size, speed, framerate, codecFamily, pixFmt, bitDepth })
    const af = buildAudioFilters(speed)
    // ⚠️ D2（实测）：变速用 simple `-vf`(含 setpts) + `-af`(atempo) 即可，muxer 按 PTS 保同步，
    //   不需要 `-filter_complex`（complex 仅多入/多出/打标签才需要）。真实命令侧
    //   （ffmpeg_build.buildFilterArgs）产完全相同的 -vf + -af 形态 → 探测=真实同构。
    if (vf) outputArgs.push("-vf", vf)
    if (af && hasAudio) outputArgs.push("-af", af)

    // 编码器参数由 buildEncoderArgs 统一生成（按层 + 输出 codec 族）
    // pixFmt 用于 10bit + qsv 的质量钳制 / swdec 的位深对齐
    // tier 一并传入：swdec 层的编码器行是按厂商注入的（tier.encoderRow），
    // 探测命令与真实命令必须走同一条解析路径，否则探测结论与产物不一致。
    const encArgs = buildEncoderArgs(tier.name, {
        quality,
        bitrate,
        maxBitrate,
        codecFamily,
        pixFmt,
        forcedEncoder,
        tier,
        encoders,
        anime,
    })
    outputArgs.push(...encArgs)
    const encoder = encArgs[1]
    return { inputArgs, outputArgs, encoder }
}

/**
 * 组装探测用的完整参数（探测即干跑，与真实命令同构）
 *
 * 帧数取 10（不是 1）：`-frames:v 1` 只能测到「编码器能否打开」，覆盖不到 nvenc
 * `-rc-lookahead` 缓冲、B 帧重排与首段场景判定 —— 与真实编码路径不同构。10 帧足够
 * 把前瞻缓冲与首批帧类型决策跑到；真机成本相对 1 帧仅 +20ms（NVENC，其余分支类似，
 * 见 docs/CHANGES-20260923.md 09:17 附注），且 `probeCacheKey` 按
 * (tier|codec|pixFmt|bitDepth|size) 缓存，一批同配置只跑一次，代价可忽略。
 * @returns {string[]} 可直接交给 execa 的参数数组（不含可执行文件）
 */
export function buildProbeArgs(opts) {
    const { inputArgs, outputArgs } = buildLayerArgs(opts)
    return [
        "-hide_banner",
        "-v",
        "error",
        "-y",
        ...inputArgs,
        "-i",
        opts.inputPath,
        ...outputArgs,
        "-frames:v",
        "10",
        "-f",
        "null",
        "-",
    ]
}
