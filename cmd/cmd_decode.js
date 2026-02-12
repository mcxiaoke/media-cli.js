#!/usr/bin/env node
/*
 * File: cmd_decode.js
 * Created: 2024-04-07 16:12:06 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chardet from "chardet"
import * as log from "../lib/debug.js"
import * as enc from "../lib/encoding.js"
import * as unicode from "../lib/unicode.js"
import { t } from "../lib/i18n.js"

const ENC_LIST = ["ISO-8859-1", "UTF8", "UTF-16", "GBK", "BIG5", "SHIFT_JIS", "EUC-JP", "EUC-KR"]

export { aliases, builder, command, describe, handler }
const command = "decode <strings...>"
const aliases = ["dc"]
const describe = t("decode.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .positional("strings", {
                describe: t("decode.strings"),
                type: "string",
            })
            // 修复文件名乱码
            .option("from-enc", {
                alias: "f",
                type: "choices",
                choices: ["utf8", "gbk", "shift_jis", "big5", "euc-kr"],
                description: t("decode.from.enc"),
            })
            .option("to-enc", {
                alias: "t",
                type: "choices",
                choices: ["utf8", "gbk", "shift_jis", "big5", "euc-kr"],
                description: t("decode.to.enc"),
            }).po
    )
}

/**
 * 解码文本命令处理函数
 * 尝试使用不同编码解码乱码文本
 * @param {Object} argv - 命令行参数对象
 * @param {Array<string>} argv.strings - 需要解码的字符串数组
 * @param {string} argv.fromEnc - 源编码（可选）
 * @param {string} argv.toEnc - 目标编码（可选）
 * @returns {Promise<void>}
 */
const handler = async function cmdDecode(argv) {
    const logTag = "cmdDecode"
    log.info(logTag, "Args:", argv)
    const strArgs = argv.strings
    if (strArgs?.length === 0) {
        throw new Error(t("decode.text.input.required"))
    }
    const fromEnc = argv.fromEnc?.length > 0 ? [argv.fromEnc] : ENC_LIST
    const toEnc = argv.toEnc?.length > 0 ? [argv.toEnc] : ENC_LIST
    const threhold = log.isVerbose() ? 0 : 50
    log.show(logTag, `Input:`, strArgs)
    log.show(logTag, `fromEnc:`, JSON.stringify(fromEnc))
    log.show(logTag, `toEnc:`, JSON.stringify(toEnc))

    for (const str of strArgs) {
        log.show(logTag, "TryDecoding:", [str])
        const results = decodeText(str, fromEnc, toEnc, threhold)
        results.forEach(showResults)
        log.show("INPUT:", [str, str.length])
        log.show("OUPUT:", results.pop())
        console.log()
    }
}

/**
 * 解码文本，尝试不同编码组合
 * @param {string} str - 需要解码的字符串
 * @param {Array<string>} fromEnc - 源编码列表
 * @param {Array<string>} toEnc - 目标编码列表
 * @param {number} threhold - 置信度阈值
 * @returns {Array} 解码结果数组（反转顺序）
 */
function decodeText(str, fromEnc = ENC_LIST, toEnc = ENC_LIST, threhold = 50) {
    let results = enc.tryDecodeText(str, fromEnc, toEnc, threhold)
    return results.reverse()
}

/**
 * 显示解码结果
 * @param {Array} r - 解码结果数组
 * @returns {void}
 */
function showResults(r) {
    log.info(`-`)
    const str = r[0]
    const print = (a, b) => log.info(a.padEnd(16, " "), b)
    log.show("Result:", r)
    let cr = chardet.analyse(Buffer.from(str))
    cr = cr.filter((ct) => ct.confidence >= 70)
    cr?.length > 0 && print("Encoding", cr)
    // print('String', Array.from(str))
    // print('Unicode', Array.from(str).map(c => c.codePointAt(0).toString(16)))
    const badUnicode = enc.checkBadUnicode(str, true)
    badUnicode?.length > 0 && log.show("badUnicode:", badUnicode)
    // log.info(`MESSY_UNICODE=${enc.REGEX_MESSY_UNICODE.test(str)}`,
    //     `MESSY_CJK=${enc.REGEX_MESSY_CJK.test(str)}`)
    // log.info(`OnlyJapanese=${unicode.strOnlyJapanese(str)}`,
    //     `OnlyJpHan=${unicode.strOnlyJapaneseHan(str)}`,
    //     `HasHiraKana=${unicode.strHasHiraKana(str)}`
    // )
    // log.info(`HasHangul=${unicode.strHasHangul(str)}`,
    //     `OnlyHangul=${unicode.strOnlyHangul(str)}`)
    // log.info(`HasChinese=${unicode.strHasChinese(str)}`,
    //     `OnlyChinese=${unicode.strOnlyChinese(str)}`,
    //     `OnlyChn3500=${enc.RE_CHARS_MOST_USED.test(str)}`)
}
