/*
 * File: image_presets.js
 * Project: mediac
 * Created: 2026-10-11 15:43:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * 图像压缩默认底模参数（未指定预设时的全局兜底）
 * - 默认最小过滤大小：500 KB（小于此大小的文件跳过）
 * - 默认最大长边宽度：6000 px
 * - 默认输出格式：jpeg
 * - 默认质量：85
 *
 * 与下方 `_base_*` 预设基类是两种语义：这里是「没有任何预设时的单点默认值」，
 * 基类是「一组预设的公共字段」。两者数值恰好一致，但改动其一不应波及另一方，
 * 故各自写死，不做相互引用。
 */
export const IMAGE_DEFAULT_OPTS = Object.freeze({
    format: "jpeg",
    quality: 85,
    width: 6000,
    size: 500, // KB
    suffix: "_Z6K",
})

/**
 * 图像预设原始定义表（支持 `extends` 继承，机制对齐 ffmpeg 的 presets/default.yaml）
 *
 * 命名规则：
 *   - `_` 前缀的键（`_base_*`）是继承基类，仅供继承，不注册为可用预设
 *   - 其余键为可用预设名，用 `extends` 声明基类后只写自己的差异字段
 *
 * 字段语义（下游消费点）：
 *   - format / quality / width / size / suffix：cmd_compress.js 的 parseCompressOpts
 *   - effort / smartSubsample：仅 WebP 编码消费（lib/media-compress.js 的 sharp.webp）
 *   - mozjpeg：仅 JPEG 编码消费（sharp.jpeg）
 *   后三者未声明时由 parseCompressOpts 的 `?? 默认值` 兜底
 *   （effort 4 / smartSubsample true / mozjpeg true），因此基类只承载该格式族
 *   的恒定项，个别预设的例外（如 webp-high 的 effort 5）再单独覆盖。
 */
const RAW_IMAGE_PRESETS = {
    // WebP 基类：effort 4 / smartSubsample 为 sharp 常规档，high 覆盖 effort 为 5
    _base_webp: {
        format: "webp",
        width: 6000,
        size: 500,
        suffix: "_Z4K",
        effort: 2,
        smartSubsample: true,
    },
    // ---- WebP 系列 ----
    "webp-thumb": {
        extends: "_base_webp",
        quality: 50,
        width: 3200,
        suffix: "_thumb",
        effort: 2,
        description: "WebP thumb",
    },
    "webp-low": {
        extends: "_base_webp",
        quality: 60,
        description: "WebP 低画质/高压缩率 (Q60)",
    },
    "webp-std": {
        extends: "_base_webp",
        quality: 70,
        description: "WebP 标准画质平衡 (Q70)",
    },
    "webp-high": {
        extends: "_base_webp",
        quality: 80,
        effort: 4,
        description: "WebP 高画质模式 (Q80, effort 5, smartSubsample)",
    },

    // ---- JPEG 系列 ----
    // JPEG 基类：mozjpeg 开启，low 单独覆盖为 false
    _base_jpeg: {
        format: "jpeg",
        width: 6000,
        size: 500,
        suffix: "_Z4K",
        mozjpeg: false,
    },
    "jpeg-thumb": {
        extends: "_base_jpeg",
        quality: 60,
        width: 3200,
        suffix: "_thumb",
        description: "JPEG thumb",
    },
    "jpeg-low": {
        extends: "_base_jpeg",
        quality: 70,
        description: "JPEG 低画质模式 (Q70)",
    },
    "jpeg-std": {
        extends: "_base_jpeg",
        quality: 85,
        description: "JPEG 标准画质模式 (Q85)",
    },
    "jpeg-high": {
        extends: "_base_jpeg",
        quality: 90,
        description: "JPEG 高画质模式 (Q90)",
    },
}

/**
 * 快捷别名表：主预设名 → 别名列表
 *
 * 替代原先 9 行「主预设名 → 预设对象」的逐一映射：改名或增删别名只需改这一处，
 * 且别名与主预设天然指向同一份配置，不会出现两份拷贝各自漂移。
 */
const IMAGE_PRESET_ALIASES = {
    "webp-thumb": ["w-thumb", "wt"],
    "webp-low": ["w-low", "wl"],
    "webp-std": ["w-std", "ws"],
    "webp-high": ["w-high", "wh"],
    "jpeg-thumb": ["j-thumb", "jpg-thumb", "jt"],
    "jpeg-low": ["j-low", "jpg-low", "jl"],
    "jpeg-std": ["j-std", "jpg-std", "js"],
    "jpeg-high": ["j-high", "jpg-high", "jh"],
}

/**
 * 递归解析 `extends` 继承链：基类字段打底，本级字段逐个覆盖。
 * `extends` 本身只是继承指令，不进入合并结果。
 *
 * 预设字段均为标量，无需深合并。
 *
 * @param {string} name 预设名（RAW_IMAGE_PRESETS 的键）
 * @param {Set<string>} seen 环检测集合（跨递归共享）
 * @returns {Object} 合并完成的预设对象
 * @throws {Error} 预设名不存在，或继承链成环
 */
function resolveExtends(name, seen = new Set()) {
    if (seen.has(name)) {
        throw new Error(`图像预设循环继承: ${name}`)
    }
    seen.add(name)

    const preset = RAW_IMAGE_PRESETS[name]
    if (!preset) {
        throw new Error(`图像预设不存在: ${name}`)
    }
    if (!preset.extends) {
        return { ...preset }
    }

    const merged = resolveExtends(preset.extends, seen)
    for (const key of Object.keys(preset)) {
        if (key !== "extends") {
            merged[key] = preset[key]
        }
    }
    return merged
}

/**
 * 展开后的完整预设表：RAW_IMAGE_PRESETS 逐条解析并冻结。
 * 模块加载时一次性算完，运行期（含 `--preset` 的 help 文案）只做查表。
 */
const RESOLVED_IMAGE_PRESETS = Object.freeze(
    Object.fromEntries(
        Object.keys(RAW_IMAGE_PRESETS).map((name) => [name, Object.freeze(resolveExtends(name))]),
    ),
)

/**
 * 核心预设字典（`_base_*` 继承基类已剔除，仅含可供 `--preset` 选用的名字）
 */
export const PRIMARY_IMAGE_PRESETS = Object.freeze(
    Object.fromEntries(
        Object.entries(RESOLVED_IMAGE_PRESETS).filter(([name]) => !name.startsWith("_")),
    ),
)

/**
 * 全量预设字典（主预设 + 快捷别名），别名指向与主预设同一份冻结对象
 */
export const IMAGE_PRESETS = Object.freeze(
    Object.fromEntries(
        Object.entries(PRIMARY_IMAGE_PRESETS).flatMap(([name, preset]) => [
            [name, preset],
            ...(IMAGE_PRESET_ALIASES[name] || []).map((alias) => [alias, preset]),
        ]),
    ),
)

/**
 * 校验并解析预设名称
 * @param {string} name - 预设名称或别名
 * @returns {Object|null} 预设配置浅拷贝，未找到返回 null
 */
export function resolveImagePreset(name) {
    if (!name || typeof name !== "string") {
        return null
    }
    const key = name.trim().toLowerCase()
    const preset = IMAGE_PRESETS[key]
    return preset ? { ...preset, name: key } : null
}

/**
 * 获取可用基础预设名称列表
 * @returns {Array<string>}
 */
export function listPrimaryPresetNames() {
    return Object.keys(PRIMARY_IMAGE_PRESETS)
}
