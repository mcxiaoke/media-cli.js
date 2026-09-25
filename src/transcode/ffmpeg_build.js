/**
 * FFmpeg 命令行参数构建模块
 *
 * 包含 ffmpeg 命令行参数的纯构建函数（输入/滤镜/视频/音频/元数据/输出）。
 * 所有函数保持纯函数特性：不修改 entry，不读写外部状态，参数数组只进不出。
 */
import path from "node:path"

import * as core from "../../lib/core.js"
import { formatArgs } from "../../lib/core.js"
import * as enc from "../../lib/encoding.js"
import * as helper from "../../lib/helper.js"
import * as log from "../../lib/debug.js"
import presets from "./ffmpeg_presets.js"
import {
    buildEncoderArgs,
    buildVideoFilters,
    buildAudioFilters,
    calcLongEdge,
    toEven,
    codecFamilyOfPreset,
    scaleFormatOverride,
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
 * 去掉滤镜段首尾的多余逗号（",xxx," → "xxx"；连续逗号一并去除）
 */
const stripEdgeComma = (s) => String(s).replace(/^,+/, "").replace(/,+$/, "")

/**
 * 拆分预设滤镜为三段式（pre / {scaleFilter} scale / post）
 *
 * 兼容两种写法：
 *   1. 新字段（S-6 三段式）：
 *        pre_filters: "yadif=1"            # 缩放前（如反交错）
 *        filters:     "{scaleFilter}"      # 仍支持占位符，或直接省略
 *        post_filters: "unsharp=..."       # 缩放后（如锐化）
 *   2. 旧写法（向后兼容已迁移用户）：filters: "xxx,{scaleFilter},yyy"
 *      —— 占位符前=pre、后=post
 *
 * 合并规则：
 *   - filters 含 {scaleFilter}：占位符前段并入 pre、后段并入 post；
 *     显式 pre_filters/post_filters 存在时**优先**（旧段被显式字段替代，避免重复滤镜）
 *   - filters 不含 {scaleFilter}：整段视为缩放前处理（反交错/降噪等语义，
 *     旧实现"有 tier 时整段丢弃"是 P1-1 缺陷，本次修复保留用户滤镜）
 *
 * @param {object} tempPreset
 * @returns {{pre:string, post:string, scaleRequested:boolean}}
 */
function splitPresetFilterSegments(tempPreset) {
    let pre = tempPreset.pre_filters || ""
    let post = tempPreset.post_filters || ""
    let scaleRequested = false
    const legacy = tempPreset.filters || ""
    if (legacy.includes("{scaleFilter}")) {
        scaleRequested = true
        const idx = legacy.indexOf("{scaleFilter}")
        const before = stripEdgeComma(legacy.slice(0, idx))
        const after = stripEdgeComma(legacy.slice(idx + "{scaleFilter}".length))
        if (!pre && before) pre = before
        if (!post && after) post = after
    } else if (legacy) {
        if (!pre) pre = legacy
    }
    return { pre, post, scaleRequested }
}

/**
 * 计算本文件的缩放目标尺寸
 *
 * 尺寸由 calcLongEdge 在脚本层预计算为**显式偶数**，不依赖滤镜自身的保比例能力。
 * 原因（实测）：
 *   - h=-2 在 scale_cuda/scale_qsv 上存在格式协商冲突
 *   - force_original_aspect_ratio 在 scale_qsv / vpp_amf 上不存在
 *   - 各滤镜参数名不统一（scale_d3d11 用 width/height）
 *
 * 顺序：hwPlan.size（selectTier 已按长边规则算好）→ 预览时用 preset.dimension 现算
 *
 * @param {object} hwPlan
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @returns {{w:number,h:number}|null} 无法确定时返回 null
 */
function resolveEffectiveSize(hwPlan, entry, tempPreset) {
    const size = hwPlan?.size
    if (size?.w && size?.h) return size
    if (!hwPlan?.tier) return null
    const w = entry.info?.video?.width || 0
    const h = entry.info?.video?.height || 0
    if (w <= 0 || h <= 0) return null
    const dim = tempPreset.dimension || entry.preset?.dimension || 0
    if (dim <= 0) {
        return { w: toEven(w), h: toEven(h) }
    }
    const calculated = calcLongEdge(w, h, dim)
    return calculated?.w && calculated?.h ? calculated : null
}

/** 旧式 {scaleFilter} 占位符在无 tier/无尺寸可替换时的警告（只提示一次） */
let warnedScalePlaceholder = false
function warnScalePlaceholderDisabled() {
    if (warnedScalePlaceholder) return
    warnedScalePlaceholder = true
    log.logWarn(
        "FFConv",
        "preset filters contain {scaleFilter}, but no hardware tier/size is available " +
            "at this stage; scale filter is skipped",
    )
}

/**
 * 依据 hwPlan 生成完整视频滤镜链（三段式）
 *
 * 组装（与 lib/hwaccel.js buildVideoFilters 同一函数，探测=真实同源）：
 *   pre_filters → setpts（变速） → scale（按 tier 生成，替代 {scaleFilter}） → fps → post_filters
 *
 * 行为要点：
 *   - 用户滤镜（pre/post）不再被整段丢弃（修复 P1-1：--filters yadif 在有 hwPlan 时保留）；
 *   - 无 tier（兜底/预览异常）时输出用户滤镜原样，缩放段不可用并 warn；
 *   - scale 段生成条件：用户显式写了 {scaleFilter}、或任务确实需要缩放、或需改帧率
 *     （触发面与旧实现 buildVideoFilters 一致，避免"已达标文件被多一次同尺寸缩放"）。
 *
 * @returns {string} 如 "yadif=1,setpts=PTS/1.5,scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda,fps=25"
 */
/**
 * 是否需要 10bit 源 + h264 目标的位深对齐（scale 的 format=nv12）
 *
 * 单独抽出来的原因：它**同时也决定了要不要输出 `-vf`**。
 * 任务本身不需要缩放/改帧率、用户也没写滤镜时，缩放段本会被整段跳过 ——
 * 那样 10bit 源喂给 h264 硬件编码器会打不开（`-h encoder` 列出 p010le 但驱动不支持），
 * 整条硬件链路白费、回落到 libx264。详见 lib/hwaccel.js scaleFormatOverride。
 */
function depthAlignNeeded(entry, hwPlan, tempPreset) {
    return !!scaleFormatOverride(hwPlan?.tier, {
        codecFamily: codecFamilyOfPreset(tempPreset),
        pixFmt: entry.info?.video?.pixelFormat || "",
        bitDepth: entry.info?.video?.bitDepth,
    })
}

function buildScaleFiltersFromPlan(entry, hwPlan, tempPreset) {
    const { pre, post, scaleRequested } = splitPresetFilterSegments(tempPreset)
    const tier = hwPlan?.tier
    const speed = validateSpeed(tempPreset.speed)
    const framerate = tempPreset.framerate > 0 ? tempPreset.framerate : 0
    const effectiveSize = resolveEffectiveSize(hwPlan, entry, tempPreset)

    if (!tier || !effectiveSize) {
        // ⚠️ 无 tier 或尺寸不可算：不能把 "{scaleFilter}" 占位符原样输出到命令里
        // （会以字面量泄漏）。输出用户滤镜 + setpts + fps，缩放段剔除并 warn。
        if (scaleRequested) {
            warnScalePlaceholderDisabled()
        }
        const chain = []
        if (pre) chain.push(pre)
        if (speed !== 1) chain.push(`setpts=PTS/${speed}`)
        if (framerate > 0) chain.push(`fps=${framerate}`)
        if (post) chain.push(post)
        return chain.join(",")
    }

    const needScale = scaleRequested || entry.dstArgs.scaled || framerate > 0
    return buildVideoFilters({
        tier,
        size: effectiveSize,
        speed,
        framerate,
        preFilters: pre,
        postFilters: post,
        hasScale: needScale,
        // 位深对齐（10bit 源 + h264 目标 → scale 的 format=nv12）所需上下文，
        // 与探测侧（lib/hwaccel.js buildLayerArgs）传同一组字段，保证命令同构
        codecFamily: codecFamilyOfPreset(tempPreset),
        pixFmt: entry.info?.video?.pixelFormat || "",
        bitDepth: entry.info?.video?.bitDepth,
    })
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
 * T4：用户显式指定编码器（--video-codec / ffargs vc，经 preset.userArgs.videoCodec 传递）
 *   时穿透 ENCODER_MATRIX，直接使用该编码器并按其实现分发质量参数；
 *   值为 "copy"（--video-copy / vc=copy）时直接返回 ["-c:v","copy"]，不参与分层。
 *
 * @returns {string[]|null} 参数数组；无 plan 时返回 null（视频参数为空留给调用方处理）
 */
function buildVideoArgsFromPlan(entry, hwPlan, tempPreset) {
    const tier = hwPlan?.tier
    if (!tier) return null
    // 用户显式指定的视频编码器（穿透 ENCODER_MATRIX；"copy" 表示流复制）
    const forcedEncoder = tempPreset.userArgs?.videoCodec
    if (forcedEncoder === "copy") {
        // 流复制：不参与编码器分层，直接 -c:v copy（--video-copy 回归修复）
        return ["-c:v", "copy"]
    }
    // ⚠️ 职责划分（S-4 重构）：
    //   tier   → 出「编码器 + 编码器专属调优」（decoder/encoder 成对，同厂商）
    //   preset → 出「输出 codec 族 + 质量/码率」，不关心硬件实现
    //
    // 所以这里是两段拼接：tier 的编码器参数 + preset 的质量参数。
    // 不能再「整段替换」，否则 preset.videoArgs 里的质量参数会被丢弃。
    const codecFamily = codecFamilyOfPreset(tempPreset)
    const quality = tempPreset.videoQuality || entry.preset?.videoQuality || 24
    // 目标码率：一律用 bps 纯数字（dstVideoBitrate=calculateDstArgs 算出的目标，已按分辨率 scale）。
    // 带 K 的模板字段（videoBitrateK/audioBitrateK）是**字符串**，仅供文件名/模板
    //（audioArgs `-b:a {audioBitrateK}`、suffix `_{audioBitrateK}`）注入使用，不参与码率计算。
    const bitrate = tempPreset.dstVideoBitrate || undefined
    // 峰值码率（bps）：calculateDstArgs 已按分辨率 scale；缺省 0 → buildEncoderArgs 用 ×1.5 兜底
    const maxBitrate = tempPreset.dstMaxBitrate || undefined
    // pixFmt 传给 buildEncoderArgs：历史用于 10bit + qsv 质量钳制，
    // 现另用于 swdec 层的位深对齐（10bit 源 + h264 目标 → -pix_fmt yuv420p）
    const pixFmt = entry.info?.video?.pixelFormat || ""
    // tier 一并传入：swdec 层的编码器行是按主 GPU 厂商注入的（tier.encoderRow），
    // 必须与探测命令走同一条解析路径
    const encArgs = buildEncoderArgs(tier.name, {
        quality,
        bitrate,
        maxBitrate,
        codecFamily,
        pixFmt,
        // ⚠️ bitDepth 必须传：mediainfo 路径下 pixelFormat="YUV4:2:0" 不含位深，
        //    只传 pixFmt 时 swdec 层会漏掉 `-pix_fmt yuv420p` 对齐 → 10bit 源 + h264 目标
        //    整层探测失败白落 libx264（真实片库 169 个 10bit 文件的收益点）。
        bitDepth: entry.info?.video?.bitDepth,
        forcedEncoder,
        tier,
        // caps.encoders 用于运行时编码器回退（cpu/av1 等矩阵默认该构建可能没有）
        encoders: hwPlan?.caps?.encoders,
        anime: tempPreset.anime ?? entry.dstArgs?.anime ?? entry.preset?.userArgs?.anime ?? false,
    })

    return encArgs
}

/** speed≠1 强制音频重编码（忽略 copy）时的警告（只提示一次） */
let warnedSpeedAudioReencode = false
function warnSpeedForcesAudioReencode() {
    if (warnedSpeedAudioReencode) return
    warnedSpeedAudioReencode = true
    log.logWarn(
        "FFConv",
        "speed != 1 requires audio re-encode (atempo): audio 'copy' is ignored for this run",
    )
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

    // 输入参数部分，在 -i input 前面
    const inputArgs = buildInputArgs(entry, tempPreset, hwPlan)

    // 中间参数部分，在 -i input 后面，顺序建议 filters codec stream metadata
    const isVideoPreset = tempPreset.type === "video"
    const middleArgs = [
        ...(isVideoPreset ? buildFilterArgs(entry, tempPreset, hwPlan) : []),
        ...(isVideoPreset ? buildVideoArgs(entry, hwPlan, tempPreset) : []),
        ...buildAudioArgs(entry, tempPreset, hwPlan?.caps),
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
    // 添加内嵌或外挂字幕与流映射参数
    appendSubtitleArgs(entry, inputArgs, tempPreset)
    return inputArgs
}

const BITMAP_SUBTITLE_FORMATS = new Set([
    "hdmv_pgs_subtitle",
    "pgs",
    "dvd_subtitle",
    "vobsub",
    "dvb_subtitle",
    "dvb_teletext",
    "xsub",
    "arib_caption",
])

function isBitmapSubtitle(sub) {
    const fmt = (sub?.format || "").toLowerCase()
    const codec = (sub?.codec || "").toLowerCase()
    return BITMAP_SUBTITLE_FORMATS.has(fmt) || BITMAP_SUBTITLE_FORMATS.has(codec)
}

// 针对 MKV、MP4 及图形字幕降级的预定义字幕与流映射模板
const SUB_ARGS_MKV = ["-c:s", "copy", "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?"]
const SUB_ARGS_MP4 = ["-c:s", "mov_text", "-map", "0:v:0", "-map", "0:a?", "-map", "0:s?"]
const SUB_ARGS_MP4_DROP = ["-sn", "-map", "0:v:0", "-map", "0:a?"]

/**
 * 附加字幕与流映射参数（预定义模板驱动）：
 * - 优先使用外部选中的字幕；
 * - MKV 容器使用 -c:s copy 完整保留所有字幕（文本/图形）；
 * - MP4 容器文本字幕转 -c:s mov_text，检测到图形字幕（PGS/VobSub）时容错使用 -sn；
 * - 默认使用 -map 0:v:0 -map 0:a? -map 0:s? 保留全部音频和字幕轨道（外挂字幕映射 1:0?）。
 * @param {Object} entry - 文件对象
 * @param {string[]} inputArgs - 正在构建的输入参数数组（原地追加）
 * @param {Object} tempPreset - 预设副本
 */
function appendSubtitleArgs(entry, inputArgs, tempPreset) {
    // 仅视频预设或视频文件处理字幕和视频流映射
    if (tempPreset.type !== "video" && !helper.isVideoFile(entry.path)) {
        return
    }

    const extRaw =
        path.extname(entry.fileDst || "") || tempPreset.format || helper.pathExt(entry.path) || ""
    const isMkv = extRaw.toLowerCase().includes("mkv")

    // 1. 外挂字幕：优先挂载外挂文件并映射
    if (entry.selectedSubtitle) {
        const subCodec = isMkv ? "copy" : "mov_text"
        inputArgs.push(
            "-i",
            entry.selectedSubtitle,
            "-c:s",
            subCodec,
            "-metadata:s:s:0",
            "language=chi",
            "-disposition:s:0",
            "default",
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-map",
            "1:0?",
        )
        return
    }

    // 2. 内嵌字幕：MKV 容器无损直通复制
    if (isMkv) {
        inputArgs.push(...SUB_ARGS_MKV)
        return
    }

    // 3. 内嵌字幕：MP4 容器（检测 PGS/VobSub 等图形字幕容错降级）
    const subs = entry.info?.subtitles
    const hasBitmap = Array.isArray(subs) && subs.some(isBitmapSubtitle)
    if (hasBitmap) {
        log.logWarn(
            "FFConv",
            "Bitmap subtitle (PGS/VobSub) is not supported in MP4 container; dropping subtitles with -sn",
        )
        inputArgs.push(...SUB_ARGS_MP4_DROP)
    } else {
        inputArgs.push(...SUB_ARGS_MP4)
    }
}

/**
 * 构建滤镜参数（-vf）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @param {Object} hwPlan - 硬件加速分层计划
 * @returns {string[]} 滤镜参数数组
 */
function buildFilterArgs(entry, tempPreset, hwPlan) {
    const middleArgs = []
    const { pre, post } = splitPresetFilterSegments(tempPreset)
    const sp = validateSpeed(tempPreset.speed)
    // 只有「需要缩放」「需要改帧率」「确有用户滤镜」「需要位深对齐」「需变速」时才输出 -vf：
    //   - 纯占位符预设（filters="{scaleFilter}"）在无缩放无帧率时不输出 -vf，
    //     与旧行为一致（不产生多余的同尺寸缩放）
    //   - 位深对齐（10bit 源 + h264 目标）必须输出，否则硬件编码器打不开 10bit 帧
    //   - 变速(sp≠1) 必须输出：-vf 里要带 setpts（否则 --speed 静默丢失）
    if (
        entry.dstArgs.scaled ||
        tempPreset.framerate > 0 ||
        pre ||
        post ||
        sp !== 1 ||
        depthAlignNeeded(entry, hwPlan, tempPreset)
    ) {
        let tempFilters = buildScaleFiltersFromPlan(entry, hwPlan, tempPreset)
        // 帧在系统内存（软解层：cpu / swdec）时，若滤镜链含 CUDA 滤镜（scale_cuda 等），
        // 需要显式把帧上传给 GPU —— ffmpeg 不会自动插入 hwupload
        // （实测：只写 scale_cuda 不给上传 → Impossible to convert between the formats）。
        // 但仅当链里确实有 CUDA 滤镜时才有意义：
        // 无条件前置 hwupload_cuda 会给纯 CPU 滤镜链（scale=...）插入无效节点而直接失败
        const softwareDecodeTiers = ["cpu", "swdec"]
        if (softwareDecodeTiers.includes(tierName(hwPlan)) && /_cuda\b/.test(tempFilters)) {
            tempFilters = "hwupload_cuda," + tempFilters
        }
        if (tempFilters) {
            middleArgs.push("-vf")
            middleArgs.push(formatArgs(tempFilters, tempPreset))
        }
    }
    // D2：变速的音频侧——与真实/探测同构，simple `-af atempo`（muxer 按 PTS 保同步）。
    // 仅在确有明显变速且存在音频流时输出，避免无音频流时 -af 报错。
    const hasAudio = Boolean(entry.info?.audio || entry.srcAudioCodec)
    const af = buildAudioFilters(tempPreset.speed)
    if (af && hasAudio) {
        middleArgs.push("-af", af)
    }
    return middleArgs
}

/**
 * 构建视频编码参数（S-4 硬件分层块唯一来源）
 *
 * ⚠️ 不再有「planVideoArgs 为 null 时回退 tempPreset.videoArgs 原样」的退路：
 *    该退路会让旧式 `-c:v libx264` 在 GPU 层原样输出，产生
 *    「CPU 滤镜 + GPU 编码器」畸形组合（实测根因，见方案 §3.1）。
 *    videoArgs 槽位已并入 buildVideoArgsFromPlan（无 -c:v 时作为额外参数附加），
 *    编码器参数一律由分层决定。
 *
 * @returns {string[]} 视频参数数组
 */
function buildVideoArgs(entry, hwPlan, tempPreset) {
    const middleArgs = []
    const planVideoArgs = buildVideoArgsFromPlan(entry, hwPlan, tempPreset)
    if (planVideoArgs) {
        middleArgs.push(...planVideoArgs)
    }
    return middleArgs
}

/**
 * 构建音频编码参数（纯结构化数组组装：智能流复制 copy 或编码 -c:a <codec> -b:a <bitrate>）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @param {Object} [caps] - detectHardwareCapabilities 的结果（含 encoders Set）。
 *   存在时对不可用的编码器做静态降级（如本机缺 libfdk_aac -> aac），
 *   避免每条任务都等到真实转码失败才轮到重试/降级。
 *   严格模式（entry.argv.strict）下不做静态降级，原样保留编码器参数；
 *   编码器缺失时的"跳过该文件+warn 日志"由 prepare 阶段预检负责。
 * @returns {string[]} 音频参数数组
 */
function buildAudioArgs(entry, tempPreset, caps) {
    const strict = entry.argv?.strict === true
    const speedActive = validateSpeed(tempPreset.speed) !== 1
    let shouldCopy = false

    // 1. 判断是否应执行音频流复制 (copy)
    if (
        tempPreset.userArgs?.audioCopy ||
        tempPreset.audioCodec === "copy" ||
        tempPreset.audioArgs === "-c:a copy"
    ) {
        shouldCopy = true
    } else if (presets.isAudioExtract(tempPreset)) {
        // extract_audio 模式：源音频格式为 aac 时直接 copy
        if (entry.srcAudioCodec === "aac") {
            shouldCopy = true
        }
    } else if (helper.isVideoFile(entry.path)) {
        // 针对视频文件：如果目标码率大于源文件码率，且容器兼容源音频编码格式，则不重新编码
        const bitrateOk =
            tempPreset.srcAudioBitrate > 0 &&
            tempPreset.dstAudioBitrate + 2000 > tempPreset.srcAudioBitrate
        const dstExt = tempPreset.format || helper.pathExt(entry.path)
        const containerOk = helper.isAudioCodecCompatibleWithContainer(
            entry.srcAudioCodec,
            dstExt,
            entry.info?.audio?.codec,
        )
        if (!containerOk && bitrateOk) {
            log.debug(
                `Audio copy skipped: codec "${entry.srcAudioCodec}" not supported in container "${dstExt}", forcing re-encode`,
            )
        }
        if (bitrateOk && containerOk) {
            shouldCopy = true
        }
    }

    // 2. 如果满足 copy 条件：
    //    当 speed != 1 时，ffmpeg 要求音频必须重编码才能挂载 atempo 滤镜，强制忽略 copy
    if (shouldCopy) {
        if (speedActive) {
            warnSpeedForcesAudioReencode()
        } else {
            return ["-c:a", "copy"]
        }
    }

    // 3. 编码模式：确定音频编码器并做静态降级检查
    let codec = tempPreset.userArgs?.audioCodec || tempPreset.audioCodec || "aac"
    if (tempPreset.audioArgs && !tempPreset.audioCodec) {
        const m = String(tempPreset.audioArgs).match(/-c:a(?::\d+)?\s+(\S+)/)
        if (m) {
            codec = m[1]
        }
    }
    codec = fallbackAudioEncoder(codec, caps?.encoders, strict)

    const middleArgs = ["-c:a", codec]

    // 4. 码率 / 质量参数
    let bitrate =
        tempPreset.userArgs?.audioBitrate ||
        tempPreset.dstAudioBitrate ||
        tempPreset.audioBitrate ||
        0
    if (bitrate === 0 && tempPreset.audioArgs) {
        const bm = String(tempPreset.audioArgs).match(/-b:a\s+(\S+)/)
        if (bm) {
            try {
                bitrate = helper.parseBitrate(bm[1])
            } catch {
                // ignore
            }
        }
    }

    if (bitrate > 0) {
        middleArgs.push("-b:a", `${Math.round(bitrate / 1000)}k`)
    } else {
        const q = tempPreset.userArgs?.audioQuality || tempPreset.audioQuality || 0
        if (q > 0) {
            middleArgs.push("-q:a", String(q))
        }
    }

    return middleArgs
}

/**
 * 校验音频编码器是否可用。若本机不支持，非 strict 模式下静态降级为 aac。
 * 纯函数，不修改入参。
 * 支持传入纯编码器名（如 "libfdk_aac"）或命令行参数串（兼容测试）。
 *
 * @param {string} codecOrArgs - 编码器名或包含 -c:a 的参数串
 * @param {Set<string>} [encoders] - ffmpeg -encoders 解析出的编码器集合；缺失/空集合时原样返回
 * @param {boolean} [strict=false] - 严格模式：不降级也不抛错，原样返回
 * @returns {string} 修正后的编码器名或参数串
 */
function fallbackAudioEncoder(codecOrArgs, encoders, strict = false) {
    if (!codecOrArgs || !encoders || encoders.size === 0) {
        return codecOrArgs
    }
    const str = String(codecOrArgs).trim()
    const m = str.match(/-c:a(?::\d+)?\s+(\S+)/)
    if (m) {
        const codec = m[1]
        if (codec === "copy" || encoders.has(codec) || strict) {
            return codecOrArgs
        }
        log.logWarn(
            "FFConv",
            `audio encoder "${codec}" unavailable in this ffmpeg build, falling back to aac`,
        )
        return str.replace(m[0], m[0].replace(m[1], "aac"))
    }
    if (str === "copy" || encoders.has(str) || strict) {
        return codecOrArgs
    }
    log.logWarn(
        "FFConv",
        `audio encoder "${str}" unavailable in this ffmpeg build, falling back to aac`,
    )
    return "aac"
}

/**
 * 判断源文件是否为包含过期统计标签 (如 mkvmerge 混流写入的 BPS/NUMBER_OF_BYTES) 的特殊 MKV。
 * 仅对携带此类标签的 Matroska 容器生效，MP4/MOV 及无统计的普通容器直接返回 false。
 * @param {Object} entry - 文件对象
 * @returns {boolean}
 */
function hasMkvStatistics(entry) {
    if (!entry) return false
    if (entry.hasMkvStats === true) return true
    if (entry.hasMkvStats === false) return false

    const ext = path.extname(entry.path || "").toLowerCase()
    const fmt = String(entry.info?.format || "").toLowerCase()
    const isMkv =
        ext === ".mkv" ||
        ext === ".mka" ||
        ext === ".webm" ||
        fmt.includes("matroska") ||
        fmt.includes("webm")
    if (!isMkv) return false

    const checkTags = (obj) => {
        if (!obj || typeof obj !== "object") return false
        for (const k of Object.keys(obj)) {
            const upper = k.toUpperCase()
            if (
                upper === "_STATISTICS_TAGS" ||
                upper === "_STATISTICS_WRITING_APP" ||
                upper === "BPS" ||
                upper.startsWith("BPS-") ||
                upper === "NUMBER_OF_BYTES" ||
                upper.startsWith("NUMBER_OF_BYTES-") ||
                upper === "NUMBER_OF_FRAMES" ||
                upper.startsWith("NUMBER_OF_FRAMES-")
            ) {
                return true
            }
        }
        return false
    }

    if (
        checkTags(entry.tags) ||
        checkTags(entry.info?.tags) ||
        checkTags(entry.info?.format?.tags) ||
        checkTags(entry.info?.video?.tags) ||
        checkTags(entry.info?.audio?.tags)
    ) {
        return true
    }

    const raw = entry.rawMetadata || entry.info?.raw
    if (raw) {
        const rawStr = typeof raw === "string" ? raw : JSON.stringify(raw)
        if (
            rawStr.includes("_STATISTICS_TAGS") ||
            rawStr.includes("NUMBER_OF_BYTES") ||
            rawStr.includes('"BPS"') ||
            rawStr.includes("BPS-")
        ) {
            return true
        }
    }

    return false
}

/**
 * 构建元数据参数（音频标签/纯净标题/用户自定义元数据）
 * 不再强制覆写 description 和 copyright，避免冲掉原片元数据；
 * 标题去除扩展名后缀（纯净影片名）。
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本
 * @returns {string[]} 元数据参数数组
 */
function buildMetaArgs(entry, tempPreset) {
    const metaArgs = []

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
        for (const [key, value] of Object.entries(validTags)) {
            metaArgs.push("-metadata", `${key}=${value}`)
        }
    } else {
        const pureTitle = path.parse(entry.name || "").name || entry.name
        metaArgs.push("-metadata", `title=${pureTitle}`)
    }

    // 仅当源文件为包含过期统计标签 (如 mkvmerge 混流写入的 BPS/NUMBER_OF_BYTES) 的特殊 MKV 时，
    // 才显式清空重编码轨上的过期统计标签，防止 MediaInfo 误读旧码率造成严重显示失真。
    // 普通 MP4 或无统计标签的容器绝不冗余追加这 12 个参数。
    if (hasMkvStatistics(entry)) {
        if (tempPreset.type === "video") {
            metaArgs.push(
                "-metadata:s:v",
                "BPS=",
                "-metadata:s:v",
                "NUMBER_OF_BYTES=",
                "-metadata:s:v",
                "NUMBER_OF_FRAMES=",
                "-metadata:s:v",
                "_STATISTICS_TAGS=",
                "-metadata:s:v",
                "_STATISTICS_WRITING_APP=",
                "-metadata:s:v",
                "_STATISTICS_WRITING_DATE_UTC=",
            )
        }

        // 若音频轨被重编码 (非 copy)，同样清除音频轨上的过期 BPS 统计标签
        const isAudioCopy =
            Boolean(tempPreset.audioCopy) ||
            tempPreset.userArgs?.audioCodec === "copy" ||
            tempPreset.audioCodec === "copy"
        if (!isAudioCopy) {
            metaArgs.push(
                "-metadata:s:a",
                "BPS=",
                "-metadata:s:a",
                "NUMBER_OF_BYTES=",
                "-metadata:s:a",
                "NUMBER_OF_FRAMES=",
                "-metadata:s:a",
                "_STATISTICS_TAGS=",
                "-metadata:s:a",
                "_STATISTICS_WRITING_APP=",
                "-metadata:s:a",
                "_STATISTICS_WRITING_DATE_UTC=",
            )
        }
    }

    // 用户 --metadata 追加（定稿）：排在自动项之后 → ffmpeg「后写覆盖」自动 title/同名字段。
    // 每个 key=value 作为单个 argv token（值内空格得以保留，如 title=My Video）。
    const userMeta = tempPreset.userArgs?.metadataPairs
    if (Array.isArray(userMeta)) {
        for (const [k, v] of userMeta) {
            metaArgs.push(`-metadata`, `${k}=${v}`)
        }
    }
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
        // 防御性过滤：去掉有害的 -map_metadata:s:v 0:s:v 与 -map_metadata:s:a 0:s:a，
        // 该参数会禁用 ffmpeg 默认的逐流元数据继承机制，导致多音轨和多字幕轨的语言 (lang) 与标题 (title) 彻底丢失，
        // 并把源流的过期 BPS 统计硬塞给转码后的新流。
        const sanitized = tempPreset.streamArgs
            .replace(/-map_metadata:s:[va]\s+\S+/g, "")
            .replace(/\s+/g, " ")
            .trim()
        if (sanitized) {
            middleArgs.push(...sanitized.split(" "))
        }
    }
    // 输出参数在最后，在输出文件前面，顺序重要
    if (tempPreset.outputArgs?.length > 0) {
        middleArgs.push(...tempPreset.outputArgs.split(" "))
    }
    return middleArgs
}
export {
    createFFmpegArgs,
    hasMkvStatistics,
    tierName,
    fallbackAudioEncoder,
    buildScaleFiltersFromPlan,
    buildVideoArgsFromPlan,
    splitPresetFilterSegments,
}
