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
        bitDepth, // 位深 8bit or 10bit
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
        this.bitDepth = bitDepth // 位深 8bit or 10bit
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
    }

    static fromFFprobe(obj) {
        return null
    }

    static fromMediaInfo(data) {
        const obj = {

        } = data
        return new MediaStream(obj)
    }
}

class MediaInfo {
    constructor(
        format, // 文件的格式类型（如：video/mp4）
        size, // 文件大小，单位根据情况设定（如字节）
        duration, // 时长，单位根据情况设定（如秒）
        bitrate, // 平均比特率，单位根据情况设定（如bps）
        audio, // audio stream 音频流
        video, // video stream 视频流
    ) {
        this.format = format
        this.size = size
        this.duration = duration
        this.bitrate = bitrate
        this.audio = audio || {}
        this.video = video || {}
    }

    // 解析ffprobe json输出，返回MediaInfo
    static fromFFprobeJson(data) {
        const obj = {
            format: format_name,
            size: size,
            duration: duration,
            bitrate: bit_rate,
            audio: MediaStream.fromFFprobe(data.audio),
            video: MediaStream.fromFFprobe(data.video),
        } = data.format
        return new MediaInfo(obj)
    }

    // 解析mediainfo json输出，返回MediaInfo
    static fromMediaInfo(data) {
        const vd = data.media.track.find(o => o.type === "Video")
        const ad = data.media.track.find(o => o.type === "Audio")
        const obj = {
            format: Format,
            size: FileSize,
            duration: Duration,
            bitrate: OverallBitRate,
            audio: MediaStream.fromMediaInfo(ad),
            video: MediaStream.fromMediaInfo(vd),
        } = data.media.track.find(o => o.type === "General")
        return new MediaInfo(obj)
    }
}