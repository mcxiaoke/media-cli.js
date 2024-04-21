/*
 * Project: mediac
 * Created: 2024-04-20 17:00:36
 * Modified: 2024-04-20 17:00:36
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { execa } from 'execa'
import * as log from '../lib/debug.js'

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
export async function getMediaInfo(filePath, options = { audio: false }) {
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
    } else {
        //只选择 video stream
        selectJsonArgs.push('-select_streams', 'v:0')
    }
    selectJsonArgs.push('-show_entries', propsSelected)
    selectJsonArgs.push('-of', 'json', filePath)
    try {
        // 使用 execa 执行 ffprobe 命令
        const { stdout, stderr } = await execa('ffprobe', selectJsonArgs)
        // console.log(stdout)
        // console.log(stderr)
        // return parseFFProbeOutput(stdout)
        const info = JSON.parse(stdout)
        // 只返回stream第一项
        // format作为子项
        return {
            ...fixNumberValue(info.streams[0]),
            format: fixNumberValue(info.format),
        }
    } catch (error) {
        log.warn(`getMediaInfo: ${error.message}`)
    }
}

function fixNumberValue(obj) {
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

// getMediaInfo 返回数据示例
// 数字格式已转换
// 注意flac和ape格式的stream里没有bit_rate字段 format里有
// {
//     codec_name: 'mp3',
//     codec_long_name: 'MP3 (MPEG audio layer 3)',
//     codec_type: 'audio',
//     codec_tag_string: '[0][0][0][0]',
//     sample_fmt: 'fltp',
//     sample_rate: 44100,
//     channels: 2,
//     bits_per_sample: 0,
//     r_frame_rate: '0/0',
//     time_base: '1/14112000',
//     duration: 110.785306,
//     bit_rate: 320000,
//     side_data_list: [ {} ],
//     format: {
//       format_name: 'mp3',
//       format_long_name: 'MP2/3 (MPEG audio layer 2/3)',
//       duration: 110.785306,
//       size: 4434851,
//       bit_rate: 320248
//     }
//   }
// {
//     codec_name: 'pcm_s16le',
//     codec_long_name: 'PCM signed 16-bit little-endian',
//     codec_type: 'audio',
//     codec_tag_string: '[1][0][0][0]',
//     sample_fmt: 's16',
//     sample_rate: 44100,
//     channels: 2,
//     bits_per_sample: 16,
//     r_frame_rate: '0/0',
//     time_base: '1/44100',
//     duration: 84.666667,
//     bit_rate: 1411200,
//     format: {
//       format_name: 'wav',
//       format_long_name: 'WAV / WAVE (Waveform Audio)',
//       duration: 84.666667,
//       size: 14935804,
//       bit_rate: 1411257
//     }
//   }
// {
//     codec_name: 'flac',
//     codec_long_name: 'FLAC (Free Lossless Audio Codec)',
//     codec_type: 'audio',
//     codec_tag_string: '[0][0][0][0]',
//     sample_fmt: 's16',
//     sample_rate: 44100,
//     channels: 2,
//     bits_per_sample: 0,
//     r_frame_rate: '0/0',
//     time_base: '1/44100',
//     duration: 92.293333,
//     format: {
//       format_name: 'flac',
//       format_long_name: 'raw FLAC',
//       duration: 92.293333,
//       size: 10585210,
//       bit_rate: 917527
//     }
//   }

