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
import { FFPROBE_BINARY } from './shared.js'

// ffprobe -v error -show_entries 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,channels,bits_per_sample:format=format_name,format_long_name,duration,size,bit_rate:format_tags:stream_tags' -of json
// 获取媒体文件信息的函数
export async function getMediaInfo(filePath, options = { video: false, audio: false, fullData: false }) {
    // 只选择需要的字段，避免乱码和非法JSON
    // 有的文件视频和音频duration和bit_rate放在stream_tags里
    const propsSelected = 'stream=codec_name,codec_long_name,profile,codec_type,codec_tag_string,width,height,display_aspect_ratio,pix_fmt,duration,bit_rate,sample_rate,sample_fmt,time_base,r_frame_rate,avg_frame_rate,channels,bits_per_sample,bits_per_raw_sample:format=format_name,format_long_name,duration,size,bit_rate:stream_tags'
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
        log.debug('getMediaInfo', filePath, info)
        // 只返回第一条视频轨和第一条音轨
        // 如果有fullData参数，返回全部streams数据
        const result = {
            video: convertNumber(info.streams.find(obj => obj.codec_type === "video")),
            audio: convertNumber(info.streams.find(obj => obj.codec_type === "audio")),
            format: convertNumber(info.format),
            streams: options.fullData ? info.streams : undefined,
        }
        if (result.video) {
            result.video.duration = result.video?.duration || result.video?.tags?.DURATION
            result.video.bit_rate = result.video?.bit_rate || result.video?.tags?.BPS
            result.video.framerate = result.video?.r_frame_rate || result.video?.avg_frame_rate
            // 位深
            result.video.bit_depth = result.video?.bits_per_sample || result.video?.bits_per_raw_sample
        }
        // 特殊处理，有些视频文件的时长和码率参数放在stream_tags里
        if (result.audio) {
            result.audio.duration = result.audio?.duration || result.audio?.tags?.DURATION
            result.audio.bit_rate = result.audio?.bit_rate || result.audio?.tags?.BPS
        }
        // 计算平均码率的方法
        // 如果是单音频文件，还有一个码率计算方式
        // fileSize / duration * 8 = bitrate
        // 或者如果知道流大小，也可以计算出来
        // streamSize / duration * 8 = bitrate
        // 还可以用用ffmpeg读取元数据，需要解析
        //  ffmpeg -hide_banner -i video.mp4 -c copy -f null -
        return result
    } catch (error) {
        log.warn(`ERROR:`, error.message?.slice(-160))
    }
}

export async function getSimpleInfo(filePath, options = {}) {
    const info = await getMediaInfo(filePath, options)
    const arr = []
    arr.push(`format=${info?.format?.format_name},duration=${info?.format?.duration}s,bitrate=${roundNum((info?.format?.bit_rate || 0) / 1000)}K`)
    if (info?.audio) {
        const a = info?.audio
        arr.push(`a:codec=${a.codec_name},bitrate=${roundNum(a.bit_rate || 0 / 1000)}K`)
    }
    if (info?.video) {
        const v = info?.video
        arr.push(`v:codec=${v.codec_name},bitrate=${roundNum(v.bit_rate || 0 / 1000)}K,fps=${v.r_frame_rate},size=${v.width}x${v.height}`)
    }

    return arr
}

// "tags": {
//     "title": "Encode By H-Enc",
//     "BPS": "2430147",
//     "DURATION": "00:16:44.003000000",
// }
// 提取tags里DURATION字段
// 示例 00:16:43.946000000
// 示例 00:16:44.003000000
// 分割 (00):(16):(44.003000000)
function extractDuration(timeString) {
    // 使用 match 方法匹配时间字符串中的各个部分
    const match = timeString.match(/(\d{2}):(\d{2}):(\d{2}(?:\.\d+))?/)

    if (match) {
        // log.showBlue(timeString, match)
        // 解构赋值提取匹配到的时间部分
        const [, hours, minutes, seconds] = match.map(Number)
        // 将时间部分转换成秒
        return roundNum(hours * 3600 + minutes * 60 + seconds)
    } else {
        return 0
    }
}

// 字符串值转为数字值，修改原对象
function convertNumber(obj) {
    // 兼容空值
    if (!obj) return obj
    // 遍历对象的所有属性
    for (const [key, value] of Object.entries(obj)) {
        // 匹配 DURATION
        if (key === 'DURATION') {
            obj[key] = extractDuration(value)
            continue
        }
        // 对于对象类型，递归处理
        if (typeof value === 'object') {
            obj[key] = convertNumber(value)
            continue
        }
        // 检查属性的值是否为字符串类型且可以转换为数字
        else if (typeof value === 'string') {
            // 匹配字符串数字
            if (/^\d+(\.\d+)?$/.test(value)) {
                // 解析字符串数字
                // 如果可以转换为数字，则将其转换并更新对象的值
                obj[key] = roundNum(parseFloat(value))
            } else if (key.includes('frame_rate')) {
                // 解析 '25/1' 这种 r_frame_rate 字段值
                const regex = /(\d+)\/(\d+)/
                const match = value.match(regex)
                if (match) {
                    const numerator = parseInt(match[1])
                    const denominator = parseInt(match[2])
                    if (denominator !== 0) {
                        obj[key] = roundNum(numerator / denominator)
                    } else {
                        obj[key] = 0
                    }
                }
            }
            continue
        }
    }
    return obj
}

// 返回数据示例 video/audio/format 三个字段

// {
//     video: {
//       codec_name: 'hevc',
//       codec_long_name: 'H.265 / HEVC (High Efficiency Video Coding)',
//       profile: 'Main 10',
//       codec_type: 'video',
//       codec_tag_string: '[0][0][0][0]',
//       width: 1920,
//       height: 1080,
//       display_aspect_ratio: '16:9',
//       pix_fmt: 'yuv420p10le',
//       r_frame_rate: 23.98,
//       avg_frame_rate: 23.98,
//       time_base: '1/1000',
//       tags: {
//         title: 'Encode By H-Enc',
//         BPS: '2430147',
//         DURATION: '00:16:44.003000000',
//         NUMBER_OF_FRAMES: '24072',
//         NUMBER_OF_BYTES: '304984449',
//         _STATISTICS_WRITING_APP: "mkvmerge v70.0.0 ('Caught A Lite Sneeze') 64-bit",
//         _STATISTICS_WRITING_DATE_UTC: '2022-10-05 18:40:29',
//         _STATISTICS_TAGS: 'BPS DURATION NUMBER_OF_FRAMES NUMBER_OF_BYTES'
//       }
//     },
//     audio: {
//       codec_name: 'aac',
//       codec_long_name: 'AAC (Advanced Audio Coding)',
//       profile: 'LC',
//       codec_type: 'audio',
//       codec_tag_string: '[0][0][0][0]',
//       sample_fmt: 'fltp',
//       sample_rate: 48000,
//       channels: 2,
//       bits_per_sample: 0,
//       r_frame_rate: 0,
//       avg_frame_rate: 0,
//       time_base: '1/1000',
//       tags: {
//         BPS: '261491',
//         DURATION: '00:16:43.946000000',
//         NUMBER_OF_FRAMES: '47060',
//         NUMBER_OF_BYTES: '32815429',
//         _STATISTICS_WRITING_APP: "mkvmerge v70.0.0 ('Caught A Lite Sneeze') 64-bit",
//         _STATISTICS_WRITING_DATE_UTC: '2022-10-05 18:40:29',
//         _STATISTICS_TAGS: 'BPS DURATION NUMBER_OF_FRAMES NUMBER_OF_BYTES'
//       }
//     },
//     format: {
//       format_name: 'matroska,webm',
//       format_long_name: 'Matroska / WebM',
//       duration: 1004,
//       size: 338094926,
//       bit_rate: 2693975
//     },
//   }