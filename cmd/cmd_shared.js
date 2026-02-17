/*
 * File: cmd_shared.js
 * Created: 2024-03-23 16:07:31 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from "chalk"
import { sify } from "chinese-conv"
import dayjs from "dayjs"
import { $, execa } from "execa"
import fs from "fs-extra"
import iconv from "iconv-lite"
import * as emoji from "node-emoji"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import sharp from "sharp"
import which from "which"
import config from "../lib/config.js"
import * as core from "../lib/core.js"
import { asyncFilter, copyFields } from "../lib/core.js"
import * as log from "../lib/debug.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as exif from "../lib/exif.js"
import { fixMetadata } from "../lib/fixmetadata.js"
import * as helper from "../lib/helper.js"

// https://day.js.org/docs/zh-CN/display/format
const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS Z"

async function renameOneFile(f) {
    const ipx = `[${f.index}/${f.total}]`
    const flag = f.stats?.isDirectory() ? "D" : "F"
    const logTag = "Rename" + flag + ipx
    // 生成输出文件的路径，优先 outPath
    const srcParts = path.parse(f.path)
    const outPath = f.outPath || path.join(path.dirname(f.path), f.outName)
    log.showGray(logTag, `Source: ${f.path} ${flag}`)
    // 如果输出文件名不存在或者输入文件路径等于输出文件路径，忽略该文件并打印警告信息
    if (!f.outName || f.path === f.outPath) {
        log.showYellow(logTag, "Ignore:", f.path, flag)
        return
    }
    try {
        // 确保输出目录已存在，如果不存在则创建
        const outDir = path.dirname(outPath)
        if (!(await fs.pathExists(outDir))) {
            await fs.mkdirs(outDir)
        }

        // 如果目标文件已存在，不能覆盖
        if (await fs.pathExists(outPath)) {
            log.showYellow(logTag, "SkipExists:", outPath, flag)
            return
        }

        // 使用 fs 模块的 rename 方法重命名文件，并等待操作完成
        await fs.rename(f.path, outPath)
        // 打印重命名成功的日志信息，显示输出文件的路径
        log.show(logTag, chalk.green(`OK:`), `${outPath} ${flag}`)
        log.fileLog(`SRC: <${f.path}>`, logTag)
        log.fileLog(`DST: <${f.outPath}>`, logTag)
        // 附加文件如字幕和封面也需要重命名
        if (f.extraExts?.length > 0) {
            for (const ext of f.extraExts) {
                const eSrc = path.join(srcParts.dir, srcParts.name + ext)
                const eDst = path.join(outDir, f.outBase + ext)
                if (await fs.pathExists(eSrc)) {
                    await fs.rename(eSrc, eDst)
                    log.show(logTag, chalk.yellow(`Extra:`), `${eDst}`)
                }
            }
        }
        return f
    } catch (error) {
        // 捕获并打印重命名过程中出现的错误信息，显示错误原因和输入文件的路径
        log.error(logTag, `Error: <${f.path}> => <${outPath}}> ${error.message} ${flag}`)
        log.fileLog(`Error: <${f.path}> ${error.message}`, logTag)
    }
}

// 这个函数是一个异步函数，用于重命名文件
export async function renameFiles(files, parallel = false) {
    // 打印日志信息，显示要重命名的文件总数
    log.show("Rename", `total ${files.length} files to rename. (parallel=${parallel})`)
    let results = []
    if (parallel) {
        results = await pMap(files, renameOneFile, { concurrency: cpus().length })
    } else {
        for (const file of files) {
            results.push(await renameOneFile(file))
        }
    }
    const allCount = results.length
    results = results.filter(Boolean)
    const okCount = results.length
    log.show("Rename", `total ${okCount}/${allCount} files renamed (parallel=${parallel})`)
    return results
}

/**
 * 修复字符串编码，将binary编码转换为cp936编码
 * @param {string} str - 要修复编码的字符串，默认为空字符串
 * @returns {string} 修复编码后的字符串
 */
function fixEncoding(str = "") {
    return iconv.decode(Buffer.from(str, "binary"), "cp936")
}
// 需要使用外部程序压缩的格式
const fixedOkStr = iconv.decode(Buffer.from("OK"), "utf8")
/**
 * 使用外部工具nconvert压缩图片
 * @param {Object} t - 压缩任务对象
 * @returns {Promise<Object|null>} 压缩结果对象，包含宽度、高度等信息
 */
async function useNConvert(t) {
    const logTag = "NConvert"
    log.info(logTag, "processing", t)
    if (!config.NCONVERT_BIN_PATH) {
        log.warn(logTag, "nconvert executable not in path")
        return
    }

    const fileSrc = t.src
    // 使用临时文件
    const dstName = path.resolve(t.tmpDst)
    try {
        const { stdout, stderr } = await $({
            encoding: "latin1",
        })`${config.NCONVERT_BIN_PATH} -quiet -overwrite -opthuff -keep_icc -no_auto_ext -out jpeg -o ${dstName} -q ${t.quality} -resize longest ${t.width} ${fileSrc}`
        // 检查压缩是否成功
        if (await fs.pathExists(dstName)) {
            log.info(
                chalk.yellow(logTag),
                `${t.index}/${t.total}`,
                `${helper.pathShort(fileSrc)}`,
                chalk.cyan("!use nconvert!"),
                chalk.yellow(`DoneEx`),
            )
            log.fileLog(`DoneEx: <${fileSrc}> => ${dstName}`, logTag)
            return {
                srcWidth: t.srcWidth,
                srcHeight: t.srcHeight,
                width: t.width,
                height: t.height,
                format: "jpeg",
                tool: "N",
            }
        }
    } catch (error) {
        log.warn(logTag, fileSrc, error)
    }
}

/**
 * 
 * 使用外部工具vips压缩图片
 * @param {Object} t - 压缩任务对象
 * @returns {Promise<Object|null>} 压缩结果对象，包含宽度、高度等信息
 * DOCS:
 * https://www.libvips.org/API/8.18/method.Image.heifsave.html
 * https://www.libvips.org/API/8.18/method.Image.jpegsave.html
 * 
//  VIPS jpegsave Optional arguments
// Q: gint, quality factor
// optimize_coding: gboolean, compute optimal Huffman coding tables
// interlace: gboolean, write an interlaced (progressive) jpeg

// convert to jpeg
//  vips.exe thumbnail .\test.HEIC test.jpg[Q=50,optimize-coding] --size down 3000
// convert to heic
// vips.exe thumbnail .\test.jpg test.heic[Q=50] --size down 3000
 */
async function useVipsConvert(t) {
    const logTag = "Vips"
    log.info(logTag, "processing", t)
    if (!config.VIPS_BIN_PATH) {
        log.warn(logTag, "vips executable not in path")
        return
    }

    const fileSrc = t.src
    // 使用临时文件
    const dstName = path.resolve(t.tmpDst)
    const args = [
        "thumbnail",
        fileSrc,
        `${dstName}[Q=${t.quality},optimize-coding]`,
        "--size",
        "down",
        t.width,
        "--export-profile",
        "srgb",
    ]
    try {
        const { stdout, stderr } = await execa(config.VIPS_BIN_PATH, args, { encoding: "latin1" })
        // 检查压缩是否成功
        if (!stderr && (await fs.pathExists(dstName))) {
            log.info(
                chalk.yellow(logTag),
                `${t.index}/${t.total}`,
                `${helper.pathShort(fileSrc)}`,
                chalk.cyan("!use vips!"),
                chalk.yellow(`DoneEx`),
            )
            log.fileLog(`DoneEx: <${fileSrc}> => ${dstName}`, logTag)
            return {
                srcWidth: t.srcWidth,
                srcHeight: t.srcHeight,
                width: t.width,
                height: t.height,
                format: "jpeg",
                tool: "V",
            }
        }
    } catch (error) {
        log.error(logTag, fileSrc, error.message)
        // vips转换失败，不返回值
    }
}

function createExtraMetadata(t) {
    return {
        ImageUniqueID: {},
        UserComment: {},
        IFD0: {
            ImageDescription: t.name,
            Copyright: `zxk`,
            Artist: "zxk",
            Software: `mediac ${t.cfg}`,
            XPSubject: `${t.name} - ${dayjs().format(DATE_FORMAT)}`,
            XPTitle: `${t.name} - ${dayjs().format(DATE_FORMAT)}`,
            XPComment: `mediac ${t.cfg}`,
            XPAuthor: "zxk",
        },
    }
}

// 这是一个异步函数，用于创建缩略图
export async function compressImage(t) {
    const logTag = "Compress"
    // 如果目标文件已存在，且有删除未压缩文件标志
    // 则不进行压缩处理，添加标志后返回
    if (t.shouldSkip) {
        log.show(
            logTag,
            `Skip: ${t.index}/${t.total}`,
            helper.pathShort(t.dst),
            chalk.yellow(t.skipReason),
        )
        log.fileLog(
            `Skip: ${t.index}/${t.total} <${t.src}> => ${path.basename(t.dst)} ${t.skipReason}`,
            logTag,
        )
        t.dstSize = t.size
        return t
    }
    const resizeFunc = config.VIPS_BIN_PATH ? useVipsConvert : useNConvert
    // 试图确保目标文件目录存在，如果不存在则创建
    try {
        await fs.ensureDir(path.dirname(t.dst))
        // 删除残留的临时文件
        if (await fs.pathExists(t.tmpDst)) {
            await fs.remove(t.tmpDst)
        }

        const isFileHeic = [".heic", ".heif"].includes(helper.pathExt(t.src))
        const supportHeic = config.SHARP_SUPPORT_HEIC
        let r = null
        // 性能测试 340张照片，N 1m22s V 1m16s WSL 1m43s
        // 如果是heic文件且sharp不支持，则使用外部工具压缩
        if (isFileHeic && !supportHeic) {
            r = await resizeFunc(t)
        }
        // 如果没有使用外部工具压缩，或者外部工具压缩失败，则使用sharp进行压缩
        if (!r) {
            // 初始化一个sharp对象，用于图像处理
            // 尝试读取源图像文件
            const s = sharp(t.src)
            // 对图像进行重新调整尺寸，设置宽度为 t.width，保持原始宽高比
            // 同时应用质量为 t.quality（默认值为86）的JPEG压缩，并使用"4:4:4"的色度子采样
            r = await s
                .resize({ width: t.width })
                .withMetadata()
                .withExifMerge(createExtraMetadata(t))
                .jpeg({ quality: t.quality || 85, chromaSubsampling: "4:4:4" })
                // 将处理后的图像保存到目标文件
                .toFile(t.tmpDst)
            // 获取目标文件的文件信息
        }
        return await checkCompressResult(t, r)
    } catch (error) {
        const errMsg = error.message.substring(0, 40)
        // 使用sharp压缩失败，再使用nconvert试试
        const cr = await resizeFunc(t)
        const r = await checkCompressResult(t, cr)
        if (r?.done) {
            return r
        }
        // 如果在处理过程中出现错误，则捕获并处理错误信息
        log.warn(logTag, `${t.index}/${t.total} ${helper.pathShort(t.src)} ERR:${errMsg}`)
        log.fileLog(`Error: <${t.src}> => ${path.basename(t.dst)} ${errMsg}`, logTag)
        try {
            // 尝试删除已创建的目标文件，防止错误文件占用空间
            await fs.remove(t.tmpDst)
            await helper.safeRemove(t.dst)
        } catch (error) {} // 忽略删除操作的错误，不进行额外处理
        t.errorFlag = true
        t.errorMessage = errMsg
        t.done = false
        return t
    } finally {
    }
} // 结束函数定义

async function checkMetadata(t) {
    const logTag = chalk.green("CheckMeta")
    const srcExt = helper.pathExt(t.name)
    if (srcExt === ".heic" || srcExt === ".heif") {
        // heic转换为jpg格式，可能需要手动复制元数据
        try {
            using etl = exif.createExif()
            const dstMetadata = await etl.read(t.tmpDst)
            const dstKeys = Object.keys(dstMetadata || {})
            const hasDate = dstMetadata?.DateTimeOriginal || dstMetadata?.CreateDate
            const hasGPS = dstMetadata?.GPSLatitude && dstMetadata?.GPSLongitude
            const checkKeys = [
                "Model",
                "Make",
                "ISO",
                "FNumber",
                "FocalLength",
                "Flash",
                "LensMake",
                "LensModel",
            ]
            const matchCount = core.countListMatches(checkKeys, dstKeys)
            // 如果同时有时间和GPS，说明元数据不缺失，不需要修复
            const skipCopy = hasDate && (hasGPS || matchCount >= 2)
            if (!skipCopy) {
                const srcRawMetadata = await etl.readRaw(t.src)
                const fixedMetadata = fixMetadata(srcRawMetadata)
                const extraMetadata = createExtraMetadata(t)
                const finalMeta = { ...fixedMetadata, ...extraMetadata }
                await etl.write(t.tmpDst, finalMeta, {
                    overwrite: true, // 覆盖原有元数据
                    charset: "utf-8", // 统一字符编码
                    ignoreMinorErrors: true, // 忽略次要错误
                    preserve: true, // 保留原有非合法标签
                })
                // 如果没报错，删除ExifTool的备份文件
                const bakFile = t.tmpDst + "_original"
                if (await fs.pathExists(bakFile)) {
                    await fs.remove(bakFile)
                }
                log.info(
                    logTag,
                    `${t.index}/${t.total}`,
                    helper.pathShort(t.dst, 45),
                    chalk.magenta(`Metadata fixed and copied to dest JPEG`),
                )

                return "MetaCopied"
            } else {
                log.info(
                    logTag,
                    `${t.index}/${t.total}`,
                    helper.pathShort(t.dst, 45),
                    chalk.magenta(`Metadata of dest JPEG is OK, no need to copy`),
                )
                return "MetaGood"
            }
        } catch (error) {
            console.error(logTag, t.src, `Copy metadata failed`, error)
        }
    } else {
        return "MetaSkip"
    }
}

/**
 * 检查压缩结果并处理临时文件
 * @param {Object} t - 压缩任务对象
 * @param {string} t.tmpDst - 临时目标文件路径
 * @param {string} t.dst - 最终目标文件路径
 * @param {string} t.src - 源文件路径
 * @param {number} t.index - 当前任务索引
 * @param {number} t.total - 总任务数
 * @param {number} t.srcWidth - 源图片宽度
 * @param {number} t.srcHeight - 源图片高度
 * @param {number} t.size - 源文件大小
 * @param {number} t.startMs - 任务开始时间
 * @param {Object} r - 压缩结果对象
 * @param {number} r.width - 压缩后宽度
 * @param {number} r.height - 压缩后高度
 * @returns {Promise<Object|null>} 处理后的任务对象
 */
async function checkCompressResult(t, r) {
    const logTag = chalk.green("Done")
    try {
        const tmpSt = await fs.stat(t.tmpDst)
        // 如果目标文件大小小于10KB，则可能文件损坏，删除该文件
        let metaStatus = "Meta?"
        if (tmpSt.size < 10 * 1024) {
            await helper.safeRemove(t.tmpDst)
            log.showYellow(
                logTag,
                `Delete: ${t.index}/${t.total}`,
                `<${helper.pathShort(t.dst)}>`,
                `${helper.humanSize(tmpSt.size)}`,
                chalk.yellow(`file corrupted`),
            )
            log.fileLog(
                `Delete: ${t.index}/${t.total} <${helper.pathShort(t.dst)}> ${helper.humanSize(tmpSt.size)} file corrupted`,
                logTag,
            )
            return
        } else {
            metaStatus = await checkMetadata(t)
        }
        if ((await fs.pathExists(t.dst)) && t.overwrite) {
            // 如果覆盖原文件，先删除原文件，再重命名
            await helper.safeRemove(t.dst)
        }
        // 将临时文件重命名为最终目标文件
        await fs.rename(t.tmpDst, t.dst)
        t.dstExists = await fs.pathExists(t.dst)
        if (!t.dstExists) {
            return
        }
        // 生成尺寸信息字符串
        let dimensionStr = `${r.width}x${r.height}`
        if (r.width !== t.srcWidth || r.height !== t.srcHeight) {
            dimensionStr = `${t.srcWidth}x${t.srcHeight}` + `=>` + dimensionStr
        }
        // 记录压缩成功的日志
        log.show(
            logTag,
            `${t.index}/${t.total}`,
            helper.pathShort(t.dst, 40),
            chalk.yellow(dimensionStr),
            chalk.cyan(`${helper.humanSize(t.size)}=>${helper.humanSize(tmpSt.size)}`),
            chalk.greenBright(r.tool || "S"),
            chalk.magenta(metaStatus),
            helper.humanTime(t.startMs),
        )
        log.fileLog(`<${t.src}> => ${path.basename(t.dst)} ${helper.humanSize(tmpSt.size)}`, logTag)
        // 更新任务对象的属性
        t.dstSize = tmpSt.size || 0
        t.done = true
        return t
    } catch (error) {
        log.showYellow(
            logTag,
            `${t.index}/${t.total} ${helper.pathShort(t.src)} Compress failed: ${error.message}`,
        )
    }
}

// 正则：仅包含数字
export const RE_ONLY_NUMBER = /^\d+$/i
export const RE_ONLY_ASCII = /^[A-Za-z0-9 ._-]+$/i
// 视频文件名各种前后缀
export const RE_VIDEO_EXTRA_CHARS = helper.combineRegexG(
    /HD1080P|2160p|1080p|720p|BDRip/,
    /H264|H265|X265|8BIT|10bit/,
    /WEB-DL|SMURF|Web|AAC5\.1|Atmos/,
    /H\.264|DD5\.1|DDP5\.1|AAC/,
    /DJWEB|Play|VINEnc|DSNP|END/,
    /高清|特效|字幕组|公众号|电影|搬运/,
    /\[.+?\]/,
)
// 图片文件名各种前后缀
export const RE_IMAGE_EXTRA_CHARS =
    /更新|合集|画师|图片|套图|全?高清|写真|视频|插画|视图|作品|订阅|限定|差分|拷贝|自购|内购|无水印|付费|内容|高画質|高解像度|R18|PSD|PIXIV|PIC|ZIP|RAR/giu
// Unicode Symbols
// https://en.wikipedia.org/wiki/Script_%28Unicode%29
// https://www.regular-expressions.info/unicode.html
// https://symbl.cc/cn/unicode/blocks/halfwidth-and-fullwidth-forms/
// https://www.unicode.org/reports/tr18/
// https://ayaka.shn.hk/hanregex/
// 特例字符	中英	全半角	unicode范围	unicode码表名
// 单双引号	中文	全/半	0x2018-0x201F	常用标点
// 句号、顿号	中文	全/半	0x300x-0x303F	中日韩符号和标点
// 空格	中/英	全角	0x3000	中日韩符号和标点
// -	英	半角	0x0021~0x007E	半角符号
// -	英	全角	0xFF01~0xFF5E	全角符号
// -	中	全/半	0xFF01~0xFF5E	全角符号
// 正则：匹配除 [中文日文标点符号] 之外的特殊字符
// u flag is required
// \p{sc=Han} CJK全部汉字 比 \u4E00-\u9FFF = \p{InCJK_Unified_Ideographs} 范围大
// 匹配汉字还可以使用 \p{Unified_Ideograph}
// \p{sc=Hira} 日文平假名
// \p{P} 拼写符号
// \p{ASCII} ASCII字符
// \uFE10-\uFE1F 中文全角标点
// \uFF01-\uFF11 中文全角标点
export const RE_NON_COMMON_CHARS = /[^\p{Unified_Ideograph}\p{sc=Hira}\p{sc=Kana}\w\d]/giu
// 匹配空白字符和特殊字符
// https://www.unicode.org/charts/PDF/U3000.pdf
// https://www.asciitable.com/
export const RE_UGLY_CHARS = /[\s\p{Zs}\p{Punctuation}\P{ASCII}]+/giu
// 匹配开头和结尾的空白和特殊字符
export const RE_UGLY_CHARS_BORDER = /^([\s._-]+)|([\s._-]+)$/giu
// 图片视频子文件夹名过滤
// 如果有表示，test() 会随机饭后true or false，是一个bug
// 使用 string.match 函数没有问题
// 参考 https://stackoverflow.com/questions/47060553
// The g modifier causes the regex object to maintain state.
// It tracks the index after the last match.
export const RE_MEDIA_DIR_NAME = /^图片|视频|电影|电视剧|Image|Video|Thumbs$/giu
// 可以考虑将日文和韩文罗马化处理
// https://github.com/lovell/hepburn
// https://github.com/fujaru/aromanize-js
// https://www.npmjs.com/package/aromanize
// https://www.npmjs.com/package/@lazy-cjk/japanese
export function cleanFileName(nameString, options = {}) {
    let sep = options.separator || ""
    let nameStr = nameString
    // 去掉所有表情符号
    nameStr = emoji.strip(nameStr)
    // 去掉方括号 [xxx] 的内容
    // nameStr = nameStr.replaceAll(/\[.+?\]/gi, "");
    // 去掉图片集说明文字
    nameStr = nameStr.replaceAll(RE_IMAGE_EXTRA_CHARS, "")
    // 去掉视频说明文字
    nameStr = nameStr.replaceAll(RE_VIDEO_EXTRA_CHARS, "")
    // 去掉日期字符串
    if (!options.keepDateStr) {
        nameStr = nameStr.replaceAll(/\d+年\d+月/giu, "")
        nameStr = nameStr.replaceAll(/\d{4}-\d{2}-\d{2}/giu, "")
        nameStr = nameStr.replaceAll(/\d{4}\.\d{2}\.\d{2}/giu, "")
    }
    // 去掉 [100P5V 2.25GB] No.46 这种图片集说明
    nameStr = nameStr.replaceAll(/\[\d+P.*(\d+V)?.*?\]/giu, "")
    nameStr = nameStr.replaceAll(/No\.\d+|\d+MB|\d+\.?\d+GB?|\d+P|\d+V|NO\.(\d+)/giu, "$1")
    // 去掉中文标点，全角符号
    nameStr = nameStr.replaceAll(/[\u3000-\u303F\uFE10-\uFE2F\uFF00-\uFF20]+/giu, "")
    // () [] {} <> . - 改为下划线
    nameStr = nameStr.replaceAll(/[\s()[\]{}<>._-]+/giu, sep)
    // 日文转罗马字母
    // nameStr = hepburn.fromKana(nameStr);
    // nameStr = wanakana.toRomaji(nameStr);
    // 韩文转罗马字母
    // nameStr = aromanize.hangulToLatin(nameStr, 'rr-translit');
    if (options.tc2sc) {
        // 繁体转换为简体中文
        nameStr = sify(nameStr)
    }
    // 去掉所有特殊字符
    nameStr = nameStr.replaceAll(RE_NON_COMMON_CHARS, sep)
    // 连续的分隔符合并为一个 sep
    nameStr = nameStr.replaceAll(/[\s._-]+/giu, sep)
    // 去掉首尾的特殊字符
    nameStr = nameStr.replaceAll(RE_UGLY_CHARS_BORDER, "")
    log.debug(`cleanFileName SRC [${nameString}]`, options)
    log.debug(`cleanFileName DST: [${nameStr}]`)
    // 确保是合法的文件名
    return helper.filenameSafe(nameStr)
}

/**
 * 根据模式过滤文件名
 * @param {string} fpath - 文件路径
 * @param {string} pattern - 过滤模式
 * @param {boolean} useRegex - 是否使用正则表达式匹配，默认为false
 * @returns {boolean} 是否匹配模式
 */
function filterFileNames(fpath, pattern, useRegex = false) {
    const name = path.basename(fpath)
    if (useRegex) {
        const rgx = new RegExp(pattern, "ui")
        return name.includes(pattern) || rgx.test(name)
    }
    return name.includes(pattern)
}
// 通用文件名过滤 = 扩展名规则 包含规则 排除规则
// 仅匹配文件名，不包含路径
export async function applyFileNameRules(fileEntries, argv) {
    const beforeCount = fileEntries.length
    const logTag = chalk.green("NameRules")
    if (argv.extensions || argv.include || argv.exclude) {
        log.show(
            logTag,
            `extensions="${argv.extensions || ""}", include="${argv.include || ""}", exclude="${argv.exclude || ""}"`,
        )
    }
    const extensions = argv.extensions?.toLowerCase()
    if (extensions?.length > 0) {
        if (!/\.[a-z0-9]{2,4}/.test(extensions)) {
            // 有扩展名参数，但是参数错误，报错
            throw createError(
                ErrorTypes.INVALID_ARGUMENT,
                `Invalid extensions argument: ${extensions}`,
            )
        }
        fileEntries = fileEntries.filter((entry) => extensions.includes(helper.pathExt(entry.name)))
        log.info(logTag, `${fileEntries.length} entries left by extension rules`)
    }
    if (argv.exclude?.length > 0) {
        // 处理exclude规则
        // fileEntries = await asyncFilter(fileEntries, x => excludeFunc(x))
        fileEntries = await asyncFilter(
            fileEntries,
            (x) => !filterFileNames(x.path, argv.exclude, argv.regex),
        )
        log.info(logTag, `${fileEntries.length} entries left by exclude rules`)
    } else if (argv.include?.length > 0) {
        // 处理include规则
        fileEntries = await asyncFilter(fileEntries, (x) =>
            filterFileNames(x.path, argv.include, argv.regex),
        )
        log.info(logTag, `${fileEntries.length} entries left by include rules`)
    }
    const afterCount = fileEntries.length
    if (beforeCount - afterCount > 0) {
        log.show(
            logTag,
            `${beforeCount - afterCount} entries removed by include/exclude/extension rules`,
        )
    }
    return fileEntries
}

export function addEntryProps(entries, extraProps = {}) {
    const startMs = Date.now()
    entries.forEach((entry, index) => {
        entry.startMs = startMs
        entry.index = index
        entry.total = entries.length
        copyFields(extraProps, entry)
    })
    return entries
}

// 给定长宽，给定长边数值，计算缩放后的长宽，只缩小不放大
export function calculateScale(imgWidth, imgHeight, maxSide) {
    // 不需要缩放的情况
    if (imgWidth <= maxSide && imgHeight <= maxSide) {
        return { dstWidth: imgWidth, dstHeight: imgHeight, scaled: false }
    }
    // 计算缩放比例
    let scaleFactor = maxSide / Math.max(imgWidth, imgHeight)
    // 计算新的长宽
    let dstWidth = Math.round(imgWidth * scaleFactor)
    let dstHeight = Math.round(imgHeight * scaleFactor)
    return { dstWidth, dstHeight, scaled: true }
}
