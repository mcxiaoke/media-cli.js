/*
 * File: helper.js
 * Created: 2021-07-20 17:04:29 +0800
 * Modified: 2024-04-09 22:13:41 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import crypto from "crypto"
import dayjs from "dayjs"
import { execa, execaSync } from "execa"
import { promises as fsp } from "fs"
import fs from "fs-extra"
import { xxHash32 } from "js-xxhash"
import path from "path"
const ARCHIVE_FORMATS = [".7z", ".zip", ".rar", ".001", ".gz", ".xz", ".zst"]

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
    ".tif",
    ".psd",
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

export const VIDEO_FORMATS = [
    ".mp4",
    ".mov",
    ".wmv",
    ".avi",
    ".mkv",
    ".m4v",
    ".ts",
    ".flv",
    ".webm",
    ".rmvb",
    ".rm",
    ".vob",
    ".mpg",
]

const AUDIO_NORMAL = [".aac", ".m4a", ".mp3", ".wma"]
const AUDIO_LOSSLESS = [".ape", ".flac", ".wav", ".tta", ".dts", ".tak"]
export const AUDIO_FORMATS = [...AUDIO_NORMAL, ...AUDIO_LOSSLESS]

export const EXTERNAL_IMAGE_FORMATS = [".heif", ".heic", ".avif", ".bmp", ".psd"]

export const SUBTITLE_FORMATS = [".src", ".ass", ".stl"]

export const BOOK_FORMATS = [".epub", ".mobi", ".azw3", ".pdf"]

export const MEDIA_FORMATS = [...IMAGE_FORMATS, ...RAW_FORMATS, ...AUDIO_FORMATS, ...VIDEO_FORMATS]

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

export const isExternalImage = (filename) =>
    EXTERNAL_IMAGE_FORMATS.includes(pathExt(filename, true))

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
    } else if (VIDEO_FORMATS.includes(ext)) {
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
export function humanTime2(startMs, padStart = false) {
    let ms = Date.now() - startMs
    function pad(num) {
        return `${num}`.padStart(2, "0")
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

export function humanTime(startMs, dp = 0) {
    return humanDuration(Date.now() - startMs, dp)
}

export function humanSeconds(seconds, dp = 0) {
    return humanDuration(seconds * 1000, dp)
}

/**
 * 将毫秒数格式化为人类可读的时间持续时间格式
 * 自动选择合适的单位（年、天、小时、分钟、秒、毫秒）
 *
 * @param {number} milliseconds - 毫秒数
 * @param {number} dp - 秒的小数位数
 * @returns {string} 格式化后的时间字符串
 *
 * @example
 * humanDuration(500) // 返回 "500ms"
 * humanDuration(65000) // 返回 "1m 5.0s"
 * humanDuration(3661000) // 返回 "1h 1m 1.0s"
 */
export function humanDuration(milliseconds, dp = 0) {
    // 不足一秒，直接返回毫秒
    if (milliseconds < 1000) {
        return milliseconds + "ms"
    }

    let temp = milliseconds / 1000  // 转换为秒

    // 计算各个时间单位
    // 31536000 = 365天 * 24小时 * 3600秒
    const years = Math.floor(temp / 31536000)
    temp %= 31536000  // 使用模运算更新剩余秒数

    // 86400 = 24小时 * 3600秒
    const days = Math.floor(temp / 86400)
    temp %= 86400

    // 3600 = 60分钟 * 60秒
    const hours = Math.floor(temp / 3600)
    temp %= 3600

    // 60 = 60秒
    const minutes = Math.floor(temp / 60)
    const seconds = temp % 60

    // 如果有任何大于秒的单位，构建格式化的时间字符串
    if (days || hours || seconds || minutes) {
        return (
            (years ? years + "y " : "") +      // 年份，后面加空格
            (days ? days + "d" : "") +         // 天数
            (hours ? hours + "h" : "") +       // 小时
            (minutes ? minutes + "m" : "") +   // 分钟
            Number.parseFloat(seconds).toFixed(dp) + "s"  // 秒数，带指定小数位
        )
    }

    return "< 1s"  // 理论上不会执行到这里
}

/**
 * 将字节数格式化为人类可读的文本格式
 * 支持公制（SI）和二进制（IEC）两种单位标准
 *
 * @param {number} bytes - 字节数
 * @param {boolean} si - true使用公制单位（1000为基数），false使用二进制单位（1024为基数）
 * @param {number} dp - 显示的小数位数
 * @returns {string} 格式化后的字符串
 *
 * @example
 * humanSize(1500) // 返回 "1.50 kB"
 * humanSize(1500, false) // 返回 "1.46 KiB"
 * humanSize(1024, true, 0) // 返回 "1 kB"
 */
export function humanSize(bytes, si = true, dp = 2) {
    const thresh = si ? 1000 : 1024
    if (Math.abs(bytes) < thresh) {
        return bytes + " B"
    }
    const units = si ? ["kB", "MB", "GB", "TB", "PB"] : ["KiB", "MiB", "GiB", "TiB", "PiB"]
    let u = -1
    const r = 10 ** dp
    do {
        bytes /= thresh
        ++u
    } while (Math.round(Math.abs(bytes) * r) / r >= thresh && u < units.length - 1)
    return bytes.toFixed(dp) + "" + units[u]
}

export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return "0B"
    const k = 1000
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

export function pathShort(ps, width = 60) {
    const s = path.resolve(ps)
    const n = unicodeLength(s)
    return n < width || s.length < width ? s : "~" + s.slice(width * -1)
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

export function pathParts(fullpath) {
    const abspath = path.resolve(fullpath)
    //https://nodejs.org/api/path.html#path_path_parse_path
    return path.parse(abspath)
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
export function pathRewriteOld(input, output) {
    // \\nas\g\Others UNC路径split后第一段为空字符串
    let segs = input.split(path.sep).filter(Boolean)
    // segs = segs.slice(Math.max(1, segs.length - 4))
    // 修改，固定去掉路径的最前两端
    segs = segs.slice(2)
    return path.join(output, ...segs)
}

/**
 * 路径重写函数 - 将输入路径相对于根目录的相对路径组合到输出目录
 * 用于在保持目录结构的同时将文件从一个位置移动到另一个位置
 *
 * @param {string} root - 根目录路径
 * @param {string} input - 输入文件/目录的完整路径
 * @param {string} output - 输出目录路径
 * @param {boolean} keepRoot - 是否保留根目录的父目录结构
 * @returns {string} 重写后的完整输出路径
 *
 * @example
 * // keepRoot = true 的情况
 * pathRewrite('\\server\share\data', '\\server\share\data\folder\file.txt', 'D:\output', true)
 * // 返回: 'D:\output\data\folder\file.txt'
 *
 * // keepRoot = false 的情况
 * pathRewrite('\\server\share\data', '\\server\share\data\folder\file.txt', 'D:\output', false)
 * // 返回: 'D:\output\folder\file.txt'
 */
export function pathRewrite(root, input, output, keepRoot = true) {
    // 计算输入路径相对于根目录的相对路径
    // keepRoot=true时，相对于根目录的父目录计算，保留根目录名
    // keepRoot=false时，直接相对于根目录计算
    const inputRelative = path.relative(keepRoot ? path.dirname(root) : root, input)

    // 将相对路径组合到输出目录，得到最终的目标路径
    return path.join(output, inputRelative)
}

export function pathExt(filename, toLowerCase = true) {
    const ext = path.extname(filename)
    return toLowerCase ? ext?.toLowerCase() : ext
}

// 验证输入目录是否存在，是否是目录
export async function validateInput(input) {
    if (!input) {
        throw new Error(`input is not supplied`)
    }
    const root = path.resolve(input)
    try {
        const ist = await fs.stat(root)
        if (!ist.isDirectory()) {
            throw new Error(`not directory: ${root}`)
        }
        return root
    } catch (error) {
        throw new Error(error)
    }
}

const REGEX_ILLEGAL_FILENAME = /[\x00-\x1F\x7F<>:"\/\\|?*]/gm
export function filenameSafe(name) {
    return name.replaceAll(REGEX_ILLEGAL_FILENAME, "")
}

export function getSafeDeletedDir(filepath) {
    const dtStr = dayjs().format("YYYYMMDD")
    const dir = path.join(pathRoot(filepath), "Deleted_By_Mediac", dtStr)
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
    } catch (error) {}
}

// 复杂的长正侧，可以分离组合
export const combineRegex = (...parts) =>
    new RegExp(parts.map((x) => (x instanceof RegExp ? x.source : x)).join(""), "i")

export const combineRegexG = (...parts) =>
    new RegExp(parts.map((x) => (x instanceof RegExp ? x.source : x)).join(""), "ugi")

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
        } else if ((c >= 0x0001 && c <= 0x007e) || (0xff60 <= c && c <= 0xff9f)) {
            len++
        } else {
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
    return (await fileHashMD5(file1)) === (await fileHashMD5(file2))
}

const textHashSeed = 0
export const textHash = (text) => xxHash32(Buffer.from(text, "utf8"), textHashSeed)

export const textHashMD5 = (contents, algorithm = "md5", length = 8) =>
    crypto
        .createHash(algorithm)
        .update(contents)
        .digest("hex")
        .slice(-1 * length)

export const fileHashMD5 = (filename) => fileHash(filename, "md5")

export const fileHashSHA1 = (filename) => fileHash(filename, "sha1")

export function fileHash(filename, algorithm = "md5") {
    return new Promise((resolve, reject) => {
        // Algorithm depends on availability of OpenSSL on platform
        // Another algorithms: 'sha1', 'md5', 'sha256', 'sha512' ...
        let shasum = crypto.createHash(algorithm)
        try {
            let s = fs.ReadStream(filename)
            s.on("data", function (data) {
                shasum.update(data)
            })
            // making digest
            s.on("end", function () {
                const hash = shasum.digest("hex")
                return resolve(hash)
            })
        } catch (error) {
            return reject(`${algorithm} failed: ${error}`)
        }
    })
}

export async function killProcess(procName) {
    // taskkill /f /t /im notepad.exe
    // await execa('taskkill', parseArgs(input, options));
    switch (process.platform) {
        case "win32":
            await execa("taskkill /F /T /IM " + procName + ".exe /T")
            break
        default: //Linux + Darwin
            await execa("pkill -f " + procName)
            break
    }
}

export async function killProcessSync(procName) {
    switch (process.platform) {
        case "win32":
            execaSync("taskkill /F /T /IM " + procName + ".exe")
            break
        default: //Linux + Darwin
            execaSync("pkill -f " + procName)
            break
    }
}
