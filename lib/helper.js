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
import { fileURLToPath } from "url"
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

/**
 * 替换字符串中所有匹配的子串
 * 使用正则表达式进行全局替换
 *
 * @param {string} str - 原字符串
 * @param {string} find - 要查找的字符串
 * @param {string} replace - 替换字符串
 * @returns {string} 替换后的字符串
 */
export function replaceAll(str, find, replace) {
    return str.replace(new RegExp(escapeRegExp(find), "g"), replace)
}

// https://stackoverflow.com/questions/19700283/
/**
 * 将时间差格式化为 HH:MM:SS 或 MM:SS 格式
 *
 * @param {number} startMs - 开始时间戳（毫秒）
 * @param {boolean} padStart - 是否补零小时位
 * @returns {string} 格式化后的时间字符串
 */
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

/**
 * 将时间戳格式化为人类可读的持续时间
 *
 * @param {number} startMs - 开始时间戳（毫秒）
 * @param {number} dp - 秒的小数位数
 * @returns {string} 格式化后的持续时间
 */
export function humanTime(startMs, dp = 0) {
    return humanDuration(Date.now() - startMs, dp)
}

/**
 * 将秒数格式化为人类可读的持续时间
 *
 * @param {number} seconds - 秒数
 * @param {number} dp - 秒的小数位数
 * @returns {string} 格式化后的持续时间
 */
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

    let temp = milliseconds / 1000 // 转换为秒

    // 计算各个时间单位
    // 31536000 = 365天 * 24小时 * 3600秒
    const years = Math.floor(temp / 31536000)
    temp %= 31536000 // 使用模运算更新剩余秒数

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
            (years ? years + "y " : "") + // 年份，后面加空格
            (days ? days + "d" : "") + // 天数
            (hours ? hours + "h" : "") + // 小时
            (minutes ? minutes + "m" : "") + // 分钟
            Number.parseFloat(seconds).toFixed(dp) +
            "s" // 秒数，带指定小数位
        )
    }

    return "< 1s" // 理论上不会执行到这里
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

/**
 * 格式化字节数为人类可读的文本
 * 使用1000进制（公制单位）
 *
 * @param {number} bytes - 字节数
 * @param {number} decimals - 小数位数，默认2
 * @returns {string} 格式化后的字符串，如 "1.50 KB"
 */
export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return "0B"
    const k = 1000
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ["B", "KB", "MB", "GB", "TB", "PB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}

/**
 * 缩短路径显示
 * 如果路径超过指定宽度，从末尾保留部分内容
 *
 * @param {string} ps - 路径字符串
 * @param {number} width - 最大宽度，默认为50
 * @returns {string} 缩短后的路径
 */
export function pathShort(ps, width = 50) {
    const s = path.resolve(ps)
    const n = unicodeLength(s)
    return n < width || s.length < width ? s : "~" + s.slice(width * -1)
}

/**
 * 分割路径为目录、文件名、扩展名三部分
 *
 * @param {string} fullpath - 完整路径
 * @returns {Array<string>} [目录, 文件名(不含扩展名), 扩展名]
 */
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

/**
 * 解析路径的各个组成部分
 *
 * @param {string} fullpath - 完整路径
 * @returns {Object} 包含root, dir, base, name, ext等属性的对象
 */
export function pathParts(fullpath) {
    const abspath = path.resolve(fullpath)
    //https://nodejs.org/api/path.html#path_path_parse_path
    return path.parse(abspath)
}

/**
 * 获取路径的根目录
 * 例如: "C:\\Users\\test" 返回 "C:\\"
 *
 * @param {string} ps - 路径字符串
 * @returns {string} 根目录路径
 */
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

/**
 * 获取文件扩展名
 *
 * @param {string} filename - 文件名
 * @param {boolean} toLowerCase - 是否转换为小写，默认true
 * @returns {string} 文件扩展名（含点）
 */
export function pathExt(filename, toLowerCase = true) {
    const ext = path.extname(filename)
    return toLowerCase ? ext?.toLowerCase() : ext
}

/**
 * 验证输入目录是否存在且是目录
 *
 * @param {string} input - 输入路径
 * @returns {Promise<string>} 解析后的绝对路径
 * @throws {Error} 当输入无效或不是目录时抛出错误
 */
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
        throw new Error(`Failed to validate input: ${error.message}`, {
            cause: error, // 保留原始错误的完整上下文
        })
    }
}

const REGEX_ILLEGAL_FILENAME = /[<>:"/\\|?*\\s\p{C}]/gu

/**
 * 移除文件名中的非法字符
 *
 * @param {string} name - 原始文件名
 * @returns {string} 移除非法字符后的安全文件名
 */
export function filenameSafe(name) {
    return name.replaceAll(REGEX_ILLEGAL_FILENAME, "")
}

/**
 * 获取安全删除目录路径
 * 用于存储被安全删除的文件
 *
 * @param {string} filepath - 原始文件路径
 * @returns {string} 安全删除目录的完整路径
 */
export function getSafeDeletedDir(filepath) {
    const dtStr = dayjs().format("YYYYMMDD")
    const dir = path.join(pathRoot(filepath), "Deleted_By_Mediac", dtStr)
    return path.resolve(dir)
}

/**
 * 安全删除文件，转移到Deleted目录而不是永久删除
 * 保留原有目录结构，防止误删
 *
 * @param {string} filepath - 要删除的文件路径
 */
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

/**
 * 组合多个正则表达式部分为一个新的正则表达式
 * 支持混合字符串和RegExp对象
 *
 * @param {...(string|RegExp)} parts - 正则表达式各部分
 * @returns {RegExp} 组合后的正则表达式（忽略大小写）
 */
export const combineRegex = (...parts) =>
    new RegExp(parts.map((x) => (x instanceof RegExp ? x.source : x)).join(""), "i")

/**
 * 组合多个正则表达式部分为一个新的正则表达式（全局模式）
 *
 * @param {...(string|RegExp)} parts - 正则表达式各部分
 * @returns {RegExp} 组合后的正则表达式（全局、Unicode、忽略大小写）
 */
export const combineRegexG = (...parts) =>
    new RegExp(parts.map((x) => (x instanceof RegExp ? x.source : x)).join(""), "ugi")

/**
 * 检查目录是否为空
 *
 * @param {string} dirPath - 目录路径
 * @returns {Promise<boolean>} 如果为空返回true
 */
export async function isEmptyDir(dirPath) {
    // return (await fs.promises.readdir(dirPath)).length === 0;
    const dirIter = await fsp.opendir(dirPath)
    const { value, done } = await dirIter[Symbol.asyncIterator]().next()
    await dirIter.close()
    return !value
}

/**
 * 计算字符串长度（中文字符算2，英文字符算1）
 *
 * @param {string} str - 要计算的字符串
 * @returns {number} 计算后的长度
 */
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

/**
 * 按照指定长度截取字符串（考虑中文字符）
 *
 * @param {string} str - 原字符串
 * @param {number} len - 截取长度
 * @returns {string} 截取后的字符串
 */
export function unicodeSlice(str, len) {
    let str_length = 0
    let str_len = 0
    let str_cut = ""
    str_len = str.length
    for (let i = 0; i < str_len; i++) {
        let a = str.charAt(i)
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

/**
 * 检查两个文件是否完全相同（通过文件大小和MD5哈希）
 *
 * @param {string} file1 - 第一个文件路径
 * @param {string} file2 - 第二个文件路径
 * @returns {Promise<boolean>} 如果相同返回true
 */
export async function isExactSameFile(file1, file2) {
    const st1 = await fs.stat(file1)
    const st2 = await fs.stat(file2)
    if (st1.size !== st2.size) {
        return false
    }
    return (await fileHashMD5(file1)) === (await fileHashMD5(file2))
}

const textHashSeed = 0

/**
 * 计算文本的xxHash32哈希值
 *
 * @param {string} text - 文本内容
 * @returns {number} 哈希值
 */
export const textHash = (text) => xxHash32(Buffer.from(text, "utf8"), textHashSeed)

/**
 * 计算文本的MD5哈希值（截取后N位）
 *
 * @param {string} contents - 文本内容
 * @param {string} algorithm - 哈希算法，默认md5
 * @param {number} length - 截取长度，默认8
 * @returns {string} 哈希值
 */
export const textHashMD5 = (contents, algorithm = "md5", length = 8) =>
    crypto
        .createHash(algorithm)
        .update(contents)
        .digest("hex")
        .slice(-1 * length)

/**
 * 计算文件的MD5哈希值
 *
 * @param {string} filename - 文件路径
 * @returns {Promise<string>} MD5哈希值
 */
export const fileHashMD5 = (filename) => fileHash(filename, "md5")

/**
 * 计算文件的SHA1哈希值
 *
 * @param {string} filename - 文件路径
 * @returns {Promise<string>} SHA1哈希值
 */
export const fileHashSHA1 = (filename) => fileHash(filename, "sha1")

/**
 * 计算文件的哈希值
 *
 * @param {string} filename - 文件路径
 * @param {string} algorithm - 哈希算法，支持 'sha1', 'md5', 'sha256', 'sha512' 等
 * @returns {Promise<string>} 哈希值的十六进制字符串
 */
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

/**
 * 异步终止指定名称的进程
 *
 * @param {string} procName - 进程名称
 */
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

/**
 * 同步终止指定名称的进程
 *
 * @param {string} procName - 进程名称
 */
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

/**
 *  * 解析项目内置资源的绝对路径（适配任意子目录调用）
 * @param {string} relativeAssetPath 资源相对路径，如 "assets/test.jpg"
 * @returns {Promise<string>} 资源的绝对路径
 */
export async function resolveAssetPath(relativeAssetPath) {
    if (!relativeAssetPath || typeof relativeAssetPath !== "string") {
        throw new Error('参数错误：必须传入有效的资源相对路径字符串，如 "assets/test.jpg"')
    }

    // 步骤1：获取当前文件的目录（替代 CJS 的 __dirname）
    const __filename = fileURLToPath(import.meta.url)
    let currentDir = path.dirname(__filename)
    let rootDir = null

    // 循环向上查找 package.json，确定项目根目录
    while (currentDir !== path.parse(currentDir).root) {
        const packageJsonPath = path.join(currentDir, "package.json")
        if (await fs.pathExists(packageJsonPath)) {
            rootDir = currentDir
            break
        }
        currentDir = path.dirname(currentDir)
    }

    if (!rootDir) {
        throw new Error("无法找到项目根目录：未检测到 package.json 文件")
    }

    // 步骤2：拼接绝对路径
    const absoluteAssetPath = path.resolve(rootDir, relativeAssetPath)

    // 可选：验证文件存在性
    if (!(await fs.pathExists(absoluteAssetPath))) {
        throw new Error(`资源文件不存在：${absoluteAssetPath}`)
    }

    return absoluteAssetPath
}
