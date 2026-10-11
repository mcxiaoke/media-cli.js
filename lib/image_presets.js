/*
 * File: image_presets.js
 * Project: mediac
 * Created: 2026-10-11 15:43:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * 图像压缩默认底模参数
 * - 默认最小过滤大小：500 KB（小于此大小的文件跳过）
 * - 默认最大长边宽度：6000 px
 * - 默认输出格式：jpeg
 * - 默认质量：85
 */
export const IMAGE_DEFAULT_OPTS = Object.freeze({
    format: "jpeg",
    quality: 85,
    width: 6000,
    size: 500, // KB
    suffix: "_Z6K",
})

/**
 * 核心预设字典定义
 */
export const PRIMARY_IMAGE_PRESETS = Object.freeze({
    // WebP 系列
    "webp-low": Object.freeze({
        format: "webp",
        quality: 50,
        width: 6000,
        size: 500,
        suffix: "_W50",
        effort: 4,
        description: "WebP 低画质/高压缩率 (Q50, effort 4)",
    }),
    "webp-std": Object.freeze({
        format: "webp",
        quality: 75,
        width: 6000,
        size: 500,
        suffix: "_W75",
        effort: 4,
        smartSubsample: true,
        description: "WebP 标准画质平衡 (Q75, effort 4, smartSubsample)",
    }),
    "webp-high": Object.freeze({
        format: "webp",
        quality: 82,
        width: 6000,
        size: 500,
        suffix: "_W82",
        effort: 5,
        smartSubsample: true,
        description: "WebP 高画质模式 (Q82, effort 5, smartSubsample)",
    }),

    // JPEG 系列
    "jpeg-low": Object.freeze({
        format: "jpeg",
        quality: 65,
        width: 6000,
        size: 500,
        suffix: "_J65",
        mozjpeg: false,
        description: "JPEG 低画质模式 (Q65)",
    }),
    "jpeg-std": Object.freeze({
        format: "jpeg",
        quality: 85,
        width: 6000,
        size: 500,
        suffix: "_J85",
        mozjpeg: true,
        description: "JPEG 标准画质模式 (Q85, mozjpeg 优化)",
    }),
    "jpeg-high": Object.freeze({
        format: "jpeg",
        quality: 90,
        width: 6000,
        size: 500,
        suffix: "_J90",
        mozjpeg: true,
        description: "JPEG 高画质模式 (Q90, mozjpeg 优化)",
    }),
})

/**
 * 全量预设字典（包含快捷短别名）
 */
export const IMAGE_PRESETS = {
    ...PRIMARY_IMAGE_PRESETS,

    // 快捷短别名映射
    "w-low": PRIMARY_IMAGE_PRESETS["webp-low"],
    "w-std": PRIMARY_IMAGE_PRESETS["webp-std"],
    "w-high": PRIMARY_IMAGE_PRESETS["webp-high"],

    "j-low": PRIMARY_IMAGE_PRESETS["jpeg-low"],
    "j-std": PRIMARY_IMAGE_PRESETS["jpeg-std"],
    "j-high": PRIMARY_IMAGE_PRESETS["jpeg-high"],

    "jpg-low": PRIMARY_IMAGE_PRESETS["jpeg-low"],
    "jpg-std": PRIMARY_IMAGE_PRESETS["jpeg-std"],
    "jpg-high": PRIMARY_IMAGE_PRESETS["jpeg-high"],
}

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
