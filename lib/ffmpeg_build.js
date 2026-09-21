/**
 * FFmpeg 命令行参数构建模块
 *
 * 包含 ffmpeg 命令行参数的纯构建函数（输入/滤镜/视频/音频/元数据/输出）。
 * 所有函数保持纯函数特性：不修改 entry，不读写外部状态，参数数组只进不出。
 */
import dayjs from "dayjs"

import * as core from "./core.js"
import { formatArgs } from "./core.js"
import * as enc from "./encoding.js"
import * as helper from "./helper.js"
import * as log from "./debug.js"
import presets from "./ffmpeg_presets.js"
import { getEntryShowInfo } from "./ffmpeg_plan.js"
import {
    buildEncoderArgs,
    buildVideoFilters,
    calcLongEdge,
    codecFamilyOfPreset,
    validateSpeed,
} from "./hwaccel.js"

/**
 * 将三段 ffmpeg 参数数组展开为一行命令字符串
 *
 * createFFmpegArgs 产出 [inputArgs, middleArgs, outputArgs] 三段数组，
 * 日志与 comment 写回处需要扁平成一行命令，统一走本函数避免各处重复 flat/join。
 * @param {Array<string[]>} ffmpegArgs - [inputArgs, middleArgs, outputArgs]
 * @returns {string|undefined} 拼接后的命令字符串；参数缺失时返回 undefined
 */
export function flattenFFArgs(ffmpegArgs) {
    return ffmpegArgs?.flat()?.join(" ")
}

/**
 * 从 hwPlan 取层名（无 plan 时按 cpu 处理）
 */
function tierName(hwPlan) {
    return hwPlan?.tier?.name || "cpu"
}

/**
 * 依据 hwPlan 生成缩放滤镜串（S-4 方案）
 *
 * 关键设计：尺寸由 calcLongEdge 在脚本层预计算为**显式偶数**，
 * 不依赖滤镜自身的保比例能力。原因（实测）：
 *   - h=-2 在 scale_cuda/scale_qsv 上存在格式协商冲突
 *   - force_original_aspect_ratio 在 scale_qsv / vpp_amf 上不存在
 *   - 各滤镜参数名不统一（scale_d3d11 用 width/height）
 *
 * @returns {string} 如 "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda"
 */
function buildScaleFiltersFromPlan(entry, hwPlan, tempPreset) {
    const tier = hwPlan?.tier
    const size = hwPlan?.size
    // ⚠️ 无 tier 时（如日志预览阶段）不能回退到 preset.filters ——
    // 那是 "{scaleFilter}" 占位符，会以字面量泄漏到日志/命令里。
    // 改为用该 preset 的目标尺寸现算一份示意滤镜。
    if (!tier) {
        return tempPreset.filters && !/\{scaleFilter\}/.test(tempPreset.filters)
            ? tempPreset.filters
            : ""
    }
    const speed = validateSpeed(tempPreset.speed)
    const framerate = tempPreset.framerate > 0 ? tempPreset.framerate : 0

    // size 缺失时（预览阶段）用 preset.dimension 现算
    const effectiveSize =
        size ||
        calcLongEdge(
            entry.info?.video?.width || 0,
            entry.info?.video?.height || 0,
            tempPreset.dimension || entry.preset?.dimension || 0,
        )
    if (!effectiveSize || !effectiveSize.w || !effectiveSize.h) {
        return ""
    }

    // 用 lib/hwaccel.js 的构建器生成，保证与探测命令同构
    return buildVideoFilters({ tier, size: effectiveSize, speed, framerate })
}

/**
 * 依据 hwPlan 生成视频编码参数块
 *
 * ⚠️ 必须整段替换而非只换编码器名：
 *   nvenc 的 -rc vbr -tune hq -spatial-aq 等参数 QSV/AMF 不接受
 * ⚠️ 质量参数不通用（实测）：
 *   qsv 用 -global_quality（ICQ 智能恒定质量）；-cq 会被静默忽略（NVENC 专属）；
 *   -q:v 是 CQP 遗留写法，10bit 源低值会 rate control 失效
 *
 * @returns {string[]|null} 参数数组；无 plan 时返回 null（保持预设原值）
 */
function buildVideoArgsFromPlan(entry, hwPlan, tempPreset) {
    const tier = hwPlan?.tier
    if (!tier) return null
    // ⚠️ 职责划分（S-4 重构）：
    //   tier   → 出「编码器 + 编码器专属调优」（decoder/encoder 成对，同厂商）
    //   preset → 出「输出 codec 族 + 质量/码率」，不关心硬件实现
    //
    // 所以这里是两段拼接：tier 的编码器参数 + preset 的质量参数。
    // 不能再「整段替换」，否则 preset.videoArgs 里的质量参数会被丢弃。
    const codecFamily = codecFamilyOfPreset(tempPreset)
    const quality = tempPreset.videoQuality || entry.preset?.videoQuality || 24
    const bitrateK = tempPreset.videoBitrateK || undefined
    // pixFmt 传给 buildEncoderArgs：历史用于 10bit + qsv 质量钳制，
    // 换用 ICQ（-global_quality）后该异常已不存在，保留传参仅为兼容
    const pixFmt = entry.info?.video?.pixelFormat || ""
    const encArgs = buildEncoderArgs(tier.name, { quality, bitrateK, codecFamily, pixFmt })

    // preset.videoArgs 保留为「额外的硬件无关参数」槽位，默认空。
    // 但若用户通过 --video-args 或旧式 preset 显式给了 -c:v，
    // 则完全以用户值为准（返回 null 让调用方走原路径）。
    const presetVa = tempPreset.videoArgs || ""
    if (/-c:v/.test(presetVa)) {
        return null
    }
    const extra = presetVa ? formatArgs(presetVa, tempPreset).split(" ").filter(Boolean) : []
    return [...encArgs, ...extra]
}

/**
 * 纯函数：组合各种参数，替换模板参数，输出最终的ffmpeg命令行参数
 * 不修改任何外部状态（不再写 entry.debugArgs/debugPreset，调试信息随返回值携带）
 * @param {Object} entry - 文件对象
 * @param {Object} hwPlan - resolveHwPlan 的结果（含 tier / size）
 * @returns {{ args: Array, debugPreset: Object }} - args 为
 *   [inputArgs, middleArgs, outputArgs]（输入、中间、输出参数），
 *   debugPreset 为格式化后的预设对象（仅用于展示）
 */
function createFFmpegArgs(entry, hwPlan = null) {
    // 不要使用 entry.perset，下面复制一份针对每个entry
    const tempPreset = { ...entry.preset, ...entry.dstArgs }

    // 是否需要添加fps filter（原地修改 tempPreset.filters）
    prepareFramerateFilter(tempPreset)

    // 输入参数部分，在 -i input 前面
    const inputArgs = buildInputArgs(entry, tempPreset, hwPlan)

    // 中间参数部分，在 -i input 后面，顺序建议 filters codec stream metadata
    const middleArgs = [
        ...buildFilterArgs(entry, tempPreset, hwPlan),
        ...buildVideoArgs(entry, hwPlan, tempPreset),
        ...buildAudioArgs(entry, tempPreset),
        ...buildMetaArgs(entry, tempPreset),
        ...buildStreamArgs(tempPreset),
    ]

    // 输出参数部分，只有一个输出文件路径（临时文件，转换成功后改名）
    const outputArgs = [entry.fileDstTemp]

    // 调试信息仅随返回值携带，不再写入 entry，调用方按需取用
    return {
        args: [inputArgs, middleArgs, outputArgs],
        debugPreset: core.formatObjectArgs(tempPreset, tempPreset),
    }
}

/**
 * 是否需要添加 fps filter：--fps > 0 时把 fps={framerate} 追加到 filters 链
 * @param {Object} tempPreset - 预设副本（原地修改 filters）
 */
function prepareFramerateFilter(tempPreset) {
    if (tempPreset.framerate > 0) {
        if (tempPreset.filters?.length > 0) {
            tempPreset.filters += ",fps={framerate}"
        } else {
            tempPreset.filters = "fps={framerate}"
        }
    }
}

/**
 * 构建输入参数（在 -i input 前面，含 hwaccel 分层、输入参数与字幕选轨）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @param {Object} hwPlan - 硬件加速分层计划
 * @returns {string[]} 输入参数数组
 */
function buildInputArgs(entry, tempPreset, hwPlan) {
    const inputArgs = []
    inputArgs.push("-hide_banner", "-n")
    // 是否启用调试参数
    inputArgs.push("-v", entry.argv.debug ? "repeat+level+info" : "error")
    // 输出视频时才需要硬件加速，音频用cpu就行
    if (tempPreset.type === "video") {
        // -progress - 会输出 out_time=，是进度条的数据源；
        // 音频分支此前推的是 -stats（只输出 time= 且走 stderr），
        // 解析侧只认 ^out_time=，导致所有音频转码的进度条恒为 0%。
        inputArgs.push("-progress", "-", "-nostats")
        // 输入侧硬件加速参数由 hwPlan.tier 决定（S-4 方案分层）
        const tier = hwPlan?.tier
        if (tier?.hwaccel) {
            inputArgs.push("-hwaccel", tier.hwaccel)
            if (tier.hwFormat) {
                inputArgs.push("-hwaccel_output_format", tier.hwFormat)
            }
        } else {
            // cpu 层：不加 -hwaccel，避免 ffmpeg 9 的 auto 在无硬解素材上挂死
            // （实测 -hwaccel auto 对 ffv1 会 VK_ERROR_DEVICE_LOST 超时）
        }
    } else {
        inputArgs.push("-progress", "-", "-nostats")
    }
    // 输入参数在输入文件前面，顺序重要
    if (tempPreset.inputArgs?.length > 0) {
        inputArgs.push(...tempPreset.inputArgs.split(" "))
    }
    inputArgs.push("-i")
    inputArgs.push(entry.path)
    // 添加MP4内嵌字幕文件，只添加一个优先选择的字幕文件
    // 优先取中文字幕，不行就取第一个
    appendSubtitleArgs(entry, inputArgs)
    return inputArgs
}

/**
 * 附加字幕参数：优先使用外部选中的字幕，否则处理内嵌字幕（MP4 仅支持 tx3g）
 * @param {Object} entry - 文件对象
 * @param {string[]} inputArgs - 正在构建的输入参数数组（原地追加）
 */
function appendSubtitleArgs(entry, inputArgs) {
    if (entry.selectedSubtitle) {
        inputArgs.push("-i")
        inputArgs.push(entry.selectedSubtitle)
        inputArgs.push(
            ..."-c:s mov_text -metadata:s:s:0 language=chi -disposition:s:0 default".split(" "),
        )
        // 使用提供的字幕，忽略MKV内置字幕文件
        inputArgs.push(..."-map 0:v -map 0:a -map 1".split(" "))
    } else {
        // MP4格式仅支持tx3g格式字幕
        const subs = entry.info?.subtitles
        if (subs?.length > 0) {
            const isAllTextSubs = subs?.every((e) => e.codec === "tx3g")
            if (isAllTextSubs) {
                inputArgs.push(..."-c:s mov_text".split(" "))
            } else {
                // 不支持的字幕直接忽略
                inputArgs.push("-sn")
            }
        }
    }
}

/**
 * 构建滤镜参数（-filter_complex 或 -vf）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @param {Object} hwPlan - 硬件加速分层计划
 * @returns {string[]} 滤镜参数数组
 */
function buildFilterArgs(entry, tempPreset, hwPlan) {
    const middleArgs = []
    // 滤镜参数
    // complexFilter 和 filters 不能同时存在
    if (tempPreset.complexFilter?.length > 0) {
        middleArgs.push("-filter_complex")
        middleArgs.push(formatArgs(tempPreset.complexFilter, tempPreset))
    } else if (tempPreset.filters?.length > 0 || hwPlan?.size) {
        // 只有「需要缩放」或「需要改帧率」时才输出 -vf。
        //
        // 此前条件只有 entry.dstArgs.scaled：对分辨率已达标（无需缩放）的文件，
        // --fps 追加的 fps 滤镜会被整段丢弃，命令里根本没有 -vf，
        // 而日志仍显示 "fps:25=>10" —— 用户以为生效，实际产物帧率未变。
        if (entry.dstArgs.scaled || tempPreset.framerate > 0) {
            let tempFilters = buildScaleFiltersFromPlan(entry, hwPlan, tempPreset)
            // 使用软解时，需要把系统内存中的帧上传给GPU
            // 但仅当滤镜链确实含 CUDA 滤镜（scale_cuda 等）时才有意义：
            // 无条件前置 hwupload_cuda 会给纯 CPU 滤镜链（scale=...）插入无效节点而直接失败
            if (tierName(hwPlan) === "cpu" && /_cuda\b/.test(tempFilters)) {
                tempFilters = "hwupload_cuda," + tempFilters
            }
            middleArgs.push("-vf")
            middleArgs.push(formatArgs(tempFilters, tempPreset))
        }
    }
    return middleArgs
}

/**
 * 构建视频编码参数（S-4 硬件分层块优先，否则用 preset 的 videoArgs）
 * @param {Object} entry - 文件对象
 * @param {Object} hwPlan - 硬件加速分层计划
 * @param {Object} tempPreset - 预设副本
 * @returns {string[]} 视频参数数组
 */
function buildVideoArgs(entry, hwPlan, tempPreset) {
    const middleArgs = []
    // 视频参数
    // S-4：优先用 hwPlan 生成的编码器参数块（整段替换，含正确的质量参数写法）
    const planVideoArgs = buildVideoArgsFromPlan(entry, hwPlan, tempPreset)
    if (planVideoArgs) {
        middleArgs.push(...planVideoArgs)
    } else if (tempPreset.videoArgs?.length > 0) {
        const va = formatArgs(tempPreset.videoArgs, tempPreset)
        middleArgs.push(...va.split(" "))
    }
    return middleArgs
}

/**
 * 构建音频编码参数（extract_audio 智能选择；码率与容器兼容性决定是否 copy）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本（可能被原地修改 audioArgs）
 * @returns {string[]} 音频参数数组
 */
function buildAudioArgs(entry, tempPreset) {
    const middleArgs = []
    // 音频参数
    if (tempPreset.audioArgs?.length > 0) {
        // extract_audio模式下智能选择编码器
        // 直接复制音频流或者重新编码
        // audioArgsCopy: '-c:a copy',
        // audioArgsEncode: '-c:a libfdk_aac -b:a {audioBitrate}k',
        if (presets.isAudioExtract(tempPreset)) {
            if (entry.srcAudioCodec === "aac") {
                tempPreset.audioArgs = "-c:a copy"
            }
        } else {
            // 针对视频文件
            if (helper.isVideoFile(entry.path)) {
                // 如果目标码率大于源文件码率，则不重新编码，考虑误差
                const bitrateOk =
                    tempPreset.srcAudioBitrate > 0 &&
                    tempPreset.dstAudioBitrate + 2000 > tempPreset.srcAudioBitrate
                // 容器兼容性检查：源音频编码能否直接 copy 进目标容器
                // 例：cook(RealAudio) 无法封装进 MP4，即使码率满足也必须重编码
                const dstExt = tempPreset.format || helper.pathExt(entry.path)
                const containerOk = helper.isAudioCodecCompatibleWithContainer(
                    entry.srcAudioCodec,
                    dstExt,
                    entry.info?.audio?.codec,
                )
                const shouldCopy = bitrateOk && containerOk
                if (!containerOk && bitrateOk) {
                    log.debug(
                        `Audio copy skipped: codec "${entry.srcAudioCodec}" not supported in container "${dstExt}", forcing re-encode`,
                    )
                }
                // 如果用户指定不重新编码
                if (shouldCopy || tempPreset.userArgs.audioCopy) {
                    tempPreset.audioArgs = "-c:a copy"
                }
            }
        }
        const aa = formatArgs(tempPreset.audioArgs, tempPreset)
        middleArgs.push(...aa.split(" "))
    }
    return middleArgs
}

/**
 * 构建元数据参数（description/copyright/音频标签/标题）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @returns {string[]} 元数据参数数组
 */
function buildMetaArgs(entry, tempPreset) {
    const metaArgs = []
    // 添加自定义metadata字段
    // description, comment, copyright
    const descArgs = []
    descArgs.push(getEntryShowInfo(entry))
    const dateText = dayjs().format("YYYY-MM-DD HH:mm:ss.SSS Z")
    const descArgsText = descArgs.join("|")
    metaArgs.push(`-metadata`, `description=${descArgsText}`)
    metaArgs.push(
        `-metadata`,
        `copyright=mediac ffmpeg --preset ${tempPreset.name} --date ${dateText}`,
    )
    // 音频文件才添加元数据
    // 检查源文件元数据
    if (helper.isAudioFile(entry.path) && entry.tags?.title) {
        const KEY_LIST = ["title", "artist", "album", "albumartist", "year"]
        // 验证 非空值，无乱码，值为字符串或数字
        const validTags = core.filterFields(entry.tags, (key, value) => {
            return (
                KEY_LIST.includes(key) &&
                Boolean(value) &&
                ((typeof value === "string" && value.length > 0) || typeof value === "number") &&
                !enc.hasBadCJKChar(value) &&
                !enc.hasBadUnicode(value)
            )
        })
        // 去掉值字符串中的单双引号，避免参数解析错误
        for (const [key, value] of Object.entries(validTags)) {
            if (typeof value === "string") {
                validTags[key] = value.replaceAll(/['"]/gi, " ")
            }
        }
        metaArgs.push(
            ...Object.entries(validTags).map(([key, value]) => [`-metadata`, `${key}=${value}`]),
        )
    } else {
        metaArgs.push(`-metadata`, `title=${entry.name}`)
    }
    // 元数据放到 extraArgs 这里（字符串形式仅供展示）
    tempPreset.extraArgs = metaArgs.join(" ")
    // 注意：这里直接使用 metaArgs 数组，不能再 join(" ") 后再 split(" ")——
    // 那个往返会把含空格的值（如 title=My Movie）拆成多个 argv。
    return metaArgs
}

/**
 * 构建流选择与其它输出参数（streamArgs / outputArgs，顺序重要）
 * @param {Object} tempPreset - 预设副本
 * @returns {string[]} 流与输出参数数组
 */
function buildStreamArgs(tempPreset) {
    const middleArgs = []
    // 流参数 streamArgs -map xxx 等
    if (tempPreset.streamArgs?.length > 0) {
        middleArgs.push(...tempPreset.streamArgs.split(" "))
    }
    // 输出参数在最后，在输出文件前面，顺序重要
    if (tempPreset.outputArgs?.length > 0) {
        middleArgs.push(...tempPreset.outputArgs.split(" "))
    }
    return middleArgs
}
export { createFFmpegArgs, tierName }
