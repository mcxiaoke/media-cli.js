/*
 * File: preset_schema.js
 * Created: 2026-09-21
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * FFmpeg 预设字段的统一 Schema（单一事实源）。
 *
 * 背景（S-4 重构遗留问题 P1-2）：
 *   preset_loader.js 的 PRESET_FIELDS 白名单此前是硬编码的独立 Set，
 *   缺少新字段（如 videoCodecFamily）时会出现「YAML 里写了能生效、
 *   却报 unknown field 警告」的脱节现象。
 *
 * 本文件把 loader 白名单与 FFmpegPreset 构造器消费的字段收敛到一处：
 *   - preset_loader.js 从本文件导入 PRESET_FIELDS（替换本地硬编码）；
 *   - FFmpegPreset 构造器从本文件消费 construct 字段集；
 *   以后新增字段只需改本文件。
 */

/**
 * 预设字段定义表。
 * 每个键的 value 结构：
 *   - type:      字段值类型（"string" | "number" | "boolean"）
 *   - construct: 是否作为 FFmpegPreset 构造器消费的字段
 *                  （false 表示仅 loader/合并逻辑消费的元信息字段）
 *   - comment:   用途说明
 */
const PRESET_FIELD_DEFS = {
    // ---- 继承与元信息（loader / 合并逻辑消费，不传给构造器）----
    extends: {
        type: "string",
        construct: false,
        comment: "继承的预设名（resolveExtends 递归合并）",
    },
    name: { type: "string", construct: false, comment: "预设名（通常取 YAML key）" },
    description: { type: "string", construct: false, comment: "预设描述" },
    intro: { type: "string", construct: false, comment: "预设简介（格式/编码器速览）" },
    _override: {
        type: "boolean",
        construct: false,
        comment: "显式声明覆盖内置/默认预设（默认禁止隐式同名覆盖）",
    },
    // ---- FFmpegPreset 构造参数 ----
    format: { type: "string", construct: true, comment: "输出容器格式，如 .mp4 / .m4a" },
    type: { type: "string", construct: true, comment: "媒体类型：video / audio" },
    prefix: { type: "string", construct: true, comment: "输出文件前缀" },
    suffix: { type: "string", construct: true, comment: "输出文件后缀（支持 {preset} 等占位符）" },
    audioCodec: { type: "string", construct: true, comment: "音频编码器（aac/libopus/copy 等）" },
    inputArgs: { type: "string", construct: true, comment: "输入参数串" },
    streamArgs: { type: "string", construct: true, comment: "流映射/元数据参数串" },
    outputArgs: {
        type: "string",
        construct: true,
        comment: "输出参数串（如 -movflags +faststart）",
    },
    filters: {
        type: "string",
        construct: true,
        comment:
            "视频滤镜串。支持 {scaleFilter} 占位符（缩放由 tier 层替换）；" +
            "三段式滤镜的中间段（{scaleFilter} 所在位置）",
    },
    pre_filters: {
        type: "string",
        construct: true,
        comment:
            "三段式滤镜的前置段（缩放前执行，如反交错；仅在存在 filters/{scaleFilter} 时生效）",
    },
    post_filters: {
        type: "string",
        construct: true,
        comment: "三段式滤镜的后置段（缩放后执行）",
    },
    output: { type: "string", construct: true, comment: "输出目录" },
    videoBitrate: {
        type: "string",
        construct: true,
        comment:
            "视频码率，严格字符串带单位（如 '233k'、'4M'、'1.5m'），构造时经 parseBitrate 归一为 bps",
    },
    maxBitrate: {
        type: "string",
        construct: true,
        comment:
            "视频峰值码率（严格字符串带单位），随分辨率缩放后作为 -maxrate；缺省由 buildEncoderArgs 取 videoBitrate×1.5",
    },
    videoQuality: {
        type: "number",
        construct: true,
        comment: "视频质量值（CRF/CQ 语义，由 tier 层映射为 -crf/-cq/-global_quality 等）",
    },
    audioBitrate: {
        type: "string",
        construct: true,
        comment:
            "音频码率，严格字符串带单位（如 '128k'、'192k'），构造时经 parseBitrate 归一为 bps",
    },
    audioQuality: { type: "number", construct: true, comment: "音频质量值（VBR）" },
    dimension: { type: "number", construct: true, comment: "目标长边像素（缩放目标）" },
    speed: { type: "number", construct: true, comment: "播放速度倍率（setpts/atempo）" },
    framerate: { type: "number", construct: true, comment: "目标帧率" },
    smartBitrate: { type: "boolean", construct: true, comment: "是否按尺寸自动计算码率" },
    videoCodecFamily: {
        type: "string",
        construct: true,
        comment:
            "输出视频 codec 族：h264 | hevc | av1 | vp9。preset 只声明输出格式，" +
            "具体编码器由 lib/hwaccel.js 按 tier 决定（S-4）",
    },
}

/** 全部合法字段集合（loader 白名单与构造器共用） */
const PRESET_FIELDS = new Set(Object.keys(PRESET_FIELD_DEFS))

/** 构造器消费的字段集合 */
const PRESET_CONSTRUCTOR_FIELDS = new Set(
    Object.entries(PRESET_FIELD_DEFS)
        .filter(([, meta]) => meta.construct)
        .map(([name]) => name),
)

/**
 * 判断字段是否在 Schema 白名单内
 * @param {string} key
 * @returns {boolean}
 */
function isPresetField(key) {
    return PRESET_FIELDS.has(key)
}

/**
 * 获取字段定义
 * @param {string} key
 * @returns {{type: string, construct: boolean, comment: string}|undefined}
 */
function getPresetFieldMeta(key) {
    return PRESET_FIELD_DEFS[key]
}

/**
 * 校验字段值类型是否与 Schema 声明一致
 * @param {string} key
 * @param {*} value
 * @returns {boolean} true 表示存在类型不匹配
 */
function hasPresetTypeMismatch(key, value) {
    const meta = PRESET_FIELD_DEFS[key]
    if (!meta) {
        return false
    }
    if (meta.type === "number") {
        return typeof value !== "number" || Number.isNaN(value)
    }
    return typeof value !== meta.type
}

export {
    PRESET_FIELD_DEFS,
    PRESET_FIELDS,
    PRESET_CONSTRUCTOR_FIELDS,
    isPresetField,
    getPresetFieldMeta,
    hasPresetTypeMismatch,
}
