/*
 * File: gpu.js
 * Created: 2026-09-21
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * GPU 探测与 NVIDIA 编解码支持矩阵（硬件预探测列表的数据源）
 *
 * 职责：回答「这台机器上的 GPU 支持哪些编解码格式」。
 *   数据流向：detectGpus()（systeminformation 探测实际 GPU）
 *             → nvidiaGenerationOf()（型号 → 代次）
 *             → 支持矩阵查表（NVENC 编码 / NVDEC 解码）
 *             → gpuProbeList()（生成「预探测列表」，并入 hwdetect 的 caps）
 *
 * 支持矩阵来源：docs/ffmpeg/nvidia_nvenc_nvdec_support_report.md
 *   （NVIDIA 官方 Video Encode/Decode Support Matrix，GeForce 10/20/30/40/50 系统计）
 *   单元格取值：yes（全系支持）/ no（全系不支持）/ partial（部分卡支持，不做预筛依据）
 *
 * 口径提醒（防误用）：
 *   - RTX 2050 名义 20 系、硅片 Ampere（能力等同 30 系）：型号解析单独处理；
 *   - GTX 16 / RTX 20 同为「20 系」，但 NVENC 是 6th（GTX 16）/ 7th（RTX 20）两代，
 *     HEVC B 帧仅 7th gen 支持 —— 矩阵中 20 系 B 帧标 partial，不参与预筛；
 *   - NVDEC 的 HEVC 4:4:4 行按统计表为「20 系全支持」（Turing 起具备该能力），
 *     与报告结论段个别措辞冲突时以统计表为准。
 *
 * 预筛规则（见 hwaccel.selectTier）：只有矩阵为**明确 no** 的组合才跳过探测，
 * partial / unknown / 非 NVIDIA / 未知代次一律不预筛，保持探测行为安全。
 */

import * as log from "../../lib/debug.js"

// ---------------------------------------------------------------------------
// GPU 型号 → NVIDIA 代次
// ---------------------------------------------------------------------------

/** NVIDIA 架构代次（用于查支持矩阵） */
export const NVIDIA_GEN = {
    PASCAL: 10,
    TURING: 20,
    AMPERE: 30,
    ADA: 40,
    BLACKWELL: 50,
}

/** 代次 → 架构名（日志用） */
export const NVIDIA_GEN_NAMES = {
    [NVIDIA_GEN.PASCAL]: "Pascal",
    [NVIDIA_GEN.TURING]: "Turing",
    [NVIDIA_GEN.AMPERE]: "Ampere",
    [NVIDIA_GEN.ADA]: "Ada Lovelace",
    [NVIDIA_GEN.BLACKWELL]: "Blackwell",
}

/**
 * 从 GPU 型号字符串推断 NVIDIA 架构代次（10/20/30/40/50），非 NVIDIA / 无法识别返回 null
 *
 * 匹配优先级（顺序敏感）：50 → 40 → 30 → 2050 → 20 → GTX16 → GTX10
 * （RTX 2050 必须先于 RTX 20xx 匹配：名义 20 系、硅片 Ampere，能力等同 30 系）
 *
 * @param {string} model 如 "NVIDIA GeForce RTX 4070" / "Intel(R) UHD Graphics 750"
 * @returns {number|null}
 */
export function nvidiaGenerationOf(model) {
    const m = String(model || "").toUpperCase()
    if (!m.includes("NVIDIA") && !/RTX\s*\d|GTX\s*\d/.test(m)) return null
    if (/\bRTX\s*50\d{2}/.test(m)) return NVIDIA_GEN.BLACKWELL
    if (/\bRTX\s*40\d{2}/.test(m)) return NVIDIA_GEN.ADA
    if (/\bRTX\s*30\d{2}/.test(m)) return NVIDIA_GEN.AMPERE
    if (/\bRTX\s*2050\b/.test(m)) return NVIDIA_GEN.AMPERE // Ampere 硅片特例
    if (/\bRTX\s*20\d{2}/.test(m)) return NVIDIA_GEN.TURING
    if (/\bGTX\s*16\d{2}/.test(m)) return NVIDIA_GEN.TURING // Turing 6th gen
    if (/\bGTX\s*10\d{2}/.test(m)) return NVIDIA_GEN.PASCAL
    return null
}

// ---------------------------------------------------------------------------
// 支持矩阵
// ---------------------------------------------------------------------------

/** 全代次支持的便捷生成器 */
const ALL = () => ({
    [NVIDIA_GEN.PASCAL]: "yes",
    [NVIDIA_GEN.TURING]: "yes",
    [NVIDIA_GEN.AMPERE]: "yes",
    [NVIDIA_GEN.ADA]: "yes",
    [NVIDIA_GEN.BLACKWELL]: "yes",
})

/** 仅 50 系支持的便捷生成器 */
const ONLY50 = () => ({
    [NVIDIA_GEN.PASCAL]: "no",
    [NVIDIA_GEN.TURING]: "no",
    [NVIDIA_GEN.AMPERE]: "no",
    [NVIDIA_GEN.ADA]: "no",
    [NVIDIA_GEN.BLACKWELL]: "yes",
})

/**
 * NVENC 编码支持矩阵（报告「一、NVENC 编码器 — NO 统计」结构化）
 * 键：codec 族 → 格式（yuv420p/yuv422p/yuv444p/lossless/bframe）
 *
 * ⚠️ 编码侧仅作能力数据（gpuProbeList 输出）：
 *   本工具缩放链路统一走 scale_cuda + format=cuda（nv12），4:2:2 输入在编码前
 *   已被转成 4:2:0，NVENC 的 4:2:2 限制在实际编码中不触发，
 *   因此编码矩阵**不参与** selectTier 的预筛。
 */
export const NVENC_MATRIX = {
    h264: {
        yuv420p: ALL(),
        yuv422p: ONLY50(), // 10-40 系全不支持，50 系补齐
        yuv444p: ALL(),
        lossless: ALL(),
    },
    hevc: {
        yuv420p: ALL(), // 含 8K / 10bit
        yuv422p: ONLY50(),
        yuv444p: ALL(),
        lossless: ALL(),
        bframe: {
            [NVIDIA_GEN.PASCAL]: "no",
            [NVIDIA_GEN.TURING]: "partial", // GTX16(6th) 不支持 / RTX20(7th) 支持
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
    },
    av1: {
        // 编码仅 4:2:0；40 系(Ada) 起支持
        yuv420p: {
            [NVIDIA_GEN.PASCAL]: "no",
            [NVIDIA_GEN.TURING]: "no",
            [NVIDIA_GEN.AMPERE]: "no",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
    },
}

/**
 * NVDEC 解码支持矩阵（报告「二、NVDEC 解码器 — NO 统计」结构化）
 * 键：codec 族 → "420-8bit" | "420-10bit" | "422-8bit" ... 等格式键
 *
 * 解码矩阵参与 selectTier 预筛：矩阵明确 no 的 (代次, codec, 色度, 位深)
 * 组合必然无法硬解，跳过干跑直接降级，结论与真实探测等价。
 */
export const NVDEC_MATRIX = {
    mpeg1: { any: ALL() },
    mpeg2: { any: ALL() },
    mpeg4: { any: ALL() },
    vc1: { any: ALL() },
    vp8: {
        any: {
            [NVIDIA_GEN.PASCAL]: "partial", // 仅 2/6 支持
            [NVIDIA_GEN.TURING]: "yes",
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
    },
    vp9: {
        "420-8bit": ALL(),
        "420-10bit": {
            [NVIDIA_GEN.PASCAL]: "partial",
            [NVIDIA_GEN.TURING]: "yes",
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
        "420-12bit": {
            [NVIDIA_GEN.PASCAL]: "partial",
            [NVIDIA_GEN.TURING]: "yes",
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
    },
    h264: {
        "420-8bit": ALL(),
        "420-10bit": ONLY50(),
        "422-8bit": ONLY50(),
        "422-10bit": ONLY50(),
    },
    hevc: {
        "420-8bit": ALL(),
        "420-10bit": ALL(),
        "420-12bit": ALL(),
        "422-8bit": ONLY50(),
        "422-10bit": ONLY50(),
        "422-12bit": ONLY50(),
        "444-8bit": {
            [NVIDIA_GEN.PASCAL]: "no",
            [NVIDIA_GEN.TURING]: "yes", // 统计表：Turing 起全支持
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
        "444-10bit": {
            [NVIDIA_GEN.PASCAL]: "no",
            [NVIDIA_GEN.TURING]: "yes",
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
        "444-12bit": {
            [NVIDIA_GEN.PASCAL]: "no",
            [NVIDIA_GEN.TURING]: "yes",
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
    },
    av1: {
        // 20 系的 partial 来自 RTX 2050（Ampere 硅片），真 Turing 不支持
        any: {
            [NVIDIA_GEN.PASCAL]: "no",
            [NVIDIA_GEN.TURING]: "partial",
            [NVIDIA_GEN.AMPERE]: "yes",
            [NVIDIA_GEN.ADA]: "yes",
            [NVIDIA_GEN.BLACKWELL]: "yes",
        },
    },
}

// ---------------------------------------------------------------------------
// 像素格式解析
// ---------------------------------------------------------------------------

/**
 * 从像素格式串提取色度采样（420/422/444），无法识别返回 null
 * 例：yuv420p / yuv420p10le → "420"；yuv422p10le → "422"；yuv444p16le → "444"
 *     gray / nv12 / p010 等返回 null（不在矩阵内，不预筛）
 *
 * @param {string} pixFmt
 * @returns {"420"|"422"|"444"|null}
 */
export function chromaOfPixFmt(pixFmt) {
    const m = String(pixFmt || "").toLowerCase()
    if (/yuv420|nv12|p010|yuv410/.test(m)) return "420"
    if (/yuv422|p210/.test(m)) return "422"
    if (/yuv444|p410/.test(m)) return "444"
    return null
}

/**
 * 从像素格式串提取位深（8/10/12），无法识别返回 8（与 ffprobe/mediainfo 惯例一致）
 * 例：yuv420p → 8；yuv420p10le → 10；yuv444p16le → 16（超 12 归 12）
 * @param {string} pixFmt
 * @param {number|string} [explicitBitDepth] 显式位深（mediainfo 的 BitDepth 字段，优先）
 * @returns {8|10|12|16}
 */
export function bitDepthOfPixFmt(pixFmt, explicitBitDepth) {
    const n = Number(explicitBitDepth)
    if (Number.isFinite(n) && n > 0) {
        return n >= 16 ? 16 : n >= 12 ? 12 : n >= 10 ? 10 : 8
    }
    const m = String(pixFmt || "").toLowerCase()
    if (/p16|16le|16be/.test(m)) return 16
    if (/p12|12le|12be/.test(m)) return 12
    if (/p10|10le|10be/.test(m)) return 10
    return 8
}

/**
 * 归一化解码 codec 名（probeLayer 的 codec 参数可能来自 ffprobe/mediainfo 多种写法）
 * @param {string} codec
 * @returns {string|null} 矩阵键（h264/hevc/av1/vp9/mpeg1/mpeg2/mpeg4/vc1/vp8），未知返回 null
 */
export function normalizeDecodeCodec(codec) {
    const c = String(codec || "").toLowerCase()
    if (/h264|avc1|avc/.test(c)) return "h264"
    if (/hevc|h265|hvc1/.test(c)) return "hevc"
    if (/av01|av1/.test(c)) return "av1"
    if (/vp09|vp9/.test(c)) return "vp9"
    if (/vp8/.test(c)) return "vp8"
    if (/mpeg1|mpg1/.test(c)) return "mpeg1"
    if (/mpeg2|mpg2|mp2v/.test(c)) return "mpeg2"
    if (/mpeg4|mp4v|divx|xvid/.test(c)) return "mpeg4"
    if (/vc-?1/.test(c)) return "vc1"
    return null
}

// ---------------------------------------------------------------------------
// 矩阵查询
// ---------------------------------------------------------------------------

/**
 * 查询某代次 NVIDIA GPU 对某解码格式的支持
 * @param {number} generation NVIDIA_GEN 之一
 * @param {string} codec 源编码（如 h264/hevc/av1/vp9，经 normalizeDecodeCodec 归一）
 * @param {string} pixFmt 像素格式串（如 yuv422p10le）
 * @param {number|string} [explicitBitDepth] 显式位深（mediainfo）
 * @returns {"yes"|"no"|"partial"|null} null = 无矩阵数据（不预筛）
 */
export function nvdecSupportOf(generation, codec, pixFmt, explicitBitDepth) {
    const fam = normalizeDecodeCodec(codec)
    if (!fam) return null
    const row = NVDEC_MATRIX[fam]
    if (!row) return null
    // 无位深细分的格式（mpeg/vc1/vp8/av1）用 "any" 行
    let ver = row["any"]
    if (!ver) {
        const chroma = chromaOfPixFmt(pixFmt)
        if (!chroma) return null
        const depth = bitDepthOfPixFmt(pixFmt, explicitBitDepth)
        ver = row[`${chroma}-${depth}bit`] || row[`${chroma}-8bit`] // 16bit 容错归 8/12
    }
    if (!ver) return null
    return ver[generation] ?? null
}

/**
 * 查询某代次 NVIDIA GPU 对某编码格式的支持（仅能力数据，不参与预筛）
 * @param {number} generation NVIDIA_GEN 之一
 * @param {"h264"|"hevc"|"av1"} codecFamily
 * @param {string} format 格式键（yuv420p/yuv422p/yuv444p/lossless/bframe）
 * @returns {"yes"|"no"|"partial"|null}
 */
export function nvencSupportOf(generation, codecFamily, format) {
    const row = NVENC_MATRIX[codecFamily]
    if (!row) return null
    const ver = row[format]
    if (!ver) return null
    return ver[generation] ?? null
}

// ---------------------------------------------------------------------------
// GPU 探测（systeminformation）
// ---------------------------------------------------------------------------

/** 进程内缓存：探测一次即可 */
let cachedGpus = null

/**
 * 探测本机 GPU 列表
 *
 * 基于 systeminformation.graphics()，返回归一化数组，按「独显优先」排序：
 *   [{ vendor, model, generation, driverVersion, bus, primary }]
 * vendor 已归一化为 nvidia/intel/amd/other；generation 仅 NVIDIA 有值（null 表示未知）。
 *
 * ⚠️ 探测失败不影响主流程：任何异常都降级返回 []（调用方据此走「无 GPU 信息」路径）。
 *    systeminformation 在无 GPU 环境（CI/沙箱）或驱动查询失败时均可能抛错。
 *
 * @param {boolean} [force] 忽略缓存强制重新探测
 * @returns {Promise<object[]>}
 */
export async function detectGpus(force = false) {
    if (cachedGpus && !force) return cachedGpus
    try {
        const si = await import("systeminformation").then((m) => m.default ?? m)
        const info = await si.graphics()
        // info.controllers 每项：{ vendor, model, vram, bus, driverVersion, ... }
        const gpus = (info.controllers || [])
            .map((c, idx) => {
                const vendor = normalizeVendor(c.vendor)
                const model = String(c.model || c.vendor || "").trim()
                const generation = vendor === "nvidia" ? nvidiaGenerationOf(model) : null
                return {
                    vendor,
                    model,
                    generation,
                    driverVersion: String(c.driverVersion || "").trim() || null,
                    bus: String(c.bus || "").trim() || null,
                    // systeminformation 不保证顺序，硬伤：集成显卡（核显）vram 极小，
                    // 但 NVIDIA 独显优先于 Intel 核显，用 vendor 权重保证主 GPU 排前
                    primary: idx === 0,
                    score:
                        vendor === "nvidia" ? 3 : vendor === "amd" ? 2 : vendor === "intel" ? 1 : 0,
                }
            })
            .filter((g) => g.model || g.vendor)
        gpus.sort((a, b) => b.score - a.score)
        cachedGpus = gpus.map((g, i) => ({ ...g, primary: i === 0 }))
    } catch (err) {
        log.logWarn("gpu", `GPU detection failed, hardware probe list disabled: ${err.message}`)
        cachedGpus = []
    }
    return cachedGpus
}

/**
 * 归一化 GPU vendor 名（systeminformation 各平台返回不一致）
 * @param {string} raw
 * @returns {"nvidia"|"amd"|"intel"|"other"}
 */
export function normalizeVendor(raw) {
    const v = String(raw || "").toLowerCase()
    if (v.includes("nvidia")) return "nvidia"
    // ⚠️ intel 判断必须在 amd 的 "ati" 匹配之前
    //    （"Intel Corporation" 含 "ati" 子串，先后顺序颠倒会误判为 amd）
    if (v.includes("intel")) return "intel"
    if (
        v.includes("advanced micro devices") ||
        // ⚠️ Windows 上 systeminformation 返回的是型号串（如 "AMD Radeon RX 7900 XTX"、
        //    "AMD Radeon(TM) Graphics"），既不含厂商全称也不等于 "amd"，
        //    缺 "radeon" 匹配时会被判为 other → amf/swdec 层永不入场，
        //    A 卡用户静默失去硬件编码（候选链退化为 [d3d, cpu]）。
        v.includes("radeon") ||
        v === "amd" ||
        /\bati\b/.test(v) ||
        /^ati/.test(v)
    ) {
        return "amd"
    }
    return "other"
}

/**
 * 生成硬件预探测列表（并入 hwdetect 的 caps，供日志/报告/后续决策使用）
 *
 * 以「主 NVIDIA GPU 的代次」为基准：
 *   decode 列出 NVDEC 矩阵该代次全部 (codec, 色度, 位深) 组合及支持状态；
 *   encode 列出 NVENC 矩阵该代次全部 (codec, 格式) 组合及支持状态。
 *   无 NVIDIA GPU（或探测失败）→ 返回 null，调用方不追加 gpuProbe 字段。
 *
 * @param {object[]} gpus detectGpus() 的结果
 * @returns {object|null} { vendor, generation, arch, model, decode: [], encode: [] }
 */
export function gpuProbeList(gpus) {
    const nvidia = (gpus || []).find((g) => g.vendor === "nvidia" && g.generation)
    if (!nvidia) return null
    const gen = nvidia.generation
    const probe = {
        vendor: "nvidia",
        generation: gen,
        arch: NVIDIA_GEN_NAMES[gen],
        model: nvidia.model,
    }
    probe.decode = []
    for (const [fam, rows] of Object.entries(NVDEC_MATRIX)) {
        for (const [fmt, ver] of Object.entries(rows)) {
            const support = ver[gen] ?? null
            if (!support) continue
            const [chroma, depth] = fmt === "any" ? [null, null] : fmt.split("-")
            probe.decode.push({
                codec: fam,
                chroma,
                bitDepth: depth ? Number(depth.replace("bit", "")) : null,
                support,
            })
        }
    }
    probe.encode = []
    for (const [fam, rows] of Object.entries(NVENC_MATRIX)) {
        for (const [format, ver] of Object.entries(rows)) {
            const support = ver[gen] ?? null
            if (!support) continue
            probe.encode.push({ codec: fam, format, support })
        }
    }
    return probe
}

export default {
    NVIDIA_GEN,
    NVIDIA_GEN_NAMES,
    NVENC_MATRIX,
    NVDEC_MATRIX,
    nvidiaGenerationOf,
    chromaOfPixFmt,
    bitDepthOfPixFmt,
    normalizeDecodeCodec,
    normalizeVendor,
    nvdecSupportOf,
    nvencSupportOf,
    detectGpus,
    gpuProbeList,
}
