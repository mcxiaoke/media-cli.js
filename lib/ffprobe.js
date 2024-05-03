/*
 * Project: mediac
 * Created: 2024-04-20 17:00:36
 * Modified: 2024-04-20 17:00:36
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from 'execa'
import * as log from '../lib/debug.js'
import { roundNum } from './core.js'
import { fromFFprobeJson, fromMediaInfoJson } from './media_parser.js'
import { FFPROBE_BINARY, MEDIAINFO_BINARY } from './shared.js'
import { tryCatchAsync } from './tryfp.js'

// ffprobe -v error -show_entries 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,channels,bits_per_sample:format=format_name,format_long_name,duration,size,bit_rate:format_tags:stream_tags' -of json
// 获取媒体文件信息 使用ffprobe
async function ffprobeCall(filePath) {
    // 只选择需要的字段，避免乱码和非法JSON
    // 有的文件视频和音频duration和bit_rate放在stream_tags里
    const propsSelected = 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,avg_frame_rate,channels,bits_per_sample,bits_per_raw_sample:format=format_name,format_long_name,duration,size,bit_rate:stream_tags'
    const cmdArgs = ['-v', 'error']
    cmdArgs.push('-show_entries', propsSelected)
    cmdArgs.push('-of', 'json', filePath)
    try {
        // 使用 execa 执行 ffprobe 命令
        const { stdout, stderr } = await execa(FFPROBE_BINARY, cmdArgs)
        const info = JSON.parse(stdout)
        log.debug('getMediaInfo', filePath, info)
        return info

    } catch (error) {
        log.warn(`ERROR:`, error.message?.slice(-160))
    }
}

// 获取媒体文件信息 使用mediainfo
async function mediainfoCall(filePath) {
    const cmdArgs = ['--Output=JSON', filePath]
    try {
        // 使用 execa 执行 ffprobe 命令
        const { stdout, stderr } = await execa(MEDIAINFO_BINARY, cmdArgs)
        const result = JSON.parse(stdout)
        log.debug('getMediaInfo', filePath, result)
        return result
    } catch (error) {
        log.warn(`ERROR:`, error.message?.slice(-160))
    }
}

export async function getMediaInfo(filePath, opts = { ffprobeFirst: false }) {
    let [err, data] = await tryCatchAsync(opts.ffprobeFirst ? ffprobeCall : mediainfoCall)(filePath)
    if (data) {
        return fromMediaInfoJson(data)
    }
    if (err) {
        [err, data] = await tryCatchAsync(opts.ffprobeFirst ? ffprobeCall : mediainfoCall)(filePath)
    }
    if (data) {
        return fromFFprobeJson(data)
    }
    log.warn(`ERROR:`, 'getMediaInfo', filePath, err.message?.slice(-160))
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