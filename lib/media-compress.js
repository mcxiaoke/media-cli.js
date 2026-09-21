/*
 * File: media-compress.js
 * Created: 2026-09-20 10:16:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
// 图片压缩域服务：sharp 主路径 + nconvert/vips 外部工具降级。
// 自 cmd/cmd_shared.js 拆分（2026-09-20），行为零变化。
import chalk from "chalk"
import dayjs from "dayjs"
import { $, execa } from "execa"
import fs from "fs-extra"
import path from "path"
import sharp from "sharp"
import { ensureImageCapabilities } from "./capabilities.js"
import config from "./config.js"
import * as core from "./core.js"
import * as log from "./debug.js"
import * as exif from "./exif.js"
import { moveSafe } from "./file.js"
import { fixMetadata } from "./fixmetadata.js"
import * as helper from "./helper.js"

// https://day.js.org/docs/zh-CN/display/format
const DATE_FORMAT = "YYYY-MM-DD HH:mm:ss.SSS Z"

/**
 * 修复字符串编码，将binary编码转换为cp936编码
 * @param {string} str - 要修复编码的字符串，默认为空字符串
 * @returns {string} 修复编码后的字符串
 */
// 需要使用外部程序压缩的格式
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
        await $({
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
        const { stderr } = await execa(config.VIPS_BIN_PATH, args, { encoding: "latin1" })
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
    // 不再隐式依赖「compress 命令先跑过 updateConfig()」：
    // 这里按需触发能力探测（memo 化，只有第一次真正探测）。
    // 否则 resizeFunc 会选到 nconvert、而它的路径同样是 undefined，
    // HEIC 分支会静默走一条不可用的路径。
    const caps = await ensureImageCapabilities()
    const resizeFunc = caps.vipsPath ? useVipsConvert : useNConvert
    // 试图确保目标文件目录存在，如果不存在则创建
    try {
        await fs.ensureDir(path.dirname(t.dst))
        // 删除残留的临时文件
        if (await fs.pathExists(t.tmpDst)) {
            await fs.remove(t.tmpDst)
        }

        const isFileHeic = [".heic", ".heif"].includes(helper.pathExt(t.src))
        const supportHeic = caps.sharpSupportHeic
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
            const removed = await helper.safeRemove(t.dst)
            // safeRemove 内部已吞掉异常并返回 null，这里补一条告警，避免"残留但无任何提示"
            if (!removed) {
                log.warn(logTag, `cleanup failed: <${t.dst}> still in place`)
            }
        } catch (error) {
            // 清理失败不影响主流程，但需留痕以便排查残留文件
            log.warn(logTag, `cleanup failed: <${t.dst}> ${error?.message || error}`)
        }
        t.errorFlag = true
        t.errorMessage = errMsg
        t.done = false
        return t
    }
} // 结束函数定义

async function checkMetadata(t) {
    if (!t.keepMetadata) {
        return "MetaSkip0"
    }
    const logTag = chalk.green("CheckMeta")
    const srcExt = helper.pathExt(t.name)
    if (srcExt === ".heic" || srcExt === ".heif") {
        // heic转换为jpg格式，可能需要手动复制元数据
        try {
            // 复用共享 ExifTool 单例（进程退出时统一释放）
            const etl = exif.getSharedExifTool()
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
        return "MetaSkip1"
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
            // safeRemove 失败返回 null：此时目标仍占位，继续 rename 只会拿到
            // 一个含义不明的 EEXIST/EPERM，不如就地报错并把原因说清楚。
            const removed = await helper.safeRemove(t.dst)
            if (!removed) {
                log.showRed(
                    logTag,
                    `Overwrite failed: <${t.dst}> could not be removed, skip rename`,
                )
                log.fileLog(`Overwrite failed: <${t.dst}>`, logTag)
                return
            }
        }
        // 将临时文件重命名为最终目标文件
        await moveSafe(t.tmpDst, t.dst)
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
