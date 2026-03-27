/*
 * File: cmd_rename.js
 * Created: 2024-03-16 21:12:41 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from "chalk"
import { sify } from "chinese-conv"
import cliProgress from "cli-progress"
import dayjs from "dayjs"
import fs from "fs-extra"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import argparser from "../lib/arg_parser.js"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as enc from "../lib/encoding.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { getMediaInfo } from "../lib/mediainfo.js"
import { mergePath } from "../lib/path-merge.js"
import { applyFileNameRules, cleanFileName, renameFiles } from "./cmd_shared.js"

const ENTRY_TYPES = ["a", "f", "d"]
const RENAME_MODES = ["clean", "zhcn", "replace", "fixenc", "mergedir", "suffix", "prefix"]
const MEDIA_ASSOCIATED_EXTS = [".jpg", ".png", ".ass", ".srt", ".nfo", ".txt"]

/**
 * 使用 dayjs 格式化日期模板
 *
 * 支持两种格式语法：
 * 1. 占位符格式（花括号）：{yyyy}-{mm}-{dd} => 2024-03-24
 * 2. dayjs 原生格式：YYYY-MM-DD => 2024-03-24
 *
 * 占位符格式映射：
 * - 年份: {yyyy}(2024), {yy}(24)
 * - 月份: {mm}(01-12), {m}(1-12)
 * - 日期: {dd}(01-31), {d}(1-31)
 * - 小时: {hh}(00-23), {h}(0-23)
 * - 分钟: {ii}(00-59), {i}(0-59)
 * - 秒: {ss}(00-59), {s}(0-59)
 * - 月份名: {MMMM}(January), {MMM}(Jan)
 * - 星期名: {dddd}(Monday), {ddd}(Mon)
 *
 * 示例：
 * - "{yyyy}-{mm}-{dd}" => "2024-03-24"
 * - "YYYYMMDD-HHmmss" => "20240324-153045"（dayjs 原生）
 * - "{yyyy}年{mm}月{dd}日" => "2024年03月24日"
 *
 * @param {string} template - 日期格式模板字符串
 * @param {Date|string|number} [date=new Date()] - 要格式化的日期对象
 * @returns {string} 格式化后的日期字符串
 */
function formatDateTemplate(template, date = new Date()) {
    const dayjsTemplate = template
        .replace(/\{yyyy\}/g, "YYYY")
        .replace(/\{yy\}/g, "YY")
        .replace(/\{mm\}/g, "MM")
        .replace(/\{m\}/g, "M")
        .replace(/\{dd\}/g, "DD")
        .replace(/\{d\}/g, "D")
        .replace(/\{hh\}/g, "HH")
        .replace(/\{h\}/g, "H")
        .replace(/\{ii\}/g, "mm")
        .replace(/\{i\}/g, "m")
        .replace(/\{ss\}/g, "ss")
        .replace(/\{s\}/g, "s")
        .replace(/\{MMMM\}/g, "MMMM")
        .replace(/\{MMM\}/g, "MMM")
        .replace(/\{dddd\}/g, "dddd")
        .replace(/\{ddd\}/g, "ddd")
    return dayjs(date).format(dayjsTemplate)
}

export { aliases, builder, command, describe, handler }
const command = "rename <input>"
const aliases = ["fn", "fxn"]
const describe = t("rename.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .positional("input", {
                describe: t("option.common.input"),
                type: "string",
            })
            .option("mode", {
                alias: "m",
                type: "string",
                choices: RENAME_MODES,
                description: t("rename.mode"),
            })
            .option("cargs", {
                describe: t("rename.cargs"),
                type: "string",
            })
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
            .option("max-depth", {
                alias: "depth",
                type: "number",
                default: 99,
                description: t("option.common.max.depth"),
            })
            .option("type", {
                type: "choices",
                choices: ENTRY_TYPES,
                default: "f",
                description: t("rename.type"),
            })
            .option("clean", {
                alias: "c",
                type: "boolean",
                description: t("rename.clean"),
            })
            .option("separator", {
                alias: "sep",
                type: "string",
                description: t("rename.separator"),
            })
            .option("counter", {
                alias: "cn",
                type: "string",
                description: t("rename.counter"),
            })
            .option("counter-start", {
                alias: "cs",
                type: "number",
                default: 1,
                description: t("rename.counter.start"),
            })
            .option("case", {
                alias: "cse",
                type: "string",
                choices: ["upper", "lower", "title", "sentence"],
                description: t("rename.case"),
            })
            .option("truncate", {
                alias: "tr",
                type: "number",
                description: t("rename.truncate"),
            })
            .option("truncate-suffix", {
                alias: "ts",
                type: "string",
                default: "...",
                description: t("rename.truncate.suffix"),
            })
            .option("template", {
                alias: "tpl",
                type: "string",
                description: t("rename.template"),
            })
            .option("add-prefix", {
                alias: "ap",
                type: "string",
                description: t("rename.add.prefix"),
            })
            .option("add-suffix", {
                alias: "as",
                type: "string",
                description: t("rename.add.suffix"),
            })
            .option("change-ext", {
                alias: "ce",
                type: "string",
                description: t("rename.change.ext"),
            })
            .option("lower-ext", {
                alias: "le",
                type: "boolean",
                description: t("rename.lower.ext"),
            })
            .option("upper-ext", {
                alias: "ue",
                type: "boolean",
                description: t("rename.upper.ext"),
            })
            .option("preview", {
                alias: "pv",
                type: "boolean",
                description: t("rename.preview"),
            })
            .option("preview-format", {
                alias: "pf",
                type: "string",
                choices: ["json", "csv", "text"],
                default: "text",
                description: t("rename.preview.format"),
            })
            .option("preview-output", {
                alias: "po",
                type: "string",
                description: t("rename.preview.output"),
            })
            .option("replace", {
                alias: "rp",
                type: "array",
                description: t("rename.replace"),
            })
            .option("replace-flags", {
                alias: "rpf",
                type: "string",
                default: "f",
                description: t("rename.replace.flags"),
            })
            .option("regex", {
                alias: "re",
                type: "boolean",
                description: t("option.common.regex"),
            })
            .option("fixenc", {
                alias: "fc",
                type: "boolean",
                description: t("rename.fixenc"),
            })
            .option("zhcn", {
                type: "boolean",
                description: t("rename.zhcn"),
            })
            .option("prefix-media", {
                alias: "pxm",
                type: "string",
                description: t("rename.prefix.media"),
            })
            // 文件添加后缀 媒体元数据
            .option("suffix-media", {
                alias: "sxm",
                type: "string",
                description: t("rename.suffix.media"),
            })
            //todo fixme add suffix-date
            // 文件添加后缀日期时间
            .option("suffix-date", {
                alias: "sxd",
                type: "string",
                description: t("rename.suffix.date"),
            })
            // 按照视频分辨率移动文件到指定目录
            .option("video-dimension", {
                alias: "vdn",
                type: "string",
                description: t("rename.video.dimension"),
            })
            // 合并多层重复目录，减少层级，不改动文件名
            .option("merge-dirs", {
                alias: "simplify-dirs",
                type: "boolean",
                description: t("rename.merge.dirs"),
            })
            // 并行操作限制，并发数，默认为 CPU 核心数
            .option("jobs", {
                alias: "j",
                describe: t("option.common.jobs"),
                type: "number",
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                description: t("option.common.doit"),
            })
    )
}

const handler = cmdRename

async function cmdRename(argv) {
    const testMode = !argv.doit
    const logTag = "cmdRename"
    const root = await helper.validateInput(argv.input)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
    }
    const startMs = Date.now()
    log.show(logTag, `${t("path.input")}:`, root)
    argv.cargs = argparser.parseArgs(argv.cargs)
    log.show(logTag, `cargs:`, argv.cargs)

    if (argv.mode) {
        const modeFlags = {
            clean: { clean: true },
            zhcn: { zhcn: true },
            replace: { replace: argv.replace || ["", ""] },
            fixenc: { fixenc: true },
            mergedir: { mergeDirs: true },
            suffix: { suffixMedia: argv.suffixMedia || "" },
            prefix: { prefixMedia: argv.prefixMedia || "" },
        }
        const flags = modeFlags[argv.mode.toLowerCase()]
        if (flags) {
            argv = { ...argv, ...flags }
            log.show(logTag, `Mode: ${argv.mode} =>`, flags)
        }
    }

    if (
        !(
            argv.complexArgs ||
            argv.clean ||
            argv.fixenc ||
            argv.zhcn ||
            argv.replace ||
            argv.suffixMedia ||
            argv.mergeDirs ||
            argv.counter ||
            argv.case ||
            argv.truncate ||
            argv.addPrefix ||
            argv.addSuffix ||
            argv.changeExt ||
            argv.lowerExt ||
            argv.upperExt ||
            argv.preview ||
            argv.template ||
            argv.suffixDate
        )
    ) {
        throw createError(ErrorTypes.MISSING_REQUIRED_ARGUMENT, t("rename.one.operation.required"))
    }
    const entryType = (argv.type || "f").toLowerCase()
    if (!ENTRY_TYPES.includes(entryType)) {
        throw createError(
            ErrorTypes.INVALID_ARGUMENT,
            `${t("error.type.must.be.one.of")} ${ENTRY_TYPES}`,
        )
    }
    const options = {
        needStats: true,
        withDirs: entryType === "d",
        withFiles: entryType === "a" || entryType === "f",
        maxDepth: argv.maxDepth || 99,
    }
    let entries = await mf.walk(root, options)
    if (entries.length === 0) {
        log.showYellow(logTag, t("rename.no.files.found", { type: entryType }))
        return
    }
    log.show(logTag, `${t("rename.total.entries.found")} ${entries.length} (type=${entryType})`)
    // 应用文件名过滤规则
    entries = await applyFileNameRules(entries, argv)
    if (entries.length === 0) {
        log.showYellow(logTag, t("rename.no.files.left.after.rules"))
        return
    }
    const globalCounter = (argv.counterStart || 1) - 1
    entries = entries.map((entry, i) => {
        return {
            ...entry,
            index: i,
            argv: argv,
            total: entries.length,
            counter: globalCounter + i + 1,
        }
    })
    const fCount = entries.length

    const progressBar = new cliProgress.SingleBar({
        format: `${chalk.cyan("{bar}")} {percentage}% | {value}/{total} | {filename}`,
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
        hideCursor: true,
    })
    progressBar.start(fCount, 0, { filename: "" })

    const errors = []
    let tasks = await pMap(
        entries,
        async (entry) => {
            try {
                const result = await preRename(entry)
                progressBar.increment(1, { filename: path.basename(entry.path).substring(0, 30) })
                return result
            } catch (error) {
                errors.push({ entry, error })
                progressBar.increment(1, {
                    filename: `[ERR] ${path.basename(entry.path).substring(0, 25)}`,
                })
                return null
            }
        },
        { concurrency: argv.jobs || cpus().length * 4 },
    )

    progressBar.stop()

    tasks = tasks.filter((entry) => entry && (entry.outPath || entry.outName))
    log.show(logTag, argv)
    const tCount = tasks.length
    const outPathSet = new Set(tasks.map((entry) => entry.outPath || entry.outName))
    if (outPathSet.size < tCount) {
        log.showCyan(
            logTag,
            t("rename.duplicate.names.warning", { count1: tCount, count2: outPathSet.size }),
        )
    }
    if (errors.length > 0) {
        log.showYellow(logTag, t("rename.errors.summary", { count: errors.length }))
        errors.forEach(({ entry, error }) => {
            log.showGray(logTag, `  ${entry.path}: ${error.message}`)
        })
    }
    log.showYellow(logTag, t("rename.files.skipped", { count: fCount - tCount, type: entryType }))
    if (tasks.length > 0) {
        log.showGreen(
            logTag,
            t("rename.files.ready.to.rename", { count: tasks.length, type: entryType }),
        )
    } else {
        log.showYellow(logTag, t("rename.nothing.to.do", { type: entryType }))
        return
    }

    if (argv.preview) {
        log.showYellow(logTag, "++++++++++ PREVIEW MODE ++++++++++")
        let previewContent = ""

        switch (argv.previewFormat) {
            case "json":
                previewContent = JSON.stringify(
                    tasks.map((task) => ({
                        source: task.path,
                        destination: task.outPath,
                    })),
                    null,
                    2,
                )
                break
            case "csv":
                previewContent = "Source,Destination\n"
                tasks.forEach((task) => {
                    previewContent += `"${task.path}","${task.outPath}"\n`
                })
                break
            default:
                previewContent = chalk.cyan("Source") + " -> " + chalk.green("Destination") + "\n"
                tasks.forEach((task) => {
                    previewContent += `${helper.pathShort(task.path)} -> ${helper.pathShort(task.outPath)}\n`
                })
        }

        console.log(previewContent)

        if (argv.previewOutput) {
            try {
                await fs.writeFile(argv.previewOutput, previewContent, "utf8")
                log.showGreen(logTag, `Preview saved to: ${argv.previewOutput}`)
            } catch (error) {
                log.showRed(logTag, `Failed to save preview: ${error.message}`)
            }
        }
        return
    }

    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("rename.confirm.rename", { count: tasks.length, type: entryType }),
            ),
        },
    ])
    if (answer.yes) {
        if (testMode) {
            log.showYellow(
                logTag,
                t("common.test.mode.note", { count: tasks.length, type: entryType }),
            )
        } else {
            const results = await renameFiles(tasks, true)
            log.showGreen(
                logTag,
                t("rename.all.files.renamed", { count: results.length, type: entryType }),
            )
        }
    } else {
        log.showYellow(logTag, t("operation.cancelled"))
    }
}

let encodingErrorCount = 0
const seenPaths = new Set()

/**
 * 重新组合修复后的目录路径
 * @param {string} oldDir - 原始目录路径
 * @param {...string} parts - 路径部分
 * @returns {string} 组合后的路径
 */
function combinePath(oldDir, ...parts) {
    let joinedPath = path.join(...parts)
    // 如果原路径是UNC路径，则需要补上前缀
    if (core.isUNCPath(oldDir)) {
        joinedPath = "\\" + joinedPath
    }
    return joinedPath
}

/**
 * 处理乱码修复
 * @param {Object} params - 参数对象
 * @param {string} params.oldPath - 原始路径
 * @param {string} params.oldDir - 原始目录
 * @param {string} params.oldBase - 原始文件名
 * @param {string} params.ext - 文件扩展名
 * @param {string} params.logTag - 日志标签
 * @param {string} params.progress - 索引/总数
 * @returns {Object} 包含新目录和新文件名的对象
 */
function fixEncoding({ oldPath, oldDir, oldBase, ext, logTag, progress }) {
    let pendingDir = null
    let pendingBase = null

    let [fs, ft] = enc.decodeText(oldBase)
    pendingBase = fs.trim()
    const dirNamesFixed = oldDir.split(path.sep).map((s) => {
        let [rs, rt] = enc.decodeText(s)
        return rs.trim()
    })
    pendingDir = combinePath(oldDir, ...dirNamesFixed)
    const strPath = oldPath.split(path.sep).join("")
    const strNewPath = combinePath(oldDir, pendingDir, pendingBase + ext)
    if (enc.hasBadUnicode(strPath, true)) {
        log.showGray(logTag, `BadSRC:${++encodingErrorCount} ${oldPath} `)
        log.showGray(logTag, `BadDST:${encodingErrorCount} ${strNewPath} `)
        log.fileLog(`BadEnc:${progress} <${oldPath}>`, logTag)
    }

    return { pendingDir, pendingBase }
}

/**
 * 将通配符模式转换为正则表达式
 * @param {string} pattern - 通配符模式
 * @returns {RegExp} 对应的正则表达式
 */
function wildcardToRegex(pattern) {
    const regexPattern = pattern
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")
    return new RegExp(regexPattern, "ugi")
}

/**
 * 处理字符串替换
 * @param {Object} params - 参数对象
 * @param {string} params.oldPath - 原始路径
 * @param {string} params.oldDir - 原始目录
 * @param {string} params.oldBase - 原始文件名
 * @param {string} params.ext - 文件扩展名
 * @param {Object} params.argv - 命令行参数
 * @param {string} params.logTag - 日志标签
 * @returns {Object} 包含新目录和新文件名的对象
 */
function replaceStrings({ oldPath, oldDir, oldBase, ext, argv, logTag }) {
    let pendingDir = null
    let pendingBase = null

    let matchMode = argv.regex ? "regex" : "str"
    let pattern = argv.regex ? new RegExp(argv.replace[0], "ugi") : argv.replace[0]

    if (!argv.regex && (argv.replace[0].includes("*") || argv.replace[0].includes("?"))) {
        pattern = wildcardToRegex(argv.replace[0])
        matchMode = "wildcard"
    }

    const replacement = argv.replace[1] || ""
    const flags = argv.replaceFlags
    log.info(logTag, `Replace: ${oldDir} = ${oldBase} P=${pattern} F=${flags}`)

    const replaceBaseName = flags.includes("f")
    const replaceDirName = flags.includes("d")
    let tempBase = oldBase
    if (replaceBaseName) {
        tempBase = oldBase.replaceAll(pattern, replacement)
        if (tempBase !== oldBase) {
            pendingBase = tempBase
        }
    }
    let tempDir = oldDir
    if (replaceDirName) {
        let parts = oldDir.split(path.sep).map((s) => s.replaceAll(pattern, replacement).trim())
        tempDir = combinePath(oldDir, ...parts.filter(Boolean))
        if (tempDir !== oldDir) {
            pendingDir = tempDir
        }
    }
    const pendingPath = path.join(pendingDir || oldDir, (pendingBase || oldBase) + ext)
    if (pendingPath !== oldPath) {
        log.info(logTag, `Replace: pattern=${pattern} replacement=${replacement} mode=${matchMode}`)
        log.info(logTag, `Replace: "${oldPath}"=>"${pendingPath}" (${matchMode})`)
    }

    return { pendingDir, pendingBase }
}

/**
 * 处理文件名清理
 * @param {Object} params - 参数对象
 * @param {string} params.oldBase - 原始文件名
 * @param {Object} params.argv - 命令行参数
 * @param {string} params.oldDir - 原始目录
 * @returns {Object} 包含新目录和新文件名的对象
 */
function cleanFileNameHandler({ oldBase, argv, oldDir }) {
    let pendingDir = null
    let pendingBase = null

    if (!oldBase.toLowerCase().includes("shana")) {
        pendingBase = cleanFileName(oldBase, {
            separator: argv.separator,
            keepDateStr: true,
            zhcn: false,
        })
        pendingDir = oldDir
    }

    return { pendingDir, pendingBase }
}

/**
 * 处理繁体转简体
 * @param {Object} params - 参数对象
 * @param {string} params.pendingBase - 待处理文件名
 * @param {string} params.pendingDir - 待处理目录
 * @param {string} params.oldBase - 原始文件名
 * @param {string} params.oldDir - 原始目录
 * @returns {Object} 包含新目录和新文件名的对象
 */
function convertToZhCn({ pendingBase, pendingDir, oldBase, oldDir }) {
    const newBase = sify(pendingBase || oldBase)
    const newDir = sify(pendingDir || oldDir)

    return { pendingDir: newDir, pendingBase: newBase }
}

/**
 * 处理媒体文件前缀/后缀
 * @param {Object} params - 参数对象
 * @param {string} params.oldPath - 原始路径
 * @param {string} params.oldDir - 原始目录
 * @param {string} params.oldBase - 原始文件名
 * @param {Object} params.argv - 命令行参数
 * @param {string} params.logTag - 日志标签
 * @returns {Promise<Object>} 包含新文件名和关联文件扩展名的对象
 */
async function addMediaPrefixSuffix({ oldPath, oldDir, oldBase, argv, logTag }) {
    let pendingBase = oldBase
    const associatedExts = []

    if (helper.isMediaFile(oldPath) && (argv.suffixMedia || argv.prefixMedia)) {
        try {
            const isAudio = helper.isAudioFile(oldPath)
            const info = await getMediaInfo(oldPath)
            const duration = info?.duration || info?.video?.duration || info?.audio?.duration || 0
            if (duration > 0) {
                const bitrate = info?.bitrate || info.video?.bitrate || info?.audio?.bitrate || 0
                let tplValues = isAudio ? info.audio : info.video
                tplValues = {
                    ...tplValues,
                    duration: `${helper.humanSeconds(duration)}`,
                    bitrate: `${Math.floor(bitrate / 1000)}K`,
                }
                const base = pendingBase
                const prefix = core.formatArgs(argv.prefixMedia || "", tplValues)
                const suffix = core.formatArgs(argv.suffixMedia || "", tplValues)
                pendingBase = `${prefix}${base}${suffix}`
                log.info(logTag, `PrefixSuffix: ${base} => ${pendingBase}`)
            } else {
                log.showYellow(logTag, `PrefixSuffix: No valid media info found for ${oldPath}`)
            }
        } catch (error) {
            log.showYellow(
                logTag,
                `PrefixSuffix: Error getting media info for ${oldPath}: ${error.message}`,
            )
        }

        if (pendingBase !== oldBase) {
            try {
                for (const ext of MEDIA_ASSOCIATED_EXTS) {
                    const fp = path.join(oldDir, oldBase + ext)
                    if (await fs.pathExists(fp)) {
                        associatedExts.push(ext)
                    }
                }
            } catch (error) {
                log.showYellow(
                    logTag,
                    `PrefixSuffix: Error checking extra files for ${oldPath}: ${error.message}`,
                )
            }
        }
    }

    return { pendingBase, associatedExts }
}

/**
 * 检查文件是否存在，如果存在则生成新的文件名
 * @param {string} basePath - 基础路径
 * @param {string} baseName - 基础文件名
 * @param {string} ext - 文件扩展名
 * @param {Function} existsCheck - 存在性检查函数
 * @param {string} logTag - 日志标签
 * @param {string} logPrefix - 日志前缀
 * @returns {Promise<string>} 处理后的路径
 */
async function ensureUniquePath(basePath, baseName, ext, existsCheck, logTag, logPrefix) {
    let newPath = path.resolve(path.join(basePath, baseName + ext))
    let dupCount = 0

    while (await existsCheck(newPath)) {
        const newName = baseName + `_${++dupCount}` + ext
        newPath = path.resolve(path.join(basePath, newName))
    }

    if (dupCount > 0) {
        log.showGray(logTag, `${logPrefix}: ${helper.pathShort(newPath)}`)
    }

    return newPath
}

/**
 * 处理路径冲突
 * @param {Object} params - 参数对象
 * @param {string} params.oldPath - 原始路径
 * @param {string} params.newPath - 新路径
 * @param {string} params.tmpNewBase - 临时新文件名
 * @param {string} params.ext - 文件扩展名
 * @param {string} params.newDir - 新目录
 * @param {string} params.logTag - 日志标签
 * @returns {Promise<Object>} 处理后的新路径和跳过状态
 */
async function handlePathConflicts({ oldPath, newPath, pendingBase, ext, newDir, logTag }) {
    if (newPath === oldPath) {
        log.info(logTag, `Skip Same: ${helper.pathShort(oldPath)}`)
        return { newPath, skipped: true }
    }

    if (await fs.pathExists(newPath)) {
        newPath = await ensureUniquePath(
            newDir,
            pendingBase,
            ext,
            fs.pathExists,
            logTag,
            `NewPath[EXIST]`,
        )
    } else if (seenPaths.has(newPath)) {
        newPath = await ensureUniquePath(
            newDir,
            pendingBase,
            ext,
            (p) => seenPaths.has(p),
            logTag,
            `NewPath[DUP]`,
        )
    }

    return { newPath, skipped: false }
}

/**
 * 预处理重命名操作，根据不同模式修复文件名和路径
 * @param {Object} entry - 文件条目对象
 * @param {string} entry.path - 文件路径
 * @param {boolean} entry.isDir - 是否为目录
 * @param {number} entry.index - 文件索引
 * @param {number} entry.total - 总文件数
 * @param {Object} entry.argv - 命令行参数
 * @returns {Promise<Object|null>} 处理后的文件对象，包含新路径信息
 */
async function preRename(entry) {
    const isDir = entry.isDir
    const typeFlag = isDir ? "D" : "F"
    const argv = entry.argv
    const progress = `${entry.index}/${entry.total}`
    const logTag = `PreRename${typeFlag} ${progress}`
    const oldPath = path.resolve(entry.path)
    const pathParts = path.parse(oldPath)
    const oldDir = pathParts.dir
    const oldBase = isDir ? pathParts.base : pathParts.name
    const ext = isDir ? "" : pathParts.ext
    let pendingDir = null
    let pendingBase = null
    let associatedExts = []

    const pathDepth = oldPath.split(path.sep).length
    log.info(logTag, `Processing "${oldPath} [${typeFlag}]"`)

    function makePath(...parts) {
        let joinedPath = path.join(...parts)
        if (core.isUNCPath(oldDir)) {
            joinedPath = "\\\\" + joinedPath
        }
        return joinedPath
    }
    if (argv.fixenc) {
        const result = fixEncoding({ oldPath, oldDir, oldBase, ext, logTag, progress })
        pendingDir = result.pendingDir
        pendingBase = result.pendingBase
    }
    if (argv.replace?.[0]?.length > 0) {
        const result = replaceStrings({ oldPath, oldDir, oldBase, ext, argv, logTag })
        pendingDir = pendingDir || result.pendingDir
        pendingBase = pendingBase || result.pendingBase
    }
    if (argv.clean) {
        const result = cleanFileNameHandler({ oldBase, argv, oldDir })
        pendingDir = pendingDir || result.pendingDir
        pendingBase = pendingBase || result.pendingBase
    }
    if (argv.zhcn) {
        const result = convertToZhCn({ pendingBase, pendingDir, oldBase, oldDir })
        pendingDir = result.pendingDir
        pendingBase = result.pendingBase
    }

    const mediaResult = await addMediaPrefixSuffix({
        oldPath,
        oldDir,
        oldBase: pendingBase || oldBase,
        argv,
        logTag,
    })
    pendingBase = mediaResult.pendingBase
    associatedExts = mediaResult.associatedExts

    if (argv.suffixDate) {
        const now = new Date()
        let dateStr = ""

        if (argv.suffixDate.includes("{")) {
            dateStr = formatDateTemplate(argv.suffixDate, now)
        } else {
            switch (argv.suffixDate.toLowerCase()) {
                case "yyyy-mm-dd":
                    dateStr = now.toISOString().split("T")[0]
                    break
                case "yyyymmdd":
                    dateStr = now.toISOString().split("T")[0].replace(/-/g, "")
                    break
                case "yyyymmdd-hhmmss":
                    dateStr = now.toISOString().replace(/[-:]/g, "").split(".")[0]
                    break
                case "yyyy-mm-dd-hhmmss":
                    dateStr = now.toISOString().replace("T", "-").split(".")[0]
                    break
                default:
                    dateStr = now.toISOString().split("T")[0]
            }
        }

        pendingBase = `${pendingBase}_${dateStr}`
        log.info(logTag, `SuffixDate: ${pendingBase || oldBase} => ${pendingBase}`)
    }

    if (argv.template) {
        const now = new Date()
        let templateStr = argv.template

        if (templateStr.includes("{")) {
            templateStr = formatDateTemplate(templateStr, now)
        }

        templateStr = templateStr.replace(/\{name\}/g, pendingBase || oldBase)
        templateStr = templateStr.replace(/\{original\}/g, oldBase)

        pendingBase = templateStr
        log.info(logTag, `Template: ${oldBase} => ${pendingBase}`)
    }

    if (argv.videoDimension && helper.isVideoFile(oldPath)) {
        try {
            const info = await getMediaInfo(oldPath)
            if (info?.video) {
                const { width, height } = info.video
                if (width && height) {
                    const dimension = `${width}x${height}`
                    const dimensionDir = path.join(oldDir, dimension)
                    pendingDir = dimensionDir
                    log.info(logTag, `VideoDimension: ${oldPath} => ${dimensionDir}`)
                } else {
                    log.showYellow(
                        logTag,
                        `VideoDimension: No valid resolution found for ${oldPath}`,
                    )
                }
            } else {
                log.showYellow(logTag, `VideoDimension: No video info found for ${oldPath}`)
            }
        } catch (error) {
            log.showYellow(
                logTag,
                `VideoDimension: Error getting media info for ${oldPath}: ${error.message}`,
            )
        }
    }

    if (argv.counter) {
        const counter = entry.counter
        const format = argv.counter
        let counterStr = format
        const match = format.match(/{(n+)}/)
        if (match) {
            const nPattern = match[1]
            const padLength = nPattern.length
            const formattedCounter = counter.toString().padStart(padLength, "0")
            counterStr = format.replace(`{${nPattern}}`, formattedCounter)
        }
        pendingBase = (pendingBase || oldBase) + counterStr
        log.info(logTag, `Counter: ${pendingBase || oldBase} => ${pendingBase}`)
    }

    if (argv.case) {
        let base = pendingBase || oldBase
        switch (argv.case.toLowerCase()) {
            case "upper":
                base = base.toUpperCase()
                break
            case "lower":
                base = base.toLowerCase()
                break
            case "title":
                base = base.replace(
                    /\w\S*/g,
                    (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(),
                )
                break
            case "sentence":
                base = base.charAt(0).toUpperCase() + base.substr(1).toLowerCase()
                break
        }
        pendingBase = base
        log.info(logTag, `Case: ${pendingBase || oldBase} => ${pendingBase}`)
    }

    if (argv.truncate) {
        const maxLength = argv.truncate
        const suffix = argv.truncateSuffix || "..."
        let base = pendingBase || oldBase
        if (base.length > maxLength) {
            const availableLength = maxLength - suffix.length
            if (availableLength > 0) {
                base = base.substring(0, availableLength) + suffix
            }
        }
        pendingBase = base
        log.info(logTag, `Truncate: ${pendingBase || oldBase} => ${pendingBase}`)
    }

    if (argv.addPrefix) {
        pendingBase = argv.addPrefix + (pendingBase || oldBase)
        log.info(logTag, `AddPrefix: ${pendingBase || oldBase} => ${pendingBase}`)
    }

    if (argv.addSuffix) {
        pendingBase = (pendingBase || oldBase) + argv.addSuffix
        log.info(logTag, `AddSuffix: ${pendingBase || oldBase} => ${pendingBase}`)
    }

    pendingDir = pendingDir || oldDir
    pendingBase = pendingBase || oldBase

    if (pendingBase.length === 0) {
        log.showYellow(logTag, `Revert: ${helper.pathShort(oldPath)}`)
        pendingBase = oldBase
    }

    pendingBase = helper.filenameSafe(pendingBase)
    let newBase = pendingBase
    let newDir = pendingDir || oldDir
    let finalExt = ext

    if (argv.changeExt && !isDir) {
        let newExt = argv.changeExt
        if (!newExt.startsWith(".")) {
            newExt = "." + newExt
        }
        finalExt = newExt
        log.info(logTag, `ChangeExt: ${ext} => ${finalExt}`)
    }

    if (argv.lowerExt && !isDir) {
        finalExt = finalExt.toLowerCase()
        log.info(logTag, `LowerExt: ${ext} => ${finalExt}`)
    }

    if (argv.upperExt && !isDir) {
        finalExt = finalExt.toUpperCase()
        log.info(logTag, `UpperExt: ${ext} => ${finalExt}`)
    }

    let newName = newBase + finalExt
    let newPath = path.resolve(path.join(newDir, newName))

    if (argv.mergeDirs) {
        newPath = mergePath(newPath)
    }

    const conflictResult = await handlePathConflicts({
        oldPath,
        newPath,
        pendingBase,
        ext: finalExt,
        newDir,
        logTag,
    })
    newPath = conflictResult.newPath
    entry.skipped = conflictResult.skipped
    if (entry.fixenc && enc.hasBadUnicode(newPath, true)) {
        const count = ++encodingErrorCount
        log.showGray(logTag, `BadEncFR:${count}`, oldPath)
        log.show(logTag, `BadEncTO:${count}`, newPath)
        log.fileLog(`BadEncFR: <${oldPath}>`, logTag)
        log.fileLog(`BadEncTO: <${newPath}>`, logTag)
        entry.skipped = true
        return
    }
    if (entry.skipped) {
        entry.outName = null
        entry.outPath = null
        return
    }
    entry.skipped = false
    entry.outPath = newPath
    entry.outName = newName
    entry.outBase = newBase
    entry.associatedExts = associatedExts
    log.showGray(logTag, `SRC: ${oldPath} ${pathDepth}`)
    log.show(logTag, `DST: ${newPath}`, chalk.yellow(associatedExts || ""))
    log.fileLog(`Add: <${oldPath}> [SRC]`, logTag)
    log.fileLog(`Add: <${newPath}> [DST]`, logTag)
    return entry
}
