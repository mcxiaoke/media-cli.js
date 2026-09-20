/*
 * File: hwaccel.js
 * Created: 2026-09-20
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * S-4 硬件加速分层与缩放参数（草稿）
 *
 * 设计依据：
 *   docs/S-4-HWACCEL-PLAN-v2-20260920.md   （硬件加速分层方案）
 *   docs/S-4-SCALE-PARAMS-20260920.md      （缩放参数方案，含实测）
 *
 * 实测环境：Windows 10 + RTX 4070 + Intel UHD 750
 *   验证脚本：research/hwtest/run_dimension_verify.py（231 项）
 *             research/hwtest/run_noup_fps_speed.py（34 项）
 *
 * ⚠️ 本文件是草稿，尚未接入 cmd/cmd_ffmpeg.js。
 *    对接点见文件末尾「对接说明」。
 */

import { execa } from "execa"
import which from "which"
import * as log from "./debug.js"
import { candidateTiers } from "./hwdetect.js"

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 支持的解码模式 */
export const DecodeMode = {
    AUTO: "auto", // 按层级链逐层探测降级（默认）
    GPU: "gpu", // 只用显式指定的层，失败即硬失败
    CPU: "cpu", // 直接走 Tier 4，不探测
}

/** 显式指定的硬件加速器（对应 --hwaccel 参数） */
export const HwAccel = {
    CUDA: "cuda",
    QSV: "qsv",
    AMF: "amf",
    D3D11VA: "d3d11va",
    D3D12VA: "d3d12va",
    DXVA2: "dxva2",
    VULKAN: "vulkan",
    AUTO: "auto",
}

/** speed 允许范围（产品决策：只允许 0.5–2.0） */
export const SPEED_MIN = 0.5
export const SPEED_MAX = 2.0

/**
 * 编码器矩阵：[层][输出 codec 族] → 编码器名
 *
 * ⚠️ 关键设计（曾犯错，务必保留此说明）：
 *   输出编码器由 **preset 决定**（preset.videoArgs 里写的 `-c:v xxx`），
 *   与 **输入位深无关**。
 *
 *   输入位深只影响「哪一层能解码」——那是 probeLayer 的职责。
 *   `h264 + 10bit` 只是 NVENC **不能硬解**，换一层解码即可，
 *   与输出用什么编码器毫无关系。
 *
 *   此前错误地按输入位深选编码器（10bit → hevc_nvenc），导致
 *   `hevc_2kt` 预设遇到 8bit 输入时输出成了 `h264_nvenc`。
 */
const ENCODER_MATRIX = {
    cuda: { h264: "h264_nvenc", hevc: "hevc_nvenc" },
    qsv: { h264: "h264_qsv", hevc: "hevc_qsv" },
    amf: { h264: "h264_amf", hevc: "hevc_amf" },
    d3d: { h264: "h264_nvenc", hevc: "hevc_nvenc" },
    cpu: { h264: "libx264", hevc: "libx265" },
}

/**
 * 质量值归一化偏移表（3 段阶梯）
 *
 * 以 x264/x265 的 CRF 为基准，各实现做阶梯偏移 —— 同一数值在三家**不等效**：
 * 实测同一 `-cq 28` 与 `-crf 28`，nvenc 产物是 x264 的 1.45 倍。
 *
 * 标定依据：495 次编码（8K 8bit / 4K 10bit / 1080p 8bit 真实素材，
 *          11 个质量点 × 3 轮取中位数），见
 *          docs/ENCODER-QUALITY-CALIBRATION-20260920.md
 *
 * 格式：[crf<=26, crf28-34, crf>=36]
 *
 * 逐点实测数据（备忘）：
 *   crf    avc_nvenc  avc_qsv  hevc_nvenc  hevc_qsv
 *   18     +5         +2       +6          +0
 *   20     +5         +2       +6          -1
 *   22     +5         +2       +6          -1
 *   24     +5         +2       +6          -1
 *   26     +5         +2       +6          -2
 *   28     +4         +3       +6          -1
 *   30     +4         +3       +8          -1
 *   32     +4         +3       +6          -1
 *   34     +3         +3       +4          -1
 *   36     +2         +2       +2          +0
 *   38     +0         +0       +0          -1
 *
 * 规律：低质量区偏移大（+5~+6），高质量区趋近 0（各编码器都接近视觉无损）。
 * 注意：HEVC 偏移普遍比 AVC 大 1~2 档（x265 的 CRF 语义比 x264 更严格）。
 *
 * ⚠️ 已知局限（标定数据得出，未进一步细分）：
 *   - 偏移随**内容复杂度**变化：实拍/高动态（bilibili 8K/4K）+6，
 *     简单动画（Big Buck Bunny 1080p）+4。表中取跨素材中位数，
 *     对简单内容会略微过度压缩（实测偏差 ~27%），对实拍内容准确。
 *   - AMF 未标定（本机无 A 卡），回退偏移 0。
 *   - 判据仅用产物字节数，未做 VMAF/PSNR 客观质量评估。
 *   - 如需更准，可按分辨率/复杂度分档，或改逐点查表（数据见上方备忘）。
 */
const QUALITY_OFFSET = {
    avc_nvenc: [5, 4, 1],
    avc_qsv: [2, 3, 1],
    hevc_nvenc: [6, 6, 1],
    hevc_qsv: [-1, -1, 0],
}

/**
 * QSV 处理 10bit 源时的质量下限
 *
 * 实测：hevc_qsv 在 10bit 4K 源上，低 -q:v 会触发 rate control 失效，
 * 产物反而暴涨（-q:v 18 → 17.8MB，-q:v 28 → 1.7MB）。
 * 同参数在 8bit 源上正常（1.6MB）。属硬编码器行为，无法通过参数修复。
 */
const QSV_10BIT_MIN_Q = 24

/**
 * 标定表键 → 层名的映射
 *
 * 标定是按「编码器实现」做的（nvenc/qsv/x264），而运行时的层名是
 * cuda/qsv/amf/d3d/cpu。这里做一次转换：
 *   cuda / d3d → nvenc（两者都用 NVENC 编码器）
 *   qsv        → qsv
 *   amf        → amf（未标定，回退 0）
 *   cpu        → x264/x265（基准，偏移 0）
 */
const TIER_TO_CALIB_KEY = {
    cuda: "nvenc",
    d3d: "nvenc",
    qsv: "qsv",
    amf: "amf",
    cpu: "x264", // 基准，表中无此键 → 偏移 0
}

/**
 * 计算某层某 codec 族的质量偏移
 *
 * ⚠️ 两处键名映射（都曾踩坑，导致偏移恒为 0）：
 *   1. codecFamily: "h264" → 标定表的 "avc"
 *   2. tierName:    "cuda"/"d3d" → 标定表的 "nvenc"
 *
 * @param {string} tierName cuda|qsv|amf|d3d|cpu
 * @param {"h264"|"hevc"} codecFamily
 * @param {number} crf 基准质量值（x264/x265 CRF 语义）
 * @returns {number}
 */
export function qualityOffsetOf(tierName, codecFamily, crf) {
    const fam = codecFamily === "h264" ? "avc" : codecFamily
    const impl = TIER_TO_CALIB_KEY[tierName] || tierName
    const key = `${fam}_${impl}`
    const row = QUALITY_OFFSET[key]
    if (!row) return 0
    if (crf <= 26) return row[0]
    if (crf <= 34) return row[1]
    return row[2]
}

/**
 * 质量值归一化：把 preset 声明的 CRF 换算成该层的等效质量值
 *
 * @param {string} tierName
 * @param {"h264"|"hevc"} codecFamily
 * @param {number} crf
 * @param {string} [pixFmt] 源像素格式（用于 10bit 钳制）
 * @returns {number} 该层应使用的质量值
 */
export function normalizeQuality(tierName, codecFamily, crf, pixFmt) {
    let q = Number(crf) + qualityOffsetOf(tierName, codecFamily, crf)
    // 10bit + qsv 钳制
    if (tierName === "qsv" && bitDepthOf(pixFmt) === "10bit") {
        q = Math.max(QSV_10BIT_MIN_Q, q)
    }
    return Math.max(0, Math.min(51, Math.round(q)))
}

/**
 * 从编码器名推断输出 codec 族
 * @param {string} encoderName 如 hevc_nvenc / libx265 / h264_qsv
 * @returns {"h264"|"hevc"}
 */
export function codecFamilyOf(encoderName) {
    if (!encoderName) return "h264"
    return /hevc|h265|x265|hvc1/i.test(String(encoderName)) ? "hevc" : "h264"
}

/**
 * 从 preset 的 videoArgs 串解析输出 codec 族
 * 例："-c:v hevc_nvenc -rc vbr ..." → "hevc"
 * @param {string} videoArgs
 * @returns {"h264"|"hevc"}
 */
export function codecFamilyOfArgs(videoArgs) {
    if (!videoArgs) return "h264"
    const m = String(videoArgs).match(/-c:v\s+(\S+)/)
    return codecFamilyOf(m ? m[1] : "")
}

/**
 * 解析 preset 的输出 codec 族（推荐的唯一入口）
 *
 * 优先级：
 *   1. preset.videoCodecFamily（S-4 新增，显式声明，推荐）
 *   2. preset.videoArgs 里的 `-c:v xxx`（向后兼容旧 YAML 预设）
 *   3. 默认 h264
 *
 * @param {object} preset
 * @returns {"h264"|"hevc"}
 */
export function codecFamilyOfPreset(preset) {
    if (!preset) return "h264"
    if (preset.videoCodecFamily) {
        return codecFamilyOf(preset.videoCodecFamily)
    }
    return codecFamilyOfArgs(preset.videoArgs)
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
// 尺寸计算
// ---------------------------------------------------------------------------

/**
 * 对齐到偶数（四舍五入后取偶）
 *
 * ⚠️ 实测结论：ffmpeg 的 scale 滤镜用「四舍五入」而非向下取整。
 *    1920x1080 → D=1080 时 607.5 取 608（不是 606）
 *    4096x2160 → D=1080 时 569.53 取 570（不是 568）
 *    因此这里必须用 Math.round，否则与滤镜实际行为不一致。
 */
export function toEven(x) {
    const v = Math.round(x)
    return v - (v % 2)
}

/**
 * 按「长边 = dimension」计算输出尺寸
 *
 * 规则：
 *   1. dimension 是长边，短边按原始宽高比推导
 *   2. 禁止放大：目标长边 = min(D, 源长边)
 *   3. 宽高均对齐到偶数（四舍五入，与 ffmpeg scale 一致）
 *
 * @param {number} srcW 输入宽
 * @param {number} srcH 输入高
 * @param {number} dimension 目标长边
 * @returns {{w:number,h:number}}
 */
export function calcLongEdge(srcW, srcH, dimension) {
    if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
        throw new Error(`calcLongEdge: invalid source size ${srcW}x${srcH}`)
    }
    if (!Number.isFinite(dimension) || dimension <= 0) {
        throw new Error(`calcLongEdge: invalid dimension ${dimension}`)
    }
    // 禁止放大：目标长边不超过源长边
    const target = Math.min(dimension, Math.max(srcW, srcH))
    if (srcW >= srcH) {
        // 横屏 / 正方形：宽是长边
        return { w: toEven(target), h: toEven((srcH * target) / srcW) }
    }
    // 竖屏：高是长边
    return { w: toEven((srcW * target) / srcH), h: toEven(target) }
}

/**
 * 判断像素格式位深
 *
 * ⚠️ 两个 provider 的 pixelFormat 语义完全不同（实测）：
 *   ffprobe  : "yuv420p" / "yuv420p10le" / "yuv422p10le"  ← 位深**内嵌**在字符串里
 *   mediainfo: "YUV4:2:0" / "YUV4:2:2"                    ← 位深**不在**字符串里，
 *                                                            只在独立的 BitDepth 字段
 *
 * 因此只看 pixelFormat 字符串在 mediainfo 下会恒判 8bit（真实回归）：
 *   hevc 10bit 源 → pixelFormat="YUV4:2:0" → 误判 8bit → 选 h264_nvenc → 编码失败
 *
 * @param {string} pixFmt 像素格式串
 * @param {number|string} [explicitBitDepth] 显式位深（mediainfo 的 BitDepth 字段）
 * @returns {"8bit"|"10bit"}
 */
export function bitDepthOf(pixFmt, explicitBitDepth) {
    // 优先用显式位深（mediainfo 提供，ffprobe 通常没有）
    const n = Number(explicitBitDepth)
    if (Number.isFinite(n) && n > 0) {
        return n >= 9 ? "10bit" : "8bit"
    }
    if (!pixFmt) return "8bit"
    // 退回解析像素格式串（ffprobe 路径）
    // yuv420p10le / yuv422p10le / p010le / gray12le / yuv444p16le 等
    return /(p10|p12|p16|10le|12le|16le|10be|12be|16be)/i.test(pixFmt) ? "10bit" : "8bit"
}

// ---------------------------------------------------------------------------
// 滤镜串生成
// ---------------------------------------------------------------------------

/**
 * 校验 speed 范围
 * 产品决策：只允许 0.5–2.0，因此 atempo 无需链式拆分
 * （atempo 原生范围为 [0.5, 100]，0.5 恰好是下限）
 *
 * 注意：0 与 undefined/null 均表示「不变速」，返回 1（保持原速）。
 * 现有 CLI 的 --speed 默认值是 0，必须视为不变速，否则会误报范围错误。
 */
export function validateSpeed(speed) {
    if (speed === undefined || speed === null || speed === 0 || speed === 1) return 1
    const v = Number(speed)
    if (!Number.isFinite(v)) {
        throw new Error(`invalid speed: ${speed}`)
    }
    if (v < SPEED_MIN || v > SPEED_MAX) {
        throw new Error(`speed out of range [${SPEED_MIN}, ${SPEED_MAX}]: ${speed}`)
    }
    return v
}

/**
 * 生成缩放滤镜串
 *
 * @param {object} tier TIERS 中的一层
 * @param {{w:number,h:number}} size calcLongEdge 的结果
 * @returns {string} 如 "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda"
 */
export function buildScaleFilter(tier, size) {
    const parts = [`w=${size.w}`, `h=${size.h}`]
    if (tier.filterArgs) {
        parts.push(tier.filterArgs)
    }
    return `${tier.filter}=${parts.join(":")}`
}

/**
 * 组装完整视频滤镜链
 *
 * 顺序：setpts（变速） → scale（缩放） → fps（帧率）
 * 实测依据：docs/S-4-SCALE-PARAMS-20260920.md 2.5.3 节
 *
 * @param {object} opts
 * @param {object} opts.tier 层级定义
 * @param {{w:number,h:number}} opts.size 目标尺寸
 * @param {number} [opts.speed] 变速倍率（0.5–2.0）
 * @param {number} [opts.framerate] 目标帧率
 * @returns {string}
 */
export function buildVideoFilters({ tier, size, speed, framerate }) {
    const chain = []
    const sp = validateSpeed(speed)
    if (sp !== 1) {
        chain.push(`setpts=PTS/${sp}`)
    }
    if (tier.requiresFilter) {
        chain.push(buildScaleFilter(tier, size))
    }
    if (framerate && framerate > 0) {
        chain.push(`fps=${framerate}`)
    }
    return chain.join(",")
}

/**
 * 组装音频滤镜串（变速）
 *
 * 因 speed 限制在 [0.5, 2.0]，与 atempo 原生范围 [0.5, 100] 兼容，
 * 无需链式拆分。
 *
 * @param {number} speed
 * @returns {string} 如 "atempo=1.5"，speed=1 时返回空串
 */
export function buildAudioFilters(speed) {
    const sp = validateSpeed(speed)
    return sp === 1 ? "" : `atempo=${sp}`
}

/**
 * 是否需要 complexFilter
 * 当同时存在视频变速与音频变速时必须用 complexFilter 保证音画同步
 */
export function needsComplexFilter({ speed, hasAudio }) {
    return validateSpeed(speed) !== 1 && hasAudio
}

// ---------------------------------------------------------------------------
// 参数组装
// ---------------------------------------------------------------------------

/**
 * 选择编码器
 *
 * ⚠️ 必须同时传入 pixelFormat 与 bitDepth：
 *   mediainfo 的 pixelFormat="YUV4:2:0" 不含位深信息，只有 bitDepth 字段可靠。
 *   只传 pixelFormat 会导致 10bit 源被误选为 h264 编码器。
 *
 * @param {string} tierName 层名
 * @param {string} pixFmt 源像素格式
 * @param {number|string} [bitDepth] 显式位深（mediainfo 的 BitDepth）
 */
export function pickEncoder(tierName, codecFamily = "h264") {
    const matrix = ENCODER_MATRIX[tierName] || ENCODER_MATRIX.cpu
    return matrix[codecFamily] || matrix.h264
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
 * ⚠️ 实测陷阱：质量参数**不是通用的**，写错会被静默忽略：
 *   nvenc  : -cq {q}        ✅ 生效（产物大小随 q 单调变化）
 *   qsv    : -cq / -global_quality  ❌ **被静默忽略**（三档产物大小完全相同）
 *            -q:v {q}       ✅ 生效（1..51，越大越小）
 *   libx264: -crf {q}       ✅ 生效
 *   amf    : -qp_i/-qp_p    （本机无 A 卡，未实测）
 *
 * 另有 nvenc 专属参数（-rc vbr -tune hq -spatial-aq 等）QSV/AMF 不接受，
 * 因此必须**整段替换**编码器参数块，不能只换编码器名。
 *
 * @param {string} tierName 层名
 * @param {object} opts
 * @param {number} opts.quality 质量值
 * @param {string} [opts.bitrateK] 码率，如 "2000K"
 * @returns {string[]} 参数数组
 */
export function buildEncoderArgs(
    tierName,
    { quality = 24, bitrateK, codecFamily = "h264", pixFmt } = {},
) {
    const matrix = ENCODER_MATRIX[tierName] || ENCODER_MATRIX.cpu
    const encoder = matrix[codecFamily] || matrix.h264
    // 质量值归一化：preset 声明的是 CRF 语义，各层需换算成自己的等效值
    const q = normalizeQuality(tierName, codecFamily, quality, pixFmt)
    const args = ["-c:v", encoder]
    switch (tierName) {
        case "cuda":
        case "d3d":
            // nvenc 专属参数（-tune 范围 h264:1-4 / hevc:1-5，hq 两者都有）
            args.push("-rc", "vbr", "-tune", "hq", "-cq", String(q))
            if (bitrateK) args.push("-bufsize", bitrateK, "-maxrate", bitrateK)
            break
        case "qsv":
            // qsv：必须用 -q:v，-cq/-global_quality 会被静默忽略
            args.push("-q:v", String(q))
            if (bitrateK) args.push("-b:v", bitrateK, "-maxrate", bitrateK)
            break
        case "amf":
            // amf：qp 系列（未实测，本机无 A 卡）
            args.push("-qp_i", String(q), "-qp_p", String(q))
            if (bitrateK) args.push("-b:v", bitrateK)
            break
        case "cpu":
        default:
            args.push("-crf", String(q))
            if (bitrateK) args.push("-maxrate", bitrateK, "-bufsize", bitrateK)
            break
    }
    return args
}

/**
 * 依据层与位深选择编码器参数块
 * 10bit 源强制 hevc 编码器（h264 编码器对 10bit 全线失败）
 *
 * @param {string} tierName
 * @param {string} pixFmt
 * @param {object} opts
 * @returns {string[]}
 */
export function buildEncoderArgsForSource(tierName, pixFmt, opts = {}) {
    // ⚠️ pixFmt/bitDepth 不参与编码器选择，仅为保持调用签名兼容。
    //    输出编码器族由 preset 决定，见 ENCODER_MATRIX 上方说明。
    return buildEncoderArgs(tierName, opts)
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
 * @returns {{inputArgs:string[], outputArgs:string[], useComplex:boolean, encoder:string}}
 */
export function buildLayerArgs({
    tier,
    size,
    speed,
    framerate,
    hasAudio = true,
    quality = 24,
    bitrateK,
    codecFamily = "h264",
    pixFmt,
}) {
    const inputArgs = buildHwaccelArgs(tier)
    const outputArgs = []
    const vf = buildVideoFilters({ tier, size, speed, framerate })
    const af = buildAudioFilters(speed)
    const useComplex = needsComplexFilter({ speed, hasAudio })

    if (useComplex) {
        // 音画同步变速：用 complexFilter
        const vChain = vf ? `[0:v]${vf}[v]` : "[0:v]null[v]"
        const aChain = `[0:a]${af}[a]`
        outputArgs.push("-filter_complex", `${vChain};${aChain}`)
        outputArgs.push("-map", "[v]", "-map", "[a]")
    } else {
        if (vf) outputArgs.push("-vf", vf)
        if (af) outputArgs.push("-af", af)
    }

    // 编码器参数由 buildEncoderArgs 统一生成（按层 + 输出 codec 族）
    // pixFmt 用于 10bit + qsv 的质量钳制
    const encArgs = buildEncoderArgs(tier.name, { quality, bitrateK, codecFamily, pixFmt })
    outputArgs.push(...encArgs)
    const encoder = encArgs[1]
    return { inputArgs, outputArgs, useComplex, encoder }
}

/**
 * 组装探测用的完整参数（探测即干跑，与真实命令同构）
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
        "1",
        "-f",
        "null",
        "-",
    ]
}

// ---------------------------------------------------------------------------
// 探测与降级
// ---------------------------------------------------------------------------

/** 探测缓存（进程内） */
const probeCache = new Map()

/**
 * 探测缓存键
 * 按 (层, 源编码, 位深, 像素格式, 尺寸档) 缓存，不按文件路径
 * 依据：docs/S-4-HWACCEL-PLAN-v2-20260920.md 4.4 节
 */
export function probeCacheKey({ tierName, codec, pixFmt, codecFamily, dimension }) {
    return `${tierName}|${codec}|${codecFamily}|${pixFmt}|${dimension}`
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
 *      -frames:v 1、输出改为 -f null -
 *   2. 判定只看退出码，不解析 stderr
 *      （实测同一失败在不同版本退出码不同：171 / 69 / 127）
 *   3. 必须带超时：ffmpeg 9 的 -hwaccel auto 对无硬解素材会挂死
 *
 * @returns {Promise<boolean>}
 */
export async function probeLayer({
    ffmpegPath,
    inputPath,
    tier,
    size,
    pixFmt,
    codec = "",
    codecFamily = "h264",
    speed,
    framerate,
    hasAudio,
    quality,
    timeoutMs = 15000,
    useCache = true,
}) {
    const key = probeCacheKey({
        tierName: tier.name,
        codec,
        pixFmt,
        codecFamily,
        dimension: size.w,
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
        codecFamily,
        pixFmt,
        inputPath,
    })
    const full = [bin, ...args]

    let ok
    try {
        const res = await execa(full[0], full.slice(1), {
            reject: false,
            timeout: timeoutMs,
            cleanup: true,
        })
        // 只看退出码；超时由 execa 抛错或返回非 0
        ok = res.exitCode === 0
    } catch (err) {
        // 超时 / 进程异常 → 判定不可用
        log.debug(`probeLayer ${tier.name} failed: ${err.message}`)
        ok = false
    }

    if (useCache) probeCache.set(key, ok)
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
    return names.map((n) => {
        const t = TIERS.find((x) => x.name === n)
        if (!t) throw new Error(`resolveTiers: unknown tier '${n}'`)
        return t
    })
}

/**
 * 主入口：按层级链选择第一个可用的层
 *
 * @returns {Promise<{tier:object, degraded:boolean, tried:string[]}>}
 */
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
    codec,
    codecFamily = "h264",
    dimension,
    speed,
    framerate,
    hasAudio,
    quality,
    decodeMode = DecodeMode.AUTO,
    hwaccel,
}) {
    const size = calcLongEdge(srcW, srcH, dimension)
    const tiers = resolveTiers({ caps, decodeMode, hwaccel })
    const tried = []
    const failures = []

    for (const tier of tiers) {
        tried.push(tier.name)
        const ok = await probeLayer({
            ffmpegPath: ffmpegPath || caps.ffmpegPath,
            inputPath,
            tier,
            size,
            pixFmt,
            codec,
            codecFamily,
            speed,
            framerate,
            hasAudio,
            quality,
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
    const cpuTier = TIERS.find((t) => t.name === "cpu")
    return {
        tier: cpuTier,
        size,
        degraded: true,
        tried,
        reason: `all tiers failed (${failures.join(", ")}); falling back to cpu for real attempt`,
    }
}

export default {
    DecodeMode,
    HwAccel,
    TIERS,
    SPEED_MIN,
    SPEED_MAX,
    calcLongEdge,
    toEven,
    bitDepthOf,
    qualityOffsetOf,
    normalizeQuality,
    validateSpeed,
    buildScaleFilter,
    buildVideoFilters,
    buildAudioFilters,
    needsComplexFilter,
    pickEncoder,
    buildHwaccelArgs,
    buildLayerArgs,
    buildProbeArgs,
    probeLayer,
    resolveTiers,
    selectTier,
    probeCacheKey,
    clearProbeCache,
}

// ---------------------------------------------------------------------------
// 对接说明（尚未实施）
// ---------------------------------------------------------------------------
//
// 1. cmd/cmd_ffmpeg.js 的 canUseCUDADecoder()（约 1957-2005 行）
//    → 替换为 selectTier()。现有缺陷：
//      a) 探测只覆盖解码，真实命令还含滤镜与编码器 → ffv1 漏判
//      b) 失败判定只匹配两个错误串 → 其它错误串误判为可用
//      c) 缓存按 inputPath → 1000 个文件 1000 次探测
//
// 2. lib/ffmpeg_presets.js 的 filters 字段
//    → 改为 {scaleFilter} 占位符，由 buildScaleFilter() 生成。
//    注意现有写法用了 force_original_aspect_ratio=decrease，
//    该写法「会放大」且 scale_qsv 不支持，需一并替换。
//
// 3. 现有 PRESET_HEVC_SPEED 的 complexFilter（ffmpeg_presets.js:364）
//    → 可改用 buildVideoFilters() + buildAudioFilters() 组合生成。
//    注意其 scale_cuda 表达式同样需要改为预计算的显式尺寸。
//
// 4. 音频降级（libfdk_aac 缺失 → native aac）
//    → 见 v2 方案 4.7 节，本草稿未实现，需另加。
//
// 5. i18n：新增降级原因文案，需补 lib/i18n.js 键。
//
// 未完成项：
//   - AMF 路径未实测（本机无 A 卡），参数来自 `-h filter=vpp_amf`
//   - vendor 检测（显卡厂商）未实现，需读 ffmpeg -encoders 或系统信息
//   - hasAudio 检测未实现，需从 mediainfo 取
//   - 探测超时值 15000ms 为经验值，未在长素材上压测
