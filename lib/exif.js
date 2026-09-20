/*
 * File: exif.js
 * Created: 2021-07-20 17:04:29 +0800
 * Modified: 2024-04-09 22:13:41 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import * as cliProgress from "cli-progress"
import dayjs from "dayjs"
import utc from "dayjs/plugin/utc.js"
import exiftool from "exiftool-vendored"
import os, { cpus } from "os"
import pMap from "p-map"
import path from "path"
import * as log from "./debug.js"
import * as mf from "./file.js"
import * as helper from "./helper.js"

dayjs.extend(utc)

/**
 * EXIF 数据缓存系统
 * 避免重复解析相同文件，提高处理性能
 * 使用文件路径和修改时间组合作为缓存键，确保文件变更时缓存失效
 */
const exifCache = new Map()

/**
 * 生成EXIF缓存键
 * 使用文件路径和修改时间戳组合，确保文件变更时能检测到
 *
 * @param {Object} file - 文件对象
 * @param {string} file.path - 文件路径
 * @param {Object} file.stats - 文件统计信息
 * @returns {string} 缓存键
 */
function getCacheKey(file) {
    return `${file.path}_${file.stats?.mtime.getTime() || 0}`
}

/**
 * 根据文件扩展名获取文件类型标识
 * 用于DCIM重命名时确定合适的前缀
 *
 * @param {string} filePath - 文件路径
 * @returns {string} 文件类型标识：IMG（图片）、RAW（原始图像）、VID（视频）、OTHER（其他）
 */
function getFileType(filePath) {
    if (helper.isImageFile(filePath)) {
        return "IMG"
    } else if (helper.isRawFile(filePath)) {
        return "RAW"
    } else if (helper.isVideoFile(filePath)) {
        return "VID"
    } else {
        return "OTHER"
    }
}

/**
 * 根据文件类型获取DCIM命名前缀
 * 标准DCIM命名规范：IMG_（图片）、DSC_（相机原始文件）、VID_（视频）
 *
 * @param {string} filePath - 文件路径
 * @param {string} customPrefix - 自定义前缀，将与标准前缀组合
 * @returns {string} 完整的文件前缀
 */
function getFilePrefix(filePath, customPrefix = "") {
    if (customPrefix) {
        return customPrefix
    }
    let prefix
    if (helper.isImageFile(filePath)) {
        prefix = "IMG_"
    } else if (helper.isRawFile(filePath)) {
        prefix = "DSC_"
    } else if (helper.isVideoFile(filePath)) {
        prefix = "VID_"
    } else {
        prefix = "UNF_"
    }
    return prefix
}

function createExif() {
    return new exiftool.ExifTool({
        // taskTimeoutMillis: 5000,
        // maxTasksPerProcess: 500,
        maxProcs: os.cpus().length, // More concurrent processes
        minDelayBetweenSpawnMillis: 0, // Faster spawning
        streamFlushMillis: 10, // Faster streaming
    })
}

/**
 * 进程内共享的 ExifTool 单例
 *
 * exiftool-vendored 官方推荐长驻单例：每个 ExifTool 实例内部自带进程池（maxProcs），
 * 如果按文件 new 一个实例，外层 pMap 并发 × 每实例 maxProcs 会使峰值进程数达到 cpus²。
 * 单例模式下进程池由 exiftool 自己调度，总量恒定。
 *
 * 说明：这里没有使用 `using` 声明式资源管理（需要 Node >= 24），
 * 改为在进程退出时统一 end()，以保持对 Node 18/20/22 的兼容性。
 */
let sharedExifTool = null
let sharedExifToolEnding = false

/**
 * 获取共享的 ExifTool 实例（惰性创建）
 * @returns {exiftool.ExifTool} 共享实例
 */
function getSharedExifTool() {
    if (!sharedExifTool) {
        sharedExifTool = createExif()
    }
    return sharedExifTool
}

/**
 * 关闭共享实例，释放 exiftool 子进程
 * 可重复调用；已关闭后再调用会重新创建一个新实例。
 * @returns {Promise<void>}
 */
async function endSharedExifTool() {
    if (!sharedExifTool || sharedExifToolEnding) {
        return
    }
    sharedExifToolEnding = true
    const etl = sharedExifTool
    sharedExifTool = null
    try {
        await etl.end()
    } catch (error) {
        log.debug("endSharedExifTool:", error?.message || error)
    } finally {
        sharedExifToolEnding = false
    }
}

// 进程正常退出 / 被信号中断时，确保 exiftool 子进程被回收，不残留 perl 进程
process.on("exit", () => {
    if (sharedExifTool) {
        sharedExifTool.end()?.catch?.(() => {})
        sharedExifTool = null
    }
})
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
        endSharedExifTool().finally(() => process.exit(1))
    })
}

async function listMedia(root) {
    const files = await mf.walk(root, {
        needStats: true,
        entryFilter: (entry) => entry.isFile && entry.size > 1024 && helper.isMediaFile(entry.name),
    })
    return files
}

async function readSingleExif(filename) {
    try {
        return await getSharedExifTool().read(filename)
    } catch (error) {
        log.error(error)
    }
}

async function showExifDate(filename) {
    log.show((await readSingleExif(filename)) || `No exif tags found for ${filename}`)
}

async function readAllTags(files) {
    // files => file list
    // or files => root
    // if (typeof files == "string") {
    //   files = listFiles(files);
    // }
    const t = files.length
    let startMs = Date.now()
    const bar1 = new cliProgress.SingleBar({ etaBuffer: 30 }, cliProgress.Presets.shades_classic)
    log.isVerbose() || bar1.start(t, 0)
    const readExifOne = async (f, i) => {
        const filename = f.path
        log.isVerbose() || bar1.increment()

        // 检查缓存中是否已有该文件的 EXIF 数据
        const cacheKey = getCacheKey(f)
        if (exifCache.has(cacheKey)) {
            log.debug(`EXIF Cache Hit: ${helper.pathShort(filename)}`)
            f.tags = exifCache.get(cacheKey)
            return f
        }

        // 复用进程内共享实例，避免每文件新建 ExifTool 导致 cpus² 个进程
        const etl = getSharedExifTool()
        const tags = await etl.read(filename)
        // show exiftool error message
        if (tags.Error) {
            // log.warn(`EXIF: err ${helper.pathShort(filename)} ${Error}`)
            log.error(tags.Error)
        }
        log.info(
            chalk.green(`EXIF(${i}/${t}):`),
            helper.pathShort(filename),
            tags?.Model || tags?.Software || tags.Make || "(Model)",
            extractExifDate(tags) || "(Date)",
        )
        f.tags = tags
        // 缓存 EXIF 数据
        exifCache.set(cacheKey, tags)
        // } catch (error) {
        // log.warn(`EXIF: catch ${helper.pathShort(filename)} ${error}`)
        // }
        return f
    }

    files = await pMap(files, readExifOne, { concurrency: cpus().length })
    bar1.stop()
    log.show(`EXIF: ${files.length} files processed in ${helper.humanTime(startMs)}`)
    return files.filter((f) => f.tags)
}

/**
 * 在保留「墙钟时间」的前提下给 ExifDateTime 打上时区标签，返回**新实例**。
 *
 * 这里要修的是「EXIF 没有记录时区、被 exiftool 默认成 UTC」的**标注**错误：
 * 照片实际拍摄于 08:11（北京时间），只是文件里没写 +08:00。因此墙钟时间
 * （hour/minute）必须原样保留，只把 zone 改对。
 *
 * 两个都不能用：
 *   1. `dt.zone = "UTC+8"` 直接赋值 —— `dt` 很可能就是 exifCache 里缓存的那一份，
 *      原地改写会把副作用泄漏给后续读取同一缓存条目的调用方（P2-6）。
 *   2. `dt.setZone("UTC+8")` —— 它是**不可变** API，返回新实例而非就地修改；
 *      而且语义是按目标时区换算**绝对时刻**（08:11 -> 16:11），与这里的意图相反。
 *      原代码 `dt.setZone("UTC+8")` 丢弃了返回值，等于这一修正从未生效，
 *      最终 `toDate()` + dayjs 本地格式化会得到差 8 小时的时间戳。
 *
 * @param {Object} dt - 源 ExifDateTime
 * @param {number} tzoffsetMinutes - 时区偏移（分钟）
 * @param {string} zoneName - 时区名
 * @returns {Object} 新的 ExifDateTime 实例
 */
function withZoneLabel(dt, tzoffsetMinutes, zoneName) {
    return new exiftool.ExifDateTime(
        dt.year,
        dt.month,
        dt.day,
        dt.hour,
        dt.minute,
        dt.second,
        dt.millisecond,
        tzoffsetMinutes,
        dt.rawValue,
        zoneName,
        dt.inferredZone,
    )
}

function fixAppleTag(tags) {
    // iphone video must use CreationDate, not CreateDate
    //  CreationDate rawValue: '2021:06:21 10:22:47+08:00',
    // CreateDate rawValue: '2021:06:21 02:22:47',
    if (tags.MajorBrand && tags.MajorBrand.toLowerCase().includes("apple")) {
        if (tags.MediaCreateDate && tags.CreationDate instanceof exiftool.ExifDateTime) {
            log.debug("fixAppleTag1:", tags.SourceFile)
            return ["CreationDate", tags.CreationDate]
        }
        if (tags.CreateDate instanceof exiftool.ExifDateTime) {
            log.debug("fixAppleTag2:", tags.SourceFile)
            // 原样保留墙钟时间，只把时区标注为 UTC（不污染缓存对象）
            return ["CreateDate", withZoneLabel(tags.CreateDate, 0, "UTC")]
        }
    }
}

function fixP950Tag(tags) {
    // fix nikon p950 no timezone info bug
    if (tags.Model && tags.Model.toLowerCase().includes("p950")) {
        const src = tags.DateTimeOriginal || tags.CreateDate || tags.MediaCreateDate
        if (!src) {
            return
        }
        if (src.zone === "UTC") {
            // 同样只改时区标注，不原地改写缓存里的对象
            return ["DateTimeOriginal", withZoneLabel(src, 480, "UTC+8")]
        }
        return ["DateTimeOriginal", src]
    }
}

function fix360Camera(tags) {
    // fix for video created by 360 camera
    if (tags.CompressorName === "JVT/AVC/ZX Coding") {
        return ["FileModifyDate", tags.FileModifyDate]
    }
}

function fixScreenShot(tags) {
    return helper.pathExt(tags.FileName, true) == "png" && ["FileModifyDate", tags.FileModifyDate]
}

function hackAndFix(tags) {
    return fixAppleTag(tags) || fixP950Tag(tags) || fixScreenShot(tags) || fix360Camera(tags)
}

function selectDateTag(tags) {
    // !!key order is important!!
    const keys = [
        "SubSecCreateDate",
        "SubSecDateTimeOriginal",
        "DateTimeOriginal",
        "CreationDate",
        "CreateDate",
        "ModifyDate",
        "MediaCreateDate",
        "MediaModifyDate",
        "TrackCreateDate",
        // "FileModifyDate",
    ]
    log.debug("selectDateTag", tags.SourceFile)
    for (const k of keys) {
        if (tags[k] instanceof exiftool.ExifDateTime) {
            let dt = tags[k]
            log.debug("selectDateTag", k, dt)
            // hack fix for wrong timezone
            //
            // 原写法 `dt.setZone("UTC+8")` 有两个问题：setZone 是不可变 API
            // （返回值被丢弃 → 修正从未生效），且它的语义是按目标时区换算绝对时刻。
            // 这里要修的是「EXIF 未记录时区、被 exiftool 默认成 UTC」的标注错误，
            // 墙钟时间必须原样保留，因此走 withZoneLabel（同时避免污染 exifCache）。
            if (dt.zone === "UTC") {
                dt = withZoneLabel(dt, 480, "UTC+8")
            }
            log.debug(tags.SourceFile, dt.hour, k, dt)
            return [k, dt]
        }
    }
}

function extractExifDate(file) {
    return file?.tags && (hackAndFix(file.tags) || selectDateTag(file.tags))
}

async function parseFiles(files, options) {
    log.info(`parseFiles`, options)
    options = options || {}
    // fast mode, skip exif parse
    if (options.fastMode) {
        return files.map((f) => {
            const date = f.stats.mtime
            log.debug(`parseFiles`, ` ${f.path} ${date}`)
            return (
                date && {
                    path: f.path,
                    root: f.root,
                    size: f.stats.size,
                    date: f.stats.mtime,
                }
            )
        })
    }
    // extract date from exif data
    let startMs = Date.now()
    files = await readAllTags(files)
    files = await Promise.all(
        files.map(async (f) => {
            const date = extractExifDate(f)
            log.debug(`parseFiles`, ` ${f.path} ${date}`)
            return (
                date && {
                    path: f.path,
                    root: f.root,
                    size: f.size,
                    date: date[1].toDate(),
                    rawDate: date,
                    model:
                        f.tags &&
                        (f.tags.Model ||
                            f.tags.Make ||
                            f.tags.MajorBrand ||
                            f.tags.HandlerVendorID),
                    // rawExif: exif,
                }
            )
        }),
    )
    log.info(`parseFiles ${files.length} in ${helper.humanTime(startMs)}`)
    return files.filter(Boolean)
}

// new name by exif date time
// eg. DSC_20210119_111546.ARW
// eg. IMG_20210121_174456.JPG
function createNameByDate(file) {
    // create file name by exif date
    const prefix = getFilePrefix(file.path, file.namePrefix || "")
    const suffix = file.nameSuffix || ""
    const ext = helper.pathExt(file.path)
    const ms = file.rawDate?.[1].millisecond || 0
    // 使用自定义模板，默认为 YYYYMMDD_HHmmss
    const template = file.nameTemplate || "YYYYMMDD_HHmmss"
    // https://dayjs.gitee.io/docs/zh-CN/display/format
    let dateStr = dayjs(file.date).format(template)

    // 支持额外的模板变量
    if (dateStr.includes("{model}") && file.model) {
        // 清理模型名称，去除特殊字符
        const cleanModel = file.model.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 10)
        dateStr = dateStr.replace(/{model}/g, cleanModel)
    }

    if (dateStr.includes("{type}")) {
        const type = getFileType(file.path)
        dateStr = dateStr.replace(/{type}/g, type)
    }

    // console.log(file.path, dateStr, file.date)
    let dstName =
        ms > 0 ? `${prefix}${dateStr}_${ms}${suffix}${ext}` : `${prefix}${dateStr}${suffix}${ext}`
    file["outName"] = dstName
    log.debug(`createNameByDate ${helper.pathShort(file.path)} ${file.outName}`)
    return file
}

function buildNames(files) {
    let startMs = Date.now()
    const newFiles = files.map((f) => createNameByDate(f))
    log.debug(`buildNames time: ${Date.now() - startMs}`)
    return newFiles
}

function checkFiles(files, checkDate = true) {
    log.info(`checkFiles before filter: ${files.length} files`)
    const skippedByDate = []
    const skippedBySize = []
    files = files.filter((f) => {
        if (helper.isVideoFile(f.path) && f.size < 200 * 1024) {
            log.info(`Check [Size]:`, `${helper.pathShort(f.path)} <${helper.humanSize(f.size)}>`)
            skippedBySize.push(f)
            return false
        }
        if (checkDate && f.date.getHours() < 7 && helper.pathExt(f.path) !== ".png") {
            const dateStr = dayjs(f.date).format("YYYY-MM-DD HH:mm:ss Z")
            log.warn(`Check [Date]:`, `${helper.pathShort(f.path)} <${dateStr}>`)
            skippedByDate.push(f)
            return false
        }
        const inName = path.basename(f.path, path.extname(f.path))
        const outName = path.basename(f.outName, path.extname(f.outName))
        // if name without extension is almost same, skip the file
        if (
            outName == inName
            // inName.includes(outName)
            // || outName.includes(inName)
        ) {
            log.debug(`Skip [Name]: ${helper.pathShort(f.path)} <${f.outName}>`)
            return false
        } else {
            return true
        }
    })
    log.info(`checkFiles after filter: ${files.length} files`)
    // check name duplicate conficts and using name suffix
    const duplicateSet = new Set()
    files = files.map((f) => {
        const name = path.basename(f.path)
        const ext = helper.pathExt(name)
        const originalOutName = path.basename(f.outName, ext)
        let outName = originalOutName
        let dupIndex = 0
        while (duplicateSet.has(outName) && dupIndex < 100) {
            const dupSuffixStr = String(dupIndex).padStart(2, "0")
            outName = `${originalOutName}_${dupSuffixStr}`
            dupIndex++
        }
        duplicateSet.add(outName)
        const newOutName = outName + ext
        if (f.outName != newOutName) {
            log.info(chalk.yellow(`Duplicated: ${f.outName} to ${newOutName}`))
        }
        f.outName = newOutName
        log.info(`Prepared:`, ` ${helper.pathShort(f.path)} ==> ${f.outName}`)
        return f
    })
    return [files, skippedBySize, skippedByDate]
}

export {
    buildNames,
    checkFiles,
    createExif,
    endSharedExifTool,
    getSharedExifTool,
    listMedia,
    parseFiles,
    readAllTags,
    readSingleExif,
    showExifDate,
}
