/*
 * File: encoding.js
 * Created: 2024-04-03 23:12:48 +0800
 * Modified: 2024-04-09 22:13:40 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import iconv from "iconv-lite"
import * as log from "./debug.js"
import config from "./config.js"
import {
    HANZI_COMMON_3500,
    HANZI_COMPLEX,
    HANZI_RARELY_USED,
    strHasASCII,
    strHasHFKanaHira,
    strHasHiraKana,
    strOnlyASCII,
    strOnlyChinese,
    strOnlyHangul,
    strOnlyJapanese,
    strOnlyJapaneseHan,
} from "./unicode.js"

// https://github.com/bnoordhuis/node-iconv/
// 从配置文件获取默认编码列表
const DEFAULT_ENCODINGS_FROM = config.ENCODING?.DEFAULT_FROM_ENCODINGS || [
    "SHIFT_JIS",
    "GBK",
    "UTF8",
    "UTF-16",
    "UTF-32",
    "ISO-8859-1",
    "ISO-8859-2",
    "EUC-JP",
    "EUC-KR",
    "CP949",
    "BIG5",
]

const DEFAULT_ENCODINGS_TO = config.ENCODING?.DEFAULT_TO_ENCODINGS || [
    "SHIFT_JIS",
    "GBK",
    "UTF8",
    "UTF-16",
    "UTF-32",
    "ISO-8859-1",
    "ISO-8859-2",
    "EUC-JP",
    "EUC-KR",
    "CP949",
    "BIG5",
]

// 编码转换结果缓存
const decodeCache = new Map()

export const MESSY_CJK_CHARS = HANZI_RARELY_USED + HANZI_COMPLEX

export const REGEX_MESSY_CJK = new RegExp(`[${MESSY_CJK_CHARS}]`, "u")

export const REGEX_MESSY_UNICODE =
    /[\u3100-\u312f\u3300-\u33ff\ud800-\udfff\ue000-\uf8ff\ufb50-\ufdff\ufe70-\ufeff\ufff0-\uffff]/u

// 正则：只包含中文常用汉字，日文平假名片假名和ASCII字符
export const RE_CHARS_MOST_USED = new RegExp(
    `^[${HANZI_COMMON_3500}\\u3000-\\u303f\\uff66-\\uff9dA-Za-z0-9\\-_ ]+$/`,
    "ui",
)

/**
 * 基于字符串特征优化编码尝试顺序
 * @param {string} str - 输入字符串
 * @param {Array<string>} fromEnc - 源编码列表
 * @param {Array<string>} toEnc - 目标编码列表
 * @returns {Array<{enc1: string, enc2: string}>} 优化后的编码组合列表
 */
export function getOptimizedEncodingOrder(str, fromEnc, toEnc) {
    // 输入参数类型检查
    if (typeof str !== 'string') {
        str = String(str)
    }
    if (!Array.isArray(fromEnc)) {
        fromEnc = DEFAULT_ENCODINGS_FROM
    }
    if (!Array.isArray(toEnc)) {
        toEnc = DEFAULT_ENCODINGS_TO
    }
    
    // 编码优先级映射
    const priorityMap = {
        // 中文相关编码
        'gbk': strOnlyChinese(str) ? 10 : 5,
        'utf8': 8,
        'utf-16': 7,
        'utf-32': 6,
        'shift_jis': strHasHiraKana(str) ? 9 : 4,
        'big5': 6,
        'euc-kr': strOnlyHangul(str) ? 9 : 3,
        'cp949': strOnlyHangul(str) ? 8 : 3,
        'euc-jp': strHasHiraKana(str) ? 8 : 4,
        'iso-8859-1': 2,
        'iso-8859-2': 1
    }
    
    // 生成所有可能的编码组合
    const combinations = []
    for (const enc1 of fromEnc) {
        for (const enc2 of toEnc) {
            if (enc1 !== enc2) {
                // 计算组合优先级
                const priority1 = priorityMap[enc1] || 1
                const priority2 = priorityMap[enc2] || 1
                const totalPriority = priority1 + priority2
                
                combinations.push({
                    enc1,
                    enc2,
                    priority: totalPriority
                })
            }
        }
    }
    
    // 按优先级排序，优先级高的在前
    combinations.sort((a, b) => b.priority - a.priority)
    
    // 返回排序后的编码组合
    return combinations.map(({ enc1, enc2 }) => ({ enc1, enc2 }))
}

/**
 * 提取字符串中的唯一字符，去除重复字符
 * 使用Set数据结构确保字符唯一性
 *
 * @param {string} str - 输入字符串
 * @returns {string} 去重后的字符串
 *
 * @example
 * charUnique("hello") // 返回 "helo"
 * charUnique("测试测试") // 返回 "测试"
 */
export function charUnique(str) {
    // 输入参数类型检查
    if (typeof str !== 'string') {
        str = String(str)
    }
    // 处理空字符串情况
    if (str.length === 0) {
        return ''
    }
    // 使用Set去重，然后通过String.prototype.concat重新组合成字符串
    return String.prototype.concat.call(...new Set(str))
}

/**
 * 检查字符串中的不良Unicode字符
 * 识别可能导致显示问题或乱码的特殊字符
 *
 * @param {string} str - 要检查的字符串
 * @param {boolean} strict - 是否使用严格模式（严格模式下检查更少的字符类型）
 * @returns {Array<Array>} 检测结果数组，每个元素为[是否发现问题, 错误代码, 错误描述]
 *
 * @example
 * checkBadUnicode("hello?", false)
 * // 返回 [[true, 0, "问号"]]
 */
export function checkBadUnicode(str, strict = false) {
    // 输入参数类型检查
    if (typeof str !== 'string') {
        str = String(str)
    }
    if (typeof strict !== 'boolean') {
        strict = false
    }
    
    const results = []
    const length = str.length
    
    // 快速检查是否包含问号
    if (!strict && str.indexOf("?") !== -1) {
        // 乱码标志 问号
        results.push([true, 0, `问号`])
    }
    
    // 快速检查是否包含非法字符
    if (str.indexOf("\ufffd") !== -1) {
        // 乱码标志 问号和黑问号
        results.push([true, 0, `非法字符`])
    }
    
    // 只在必要时进行正则表达式检查
    if (length > 0) {
        if (!strict) {
            if (/[\u00c0-\u00d6\u00d8-\u024f]/u.test(str)) {
                // 乱码标志 拉丁字母扩展
                results.push([true, 2, `拉丁字母扩展`])
            }
            if (/[\u0370-\u1cff]/u.test(str)) {
                // 乱码标志 小众语言符号
                results.push([true, 3, `小众语言A`])
            }
            if (/[\ua000-\ua7ff\uab30-\uabff\ud7b0-\ud7ff]/u.test(str)) {
                // 乱码标志 小众语言符号
                results.push([true, 4, `小众语言B`])
            }
        }
        if (/[\u3100-\u312f]/u.test(str)) {
            // 注音符号
            results.push([true, 2, `注音符号`])
        }
        if (/[\u3300-\u33ff]/u.test(str)) {
            // 乱码标志 特殊字符
            results.push([true, 4, `CJK特殊字符`])
        }
        if (/[\ud800-\udfff]/u.test(str)) {
            // 乱码标志 代理对，存疑
            results.push([true, 4, `代理对`])
        }
        if (/[\ue000-\uf8ff]/u.test(str)) {
            // 乱码标志 Unicode私有区
            results.push([true, 5, `私用区`])
        }
        if (/[\ufb50-\ufdff\ufe70-\ufeff]/u.test(str)) {
            // 乱码标志 阿拉伯字符
            results.push([true, 5, `阿拉伯字符`])
        }
        if (str.includes("㼿")) {
            // 乱码标志 特殊生僻字
            results.push([true, 7, `生僻字`])
        }
    }
    return results
}

/**
 * 检查字符串是否包含不良Unicode字符
 * 是checkBadUnicode的简化版本，只返回布尔值
 *
 * @param {string} str - 要检查的字符串
 * @param {boolean} strict - 是否使用严格模式
 * @returns {boolean} 如果包含不良字符返回true，否则返回false
 */
export function hasBadUnicode(str, strict = false) {
    if (typeof str !== "string") {
        return false
    }
    return checkBadUnicode(str, strict)?.length > 0
}

/**
 * 检查字符串是否包含不良的CJK字符
 * 主要检测生僻汉字和复杂汉字
 *
 * @param {string} str - 要检查的字符串
 * @returns {boolean} 如果包含不良CJK字符返回true，否则返回false
 */
export function hasBadCJKChar(str) {
    if (typeof str !== "string") {
        return false
    }
    return REGEX_MESSY_CJK.test(str)
}

/**
 * 显示字符串中的不良CJK字符（用于调试）
 * 将字符串分解为字符数组，过滤出匹配REGEX_MESSY_CJK的字符并输出
 *
 * @param {string} str - 要检查的字符串
 */
export function showBadCJKChars(str) {
    const chars = Array.from(str).filter((c) => REGEX_MESSY_CJK.test(c))
    console.log("BadCJKChars:", chars)
}

/**
 * 尝试解码文本字符串，找出最佳编码方案
 * 返回可能的解码结果列表，按质量排序
 *
 * @param {string} str - 要解码的字符串
 * @param {Array<string>} fromEnc - 源编码列表，默认DEFAULT_ENCODINGS_FROM
 * @param {Array<string>} toEnc - 目标编码列表，默认DEFAULT_ENCODINGS_TO
 * @param {number} threhold - 质量阈值，低于此值的结果会被过滤
 * @returns {Array<Array>} 解码结果数组，每个元素为[解码文本, 是否转换, 质量分数, 描述]
 */
export function tryDecodeText(str, fromEnc = DEFAULT_ENCODINGS_FROM, toEnc = DEFAULT_ENCODINGS_TO, threhold = 10) {
    try {
        if (typeof str !== 'string') {
            return [[String(str), false, 0, "[非字符串输入]"]]
        }

        // 生成缓存键
        const cacheKey = `${str}|${fromEnc.join(',')}|${toEnc.join(',')}|${threhold}`
        
        // 检查缓存
        if (decodeCache.has(cacheKey)) {
            log.debug(`从缓存获取解码结果: ${str.substring(0, 20)}...`)
            return decodeCache.get(cacheKey)
        }

        // 快速检查常见乱码标志
        if (str.indexOf("?") !== -1 || str.indexOf("\ufffd") !== -1) {
            const result = [[str, false, 0, "[乱码字符]"]]
            decodeCache.set(cacheKey, result)
            return result
        }

        // 只在必要时进行正则表达式检查
        const length = str.length
        if (length > 0) {
            if (/[\ud800-\udfff]/u.test(str)) {
                // 乱码标志 代理对，存疑
                const result = [[str, false, 0, "[代理对]"]]
                decodeCache.set(cacheKey, result)
                return result
            }
            if (/[\ue000-\uf8ff]/u.test(str)) {
                // 乱码标志 Unicode私有区
                const result = [[str, false, 0, "[私用区]"]]
                decodeCache.set(cacheKey, result)
                return result
            }
        }

        fromEnc = fromEnc.map((x) => x.toLowerCase())
        toEnc = toEnc.map((x) => x.toLowerCase())

        let results = []
        if (strOnlyASCII(str)) {
            // results.push([str, false, 0])
            const result = [[str, false, 100, "[ASCII]"]]
            decodeCache.set(cacheKey, result)
            return result
        }
        const messyUnicode = REGEX_MESSY_UNICODE.test(str)
        const messyCJK = REGEX_MESSY_CJK.test(str)
        log.debug("tryDecodeText", str)
        if (messyUnicode || messyCJK) {
            if (strOnlyChinese(str) && !messyCJK) {
                const result = [[str, false, 100, `[全中文]`]]
                decodeCache.set(cacheKey, result)
                return result
            }
        }
        if (RE_CHARS_MOST_USED.test(str)) {
            results.push([str, false, 100, "[常用汉字]"])
        } else if (strHasHFKanaHira(str)) {
            // 包含不用的全角半角平假名片假名
            results.push([str, false, 65, "[半角假名]"])
        } else {
            // fs.appendFileSync(tempfile, str + '\n')
            // return [[str, false, 0, '[无乱码]', ''],]
            results.push([str, false, 0, "[无乱码]", ""])
        }

        if (
            !!REGEX_MESSY_CJK.test(str) &&
            (strHasHiraKana(str) || strHasASCII(str)) &&
            strOnlyJapanese(str)
        ) {
            results.push([str, false, 99, "[全日文1]"])
        } else if (strOnlyJapanese(str)) {
            results.push([str, false, 80, "[全日文2]"])
        }

        // 基于字符串特征优化编码尝试顺序
        const optimizedEncodings = getOptimizedEncodingOrder(str, fromEnc, toEnc)
        
        for (const { enc1, enc2 } of optimizedEncodings) {
            // 忽略解码编码相同的情况
            if (enc1 === enc2) {
                continue
            }
            try {
                const strBuffer = iconv.encode(str, enc1)
                let strDecoded = iconv.decode(strBuffer, enc2)
                const badDecoded = checkBadUnicode(strDecoded)
                // const strCleaned = strDecoded.replaceAll(/[\ufffd\u0020]/ugi, '')
                log.debug(enc1, enc2, strDecoded, badDecoded)
                // 如果含有乱码字符
                if (badDecoded?.length > 0) {
                    for (const item of badDecoded) {
                        results.push([strDecoded, ...item, `${enc1}=>${enc2}`])
                    }
                    continue
                }
                const onlyASCII = strOnlyASCII(strDecoded)
                const onlyCN = strOnlyChinese(strDecoded)
                const onlyJP = strOnlyJapanese(strDecoded)
                const onlyJPHan = strOnlyJapaneseHan(strDecoded)
                const onlyKR = strOnlyHangul(strDecoded)
                const hasHiraKana = strHasHiraKana(strDecoded)
                const hasHFHiraKana = strHasHFKanaHira(strDecoded)
                const messyUnicode = REGEX_MESSY_UNICODE.test(strDecoded)
                const messyCJK = REGEX_MESSY_CJK.test(strDecoded)

                log.debug(strDecoded, "cn", onlyCN, "jp", onlyJP, "jhan", onlyJPHan, "kr", onlyKR)
                log.debug(
                    strDecoded,
                    "hk",
                    hasHiraKana,
                    "hf",
                    hasHFHiraKana,
                    "mu",
                    messyUnicode,
                    "mc",
                    messyCJK,
                )

                if (onlyASCII && !strDecoded.includes("?")) {
                    results.push([strDecoded, true, 99, `ASCII`, `${enc1}=>${enc2}`])
                    break
                }
                if (RE_CHARS_MOST_USED.test(strDecoded)) {
                    results.push([strDecoded, true, 99, `常用汉字`, `${enc1}=>${enc2}`])
                    break
                }
                if (onlyJP) {
                    if (!strHasHiraKana(strDecoded) && !onlyJPHan) {
                        results.push([strDecoded, true, 78, `日文字符`, `${enc1}=>${enc2}`])
                    }
                } else if (onlyCN) {
                    results.push([strDecoded, true, 76, `中文字符`, `${enc1}=>${enc2}`])
                } else if (hasHiraKana || hasHFHiraKana) {
                    results.push([strDecoded, true, 65, `含日文假名`, ` ${enc1}=>${enc2}`])
                } else if (onlyKR) {
                    results.push([strDecoded, true, 62, `韩文字符`, `${enc1}=>${enc2}`])
                } else if (messyCJK) {
                    results.push([strDecoded, true, 51, `生僻字`, `${enc1}=>${enc2}`])
                    // continue
                } else {
                    results.push([
                        strDecoded,
                        true,
                        60,
                        `正常转换 ${onlyCN} ${onlyJP}`,
                        ` ${enc1}=>${enc2}`,
                    ])
                }
            } catch (error) {
                log.info(`fixEnc ${str} ${error.message || error}`)
            }
        }
        results.push([str, false, 70, "原始值"])
        results = results.filter((r) => r[2] >= threhold).sort((a, b) => b[2] - a[2])
        log.debug(results.slice(3))
        
        // 缓存结果
        decodeCache.set(cacheKey, results)
        
        // 限制缓存大小，防止内存占用过大
        const cacheSizeLimit = config.ENCODING?.CACHE_SIZE_LIMIT || 1000
        if (decodeCache.size > cacheSizeLimit) {
            // 删除最早的缓存项
            const firstKey = decodeCache.keys().next().value
            decodeCache.delete(firstKey)
        }
        
        return results
    } catch (error) {
        log.error(`tryDecodeText 函数执行出错: ${error.message || error}`)
        return [[str, false, 0, "[解码失败]"]]
    }
}

/**
 * 解码文本字符串并返回最佳解码结果
 * 返回质量最高的解码方案
 *
 * @param {string} str - 要解码的字符串
 * @returns {Array} 最佳解码结果 [解码文本, 是否转换, 质量分数, 描述]
 */
export function decodeText(str) {
    let results = tryDecodeText(str)
    results = results.filter((r) => r[2] >= 0).sort((a, b) => b[2] - a[2])
    log.debug("==================================")
    log.debug(str)
    if (results?.length > 0) {
        for (const r of results) {
            log.debug(r[0], "\t\t", r.slice(1))
        }
    }
    return results[0] || [str, false, 0, "fallback"]
}
