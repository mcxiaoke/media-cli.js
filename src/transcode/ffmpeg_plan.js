/**
 * FFmpeg 转换计划的纯计算模块
 *
 * 码率/分辨率/时长/命名等目标参数计算，全部为纯函数或仅读外部库；
 * 不触碰文件系统、不执行进程、不修改 entry 之外的任何状态。
 */
import path from "path"
import mm from "music-metadata"

import * as core from "../../lib/core.js"
import * as helper from "../../lib/helper.js"
import * as log from "../../lib/debug.js"
import { formatArgs } from "../../lib/core.js"
import { calcLongEdge, toEven } from "./hwaccel.js"

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
    // 视频峰值码率（随分辨率缩放后作为 -maxrate；缺省 0 → buildEncoderArgs 取 ×1.5）
    let dstMaxBitrate = 0

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
    let dstVideoQuality = ep.userArgs.videoQuality || ep.videoQuality

    // 动漫模式质量自适应调整策略（基于 Same-VMAF 原则）：
    // 若用户未显式传 --video-quality / -vq，且开启了动漫模式（ep.userArgs.anime === true）：
    // 动漫画面结构规则、平涂大色块，容易在基准预设下产生质量过剩。
    // 小幅增大量化参数 q（放宽量化），以释放动漫素材天然的高压缩比红利，同时保持在 VMAF ~95 优质区间：
    // - AV1 (SVT-AV1 / NVENC AV1 / QSV AV1): 基准 33 -> 增大 4 档变为 37
    // - HEVC (x265 / NVENC HEVC / QSV HEVC): 基准 23 -> 增大 2 档变为 25
    // - H264 (x264 / NVENC H264): 基准 23 -> 增大 2 档变为 25
    // 注：配合注入的动漫专用感知调优（tune=animation, aq-mode=3, spatial/temporal aq=1）保障线条与平坦区。
    const isAnime = ep.userArgs?.anime === true
    if (isAnime && !ep.userArgs.videoQuality && dstVideoQuality > 0) {
        const fam = ep.videoCodecFamily || "h264"
        const offset = fam === "av1" ? 4 : 2
        dstVideoQuality = Math.min(51, dstVideoQuality + offset)
    }

    const dstSpeed = ep.userArgs.speed || ep.speed
    const dstDimension = ep.userArgs.dimension || ep.dimension

    // 只有目标长边小于原视频长边时才需要缩放，才需要加scale filter
    // 避免加不必要的ffmpeg参数拖累性能（dstDimension <= 0 表示不限制尺寸/原画直出）
    const dstScaleNeeded = dstDimension > 0 && (srcWidth > dstDimension || srcHeight > dstDimension)

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
        if (srcWidth > 0 && srcHeight > 0) {
            if (dstDimension > 0) {
                const s = calcLongEdge(srcWidth, srcHeight, dstDimension)
                dstWidth = s.w
                dstHeight = s.h
            } else {
                dstWidth = toEven(srcWidth)
                dstHeight = toEven(srcHeight)
            }
        }
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
        // ── 分辨率码率缩放：像素面积幂律（主流 Bitrate Ladder 做法）──
        //   scale = (实际输出像素 / 预设名义像素) ^ α
        //   - 锚点 anchorPixels = 源按目标长边 dstDimension 等比缩放的理论尺寸
        //     （不受 calculateScale 的"禁止放大"限制）＝ 该预设自己档位的满分 1.0；
        //     实际输出低于预设档位时（如 4K 预设压 1080p），码率按像素比下降。
        //   - α = 0.75（感知非线性）：4K 本就比 1080p 清晰很多，分辨率放大时码率不必同比放大，
        //     反之分辨率压低时码率也别削太狠。dstVideoBitrate / dstMaxBitrate 共用同一缩放，
        //     峰值上限与平均码率同比例变化。
        const POW_SCALE = 0.75
        const anchorRatio = bigSideSrc > 0 && dstDimension > 0 ? dstDimension / bigSideSrc : 1
        const anchorPixels =
            Math.round(srcWidth * anchorRatio) * Math.round(srcHeight * anchorRatio) || dstPixels
        const scaleBitrateByResolution = (bitrate) => {
            if (dstPixels <= 0 || anchorPixels <= 0) return 0
            const scale = (dstPixels / anchorPixels) ** POW_SCALE
            return Math.round(bitrate * scale)
        }
        // 仅在指定了视频目标码率时才计算（reqVideoBitrate > 0）；
        // 未指定时保持为 0（恒定质量 CQ/CRF 模式，避免将源文件码率误套为目标码率）
        dstVideoBitrate =
            reqVideoBitrate > 0
                ? minNoZero(scaleBitrateByResolution(reqVideoBitrate), srcVideoBitrate)
                : 0

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
            "dstPixels",
            dstPixels,
            "anchorPixels",
            anchorPixels,
            "powScale",
            POW_SCALE,
            "dstDimension",
            dstDimension,
            "scaled",
            dstScaleNeeded,
        )
        // 峰值码率：用户指定 > 预设；随分辨率同样缩放。显式声明才计算，
        // 缺省留 0，由 buildEncoderArgs 用 videoBitrate×1.5 兜底（保持既有行为）。
        const reqMaxBitrate = ep.userArgs?.maxBitrate || ep.maxBitrate || 0
        dstMaxBitrate = reqMaxBitrate > 0 ? scaleBitrateByResolution(reqMaxBitrate) : 0
        // 取整
        // dstVideoBitrate = Math.floor(dstVideoBitrate / 1000) * 1000
    }

    // 如果目标帧率大于原帧率，就将目标帧率设置为0，即让ffmpeg自动处理，不添加帧率参数
    // 源文件帧率
    srcFrameRate = ivideo?.framerate || 0
    // 预设或用户帧率，用户指定>预设
    const reqFrameRate = ep.userArgs.framerate || ep.framerate
    // 计算出的目标帧率
    //
    // ⚠️ 比较必须带容差（2%）：实测真实片库 37% 的文件属 23.976 家族，而实测帧率
    //    （avg_frame_rate）会因 VFR 抖到 23.974~23.980。若源 23.976、请求 23.976，
    //    抖动会让 `req < src` 成立 → 加一个**无意义的 fps 滤镜**（重采样、损质量、白耗时）。
    //    容差 2% 能覆盖 23.976↔24（0.1%）这类同族抖动，同时保住 23.976↔25（4.1%）的
    //    真实降帧需求。依据：docs/ffmpeg/ffmpeg-metadata-fields-20260922.md §7.3。
    dstFrameRate = reqFrameRate < srcFrameRate * 0.98 ? reqFrameRate : 0

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
        dstMaxBitrate,
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
        videoBitrate: dstVideoBitrate,
        videoBitrateK: `${Math.round(dstVideoBitrate / 1000)}K`,
        videoQuality: dstVideoQuality,
        audioBitrate: dstAudioBitrate,
        audioBitrateK: `${Math.round(dstAudioBitrate / 1000)}K`,
        audioQuality: dstAudioQuality,
        framerate: dstFrameRate,
        dimension: dstDimension,
        speed: dstSpeed,
        anime: isAnime,
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
