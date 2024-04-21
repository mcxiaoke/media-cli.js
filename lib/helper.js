/*
 * File: helper.js
 * Created: 2021-07-20 17:04:29 +0800
 * Modified: 2024-04-09 22:13:41 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import crypto from 'crypto'
import dayjs from "dayjs"
import { promises as fsp } from "fs"
import fs from 'fs-extra'
import path from 'path'

const ARCHIVE_FORMATS = [
  ".7z",
  ".zip",
  ".rar",
  ".001",
  ".gz",
  ".xz",
  '.zst'
]

const IMAGE_FORMATS = [
  ".bmp",
  ".jpg",
  ".jpe",
  ".jpeg",
  ".jpm",
  ".jpx",
  ".jxl",
  ".png",
  ".avif",
  ".heic",
  ".heif",
  ".webp",
  ".tiff",
]
const RAW_FORMATS = [
  ".crw",
  ".cr2",
  ".cr3",
  ".nef",
  ".nrw",
  ".arw",
  ".srf",
  ".sr2",
  ".raw",
  ".rw2",
  ".raf",
  ".dng",
]

export const VIDEO_FORMATS = [".mp4", ".mov", ".wmv", ".avi", ".mkv", ".m4v", ".ts", ".flv", ".webm", ".rmvb", ".rm", ".vob", ".mpg"]

const AUDIO_NORMAL = [".aac", ".m4a", ".mp3", ".wma"]
const AUDIO_LOSSLESS = [".ape", ".flac", ".wav", ".tta", ".dts", ".tak"]
export const AUDIO_FORMATS = [...AUDIO_NORMAL, ...AUDIO_LOSSLESS]

export const HEVC_IMAGE_FORMATS = ['.heif', '.heic', ".avif"]

export const SUBTITLE_FORMATS = [".src", ".ass", ".stl"]

export const BOOK_FORMATS = [".epub", ".mobi", ".azw3", ".pdf"]

export const MEDIA_FORMATS = [...AUDIO_FORMATS, ...VIDEO_FORMATS]

export const FILE_TYPE_DEFAULT = 0
export const FILE_TYPE_IMAGE = 1
export const FILE_TYPE_VIDEO = 2
export const FILE_TYPE_AUDIO = 3
export const FILE_TYPE_BOOK = 4
export const FILE_TYPE_ARCHIVE = 5

export function isArchiveFile(filename) {
  return ARCHIVE_FORMATS.includes(pathExt(filename, true))
}

export function isImageFile(filename) {
  return IMAGE_FORMATS.includes(pathExt(filename, true))
}

export function isRawFile(filename) {
  return RAW_FORMATS.includes(pathExt(filename, true))
}

export const isHEVCImage = (filename) => HEVC_IMAGE_FORMATS.includes(pathExt(filename, true))

export function isVideoFile(filename) {
  return VIDEO_FORMATS.includes(pathExt(filename, true))
}

export function isAudioFile(filename) {
  return AUDIO_FORMATS.includes(pathExt(filename, true))
}
export function isAudioLossless(filename) {
  return AUDIO_LOSSLESS.includes(pathExt(filename, true))
}

export function isMediaFile(filename) {
  return MEDIA_FORMATS.includes(pathExt(filename, true))
}

export function isSubtitleFile(filename) {
  return SUBTITLE_FORMATS.includes(pathExt(filename, true))
}

export function isBookFile(filename) {
  return BOOK_FORMATS.includes(pathExt(filename, true))
}

export function getFileTypeByExt(filename) {
  const ext = pathExt(filename, true)
  if (IMAGE_FORMATS.includes(ext)) {
    return FILE_TYPE_IMAGE
  }
  else if (VIDEO_FORMATS.includes(ext)) {
    return FILE_TYPE_VIDEO
  } else if (AUDIO_FORMATS.includes(ext)) {
    return FILE_TYPE_AUDIO
  } else if (BOOK_FORMATS.includes(ext)) {
    return FILE_TYPE_BOOK
  } else if (ARCHIVE_FORMATS.includes(ext)) {
    return FILE_TYPE_ARCHIVE
  } else {
    return FILE_TYPE_DEFAULT
  }
}

// https://stackoverflow.com/questions/1144783/
// simple: str.split(search).join(replacement)
// or str = str.replace(/abc/g, '');
// function replaceAll(str, find, replace) {
//   return str.replace(new RegExp(find, 'g'), replace);
// }
export function escapeRegExp(string) {
  return string.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&")
  // $& means the whole matched string
}
export function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), "g"), replace)
}

// https://stackoverflow.com/questions/19700283/
export function humanTime(startMs, padStart = false) {
  let ms = Date.now() - startMs
  function pad(num) {
    return `${num}`.padStart(2, '0')
  }
  let asSeconds = ms / 1000

  let hours = undefined
  let minutes = Math.floor(asSeconds / 60)
  let seconds = Math.floor(asSeconds % 60)

  if (minutes > 59) {
    hours = Math.floor(minutes / 60)
    minutes %= 60
  }

  return hours
    ? `${padStart ? pad(hours) : hours}:${pad(minutes)}:${pad(seconds)}`
    : `${padStart ? pad(minutes) : minutes}:${pad(seconds)}`
}

/**
 * Format bytes as human-readable text.
 * 
 * @param bytes Number of bytes.
 * @param si True to use metric (SI) units, aka powers of 1000. False to use 
 *           binary (IEC), aka powers of 1024.
 * @param dp Number of decimal places to display.
 * 
 * @return Formatted string.
 */
export function humanSize(bytes, si = true, dp = 2) {
  const thresh = si ? 1000 : 1024
  if (Math.abs(bytes) < thresh) {
    return bytes + ' B'
  }
  const units = si
    ? ['kB', 'MB', 'GB', 'TB', 'PB']
    : ['KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let u = -1
  const r = 10 ** dp
  do {
    bytes /= thresh
    ++u
  } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1)
  return bytes.toFixed(dp) + '' + units[u]
}

export function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0B'
  const k = 1000
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function pathShort(ps, width = 60) {
  const s = path.resolve(ps)
  const n = unicodeLength(s)
  return n < width ? s : '...' + s.slice(width * -1)
}

export function pathSplit(fullpath) {
  const abspath = path.resolve(fullpath)
  // const filename = path.basename(abspath);
  // const d = path.dirname(abspath);
  // const e = path.extname(abspath);
  // const b = path.basename(filename, e);
  // dir,base,ext
  // return [d, b, e];
  //https://nodejs.org/api/path.html#path_path_parse_path
  const parts = path.parse(abspath)
  return [parts.dir, parts.name, parts.ext]
}

// 获取根目录路径，比如 C:\\
export function pathRoot(ps) {
  return path.parse(path.resolve(ps)).root
}

/**
 * 去掉输入路径的根目录，组合输出目录，生成新路径
 * 假设输入 'F:\\Temp\\JPEG\\202206\\DSCN2040.JPG'
 * 假设输出 'E:\\Temp\Test\\'
 * 那么结果 'E:\\Temp\\Test\\Temp\\JPEG\\202206\\DSCN2040_thumb.jpg'
 * @param {*} input 输入路径
 * @param {*} output 输出路径
 * @returns 生成新路径
 */
export function pathRewrite(input, output) {
  let segs = input.split(path.sep)
  segs = segs.slice(Math.max(1, segs.length - 3))
  return path.join(output, ...segs)
}

export function pathExt(filename, toLowerCase = true) {
  const ext = path.extname(filename)
  return toLowerCase ? ext?.toLowerCase() : ext
}

const REGEX_ILLEGAL_FILENAME = /[\x00-\x1F\x7F<>:"\/\\|?*]/gm
export function filenameSafe(name) {
  return name.replaceAll(REGEX_ILLEGAL_FILENAME, '')
}

export function getSafeDeletedDir(filepath) {
  const dtStr = dayjs().format("YYYYMMDD")
  const dir = path.join(pathRoot(filepath), 'Deleted_By_Mediac', dtStr)
  return path.resolve(dir)
}

// 安全删除文件，转移到Deleted目录，而不是永久删除，防止误删
// 安全删除的文件，移动后，保持原有目录结构
export async function safeRemove(filepath) {
  try {
    let deletedDir = getSafeDeletedDir(filepath)
    let parts = path.parse(filepath)
    let dirOriginal = path.relative(parts.root, parts.dir)
    deletedDir = path.join(deletedDir, dirOriginal)
    let deletedPath = path.join(deletedDir, path.basename(filepath))
    if (await fs.pathExists(deletedPath)) {
      deletedPath = path.join(deletedDir, "_", path.basename(filepath))
    }
    await fs.ensureDir(deletedDir)
    await fs.move(filepath, deletedPath)
  } catch (error) { }
}

// 复杂的长正侧，可以分离组合
export const combineRegex = (...parts) =>
  new RegExp(parts.map(x => (x instanceof RegExp) ? x.source : x).join(''), "i")

export const combineRegexG = (...parts) =>
  new RegExp(parts.map(x => (x instanceof RegExp) ? x.source : x).join(''), "ugi")

export async function isEmptyDir(dirPath) {
  // return (await fs.promises.readdir(dirPath)).length === 0;
  const dirIter = await fsp.opendir(dirPath)
  const { value, done } = await dirIter[Symbol.asyncIterator]().next()
  await dirIter.close()
  return !value
}

// 计算字符串长度，中文算2，英文算1
export function unicodeLength(str) {
  var len = 0
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c >= 0x3000 && c < 0x9fff) {
      len += 2
    }
    else if ((c >= 0x0001 && c <= 0x007e) || (0xff60 <= c && c <= 0xff9f)) {
      len++
    }
    else {
      len += 2
    }
  }
  return len
}

export function unicodeSlice(str, len) {
  var str_length = 0
  var str_len = 0
  str_cut = new String()
  str_len = str.length
  for (var i = 0; i < str_len; i++) {
    a = str.charAt(i)
    str_length++
    if (encodeURI(a).length > 4) {
      //中文字符的长度经编码之后大于4
      str_length++
    }
    str_cut = str_cut.concat(a)
    if (str_length >= len) {
      // str_cut = str_cut.concat("...");
      return str_cut
    }
  }
  //如果给定字符串小于指定长度，则返回源字符串；
  if (str_length < len) {
    return str
  }
}

export async function isExactSameFile(file1, file2) {
  const st1 = await fs.stat(file1)
  const st2 = await fs.stat(file2)
  if (st1.size !== st2.size) {
    return false
  }
  return await fileHashMD5(file1) === await fileHashMD5(file2)
}

export const textHash = (contents, algorithm = 'md5', length = 8) => crypto.createHash(algorithm).update(contents).digest("hex").slice(-1 * length)

export const fileHashMD5 = (filename) => fileHash(filename, 'md5')

export const fileHashSHA1 = (filename) => fileHash(filename, 'sha1')

export function fileHash(filename, algorithm = 'md5') {
  return new Promise((resolve, reject) => {
    // Algorithm depends on availability of OpenSSL on platform
    // Another algorithms: 'sha1', 'md5', 'sha256', 'sha512' ...
    let shasum = crypto.createHash(algorithm)
    try {
      let s = fs.ReadStream(filename)
      s.on('data', function (data) {
        shasum.update(data)
      })
      // making digest
      s.on('end', function () {
        const hash = shasum.digest('hex')
        return resolve(hash)
      })
    } catch (error) {
      return reject(`${algorithm} failed: ${error}`)
    }
  })
}