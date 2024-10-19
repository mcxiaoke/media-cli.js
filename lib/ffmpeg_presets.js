/*
 * Project: mediac
 * Created: 2024-04-27 13:21:17
 * Modified: 2024-04-27 13:21:17
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import path from 'path'
import * as core from './core.js'

const UNIT_KB = 1000
const UNIT_MB = UNIT_KB * 1000
const BIT_RATE_48K = UNIT_KB * 48
const BIT_RATE_72K = UNIT_KB * 72
const BIT_RATE_96K = UNIT_KB * 96
const BIT_RATE_128K = UNIT_KB * 128
const BIT_RATE_192K = UNIT_KB * 192
const BIT_RATE_256K = UNIT_KB * 256
const BIT_RATE_320K = UNIT_KB * 320
const BIT_RATE_500K = UNIT_KB * 500
const BIT_RATE_1000K = UNIT_KB * 1000
const BIT_RATE_1200K = UNIT_KB * 1200
const BIT_RATE_1600K = UNIT_KB * 1600
const BIT_RATE_2000K = UNIT_KB * 2000
const BIT_RATE_4000K = UNIT_KB * 4000
const BIT_RATE_6000K = UNIT_KB * 6000
const BIT_RATE_8M = UNIT_MB * 8
const BIT_RATE_10M = UNIT_MB * 10
const BIT_RATE_16M = UNIT_MB * 16

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
        this.userArgs = {
            videoBitrate: 0,
            videoQuality: 0,
            audioBitrate: 0,
            audioQuality: 0,
            dimension: 0,
            speed: 0,
            framerate: 0,
            audioCopy: false,
            videoCopy: false,
        }
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

// Recommended video bitrates for SDR uploads
// Type         StandardRate    HighRate
// 8K           80 - 160 Mbps   120 to 240 Mbps
// 2160p (4K)   35–45 Mbps      53–68 Mbps
// 1440p (2K)   16 Mbps         24 Mbps
// 1080p        8 Mbps          12 Mbps
// 720p         5 Mbps          7.5 Mbps
// 480p         2.5 Mbps        4 Mbps
// 360p         1 Mbps          1.5 Mbps
// Audio Mono   128 kbps
// Audio Stereo 384 kbps
// 
// HEVC_NVENC CQ模式码率
// CQ22 = 16M
// CQ24 = 12M
// CQ26 = 9M
// CQ28 = 6M
// CQ30 = 5M
// CQ32 = 4M
// CQ34 = 3M
// CQ36 = 2M
// CQ38 = 1.5M
// CQ40 = 1.3m
// CQ42 = 1M
// CQ50 = 600k

const PRESET_NAMES = []
const PRESET_MAP = new Map()
const PREFIX_MEDIAC = "[SHANA] "

// videoArgs = { args,codec,quality,bitrate,filters}
// audioOptons = {args,codec, quality,bitrate,filters} 
// audioArgs = {prefix,suffix}
const ACODEC_LC = '-c:a libfdk_aac'
const ACODEC_HE = '-c:a libfdk_aac -profile:a aac_he'
// H264 AVC
const VCODEC_NVENC_H264 = '-c:v h264_nvenc -rc vbr_hq -rc-lookahead 30'
//  HEVC -profile:v main -tune:v hq
const VCODEC_NVENC_HEVC = '-c:v hevc_nvenc -rc vbr_hq -rc-lookahead 30'
//  HEVC QSV 
// https://trac.ffmpeg.org/wiki/Hardware/QuickSync
// https://github.com/intel/media-delivery/blob/master/doc/quality.rst
// working: ffmpeg -c:v hevc_qsv -i input.mp4 -c:v hevc_qsv -global_quality 26 -preset medium output.mp4
const VCODEC_QSV_HEVC = '-c:v hevc_qsv -look_ahead 1'

// AVC H264基础参数
const H264_BASE = new FFmpegPreset('h264-base', {
    format: '.mp4',
    type: 'video',
    smartBitrate: true,
    intro: 'h264|h264_nvenc|libfdk_aac',
    prefix: PREFIX_MEDIAC,
    suffix: '_{preset}',
    description: 'H264_BASE',
    dimension: 3840,
    speed: 0,
    framerate: 0,
    // 视频参数说明
    // video_codec block '-c:v h264_nvenc -profile:v main -tune:v hq'
    // video_quality block '-cq {quality} -bufsize {bitrateK} -maxrate {bitrateK}'
    videoArgs: VCODEC_NVENC_H264 + ' -cq {videoQuality} -bufsize {videoBitrateK} -maxrate {videoBitrateK}',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrateK}'
    audioArgs: '-c:a libfdk_aac -b:a {audioBitrateK}',
    inputArgs: '',
    streamArgs: '-map_metadata 0 -map_metadata:s:v 0:s:v',
    // 快速读取和播放
    outputArgs: '-movflags +faststart -movflags use_metadata_tags',
    // -vf 'scale=if(gte(iw\,ih)\,min(1280\,iw)\,-2):if(lt(iw\,ih)\,min(1280\,ih)\,-2)'
    filters: "scale_cuda='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)':interp_algo=lanczos",
    complexFilter: '',
})
// AVC H264
const PRESET_H264_2K = FFmpegPreset.fromPreset(H264_BASE).update({
    name: 'h264_2k',
    videoQuality: 24,
    videoBitrate: BIT_RATE_4000K,
    audioBitrate: BIT_RATE_192K,
    dimension: 1920
})
// AVC H264
const PRESET_H264_MEDIUM = FFmpegPreset.fromPreset(H264_BASE).update({
    name: 'h264_2km',
    videoQuality: 26,
    videoBitrate: BIT_RATE_2000K,
    audioBitrate: BIT_RATE_128K,
    dimension: 1920
})
// AVC H264
const PRESET_H264_LOW = FFmpegPreset.fromPreset(H264_BASE).update({
    name: 'h264_2kl',
    videoQuality: 26,
    videoBitrate: BIT_RATE_1600K,
    audioBitrate: BIT_RATE_96K,
    dimension: 1920
})

// HEVC QSV H265基础参数
const HEVC_QSV_BASE = new FFmpegPreset('hevc-qsv-base', {
    format: '.mp4',
    type: 'video',
    smartBitrate: true,
    intro: 'hevc|hevc_qsv|libfdk_aac',
    prefix: PREFIX_MEDIAC,
    suffix: '_{preset}',
    description: 'HEVC_QSV_BASE',
    dimension: 3840,
    speed: 0,
    framerate: 0,
    // 视频参数说明
    // video_codec block '-c:v hevc_nvenc -profile:v main -tune:v hq'
    // video_quality block '-cq {quality} -bufsize {bitrateK} -maxrate {bitrateK}'
    videoArgs: VCODEC_QSV_HEVC + ' -global_quality {videoQuality} -bufsize {videoBitrateK} -maxrate {videoBitrateK}',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrateK}'
    audioArgs: '-c:a libfdk_aac -b:a {audioBitrateK}',
    inputArgs: '',
    streamArgs: '-map_metadata 0 -map_metadata:s:v 0:s:v',
    // 快速读取和播放
    outputArgs: '-movflags +faststart -movflags use_metadata_tags',
    // -vf 'scale=if(gte(iw\,ih)\,min(1280\,iw)\,-2):if(lt(iw\,ih)\,min(1280\,ih)\,-2)'
    filters: "scale_qsv='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)'",
    complexFilter: '',
})

const PRESET_HEVC_QSV_2K = FFmpegPreset.fromPreset(HEVC_QSV_BASE).update({
    name: 'hevc_qsv2k',
    videoQuality: 26,
    videoBitrate: BIT_RATE_4000K,
    audioBitrate: BIT_RATE_192K,
    dimension: 1920
})

const PRESET_HEVC_QSV_MEDIUM = FFmpegPreset.fromPreset(HEVC_QSV_BASE).update({
    name: 'hevc_qsv2km',
    videoQuality: 28,
    videoBitrate: BIT_RATE_2000K,
    audioBitrate: BIT_RATE_128K,
    dimension: 1920
})

// HEVC H265基础参数
const HEVC_BASE = new FFmpegPreset('hevc-base', {
    format: '.mp4',
    type: 'video',
    smartBitrate: true,
    intro: 'hevc|hevc_nvenc|libfdk_aac',
    prefix: PREFIX_MEDIAC,
    suffix: '_{preset}',
    description: 'HEVC_BASE',
    dimension: 3840,
    speed: 0,
    framerate: 0,
    // 视频参数说明
    // video_codec block '-c:v hevc_nvenc -profile:v main -tune:v hq'
    // video_quality block '-cq {quality} -bufsize {bitrateK} -maxrate {bitrateK}'
    videoArgs: VCODEC_NVENC_HEVC + ' -cq {videoQuality} -bufsize {videoBitrateK} -maxrate {videoBitrateK}',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrateK}'
    audioArgs: '-c:a libfdk_aac -b:a {audioBitrateK}',
    inputArgs: '',
    streamArgs: '-map_metadata 0 -map_metadata:s:v 0:s:v',
    // 快速读取和播放
    outputArgs: '-movflags +faststart -movflags use_metadata_tags',
    // -vf 'scale=if(gte(iw\,ih)\,min(1280\,iw)\,-2):if(lt(iw\,ih)\,min(1280\,ih)\,-2)'
    // 前面如果不加 hwupload_cuda 某些10bit视频会报错
    // 查了半天，发现Nvidia和Intel都不支持H264-10bit的硬解，但是HEVC-10bit可以
    filters: "scale_cuda='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)':interp_algo=lanczos",
    complexFilter: '',
})

const PRESET_HEVC_ULTRA = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_4ku',
    videoQuality: 20,
    videoBitrate: BIT_RATE_16M,
    audioBitrate: BIT_RATE_256K,
    dimension: 3840
})

const PRESET_HEVC_4K = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_4k',
    videoQuality: 22,
    videoBitrate: BIT_RATE_10M,
    audioBitrate: BIT_RATE_256K,
    dimension: 3840
})

const PRESET_HEVC_4K_LOW = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_4kl',
    videoQuality: 24,
    videoBitrate: BIT_RATE_6000K,
    audioBitrate: BIT_RATE_256K,
    dimension: 3840
})

const PRESET_HEVC_4K_LOWEST = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_4kt',
    videoQuality: 26,
    videoBitrate: BIT_RATE_4000K,
    audioBitrate: BIT_RATE_192K,
    dimension: 3840
})

const PRESET_HEVC_2K_ULTRA = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2ku',
    videoQuality: 22,
    videoBitrate: BIT_RATE_8M,
    audioBitrate: BIT_RATE_256K,
    dimension: 1920
})

const PRESET_HEVC_2K_HIGH = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2kh',
    videoQuality: 22,
    videoBitrate: BIT_RATE_6000K,
    audioBitrate: BIT_RATE_256K,
    dimension: 1920
})

const PRESET_HEVC_2K = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2k',
    videoQuality: 24,
    videoBitrate: BIT_RATE_4000K,
    audioBitrate: BIT_RATE_192K,
    dimension: 1920
})

const PRESET_HEVC_2K_MEDIUM = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2km',
    videoQuality: 26,
    videoBitrate: BIT_RATE_2000K,
    audioBitrate: BIT_RATE_128K,
    dimension: 1920
})

const PRESET_HEVC_2K_LOW = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2kl',
    videoQuality: 26,
    videoBitrate: BIT_RATE_1600K,
    audioBitrate: BIT_RATE_128K,
    dimension: 1920
})

const PRESET_HEVC_2K_LOWEST = FFmpegPreset.fromPreset(HEVC_BASE).update({
    name: 'hevc_2kt',
    videoQuality: 28,
    videoBitrate: BIT_RATE_1200K,
    audioQuality: 3,
    audioBitrate: BIT_RATE_96K,
    dimension: 1920,
    framerate: 30,
    smartBitrate: false,
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrateK}',
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
    suffix: '_{speed}x',
    videoQuality: 30,
    videoBitrate: BIT_RATE_500K,
    audioQuality: 1,
    audioBitrate: BIT_RATE_48K,
    dimension: 1920,
    speed: 1.5,
    framerate: 25,
    smartBitrate: false,
    streamArgs: '-map [v] -map [a]',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac -profile:a aac_he'
    // audio_quality block '-b:a 48k'
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrateK}',
    // filters 和 complexFilter 不能共存，此预设使用 complexFilter
    filters: '',
    // 这里单引号必须，否则逗号需要转义，Windows太多坑
    complexFilter: "[0:v]setpts=PTS/{speed},scale_cuda='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)':interp_algo=lanczos,fps={framerate}[v];[0:a]atempo={speed}[a]"
})


// 音频AAC CBR基础参数
const AAC_CBR_BASE = new FFmpegPreset('aac_cbr_base', {
    format: '.m4a',
    type: 'audio',
    smartBitrate: true,
    intro: 'aac_cbr|libfdk_aac',
    prefix: '',
    suffix: '_{audioBitrateK}',
    description: 'AAC_CBR_BASE',
    videoArgs: '',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrateK}'
    audioArgs: '-map 0:a -c:a libfdk_aac -b:a {audioBitrateK}',
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
    prefix: '',
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
    prefix: '',
    suffix: '_audio',
    audioBitrate: BIT_RATE_192K,
    audioArgs: '-c:a copy',
    // -vn 参数，忽略视频流，还可以避免cover被当作视频流
    streamArgs: '-vn -map 0:a:0 -map_metadata 0 -map_metadata:s:a 0:s:a'
})


//音频AAC最高码率
const PRESET_AAC_HIGH = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_high',
    audioBitrate: BIT_RATE_320K,
})
//音频AAC中码率
const PRESET_AAC_MEDIUM = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_medium',
    audioBitrate: BIT_RATE_192K,
})
// 音频AAC低码率
const PRESET_AAC_LOW = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_low',
    audioBitrate: BIT_RATE_128K,
})

// 使用AAC_HE编码器，可指定码率和质量，默认VBR1
const PRESET_AAC_HE = FFmpegPreset.fromPreset(AAC_CBR_BASE).update({
    name: 'aac_he',
    smartBitrate: false,
    audioQuality: 2,
    audioBitrate: BIT_RATE_72K,
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrateK}',
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
    audioQuality: 1,
    audioBitrate: BIT_RATE_48K,
    audioArgs: ACODEC_HE + ' -vbr {audioQuality} -b:a {audioBitrateK}',
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
        // h264 normal
        PRESET_H264_2K: PRESET_H264_2K,
        // h264 medium
        PRESET_H264_MEDIUM: PRESET_H264_MEDIUM,
        // H264 LOW
        PRESET_H264_LOW: PRESET_H264_LOW,
        //4K超高码率和质量
        //4K超高码率和质量
        PRESET_HEVC_ULTRA: PRESET_HEVC_ULTRA,
        //4k高码率和质量
        PRESET_HEVC_4K: PRESET_HEVC_4K,
        PRESET_HEVC_4K_LOW: PRESET_HEVC_4K_LOW,
        PRESET_HEVC_4K_LOWEST: PRESET_HEVC_4K_LOWEST,
        // 2K极致质量
        PRESET_HEVC_2K_ULTRA: PRESET_HEVC_2K_ULTRA,
        // 2K高码率和质量
        PRESET_HEVC_HIGH: PRESET_HEVC_2K_HIGH,
        // 2K默认码率和质量
        PRESET_HEVC_2K: PRESET_HEVC_2K,
        // 2K中码率和质量
        PRESET_HEVC_MEDIUM: PRESET_HEVC_2K_MEDIUM,
        // 2K低码率和质量
        PRESET_HEVC_LOW: PRESET_HEVC_2K_LOW,
        // 极低画质和码率
        PRESET_HEVC_LOWEST: PRESET_HEVC_2K_LOWEST,
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

function createFromArgv(argv) {
    // 参数中指定的preset
    let preset = getPreset(argv.preset)
    // log.show('ARGV', argv)
    // log.show('P1', preset)
    // 克隆对象，不修改Map中的内容
    preset = structuredClone(preset)
    // 保存argv方便调试
    // preset.argv = JSON.stringify(argv)
    // 前缀可以为空字符串
    if (typeof argv.prefix === 'string') {
        preset.prefix = argv.prefix
    }
    // 后缀可以为空字符串
    if (typeof argv.suffix === 'string') {
        preset.suffix = argv.suffix
    }
    if (typeof argv.videoArgs === 'string') {
        preset.videoArgs = argv.videoArgs
    }
    if (typeof argv.audioArgs === 'string') {
        preset.audioArgs = argv.audioArgs
    }
    if (typeof argv.filters === 'string') {
        preset.filters = argv.filters
    }
    if (typeof argv.filterComplex === 'string') {
        preset.complexFilter = argv.filterComplex
    }
    // 输出目录
    if (typeof argv.output === 'string') {
        preset.output = path.resolve(argv.output)
    }
    // 用户指定 视频尺寸
    if (argv.dimension > 0) {
        preset.userArgs.dimension = argv.dimension
    }
    // 用户指定 视频速度
    if (argv.speed > 0) {
        preset.userArgs.speed = argv.speed
    }
    // 视频帧率，用户指定，优先级最高
    if (argv.framerate > 0) {
        preset.userArgs.framerate = argv.framerate
    }
    // 视频流复制，用户指定，优先级最高
    if (argv.videoCopy) {
        preset.videoArgs = '-c:v copy'
        // copy not compatible with filters
        preset.filters = ''
        preset.complexFilter = ''
        // 防止丢失字幕
        // https://askubuntu.com/questions/1328222
        // https://askubuntu.com/questions/214199
        // https://video.stackexchange.com/questions/35300
        // -scodec mov_text
        // ' -map 0'
        preset.userArgs.videoCopy = true
    } else {
        // 视频码率，用户指定，优先级最高
        // 注意 用户参数单位为K 转换单位
        if (argv.videoBitrate > 0) {
            preset.userArgs.videoBitrate = argv.videoBitrate * UNIT_KB
        }
        // 用户指定 视频质量参数
        if (argv.videoQuality > 0) {
            preset.userArgs.videoQuality = argv.videoQuality
        }
    }
    // 音频流复制，用户指定，优先级最高
    if (argv.audioCopy) {
        preset.audioArgs = '-c:a copy'
        preset.userArgs.audioCopy = true
    } else {
        // 注意 用户参数单位为K 转换单位
        // 如果不是复制音频流
        // 音频码率，用户指定，优先级最高
        if (argv.audioBitrate > 0) {
            preset.userArgs.audioBitrate = argv.audioBitrate * UNIT_KB
        }
        // 音频质量VBR，用户指定，优先级最高
        if (argv.audioQuality > 0) {
            preset.userArgs.audioQuality = argv.audioQuality
        }
    }
    // log.show('P2', preset)
    return preset
}

// 初始化调用
initPresets()

export default {
    UNIT_KB,
    UNIT_MB,
    FFmpegPreset,
    createFromArgv,
    getPreset,
    getAllPresets,
    getAllNames,
    isAudioExtract,
}
