/*
 * Project: mediac
 * Created: 2024-04-27 14:25:22
 * Modified: 2024-04-27 14:25:22
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
 */
export default {
    parseArgs, // 主要导出函数
}

/**
 * 解析参数字符串为JavaScript对象
 * 支持多种数据类型：字符串、数字、布尔值、数组、对象、比较表达式
 *
 * @param {string} inputString - 要解析的参数字符串
 * @returns {Object} 解析后的JavaScript对象
 * @throws {Error} 当键值对格式无效时抛出错误
 *
 * @example
 * parseArgs("width=1920;height=1080;fps=25")
 * // 返回 {width: 1920, height: 1080, fps: 25}
 *
 * parseArgs("preset=hevc;bitrate=[1000,2000];size=>1280")
 * // 返回 {preset: "hevc", bitrate: [1000, 2000], size: {op: ">", num: 1280}}
 */
function parseArgs(inputString) {
    // 输入验证：如果不是字符串，返回空对象
    if (typeof inputString !== "string") {
        return {}
    }

    const parsedObject = {}

    // 使用正则表达式分割键值对，支持分号、冒号、井号作为分隔符
    const keyValuePairs = inputString.split(/;|:|#/)

    // 遍历每个键值对进行解析
    for (let pair of keyValuePairs) {
        let parsedValue = null

        // 查找等号位置，用于分割键和值
        const indexOfEqual = pair.indexOf("=")
        if (indexOfEqual === -1) {
            // 没有等号认为是非法的键值对，抛出错误
            throw new Error(`Invalid key-value pair: ${pair}`)
        }

        // 提取键和值
        const key = pair.substring(0, indexOfEqual)
        const value = pair.substring(indexOfEqual + 1)

        // 检查键是否为空
        if (!key) {
            throw new Error(`Invalid key-value pair: ${pair}`)
        }

        // 如果值存在，进行解析
        if (value) {
            let cleanValue = value.trim()

            // 检查值是否被引号包裹（单引号或双引号）
            const isQuoted =
                (cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
                (cleanValue.startsWith("'") && cleanValue.endsWith("'"))

            if (isQuoted) {
                // 引号包裹的值直接作为字符串处理，去掉引号
                parsedValue = cleanValue.slice(1, -1)
            } else if (cleanValue.includes("[") && cleanValue.includes("]")) {
                // 中括号包裹的值解析为数组
                // 支持多种分隔符：逗号、叹号、斜杠、竖线
                const arrayValues = cleanValue.slice(1, -1).split(/,|!|\/|\|/)
                parsedValue = arrayValues.map((val) => parseValue(val.trim()))
            } else if (cleanValue.startsWith("{") && cleanValue.endsWith("}")) {
                // 大括号包裹的值解析为嵌套对象
                const objectStr = cleanValue.slice(1, -1)
                parsedValue = parseObject(objectStr)
            } else {
                // 其他情况：解析为数字、布尔值、比较表达式或字符串
                parsedValue = parseValue(cleanValue)
            }
        }

        // 将解析后的键值对添加到结果对象中
        parsedObject[key.trim()] = parsedValue
    }

    return parsedObject
}

/**
 * 匹配浮点数的正则表达式
 * 支持负数和小数：-123.45, 123.45, 123
 */
const RE_NUMBER = /^-?\d+(\.\d+)?$/

/**
 * 匹配比较表达式的正则表达式
 * 支持大于号和小于号开头的数字：>123, <123.45, >-100
 */
const RE_NUMBER_OP = /^[><]-?\d+(\.\d+)?$/

/**
 * 解析单个值，自动识别数据类型
 * 支持数字、布尔值、比较表达式，其他作为字符串处理
 *
 * @param {string} value - 要解析的值字符串
 * @returns {number|boolean|Object|string} 解析后的值
 *
 * @example
 * parseValue("123.45") // 返回 123.45 (数字)
 * parseValue("true")   // 返回 true (布尔值)
 * parseValue(">1280")   // 返回 {op: ">", num: 1280} (比较表达式)
 * parseValue("hello")  // 返回 "hello" (字符串)
 */
function parseValue(value) {
    if (!value) {
        return value // 空值直接返回
    }

    // 检查是否为浮点数（包括负数）
    if (RE_NUMBER.test(value)) {
        return parseFloat(value)
    }
    // 检查是否为布尔值 true
    else if (value.toLowerCase() === "true") {
        return true
    }
    // 检查是否为布尔值 false
    else if (value.toLowerCase() === "false") {
        return false
    }
    // 检查是否为比较表达式（>数字 或 <数字）
    else if (RE_NUMBER_OP.test(value)) {
        return {
            op: value[0], // 操作符：> 或 <
            num: parseFloat(value.substr(1)), // 数值部分
        }
    }
    // 其他情况作为普通字符串返回
    else {
        return value
    }
}

/**
 * 解析对象字符串为JavaScript对象
 * 处理形如 "key1=value1,key2=value2" 的字符串
 *
 * @param {string} objectStr - 要解析的对象字符串
 * @returns {Object} 解析后的JavaScript对象
 *
 * @example
 * parseObject("width=1920,height=1080")
 * // 返回 {width: 1920, height: 1080}
 */
function parseObject(objectStr) {
    const obj = {}

    // 按逗号分割键值对，然后遍历每个键值对
    const keyValuePairs = objectStr.split(",")
    for (let pair of keyValuePairs) {
        // 按等号分割键和值
        const [key, value] = pair.split("=")

        // 去除键和值两端的空白字符，然后解析值的类型
        obj[key.trim()] = parseValue(value?.trim())
    }

    return obj
}

/**
 * 测试函数 - 演示参数解析器的各种功能
 * 包含多种数据类型的复杂示例
 */
function testParse() {
    // 示例输入字符串，包含各种数据类型和结构
    const sampleInput1 =
        "a=[1.5,2,hello];b=[red,w43,rrerr,2024.4];ab=12.8;aq=3.1425;ap=aac_he;vb=1536;vq=23;vc=hevc_nvenc;vs=1280*720;dddfaa=;test mode='3434324':yes=false;width=>1200;height=<600;time=>-1224.343;someobj={oa=vaaa,oc=32132.23,od=>23}"

    // 执行解析并输出结果
    console.log(parseArgs(sampleInput1))
}
