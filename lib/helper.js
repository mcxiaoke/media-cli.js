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
import prettyBytes from 'pretty-bytes'
import prettyMilliseconds from 'pretty-ms'

const ARCHIVE_FORMATS = [
  ".7z",
  ".zip",
  ".rar",
  ".001",
  ".iso",
  ".gz",
]

const IMAGE_FORMATS = [
  ".jpg",
  ".jpe",
  ".jpeg",
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

const VIDEO_FORMATS = [".mp4", ".mov", ".wmv", ".avi", ".mkv", ".m4v", ".ts", ".flv", ".webm", ".rmvb", ".rm", ".vob"]

const AUDIO_FORMATS = [".aac", ".m4a", ".mp3", ".wma", ".flac", ".wav"]

const HEVC_IMAGE_FORMATS = ['.heif', '.heic', ".avif"]

const SUBTITLE_FORMATS = [".src", ".ass", ".stl"]

const BOOK_FORMATS = [".epub", ".mobi", ".azw3", ".pdf"]

const MEDIA_FORMATS = [...RAW_FORMATS, ...IMAGE_FORMATS, ...VIDEO_FORMATS]

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

export function humanTime(startMs) {
  let milliseconds = Date.now() - startMs
  return prettyMilliseconds(milliseconds)
}

export function humanSize(sizeNum, options = {}) {
  return prettyBytes(sizeNum, options)
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

export function pathExt(filename, toLowerCase = false) {
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


// https://www.npmjs.com/package/underscore
export const _pick = (obj, ...keys) => Object.fromEntries(
  keys
    .filter(key => key in obj)
    .map(key => [key, obj[key]])
)

export const _ipick = (obj, ...keys) => Object.fromEntries(
  keys.map(key => [key, obj[key]])
)

export const _omit = (obj, ...keys) => Object.fromEntries(
  Object.entries(obj)
    .filter(([key]) => !keys.includes(key))
)

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

export const textHash = (contents, algorithm = 'md5') => crypto.createHash(algorithm).update(contents).digest("hex")

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