/*
 * Project: mediac
 * Created: 2024-04-20 17:00:36
 * Modified: 2024-04-20 17:00:36
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from "execa"
import iconv from "iconv-lite"
import os from "node:os"
import which from "which"
import { roundNum } from "./core.js"
import * as log from "./debug.js"
import { hasBadUnicode } from "./encoding.js"
import { fromFFprobeJson, fromMediaInfoJson } from "./media_parser.js"
import { trySmartAsync } from "./tryfp.js"

const isWindows = os.platform() === "win32"

const mediaInfoBin = isWindows ? "mediainfo.exe" : "mediainfo"
const ffprobeBin = isWindows ? "ffprobe.exe" : "ffprobe"

// 检测可执行文件是否存在
const HAS_FFPROBE_EXE = await which(ffprobeBin, { nothrow: true })
const HAS_MEDIAINFO_EXE = await which(mediaInfoBin, { nothrow: true })

/**
 * 修复字符编码问题
 * 将二进制字符串从GBK编码转换为UTF-8
 *
 * @param {string} str - 可能包含乱码的字符串
 * @returns {string} 转换后的字符串
 */
function fixEncoding(str = "") {
    return iconv.decode(Buffer.from(str, "binary"), "gbk")
}

/**
 * 调用FFprobe获取媒体文件信息
 * 使用-latin1编码避免中文乱码，然后尝试修复
 *
 * @param {string} filePath - 媒体文件路径
 * @returns {Promise<Object>} FFprobe输出的JSON数据
 */
async function ffprobeCall(filePath, { probePath = ffprobeBin, signal = null } = {}) {
    // 只选择需要的字段，避免乱码和非法JSON
    // 有的文件视频和音频duration和bit_rate放在stream_tags里
    const propsSelected =
        "stream=codec_name,codec_long_name,profile,level,codec_type,codec_tag_string,width,height,display_aspect_ratio,sample_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,avg_frame_rate,channels,bits_per_sample,bits_per_raw_sample:stream_disposition=attached_pic:format=format_name,format_long_name,duration,size,bit_rate:stream_tags:format_tags=creation_time"
    const cmdArgs = ["-v", "error"]
    cmdArgs.push("-show_entries", propsSelected)
    cmdArgs.push("-of", "json", filePath)
    // 使用 execa 执行 ffprobe 命令
    const { stdout } = await execa(probePath, cmdArgs, {
        encoding: "latin1",
        ...(signal ? { cancelSignal: signal } : {}),
    })
    // 没有filename字段不会乱码，不过代码还是保留
    let jsonText = stdout
    if (hasBadUnicode(jsonText)) {
        jsonText = fixEncoding(stdout)
    }
    const info = JSON.parse(jsonText)
    log.debug("ffprobeCall", filePath, info)
    return info
}

/**
 * 调用MediaInfo获取媒体文件信息
 *
 * @param {string} filePath - 媒体文件路径
 * @returns {Promise<Object>} MediaInfo输出的JSON数据
 */
async function mediainfoCall(filePath, { signal = null } = {}) {
    const cmdArgs = ["--Output=JSON", filePath]
    // 使用 execa 执行 ffprobe 命令
    // { encoding: 'binary' } 与 fixEncoding 函数对应
    const { stdout } = await execa(mediaInfoBin, cmdArgs, {
        encoding: "latin1",
        ...(signal ? { cancelSignal: signal } : {}),
    })
    // 解决windows下文件名乱码问题
    // 方法1 乱码部分文本直接正则清除掉
    // 方法2 使用iconv-lite解决gbk乱码
    // 此处两种方法一起用
    let jsonText = stdout
    if (hasBadUnicode(jsonText)) {
        jsonText = fixEncoding(stdout)
    }
    // 正则替换掉 @ref字段的乱码值
    // A 替换掉@ref字段整个字段
    jsonText = jsonText.replace(/"@ref.+",("track)/, "$1")
    // B 只替换掉@ref字段值引号中的内容
    // const regex = /("@ref"\s*:\s*")[^"]+(")/
    // jsonText = jsonText.replace(regex, '$1<FILENAME>$2')
    // log.showBlue(jsonText)
    let result

    try {
        result = JSON.parse(jsonText)
    } catch (error) {
        jsonText = fixEncoding(jsonText)
        result = JSON.parse(jsonText)
    }
    log.debug("ffprobeCall", filePath, result)
    return result
}

/**
 * 使用FFprobe解析媒体文件
 *
 * @param {string} filePath - 媒体文件路径
 * @returns {Promise<MediaInfo>} 解析后的媒体信息对象
 */
async function parseFFProbe(filePath, options = {}) {
    return fromFFprobeJson(
        await ffprobeCall(filePath, {
            probePath: options.ffprobePath || ffprobeBin,
            signal: options.signal,
        }),
    )
}

/**
 * 使用MediaInfo解析媒体文件
 *
 * @param {string} filePath - 媒体文件路径
 * @returns {Promise<MediaInfo>} 解析后的媒体信息对象
 */
async function parseMediaInfo(filePath, options = {}) {
    return fromMediaInfoJson(await mediainfoCall(filePath, { signal: options.signal }))
}

// 优先使用ffprobe，因为可以指定字段，且mediainfo产生的json可能文件名乱码
/**
 * 获取媒体文件的详细信息
 * 默认优先使用ffprobe，如果失败则尝试MediaInfo作为备选方案
 *
 * 注意：调用方不得假设结果永远来自ffprobe（或mediainfo）——
 * 首选检测器失败时会自动回退到备选检测器，两者都可成功返回。
 *
 * @param {string} filePath - 媒体文件路径
 * @param {Object} options - 选项配置
 * @param {boolean} options.useMediaInfo - 是否改为优先使用MediaInfo（默认false，即默认优先ffprobe）
 * @param {string} [options.ffprobePath] - 与 ffmpeg 配对的 ffprobe 可执行文件路径
 * @param {AbortSignal} [options.signal] - 取消媒体探测的信号
 * @returns {Promise<Object>} 媒体信息对象，包含视频、音频、字幕等流信息
 * @throws {Error} 当ffprobe和mediainfo都不可用时抛出错误
 */
export async function getMediaInfo(filePath, options = {}) {
    const hasProbe = Boolean(options.ffprobePath) || HAS_FFPROBE_EXE
    if (!hasProbe && !HAS_MEDIAINFO_EXE) {
        throw new Error("both ffprobe and mediainfo binary not found")
    }

    const parseFF = (file) => parseFFProbe(file, options)
    const parseMI = (file) => parseMediaInfo(file, options)

    // 首先尝试首选的解析器（MediaInfo或FFprobe）
    let [err1, data1] = await trySmartAsync(options.useMediaInfo ? parseMI : parseFF)(filePath)

    if (err1) {
        // 首选解析器失败，尝试备选解析器
        let [err2, data2] = await trySmartAsync(options.useMediaInfo ? parseFF : parseMI)(filePath)

        if (data2) {
            return data2 // 备选解析器成功，返回数据
        }

        // 两个解析器都失败，记录错误信息
        err1 && log.error("getMediaInfo", fixEncoding(err1?.message))
        err2 && log.error("getMediaInfo", fixEncoding(err2?.message))
    } else {
        // 首选解析器成功
        if (data1.video) {
            // VP9编码的profile字段类型修复（确保为字符串）
            data1.video.profile = "" + data1.video.profile
        }
        return data1
    }
}

/**
 * 获取媒体文件的简化信息
 * 返回逗号分隔的字符串，包含时长、码率、格式等基本信息
 *
 * @param {string} filePath - 媒体文件路径
 * @param {Object} options - 选项配置
 * @returns {Promise<string>} 简化的媒体信息字符串
 */
export async function getSimpleInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    const arr = []
    if (!info?.duration) {
        arr.push("ERROR: failed to get media info!")
        return arr.join(",")
    }
    arr.push(`ts=${info?.duration}s`, `bit=${roundNum((info?.bitrate || 0) / 1000)}K`)
    if (info?.audio) {
        const a = info?.audio
        arr.push(a.format)
    }
    if (info?.video) {
        const v = info?.video
        arr.push(`${v.format}`, `fps=${v.framerate}`, `${v.width}x${v.height}`)
    }

    if (info?.subtitles) {
        arr.push(info.subtitles.map((s) => `${s.format}-${s.codec}`).join("|"))
    }
    return arr.join(",")
}

/**
 * 获取媒体文件的视频信息
 *
 * @param {string} filePath - 媒体文件路径
 * @param {Object} options - 选项配置
 * @returns {Promise<Video|null>} 视频流信息
 */
export async function getVideoInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    return info?.video
}

/**
 * 获取媒体文件的音频信息
 *
 * @param {string} filePath - 媒体文件路径
 * @param {Object} options - 选项配置
 * @returns {Promise<Audio|null>} 音频流信息
 */
export async function getAudioInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    return info?.audio
}
