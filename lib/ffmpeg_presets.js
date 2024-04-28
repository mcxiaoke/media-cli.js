/*
 * Project: mediac
 * Created: 2024-04-27 13:21:17
 * Modified: 2024-04-27 13:21:17
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import * as core from './core.js'

const PRESET_NAMES = []
const PRESET_MAP = new Map()
const PREFIX_MEDIAC = "[SHANA] "

// videoArgs = { args,codec,quality,bitrate,filters}
// audioOptons = {args,codec, quality,bitrate,filters} 
// audioArgs = {prefix,suffix}
const ACODEC_LC = '-c:a libfdk_aac'
const ACODEC_HE = '-c:a libfdk_aac -profile:a aac_he'
const VCODEC_HEVC = '-c:v hevc_nvenc -profile:v main -tune:v hq'

// ffmpeg命令参数预设类
class FFmpegPreset {
    constructor(name, {
        format,
        type,
        prefix,
        suffix,
        videoArgs,
        audioArgs,
        inputArgs,
        streamArgs,
        extraArgs,
        outputArgs,
        filters,
        complexFilter,
        output,
        videoBitrate = 0,
        videoQuality = 0,
        audioBitrate = 0,
        audioQuality = 0,
        dimension = 0,
        speed = 1,
        framerate = 0,
        smartBitrate,
    } = {}) {
        this.name = name
        this.format = format
        this.type = type
        this.prefix = prefix
        this.suffix = suffix
        this.videoArgs = videoArgs
        this.audioArgs = audioArgs
        this.inputArgs = inputArgs
        this.streamArgs = streamArgs
        this.extraArgs = extraArgs
        this.outputArgs = outputArgs
        this.filters = filters
        this.complexFilter = complexFilter
        // 输出目录
        this.output = output
        // 视频码率和质量
        this.videoBitrate = videoBitrate
        this.videoQuality = videoQuality
        // 音频码率和质量
        this.audioBitrate = audioBitrate
        this.audioQuality = audioQuality
        // 视频尺寸
        this.dimension = dimension
        // 视频加速
        this.speed = speed
        // 视频帧率
        this.framerate = framerate
        // 智能计算码率
        this.smartBitrate = smartBitrate
        // 元数据参数
        // 用户从命令行设定的参数
        // 优先级最高
        this.userVideoBitrate = 0
        this.userVideoQuality = 0
        this.userAudioBitrate = 0
        this.userAudioQuality = 0
    }

    update(source) {
        for (const key in source) {
            this[key] = source[key]
        }
        return this
    }

    // 构造函数，参数为另一个 Preset 对象
    static fromPreset(preset) {
        return new FFmpegPreset(preset.name, preset)
    }

}

// HEVC基础参数
const HEVC_BASE = new FFmpegPreset('hevc-base', {
    format: '.mp4',
    type: 'video',
    smartBitrate: true,
    intro: 'hevc|hevc_nvenc|libfdk_aac',
    prefix: PREFIX_MEDIAC,
    suffix: '_{videoBitrate}k',
    description: 'HEVC_BASE',
    // 视频参数说明
    // video_codec block '-c:v hevc_nvenc -profile:v main -tune:v hq'
    // video_quality block '-cq {quality} -bufsize {bitrate} -maxrate {bitrate}'
    videoArgs: VCODEC_HEVC + ' -cq {videoQuality} -bufsize {videoBitrate}k -maxrate {videoBitrate}k',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrate}'
    audioArgs: '-c:a libfdk_aac -b:a {audioBitrate}k',
    inputArgs: '',
    streamArgs: '-map_metadata 0 -map_metadata:s:v 0:s:v',
    // 快速读取和播放
    outputArgs: '-movflags +faststart -movflags use_metadata_tags',
    // todo 缩放使用JS计算设置宽高，更灵活，有时可以不用filter
    // -vf 'scale=if(gte(iw\,ih)\,min(1280\,iw)\,-2):if(lt(iw\,ih)\,min(1280\,ih)\,-2)'
    filters: "scale_cuda='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)'",
    complexFilter: '',
})

const PRESET_HEVC_ULTRA = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_ultra',
    videoQuality: 20,
    videoBitrate: 20000,
    audioBitrate: 320,
    dimension: 3840
})

const PRESET_HEVC_4K = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_4k',
    videoQuality: 22,
    videoBitrate: 10000,
    audioBitrate: 256,
    dimension: 3840
})

const PRESET_HEVC_2K = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2k',
    videoQuality: 22,
    videoBitrate: 4000,
    audioBitrate: 192,
    dimension: 1920
})

const PRESET_HEVC_MEDIUM = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_medium',
    videoQuality: 24,
    videoBitrate: 2000,
    audioBitrate: 128,
    dimension: 1920
})

const PRESET_HEVC_LOW = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_low',
    videoQuality: 26,
    videoBitrate: 1600,
    audioBitrate: 96,
    dimension: 1920
})

const PRESET_HEVC_LOWEST = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_lowest',
    videoQuality: 26,
    videoBitrate: 1200,
    audioQuality: 2,
    audioBitrate: 64,
    dimension: 1920,
    framerate: 30,
    smartBitrate: false,
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrate}k',
})

// AAC VBR Mode bitrate range
//     VBR	kbps/channel	AOTs
// 1	20-32	LC,HE,HEv2
// 2	32-40	LC,HE,HEv2
// 3	48-56	LC,HE,HEv2
// 4	64-72	LC
// 5	96-112	LC
const PRESET_HEVC_SPEED = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_speed',
    suffix: '_{videoBitrate}k_{speed}x',
    videoQuality: 26,
    videoBitrate: 500,
    audioQuality: 1,
    audioBitrate: 48,
    dimension: 1920,
    speed: 1.5,
    framerate: 25,
    smartBitrate: false,
    streamArgs: '-map [v] -map [a]',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac -profile:a aac_he'
    // audio_quality block '-b:a 48k'
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrate}k',
    // filters 和 complexFilter 不能共存，此预设使用 complexFilter
    filters: '',
    // 这里单引号必须，否则逗号需要转义，Windows太多坑
    complexFilter: "[0:v]setpts=PTS/{speed},scale_cuda='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)'[v];[0:a]atempo={speed}[a]"
})


// 音频AAC CBR基础参数
const AAC_CBR_BASE = new FFmpegPreset('aac_cbr_base', {
    format: '.m4a',
    type: 'audio',
    smartBitrate: true,
    intro: 'aac_cbr|libfdk_aac',
    prefix: PREFIX_MEDIAC,
    suffix: '_{audioBitrate}k',
    description: 'AAC_CBR_BASE',
    videoArgs: '',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrate}'
    audioArgs: '-map 0:a -c:a libfdk_aac -b:a {audioBitrate}k',
    inputArgs: '',
    streamArgs: '-vn -map_metadata 0 -map_metadata:s:a 0:s:a',
    outputArgs: '-movflags +faststart -movflags use_metadata_tags',
})

// 音频AAC VBR基础参数
const AAC_VBR_BASE = new FFmpegPreset('aac_vbr_base', {
    format: '.m4a',
    type: 'audio',
    smartBitrate: false,
    intro: 'aac_vbr|libfdk_aac',
    prefix: PREFIX_MEDIAC,
    suffix: '_q{audioQuality}',
    description: 'AAC_VBR_BASE',
    videoArgs: '',
    audioArgs: '-map 0:a -c:a libfdk_aac -vbr {audioQuality}',
    inputArgs: '',
    streamArgs: '-vn -map_metadata 0 -map_metadata:s:a 0:s:a',
    outputArgs: '-movflags +faststart -movflags use_metadata_tags',
})

// 从视频中提取音频，音频参数，音频码率自适应
const PRESET_AUDIO_EXTRACT = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'audio_extract',
    intro: 'aac|extract',
    audioArgs: '-c:a copy',
    // -vn 参数，忽略视频流，还可以避免cover被当作视频流
    streamArgs: '-vn -map 0:a:0 -map_metadata 0 -map_metadata:s:a 0:s:a'
})


//音频AAC最高码率
const PRESET_AAC_HIGH = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_high',
    audioBitrate: 320,
})
//音频AAC中码率
const PRESET_AAC_MEDIUM = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_medium',
    audioBitrate: 192,
})
// 音频AAC低码率
const PRESET_AAC_LOW = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_low',
    audioBitrate: 128,
})

// 使用AAC_HE编码器，可指定码率和质量，默认VBR1
const PRESET_AAC_HE = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_he',
    smartBitrate: false,
    audioQuality: 2,
    audioBitrate: 80,
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrate}k',
})

// VBR模式，忽略码率
const PRESET_AAC_VBR = FFmpegPreset.fromPreset(AAC_VBR_BASE).update({
    name: 'aac_vbr',
    audioQuality: 4,
})

// 音频AAC极低码率，适用人声
const PRESET_AAC_VOICE = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_voice',
    smartBitrate: false,
    audioBitrate: 48,
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrate}k',
})

function getPreset(name) {
    return PRESET_MAP.get(name)
}

function getAllPresets() {
    return PRESET_MAP
}

function getAllNames() {
    return PRESET_NAMES
}

function isAudioExtract(preset) {
    return preset.name === PRESET_AUDIO_EXTRACT.name
}

function initPresets() {
    const presets = {
        //4K超高码率和质量
        PRESET_HEVC_ULTRA: PRESET_HEVC_ULTRA,
        //4k高码率和质量
        PRESET_HEVC_4K: PRESET_HEVC_4K,
        // 2K高码率和质量
        PRESET_HEVC_2K: PRESET_HEVC_2K,
        // 2K中码率和质量
        PRESET_HEVC_MEDIUM: PRESET_HEVC_MEDIUM,
        // 2K低码率和质量
        PRESET_HEVC_LOW: PRESET_HEVC_LOW,
        // 极低画质和码率
        PRESET_HEVC_LOWEST: PRESET_HEVC_LOWEST,
        // 极速模式，适用于视频教程
        PRESET_HEVC_SPEED: PRESET_HEVC_SPEED,
        // 提取视频中的音频，复制或转换为AAC格式
        PRESET_AUDIO_EXTRACT: PRESET_AUDIO_EXTRACT,
        //音频AAC最高码率
        PRESET_AAC_HIGH: PRESET_AAC_HIGH,
        //音频AAC中码率
        PRESET_AAC_MEDIUM: PRESET_AAC_MEDIUM,
        // 音频AAC低码率
        PRESET_AAC_LOW: PRESET_AAC_LOW,
        // 使用AAC_HE编码器，可指定码率和质量，默认VBR1
        PRESET_AAC_HE: PRESET_AAC_HE,
        // VBR模式，忽略码率
        PRESET_AAC_VBR: PRESET_AAC_VBR,
        // 音频AAC极低码率，适用人声
        PRESET_AAC_VOICE: PRESET_AAC_VOICE
    }

    core.modifyObjectWithKeyField(presets, 'description')
    for (const [key, preset] of Object.entries(presets)) {
        PRESET_NAMES.push(preset.name)
        PRESET_MAP.set(preset.name, preset)
    }
}

// 初始化调用
initPresets()

export default {
    FFmpegPreset,
    getPreset,
    getAllPresets,
    getAllNames,
    isAudioExtract,
}
