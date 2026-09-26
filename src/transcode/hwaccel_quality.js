/*
 * File: hwaccel_quality.js
 * Created: 2026-09-26
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 硬件加速转码质量标定与 Codec 族解析（纯计算，无外部依赖）
 */

// ─────────────────────────────────────────────────────────────
// VMAF 等值质量偏移（2026-09-23，纯查表，无 IO）
// 数据源：temp/compare/_crf_data.json（gbc01/gbc07 两段 1080p 动画均值，反插值得到）
// ⚠️ 基准模型：**每个 codec 的 CPU 编码器各为自己的 base（=0）**，
//   h264=x264 / hevc=x265 / av1=svtav1 / vp9=libvpx 互不关联；
//   硬件(hw=nvenc/qsv/amf)只在该 codec 内部相对它的 CPU base 加偏移。
//   （不要把所有族都锚到 x264——不同 codec 的 CRF/CQ 刻度没有可比性。）
// 偏移 = 同 codec 内「hw 等效 q − cpu 等效 q」（VMAF 等值反插值）：
//   hw-h264 +7、hw-hevc +5；av1 数据异常（svtav1 顶部饱和，hw 反而略低）→ 取 0 保守；vp9 无标定 → 0。
// 键：`<码控族>-<codec>`，码控族 ∈ cpu|hw，codec ∈ h264|hevc|av1|vp9
// ─────────────────────────────────────────────────────────────
export const VMAF_QUALITY_OFFSET = {
    "cpu-h264": 0, // x264 基准
    "cpu-hevc": 0, // x265 基准
    "cpu-av1": 0, // svtav1 基准
    "cpu-vp9": 0, // libvpx 基准
    "hw-h264": 7, // nvenc/qsv/amf h264
    "hw-hevc": 5, // nvenc/qsv/amf hevc
    // av1 硬件 vs svtav1 在两段素材约 ±0（svtav1 顶部饱和区间不可靠），保守取 0，不再对 x264 统一 +20
    "hw-av1": 0,
    "hw-vp9": 0, // 未标定，保守 0
}

/**
 * 计算跨族质量偏移（VMAF 等值，纯函数）
 *
 * 语义：当把「同一目标观感」从基准族(from)换到目标族(family)时，
 * 该对质量值得加多少（正=调大/更松，负=更紧）。
 * family 键格式 `${impl}-${codec}`，impl ∈ cpu|hw，codec ∈ h264|hevc|av1|vp9。
 *
 * 基准默认：同一个 codec 的 CPU 编码器（from = "cpu-<codec>"，base 恒 0），
 * 硬件只在同 codec 内相对它加偏移。**不要跨 codec 用 x264 当统一基准。**
 *
 * @param {Object} opts
 * @param {string} opts.family  目标族键，如 "hw-hevc"（nvenc/qsv/amf 通用）
 * @param {string} [opts.from]  基准族键，默认 "cpu-h264"（调用方应传与 family 同 codec 的 cpu 族）
 * @param {number} [opts.quality] 可选基准质量值；给定时额外返回换算后的 adjusted
 * @returns {{offset:number, adjusted?:number, family:Object}}
 */
export function calculateOffset({ family, from = "cpu-h264", quality } = {}) {
    const b = (k) => VMAF_QUALITY_OFFSET[k] ?? 0
    const offset = b(family) - b(from)
    const out = { offset }
    if (quality != null) {
        out.adjusted = Math.max(0, Math.min(51, Math.round(quality + offset)))
    }
    return out
}

/**
 * 从编码器名推断输出 codec 族
 * @param {string} encoderName 如 hevc_nvenc / libx265 / h264_qsv / av1_qsv / libsvtav1 / libvpx-vp9
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
export function encoderCalibImpl(encoderName) {
    const e = String(encoderName || "").toLowerCase()
    if (e.includes("nvenc")) return "nvenc"
    if (e.includes("_qsv")) return "qsv"
    if (e.includes("_amf")) return "amf"
    return "x264"
}

/**
 * 显式编码器（--video-codec / ffargs vc）的质量值换算
 * 按「实际编码器实现 + 输出 codec」用 VMAF 等值偏移（calculateOffset）映射到原生质量值
 */
export function normalizeQualityForEncoder(encoder, codecFamily, quality, _pixFmt) {
    // 2026-09-23：按 VMAF 等值偏移（calculateOffset，参考
    //   docs/ffmpeg/ENCODER-QUALITY-OFFSET-REFERENCE-20260923.md）。
    // 基准 = **同一 codec 的 CPU 编码器**（x264/x265/svtav1/libvpx 各自 base=0），
    // 硬件(hw)只在该 codec 内部相对它的 CPU base 加偏移（hw-h264 +7 / hw-hevc +5）。
    // 不同 codec 的 CRF/CQ 刻度互不关联，**不要跨 codec 用 x264 当统一基准**。
    const impl = encoderCalibImpl(encoder) // nvenc|qsv|amf|x264
    const implGroup = impl === "x264" ? "cpu" : "hw"
    const family = `${implGroup}-${codecFamily}`
    return calculateOffset({ family, from: `cpu-${codecFamily}`, quality }).adjusted ?? 0
}

/**
 * 解析 preset 的输出 codec 族（推荐的唯一入口）
 *
 * 优先级:
 *   1. 用户显式指定编码器（preset.userArgs.videoCodec，来自 --video-codec / ffargs vc）
 *      → 由编码器名解析（hevc_nvenc → hevc）
 *   2. preset.videoCodecFamily（显式声明，推荐）
 *   3. 默认 h264
 *
 * @param {object} preset
 * @returns {"h264"|"hevc"|"av1"|"vp9"}
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
    return "h264"
}
