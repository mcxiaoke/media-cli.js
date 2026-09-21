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
import { candidateTiers, primaryVendor, SWDEC_ENCODERS_BY_VENDOR } from "./hwdetect.js"
import { nvdecSupportOf } from "./gpu.js"

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
    cuda: { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "av1_nvenc" },
    qsv: { h264: "h264_qsv", hevc: "hevc_qsv", av1: "av1_qsv", vp9: "vp9_qsv" },
    amf: { h264: "h264_amf", hevc: "hevc_amf", av1: "av1_amf" },
    d3d: { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: "av1_nvenc" },
    cpu: { h264: "libx264", hevc: "libx265", av1: "libaom-av1", vp9: "libvpx-vp9" },
}
// ⚠️ 硬件编码器可用性（docs/ffmpeg/ffmpeg-guide-hwaccel-compat.md）：
//   NVENC 无 vp9_nvenc、AMF 无 vp9_amf（vp9_amf 仅是解码器）——
//   这两层缺 vp9 键，由 buildEncoderArgs 的缺失 fallback 走 CPU 编码器（libvpx-vp9）。
//   CPU av1 用 libaom-av1：libsvtav1 不随 ffmpeg 主构建分发（本机实测无），
//   文档推荐的 libsvtav1 需自行编译，libaom-av1 是随包可用的保守默认。
//
// swdec 层的字面量兜底行 = CPU 行（拿不到厂商信息时安全回退到原 cpu 层行为，不会更差）；
// 真实取值由 resolveTiers 按主 GPU 厂商注入的 tier.encoderRow 覆盖。
ENCODER_MATRIX.swdec = ENCODER_MATRIX.cpu

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
 * QSV 10bit 源质量钳制（已移除）
 *
 * 历史缺陷：hevc_qsv 在 10bit 4K 源上用 `-q:v`（qscale flag → CQP 码控）低值会
 * rate control 失效、产物暴涨 10 倍（-q:v 18 → 17.8MB，-q:v 28 → 1.7MB）。
 *
 * 实测（2026-09-20，ffmpeg N-125246，4K 10bit 源 @1080p 输出）：
 *   改用 -global_quality（ICQ 码控）后 18/20/24/28 严格单调、无暴涨
 *   （-q:v 18 → 13.6MB vs -global_quality 18 → 1.0MB）。
 * 该缺陷是 **CQP 模式专属**，ICQ 不存在，钳制随之不再需要；
 * 保留钳制反而会把 10bit 源的低质量值静默抬到 24，损害画质。
 */

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
    // swdec 的编码器随厂商变化（nvenc/qsv/amf），不能在这里写死；
    // buildEncoderArgs 改用「实际编码器名」换算（normalizeQualityForEncoder），
    // 此处保留 x264 作为无厂商信息时的兜底（= 原 cpu 层行为）。
    swdec: "x264",
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
 * @param {string} [pixFmt] 源像素格式（10bit+qsv 钳制曾用；ICQ 已修复，保留签名兼容调用方）
 * @returns {number} 该层应使用的质量值
 */
export function normalizeQuality(tierName, codecFamily, crf, _pixFmt) {
    const q = Number(crf) + qualityOffsetOf(tierName, codecFamily, crf)
    return Math.max(0, Math.min(51, Math.round(q)))
}

/**
 * 从编码器名推断输出 codec 族
 * @param {string} encoderName 如 hevc_nvenc / libx265 / h264_qsv / av1_qsv / libaom-av1 / libvpx-vp9
 * @returns {"h264"|"hevc"|"av1"|"vp9"}
 */
export function codecFamilyOf(encoderName) {
    if (!encoderName) return "h264"
    const e = String(encoderName)
    // 顺序敏感：av1/vp9 正则先于 hevc/h264 兜底，
    // 且 "av01"/"vp09" 是 ffprobe 报告 AV1/VP9 时用的短名。
    if (/av1|av01/i.test(e)) return "av1"
    if (/vp9|vp09/i.test(e)) return "vp9"
    return /hevc|h265|x265|hvc1/i.test(e) ? "hevc" : "h264"
}

/**
 * 从编码器名推断「编码器实现」用于质量偏移查表与质量参数分发
 *
 * nvenc/qsv 有标定数据（avc_nvenc / avc_qsv 等），amf 未标定（偏移 0），
 * 其余（libx264/libx265/未知编码器）以 CRF 为基准 → 偏移 0。
 *
 * @param {string} encoderName 如 hevc_nvenc / libx265 / h264_qsv / h264_amf
 * @returns {"nvenc"|"qsv"|"amf"|"x264"}
 */
function encoderCalibImpl(encoderName) {
    const e = String(encoderName || "").toLowerCase()
    if (e.includes("nvenc")) return "nvenc"
    if (e.includes("_qsv")) return "qsv"
    if (e.includes("_amf")) return "amf"
    return "x264"
}

/**
 * 显式编码器（--video-codec / ffargs vc）的质量值换算
 * 按编码器实现选标定偏移，映射到归一化质量：nvenc/qsv 走标定表，amf/x264 偏移 0
 */
function normalizeQualityForEncoder(encoder, codecFamily, quality, pixFmt) {
    const impl = encoderCalibImpl(encoder)
    const tierName = impl === "x264" ? "cpu" : impl // cuda→nvenc 标定 / qsv→qsv / amf→amf
    return normalizeQuality(tierName, codecFamily, quality, pixFmt)
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
 * 优先级（T4 修正，最高优先级的实际影响者是用户显式 encoder）：
 *   1. 用户显式指定编码器（preset.userArgs.videoCodec，来自 --video-codec / ffargs vc）
 *      → 由编码器名解析（hevc_nvenc → hevc）
 *   2. preset.videoCodecFamily（S-4 新增，显式声明，推荐）
 *   3. preset.videoArgs 里的 `-c:v xxx`（向后兼容旧 YAML 预设）
 *   4. 默认 h264
 *
 * @param {object} preset
 * @returns {"h264"|"hevc"}
 */
export function codecFamilyOfPreset(preset) {
    if (!preset) return "h264"
    // 用户显式指定的编码器优先（其族按编码器名推断）
    const forced = preset.userArgs?.videoCodec
    if (forced && forced !== "copy") {
        return codecFamilyOf(forced)
    }
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
 * ⚠️ filterArgs 可能是「选项 + 逗号分隔的尾部独立滤镜」混合串：
 *   cuda 层 = `"interp_algo=lanczos,format=cuda"` —— 逗号前是 scale_cuda 的选项，
 *   逗号后是**独立的 format 滤镜**（保持硬件帧的 no-op）。
 *   因此本函数按逗号拆分：选项段参与拼接，尾部滤镜原样保留。
 *
 * @param {object} tier TIERS 中的一层
 * @param {{w:number,h:number}} size calcLongEdge 的结果
 * @param {string} [swFormat] 位深对齐用的输出**选项**格式（如 "nv12"），见 scaleFormatOverride
 * @returns {string} 如 "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda"
 */
export function buildScaleFilter(tier, size, swFormat) {
    const parts = []
    // size 为 null：只做格式对齐、不做缩放（w/h 缺省 = iw/ih，scale_cuda/scale_qsv 均如此）。
    // 用在场次：任务本身不需要缩放，但 10bit 源 + h264 目标必须换格式（见 scaleFormatOverride），
    // 否则缩波段被整段跳过 → 硬件编码器打不开 10bit 帧 → 白落 libx264。
    if (size) {
        parts.push(`w=${size.w}`, `h=${size.h}`)
    }
    const [opts = "", ...trailing] = String(tier.filterArgs || "").split(",")
    if (opts) parts.push(opts)
    if (swFormat) parts.push(`format=${swFormat}`)
    if (parts.length === 0) return ""
    const head = `${tier.filter}=${parts.join(":")}`
    return trailing.length > 0 ? `${head},${trailing.join(",")}` : head
}

/**
 * scale 滤镜的输出格式覆盖（10bit 源 + h264 目标的位深对齐）
 *
 * ⚠️ 背景（实测：docs/ffmpeg/ffmpeg-hwaccel-support-matrix-20260921.md §3.1）：
 *   h264 硬件编码器（h264_nvenc / h264_qsv）**不吃 10bit 输入** ——
 *   `-h encoder=h264_nvenc` 的格式列表里虽列出 p010le，但驱动不支持，报
 *   `Nothing was written into output file`。于是「10bit 源 + h264 预设」在引入本函数前
 *   是**整链探测失败落 libx264**（即便 NVDEC/QSV 能硬解、NVENC/QSV 能编 8bit h264，
 *   实测 27.7x vs 10.9x 的差距就这样丢掉）。
 *
 * 解法：把 10bit→8bit 的转换放进 scale 的 `format=nv12` **选项**。三种写法的实测差异：
 *   `scale_cuda=w=..:h=..:format=nv12`  输出仍是硬件帧（sw_format 变 nv12，**0 拷贝**）✓
 *   `scale_cuda=..,format=nv12`         独立 format 滤镜，要求出显存 → Impossible to convert
 *   `-pix_fmt nv12`                     同样要求出显存 → 失败
 *   性能实测（4K→1080p h264_nvenc）：`:format=nv12` 16.5x ≈ 0 拷贝基准 16.3x，2 拷贝路径 6.92x。
 *
 * 适用范围：仅 cuda/qsv（硬件帧链路）。d3d/swdec/cpu 层帧本就在系统内存，由 `-pix_fmt` 对齐；
 * hevc 族编码器可直接吃 p010/p012，无需覆盖。
 *
 * @param {object} tier
 * @param {object} [src]
 * @param {string} [src.codecFamily] 输出 codec 族（h264 才需要对齐）
 * @param {string} [src.pixFmt] 源像素格式
 * @param {number|string} [src.bitDepth] 显式位深（mediainfo 的 BitDepth）
 * @returns {string|undefined} "nv12" 或 undefined（不需要覆盖）
 */
export function scaleFormatOverride(tier, { codecFamily = "h264", pixFmt, bitDepth } = {}) {
    if (!tier || (tier.name !== "cuda" && tier.name !== "qsv")) return undefined
    if (codecFamily !== "h264") return undefined
    return bitDepthOf(pixFmt, bitDepth) === "10bit" ? "nv12" : undefined
}

/**
 * 组装完整视频滤镜链（三段式：preFilters → setpts → scale → fps → postFilters）
 *
 * 顺序：preFilters（用户缩放前，如反交错） → setpts（变速） → scale（缩放）
 *      → fps（帧率） → postFilters（用户缩放后，如锐化）
 * 实测依据：docs/S-4-SCALE-PARAMS-20260920.md 2.5.3 节
 *
 * 本函数是滤镜链的**唯一组装源**：探测命令（buildLayerArgs）与真实命令
 * （ffmpeg_build.buildScaleFiltersFromPlan）都基于它生成，杜绝"探测用 tier 组装、
 * 真实用字面量"的错位。探测路径不传 preFilters/postFilters，行为与旧版一致。
 *
 * @param {object} opts
 * @param {object} opts.tier 层级定义
 * @param {{w:number,h:number}} opts.size 目标尺寸
 * @param {number} [opts.speed] 变速倍率（0.5–2.0）
 * @param {number} [opts.framerate] 目标帧率
 * @param {string} [opts.preFilters] 缩放前滤镜段（三段式，可选）
 * @param {string} [opts.postFilters] 缩放后滤镜段（三段式，可选）
 * @param {boolean} [opts.hasScale] 是否生成 scale 段（默认 true；尺寸未达标且无需改帧率时可由调用方关掉）
 * @returns {string}
 */
export function buildVideoFilters({
    tier,
    size,
    speed,
    framerate,
    preFilters = "",
    postFilters = "",
    hasScale = true,
    codecFamily = "h264",
    pixFmt,
    bitDepth,
}) {
    const chain = []
    if (preFilters) {
        chain.push(preFilters)
    }
    const sp = validateSpeed(speed)
    if (sp !== 1) {
        chain.push(`setpts=PTS/${sp}`)
    }
    if (tier.requiresFilter) {
        // 10bit 源 + h264 目标：把位深转换放进 scale 的 format 选项（帧不出显存，
        // 见 scaleFormatOverride）。探测与真实命令共用本函数，保证同构。
        // ⚠️ 需要对齐时**即使不需要缩放也要输出**（size 传 null → 只换格式不做 1:1 重采样之外的
        //   尺寸变化；实测 1:1 成本 ~1%），否则「无需缩放」的任务会漏掉对齐而落回 libx264。
        const swFormat = scaleFormatOverride(tier, { codecFamily, pixFmt, bitDepth })
        if (hasScale || swFormat) {
            const filter = buildScaleFilter(tier, hasScale ? size : null, swFormat)
            if (filter) chain.push(filter)
        }
    }
    if (framerate && framerate > 0) {
        chain.push(`fps=${framerate}`)
    }
    if (postFilters) {
        chain.push(postFilters)
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
/**
 * @param {string} tierName 层名
 * @param {string} codecFamily 输出 codec 族
 * @param {object} [tier] 层对象（含 tier.encoderRow 时优先，用于 swdec 层的厂商编码器行）
 */
export function pickEncoder(tierName, codecFamily = "h264", tier) {
    const matrix = tier?.encoderRow || ENCODER_MATRIX[tierName] || ENCODER_MATRIX.cpu
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
 * @param {string} [opts.bitrateK] 码率，如 "2000K"
 * @param {string} [opts.codecFamily] 输出 codec 族（"h264"|"hevc"）
 * @param {string} [opts.forcedEncoder] 显式指定的编码器名（穿透 ENCODER_MATRIX）
 * @returns {string[]} 参数数组
 */
export function buildEncoderArgs(
    tierName,
    { quality = 24, bitrateK, codecFamily = "h264", pixFmt, forcedEncoder, tier } = {},
) {
    // 显式编码器穿透：跳过 ENCODER_MATRIX，质量按编码器实现换算
    // 矩阵缺失 fallback（ENCODER_MATRIX 缺该层的族键，如 cuda/vp9、amf/vp9）：
    //   该层无该族的硬件编码器 → 回退 CPU 编码器（如 vp9 → libvpx-vp9），
    //   编码用 CPU 但解码仍走该层硬件（层只决定解码路径，见 ENCODER_MATRIX 说明）。
    // tier.encoderRow（swdec 层由 resolveTiers 按厂商注入）优先于静态矩阵行。
    const baseRow = ENCODER_MATRIX[tierName] || ENCODER_MATRIX.cpu
    const familyRow = tier?.encoderRow || baseRow
    const encoder = forcedEncoder || familyRow[codecFamily] || ENCODER_MATRIX.cpu[codecFamily]
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
    switch (impl) {
        case "nvenc":
            // nvenc 专属参数（-tune 范围 h264:1-4 / hevc:1-5，hq 两者都有）
            args.push("-rc", "vbr", "-tune", "hq", "-cq", String(q))
            if (bitrateK) args.push("-bufsize", bitrateK, "-maxrate", bitrateK)
            break
        case "qsv":
            // qsv：用 -global_quality（ICQ 智能恒定质量，官方文档推荐的 quality-based 码控）。
            // -cq 是 NVENC 专属参数，qsv 会静默忽略（三档产物完全相同）；
            // -q:v 走 qscale flag → CQP 固定 QP，可用但 10bit 源低值会 rate control 失效。
            args.push("-global_quality", String(q))
            if (bitrateK) args.push("-b:v", bitrateK, "-maxrate", bitrateK)
            break
        case "amf":
            // amf：qp 系列（本机无 A 卡，未实测；参数依据 docs/ffmpeg/ffmpeg-guide-encoders.md）
            args.push("-qp_i", String(q), "-qp_p", String(q))
            if (bitrateK) args.push("-b:v", bitrateK)
            break
        case "cpu":
        default:
            args.push("-crf", String(q))
            // ⚠️ libaom-av1 / libvpx-vp9 纯 CRF 模式必须 -b:v 0，否则 -crf 无效
            //    （docs/ffmpeg/ffmpeg-guide-encoders.md 11.1「-crf 无效」条目）
            if (!bitrateK && (codecFamily === "av1" || codecFamily === "vp9")) {
                args.push("-b:v", "0")
            }
            if (bitrateK) args.push("-maxrate", bitrateK, "-bufsize", bitrateK)
            break
    }
    // swdec 层：源 10bit 而目标 h264 族时，硬件编码器打不开 10bit 输入
    //   （实测 h264_nvenc：Nothing was written into output file；`-h encoder=h264_nvenc`
    //    虽列出 p010le，但驱动不支持）。
    //   swdec 层帧本来就在系统内存，加 -pix_fmt 只是插一次 CPU 格式转换，无下载代价。
    //   不加则整层探测失败 → 白落到 libx264（实测 27.7x vs 10.9x 的差距就丢在这里）。
    //   hevc 族不需要：hevc_nvenc/hevc_qsv 可直接吃 p010。
    if (
        tierName === "swdec" &&
        !forcedEncoder &&
        codecFamily === "h264" &&
        bitDepthOf(pixFmt) === "10bit"
    ) {
        args.push("-pix_fmt", "yuv420p")
    }
    return args
}

/** 层名 → 编码器实现（与 encoderCalibImpl 对齐；cuda/d3d 都走 NVENC） */
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
    bitDepth,
    forcedEncoder,
}) {
    const inputArgs = buildHwaccelArgs(tier)
    const outputArgs = []
    // codecFamily/pixFmt/bitDepth 用于 scale 的位深对齐（scaleFormatOverride）
    const vf = buildVideoFilters({ tier, size, speed, framerate, codecFamily, pixFmt, bitDepth })
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
    // pixFmt 用于 10bit + qsv 的质量钳制 / swdec 的位深对齐
    // tier 一并传入：swdec 层的编码器行是按厂商注入的（tier.encoderRow），
    // 探测命令与真实命令必须走同一条解析路径，否则探测结论与产物不一致。
    const encArgs = buildEncoderArgs(tier.name, {
        quality,
        bitrateK,
        codecFamily,
        pixFmt,
        forcedEncoder,
        tier,
    })
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
}) {
    const speedKey = speed && speed !== 1 ? speed : ""
    const fpsKey = framerate && framerate > 0 ? framerate : ""
    return `${tierName}|${codec}|${codecFamily}|${pixFmt}|${dimension}|${bitDepth || ""}|${forcedEncoder || ""}|${speedKey}|${fpsKey}`
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
    bitrateK,
    forcedEncoder,
    timeoutMs = 15000,
    useCache = true,
}) {
    const key = probeCacheKey({
        tierName: tier.name,
        codec,
        pixFmt,
        codecFamily,
        dimension: size.w,
        bitDepth,
        forcedEncoder,
        speed,
        framerate,
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
        bitrateK,
        codecFamily,
        pixFmt,
        // ⚠️ bitDepth 必须进探测：mediainfo 的 pixelFormat 不含位深，
        //    缺了它「10bit + h264 目标」不会走 scale 的 format=nv12 对齐，
        //    探测按未对齐的滤镜链跑（会失败）→ 结论与真实命令不一致。
        bitDepth,
        inputPath,
        forcedEncoder,
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
 * 主入口：按层级链选择第一个可用的层
 *
 * @returns {Promise<{tier:object, degraded:boolean, tried:string[]}>}
 */
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
    bitrateK,
    forcedEncoder,
    decodeMode = DecodeMode.AUTO,
    hwaccel,
    strict = false,
}) {
    const size = calcLongEdge(srcW, srcH, dimension)
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
            bitrateK,
            forcedEncoder,
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
            bitrateK,
            forcedEncoder,
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
    scaleFormatOverride,
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
