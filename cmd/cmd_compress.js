/*
 * File: cmd_compress.js
 * Created: 2024-03-15 20:42:41 +0800
 * Modified: 2024-04-09 22:13:38 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import * as cliProgress from "cli-progress"
import dayjs from "dayjs"
import fs from "fs-extra"
import inquirer from "inquirer"
import os, { cpus } from "os"
import pMap from "p-map"
import path from "path"
import sharp from "sharp"
import which from "which"
import config from "../lib/config.js"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { parseImageParams } from "../lib/query_parser.js"
import { applyFileNameRules, calculateScale, compressImage } from "./cmd_shared.js"

const LOG_TAG = "Compress"
export { aliases, builder, command, describe, handler }

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = t("compress.description")

const QUALITY_DEFAULT = 85
const SIZE_DEFAULT = 2048 // in kbytes
const WIDTH_DEFAULT = 6000
const SUFFIX_DEFAULT = "_Z4K"

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            // 核心压缩参数
            // 压缩后文件质量参数
            .option("quality", {
                alias: "q",
                type: "number",
                description: t("compress.quality"),
            })
            // 需要处理的最小文件大小（KB），小于此值的文件跳过
            .option("min-size", {
                alias: "s",
                type: "number",
                description: t("compress.size"),
            })
            // 输出图片最大宽度（长边），超过则等比缩小
            .option("max-width", {
                alias: "w",
                type: "number",
                description: t("compress.width"),
            })
            // 压缩后的文件后缀，默认为 _Z4K
            .option("suffix", {
                alias: "S",
                describe: t("compress.suffix"),
                type: "string",
                // default: "_Z4K",
            })
            // 优先级低于单独的各种参数
            // 图片处理参数，示例 q=85,w=6000,s=2048,suffix=_Z4K
            .option("config", {
                alias: "c",
                type: "string",
                description: t("compress.config"),
            })
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: t("option.common.output"),
                type: "string",
            })
            .option("keep-root", {
                alias: "R",
                describe: t("option.common.keepRoot"),
                type: "boolean",
                default: true,
            })
            // 文件过滤
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            // 默认启用正则模式，禁用则为字符串模式
            .option("regex", {
                alias: "r",
                type: "boolean",
                default: true,
                description: t("option.common.regex"),
            })
            // 需要处理的扩展名列表
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
            // 行为控制
            // 是否禁用文件名过滤规则，强制处理所有文件
            .option("force", {
                alias: "f",
                type: "boolean",
                default: false,
                description: t("compress.force"),
            })
            // 是否覆盖已存在的压缩后文件
            .option("overwrite", {
                alias: "O",
                type: "boolean",
                default: false,
                description: t("compress.override"),
            })
            .option("keep-metadata", {
                alias: "m",
                describe: t("option.common.keepMetadata"),
                type: "boolean",
                default: true,
            })
            // 危险操作：删除源文件
            // 压缩完成后删除原始文件
            .option("purge", {
                alias: "P",
                type: "boolean",
                default: false,
                description: t("compress.delete.source"),
            })
            // 仅删除原始文件（跳过压缩），用于补救忘加 --purge 的情况
            .option("purge-only", {
                type: "boolean",
                default: false,
                description: t("compress.delete.source.only"),
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
                default: false,
                description: t("option.common.doit"),
            })
    )
}

const handler = cmdCompress

/**
 * 解析并归一化命令行参数为内部配置对象
 * 合并默认配置、配置文件参数和命令行参数
 *
 * @param {Object} argv - yargs 命令行参数对象
 * @returns {Object} 归一化后的压缩配置对象
 */
function parseCompressOpts(argv) {
    const cfg = parseImageParams(argv.config)
    return {
        overwrite: argv.overwrite || false,
        quality: argv.quality || cfg.quality || QUALITY_DEFAULT,
        minFileSize: (argv.minSize || cfg.size || SIZE_DEFAULT) * 1024,
        maxWidth: argv.maxWidth || cfg.width || WIDTH_DEFAULT,
        suffix: argv.suffix || cfg.suffix || SUFFIX_DEFAULT,
        purgeOnly: argv.purgeOnly || false,
        purgeSource: argv.purge || false,
        keepRoot: argv.keepRoot ?? true,
        keepMetadata: argv.keepMetadata ?? true,
        force: argv.force || false,
        jobs: argv.jobs,
        output: argv.output,
        cfg: argv.config, // 透传给任务对象的原始配置字符串
    }
}

/**
 * 遍历目录，返回满足过滤条件的图片文件列表
 * 使用高性能的文件系统遍历，支持多种过滤条件
 *
 * @param {string} root - 根目录路径
 * @param {Object} opts - 配置对象，包含过滤条件
 * @param {number} opts.minFileSize - 最小文件大小限制
 * @param {boolean} opts.force - 是否强制处理所有文件（忽略缩略图过滤）
 * @returns {Promise<Array>} 符合条件的图片文件列表
 */
async function walkImageFiles(root, opts) {
    const { minFileSize, force } = opts
    const RE_THUMB = force ? /@_@/ : /Z4K|P4K|M4K|feature|web|thumb$/i
    const walkOpts = {
        needStats: true,
        entryFilter: (f) =>
            f.isFile &&
            helper.isImageFile(f.path) &&
            !RE_THUMB.test(f.path) &&
            f.size > minFileSize,
    }
    log.logProgress(LOG_TAG, "Walking files ...")
    return await mf.walk(root, walkOpts)
}

/**
 * 并行运行 preCompress，返回全量任务列表（含已跳过项）
 * @param {Array} files - 文件列表
 * @param {Object} opts - 配置对象
 * @returns {Promise<Array>}
 */
async function buildCompressTasks(files, opts) {
    const {
        suffix,
        quality,
        overwrite,
        maxWidth,
        keepRoot,
        keepMetadata,
        force,
        output,
        jobs,
        cfg,
    } = opts
    const needBar = files.length > 9999 && !log.isVerbose()
    const prepared = files.map((f, i) => ({
        ...f,
        force,
        output,
        total: files.length,
        index: i,
        suffix,
        quality,
        overwrite,
        maxWidth,
        cfg,
        keepRoot,
        keepMetadata,
    }))
    // 进度条和更新回调均局部于此函数，不污染任务对象
    let lastProgressUpdatedAt = 0
    let bar = null
    const onProgress = needBar
        ? (index) => {
              const now = Date.now()
              if (now - lastProgressUpdatedAt > 2000) {
                  bar.update(index)
                  lastProgressUpdatedAt = now
              }
          }
        : null
    if (needBar) {
        bar = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic)
        bar.start(prepared.length, 0)
    }
    const tasks = await pMap(prepared, (f) => preCompress(f, onProgress), {
        concurrency: jobs || cpus().length,
    })
    if (needBar) {
        bar.update(prepared.length)
        bar.stop()
    }
    return tasks
}

/**
 * 并行执行图片压缩，返回全部结果和失败列表
 * @param {Array} tasks - 待压缩任务列表
 * @param {Object} opts - 配置对象
 * @param {string} logTag - 日志标签
 * @param {number} startMs - 起始时间戳
 * @returns {Promise<{tasks: Array, failedTasks: Array}>}
 */
async function runCompression(tasks, opts, logTag, startMs) {
    tasks.forEach((f) => (f.startMs = startMs))
    const results = await pMap(tasks, compressImage, {
        concurrency: opts.jobs || cpus().length / 2,
    })
    const okTasks = results.filter((f) => f?.done)
    const failedTasks = results.filter((f) => f?.errorFlag && !f.done)
    log.logSuccess(
        LOG_TAG,
        `${okTasks.length} ${t("compress.files.compressed")} ${helper.humanTime(startMs)}`,
    )
    log.logSuccess(LOG_TAG, "endAt", dayjs().format(), helper.humanTime(startMs))
    return { tasks: results, failedTasks }
}

/**
 * 将失败的压缩任务列表写入日志文件
 * @param {Array} failedTasks - 失败任务列表
 * @param {string} root - 根目录（日志文件写入位置）
 * @param {string} logTag - 日志标签
 * @returns {Promise<void>}
 */
async function writeFailedLog(failedTasks, root, logTag) {
    if (failedTasks.length === 0) {
        return
    }
    log.logWarn(LOG_TAG, `${failedTasks.length} ${t("compress.tasks.failed")}`)
    const failedContent = failedTasks.map((f) => f.src).join("\n")
    const failedLogFile = path.join(
        root,
        `mediac_compress_failed_list_${dayjs().format("YYYYMMDDHHmmss")}.txt`,
    )
    await fs.writeFile(failedLogFile, failedContent)
    const clickablePath = failedLogFile.split(path.sep).join("/")
    log.logWarn(LOG_TAG, `${t("compress.failed.list")}: file:///${clickablePath}`)
}

/**
 * 图片压缩命令的主处理函数
 * 完整的图片压缩流程控制，包括文件遍历、参数解析、用户确认、压缩执行等
 *
 * @param {Object} argv - 命令行参数对象
 * @param {string} argv.input - 输入目录路径
 * @param {string} argv.output - 输出目录路径（可选）
 * @param {boolean} argv.doit - 是否执行实际操作（否则为测试模式）
 * @param {boolean} argv.overwrite - 是否覆盖已存在的文件
 * @param {number} argv.quality - 压缩质量（1-100）
 * @param {number} argv.minSize - 最小文件大小（KB），小于此值的文件跳过
 * @param {number} argv.maxWidth - 最大宽度，超过则等比缩小
 * @param {string} argv.suffix - 压缩后文件名后缀
 * @param {boolean} argv.purge - 压缩完成后是否删除源文件
 * @param {boolean} argv.purgeOnly - 仅删除源文件，不进行压缩
 * @param {number} argv.jobs - 并发任务数
 * @returns {Promise<void>}
 */
async function cmdCompress(argv) {
    const testMode = !argv.doit
    const root = await helper.validateInput(argv.input)
    if (!testMode) {
        log.fileLog(`Root:${root}`, LOG_TAG)
        log.fileLog(`Argv:${JSON.stringify(argv)}`, LOG_TAG)
    }
    log.logInfo(LOG_TAG, argv)

    const opts = parseCompressOpts(argv)
    const { minFileSize, maxWidth, purgeOnly, purgeSource } = opts
    log.logInfo(LOG_TAG, `input: ${root}`)

    let files = await walkImageFiles(root, opts)
    if (!files || files.length === 0) {
        log.logWarn(LOG_TAG, t("compress.no.files.found"))
        return
    }
    files = await applyFileNameRules(files, argv)
    log.logInfo(LOG_TAG, t("compress.total.files.found", { count: files.length }))
    if (!files || files.length === 0) {
        log.logWarn(LOG_TAG, t("common.nothing.to.do"))
        return
    }

    if (!purgeOnly) {
        await updateConfig(argv)
    }

    const confirmFiles = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.green(t("common.continue.processing")),
        },
    ])
    if (!confirmFiles.yes) {
        log.logWarn(LOG_TAG, t("common.aborted.by.user"))
        return
    }
    log.logSuccess(LOG_TAG, t("compress.preparing"))

    const startMs = Date.now()
    let tasks = await buildCompressTasks(files, opts)
    log.info(LOG_TAG, "before filter: ", tasks.length)
    const allValidTasks = tasks.filter(Boolean)
    tasks = tasks.filter((t) => t?.dst && t.tmpDst && !t?.shouldSkip)
    const skipped = allValidTasks.length - tasks.length
    log.info(LOG_TAG, "after filter: ", tasks.length)
    if (skipped > 0) {
        log.logWarn(LOG_TAG, t("compress.files.skipped", { count: skipped }))
    }

    if (purgeOnly) {
        const purgeTargets = allValidTasks.filter((t) => t?.src && t.dstExists && t.dst)
        if (purgeTargets.length === 0) {
            log.logWarn(LOG_TAG, t("common.nothing.to.do"))
            return
        }
        log.logWarn(LOG_TAG, `+++++ PURGE ONLY (NO COMPRESS): ${purgeTargets.length} files +++++`)
        await purgeSrcFiles(purgeTargets)
        return
    }

    if (tasks.length === 0) {
        log.logWarn(LOG_TAG, t("common.nothing.to.do"))
        return
    }
    tasks.forEach((f, i) => {
        f.total = tasks.length
        f.index = i
    })
    log.logInfo(LOG_TAG, `${t("compress.tasks.summary")} (${helper.humanTime(startMs)}):`)
    tasks.slice(-1).forEach((f) => {
        log.show(core.omit(f, "stats"))
    })
    log.info(LOG_TAG, argv)
    testMode && log.logWarn(LOG_TAG, `++++++++++ ${t("ffmpeg.test.mode")} ++++++++++`)

    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("compress.confirm", {
                    count: tasks.length,
                    sizeK: minFileSize / 1024,
                    maxWidth: maxWidth,
                    note: purgeSource ? t("compress.warning.delete") : t("compress.warning.keep"),
                }),
            ),
        },
    ])

    if (!answer.yes) {
        log.logWarn(LOG_TAG, t("common.aborted.by.user"))
        return
    }

    if (testMode) {
        log.logWarn(LOG_TAG, `[${t("mode.test")}], ${t("compress.note.no.thumbnail")}`)
    } else {
        const compressStartMs = Date.now()
        log.logSuccess(LOG_TAG, `startAt ${dayjs().format()}`)
        const { tasks: doneTasks, failedTasks } = await runCompression(
            tasks,
            opts,
            LOG_TAG,
            compressStartMs,
        )
        await writeFailedLog(failedTasks, root, LOG_TAG)
        if (purgeSource) {
            await purgeSrcFiles(doneTasks)
        }
    }
}

/**
 * 准备压缩图片的参数，并进行相应的处理
 * @param {Object} f - 文件对象
 * @param {string} f.path - 源文件路径
 * @param {number} f.size - 文件大小
 * @param {number} f.maxWidth - 最大宽度限制
 * @param {string} f.suffix - 压缩后文件名后缀
 * @param {number} f.index - 文件索引
 * @param {number} f.total - 总文件数
 * @param {string} f.output - 输出目录
 * @param {Function|null} onProgress - 进度回调，接收当前索引，为 null 则不显示进度
 * @returns {Promise<Object|null>} 返回准备好的压缩任务对象，或 null（文件损坏或不存在）
 */
async function preCompress(f, onProgress = null) {
    const maxWidth = f.maxWidth || 6000
    let fileSrc = path.resolve(f.path)
    const [fDir, base] = helper.pathSplit(fileSrc)
    const suffix = f.suffix || "_Z4K"
    log.info(LOG_TAG, "Processing ", fileSrc, suffix)

    let fileDstDir = f.output ? helper.pathRewrite(f.root, fDir, f.output, f.keepRoot) : fDir
    const tempSuffix = `_tmp@${helper.textHash(fileSrc)}@tmp_`
    const fileDstTmp = path.resolve(path.join(fileDstDir, `${base}${suffix}${tempSuffix}.jpg`))
    let fileDst = path.join(fileDstDir, `${base}${suffix}.jpg`)

    fileDst = path.resolve(fileDst)

    onProgress?.(f.index)

    if (!(await fs.pathExists(fileSrc))) {
        log.info(LOG_TAG, "File not found:", fileSrc)
        return
    }

    if (await fs.pathExists(fileDst)) {
        log.info(LOG_TAG, "exists:", fileDst)
        return {
            ...f,
            width: 0,
            height: 0,
            src: fileSrc,
            dst: fileDst,
            dstExists: true,
            shouldSkip: true,
            skipReason: "DST EXISTS",
        }
    }
    let [err, im] = await core.tryRunAsync(async () => {
        return await sharp(fileSrc).metadata()
    })

    if (err) {
        log.info(LOG_TAG, "Corrupt file:", fileSrc)
        log.fileLog(`SharpErr: ${f.index} <${fileSrc}> sharp:${err.message}`, LOG_TAG)
        return
    }

    const { dstWidth, dstHeight } = calculateScale(im.width, im.height, maxWidth)
    if (f.total < 1000 || f.index > f.total - 1000) {
        log.logTask(
            LOG_TAG,
            f.index,
            f.total,
            helper.pathShort(fileSrc),
            `${im.width}x${im.height}=>${dstWidth}x${dstHeight} ${im.format || im.type} ${helper.humanSize(f.size)}`,
        )
        log.showGray(LOG_TAG, `${f.index}/${f.total} DST:`, fileDst)
    }
    log.fileLog(
        `Pre: ${f.index}/${f.total} <${fileSrc}> ` +
            `${dstWidth}x${dstHeight}) ${helper.humanSize(f.size)}`,
        LOG_TAG,
    )
    return {
        ...f,
        srcWidth: im.width,
        srcHeight: im.height,
        width: dstWidth,
        height: dstHeight,
        src: fileSrc,
        dst: fileDst,
        tmpDst: fileDstTmp,
    }
}

/**
 * 删除已成功压缩后的源文件
 * @param {Array<Object>} results - 压缩任务结果数组
 * @returns {Promise<void>}
 */
async function purgeSrcFiles(results) {
    const toDelete = results.filter((t) => t?.src && t.dstExists && t.dst)
    const total = toDelete?.length ?? 0
    if (total <= 0) {
        return
    }
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(t("compress.delete.confirm", { count: total })),
        },
    ])
    if (!answer.yes) {
        log.logWarn(LOG_TAG, t("common.aborted.by.user"))
        return
    }
    const deletecFunc = async (td, index) => {
        const srcExists = await fs.pathExists(td.src)
        const dstExists = await fs.pathExists(td.dst)
        log.info(LOG_TAG, `Check S=${srcExists} D=${dstExists} ${helper.pathShort(td.src)}`)
        if (!(srcExists && dstExists)) {
            return
        }
        td.tmpDst && (await fs.pathExists(td.tmpDst)) && (await fs.remove(td.tmpDst))
        await helper.safeRemove(td.src)
        log.logWarn(LOG_TAG, `SafeDel: ${index}/${total} ${helper.pathShort(td.src)}`)
        log.fileLog(`SafeDel: <${td.src}>`, LOG_TAG)
        return td.src
    }
    const deleted = await pMap(toDelete, deletecFunc, { concurrency: cpus().length * 8 })
    log.logSuccess(LOG_TAG, t("compress.safely.removed", { count: deleted.filter(Boolean).length }))
}

async function updateConfig(argv) {
    // 检测是否有nconvert
    // 检测sharp是否支持heic2jpg
    // 使用一张测试图片转换试试
    try {
        const testPic = await helper.resolveAssetPath("assets/test.heic")
        const testTmp = path.join(os.tmpdir(), `mediac_test_${Date.now()}.jpg`)
        const s = sharp(testPic)
        const testOk = await s
            .jpeg({ quality: 70 })
            .toFile(testTmp)
            .then(
                () => true,
                () => false,
            )
        // 清理临时测试文件，无论成功与否
        await fs.remove(testTmp).catch(() => {})

        log.show(
            testOk
                ? chalk.greenBright("Sharp support HEIC")
                : chalk.redBright("Sharp do not support HEIC"),
        )
        // 更新全局变量，后面压缩图片时要用到
        config.SHARP_SUPPORT_HEIC = testOk
        config.NCONVERT_BIN_PATH = await which("nconvert", { nothrow: true })
        config.VIPS_BIN_PATH = await which("vips", { nothrow: true })
    } catch (error) {
        // 如果测试过程中发生错误，记录日志并继续执行
        log.error("cmdCompress", "Error update config:", error)
    }
}
