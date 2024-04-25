/*
 * Project: mediac
 * Created: 2024-04-20 17:00:36
 * Modified: 2024-04-20 17:00:36
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from 'execa'
import * as log from '../lib/debug.js'
import { FFPROBE_BINARY } from './shared.js'

// 解析 ffprobe 输出的函数
export function parseFFProbeOutput(output) {
    const lines = output.trim().split('\n')
    const streams = []
    let currentStream = {}
    let currentFormat = {}
    let currentSection = null
    let currentTags = {}

    for (const line of lines) {
        const trimmedLine = line.trim()
        if (trimmedLine.startsWith('[STREAM]')) {
            currentStream = {}
            currentSection = 'STREAM'
            currentTags = {}
        } else if (trimmedLine.startsWith('[FORMAT]')) {
            currentFormat = {}
            currentSection = 'FORMAT'
        } else if (trimmedLine.startsWith('[/STREAM]') || trimmedLine.startsWith('[/FORMAT]')) {
            if (currentSection === 'STREAM') {
                currentStream.tags = currentTags
                streams.push(currentStream)
            }
            currentSection = null
        } else if (trimmedLine.includes('=')) {
            const [key, value] = trimmedLine.split('=')
            let parsedValue = value.trim()
            if (parsedValue === 'unknown') {
                parsedValue = null
            } else if (/^\d+(\.\d+)?$/.test(parsedValue)) {
                parsedValue = parseFloat(parsedValue)
            }
            if (key.startsWith('TAG:') && currentSection === 'FORMAT') {
                currentFormat.tags = currentFormat.tags || {}
                currentFormat.tags[key.slice(4).toLowerCase()] = parsedValue
            } else if (key.startsWith('TAG:') && currentSection === 'STREAM') {
                currentTags[key.slice(4).toLowerCase()] = parsedValue
            } else if (currentSection === 'FORMAT' && key !== '') {
                currentFormat[key] = parsedValue === 'N/A' ? null : parsedValue
            } else if (currentSection === 'STREAM' && !key.startsWith('DISPOSITION:') && key !== '') {
                currentStream[key] = parsedValue === 'N/A' ? null : parsedValue
            }
        }
    }

    return { streams, format: currentFormat }
}


// ffprobe -v error -show_entries 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,channels,bits_per_sample:format=format_name,format_long_name,duration,size,bit_rate:format_tags:stream_tags' -of json
// 获取媒体文件信息的函数
export async function getMediaInfo(filePath, options = { video: false, audio: false, fullData: false }) {
    const jsonFullArgs = [
        '-v', 'quiet',
        '-show_streams',
        '-show_format',
        '-of', 'json',
        filePath
    ]
    const defaultFullArgs = [
        '-v', 'quiet',
        '-show_streams',
        '-show_format',
        '-of', 'default',
        filePath
    ]
    // 只选择需要的字段，避免乱码和非法JSON
    const propsSelected = 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,channels,bits_per_sample:format=format_name,format_long_name,duration,size,bit_rate'
    const selectJsonArgs = ['-v', 'error']
    // 只选择 audio stream
    if (options.audio) {
        selectJsonArgs.push('-select_streams', 'a:0')
    }
    if (options.video) {
        //只选择 video stream
        selectJsonArgs.push('-select_streams', 'v:0')
    }
    selectJsonArgs.push('-show_entries', propsSelected)
    selectJsonArgs.push('-of', 'json', filePath)
    try {
        // 使用 execa 执行 ffprobe 命令
        const { stdout, stderr } = await execa(FFPROBE_BINARY, selectJsonArgs)
        // console.log(stdout)
        // console.log(stderr)
        // return parseFFProbeOutput(stdout)
        const info = JSON.parse(stdout)
        // 只返回stream第一项
        // format作为子项
        log.info('getMediaInfo', filePath, info)
        // 只返回第一条视频轨和第一条音轨
        // 如果有fullData参数，返回全部streams数据
        return {
            video: fixNumberValue(info.streams.find(obj => obj.codec_type === "video")),
            audio: fixNumberValue(info.streams.find(obj => obj.codec_type === "audio")),
            format: fixNumberValue(info.format),
            streams: options.fullData ? info.streams : undefined,
        }
    } catch (error) {
        log.warn(`getMediaInfo:`, filePath, error.message)
    }
}

function fixNumberValue(obj) {
    // 兼容空值
    if (!obj) return obj
    // 遍历对象的所有属性
    for (const [key, value] of Object.entries(obj)) {
        // 检查属性的值是否为字符串类型且可以转换为数字
        if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
            // 如果可以转换为数字，则将其转换并更新对象的值
            obj[key] = parseFloat(value)
        }
    }
    return obj
}

// 返回数据示例 video/audio/format 三个字段

// {
//     video: {
//       codec_name: 'h264',
//       codec_long_name: 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
//       profile: 'High',
//       codec_type: 'video',
//       codec_tag_string: 'avc1',
//       width: 1920,
//       height: 1080,
//       display_aspect_ratio: '16:9',
//       pix_fmt: 'yuv420p',
//       r_frame_rate: '24000/1001',
//       time_base: '1/1000',
//       duration: 7922.747,
//       bit_rate: 2894180
//     },
//     audio: {
//       codec_name: 'aac',
//       codec_long_name: 'AAC (Advanced Audio Coding)',
//       profile: 'LC',
//       codec_type: 'audio',
//       codec_tag_string: 'mp4a',
//       sample_fmt: 'fltp',
//       sample_rate: 48000,
//       channels: 2,
//       bits_per_sample: 0,
//       r_frame_rate: '0/0',
//       time_base: '1/48000',
//       duration: 7930.837333,
//       bit_rate: 253375
//     },
//     format: {
//       format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
//       format_long_name: 'QuickTime / MOV',
//       duration: 7930.837333,
//       size: 3440841974,
//       bit_rate: 3470848
//     }
//   }