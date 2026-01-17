/*
 * File: cmd_compress.js
 * Created: 2024-03-15 20:42:41 +0800
 * Modified: 2024-04-09 22:13:38 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import assert from "assert"
import chalk from "chalk"
import * as cliProgress from "cli-progress"
import dayjs from "dayjs"
import exif from "exif-reader"
import fs from "fs-extra"
import imageSizeOfSync from "image-size"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import sharp from "sharp"
import util from "util"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import * as tryfp from "../lib/tryfp.js"
import { applyFileNameRules, calculateScale, compressImage } from "./cmd_shared.js"

//
export { aliases, builder, command, describe, handler }

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = "Compress input images to target size"

const QUALITY_DEFAULT = 86
const SIZE_DEFAULT = 2048 // in kbytes
const WIDTH_DEFAULT = 6000

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .option("delete-source-files", {
                alias: "p",
                type: "boolean",
                default: false,
                description: "Delete original image files after compress",
            })
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: "Folder store ouput files",
                type: "string",
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: "filename include pattern",
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: "filename exclude pattern ",
            })
            // 默认启用正则模式，禁用则为字符串模式
            .option("regex", {
                alias: "re",
                type: "boolean",
                default: true,
                description: "match filenames by regex pattern",
            })
            // 需要处理的扩展名列表，默认为常见视频文件
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: "include files by extensions (eg. .wav|.flac)",
            })
            // 压缩后的文件后缀，默认为 _Z4K
            .option("suffix", {
                alias: "S",
                describe: "filename suffix for compressed files",
                type: "string",
                default: "_Z4K",
            })
            .option("delete-source-files-only", {
                type: "boolean",
                default: false,
                description: "Just delete original image files only, no compression",
            })
            // 是否覆盖已存在的压缩后文件
            .option("force", {
                type: "boolean",
                default: false,
                description: "Force compress all files",
            })
            // 是否覆盖已存在的压缩后文件
            .option("override", {
                type: "boolean",
                default: false,
                description: "Override existing dst files",
            })
            // 压缩后文件质量参数
            .option("quality", {
                alias: "q",
                type: "number",
                default: QUALITY_DEFAULT,
                description: "Target image file compress quality",
            })
            // 需要处理的最小文件大小
            .option("size", {
                alias: "s",
                type: "number",
                default: SIZE_DEFAULT,
                description: "Processing file bigger than this size (unit:k)",
            })
            // 需要处理的图片最小尺寸
            .option("width", {
                alias: "w",
                type: "number",
                default: WIDTH_DEFAULT,
                description: "Max width of long side of image thumb",
            })
            // 并行操作限制，并发数，默认为 CPU 核心数
            .option("jobs", {
                alias: "j",
                describe: "multi jobs running parallelly",
                type: "number",
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: "execute os operations in real mode, not dry run",
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
    const override = argv.override || false
    const quality = argv.quality || QUALITY_DEFAULT
    const minFileSize = (argv.size || SIZE_DEFAULT) * 1024
    const maxWidth = argv.width || WIDTH_DEFAULT
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
        log.showYellow(logTag, "no files found, abort.")
        return
    }
    // 应用文件名过滤规则
    files = await applyFileNameRules(files, argv)
    log.show(logTag, `total ${files.length} files found (all)`)
    if (!files || files.length === 0) {
        log.showYellow("Nothing to do, abort.")
        return
    }
    const confirmFiles = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.green(`Press y to continue processing...`),
        },
    ])
    if (!confirmFiles.yes) {
        log.showYellow("Will do nothing, aborted by user.")
        return
    }
    const needBar = files.length > 9999 && !log.isVerbose()
    log.showGreen(logTag, `preparing compress arguments...`)
    let startMs = Date.now()
    const addArgsFunc = async (f, i) => {
        return {
            ...f,
            force: argv.force || false,
            suffix: argv.suffix,
            output: argv.output,
            total: files.length,
            index: i,
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
    let tasks = await pMap(files, preCompress, { concurrency: argv.jobs || cpus().length * 4 })
    needBar && bar1.update(files.length)
    needBar && bar1.stop()
    log.info(logTag, "before filter: ", tasks.length)
    const total = tasks.length
    tasks = tasks.filter((t) => t?.dst && t.tmpDst && !t?.shouldSkip)
    const skipped = total - tasks.length
    log.info(logTag, "after filter: ", tasks.length)
    if (skipped > 0) {
        log.showYellow(logTag, `${skipped} image files skipped`)
    }
    if (tasks.length === 0) {
        log.showYellow("Nothing to do, abort.")
        return
    }
    tasks.forEach((t, i) => {
        t.total = tasks.length
        t.index = i
        t.bar1 = null
        t.needBar = false
    })
    log.show(logTag, `in ${helper.humanTime(startMs)} tasks:`)
    tasks.slice(-1).forEach((t) => {
        log.show(core.omit(t, "stats", "bar1"))
    })
    log.info(logTag, argv)
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")

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
                `Are you sure to compress ${tasks.length} files? \n[Apply to files bigger than ${minFileSize / 1024}K, target long width is ${maxWidth}] \n${purgeSource ? "(Attention: you choose to delete original file!)" : "(Will keep original file)"}`,
            ),
        },
    ])

    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.")
        return
    }

    if (testMode) {
        log.showYellow(logTag, `[DRY RUN], no thumbs generated.`)
    } else {
        startMs = Date.now()
        log.showGreen(logTag, "startAt", dayjs().format())
        tasks.forEach((t) => (t.startMs = startMs))
        tasks = await pMap(tasks, compressImage, { concurrency: cpus().length / 2 })
        const okTasks = tasks.filter((t) => t?.done)
        const failedTasks = tasks.filter((t) => t?.errorFlag && !t.done)
        log.showGreen(logTag, `${okTasks.length} files compressed in ${helper.humanTime(startMs)}`)
        log.showGreen(logTag, "endAt", dayjs().format(), helper.humanTime(startMs))
        if (failedTasks.length > 0) {
            log.showYellow(logTag, `${okTasks.length} tasks are failed`)
            const failedContent = failedTasks.map((t) => t.src).join("\n")
            const failedLogFile = path.join(
                root,
                `mediac_compress_failed_list_${dayjs().format("YYYYMMDDHHmmss")}.txt`,
            )
            await fs.writeFile(failedLogFile, failedContent)
            const clickablePath = failedLogFile.split(path.sep).join("/")
            log.showYellow(logTag, `failed filenames: file:///${clickablePath}`)
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
        ;[err, im] = await tryfp.tryCatchAsync(util.promisify(imageSizeOfSync))(fileSrc)
    } else {
        if (im?.exif) {
            log.info(logTag, "force:", fileDst)
            const [err, iexif] = tryfp.tryCatch(exif)(im.exif)
            // 跳过以前由mediac压缩过的图片，避免重复压缩
            if (!f.force && iexif?.Image) {
                const md = iexif?.Image
                if (
                    md?.Copyright?.includes("mediac") ||
                    md.Software?.includes("mediac") ||
                    (md.Artist?.includes("mediac") && !f.force)
                ) {
                    log.info(logTag, "skip:", fileDst)
                    return {
                        ...f,
                        width: 0,
                        height: 0,
                        src: fileSrc,
                        dst: fileDst,
                        shouldSkip: true,
                        skipReason: "MEDIAC MAKE",
                    }
                }
            }
        }
    }

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
            message: chalk.bold.red(`Are you sure to delete ${total} original files?`),
        },
    ])
    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.")
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
    log.showCyan(logTag, `${deleted.filter(Boolean).length} files are safely removed`)
}
