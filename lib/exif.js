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

function createExif() {
    return new exiftool.ExifTool({
        // taskTimeoutMillis: 5000,
        // maxTasksPerProcess: 500,
        maxProcs: os.cpus().length, // More concurrent processes
        minDelayBetweenSpawnMillis: 0, // Faster spawning
        streamFlushMillis: 10, // Faster streaming
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
        using etl = new exiftool.ExifTool()
        return await etl.read(filename)
    } catch (error) {
        log.error(error)
    }
}

async function showExifDate(filename) {
    log.show(readTags(filename) || `No exif tags found for ${filename}`)
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
        // try {
        using etl = createExif()
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
            const dt = tags.CreateDate
            dt.zone = "UTC"
            dt.zoneName = "UTC"
            dt.tzoffsetMinutes = 0
            return ["CreateDate", tags.CreateDate]
        }
    }
}

function fixP950Tag(tags) {
    // fix nikon p950 no timezone info bug
    if (tags.Model && tags.Model.toLowerCase().includes("p950")) {
        const dt = tags.DateTimeOriginal || tags.CreateDate || tags.MediaCreateDate
        if (dt.zone === "UTC") {
            dt.zone = "UTC+8"
            dt.zoneName = "UTC+8"
            dt.tzoffsetMinutes = 480 // 60*8 minutes
        }
        return ["DateTimeOriginal", dt]
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

function getDateTags(tags) {
    return Object.entries(tags).filter((entry) => {
        const [k, v] = entry
        return v instanceof exiftool.ExifDateTime
    })
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
            const dt = tags[k]
            log.debug("selectDateTag", k, dt)
            // hack fix for wrong timezone
            if (dt.zone === "UTC") {
                dt.setZone("UTC+8")
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
    let prefix
    if (helper.isImageFile(file.path)) {
        prefix = "IMG_"
    } else if (helper.isRawFile(file.path)) {
        prefix = "DSC_"
    } else if (helper.isVideoFile(file.path)) {
        prefix = "VID_"
    } else {
        prefix = "UNF_"
    }
    prefix = (file.namePrefix || "") + prefix
    const suffix = file.nameSuffix || ""
    const ext = helper.pathExt(file.path)
    const ms = file.rawDate?.[1].millisecond || 0
    // https://dayjs.gitee.io/docs/zh-CN/display/format
    const dateStr = dayjs(file.date).format("YYYYMMDD_HHmmss")
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

function checkFiles(files) {
    log.info(`checkFiles before filter: ${files.length} files`)
    const skippedByDate = []
    const skippedBySize = []
    files = files.filter((f) => {
        if (helper.isVideoFile(f.path) && f.size < 200 * 1024) {
            log.info(`Check [Size]:`, `${helper.pathShort(f.path)} <${helper.humanSize(f.size)}>`)
            skippedBySize.push(f)
            return false
        }
        if (f.date.getHours() < 7 && !helper.pathExt(f.path) === ".png") {
            const dateStr = dayjs(f.date).format("YYYY-MM-DD HH:mm:ss Z")
            log.warn(`Check [Date]:`, `${helper.pathShort(f.path)} <${dateStr}>`)
            skippedByDate.push(f)
            return false
        }
        const inName = path.basename(f.path, path.extname(f.path))
        const outName = path.basename(f.outName, path.extname(f.outName))
        // if name without extension is almost same, skip the file
        if (
            outName == inName ||
            inName.includes(outName)
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
        let outPath = path.join(path.dirname(f.path), outName + ext)
        let dupIndex = 0
        while (duplicateSet.has(outName) && dupIndex < 100) {
            const dupSuffixStr = String(dupIndex).padStart(2, "0")
            outName = `${originalOutName}_${dupSuffixStr}`
            outPath = path.join(path.dirname(f.path), outName + ext)
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

export { buildNames, checkFiles, listMedia, parseFiles, readAllTags, readSingleExif, showExifDate }
