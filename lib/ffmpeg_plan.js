/**
 * FFmpeg 转换计划的纯计算模块
 *
 * 码率/分辨率/时长/命名等目标参数计算，全部为纯函数或仅读外部库；
 * 不触碰文件系统、不执行进程、不修改 entry 之外的任何状态。
 */
import path from "path"
import mm from "music-metadata"

import * as core from "./core.js"
import * as helper from "./helper.js"
import * as log from "./debug.js"
import { formatArgs } from "./core.js"
import { calculateScale } from "./media-compress.js"

/**
 * 创建目标文件名基本名，不包含路径和扩展名
 * @param {Object} entry - 文件对象
 * @param {string} entry.name - 原始文件名
 * @param {Object} entry.preset - 预设配置
 * @param {string} entry.preset.name - 预设名称
 * @param {string} entry.preset.prefix - 前缀模板
 * @param {string} entry.preset.suffix - 后缀模板
 * @param {Object} entry.dstArgs - 目标参数（模板变量来源，由 calculateDstArgs 产出）
 * @returns {Array} [fileDstBase, prefix, suffix] - 目标文件名基本名、前缀、后缀
 */
function createDstBaseName(entry) {
    const srcBase = path.parse(entry.name).name
    // 模板参数变量，除了Preset的字段，有些需要替换
    //
    // 注意：模板变量（audioBitrateK / videoBitrateK / videoQuality / audioQuality /
    // framerate / dimension / speed 等）由 calculateDstArgs 产出并挂在 entry.dstArgs 上。
    // 此前这里展开的是 entry.dstValues——该字段全仓库从未被赋值，展开恒为空，
    // 于是 formatArgs 找不到替换值会原样保留占位符，
    // 直接落盘成 `s_{audioBitrateK}.m4a` 这类错误文件名。
    const replaceArgs = {
        preset: entry.preset.name,
        ...entry.preset,
        ...entry.dstArgs,
    }
    // 应用模板参数到前缀和后缀字符串模板
    const prefix = helper.filenameSafe(formatArgs(entry.preset.prefix || "", replaceArgs))
    const suffix = helper.filenameSafe(formatArgs(entry.preset.suffix || "", replaceArgs))
    return [`${prefix}${srcBase}${suffix}`, prefix, suffix]
}

/**
 * 将数值转换为K为单位的字符串
 * @param {number} value - 原始数值
 * @returns {string} 转换后的字符串
 */
function kNum(value) {
    return `${Math.round(value / 1000)}K`
}

/**
 * 显示媒体编码和码率信息，调试用
 * @param {Object} entry - 文件对象
 * @param {Object} entry.info - 媒体信息
 * @param {Object} entry.info.audio - 音频信息
 * @param {Object} entry.info.video - 视频信息
 * @param {Object} entry.info.subtitles - 字幕信息
 * @param {Object} entry.dstArgs - 目标参数
 * @param {string} entry.dstArgs.srcAudioCodec - 原始音频编码
 * @param {string} entry.dstArgs.srcVideoCodec - 原始视频编码
 * @param {number} entry.dstArgs.srcAudioBitrate - 原始音频码率
 * @param {number} entry.dstArgs.dstAudioBitrate - 目标音频码率
 * @param {number} entry.dstArgs.srcVideoBitrate - 原始视频码率
 * @param {number} entry.dstArgs.dstVideoBitrate - 目标视频码率
 * @param {number} entry.dstArgs.dstAudioQuality - 目标音频质量
 * @param {number} entry.dstArgs.dstFrameRate - 目标视频帧率
 * @param {number} entry.dstArgs.srcFrameRate - 原始视频帧率
 * @param {number} entry.dstArgs.speed - 速度
 * @param {number} entry.dstArgs.srcWidth - 原始视频宽度
 * @param {number} entry.dstArgs.dstWidth - 目标视频宽度
 * @param {number} entry.dstArgs.srcHeight - 原始视频高度
 * @param {number} entry.dstArgs.dstHeight - 目标视频高度
 * @param {number} entry.size - 文件大小
 * @param {number} entry.dstArgs.srcDuration - 视频时长
 * @returns {string} 格式化的媒体信息字符串
 */
function getEntryShowInfo(entry) {
    const ia = entry.info?.audio
    const iv = entry.info?.video
    const is = entry.info?.subtitles
    const args = { ...entry, ...entry.dstArgs }
    const ac = args.srcAudioCodec
    const vc = args.srcVideoCodec
    const showText = []
    // showText.push(`pt:${entry.preset.name}`)
    showText.push(`sz:${helper.humanSize(args.size)}`)
    showText.push(`ts:${helper.humanSeconds(args.srcDuration)}`)
    if (ia?.duration) {
        showText.push(`a:${ac}`)
        if (args.dstAudioBitrate !== args.srcAudioBitrate) {
            showText.push(`ab:${kNum(args.srcAudioBitrate)}=>${kNum(args.dstAudioBitrate)}`)
        } else {
            showText.push(`ab:${kNum(args.srcAudioBitrate)}`)
        }
        if (args.dstAudioQuality > 0) {
            showText.push(`aq:${args.dstAudioQuality}`)
        }
    }
    if (iv?.duration) {
        showText.push(`v:${vc}(${iv.profile}@${iv.level})`)
        if (args.dstVideoBitrate !== args.srcVideoBitrate) {
            showText.push(`vb:${kNum(args.srcVideoBitrate)}=>${kNum(args.dstVideoBitrate)}`)
        } else {
            showText.push(`vb:${kNum(args.srcVideoBitrate)}`)
        }
        if (args.dstFrameRate > 0 && args.dstFrameRate !== args.srcFrameRate) {
            showText.push(`fps:${args.srcFrameRate}=>${args.dstFrameRate}`)
        } else {
            showText.push(`fps:${args.srcFrameRate}`)
        }
        if (args.speed > 0) {
            showText.push(`sp:${args.speed}`)
        }
        if (args.srcWidth !== args.dstWidth || args.srcHeight !== args.dstHeight) {
            showText.push(`${args.srcWidth}x${args.srcHeight}=>${args.dstWidth}x${args.dstHeight}`)
        } else {
            showText.push(`${args.srcWidth}x${args.srcHeight}`)
        }
    }
    if (is?.length > 0) {
        showText.push(is.map((s) => `${s.format}-${s.language}`).join("|"))
    }
    return showText.join(",")
}

/**
 * 读取单个音频文件的元数据
 * @param {Object} entry - 文件对象
 * @param {string} entry.path - 文件路径
 * @param {string} entry.name - 文件名
 * @param {number} entry.index - 文件索引
 * @returns {Promise<Object|null>} 包含格式和标签信息的对象或null
 */
async function readMusicMeta(entry) {
    try {
        const mt = await mm.parseFile(entry.path, { skipCovers: true })
        if (mt?.format && mt.common) {
            log.info(
                "Metadata",
                `Read(${entry.index}) ${entry.name} [${mt.format.codec}|${mt.format.duration}|${mt.format.bitrate}|${mt.format.lossless}, ${mt.common.artist},${mt.common.title},${mt.common.album}]`,
            )
            return {
                format: mt.format,
                tags: mt.common,
            }
        } else {
            log.info("Metadata", entry.index, "no tags found", helper.pathShort(entry.path))
        }
    } catch (error) {
        log.info(
            "Metadata",
            entry.index,
            "no tags found",
            helper.pathShort(entry.path),
            error.message,
        )
    }
}

/**
 * 从字幕文件路径列表中优先选择中文字幕
 * 中文识别规则：路径包含 chinese、chinese simp、chs、zh、zhcn、chi、简体 等关键词
 * 如果没有中文字幕则返回第一个字幕文件
 * @param {string[]} subtitles - 字幕文件路径数组
 * @returns {string|null} 优先选择的中文字幕路径，如果没有则返回第一个或null
 */
function selectPreferredSubtitle(subtitles) {
    if (!subtitles || subtitles.length === 0) {
        return null
    }
    if (subtitles.length === 1) {
        return subtitles[0]
    }
    // 中文字幕关键词（已去重；"chinese simp" 由 "chinese" 前缀覆盖）
    // 改用「词元精确匹配」替代 substring includes：zh/chs/gb/chi 等短关键词
    // 做子串匹配会误命中（如 "chzh"、"zhuan"、"gba"、"chipta"），
    // 按非字母数字（含中文字符）切词后，"zh-CN" 会切成 ["zh","CN"] 仍可命中。
    const chineseKeywords = ["chinese", "chs", "zh", "zhcn", "chi", "gb", "简体", "简中"]
    for (const sub of subtitles) {
        const lowerSub = sub.toLowerCase()
        // 保留中文词元（繁体简体中文属于同一词元，如 简体/繁体），
        // 中文关键词用词元内 includes 匹配，拉丁关键词用词元精确匹配。
        const tokens = lowerSub.split(/[^a-z0-9\u4e00-\u9fff]+/u)
        const hit = tokens.some(
            (token) =>
                chineseKeywords.includes(token) ||
                chineseKeywords.some((kw) => /[\u4e00-\u9fff]/.test(kw) && token.includes(kw)),
        )
        if (hit) {
            return sub
        }
    }
    // 没有找到中文字幕，返回第一个
    return subtitles[0]
}

// 音频码率映射表
// 只有存储设备如内存和硬盘用1K=1024，其它时候都是1K=1000
const bitrateMap = [
    { threshold: 320 * 1000, value: 320 * 1000 },
    { threshold: 256 * 1000, value: 256 * 1000 },
    { threshold: 192 * 1000, value: 192 * 1000 },
    { threshold: 128 * 1000, value: 128 * 1000 },
    { threshold: 96 * 1000, value: 96 * 1000 },
    { threshold: 64 * 1000, value: 64 * 1000 },
    { threshold: 0, value: 48 * 1000 }, // 默认值
]

/**
 * 获取非零最小值
 * @param {number[]} numbers - 数字数组
 * @returns {number} 非零最小值
 */
function minNoZero(...numbers) {
    const fNumbers = numbers.filter((n) => n > 0)
    // 无正数时返回 0，避免 Math.min(...[]) 产生 Infinity，
    // 否则会经 dstAudioBitrate/dstVideoBitrate 扩散成 "InfinityK" 文件名与 NaN 比例
    return fNumbers.length > 0 ? Math.min(...fNumbers) : 0
}

/**
 * 计算视频和音频码率等各种目标文件数据
 * @param {Object} entry - 文件对象
 * @param {string} entry.path - 文件路径
 * @param {string} entry.name - 文件名
 * @param {Object} entry.preset - 预设配置
 * @param {Object} entry.preset.userArgs - 用户参数
 * @param {number} entry.preset.userArgs.audioBitrate - 用户指定的音频码率
 * @param {number} entry.preset.userArgs.videoBitrate - 用户指定的视频码率
 * @param {number} entry.preset.userArgs.audioQuality - 用户指定的音频质量
 * @param {number} entry.preset.userArgs.videoQuality - 用户指定的视频质量
 * @param {number} entry.preset.userArgs.speed - 用户指定的速度
 * @param {number} entry.preset.userArgs.dimension - 用户指定的分辨率
 * @param {number} entry.preset.audioBitrate - 预设的音频码率
 * @param {number} entry.preset.videoBitrate - 预设的视频码率
 * @param {number} entry.preset.audioQuality - 预设的音频质量
 * @param {number} entry.preset.videoQuality - 预设的视频质量
 * @param {number} entry.preset.speed - 预设的速度
 * @param {number} entry.preset.dimension - 预设的分辨率
 * @param {boolean} entry.preset.smartBitrate - 是否启用智能码率
 * @param {Object} entry.info - 媒体信息
 * @param {Object} entry.info.video - 视频信息
 * @param {Object} entry.info.audio - 音频信息
 * @param {Object} entry.format - 格式信息
 * @returns {Object} 目标参数对象
 */
function calculateDstArgs(entry) {
    const ep = entry.preset
    const info = entry.info
    const ivideo = entry.info?.video
    const iaudio = entry.info?.audio

    // eg. '-map a:0 -c:a libfdk_aac -b:a {bitrate}'
    let srcAudioBitrate = 0
    let dstAudioBitrate
    let srcVideoBitrate = 0
    let dstVideoBitrate = 0

    let srcFrameRate
    let dstFrameRate
    let dstWidth = 0
    let dstHeight = 0

    // 源文件时长
    const srcDuration = info?.duration || ivideo?.duration || iaudio?.duration || 0

    const srcWidth = ivideo?.width || 0
    const srcHeight = ivideo?.height || 0

    const reqAudioBitrate = ep.userArgs.audioBitrate || ep.audioBitrate
    const reqVideoBitrate = ep.userArgs.videoBitrate || ep.videoBitrate

    const dstAudioQuality = ep.userArgs.audioQuality || ep.audioQuality
    const dstVideoQuality = ep.userArgs.videoQuality || ep.videoQuality

    const dstSpeed = ep.userArgs.speed || ep.speed
    const dstDimension = ep.userArgs.dimension || ep.dimension

    // 只有目标长边小于原视频长边时才需要缩放，才需要加sclae filter
    // 避免加不必要的ffmpeg参数拖累性能
    const dstScaleNeeded = srcWidth > dstDimension || srcHeight > dstDimension

    if (helper.isAudioFile(entry.path)) {
        // 音频文件
        // 文件信息中的码率值
        const fileBitrate = entry.format?.bitrate || info?.bitrate || iaudio?.bitrate || 0
        if (fileBitrate > 0) {
            srcAudioBitrate = fileBitrate
        } else {
            // 对于无法读取码率的音频文件
            if (entry.format?.lossless || helper.isAudioLossless(entry.path)) {
                // 无损音频，设置默认值
                srcAudioBitrate = srcAudioBitrate > 320 * 1000 ? srcAudioBitrate : 999 * 1000
            } else {
                // 非无损音频，也无法读取码率的话，应该是文件损坏

                srcAudioBitrate = 0
            }
        }
        if (srcAudioBitrate > 0) {
            // 如果启用了智能码率
            if (ep.smartBitrate) {
                dstAudioBitrate =
                    bitrateMap.find((br) => srcAudioBitrate > br.threshold)?.value || 48 * 1000
            } else {
                // 智能码率关闭，直接使用用户值或预设值
                dstAudioBitrate = reqAudioBitrate
            }
        } else {
            // 有的文件无法获取音频码率，如opus，此时srcAudioBitrate=0
            // opus用于极低码率音频，此时 dstAudioBitrate=48 可以接受
            dstAudioBitrate = 48 * 1000
        }
        // 转换后的码率不能高于源文件码率
        dstAudioBitrate = minNoZero(dstAudioBitrate, srcAudioBitrate)
    } else {
        // 视频文件
        const dstWH = calculateScale(srcWidth, srcHeight, dstDimension)
        dstWidth = dstWH.dstWidth
        dstHeight = dstWH.dstHeight
        const bigSideDst = Math.max(dstWidth, dstHeight)
        const bigSideSrc = Math.max(srcWidth, srcHeight)
        const dstPixels = dstWidth * dstHeight
        // 这个是文件整体码率，如果是是视频文件，等于是视频和音频的码率相加
        const fileBitrate = info?.bitrate || 0
        srcAudioBitrate = iaudio?.bitrate || 0
        // 计算出的视频码率不高于源文件的视频码率
        // 减去音频的码率，估算为48k
        srcVideoBitrate = ivideo?.bitrate || fileBitrate - 48 * 1000 || 0

        // 音频和视频码率 用户指定>预设
        // 音频和视频码率都不能高于原码率
        dstAudioBitrate = minNoZero(srcAudioBitrate, reqAudioBitrate)
        // 如果源文件不是1080p，这里码率需要考虑分辨率
        let pixelsScale
        if (dstDimension > bigSideDst) {
            // 如果使用4KPreset压缩1080P视频，需要缩放码率
            // 4K60 ~= 1080P60 * (1.5,2)
            pixelsScale = (bigSideDst / dstDimension) * 1.1
        } else if (dstDimension < bigSideDst) {
            // 其它情况按长边比例就差不多
            pixelsScale = bigSideDst / bigSideSrc
        } else {
            pixelsScale = 1
        }
        dstVideoBitrate = reqVideoBitrate * pixelsScale

        log.info(
            "calculateDstArgs",
            entry.name,
            "fileBitrate",
            fileBitrate,
            "srcVideoBitrate",
            srcVideoBitrate,
            "reqVideoBitrate",
            reqVideoBitrate,
            "dstVideoBitrate",
            dstVideoBitrate,
            "pixelsScale",
            pixelsScale,
            "bigSide",
            bigSideDst,
            "dstDimension",
            dstDimension,
            "scaled",
            dstScaleNeeded,
        )
        const PIXELS_1080P = 1920 * 1080
        // 小于1080p分辨率，码率也需要缩放
        if (bigSideDst < 1920) {
            let scaleFactor = dstPixels / PIXELS_1080P
            // 如果目标码率是4K，暂时不考虑
            // 如果目标码率不是1080p，根据分辨率智能缩放
            // 示例 辨率1920*1080的目标码率是 1600k
            // 1280*720码率 960k
            // 缩放码率，平滑系数
            scaleFactor = core.smoothChange(scaleFactor, 1, 0.3)
            dstVideoBitrate = Math.round(dstVideoBitrate * scaleFactor)
        }
        // 目标分辨率，不能大于源文件分辨率
        dstVideoBitrate = minNoZero(dstVideoBitrate, srcVideoBitrate)
        // 取整
        // dstVideoBitrate = Math.floor(dstVideoBitrate / 1000) * 1000
    }

    // 如果目标帧率大于原帧率，就将目标帧率设置为0，即让ffmpeg自动处理，不添加帧率参数
    // 源文件帧率
    srcFrameRate = ivideo?.framerate || 0
    // 预设或用户帧率，用户指定>预设
    const reqFrameRate = ep.userArgs.framerate || ep.framerate
    // 计算出的目标帧率
    dstFrameRate = reqFrameRate < srcFrameRate ? reqFrameRate : 0

    // 用于模板字符串的模板参数，针对当前文件
    // 额外模板参数
    // videoBitrateK audioBitrateK用于ffmpeg参数
    return {
        // 源文件参数
        srcAudioBitrate,
        srcVideoBitrate,
        srcFrameRate,
        srcDuration,
        srcWidth: srcWidth,
        srcHeight: srcHeight,
        srcSize: info?.size || 0,
        srcVideoCodec: ivideo?.format,
        srcAudioCodec: iaudio?.format,
        srcFormat: info?.format,
        // 计算出来的参数
        dstAudioBitrate,
        dstVideoBitrate,
        dstAudioQuality,
        dstVideoQuality,
        dstFrameRate,
        dstWidth,
        dstHeight,
        dstSpeed,
        // 码率智能缩放（源码率缺失时为 0，避免 Infinity/NaN 进模板变量）
        audioBitScale: srcAudioBitrate > 0 ? core.roundNum(dstAudioBitrate / srcAudioBitrate) : 0,
        videoBitScale: srcVideoBitrate > 0 ? core.roundNum(dstVideoBitrate / srcVideoBitrate) : 0,
        // 会覆盖preset的同名预设值
        // videoBitrate: dstVideoBitrate,
        videoBitrateK: `${Math.round(dstVideoBitrate / 1000)}K`,
        videoQuality: dstVideoQuality,
        // audioBitrate: dstAudioBitrate,
        audioBitrateK: `${Math.round(dstAudioBitrate / 1000)}K`,
        audioQuality: dstAudioQuality,
        framerate: dstFrameRate,
        dimension: dstDimension,
        speed: dstSpeed,
        // needs scale
        scaled: dstScaleNeeded,
    }
}
export {
    calculateDstArgs,
    createDstBaseName,
    getEntryShowInfo,
    readMusicMeta,
    selectPreferredSubtitle,
}
