/*
 * Project: mediac
 * Created: 2024-05-02 17:22:06
 * Modified: 2024-05-02 17:22:06
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { removeFieldsBy, roundNum } from './core.js'

class MediaStreamBase {
    constructor(
        {
            type, // 媒体类型
            format, // 格式名称
            codec, // 编解码器名称
            profile, // 编解码器配置概况
            size, // 文件大小
            duration, // 时长
            bitrate, // 比特率
        }

    ) {
        this.type = type // 媒体类型
        this.format = format // 格式名称
        this.codec = codec // 编解码器名称
        this.profile = profile // 编解码器配置概况
        this.size = size || 0 // 文件大小
        this.duration = duration // 时长
        this.bitrate = bitrate // 比特率
    }
}

class Video extends MediaStreamBase {
    constructor(
        {
            type, // 媒体类型
            format, // 格式名称
            codec, // 编解码器名称
            profile, // 编解码器配置概况
            size, // 文件大小
            duration, // 时长
            bitrate, // 比特率

            framerate, // 帧率
            bitDepth, // 位深 8bit or 10bit
            width, // 视频宽度
            height, // 视频高度
            aspectRatio, // 宽高比
            pixelFormat, // 像素格式
        }

    ) {
        super({ type, format, codec, profile, size, duration, bitrate })
        this.framerate = framerate // 帧率
        this.bitDepth = bitDepth // 位深 8bit or 10bit
        this.width = width // 视频宽度
        this.height = height // 视频高度
        this.aspectRatio = aspectRatio
        this.pixelFormat = pixelFormat
    }

}

class Audio extends MediaStreamBase {
    constructor(
        {
            type, // 媒体类型
            format, // 格式名称
            codec, // 编解码器名称
            profile, // 编解码器配置概况
            size, // 文件大小
            duration, // 时长
            bitrate, // 比特率
            sampleRate, // 采样率
        }

    ) {
        super({ type, format, codec, profile, size, duration, bitrate })
        this.sampleRate = sampleRate
    }
}

class MediaInfo {
    constructor(
        {
            provider, // 解析器
            format, // 文件的格式类型（如：video/mp4）
            size, // 文件大小，单位根据情况设定（如字节）
            duration, // 时长，单位根据情况设定（如秒）
            bitrate, // 平均比特率，单位根据情况设定（如bps）
            createdAt, // 创建时间
            audio, // audio stream 音频流
            video, // video stream 视频流
        }
    ) {
        this.provider = provider
        this.format = format
        this.size = size
        this.duration = duration
        this.bitrate = bitrate
        this.createdAt = createdAt
        this.audio = audio
        this.video = video
    }
}

function fromFFprobe(data) {
    const obj = {
        type: data['codec_type'], // 媒体类型
        format: data['codec_name'], // 格式名称
        codec: data['codec_tag_string'], // 编解码器名称
        profile: data['profile'], // 编解码器配置概况
        bitDepth: data['bits_per_raw_sample']
            || data['bits_per_raw_sample'], // 位深 8bit or 10bit
        size: data['size']
            || data['tags']?.['NUMBER_OF_BYTES'], // 文件大小
        duration: data['duration']
            || data['tags']?.['DURATION'], // 时长
        bitrate: data['bit_rate']
            || data['tags']?.['BPS'], // 比特率
        framerate: data['r_frame_rate'], // 帧率
        pixelFormat: data['pix_fmt'],
        width: data['width'], // 视频宽度
        height: data['height'], // 视频高度
        aspectRatio: data['display_aspect_ratio'],
        sampleRate: data['sample_rate'],
        language: data['tags']?.['language'], // 语言
    }
    return createStreamData(obj)
}

function fromMediaInfo(data) {
    // console.log('fromMediaInfo', data)
    const obj = {
        type: data['@type'].toLowerCase(), // 媒体类型
        format: data['Format'].toLowerCase(), // 格式名称
        codec: data['CodecID'], // 编解码器名称
        profile: data['Format_Profile'], // 编解码器配置概况
        bitDepth: data['BitDepth'], // 位深 8bit or 10bit
        size: data['StreamSize'], // 文件大小
        duration: data['Duration'], // 时长
        bitrate: data['BitRate'], // 比特率
        framerate: data['FrameRate_Num'] || data['FrameRate'], // 帧率
        pixelFormat: data['ColorSpace'] ?
            data['ColorSpace'] + data['ChromaSubsampling'] : undefined,
        width: data['Width'], // 视频宽度
        height: data['Height'], // 视频高度
        aspectRatio: data['DisplayAspectRatio'],
        sampleRate: data['SamplingRate'],
        language: data['language'], // 语言
    }
    return createStreamData(obj)
}

function createStreamData(obj) {
    const isAudio = obj.type === 'audio'
    const stream = isAudio ? (new Audio(obj)) : (new Video(obj))
    removeFieldsBy(stream, (k, v) => v === undefined || v === null)
    return stream
}

// 解析ffprobe json输出，返回MediaInfo
export function fromFFprobeJson(data) {
    // console.log('MediaInfo.fromFFprobeJson', data)
    const root = data.format
    const ad = data.streams?.find(obj => obj.codec_type === "audio")
    const vd = data.streams?.find(obj => obj.codec_type === "video")
    const obj = {
        provider: 'ffprobe',
        format: root['format_long_name'],
        size: root['size'],
        duration: root['duration'],
        bitrate: root['bit_rate'],
        createdAt: root['tags']?.['creation_time'],
        audio: ad && fromFFprobe(ad),
        video: vd && fromFFprobe(vd),
    }
    const info = new MediaInfo(convertNumber(obj))
    removeFieldsBy(info, (k, v) => v === undefined || v === null)
    return info
}

// 解析mediainfo json输出，返回MediaInfo
export function fromMediaInfoJson(data) {
    // console.log('MediaInfo.fromMediaInfoJson', data)
    const root = data.media?.track?.find(o => o['@type'] === "General")
    const ad = data.media?.track?.find(o => o['@type'] === "Audio")
    const vd = data.media?.track?.find(o => o['@type'] === "Video")
    const obj = {
        provider: 'mediainfo',
        format: root['Format']?.toLowerCase(),
        size: root['FileSize'],
        duration: root['Duration'],
        bitrate: root['OverallBitRate'],
        createdAt: root['Encoded_Date'],
        audio: ad && fromMediaInfo(ad),
        video: vd && fromMediaInfo(vd),
    }
    const info = new MediaInfo(convertNumber(obj))
    removeFieldsBy(info, (k, v) => v === undefined || v === null)
    return info
}

// 计算平均码率的方法
// 如果是单音频文件，还有一个码率计算方式
// fileSize / duration * 8 = bitrate
// 或者如果知道流大小，也可以计算出来
// streamSize / duration * 8 = bitrate
// 还可以用用ffmpeg读取元数据，需要解析
//  ffmpeg -hide_banner -i video.mp4 -c copy -f null -

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