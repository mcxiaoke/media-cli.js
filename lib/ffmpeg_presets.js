/*
 * 文件: ffmpeg_presets.js
 * 项目: mediac
 * 创建: 2024-04-27 13:21:17
 * 修改: 2026-09-21（Phase 1 单源化：预设定义收敛到 presets/default.yaml）
 * 作者: mcxiaoke (github@mcxiaoke.com)
 * 许可证: Apache License 2.0
 *
 * FFmpeg转码预设配置库
 * 定义了各种音视频格式转换的预设参数，支持批量处理和自定义配置
 *
 * S-4 单源化（Phase 1，2026-09-21）：
 *   预设定义的唯一事实源是包内 presets/default.yaml（随 npm 包发布），
 *   用户可通过 ~/.mediac/presets.yaml 或 cwd/presets.yaml 分层覆盖/新增，
 *   同名覆盖必须显式声明 `_override: true`（P0-1 修复）。
 *   本文件不再包含任何硬编码预设定义。
 */

import path from "path"
import { getPresetSearchPaths, loadPresetLayers, mergePresets } from "./preset_loader.js"
import { parseArgOptions } from "./ffmpeg_args_known.js"

const UNIT_KB = 1000
const UNIT_MB = UNIT_KB * 1000

/**
 * FFmpeg命令参数预设类
 * 封装FFmpeg转码参数，提供统一的配置接口
 * 支持视频、音频、图片等多种媒体格式的转换
 */
class FFmpegPreset {
    constructor(
        name,
        {
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
            // 三段式滤镜（S-4 重构）：
            //   pre_filters  → 缩放前执行（如反交错）
            //   filters      → 主滤镜串，`{scaleFilter}` 占位符由 tier 层替换为实际缩放滤镜
            //   post_filters → 缩放后执行（如锐化）
            // 三段以 `,` 拼接为最终 -vf 参数；仅有 filters 时行为与旧版一致。
            pre_filters,
            post_filters,
            output,
            videoBitrate = 0,
            videoQuality = 0,
            audioBitrate = 0,
            audioQuality = 0,
            dimension = 0,
            speed = 1,
            framerate = 0,
            smartBitrate,
            // 输出视频 codec 族："h264" | "hevc" | "av1" | "vp9"
            //
            // ⚠️ 语义说明（S-4 重构）：
            //   preset 只声明「输出什么格式」和「质量/码率」，
            //   **不关心用什么硬件实现**（NVENC/QSV/AMF/libx26x）。
            //   具体编码器由 lib/hwaccel.js 按 tier（解码层）+ 本字段决定。
            //
            //   未声明时由 videoArgs 里的 `-c:v xxx` 推断（向后兼容 YAML 预设）。
            videoCodecFamily,
        } = {},
    ) {
        this.name = name
        this.format = format
        this.type = type
        this.prefix = prefix
        this.suffix = suffix
        this.videoArgs = videoArgs
        this.videoCodecFamily = videoCodecFamily
        this.audioArgs = audioArgs
        this.inputArgs = inputArgs
        this.streamArgs = streamArgs
        this.extraArgs = extraArgs
        this.outputArgs = outputArgs
        this.filters = filters
        this.complexFilter = complexFilter
        // 三段式滤镜字段
        this.pre_filters = pre_filters
        this.post_filters = post_filters
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

const PRESET_NAMES = []
const PRESET_MAP = new Map()

/**
 * 根据预设名称获取FFmpeg预设
 *
 * @param {string} name - 预设名称
 * @returns {FFmpegPreset|undefined} FFmpeg预设对象
 */
function getPreset(name) {
    return PRESET_MAP.get(name)
}

/**
 * 获取所有预设Map
 *
 * @returns {Map} 包含所有预设的Map对象
 */
function getAllPresets() {
    return PRESET_MAP
}

/**
 * 获取所有预设名称列表
 *
 * P0-2 修复：返回副本而非内部数组引用。
 * 此前 yargs builder 里 `choices: presets.getAllNames()` 直接拿到内部数组，
 * 后续 loadYamlPresets 向同一数组 push 时，会对已注册的 choices 造成未定义行为。
 * 现在每次返回新数组，调用方任何修改都不影响内部状态。
 *
 * @returns {Array<string>} 预设名称数组（副本）
 */
function getAllNames() {
    return [...PRESET_NAMES]
}

/**
 * 检查预设是否为音频提取预设
 *
 * @param {FFmpegPreset} preset - FFmpeg预设对象
 * @returns {boolean} 如果是音频提取预设返回true
 */
function isAudioExtract(preset) {
    // 内置预设已迁移到 YAML（presets/default.yaml），此处避免引用已删除的常量
    return preset.name === "audio_extract"
}

/**
 * 异步初始化预设。
 *
 * 预设定义全部来自 YAML 分层（低 → 高优先级，见 §2.1）：
 *   1. 包内 presets/default.yaml（内置层，单源）
 *   2. ~/.mediac/presets.yaml|yml（用户全局层）
 *   3. cwd/presets.yaml|yml（项目局部层）
 * 同名覆盖必须显式 `_override: true`，否则 warn 跳过（P0-1 修复）。
 *
 * @param {string} customPath - 自定义 YAML 文件路径（仅加载该文件，不走分层）
 * @returns {Promise<void>}
 */
async function initPresetsAsync(customPath = null) {
    const layers = await loadPresetLayers(customPath)
    let merged = new Map()
    for (const layer of layers) {
        merged = mergePresets(merged, layer)
    }
    PRESET_NAMES.length = 0
    PRESET_MAP.clear()
    for (const [name, preset] of merged) {
        const fp = new FFmpegPreset(name, preset)
        PRESET_NAMES.push(name)
        PRESET_MAP.set(name, fp)
    }
}

/**
 * 获取预设加载路径列表（含包内 default.yaml 与用户层搜索路径）
 * @returns {string[]}
 */
function getPresetPaths() {
    return getPresetSearchPaths()
}

/**
 * 参数别名映射
 * 用于 ffargs 复合参数的别名转换
 */
const ARG_ALIASES = {
    vb: "videoBitrate",
    vbit: "videoBitrate",
    vbk: "videoBitrate",
    vbitrate: "videoBitrate",
    vq: "videoQuality",
    vquality: "videoQuality",
    // vc/vcodec 表示视频编码器（codec），而非流复制。
    // 此前误映射为 videoCopy，导致 `--ffargs "vc=h264"` 静默得到 `-c:v copy`。
    // 流复制请使用 --video-copy / --audio-copy 专用选项。
    vc: "videoCodec",
    vcodec: "videoCodec",
    ab: "audioBitrate",
    abit: "audioBitrate",
    abk: "audioBitrate",
    abitrate: "audioBitrate",
    aq: "audioQuality",
    aquality: "audioQuality",
    // ac/acodec 表示音频编码器（codec），理由同上
    ac: "audioCodec",
    acodec: "audioCodec",
    px: "prefix",
    pf: "prefix",
    sx: "suffix",
    sf: "suffix",
    sp: "speed",
    dm: "dimension",
    fps: "framerate",
    md: "metadata",
    meta: "metadata",
    metadata: "metadata",
}

/**
 * 参数优先级说明:
 * 1. 预设默认值 (最低优先级)
 * 2. ffargs 复合参数
 * 3. 命令行单独参数 (最高优先级)
 */

/**
 * 从 ffargs 对象应用参数到 argv
 * 优先级: 命令行单独参数 > ffargs 复合参数 > 预设默认值
 *
 * @param {Object} argv - 命令行参数对象
 * @param {Object} ffargs - 解析后的 ffargs 对象
 * @returns {Object} 合并后的 argv
 */
function applyFfargs(argv, ffargs) {
    if (!ffargs || typeof ffargs !== "object") {
        return argv
    }

    const result = { ...argv }

    for (const [key, value] of Object.entries(ffargs)) {
        const normalizedKey = ARG_ALIASES[key] || key

        if (value === null || value === undefined || value === "") {
            continue
        }

        // 命令行参数优先级最高，如果已设置则跳过
        //
        // 注意：判定必须是「用户是否真的提供了值」，而不能只看 !== undefined/null。
        // cmd_ffmpeg.js 的数值选项全部声明了 `default: 0`，yargs 会把未提供的项填成 0，
        // 而 `0 !== undefined && 0 !== null` 恒为真 —— 于是 ffargs 的
        // vb/vq/ab/aq/dm/sp/fps 七个数值别名会被无条件丢弃，且无任何提示。
        // 这里把数值型的 0 视为"未提供"（这些选项的有效取值都 > 0）。
        const raw = result[normalizedKey]
        const hasArgvValue =
            raw !== undefined && raw !== null && !(typeof raw === "number" && raw === 0)

        if (normalizedKey === "videoBitrate" || normalizedKey === "audioBitrate") {
            if (!hasArgvValue && typeof value === "number" && value > 0) {
                result[normalizedKey] = value
            }
        } else if (
            normalizedKey === "videoQuality" ||
            normalizedKey === "audioQuality" ||
            normalizedKey === "dimension" ||
            normalizedKey === "framerate"
        ) {
            if (!hasArgvValue && typeof value === "number" && value > 0) {
                result[normalizedKey] = value
            }
        } else if (normalizedKey === "speed") {
            if (!hasArgvValue && typeof value === "number" && value > 0) {
                result[normalizedKey] = value
            }
        } else if (normalizedKey === "videoCopy" || normalizedKey === "audioCopy") {
            if (!hasArgvValue) {
                result[normalizedKey] = Boolean(value)
            }
        } else if (normalizedKey === "videoCodec" || normalizedKey === "audioCodec") {
            // 编码器名称（如 h264_nvenc / libfdk_aac / copy）
            if (!hasArgvValue && typeof value === "string" && value.length > 0) {
                result[normalizedKey] = value
            }
        } else if (normalizedKey === "prefix" || normalizedKey === "suffix") {
            if (!hasArgvValue && typeof value === "string") {
                result[normalizedKey] = value
            }
        } else if (normalizedKey === "preset") {
            if (!hasArgvValue && typeof value === "string") {
                result.preset = value
            }
        } else if (normalizedKey === "metadata") {
            // metadata 支持：合并多个 metadata key=value（逗号分隔）
            if (typeof value === "string" && value.length > 0) {
                const existing = result.metadata || ""
                result.metadata = existing ? `${existing},${value}` : value
            }
        } else {
            // 非白名单参数：warn 提示，不静默丢弃
            console.warn(
                `Unknown ffargs key: "${key}". Valid keys: ${Object.keys(ARG_ALIASES).join(", ")}. Use --arg for advanced parameters.`,
            )
        }
    }

    return result
}

/**
 * 替换 ffmpeg 参数串中的编解码器
 *
 * 用于支持 `--ffargs "vc=h264_nvenc"` 这类"指定编码器"的写法。
 * - 若参数串中已有 `-c:v <codec>`（或 `-c:a`），替换其值；
 * - 若没有，则把 `-c:v <codec>` 前置到参数串开头。
 * 特殊值 "copy" 直接生成流复制参数（与 --video-copy 等价）。
 *
 * @param {string} args - 原始参数串，如 "-c:v h264_nvenc -rc vbr"
 * @param {string} stream - 流类型，"v" 或 "a"
 * @param {string} codec - 目标编码器名，如 "h264_nvenc" / "libfdk_aac" / "copy"
 * @returns {string} 替换后的参数串
 */
function replaceCodecInArgs(args, stream, codec) {
    const flag = `-c:${stream}`
    const str = typeof args === "string" ? args : ""
    // 匹配 -c:v <name>，同时兼容 -codec:v <name>
    const re = new RegExp(`(-c(?:odec)?:${stream}\\s+)(\\S+)`)
    if (re.test(str)) {
        return str.replace(re, `$1${codec}`)
    }
    return `${flag} ${codec}${str ? " " + str : ""}`
}

/**
 * 从命令行参数创建预设
 * 深拷贝基础预设，并根据命令行参数进行覆盖和修改
 *
 * @param {Object} argv - 命令行参数对象
 * @returns {FFmpegPreset} 配置好的预设对象
 */
function createFromArgv(argv) {
    // 参数中指定的preset
    let preset = getPreset(argv.preset)
    // 克隆对象，不修改Map中的内容
    preset = structuredClone(preset)
    // 前缀可以为空字符串
    if (typeof argv.prefix === "string") {
        preset.prefix = argv.prefix
    }
    // 后缀可以为空字符串
    if (typeof argv.suffix === "string") {
        preset.suffix = argv.suffix
    }
    if (typeof argv.videoArgs === "string") {
        preset.videoArgs = argv.videoArgs
    }
    if (typeof argv.audioArgs === "string") {
        preset.audioArgs = argv.audioArgs
    }
    if (typeof argv.filters === "string") {
        preset.filters = argv.filters
    }
    if (typeof argv.filterComplex === "string") {
        preset.complexFilter = argv.filterComplex
    }
    // 视频编码器（来自 ffargs 的 vc/vcodec 或 --video-codec）：
    // T4 起不再写入 videoArgs（Phase 2 已移除含 -c:v 的 videoArgs，写入会被整体忽略 + warn），
    // 编码器由 userArgs.videoCodec 携带着穿透到 buildEncoderArgs（forcedEncoder）。
    // 这样显式 encoder 时探测命令用同一编码器，且不会触发"旧式 videoArgs 被忽略"的警告。
    if (typeof argv.videoCodec === "string" && argv.videoCodec.length > 0) {
        preset.userArgs.videoCodec = argv.videoCodec
    }
    // 音频编码器（来自 ffargs 的 ac/acodec）：替换 audioArgs 中的 -c:a 值
    if (typeof argv.audioCodec === "string" && argv.audioCodec.length > 0) {
        preset.audioArgs = replaceCodecInArgs(preset.audioArgs, "a", argv.audioCodec)
        preset.userArgs.audioCodec = argv.audioCodec
    }
    // 输出目录
    if (typeof argv.output === "string") {
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
        // T4 修复：不再写 videoArgs="-c:v copy"（Phase 2 起含 -c:v 的 videoArgs 被整体忽略 + warn，
        // 导致 --video-copy 静默失效、输出 libx264）。copy 语义改由 userArgs.videoCodec="copy"
        // 承载，buildVideoArgsFromPlan 读到 copy 时直接输出 ["-c:v","copy"]。
        preset.userArgs.videoCodec = "copy"
        preset.userArgs.videoCopy = true
        // copy not compatible with filters
        preset.filters = ""
        preset.complexFilter = ""
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
        preset.audioArgs = "-c:a copy"
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
    // --arg 位置标记参数解析（新增）
    if (argv.arg && Array.isArray(argv.arg) && argv.arg.length > 0) {
        preset.userArgs.argOptions = parseArgOptions(argv.arg)
    }
    // --ffargs metadata 支持（新增）
    if (argv.metadata && typeof argv.metadata === "string" && argv.metadata.length > 0) {
        // 支持多组 metadata key=value，以逗号分隔
        const metaPairs = argv.metadata.split(",").map((s) => s.trim())
        for (const pair of metaPairs) {
            if (pair.includes("=")) {
                if (!preset.userArgs.argOptions) {
                    preset.userArgs.argOptions = {
                        input: [],
                        output: [],
                        global: [],
                        video: {},
                        audio: [],
                        filter: { pre: [], post: [] },
                    }
                }
                preset.userArgs.argOptions.output.push("-metadata", pair)
            }
        }
    }
    return preset
}

export default {
    UNIT_KB,
    UNIT_MB,
    FFmpegPreset,
    createFromArgv,
    getPreset,
    getAllPresets,
    getAllNames,
    isAudioExtract,
    initPresetsAsync,
    getPresetPaths,
    applyFfargs,
    ARG_ALIASES,
}
