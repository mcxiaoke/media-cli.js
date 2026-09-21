/*
 * File: hwdetect.js
 * Created: 2026-09-20
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 硬件能力检测（S-4 方案「双层决策」的第一层）
 *
 * 职责：从 ffmpeg 构建本身探测**设备级**能力，回答「这台机器有哪些可用的硬件加速器」。
 *   与第二层「文件级探测」（lib/hwaccel.js 的 probeLayer）配合：
 *     硬件检测 → 候选层列表（便宜，一次即可，结果可长期缓存）
 *     文件探测 → 从候选中挑出真正能吃下这个文件的层（贵，按 编码/位深/尺寸 缓存）
 *
 * 判定依据（全部为实测结论，见 docs/S-4-SCALE-PARAMS-20260920.md）：
 *   - 没有 NVIDIA 显卡 → -encoders 不含 h264_nvenc/hevc_nvenc → 不用 cuda 层
 *   - 没有 Intel 核显   → -encoders 不含 h264_qsv        → 不用 qsv 层
 *   - 没有 AMD 显卡     → -encoders 不含 h264_amf 或缺 amfrt64.dll → 不用 amf 层
 *   - d3d11va 是 Windows 通用兜底，只要有 -hwaccels d3d11va 即可用
 *   - cpu 层永远可用
 *
 * ⚠️ 注意：本机实测 gyan 构建的 -encoders **含** h264_amf，但实际运行报
 *    "DLL amfrt64.dll failed to open"（无 A 卡）。因此 amf 的判定不能只看
 *    -encoders，必须结合真实设备初始化探测（见 detectAmfUsable）。
 */

import { execa } from "execa"
import * as log from "./debug.js"
import { resolveFFmpegBinary } from "./ffmpeg_bin.js"
import { detectGpus, gpuProbeList } from "./gpu.js"

/** 进程内缓存：设备级探测结果与 ffmpeg 构建绑定，一次进程内不必重复 */
let cachedCapabilities = null
// in-flight promise：首次探测进行中时并发调用返回同一个 promise，
// 避免 prepare 阶段多任务同时触发重复探测（探测要跑多个 execa，开销大）
let capabilitiesPromise = null

/** 各层对应的「可用性指纹」编码器 */
const TIER_ENCODER_PROBE = {
    cuda: ["h264_nvenc", "hevc_nvenc"],
    qsv: ["h264_qsv", "hevc_qsv"],
    amf: ["h264_amf", "hevc_amf"],
    d3d: ["h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv"], // d3d 只负责解码，编码需另配
}

/**
 * 解析 ffmpeg -encoders 输出，返回可用编码器集合
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseEncoders(stdout) {
    const set = new Set()
    for (const line of String(stdout || "").split(/\r?\n/)) {
        // 形如 " V....D h264_nvenc   NVIDIA NVENC H.264 encoder"
        const m = line.match(/^\s*[A-Z.]{6}\s+(\S+)/)
        if (m) set.add(m[1])
    }
    return set
}

/**
 * 解析 ffmpeg -hwaccels 输出
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseHwaccels(stdout) {
    const set = new Set()
    for (const line of String(stdout || "").split(/\r?\n/)) {
        const t = line.trim()
        if (!t || /^hardware acceleration methods:?$/i.test(t)) continue
        set.add(t)
    }
    return set
}

/**
 * 解析 ffmpeg -filters 输出，返回可用滤镜集合
 *
 * 输出形如（注意标志位宽度不固定，1~3 字符）：
 *   " .. scale_cuda        V->V       GPU accelerated video resizer"
 *   " T.. yadif            V->V       Deinterlace the input image."
 * 因此不能按固定宽度切，改为「找到含 -> 的列，取它前一列」。
 *
 * @param {string} stdout
 * @returns {Set<string>}
 */
export function parseFilters(stdout) {
    const set = new Set()
    for (const line of String(stdout || "").split(/\r?\n/)) {
        if (!line.includes("->")) continue
        const cols = line.trim().split(/\s+/)
        const arrowIdx = cols.findIndex((c) => c.includes("->"))
        if (arrowIdx >= 1) {
            const name = cols[arrowIdx - 1]
            // 过滤掉表头/说明行
            if (/^[A-Za-z0-9_]+$/.test(name)) set.add(name)
        }
    }
    return set
}

/**
 * 解析 ffmpeg -version 输出，返回构建/版本信息
 *
 * 输出形如：
 *   ffmpeg version N-126733-gfddc59cf3-2026-09-20-nonfree Copyright ...
 *   ...
 *   configuration: --enable-gpl --enable-libfdk-aac --enable-nvenc ...
 *
 * @param {string} stdout
 * @returns {{ version: string, configuration: string }} 版本标识与配置串
 */
export function parseVersionInfo(stdout) {
    const text = String(stdout || "")
    const lines = text.split(/\r?\n/)
    // 第一行：ffmpeg version <标识> Copyright ...
    const first = (lines[0] || "").match(/^ffmpeg version\s+(\S[\S ]*?)\s+Copyright/i)
    const version = first ? first[1].trim() : ""
    // configuration 行：可能与前一行断行，取包含 --enable- 的行
    const cfgLine = lines.find((l) => l.includes("configuration:")) || ""
    const configuration = cfgLine.includes(":")
        ? cfgLine.slice(cfgLine.indexOf(":") + 1).trim()
        : ""
    return { version, configuration }
}

/**
 * 真实设备初始化探测：某些编码器虽然列在 -encoders 里，但设备不可用
 * （典型：无 A 卡时 h264_amf 报 "DLL amfrt64.dll failed to open"）
 *
 * 用最小命令跑 1 帧到 null，只看退出码。
 *
 * @returns {Promise<boolean>}
 */
async function probeDeviceUsable(bin, { hwaccel, encoder, timeoutMs = 8000 }) {
    try {
        const args = ["-hide_banner", "-v", "error", "-y"]
        if (hwaccel) args.push("-hwaccel", hwaccel)
        args.push(
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=1",
            "-t",
            "1",
            "-c:v",
            encoder,
            "-frames:v",
            "1",
            "-f",
            "null",
            "-",
        )
        const res = await execa(bin, args, { reject: false, timeout: timeoutMs, cleanup: true })
        return res.exitCode === 0
    } catch {
        return false
    }
}

/**
 * 检测本机硬件加速能力
 *
 * @param {object} [opts]
 * @param {string} [opts.ffmpegPath] ffmpeg 可执行文件路径
 * @param {boolean} [opts.force] 忽略缓存强制重新检测
 * @param {boolean} [opts.deviceProbe] 是否做真实设备初始化探测（较慢，默认 true）
 * @returns {Promise<object>} 能力描述
 */
export async function detectHardwareCapabilities({
    ffmpegPath,
    force = false,
    deviceProbe = true,
} = {}) {
    if (cachedCapabilities && !force) {
        return cachedCapabilities
    }
    // 非 force 且已有探测在进行时，直接复用同一个 promise（in-flight 去重）
    if (capabilitiesPromise && !force) {
        return capabilitiesPromise
    }
    capabilitiesPromise = doDetectHardwareCapabilities({ ffmpegPath, deviceProbe })
    try {
        return await capabilitiesPromise
    } finally {
        capabilitiesPromise = null
    }
}

/** 实际探测逻辑（detectHardwareCapabilities 的 in-flight 去重载体） */
async function doDetectHardwareCapabilities({ ffmpegPath, deviceProbe }) {
    if (cachedCapabilities) {
        return cachedCapabilities
    }

    const bin = ffmpegPath || (await resolveFFmpegBinary())
    if (!bin) {
        throw new Error("hwdetect: ffmpeg not found")
    }

    // 1. 静态能力：一次性拉取 version / encoders / hwaccels / filters；
    //    同时并行探测 GPU 列表（失败降级，不影响 ffmpeg 侧探测，见 detectGpus）
    const [verRes, encRes, hwRes, fltRes, gpus] = await Promise.all([
        execa(bin, ["-hide_banner", "-version"], { reject: false }),
        execa(bin, ["-hide_banner", "-v", "error", "-encoders"], { reject: false }),
        execa(bin, ["-hide_banner", "-v", "error", "-hwaccels"], { reject: false }),
        execa(bin, ["-hide_banner", "-v", "error", "-filters"], { reject: false }),
        detectGpus(),
    ])
    const { version, configuration } = parseVersionInfo(verRes.stdout)
    const encoders = parseEncoders(encRes.stdout)
    const hwaccels = parseHwaccels(hwRes.stdout)
    const filters = parseFilters(fltRes.stdout)

    // 2. 逐层判定「静态是否具备」
    const staticOk = {
        cuda: TIER_ENCODER_PROBE.cuda.every((e) => encoders.has(e)),
        qsv: TIER_ENCODER_PROBE.qsv.every((e) => encoders.has(e)),
        amf: TIER_ENCODER_PROBE.amf.every((e) => encoders.has(e)),
        d3d: hwaccels.has("d3d11va"),
        cpu: true,
    }

    // 3. 真实设备探测：静态具备的层，再确认设备真的能用
    const usable = { ...staticOk }
    const probeDetail = {}
    if (deviceProbe) {
        const probes = []
        if (staticOk.cuda) {
            probes.push(
                probeDeviceUsable(bin, { hwaccel: "cuda", encoder: "h264_nvenc" }).then((ok) => {
                    usable.cuda = ok
                    probeDetail.cuda = ok ? "device ok" : "device init failed"
                }),
            )
        }
        if (staticOk.qsv) {
            probes.push(
                probeDeviceUsable(bin, { hwaccel: "qsv", encoder: "h264_qsv" }).then((ok) => {
                    usable.qsv = ok
                    probeDetail.qsv = ok ? "device ok" : "device init failed"
                }),
            )
        }
        if (staticOk.amf) {
            // AMF 无独立解码 hwaccel，直接测编码器
            probes.push(
                probeDeviceUsable(bin, { hwaccel: null, encoder: "h264_amf" }).then((ok) => {
                    usable.amf = ok
                    probeDetail.amf = ok ? "device ok" : "DLL/device unavailable (e.g. amfrt64.dll)"
                }),
            )
        }
        if (staticOk.d3d) {
            // d3d 只做解码，配 libx264 编码验证解码链路
            probes.push(
                probeDeviceUsable(bin, { hwaccel: "d3d11va", encoder: "libx264" }).then((ok) => {
                    usable.d3d = ok
                    probeDetail.d3d = ok ? "device ok" : "device init failed"
                }),
            )
        }
        await Promise.all(probes)
    }

    // 4. 推导厂商
    const vendor = usable.cuda ? "nvidia" : usable.qsv ? "intel" : usable.amf ? "amd" : "any"

    // 5. 滤镜可用性（老版本 ffmpeg 缺 scale_d3d11 / scale_vulkan 等）
    const filterSupport = {
        scale_cuda: filters.has("scale_cuda"),
        scale_qsv: filters.has("scale_qsv"),
        vpp_amf: filters.has("vpp_amf"),
        scale_d3d11: filters.has("scale_d3d11"),
        scale_vulkan: filters.has("scale_vulkan"),
    }

    // 6. GPU 硬件预探测列表：主 NVIDIA GPU 的代次 → 支持矩阵（仅 NVIDIA 有数据，
    //    AMD/Intel 或探测失败时为 null，调用方不预筛，见 lib/gpu.js）
    const gpuProbe = gpuProbeList(gpus)

    cachedCapabilities = {
        ffmpegPath: bin,
        // ---- ffmpeg 构建信息（用于日志与编码器可用性判断）----
        version,
        configuration,
        buildKind: /nonfree/i.test(configuration)
            ? "nonfree"
            : /gpl/i.test(configuration)
              ? "gpl"
              : "default",
        encoders, // Set<string>：构建自带编码器全集（libfdk_aac / hevc_nvenc 等）
        filters, // Set<string>：构建自带滤镜全集（scale_cuda / setpts 等）
        vendor,
        usable,
        staticOk,
        probeDetail,
        hwaccels: [...hwaccels],
        filterSupport,
        encoderCount: encoders.size,
        // ---- GPU 信息（systeminformation，探测失败为空数组）----
        gpus,
        // ---- 硬件预探测列表（NVIDIA 主 GPU 的支持矩阵，见 lib/gpu.js）----
        gpuProbe,
    }
    logEnvironment(bin, cachedCapabilities)
    log.debug(
        "hwdetect capabilities:",
        JSON.stringify(cachedCapabilities, (k, v) => (v instanceof Set ? `[Set:${v.size}]` : v)),
    )
    return cachedCapabilities
}

/**
 * 打印软硬件环境信息（单条 INFO，含 ffmpeg 构建/编码器/硬件加速栈/GPU）
 * @param {string} bin ffmpeg 可执行文件路径
 * @param {object} caps detectHardwareCapabilities 的结果
 */
function logEnvironment(bin, caps) {
    const has = (name) => (caps.encoders?.has(name) ? "yes" : "no")
    const usableTiers = Object.entries(caps.usable || {})
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(",")
    log.logInfo(
        "hwdetect",
        `ffmpeg=${bin} ${caps.version || "(unknown version)"} ` +
            `build=${caps.buildKind} encoders=${caps.encoderCount} ` +
            `libfdk_aac=${has("libfdk_aac")} hevc_nvenc=${has("hevc_nvenc")} libx264=${has("libx264")} libx265=${has("libx265")} ` +
            `hwaccels=[${(caps.hwaccels || []).join(",")}] usable=[${usableTiers}] ` +
            `gpus=[${describeGpus(caps.gpus)}]`,
    )
    if (caps.gpuProbe) {
        log.logInfo(
            "hwdetect",
            `gpu probe list (${caps.gpuProbe.arch} gen${caps.gpuProbe.generation}): ` +
                `decode=${caps.gpuProbe.decode.length} entries, ` +
                `encode=${caps.gpuProbe.encode.length} entries ` +
                `(see lib/gpu.js matrix; 'no' entries are skipped before probe)`,
        )
    }
}

/**
 * 缩写 GPU 列表用于日志，如 "nvidia:RTX 4070(gen40)/intel:UHD 750"
 * @param {object[]} gpus detectGpus() 的结果
 * @returns {string}
 */
function describeGpus(gpus) {
    if (!gpus || gpus.length === 0) return "none"
    return gpus
        .map((g) => {
            const gen = g.vendor === "nvidia" && g.generation ? `(gen${g.generation})` : ""
            return `${g.vendor}:${g.model}${gen}`
        })
        .join("/")
}

/** 清空缓存（测试用） */
export function clearHwCapabilitiesCache() {
    cachedCapabilities = null
}

/**
 * 解析候选层（双层决策的**第一层**：只依赖硬件能力，不碰文件）
 *
 * 这是「双层决策」的第一层输出：**不做文件相关判断**，只回答
 * 「这台机器理论上可以尝试哪些层」。
 *
 * T4 变化（方案 B：auto 模式下 --hwaccel 作白名单过滤）：
 *   decodeMode=auto 且用户显式传了 --hwaccel <层> 时，候选集只含 [该层, cpu]
 *   —— 不再把本机所有可用层都放进候选链；该层不可用时只剩 cpu（自动降级）。
 *   这与 gpu 模式的差别：gpu 模式只试用户指定层、失败即抛错；auto 模式保留 cpu 兜底。
 *
 * @param {object} caps detectHardwareCapabilities 的结果
 * @param {object} [opts]
 * @param {string} [opts.decodeMode] auto | gpu | cpu
 * @param {string} [opts.hwaccel] 显式指定的层名（decodeMode=gpu 时必填；auto 时作白名单过滤）
 * @returns {string[]} 层名数组，按优先级
 */
// 静态预筛映射：层名 → caps.filterSupport 键（T5 新增）
// 该层的缩放滤镜必须被构建支持（老 ffmpeg 缺 scale_cuda / vpp_amf 等），
// 否则该层即使能被调用，probe 也会因滤镜不存在而 100% 失败，白白多一次干跑。
// d3d/cpu 层用 CPU scale=，不在此表（filterSupport 只记录硬件滤镜）。
const FILTER_SUPPORT_KEY = {
    cuda: "scale_cuda",
    qsv: "scale_qsv",
    amf: "vpp_amf",
}

/**
 * GPU 厂商 → 理论可用的硬件解/编码层（hwaccel 白名单，T6 新增）
 *
 * 取值依据：
 *   - nvidia → cuda（NVDEC/NVENC）+ d3d（d3d11va 兜底解码 + NVENC 编码）
 *   - intel   → qsv（Quick Sync）+ d3d
 *   - amd     → amf（无独立解码 hwaccel，解码走 d3d11va）+ d3d
 *   - other/未知 → d3d（Windows 通用 d3d11va 兜底）
 *
 * 该常量只回答「某厂商 GPU 存在时，哪些层值得进入候选」；
 * 实际是否可用还要与 ffmpeg -hwaccels 实测集（caps.hwaccels）取交集，
 * 并叠加 caps.usable（静态编码器 + 真实设备初始化探测）与滤镜预筛。
 * d3d 层在此是厂商机器的第二候选（cuda/qsv/amf 失败后的 d3d11va 解码兜底），
 * 而非 T5 之前那种「所有机器无差别入场」的混合层。
 */
export const GPU_VENDOR_HWACCELS = {
    nvidia: ["cuda", "d3d"],
    intel: ["qsv", "d3d"],
    amd: ["amf", "d3d"],
    other: ["d3d"],
}

/**
 * `swdec` 层（CPU 解码 + CPU scale + **硬件编码**）可用的编码器矩阵，按主 GPU 厂商
 *
 * 语义：这一层**不加 `-hwaccel`**（纯软解）、滤镜用 CPU `scale=`，
 * 但编码仍交给该厂商的硬件编码器 —— 即「整链留在内存 + 硬编」。
 *
 * 实测依据（docs/ffmpeg/ffmpeg-hwaccel-support-matrix-20260921.md §3）：
 *   跨 PCIe 拷贝次数决定吞吐。硬解不可用时，正确姿势是**整链留在内存**：
 *     软解 + CPU scale + 硬编（编码器内部上传）= 1 次拷贝 → 720p→360p 实测 27.7x
 *     硬解 + 下载 + CPU scale + 硬编          = 2 次拷贝 → 同条件仅 17.1x（比纯软解还慢）
 *     纯软全链（libx264 veryfast）            = 1 次拷贝 → 10.9x
 *   即：**换硬编比换硬解更划算**，而"半吊子硬解"是最差解。
 *
 * 用途：GPU 解码层因 codec/位深/色度被拦截（gpuBlocksDecode / 探测失败）时，
 * 避免直接落到 libx264 / libx265。
 */
export const SWDEC_ENCODERS_BY_VENDOR = {
    nvidia: { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "av1_nvenc" },
    intel: { h264: "h264_qsv", hevc: "hevc_qsv", av1: "av1_qsv" },
    amd: { h264: "h264_amf", hevc: "hevc_amf", av1: "av1_amf" },
}

/** 层名 → ffmpeg -hwaccels 输出中的方法名（白名单交集用；amf/d3d 解码均走 d3d11va 系列） */
const TIER_HWACCEL_NAMES = {
    cuda: ["cuda"],
    qsv: ["qsv"],
    amf: ["d3d11va", "d3d12va", "dxva2"],
    d3d: ["d3d11va", "d3d12va", "dxva2"],
}

/**
 * 主 GPU 厂商（candidateTiers auto 链的定向依据）
 * @param {object} caps
 * @returns {"nvidia"|"intel"|"amd"|"other"}
 */
export function primaryVendor(caps) {
    const v = caps.gpus?.[0]?.vendor || caps.vendor || "other"
    return v === "any" ? "other" : v
}

/**
 * swdec 层是否入场：本机必须真的有该厂商的硬件编码器（caps.encoders 实测集）。
 * 只查编码器 —— 该层不依赖任何硬件解码能力，这正是它的意义。
 * @param {object} caps
 * @param {string} vendor primaryVendor() 的结果
 */
function swdecUsable(caps, vendor) {
    const row = SWDEC_ENCODERS_BY_VENDOR[vendor]
    if (!row) return false
    const encoders = caps.encoders
    if (!encoders) return false
    const has = (n) =>
        typeof encoders.has === "function"
            ? encoders.has(n)
            : Array.isArray(encoders) && encoders.includes(n)
    return Object.values(row).some(has)
}

/**
 * 该层对应的解码通路是否被本机构建支持（ffmpeg -hwaccels 实测集）
 * 旧 caps 无 hwaccels 字段（或为空）时不限制，保持向后兼容。
 */
function tierWhitelisted(hwaccels, tierName) {
    const names = TIER_HWACCEL_NAMES[tierName]
    if (!names) return true
    if (!Array.isArray(hwaccels) || hwaccels.length === 0) return true
    return names.some((n) => hwaccels.includes(n))
}

/** --hwaccel 合法取值（值域收敛：显式层名 + d3d 系列别名） */
const HWACCEL_ALIASES = { d3d11va: "d3d", d3d12va: "d3d", dxva2: "d3d" }
const HWACCEL_NAMES = new Set(["cuda", "qsv", "amf", "d3d", "cpu"])

export function candidateTiers(caps, { decodeMode = "auto", hwaccel } = {}) {
    if (decodeMode === "cpu") return ["cpu"]

    if (decodeMode === "gpu") {
        const name = normalizeHwaccelName(hwaccel)
        if (!name) {
            throw new Error(
                "decodeMode=gpu requires --hwaccel " +
                    `(cuda|qsv|amf|d3d|d3d11va|d3d12va|dxva2), got '${hwaccel ?? ""}'`,
            )
        }
        if (!caps.usable[name]) {
            throw new Error(
                `hwaccel '${name}' is not available on this machine ` +
                    `(vendor=${caps.vendor}, usable=${JSON.stringify(caps.usable)})`,
            )
        }
        return [name]
    }

    // ⚠️ 例外：--hwaccel auto 视为「未显式指定」，走默认链。
    //     normalizeHwaccelName("auto") 会归一化为 "d3d"（老陷阱），
    //     这里在归一气化前先拦截，避免把用户明确要「自动」的意图误当作 d3d 白名单。
    //     gpu 分支上面没有此例外 —— gpu 模式下传 "auto" 表示用默认硬件层（保守行为）。
    if (hwaccel && String(hwaccel).toLowerCase() !== "auto") {
        const name = normalizeHwaccelName(hwaccel)
        if (name && name !== "cpu") {
            // ⚠️ 注意：caps.usable 里 cpu 恒为 true（静态 ok），此处不校验一致性
            const usable = caps.usable[name]
            log.logInfo(
                `hwaccel: --hwaccel ${hwaccel} filters auto candidate tiers to [${[
                    name,
                    "cpu",
                ].join(",")}] (usable=${usable})`,
            )
            // 白名单层可用 → [层, cpu]（失败自动落 cpu）；
            // 白名单层不可用 → 只剩 [cpu]（自动降级，不为"指定了但机器不支持"而硬失败）
            return usable ? [name, "cpu"] : ["cpu"]
        }
        if (!name) {
            // 值域收敛：非法值不再静默忽略，warn 后走默认链
            log.logWarn(
                "hwdetect",
                `hwaccel: unknown value '${hwaccel}' ignored (expected ` +
                    `cuda|qsv|amf|d3d|d3d11va|d3d12va|dxva2|cpu|auto)`,
            )
        }
        // name 为 null（非法值）或 cpu：走默认链
    }

    // auto（默认链，T6）：主 GPU vendor 定向白名单 → ffmpeg -hwaccels 实测交集
    //   → usable（静态编码器 + 设备探测）→ 滤镜预筛 → cpu
    //   例：N 卡机器 → [cuda, d3d, cpu]（cuda 优先，d3d 为 d3d11va 解码兜底）；
    //       Intel 核显 → [qsv, d3d, cpu]；A 卡 → [amf, d3d, cpu]；无/未知 GPU → [d3d, cpu]。
    //   每层都叠加 hwaccels 白名单：构建不支持该解码通路（-hwaccels 无对应方法）时直接跳过。
    const vendor = primaryVendor(caps)
    const allowed = GPU_VENDOR_HWACCELS[vendor] || GPU_VENDOR_HWACCELS.other
    const list = []
    for (const t of allowed) {
        if (!tierWhitelisted(caps.hwaccels, t)) {
            log.logInfo(
                `hwaccel: skip tier '${t}' in auto chain ` +
                    `(decoder method not in ffmpeg -hwaccels: [${(caps.hwaccels || []).join(",")}])`,
            )
            continue
        }
        if (!caps.usable[t]) continue
        const filterKey = FILTER_SUPPORT_KEY[t]
        // 静态预筛：本层缩放滤镜必须被构建支持，否则该层必然探测失败
        if (filterKey && caps.filterSupport && !caps.filterSupport[filterKey]) {
            log.logInfo(
                `hwaccel: skip tier '${t}' in auto chain (filter '${filterKey}' not supported by this ffmpeg build)`,
            )
            continue
        }
        list.push(t)
    }
    // swdec 层（CPU 解码 + CPU scale + 硬件编码，T7 新增）：
    //   位置固定在「厂商解码层之后、cpu 之前」—— 它不提升解码能力，
    //   只改善"解码层被拦下后原本会落到 libx264/libx265"的那一段。
    //   入场条件：本机存在该厂商的硬件编码器（与解码能力无关）。
    if (swdecUsable(caps, vendor)) {
        list.push("swdec")
    }
    list.push("cpu")
    return list
}

/** --hwaccel 取值 → 层名（值域收敛：非法/未知值一律返回 null） */
function normalizeHwaccelName(hwaccel) {
    if (!hwaccel) return null
    const h = String(hwaccel).toLowerCase()
    if (h === "auto") return "d3d"
    if (HWACCEL_ALIASES[h]) return HWACCEL_ALIASES[h]
    if (HWACCEL_NAMES.has(h)) return h
    return null
}

export default {
    detectHardwareCapabilities,
    clearHwCapabilitiesCache,
    candidateTiers,
    parseEncoders,
    parseHwaccels,
    parseFilters,
    parseVersionInfo,
    GPU_VENDOR_HWACCELS,
    SWDEC_ENCODERS_BY_VENDOR,
    primaryVendor,
}
