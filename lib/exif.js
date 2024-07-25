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
import exiftool from "exiftool-vendored"
import os, { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import * as log from './debug.js'
import * as mf from './file.js'
import * as helper from './helper.js'

const et = new exiftool.ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 500,
  minDelayBetweenSpawnMillis: 0,
  maxProcs: os.cpus().length * 4,
})

async function listMedia(root) {
  const files = await mf.walk(root, {
    needStats: true,
    entryFilter: (entry) =>
      entry.isFile &&
      entry.size > 1024 &&
      helper.isMediaFile(entry.name),
  })
  return files
}

async function readSingleExif(filename) {
  try {
    return await et.read(filename)
  } catch (error) {
    log.error(error)
  } finally {
    await et.end()
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
    try {
      const tags = await et.read(filename)
      // show exiftool error message
      if (tags.Error) {
        log.warn(`EXIF: err ${helper.pathShort(filename)} ${Error}`)
      }
      log.info(
        chalk.green(`EXIF(${i}/${t}):`),
        helper.pathShort(filename), tags?.Model || tags?.Software || tags.Make, selectDateTag(tags)[1]?.rawValue)
      f.tags = tags
    } catch (error) {
      log.warn(`EXIF: catch ${helper.pathShort(filename)} ${error}`)
    }
    return f
  }

  files = await pMap(files, readExifOne, { concurrency: cpus().length * 4 })
  bar1.stop()
  await et.end()
  log.show(
    `EXIF: ${files.length} files processed in ${helper.humanTime(
      startMs
    )}`
  )
  return files.filter((f) => f.tags)
}

function fixAppleTag(tags) {
  // iphone video must use CreationDate, not CreateDate
  //  CreationDate rawValue: '2021:06:21 10:22:47+08:00',
  // CreateDate rawValue: '2021:06:21 02:22:47',
  if (
    tags.MediaCreateDate &&
    tags.CreationDate instanceof exiftool.ExifDateTime &&
    tags.MajorBrand &&
    tags.MajorBrand.toLowerCase().includes("apple")
  ) {
    log.debug("fixAppleTag:", tags.SourceFile)
    return ["CreationDate", tags.CreationDate]
  }
}

function fix360Camera(tags) {
  // fix for video created by 360 camera
  if (tags.CompressorName === 'JVT/AVC/ZX Coding') {
    return ["FileModifyDate", tags.FileModifyDate]
  }
}

function fixScreenShot(tags) {
  return (
    helper.pathExt(tags.FileName, true) == "png" && [
      "FileModifyDate",
      tags.FileModifyDate,
    ]
  )
}

function hackAndFix(tags) {
  return fixAppleTag(tags) || fixScreenShot(tags) || fix360Camera(tags)
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
    "FileModifyDate",
  ]
  log.debug('selectDateTag', tags.SourceFile)
  for (const k of keys) {
    if (tags[k] instanceof exiftool.ExifDateTime) {
      const dt = tags[k]
      // fix nikon p950 no timezone info bug
      if (dt.zone === 'UTC') {
        dt.zone = "UTC+8"
        dt.zoneName = "UTC+8"
        dt.tzoffsetMinutes = 480 // 60*8 minutes
      }
      log.debug("selectDateTag", k, dt)
      return [k, dt]
    }
  }
}

function extractExifDate(file) {
  return (
    file?.tags && (hackAndFix(file.tags) || selectDateTag(file.tags))
  )
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
          model: f.tags && (f.tags.Model || f.tags.Make || f.tags.Software),
          // rawExif: exif,
        }
      )
    })
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
  const ext = helper.pathExt(file.path)
  const ms = (file.rawDate?.[1].millisecond) || 0
  // https://dayjs.gitee.io/docs/zh-CN/display/format
  const dateStr = dayjs(file.date).format("YYYYMMDD_HHmmss")
  let dstName = ms > 0 ? `${prefix}${dateStr}_${ms}${ext}` : `${prefix}${dateStr}${ext}`
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
    if (helper.isVideoFile(f.path) && f.size < 500 * 1024) {
      log.info(
        `Check [Size]:`,
        `${helper.pathShort(f.path)} <${helper.humanSize(f.size)}>`
      )
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
      outName == inName
      || inName.includes(outName)
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
    let dupSuffix = ["A", "B", "C", "D", "E", "F", "G", "H"]
    let dupIndex = 0
    while (duplicateSet.has(outName)) {
      outName = `${originalOutName}_${dupSuffix[dupIndex]}`
      outPath = path.join(path.dirname(f.path), outName + ext)
      dupIndex++
    }
    duplicateSet.add(outName)
    const newOutName = outName + ext
    if (f.outName != newOutName) {
      log.info(chalk.yellow(`Duplicated: ${f.outName} to ${newOutName}`))
    }
    f.outName = newOutName
    log.info(`Prepared:`, ` ${helper.pathShort(f.path)} ==> ${f.outName}`
    )
    return f
  })
  return [files, skippedBySize, skippedByDate]
}

export { buildNames, checkFiles, listMedia, parseFiles, readAllTags, readSingleExif, showExifDate }

