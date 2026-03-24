#!/usr/bin/env node
/*
 * File: cmd_decode.js
 * Created: 2024-04-07 16:12:06 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from "fs"
import path from "path"
import { glob } from "glob"
import pMap from "p-map"
import chalk from "chalk"
import cliProgress from "cli-progress"
import chardet from "chardet"
import * as log from "../lib/debug.js"
import * as enc from "../lib/encoding.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import { t } from "../lib/i18n.js"
import * as unicode from "../lib/unicode.js"
import config from "../lib/config.js"

// 从配置文件获取默认编码列表
const DEFAULT_ENCODING_LIST = config.ENCODING?.DEFAULT_FROM_ENCODINGS || ["ISO-8859-1", "ISO-8859-2", "UTF8", "UTF-16", "UTF-32", "GBK", "BIG5", "SHIFT_JIS", "EUC-JP", "EUC-KR", "CP949"]

export { aliases, builder, command, describe, handler }
const command = "decode [strings...]"
const aliases = ["dc"]
const describe = t("decode.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .positional("strings", {
                describe: t("decode.positional.strings"),
                type: "string",
                required: false,
            })
            .option("from-enc", {
                alias: "f",
                type: "choices",
                choices: ["utf8", "utf-16", "utf-32", "gbk", "shift_jis", "big5", "euc-kr", "iso-8859-1", "iso-8859-2", "euc-jp", "cp949"],
                describe: t("decode.option.fromEnc"),
                default: undefined,
            })
            .option("to-enc", {
                alias: "t",
                type: "choices",
                choices: ["utf8", "utf-16", "utf-32", "gbk", "shift_jis", "big5", "euc-kr", "iso-8859-1", "iso-8859-2", "euc-jp", "cp949"],
                describe: t("decode.option.toEnc"),
                default: undefined,
            })
            .option("files", {
                alias: "i",
                type: "array",
                describe: t("decode.option.files"),
                default: [],
            })
            .option("recursive", {
                alias: "r",
                type: "boolean",
                describe: t("decode.option.recursive"),
                default: false,
            })
            .example(
                "mediac decode 乱码字符串",
                t("decode.example.decode.string")
            )
            .example(
                "mediac decode --files *.txt",
                t("decode.example.decode.files")
            )
            .example(
                "mediac decode --files **/*.txt --recursive",
                t("decode.example.decode.recursive")
            )
            .example(
                "mediac decode --from-enc gbk --to-enc utf8 乱码字符串",
                t("decode.example.decode.from.gbk")
            )
    )
}

/**
 * 解码文本命令处理函数
 * 尝试使用不同编码解码乱码文本
 * @param {Object} argv - 命令行参数对象
 * @param {Array<string>} argv.strings - 需要解码的字符串数组
 * @param {string} argv.fromEnc - 源编码（可选）
 * @param {string} argv.toEnc - 目标编码（可选）
 * @param {Array<string>} argv.files - 需要解码的文件路径数组
 * @param {boolean} argv.recursive - 是否递归处理目录
 * @returns {Promise<void>}
 */
const handler = async function cmdDecode(argv) {
    const logTag = "cmdDecode"
    log.info(logTag, "Args:", argv)
    const strArgs = argv.strings || []
    const files = argv.files || []
    const recursive = argv.recursive || false

    if (strArgs.length === 0 && files.length === 0) {
        throw createError(ErrorTypes.MISSING_REQUIRED_ARGUMENT, t("decode.text.input.required"))
    }

    const fromEnc = argv.fromEnc?.length > 0 ? [argv.fromEnc] : DEFAULT_ENCODING_LIST
    const toEnc = argv.toEnc?.length > 0 ? [argv.toEnc] : (config.ENCODING?.DEFAULT_TO_ENCODINGS || DEFAULT_ENCODING_LIST)
    const threhold = log.isVerbose() ? 0 : (config.ENCODING?.DEFAULT_THRESHOLD || 50)
    log.show(logTag, `fromEnc:`, JSON.stringify(fromEnc))
    log.show(logTag, `toEnc:`, JSON.stringify(toEnc))

    if (strArgs.length > 0) {
        await pMap(strArgs, async (str) => {
            log.show(chalk.yellow(logTag), chalk.cyan(t("decode.tryDecoding") + ":"), [str])
            const results = decodeText(str, fromEnc, toEnc, threhold)
            results.forEach(showResults)
            log.show(chalk.green(t("decode.input") + ":"), [str, str.length])
            log.show(chalk.green(t("decode.output") + ":"), results.pop())
            log.show()
        }, { concurrency: config.ENCODING?.CONCURRENCY || 4 })
    }

    if (files.length > 0) {
        await processFiles(files, recursive, fromEnc, toEnc, threhold)
    }
}

/**
 * 处理文件批量解码
 * @param {Array<string>} files - 文件路径数组
 * @param {boolean} recursive - 是否递归处理目录
 * @param {Array<string>} fromEnc - 源编码列表
 * @param {Array<string>} toEnc - 目标编码列表
 * @param {number} threhold - 置信度阈值
 * @returns {Promise<void>}
 */
async function processFiles(files, recursive, fromEnc, toEnc, threhold) {
    const logTag = "processFiles"

    for (const filePattern of files) {
        const matchedFiles = await new Promise((resolve, reject) => {
            glob(filePattern, { recursive, windowsPathsNoEscape: true }, (err, matches) => {
                if (err) reject(err)
                else resolve(matches)
            })
        })

        const filesToProcess = matchedFiles.filter(filePath => {
            try {
                const stats = fs.statSync(filePath)
                return stats.isFile()
            } catch {
                return false
            }
        })

        const totalFiles = filesToProcess.length
        if (totalFiles === 0) {
            log.info(chalk.yellow(logTag), chalk.cyan(t("decode.no.files.found") + ":"), chalk.green(filePattern))
            continue
        }

        log.info(chalk.yellow(logTag), chalk.cyan(t("decode.found.files", { count: totalFiles }) + ":"), chalk.green(filePattern))

        const progressBar = new cliProgress.SingleBar({
            format: chalk.cyan(t("decode.processing.files")) + ' [{bar}] ' + chalk.green('{percentage}%') + ' | ETA: ' + chalk.yellow('{eta}s') + ' | ' + chalk.blue('{value}/{total} ' + t("decode.file")),
            barCompleteChar: '█',
            barIncompleteChar: '░',
            hideCursor: true
        })

        progressBar.start(totalFiles, 0)

        let processedFiles = 0

        await pMap(filesToProcess, async (filePath) => {
            try {
                log.show(chalk.yellow(logTag), chalk.cyan(t("decode.processing.file") + ":"), chalk.green(filePath))

                const fileContent = fs.readFileSync(filePath, "utf8")

                const results = decodeText(fileContent, fromEnc, toEnc, threhold)

                log.show(chalk.yellow(logTag), chalk.cyan(t("decode.file.content.length") + ":"), chalk.green(fileContent.length))
                results.forEach(showResults)

                const bestResult = results.pop()
                log.show(chalk.green(t("decode.file") + ":"), chalk.green(filePath))
                log.show(chalk.green(t("decode.output") + ":"), bestResult)
                log.show()

            } catch (error) {
                log.error(chalk.red(logTag), chalk.red(t("decode.error.file", { path: filePath })), chalk.red(error.message))
            } finally {
                processedFiles++
                progressBar.update(processedFiles)
            }
        }, { concurrency: config.ENCODING?.CONCURRENCY || 4 })

        progressBar.stop()
        log.info(chalk.yellow(logTag), chalk.cyan(t("decode.processed.out.of", { processed: processedFiles, total: totalFiles }) + ":"), chalk.green(filePattern))
    }
}

/**
 * 解码文本，尝试不同编码组合
 * @param {string} str - 需要解码的字符串
 * @param {Array<string>} fromEnc - 源编码列表，默认为 DEFAULT_ENCODING_LIST
 * @param {Array<string>} toEnc - 目标编码列表，默认为 DEFAULT_ENCODING_LIST
 * @param {number} threhold - 置信度阈值，低于此值的结果会被过滤，默认为 50
 * @returns {Array} 解码结果数组（反转顺序，使最佳结果在前）
 *
 * @description
 * 该函数调用 enc.tryDecodeText 获取解码结果，然后反转数组顺序，
 * 使质量最高的解码结果排在前面，方便后续处理和显示。
 */
function decodeText(str, fromEnc = DEFAULT_ENCODING_LIST, toEnc = DEFAULT_ENCODING_LIST, threhold = 50) {
    // 调用核心解码函数获取解码结果
    let results = enc.tryDecodeText(str, fromEnc, toEnc, threhold)
    // 反转结果数组，使质量最高的结果排在前面
    return results.reverse()
}

/**
 * 显示解码结果
 * @param {Array} r - 解码结果数组，格式为 [解码文本, 是否转换, 质量分数, 描述, 编码转换路径]
 * @returns {void}
 *
 * @description
 * 该函数显示解码结果的详细信息，包括：
 * 1. 解码后的文本
 * 2. 检测到的编码（置信度 >= 70%）
 * 3. 检测到的不良 Unicode 字符
 *
 * 函数使用 log.info 和 log.show 输出信息，帮助用户理解解码结果的质量和可靠性。
 */
function showResults(r) {
    log.info(chalk.gray(`-`))
    const str = r[0]
    const print = (a, b) => log.info(chalk.blue(a.padEnd(16, " ")), b)
    log.show(chalk.blue(t("decode.result") + ":"), r)
    let cr = chardet.analyse(Buffer.from(str))
    cr = cr.filter((ct) => ct.confidence >= 70)
    cr?.length > 0 && print(t("decode.encoding"), chalk.green(JSON.stringify(cr)))
    const badUnicode = enc.checkBadUnicode(str, true)
    badUnicode?.length > 0 && log.show(chalk.red(t("decode.badUnicode") + ":"), chalk.red(JSON.stringify(badUnicode)))
}
