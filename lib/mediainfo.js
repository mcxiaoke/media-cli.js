/*
 * Project: mediac
 * Created: 2024-04-20 17:00:36
 * Modified: 2024-04-20 17:00:36
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from 'execa'
import iconv from 'iconv-lite'
import { roundNum } from './core.js'
import * as log from './debug.js'
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
    const info = JSON.parse(stdout)
    log.debug('ffprobeCall', filePath, info)
    return info
}

// 获取媒体文件信息 使用mediainfo
async function mediainfoCall(filePath) {
    const cmdArgs = ['--Output=JSON', filePath]
    // 使用 execa 执行 ffprobe 命令
    const { stdout, stderr } = await execa(MEDIAINFO_BINARY, cmdArgs, { encoding: 'binary' })
    log.showGray(stderr)
    const result = JSON.parse(stdout)
    log.debug('ffprobeCall', filePath, result)
    return result
}

async function parseFFProbe(filePath) {
    return fromFFprobeJson(await ffprobeCall(filePath))
}

async function parseMediaInfo(filePath) {
    return fromMediaInfoJson(await mediainfoCall(filePath))
}


export async function getMediaInfo(filePath, options = { ffprobe: false }) {
    if (!HAS_FFPROBE_EXE && !HAS_MEDIAINFO_EXE) {
        throw new Error('both ffprobe and mediainfo binary not found')
    }
    let [err1, data1] = await trySmartAsync(options.ffprobe ? parseFFProbe : parseMediaInfo)(filePath)
    if (err1) {
        let [err2, data2] = await trySmartAsync(options.ffprobe ? parseMediaInfo : parseFFProbe)(filePath)
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
    }
    arr.push(`format=${info?.format},duration=${info?.duration}s,bitrate=${roundNum((info?.bitrate || 0) / 1000)}K`)
    if (info?.audio) {
        const a = info?.audio
        arr.push(`a:codec=${a.format},bitrate=${roundNum(a.bitrate || 0 / 1000)}K`)
    }
    if (info?.video) {
        const v = info?.video
        arr.push(`v:codec=${v.format},bitrate=${roundNum(v.bitrate || 0 / 1000)}K,fps=${v.framerate},size=${v.width}x${v.height}`)
    }
    return arr
}