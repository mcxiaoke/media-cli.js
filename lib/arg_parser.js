/*
 * Project: mediac
 * Created: 2024-04-27 14:25:22
 * Modified: 2026-03-27
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// 参数字符串示例
// "a=[1.5,2,hello];b=[red,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;dddfaa=;test mode='3434324':yes=false;width=>1200;height=<600;time=>-1224.343;someobj={oa=vaaa,oc=32132.23,od=>23}"
// 参数解析规则
// 键值对之间用分号或冒号或井号中的一种分割 ; : #
// 中括号包裹为数组，数组元素用逗号或叹号或斜杠或竖杠分割 , ! / |
// 键值对的值，如果为数字就解析为数字类型，如果为true/false就解析为布尔值
// 键值对的值，如果单引号双引号包裹，就去掉引号，解析为字符串
// 键值对的值，如果大于号小于号开头，解析为 {op:">",num:1234} 这种

/**
 * 参数解析器模块 - 用于解析复杂的命令行参数字符串
 * 支持多种数据类型的自动转换和复杂的数据结构解析
 * 支持别名映射和类型校验
 * @module lib/arg_parser
 */

/**
 * 参数解析错误类
 * @extends Error
 */
export class ArgParseError extends Error {
    /**
     * @param {string} message - 错误消息
     * @param {string} code - 错误代码
     */
    constructor(message, code) {
        super(message)
        this.name = "ArgParseError"
        this.code = code
    }
}

/**
 * 解析器配置对象
 * @typedef {Object} ParserConfig
 * @property {Object.<string, string>} [aliases] - 别名映射 { 别名: 标准键 }
 * @property {Object.<string, string>} [types] - 类型配置 { 标准键: 'number' | 'string' | 'boolean' | 'array' }
 * @property {string[]} [required] - 必填的标准键数组
 * @property {boolean} [strict] - 严格模式，未知键是否报错
 */

/**
 * 比较表达式对象
 * @typedef {Object} CompareExpression
 * @property {string} op - 操作符 ">" 或 "<"
 * @property {number} num - 比较的数值
 */

/**
 * 解析后的值类型
 * @typedef {string|number|boolean|null|Array|Object|CompareExpression} ParsedValue
 */

/**
 * 解析参数字符串为JavaScript对象
 * 支持多种数据类型：字符串、数字、布尔值、数组、对象、比较表达式
 *
 * @param {string} inputString - 要解析的参数字符串
 * @param {ParserConfig} [config={}] - 解析器配置
 * @returns {Object.<string, ParsedValue>} 解析后的JavaScript对象
 * @throws {ArgParseError} 当键值对格式无效、类型不匹配或缺少必填项时抛出错误
 *
 * @example
 * // 基本用法
 * parseArgs("width=1920;height=1080;fps=25")
 * // 返回 {width: 1920, height: 1080, fps: 25}
 *
 * @example
 * // 复杂结构
 * parseArgs("preset=hevc;bitrate=[1000,2000];size=>1280")
 * // 返回 {preset: "hevc", bitrate: [1000, 2000], size: {op: ">", num: 1280}}
 *
 * @example
 * // 使用配置
 * parseArgs("q=85;w=1920", {
 *   aliases: { q: "quality", w: "width" },
 *   types: { quality: "number", width: "number" },
 *   required: ["quality"]
 * })
 * // 返回 {quality: 85, width: 1920}
 */
export function parseArgs(inputString, config = {}) {
    const { aliases = {}, types = {}, required = [], strict = false } = config

    if (typeof inputString !== "string") {
        return {}
    }

    const parsedObject = {}
    const seenKeys = new Set()

    const keyValuePairs = inputString.split(/;|:|#/)

    for (let pair of keyValuePairs) {
        let parsedValue = null

        const indexOfEqual = pair.indexOf("=")
        if (indexOfEqual === -1) {
            throw new ArgParseError(
                `Invalid key-value pair: ${pair}`,
                "INVALID_FORMAT"
            )
        }

        let key = pair.substring(0, indexOfEqual).trim()
        const value = pair.substring(indexOfEqual + 1)

        if (!key) {
            throw new ArgParseError(`Invalid key-value pair: ${pair}`, "INVALID_FORMAT")
        }

        const normalizedKey = aliases[key] || key

        if (strict && !aliases[key] && !types[key]) {
            const allowedKeys = [...new Set([...Object.values(aliases), ...Object.keys(types)])]
            throw new ArgParseError(
                `Unknown key: "${key}", allowed keys: ${allowedKeys.join(", ")}`,
                "UNKNOWN_KEY"
            )
        }

        if (seenKeys.has(normalizedKey)) {
            throw new ArgParseError(
                `Duplicate key: "${key}" (${normalizedKey} already set)`,
                "DUPLICATE_KEY"
            )
        }

        if (value) {
            let cleanValue = value.trim()

            const isQuoted =
                (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
                (cleanValue.startsWith("'") && cleanValue.endsWith("'"))

            if (isQuoted) {
                parsedValue = cleanValue.slice(1, -1)
            } else if (cleanValue.includes("[") && cleanValue.includes("]")) {
                const arrayValues = cleanValue.slice(1, -1).split(/,|!|\/|\|/)
                parsedValue = arrayValues.map((val) => parseValue(val.trim()))
            } else if (cleanValue.startsWith("{") && cleanValue.endsWith("}")) {
                const objectStr = cleanValue.slice(1, -1)
                parsedValue = parseObject(objectStr)
            } else {
                parsedValue = parseValue(cleanValue)
            }
        }

        const expectedType = types[normalizedKey]
        if (expectedType && parsedValue !== null && parsedValue !== undefined) {
            parsedValue = validateAndConvertType(key, normalizedKey, parsedValue, expectedType)
        }

        parsedObject[normalizedKey] = parsedValue
        seenKeys.add(normalizedKey)
    }

    for (const reqKey of required) {
        if (parsedObject[reqKey] === undefined) {
            throw new ArgParseError(
                `Missing required parameter: ${reqKey}`,
                "MISSING_REQUIRED"
            )
        }
    }

    return parsedObject
}

/**
 * 匹配浮点数的正则表达式
 * 支持负数和小数：-123.45, 123.45, 123
 * @type {RegExp}
 * @constant
 */
const RE_NUMBER = /^-?\d+(\.\d+)?$/

/**
 * 匹配比较表达式的正则表达式
 * 支持大于号和小于号开头的数字：>123, <123.45, >-100
 * @type {RegExp}
 * @constant
 */
const RE_NUMBER_OP = /^[><]-?\d+(\.\d+)?$/

/**
 * 解析单个值，自动识别数据类型
 * 支持数字、布尔值、比较表达式，其他作为字符串处理
 *
 * @param {string} value - 要解析的值字符串
 * @returns {ParsedValue} 解析后的值
 *
 * @example
 * parseValue("123.45") // 返回 123.45 (数字)
 * parseValue("true")   // 返回 true (布尔值)
 * parseValue(">1280")  // 返回 {op: ">", num: 1280} (比较表达式)
 * parseValue("hello")  // 返回 "hello" (字符串)
 */
export function parseValue(value) {
    if (!value) {
        return value
    }

    if (RE_NUMBER.test(value)) {
        return parseFloat(value)
    } else if (value.toLowerCase() === "true") {
        return true
    } else if (value.toLowerCase() === "false") {
        return false
    } else if (RE_NUMBER_OP.test(value)) {
        return {
            op: value[0],
            num: parseFloat(value.substring(1)),
        }
    } else {
        return value
    }
}

/**
 * 解析对象字符串为JavaScript对象
 * 处理形如 "key1=value1,key2=value2" 的字符串
 *
 * @param {string} objectStr - 要解析的对象字符串
 * @returns {Object.<string, ParsedValue>} 解析后的JavaScript对象
 *
 * @example
 * parseObject("width=1920,height=1080")
 * // 返回 {width: 1920, height: 1080}
 */
export function parseObject(objectStr) {
    const obj = {}

    const keyValuePairs = objectStr.split(",")
    for (let pair of keyValuePairs) {
        const [key, value] = pair.split("=")

        obj[key.trim()] = parseValue(value?.trim())
    }

    return obj
}

/**
 * 验证并转换值的类型
 *
 * @param {string} rawKey - 原始键名
 * @param {string} normalizedKey - 标准化后的键名
 * @param {ParsedValue} value - 待验证的值
 * @param {string} expectedType - 期望的类型
 * @returns {ParsedValue} 转换后的值
 * @throws {ArgParseError} 类型不匹配时抛出错误
 *
 * @private
 */
function validateAndConvertType(rawKey, normalizedKey, value, expectedType) {
    switch (expectedType) {
        case "number":
            if (typeof value === "number") return value
            if (typeof value === "string") {
                const num = Number(value)
                if (!isNaN(num)) return num
            }
            throw new ArgParseError(
                `"${rawKey}" must be a number, got: "${value}"`,
                "TYPE_ERROR"
            )

        case "string":
            return String(value)

        case "boolean":
            if (typeof value === "boolean") return value
            if (value === "true" || value === "1") return true
            if (value === "false" || value === "0") return false
            throw new ArgParseError(
                `"${rawKey}" must be a boolean, got: "${value}"`,
                "TYPE_ERROR"
            )

        case "array":
            if (Array.isArray(value)) return value
            throw new ArgParseError(
                `"${rawKey}" must be an array, got: "${typeof value}"`,
                "TYPE_ERROR"
            )

        default:
            return value
    }
}

/**
 * 创建预配置的解析器函数
 * 返回一个绑定了配置的解析函数
 *
 * @param {ParserConfig} config - 解析器配置
 * @returns {function(string): Object.<string, ParsedValue>} 配置化的解析函数
 *
 * @example
 * const parseVideoArgs = createParser({
 *   aliases: { b: "bitrate", r: "resolution" },
 *   types: { bitrate: "number", resolution: "number" },
 *   required: ["bitrate"]
 * })
 *
 * parseVideoArgs("b=2000;r=1080")
 * // 返回 { bitrate: 2000, resolution: 1080 }
 */
export function createParser(config) {
    return (inputString) => parseArgs(inputString, config)
}

/**
 * 默认导出对象（保持向后兼容）
 */
export default {
    parseArgs,
    parseValue,
    parseObject,
    createParser,
    ArgParseError,
}

/**
 * 测试函数 - 演示参数解析器的各种功能
 * 包含多种数据类型的复杂示例
 */
function testParse() {
    const sampleInput1 =
        "a=[1.5,2,hello];b=[red,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;dddfaa=;test mode='3434324':yes=false;width=>1200;height=<600;time=>-1224.343;someobj={oa=vaaa,oc=32132.23,od=>23}"

    console.log("=== 基本解析 ===")
    console.log(parseArgs(sampleInput1))

    console.log("\n=== 使用别名和类型校验 ===")
    const config = {
        aliases: { q: "quality", w: "width", s: "size" },
        types: { quality: "number", width: "number", size: "number" },
        required: ["quality"],
    }
    console.log(parseArgs("q=85;w=1920;s=>1280", config))

    console.log("\n=== 创建预配置解析器 ===")
    const parseVideoArgs = createParser({
        aliases: { b: "bitrate", r: "resolution", c: "codec" },
        types: { bitrate: "number", resolution: "number" },
    })
    console.log(parseVideoArgs("b=2000;r=1080;c=hevc"))
}
