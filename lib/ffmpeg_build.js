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
    buildScaleFilter,
    buildVideoFilters,
    calcLongEdge,
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
 * 把用户追加的参数串按空白拆成 token 数组（定稿：--video-args / --audio-args 追加用）。
 * 不走 formatArgs 模板替换（避免与 %k%/{k}/@k@/!k! 占位符语法冲突），也不支持含空格的取值
 * （含空格取值请走 --metadata 专用通道）。
 * @param {string|undefined|null} str
 * @returns {string[]}
 */
function splitArgs(str) {
    if (typeof str !== "string") return []
    return str.trim().split(/\s+/).filter(Boolean)
}

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
    const calculated = calcLongEdge(
        entry.info?.video?.width || 0,
        entry.info?.video?.height || 0,
        tempPreset.dimension || entry.preset?.dimension || 0,
    )
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
        // 用户 --video-args 仍追加在后（若与 copy 不兼容，报错由用户自负，定稿 §7）
        return ["-c:v", "copy", ...splitArgs(tempPreset.userArgs?.videoExtra)]
    }
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
    // 现另用于 swdec 层的位深对齐（10bit 源 + h264 目标 → -pix_fmt yuv420p）
    const pixFmt = entry.info?.video?.pixelFormat || ""
    // tier 一并传入：swdec 层的编码器行是按主 GPU 厂商注入的（tier.encoderRow），
    // 必须与探测命令走同一条解析路径
    const encArgs = buildEncoderArgs(tier.name, {
        quality,
        bitrateK,
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
    })

    // preset.videoArgs 保留为「额外的硬件无关参数」槽位，默认空。
    // ⚠️ 旧式含 -c:v 的 videoArgs 已**不支持**（用户拍板：不兼容立即移除）：
    //    编码器一律由分层决定，避免出现「CPU 滤镜 + NVENC 编码器」畸形组合。
    //    检测到即整体忽略该槽位并提示一次（-preset/-tune 等段也一并丢弃，
    //    保留可能被硬件编码器静默忽略或直接报错）。
    const presetVa = tempPreset.videoArgs || ""
    if (presetVa && /-c:v/.test(presetVa)) {
        warnLegacyVideoArgsIgnored()
        // 基线 videoArgs 含旧式 -c:v → 整段丢弃（编码器由分层决定），
        // 但用户 --video-args（videoExtra）是独立通道，仍应追加
        return [...encArgs, ...splitArgs(tempPreset.userArgs?.videoExtra)]
    }
    const extra = presetVa ? formatArgs(presetVa, tempPreset).split(" ").filter(Boolean) : []
    // 追加顺序：分层编码器块 → 预设基线 videoArgs（硬件无关） → 用户 --video-args（最高优先）
    return [...encArgs, ...extra, ...splitArgs(tempPreset.userArgs?.videoExtra)]
}

/** 旧式 -c:v videoArgs 被忽略时的警告（只提示一次，多文件任务不刷屏） */
let warnedLegacyVideoArgs = false
function warnLegacyVideoArgsIgnored() {
    if (warnedLegacyVideoArgs) return
    warnedLegacyVideoArgs = true
    log.logWarn(
        "FFConv",
        "preset.videoArgs contains '-c:v' which is no longer supported: " +
            "the encoder is decided by the hardware tier (use videoCodecFamily instead). " +
            "The whole videoArgs is ignored.",
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
    const middleArgs = [
        ...buildFilterArgs(entry, tempPreset, hwPlan),
        ...buildVideoArgs(entry, hwPlan, tempPreset),
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
 * complexFilter 内的 {scaleFilter} 占位符按 tier 现算替换
 *
 * 探测与真实同源：buildLayerArgs（探测）的 complexFilter 由 buildVideoFilters
 * 组装（setpts→scale→fps），真实 complexFilter 模板化后结构相同，这里只
 * 把占位符替换成与探测同一构建器（buildScaleFilter）的输出。
 *
 * 无法替换（无 tier / 尺寸不可算）时：剔除占位符并 warn，不向命令泄漏字面量。
 * @param {string} complexFilter - 含 {scaleFilter} 的模板串
 * @returns {string} 替换后的串（无占位符时原样返回）
 */
function resolveComplexFilterScale(complexFilter, hwPlan, entry, tempPreset) {
    const raw = String(complexFilter)
    if (!raw.includes("{scaleFilter}")) return raw
    const tier = hwPlan?.tier
    const size = resolveEffectiveSize(hwPlan, entry, tempPreset)
    if (!tier || !size) {
        warnScalePlaceholderDisabled()
        // 剔除占位符及相邻逗号，避免以字面量泄漏到命令/日志
        return raw
            .replace(/,\{scaleFilter\}/, "")
            .replace(/\{scaleFilter\},/, "")
            .replace("{scaleFilter}", "")
    }
    return raw.replace(
        "{scaleFilter}",
        buildScaleFilter(
            tier,
            size,
            scaleFormatOverride(tier, {
                codecFamily: codecFamilyOfPreset(tempPreset),
                pixFmt: entry.info?.video?.pixelFormat || "",
                bitDepth: entry.info?.video?.bitDepth,
            }),
        ),
    )
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
        // complexFilter 内的 {scaleFilter} 占位符按 tier 现算替换
        // （hevc_speed 模板化后不再有字面量 scale_cuda，见方案 §3.3）
        const resolved = resolveComplexFilterScale(
            tempPreset.complexFilter,
            hwPlan,
            entry,
            tempPreset,
        )
        middleArgs.push(formatArgs(resolved, tempPreset))
    } else {
        const { pre, post } = splitPresetFilterSegments(tempPreset)
        // 只有「需要缩放」「需要改帧率」「确有用户滤镜」「需要位深对齐」时才输出 -vf：
        //   - 旧条件 (scaled || framerate>0) 会把 --filters yadif（无缩放无帧率）
        //     整段丢弃，日志显示已加、产物未加（P1-1，本次修复）
        //   - 纯占位符预设（filters="{scaleFilter}"）在无缩放无帧率时不输出 -vf，
        //     与旧行为一致（不产生多余的同尺寸缩放）
        //   - 位深对齐（10bit 源 + h264 目标）必须输出，否则硬件编码器打不开 10bit 帧
        if (
            entry.dstArgs.scaled ||
            tempPreset.framerate > 0 ||
            pre ||
            post ||
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
 * 构建音频编码参数（extract_audio 智能选择；码率与容器兼容性决定是否 copy）
 * @param {Object} entry - 文件对象
 * @param {Object} tempPreset - 预设副本（可能被原地修改 audioArgs）
 * @param {Object} [caps] - detectHardwareCapabilities 的结果（含 encoders Set）。
 *   存在时对 audioArgs 里不可用的编码器做静态降级（如本机缺 libfdk_aac -> aac），
 *   避免每条任务都等到真实转码失败才轮到重试/降级。
 *   严格模式（entry.argv.strict）下不做静态降级，原样保留编码器参数；
 *   编码器缺失时的"跳过该文件+warn 日志"由 prepare 阶段预检负责。
 * @returns {string[]} 音频参数数组
 */
function buildAudioArgs(entry, tempPreset, caps) {
    const middleArgs = []
    const strict = entry.argv?.strict === true
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
        // 静态编码器可用性校验：caps 已知且 audioArgs 指定了不可用编码器时就地降级
        tempPreset.audioArgs = fallbackAudioEncoder(tempPreset.audioArgs, caps?.encoders, strict)
        const aa = formatArgs(tempPreset.audioArgs, tempPreset)
        middleArgs.push(...aa.split(" "))
    }
    // 用户 --audio-args 追加（定稿：追加而非替换 preset.audioArgs，保住 copy/降级启发式）
    middleArgs.push(...splitArgs(tempPreset.userArgs?.audioExtra))
    return middleArgs
}

/**
 * 把 audioArgs 里本机 ffmpeg 不支持的音频编码器替换为 aac。
 * 纯函数，不修改入参。
 *
 * @param {string} audioArgs - 原始音频参数串（如 "-c:a libfdk_aac -b:a 96k"）
 * @param {Set<string>} [encoders] - ffmpeg -encoders 解析出的编码器集合；缺失/空集合时原样返回
 * @param {boolean} [strict] - 严格模式：不降级也不抛错，原样返回
 *   （"探测到不支持则跳过该文件"的职责在 prepare 预检与 runFFmpegCmd plan 预检，
 *   这里是纯参数构建，若 strict 下抛错会让预览构建阶段整体崩溃）
 * @returns {string} 修正后的参数串
 */
function fallbackAudioEncoder(audioArgs, encoders, strict = false) {
    if (!encoders || encoders.size === 0) {
        return audioArgs
    }
    // 只匹配 -c:a（含 -c:a:0 这种流选择写法）后的编码器名
    const m = String(audioArgs).match(/-c:a(?::\d+)?\s+(\S+)/)
    if (!m || m[1] === "copy") {
        return audioArgs
    }
    const codec = m[1]
    if (encoders.has(codec)) {
        return audioArgs
    }
    if (strict) {
        // 严格模式：不降级（缺失编码器由 prepare 预检拦截该文件，这里不处理）
        return audioArgs
    }
    log.logWarn(
        "FFConv",
        `audio encoder "${codec}" unavailable in this ffmpeg build, falling back to aac`,
    )
    // 只替换匹配段内的编码器名：如 "-c:a libfdk_aac" -> "-c:a aac"（流选择写法同）
    return String(audioArgs).replace(m[0], m[0].replace(m[1], "aac"))
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
    // 用户 --metadata 追加（定稿）：排在自动项之后 → ffmpeg「后写覆盖」自动 title/同名字段。
    // 每个 key=value 作为单个 argv token（值内空格得以保留，如 title=My Video）。
    const userMeta = tempPreset.userArgs?.metadataPairs
    if (Array.isArray(userMeta)) {
        for (const [k, v] of userMeta) {
            metaArgs.push(`-metadata`, `${k}=${v}`)
        }
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
export {
    createFFmpegArgs,
    tierName,
    fallbackAudioEncoder,
    buildScaleFiltersFromPlan,
    buildVideoArgsFromPlan,
    resolveComplexFilterScale,
    splitPresetFilterSegments,
}
