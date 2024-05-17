/*
 * Project: mediac
 * Created: 2024-04-20 17:00:36
 * Modified: 2024-04-20 17:00:36
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from 'execa'
import iconv from 'iconv-lite'
import * as helper from '../lib/helper.js'
import { roundNum } from './core.js'
import * as log from './debug.js'
import { hasBadUnicode } from './encoding.js'
import { fromFFprobeJson, fromMediaInfoJson } from './media_parser.js'
import { trySmartAsync } from './tryfp.js'

import which from 'which'

export const FFMPEG_BINARY = 'ffmpeg'
export const FFPROBE_BINARY = 'ffprobe'
export const MEDIAINFO_BINARY = 'mediainfo'

// 检测可执行文件是否存在
const HAS_FFPROBE_EXE = await which(FFPROBE_BINARY, { nothrow: true })
const HAS_MEDIAINFO_EXE = await which(MEDIAINFO_BINARY, { nothrow: true })

function fixEncoding(str = '') {
    return iconv.decode(Buffer.from(str, 'binary'), 'gbk')
}

// ffprobe -v error -show_entries 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,channels,bits_per_sample:format=format_name,format_long_name,duration,size,bit_rate:format_tags:stream_tags' -of json
// 获取媒体文件信息 使用ffprobe
async function ffprobeCall(filePath) {
    // 只选择需要的字段，避免乱码和非法JSON
    // 有的文件视频和音频duration和bit_rate放在stream_tags里
    const propsSelected = 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,avg_frame_rate,channels,bits_per_sample,bits_per_raw_sample:format=format_name,format_long_name,duration,size,bit_rate:stream_tags:format_tags=creation_time'
    const cmdArgs = ['-v', 'error']
    cmdArgs.push('-show_entries', propsSelected)
    cmdArgs.push('-of', 'json', filePath)
    // 使用 execa 执行 ffprobe 命令
    const { stdout, stderr } = await execa(FFPROBE_BINARY, cmdArgs, { encoding: 'binary' })
    // 没有filename字段不会乱码，不过代码还是保留
    let jsonText = stdout
    if (hasBadUnicode(jsonText)) {
        jsonText = fixEncoding(stdout)
    }
    const info = JSON.parse(jsonText)
    log.debug('ffprobeCall', filePath, info)
    return info
}

// 获取媒体文件信息 使用mediainfo
async function mediainfoCall(filePath) {
    const cmdArgs = ['--Output=JSON', filePath]
    // 使用 execa 执行 ffprobe 命令
    // { encoding: 'binary' } 与 fixEncoding 函数对应
    const { stdout, stderr } = await execa(MEDIAINFO_BINARY, cmdArgs, { encoding: 'binary' })
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
    jsonText = jsonText.replace(/"@ref.+",("track)/, '$1')
    // B 只替换掉@ref字段值引号中的内容
    // const regex = /("@ref"\s*:\s*")[^"]+(")/
    // jsonText = jsonText.replace(regex, '$1<FILENAME>$2')
    log.showBlue(jsonText)
    let result = null
    try {
        result = JSON.parse(jsonText)
    } catch (error) {
        jsonText = fixEncoding(jsonText)
        result = JSON.parse(jsonText)
    }
    log.debug('ffprobeCall', filePath, result)
    return result
}

async function parseFFProbe(filePath) {
    return fromFFprobeJson(await ffprobeCall(filePath))
}

async function parseMediaInfo(filePath) {
    return fromMediaInfoJson(await mediainfoCall(filePath))
}

// 优先使用ffprobe 因为可以指定字段，mediainfo产生的json可能文件名乱码
export async function getMediaInfo(filePath, options = { useMediaInfo: false }) {
    if (!HAS_FFPROBE_EXE && !HAS_MEDIAINFO_EXE) {
        throw new Error('both ffprobe and mediainfo binary not found')
    }
    let [err1, data1] = await trySmartAsync(options.useMediaInfo ? parseMediaInfo : parseFFProbe)(filePath)
    if (err1) {
        let [err2, data2] = await trySmartAsync(options.useMediaInfo ? parseFFProbe : parseMediaInfo)(filePath)
        if (data2) {
            return data2
        }
        err1 && log.error('getMediaInfo', fixEncoding(err1?.message))
        err2 && log.error('getMediaInfo', fixEncoding(err2?.message))
    } else {
        return data1
    }
}

export async function getSimpleInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    const arr = []
    if (!info?.duration) {
        arr.push('ERROR: failed to get media info!')
        return arr.join(',')
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

    return arr.join(',')
}

export async function getVideoInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    return info?.video
}

export async function getAudioInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    return info?.audio
}