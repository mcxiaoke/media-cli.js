/*
 * Project: mediac
 * Created: 2026-02-05 16:34:30
 * Modified: 2026-02-05 16:34:30
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
/**
 * 通用键值对解析器（支持别名映射和类型校验）
 * 配置驱动，易于扩展新参数
 */

// query-parser.mjs

/**
 * 解析错误类
 */
export class QueryParseError extends Error {
    constructor(message, code) {
        super(message)
        this.name = "QueryParseError"
        this.code = code
    }
}

/**
 * 通用键值对解析器（支持别名映射和类型校验）
 * 配置驱动，易于扩展新参数
 */
export class QueryParser {
    /**
     * @param {Object} config - 配置对象
     * @param {Object} config.aliases - 别名映射 { 别名: 标准键 }
     * @param {Object} config.types - 类型配置 { 标准键: 'number' | 'string' }
     * @param {Array<string>} config.required - 必填的标准键数组（可选）
     */
    constructor(config = {}) {
        this.aliases = config.aliases || {}
        this.types = config.types || {}
        this.required = config.required || []

        // 反向映射：标准键 -> 所有别名（用于错误提示）
        this.keyToAliases = {}
        for (const [alias, key] of Object.entries(this.aliases)) {
            if (!this.keyToAliases[key]) {
                this.keyToAliases[key] = []
            }
            this.keyToAliases[key].push(alias)
        }
    }

    /**
     * 解析字符串
     * @param {string} str - 要解析的字符串
     * @returns {Object} 解析结果（标准键名）
     * @throws {QueryParseError}
     */
    parse(str) {
        // 初始化结果对象（所有标准键默认为 undefined）
        const allKeys = new Set(Object.values(this.aliases))
        const result = {}
        for (const key of allKeys) {
            result[key] = undefined
        }
        if (!str || typeof str !== "string") {
            // throw new QueryParseError("输入必须是字符串", "INVALID_INPUT")
            return result
        }

        const seenKeys = new Set()
        const pairs = str.split(",")

        for (const pair of pairs) {
            const { key: rawKey, value } = this._splitPair(pair)

            const normalizedKey = this.aliases[rawKey]
            if (!normalizedKey) {
                const allowed = Object.entries(this.keyToAliases)
                    .map(([_, aliases]) => aliases.join("/"))
                    .join(", ")
                throw new QueryParseError(
                    `未知的键: "${rawKey}"，允许的键: ${allowed}`,
                    "UNKNOWN_KEY",
                )
            }

            if (seenKeys.has(normalizedKey)) {
                const aliases = this.keyToAliases[normalizedKey].join("/")
                throw new QueryParseError(
                    `重复的键: "${rawKey}"（${aliases} 已设置过）`,
                    "DUPLICATE_KEY",
                )
            }

            const typedValue = this._convertType(rawKey, normalizedKey, value)
            result[normalizedKey] = typedValue
            seenKeys.add(normalizedKey)
        }

        // 检查必填项
        for (const reqKey of this.required) {
            if (result[reqKey] === undefined) {
                throw new QueryParseError(`缺少必填参数: ${reqKey}`, "MISSING_REQUIRED")
            }
        }

        return result
    }

    _splitPair(pair) {
        if (!pair.includes("=")) {
            throw new QueryParseError(`非法格式: "${pair}"，缺少等号`, "INVALID_FORMAT")
        }

        const [key, ...valueParts] = pair.split("=")
        const value = valueParts.join("=")

        if (!key) {
            throw new QueryParseError(`非法格式: "${pair}"，键不能为空`, "INVALID_FORMAT")
        }

        if (valueParts.length === 0) {
            throw new QueryParseError(`非法格式: "${pair}"，值不能为空`, "INVALID_FORMAT")
        }

        return { key, value }
    }

    _convertType(rawKey, normalizedKey, value) {
        const type = this.types[normalizedKey] || "string"

        if (type === "number") {
            const numValue = Number(value)
            if (value === "" || isNaN(numValue) || isNaN(parseFloat(value))) {
                throw new QueryParseError(
                    `"${rawKey}" 的值必须是数字，收到: "${value}"`,
                    "TYPE_ERROR",
                )
            }
            return numValue
        }

        return value
    }
}

// ==================== 预置配置 ====================

/**
 * 图片处理参数配置
 */
export const ImageConfig = {
    aliases: {
        q: "quality",
        quality: "quality",
        s: "size",
        size: "size",
        w: "width",
        width: "width",
        suffix: "suffix",
        sf: "suffix",
        prefix: "prefix",
        pf: "prefix",
    },
    types: {
        quality: "number",
        size: "number",
        width: "number",
    },
}

/**
 * 视频处理参数配置
 */
// const VideoConfig = {
//     aliases: {
//         b: "bitrate",
//         bitrate: "bitrate",
//         r: "resolution",
//         res: "resolution",
//         resolution: "resolution",
//         fps: "framerate",
//         framerate: "framerate",
//         c: "codec",
//         codec: "codec",
//     },
//     types: {
//         bitrate: "number",
//         resolution: "number",
//         framerate: "number",
//     },
// }

// ==================== 便捷函数 ====================
/**
 * 使用默认图片配置解析
 * @param {string} str
 * @returns {Object}
 */
export function parseImageParams(str) {
    const parser = new QueryParser(ImageConfig)
    return parser.parse(str)
}

// 默认导出
export default QueryParser
