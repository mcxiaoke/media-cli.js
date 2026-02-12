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
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import sharp from "sharp"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { parseImageParams } from "../lib/query_parser.mjs"
import { applyFileNameRules, calculateScale, compressImage } from "./cmd_shared.js"
import { t } from "../lib/i18n.js"

//
export { aliases, builder, command, describe, handler }

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = t("compress.description")

const QUALITY_DEFAULT = 86
const SIZE_DEFAULT = 2048 // in kbytes
const WIDTH_DEFAULT = 6000
const SUFFIX_DEFAULT = "_Z4K"

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .option("delete-source-files", {
                alias: "p",
                type: "boolean",
                default: false,
                description: t("compress.delete.source"),
            })
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: t("option.common.output"),
                type: "string",
            })
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
                alias: "re",
                type: "boolean",
                default: true,
                description: t("option.common.regex"),
            })
            // 需要处理的扩展名列表，默认为常见视频文件
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
            // 压缩后的文件后缀，默认为 _Z4K
            .option("suffix", {
                alias: "S",
                describe: t("compress.suffix"),
                type: "string",
                // default: "_Z4K",
            })
            .option("delete-source-files-only", {
                type: "boolean",
                default: false,
                description: t("compress.delete.source.only"),
            })
            // 是否覆盖已存在的压缩后文件
            .option("force", {
                type: "boolean",
                default: false,
                description: t("compress.force"),
            })
            // 是否覆盖已存在的压缩后文件
            .option("override", {
                type: "boolean",
                default: false,
                description: t("compress.override"),
            })
            // 压缩后文件质量参数
            .option("quality", {
                alias: "q",
                type: "number",
                description: t("compress.quality"),
            })
            // 需要处理的最小文件大小
            .option("size", {
                alias: "s",
                type: "number",
                description: t("compress.size"),
            })
            // 需要处理的图片最小尺寸
            .option("width", {
                alias: "w",
                type: "number",
                description: t("compress.width"),
            })
            // 优先级低于单独的各种参数
            // 图片处理参数，示例 q=85,w=6000,s=2048,suffix=_Z4K
            .option("config", {
                alias: "c",
                type: "string",
                description: t("compress.config"),
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

async function cmdCompress(argv) {
    const testMode = !argv.doit
    const logTag = "cmdCompress"
    const root = await helper.validateInput(argv.input)
    if (!testMode) {
        log.fileLog(`Root:${root}`, logTag)
        log.fileLog(`Argv:${JSON.stringify(argv)}`, logTag)
    }
    log.show(logTag, argv)
    const config = parseImageParams(argv.config)
    const override = argv.override || false
    const quality = argv.quality || config.quality || QUALITY_DEFAULT
    const minFileSize = (argv.size || config.size || SIZE_DEFAULT) * 1024
    const maxWidth = argv.width || config.width || WIDTH_DEFAULT
    const suffix = argv.suffix || config.suffix || SUFFIX_DEFAULT
    const purgeOnly = argv.deleteSourceFilesOnly || false
    const purgeSource = argv.deleteSourceFiles || false
    log.show(`${logTag} input:`, root)
    // 如果有force标志，就不过滤文件名
    const RE_THUMB = argv.force ? /@_@/ : /Z4K|P4K|M4K|feature|web|thumb$/i
    const walkOpts = {
        needStats: true,
        entryFilter: (f) =>
            f.isFile &&
            helper.isImageFile(f.path) &&
            !RE_THUMB.test(f.path) &&
            f.size > minFileSize,
    }
    log.showGreen(logTag, `Walking files ...`)
    let files = await mf.walk(root, walkOpts)
    if (!files || files.length === 0) {
        log.showYellow(logTag, t("compress.no.files.found"))
        return
    }
    // 应用文件名过滤规则
    files = await applyFileNameRules(files, argv)
    log.show(logTag, t("compress.total.files.found", { count: files.length }))
    if (!files || files.length === 0) {
        log.showYellow(t("common.nothing.to.do"))
        return
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
        log.showYellow(t("common.aborted.by.user"))
        return
    }
    const needBar = files.length > 9999 && !log.isVerbose()
    log.showGreen(logTag, t("compress.preparing"))
    let startMs = Date.now()
    const addArgsFunc = async (f, i) => {
        return {
            ...f,
            force: argv.force || false,
            output: argv.output,
            total: files.length,
            index: i,
            suffix,
            quality,
            override,
            maxWidth,
        }
    }
    files = await Promise.all(files.map(addArgsFunc))
    files.forEach((t, i) => {
        t.bar1 = bar1
        t.needBar = needBar
    })
    needBar && bar1.start(files.length, 0)
    let tasks = await pMap(files, preCompress, { concurrency: argv.jobs || cpus().length })
    needBar && bar1.update(files.length)
    needBar && bar1.stop()
    log.info(logTag, "before filter: ", tasks.length)
    const total = tasks.length
    tasks = tasks.filter((t) => t?.dst && t.tmpDst && !t?.shouldSkip)
    const skipped = total - tasks.length
    log.info(logTag, "after filter: ", tasks.length)
    if (skipped > 0) {
        log.showYellow(logTag, t("compress.files.skipped", { count: skipped }))
    }
    if (tasks.length === 0) {
        log.showYellow(t("common.nothing.to.do"))
        return
    }
    tasks.forEach((t, i) => {
        t.total = tasks.length
        t.index = i
        t.bar1 = null
        t.needBar = false
    })
    log.show(logTag, `${t('compress.tasks.summary')} (${helper.humanTime(startMs)}):`)
    tasks.slice(-1).forEach((t) => {
        log.show(core.omit(t, "stats", "bar1"))
    })
    log.info(logTag, argv)
    testMode && log.showYellow("++++++++++ " + t("ffmpeg.test.mode") + " ++++++++++")

    if (purgeOnly) {
        log.showYellow("+++++ PURGE ONLY (NO COMPRESS) +++++")
        await purgeSrcFiles(tasks)
        return
    }
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
                    note: purgeSource ? t("compress.warning.delete") : t("compress.warning.keep")
                })
            ),
        },
    ])

    if (!answer.yes) {
        log.showYellow(t("common.aborted.by.user"))
        return
    }

    if (testMode) {
        log.showYellow(logTag, `[${t("mode.test")}], ${t("compress.note.no.thumbnail")}`)
    } else {
        startMs = Date.now()
        log.showGreen(logTag, "startAt", dayjs().format())
        tasks.forEach((t) => (t.startMs = startMs))
        tasks = await pMap(tasks, compressImage, { concurrency: cpus().length / 2 })
        const okTasks = tasks.filter((t) => t?.done)
        const failedTasks = tasks.filter((t) => t?.errorFlag && !t.done)
        log.showGreen(logTag, `${okTasks.length} ${t("compress.files.compressed")} ${helper.humanTime(startMs)}`)
        log.showGreen(logTag, "endAt", dayjs().format(), helper.humanTime(startMs))
        if (failedTasks.length > 0) {
            log.showYellow(logTag, `${failedTasks.length} ${t("compress.tasks.failed")}`)
            const failedContent = failedTasks.map((t) => t.src).join("\n")
            const failedLogFile = path.join(
                root,
                `mediac_compress_failed_list_${dayjs().format("YYYYMMDDHHmmss")}.txt`,
            )
            await fs.writeFile(failedLogFile, failedContent)
            const clickablePath = failedLogFile.split(path.sep).join("/")
            log.showYellow(logTag, `${t("compress.failed.list")}: file:///${clickablePath}`)
        }
        if (purgeSource) {
            await purgeSrcFiles(tasks)
        }
    }
}

let compressLastUpdatedAt = 0
const bar1 = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic)
// 文心一言注释 20231206
// 准备压缩图片的参数，并进行相应的处理
async function preCompress(f) {
    const logTag = "PreCompress"
    const maxWidth = f.maxWidth || 6000 // 获取最大宽度限制，默认为6000
    let fileSrc = path.resolve(f.path) // 解析源文件路径
    const [dir, base, ext] = helper.pathSplit(fileSrc) // 将路径分解为目录、基本名和扩展名
    const suffix = f.suffix || "_Z4K"
    log.info(logTag, "Processing ", fileSrc, suffix)

    let fileDstDir = f.output ? helper.pathRewrite(f.root, dir, f.output, false) : dir
    const tempSuffix = `_tmp@${helper.textHash(fileSrc)}@tmp_`
    const fileDstTmp = path.resolve(path.join(fileDstDir, `${base}${suffix}${tempSuffix}.jpg`))
    // 构建目标文件路径，添加压缩后的文件名后缀
    let fileDst = path.join(fileDstDir, `${base}${suffix}.jpg`)

    fileSrc = path.resolve(fileSrc) // 解析源文件路径（再次确认）
    fileDst = path.resolve(fileDst) // 解析目标文件路径（再次确认）

    const timeNow = Date.now()
    if (timeNow - compressLastUpdatedAt > 2 * 1000) {
        f.needBar && f.bar1.update(f.index)
        compressLastUpdatedAt = timeNow
    }

    if (await fs.pathExists(fileDst)) {
        // 如果目标文件已存在，则进行相应的处理
        log.info(logTag, "exists:", fileDst)
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
        log.warn(logTag, "sharp", err.message, fileSrc)
        log.fileLog(`SharpErr: ${f.index} <${fileSrc}> sharp:${err.message}`, logTag)
        return
    }

    const { dstWidth, dstHeight } = calculateScale(im.width, im.height, maxWidth)
    if (f.total < 1000 || f.index > f.total - 1000) {
        log.show(
            logTag,
            `${f.index}/${f.total}`,
            helper.pathShort(fileSrc),
            `${im.width}x${im.height}=>${dstWidth}x${dstHeight} ${im.format || im.type} ${helper.humanSize(f.size)}`,
        )
        log.showGray(logTag, `${f.index}/${f.total} DST:`, fileDst)
    }
    log.fileLog(
        `Pre: ${f.index}/${f.total} <${fileSrc}> ` +
            `${dstWidth}x${dstHeight}) ${helper.humanSize(f.size)}`,
        logTag,
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

async function purgeSrcFiles(results) {
    const logTag = "Purge"
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
        log.showYellow(t("common.aborted.by.user"))
        return
    }
    const deletecFunc = async (td, index) => {
        const srcExists = await fs.pathExists(td.src)
        const dstExists = await fs.pathExists(td.dst)
        log.info(logTag, `Check S=${srcExists} D=${dstExists} ${helper.pathShort(td.src)}`)
        // 确认文件存在，确保不会误删除
        if (!(srcExists && dstExists)) {
            return
        }
        ;(await fs.pathExists(td.tmpDst)) && (await fs.remove(td.tmpDst))
        await helper.safeRemove(td.src)
        log.showYellow(logTag, `SafeDel: ${index}/${total} ${helper.pathShort(td.src)}`)
        log.fileLog(`SafeDel: <${td.src}>`, logTag)
        return td.src
    }
    const deleted = await pMap(toDelete, deletecFunc, { concurrency: cpus().length * 8 })
    log.showCyan(logTag, t("compress.safely.removed", { count: deleted.filter(Boolean).length }))
}
