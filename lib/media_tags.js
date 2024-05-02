/*
 * Project: mediac
 * Created: 2024-05-02 17:22:06
 * Modified: 2024-05-02 17:22:06
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

class MediaStream {
    constructor(
        type, // 媒体类型
        format, // 格式名称
        codec, // 编解码器名称
        profile, // 编解码器配置概况
        size, // 文件大小
        duration, // 时长，根据需要可能要转换为秒或其他单位
        bitrate, // 比特率
        bitrateMode, // 比特率模式
        framerate, // 帧率
        framerateMode, // 帧率模式
        frameCount, // 帧数量
        language, // 语言
        width, // 视频宽度
        height // 视频高度
    ) {
        this.type = type // 媒体类型
        this.format = format // 格式名称
        this.codec = codec // 编解码器名称
        this.profile = profile // 编解码器配置概况
        this.size = size // 文件大小
        this.duration = duration // 时长
        this.bitrate = bitrate // 比特率
        this.bitrateMode = bitrateMode // 比特率模式
        this.framerate = framerate // 帧率
        this.framerateMode = framerateMode // 帧率模式
        this.frameCount = frameCount // 帧数量
        this.language = language // 语言
        this.width = width // 视频宽度
        this.height = height // 视频高度

        // 可以在此处添加额外的逻辑，比如验证参数有效性等
    }

    // 解析ffprobe json输出，返回MediaInfo
    static fromFFprobeJson(ffprobeOutput) {
        return null
    }

    // 解析mediainfo json输出，返回MediaInfo
    static fromMediaInfoJson(mediaInfoOutput) {
        return null
    }
}

class MediaInfo {
    constructor(
        name, // 媒体文件或流的名称
        format, // 文件的格式类型（如：video/mp4）
        extension, // 文件扩展名（如：mp4）
        codec, // 编解码器名称（如：avc1）
        size, // 文件大小，单位根据情况设定（如字节）
        duration, // 时长，单位根据情况设定（如秒）
        bitrate, // 平均比特率，单位根据情况设定（如bps）
        framerate, // 平均帧率，单位根据情况设定（如fps）
        audioCount, // 音频轨道的数量
        videoCount, // 视频轨道的数量
        brands, // 文件或流支持的品牌或容器格式标志集合，可能为空，
        audio, // audio stream 音频流
        video, // video stream 视频流
    ) {
        this.name = name
        this.format = format
        this.extension = extension
        this.codec = codec
        this.size = size
        this.duration = duration
        this.bitrate = bitrate
        this.framerate = framerate
        this.audioCount = audioCount
        this.videoCount = videoCount
        this.brands = brands || []
        this.audio = audio || {}
        this.video = video || {}
    }
}