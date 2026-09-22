/*
 * Project: mediac
 * Created: 2024-05-02 17:22:06
 * Modified: 2024-05-02 17:22:06
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { removeFieldsBy, roundNum } from "./core.js"

class MediaStreamBase {
    constructor({
        type, // 媒体类型
        format, // 格式名称
        codec, // 编解码器名称
        profile, // 编解码器配置概况
        level, // 编码器等级
        size, // 文件大小
        duration, // 时长
        bitrate, // 比特率
        language, // 语言
    }) {
        this.type = type // 媒体类型
        this.format = format // 格式名称
        this.codec = codec // 编解码器名称
        this.profile = profile // 编解码器配置概况
        // ffprobe hevc 和 avc 不同
        if (format === "hevc") {
            this.level = level >= 30 ? level / 30 : level // 编码器等级
        } else {
            // h264 avc
            this.level = level >= 10 ? level / 10 : level // 编码器等级
        }
        this.size = size || 0 // 文件大小
        this.duration = duration // 时长
        this.bitrate = bitrate // 比特率
        this.language = language /// 语言
    }
}

class Subtitle extends MediaStreamBase {
    constructor({
        type, // 媒体类型
        format, // 格式名称
        codec, // 编解码器名称
        profile, // 编解码器配置概况
        level, // 编码器等级
        size, // 文件大小
        duration, // 时长
        bitrate, // 比特率
        language,
    }) {
        super({ type, format, codec, profile, level, size, duration, bitrate, language })
    }
}

// ---------------------------------------------------------------------------
// 源特征归一化（实测依据：docs/ffmpeg/ffmpeg-metadata-fields-20260922.md）
//
// 本文件是两个 provider（ffprobe / mediainfo）的唯一适配层，所以"最大兼容"的取值
// 规则集中放在这里，保证上层（hwaccel / ffmpeg_plan）拿到同一套语义。
// 实测数据：测试集 877 文件（专门构造畸形样本）+ 真实片库 U: 2447 文件。
// ---------------------------------------------------------------------------

/**
 * 已知的 8bit 像素格式（裸格式名，不带位深后缀）
 *
 * 为什么需要这张表：ffprobe 对 8bit 格式**不带任何位深标记**（`yuv420p`），
 * 而 `bits_per_raw_sample` 在实测中 68% 缺失（231/730 有值），mediainfo 的
 * `BitDepth` 也缺失 3.9%（真实片库，集中在 rmvb）。没有这张表就分不清
 * "8bit" 与 "未知"，会把 8bit 判成未知而走保守路径。
 */
const KNOWN_8BIT_PIX_FMTS = new Set([
    "yuv420p",
    "yuvj420p",
    "yuv422p",
    "yuvj422p",
    "yuv444p",
    "yuvj444p",
    "yuv410p",
    "yuv411p",
    "nv12",
    "nv21",
    "nv16",
    "nv24",
    "gbrp",
    "gray",
    "rgb24",
    "bgr24",
    "rgba",
    "bgra",
    "argb",
    "abgr",
    "pal8",
    "monow",
    "monob",
])

/**
 * 位深推导（最大兼容分级）
 *
 * 优先级（实测：两 provider 都给值时**零冲突**，差异只在覆盖范围）：
 *   ① `pix_fmt` 的位深标记（`10le/12le/16le`、`p010/p012/p016/p210/p410`）→ 命中即用
 *   ② `pix_fmt` 命中 {@link KNOWN_8BIT_PIX_FMTS} → 8
 *   ③ 显式位深（mediainfo `BitDepth` / ffprobe `bits_per_raw_sample`）
 *   ④ 都拿不到 → **undefined**（不静默按 8bit）
 *
 * ⚠️ ④ 是关键约定：mediainfo 的 `pixelFormat = ColorSpace + ChromaSubsampling`
 *    （如 `"YUV4:2:0"`）**不含位深**，若在这里默认 8bit，10bit 源会被误判（真实片库
 *    有 4 个此类样本：gray12le、cenv-VP9 10bit、AV1 4:4:4 10bit）。
 *    "未知"由上层决定方向，见 lib/hwaccel.js `bitDepthOf` 的保守处理。
 *
 * @param {string} [pixFmt] 像素格式（ffprobe `pix_fmt` 或 mediainfo 的拼接串）
 * @param {number|string} [explicitBitDepth] 显式位深
 * @returns {number|undefined} 8 / 10 / 12 / 16，或 undefined（未知）
 */
export function bitDepthOfFormat(pixFmt, explicitBitDepth) {
    const p = String(pixFmt || "").toLowerCase()
    if (/p016|16le|16be/.test(p)) return 16
    if (/p012|12le|12be/.test(p)) return 12
    if (/p010|10le|10be|p210|p410/.test(p)) return 10
    if (KNOWN_8BIT_PIX_FMTS.has(p)) return 8
    const n = Number(explicitBitDepth)
    if (Number.isFinite(n) && n > 0) return n >= 16 ? 16 : n >= 12 ? 12 : n >= 10 ? 10 : 8
    return undefined
}

/** "a:b" 或十进制（mediainfo 的 PixelAspectRatio="1.227"）→ 数值；无效返回 null */
function toRatio(v) {
    if (v === undefined || v === null || v === "") return null
    const s = String(v).trim()
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s)
    if (m) {
        const b = Number(m[2])
        return b > 0 ? Number(m[1]) / b : null
    }
    const n = Number(s)
    return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * 显示尺寸：编码尺寸 × SAR（非方形像素校正）
 *
 * 实测：真实片库 **4.8%（118/2444）SAR≠1**（《辛德勒的名单》SAR=27:22、
 * 《火的战车》53:45 等 DVD/HDTV 转录；测试集 3.3%）。SAR 只作用于宽度：
 * `displayW = codedW × SAR`，高度不变（DAR = SAR × W/H）。
 * 不校正的后果：720x480 SAR=27:22 的实际显示是 884x480（≈16:9），
 * 但按 coded 480 判"是否需要缩放"会得出相反结论。
 *
 * @returns {{width:number,height:number}|null} 需要校正时返回显示尺寸，否则 null
 */
function displaySize(width, height, sampleAspectRatio) {
    const w = Number(width)
    const h = Number(height)
    if (!(w > 0) || !(h > 0)) return null
    const sar = toRatio(sampleAspectRatio)
    if (!sar || Math.abs(sar - 1) < 1e-6) return null
    const dw = Math.round(w * sar)
    if (!(dw > 0) || dw === w) return null
    return { width: dw, height: h }
}

/**
 * 帧率归一化：标称优先 + 容错
 *
 * 实测依据：真实片库 37% 的文件属 23.976 家族，而 `avg_frame_rate` 受 VFR 影响会
 * 抖到 23.974~23.980（`r=24.000 / avg=23.975`、`r=25.000 / avg=25.003`）。
 * 直接用 avg 会让"请求帧率是否低于源"的比较产生**无意义的 fps 滤镜**。
 * 反过来，裸流（`.h264/.hevc` 单帧）的 `r_frame_rate` 可能是 `1200000/1` 这种离谱值
 * （测试集实测），所以 r 必须做合理性过滤。
 *
 * 规则：r 在 [1,240] 且与 avg 相对差 ≤5% → 用 r（标称）；否则用 avg；都无效 → undefined。
 * ⚠️ 比较"是否需要改帧率"时另需 ±2% 容差，见 lib/ffmpeg_plan.js。
 */
function normalizeFrameRate(rStr, avgStr) {
    const toNum = (s) => {
        const m = /^(\d+)\/(\d+)$/.exec(String(s || ""))
        if (!m) return null
        const d = Number(m[2])
        return d > 0 ? Number(m[1]) / d : null
    }
    const sane = (v) => v !== null && v >= 1 && v <= 240
    const r = toNum(rStr)
    const a = toNum(avgStr)
    if (sane(r) && sane(a) && Math.abs(r - a) / a <= 0.05) return r
    if (sane(a)) return a
    if (sane(r)) return r
    return undefined
}

class Video extends MediaStreamBase {
    constructor({
        type, // 媒体类型
        format, // 格式名称
        codec, // 编解码器名称
        profile, // 编解码器配置概况
        level, // 编码器等级
        size, // 文件大小
        duration, // 时长
        bitrate, // 比特率
        language,
        framerate, // 帧率
        bitDepth, // 位深 8bit or 10bit
        width, // 视频宽度
        height, // 视频高度
        aspectRatio, // 宽高比
        pixelFormat, // 像素格式
        codedWidth, // 编码宽度（SAR≠1 时与 width 不同，仅用于排查）
        codedHeight, // 编码高度（同上）
    }) {
        super({ type, format, codec, profile, level, size, duration, bitrate, language })
        this.framerate = framerate // 帧率
        this.bitDepth = bitDepth // 位深 8bit or 10bit
        this.width = width // 视频宽度（SAR≠1 时是**显示宽度**，见 displaySize）
        this.height = height // 视频高度（显示高度）
        this.codedWidth = codedWidth // 编码宽度（仅 SAR≠1 时保留，用于排查）
        this.codedHeight = codedHeight // 编码高度
        this.aspectRatio = aspectRatio
        this.pixelFormat = pixelFormat
    }
}

class Audio extends MediaStreamBase {
    constructor({
        type, // 媒体类型
        format, // 格式名称
        codec, // 编解码器名称
        profile, // 编解码器配置概况
        level, // 编码器等级
        size, // 文件大小
        duration, // 时长
        bitrate, // 比特率
        language,
        sampleRate, // 采样率
    }) {
        super({ type, format, codec, profile, level, size, duration, bitrate, language })
        this.sampleRate = sampleRate
    }
}

class MediaInfo {
    constructor({
        provider, // 解析器
        format, // 文件的格式类型（如：video/mp4）
        size, // 文件大小，单位根据情况设定（如字节）
        duration, // 时长，单位根据情况设定（如秒）
        bitrate, // 平均比特率，单位根据情况设定（如bps）
        createdAt, // 创建时间
        audio, // audio stream 音频流
        video, // video stream 视频流
        subtitles, // subtitles 字幕流
    }) {
        this.provider = provider
        this.format = format
        this.size = size
        this.duration = duration
        this.bitrate = bitrate
        this.createdAt = createdAt
        this.audio = audio
        this.video = video
        this.subtitles = subtitles
    }
}

function fromFFprobe(data) {
    // SAR 校正：width/height 统一给**显示尺寸**（下游只用它们算"是否需要缩放/缩到多少"：
    // lib/ffmpeg_plan.js 的 dstScaleNeeded、lib/ffmpeg_build.js 的 calcLongEdge、
    // lib/ffmpeg_run.js 的 selectTier srcW/srcH —— 三处都该用显示尺寸）。
    const disp = displaySize(data["width"], data["height"], data["sample_aspect_ratio"])
    const obj = {
        type: data["codec_type"], // 媒体类型
        format: data["codec_name"], // 格式名称
        codec: data["codec_tag_string"], // 编解码器名称
        profile: data["profile"], // 编解码器配置概况
        level: data["level"] || 0,
        // 位深分级：pix_fmt 标记 → 已知 8bit 表 → bits_per_raw_sample/bits_per_sample → undefined
        // （实测 bits_per_raw_sample 在 68% 的文件上缺失，不能单独依赖）
        bitDepth: bitDepthOfFormat(
            data["pix_fmt"],
            data["bits_per_raw_sample"] || data["bits_per_sample"],
        ),
        size:
            data["size"] ||
            data["tags"]?.["NUMBER_OF_BYTES"] ||
            data["tags"]?.["NUMBER_OF_BYTES-eng"], // 文件大小
        duration: data["duration"] || data["tags"]?.["DURATION"] || data["tags"]?.["DURATION-eng"], // 时长
        bitrate: data["bit_rate"] || data["tags"]?.["BPS"] || data["tags"]?.["BPS-eng"], // 比特率
        // 帧率：标称（r）优先，异常/抖动时落 avg —— 见 normalizeFrameRate 注释
        framerate: normalizeFrameRate(data["r_frame_rate"], data["avg_frame_rate"]),
        pixelFormat: data["pix_fmt"],
        width: disp ? disp.width : data["width"], // 视频宽度（显示宽度）
        height: disp ? disp.height : data["height"], // 视频高度（显示高度）
        codedWidth: disp ? Number(data["width"]) : undefined, // SAR≠1 时才带
        codedHeight: disp ? Number(data["height"]) : undefined,
        aspectRatio: data["display_aspect_ratio"],
        sampleRate: data["sample_rate"],
        language: data["tags"]?.["language"], // 语言
    }
    return createStreamData(obj)
}

function fromMediaInfo(data) {
    // console.log('fromMediaInfo', data)
    // SAR 校正：mediainfo 的 PixelAspectRatio 是十进制（"1.227"）或比值串，两者都支持
    const disp = displaySize(data["Width"], data["Height"], data["PixelAspectRatio"])
    const obj = {
        type: data["@type"].toLowerCase(), // 媒体类型
        format: data["Format"].toLowerCase(), // 格式名称
        codec: data["CodecID"], // 编解码器名称
        profile: data["Format_Profile"], // 编解码器配置概况
        level: data["Format_Level"] || 0,
        // 位深同样走分级（mediainfo 的 BitDepth 缺失 3.9%，集中在 rmvb；
        // 且它是本路径唯一可靠的位深来源，故显式传入）
        bitDepth: bitDepthOfFormat(undefined, data["BitDepth"]), // 位深 8bit or 10bit
        size: data["StreamSize"], // 文件大小
        duration: data["Duration"], // 时长
        bitrate: data["BitRate"], // 比特率
        // 帧率
        //
        // ⚠️ 此前写成 data["FrameRate"] || data["FrameRate_Num"] + "/" + data["FrameRate_Den"]，
        // 当三者都缺失时会拼出字面量字符串 "null/null"（而非"无此字段"）。
        // 实测 462 个样本中有 20 个会触发（HLS/TS 分片、无时长元数据的 webm、
        // 裸流等容器本就不携带帧率元数据）。
        // 改为：两者都缺失时给 undefined，由 removeFieldsBy 剔除该字段 ——
        // 「没有帧率信息」就应该没有，而不是留一个垃圾字符串。
        framerate:
            data["FrameRate"] ||
            (data["FrameRate_Num"] && data["FrameRate_Den"]
                ? `${data["FrameRate_Num"]}/${data["FrameRate_Den"]}`
                : undefined),
        pixelFormat: data["ColorSpace"]
            ? data["ColorSpace"] + data["ChromaSubsampling"]
            : data["ChromaSubsampling"] || undefined,
        // 显示尺寸（与 ffprobe 侧同语义；mediainfo 的 DisplayAspectRatio 仅作参考，不参与计算）
        width: disp ? disp.width : data["Width"], // 视频宽度（显示宽度）
        height: disp ? disp.height : data["Height"], // 视频高度（显示高度）
        codedWidth: disp ? Number(data["Width"]) : undefined,
        codedHeight: disp ? Number(data["Height"]) : undefined,
        aspectRatio: data["DisplayAspectRatio"],
        sampleRate: data["SamplingRate"],
        language: data["Language"], // 语言
    }
    return createStreamData(obj)
}

function createStreamData(obj) {
    let stream
    switch (obj.type) {
        case "audio":
            stream = new Audio(obj)
            break
        case "video":
            stream = new Video(obj)
            break
        case "text":
        case "subtitle":
            stream = new Subtitle(obj)
            break
    }
    if (stream) {
        removeFieldsBy(stream, (k, v) => v === undefined || v === null)
    }
    return stream
}

// 解析ffprobe json输出，返回MediaInfo
/**
 * 从FFprobe的JSON输出解析媒体信息
 * 将FFprobe的原始数据转换为标准化的MediaInfo对象
 *
 * @param {Object} data - FFprobe输出的JSON数据
 * @returns {MediaInfo} 解析后的媒体信息对象
 */
export function fromFFprobeJson(data) {
    // 从format字段获取基本信息
    const root = data.format

    // 从streams数组中提取不同类型的流信息
    const ad = data.streams?.find((obj) => obj.codec_type === "audio") // 音频流
    // ⚠️ 视频流必须排除 attached_pic（内嵌封面图）：ffprobe 把封面也报成
    //    codec_type=video。真实片库实测 11.4%（279/2444，动画 mp4 带 mjpeg 封面）
    //    会命中；不排除就会把 320x240 封面当主视频去转码。
    //    （mediainfo 侧封面是 @type=Image，天然不会踩；见 docs/ffmpeg/ffmpeg-metadata-fields-20260922.md §7.3）
    //    若所有视频流都是封面（如带封面的 mp3）→ 视为"无视频流"，交给音频流程处理。
    const videoStreams = (data.streams || []).filter((obj) => obj.codec_type === "video")
    const vd = videoStreams.find((obj) => obj.disposition?.attached_pic !== 1)
    const sd = data.streams?.filter((obj) => obj.codec_type === "subtitle") // 字幕流数组

    // ⚠️ DRM/加密流的 codec_name 为 undefined（实测 drm.m4v），ffprobe 认不出编码器。
    //    抛"数据错误"让 getMediaInfo 回退到 mediainfo（它能给出 Format=AVC）——
    //    复用既有的 provider fallback 机制，而不是在这里伪造字段。
    if (vd && !vd.codec_name) {
        throw new Error("ffprobe: video stream has no codec_name (possibly DRM/encrypted)")
    }

    // 构建标准化的媒体信息对象
    const obj = {
        provider: "ffprobe", // 数据来源标识
        format: root["format_long_name"], // 格式名称
        size: root["size"], // 文件大小
        duration: root["duration"], // 持续时间
        bitrate: root["bit_rate"], // 比特率
        createdAt: root["tags"]?.["creation_time"], // 创建时间
        audio: ad && fromFFprobe(ad), // 音频信息（调用fromFFprobe解析）
        video: vd && fromFFprobe(vd), // 视频信息（调用fromFFprobe解析）
        subtitles: sd && sd.map(fromFFprobe), // 字幕信息数组
    }

    // 创建MediaInfo实例，并进行数值类型转换
    const info = new MediaInfo(convertNumber(obj))

    // 清理空值字段，移除undefined和null值
    removeFieldsBy(info, (k, v) => v === undefined || v === null)

    return info
}

/**
 * 从MediaInfo的JSON输出解析媒体信息
 * 将MediaInfo的原始数据转换为标准化的MediaInfo对象
 * 与fromFFprobeJson类似，但处理不同的数据结构和字段名
 *
 * @param {Object} data - MediaInfo输出的JSON数据
 * @returns {MediaInfo} 解析后的媒体信息对象
 */
export function fromMediaInfoJson(data) {
    // console.log('MediaInfo.fromMediaInfoJson', data)
    const root = data.media?.track?.find((o) => o["@type"] === "General")
    // ⚠️ MediaInfo 对无法解析的文件会返回 {"media":null}，此时 root 为 undefined。
    // 此前直接 root["Format"] 会抛 TypeError，而 trySmartAsync 把 TypeError 视为
    // 「编程错误」直接 rethrow —— 导致 mediainfo→ffprobe 的 fallback 永久失效，
    // 整个 getMediaInfo 崩溃而不是降级。这里改为抛出可被捕获的数据错误。
    if (!root) {
        throw new Error("mediainfo: no General track (unparseable file)")
    }
    const ad = data.media?.track?.find((o) => o["@type"] === "Audio")
    const vd = data.media?.track?.find((o) => o["@type"] === "Video")
    const sd = data.media?.track?.filter((o) => o["@type"] === "Text")
    const obj = {
        provider: "mediainfo",
        format: root["Format"]?.toLowerCase(),
        size: root["FileSize"],
        duration: root["Duration"],
        bitrate: root["OverallBitRate"],
        createdAt: root["Encoded_Date"],
        audio: ad && fromMediaInfo(ad),
        video: vd && fromMediaInfo(vd),
        subtitles: sd && sd.map(fromMediaInfo),
    }
    // console.log('MediaInfo.fromMediaInfoJson obj', obj)
    const info = new MediaInfo(convertNumber(obj))
    // console.log('MediaInfo.fromMediaInfoJson info', info)
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

/**
 * 将对象中的字符串值转换为数字
 * 修改原对象，递归处理嵌套对象
 *
 * @param {Object} obj - 要转换的对象
 * @returns {Object} 转换后的对象
 */
function convertNumber(obj) {
    // 兼容空值
    if (!obj) return obj
    // 遍历对象的所有属性
    for (const [key, value] of Object.entries(obj)) {
        // 对于对象类型，递归处理
        if (typeof value === "object") {
            obj[key] = convertNumber(value)
            continue
        }
        // 检查属性的值是否为字符串类型且可以转换为数字
        else if (typeof value === "string") {
            // 匹配字符串数字
            if (/^\d+(\.\d+)?$/.test(value)) {
                // 解析字符串数字
                // 如果可以转换为数字，则将其转换并更新对象的值
                obj[key] = roundNum(parseFloat(value))
            } else if (key.includes("frame_rate") || key.includes("framerate")) {
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
            } else if (key.toUpperCase() === "DURATION") {
                // 匹配 DURATION
                const duration = extractDuration(value)
                if (typeof duration === "number" && duration > 0) {
                    obj[key] = duration
                }
                continue
            }
            continue
        }
    }
    return obj
}
