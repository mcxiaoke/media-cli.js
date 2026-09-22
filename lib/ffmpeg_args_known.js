/**
 * 已知 FFmpeg 参数列表
 * 用于 --arg 位置标记参数的合法性验证
 * 不需要完整，只需要覆盖常见参数；未知参数 warn 但不阻止执行（ffmpeg 会自行报错）
 */

export const KNOWN_FFMPEG_ARGS = new Set([
    // 全局选项
    "-y",
    "-n",
    "-nostats",
    "-benchmark",
    "-hide_banner",
    "-loglevel",
    "-report",
    "-init_hw_device",
    "-filter_hw_device",
    // 输入选项
    "-ss",
    "-t",
    "-to",
    "-f",
    "-r",
    "-ar",
    "-ac",
    "-hwaccel",
    "-hwaccel_device",
    "-itsoffset",
    "-stream_loop",
    "-thread_queue_size",
    // 输出-流级
    "-c:v",
    "-c:a",
    "-c:s",
    "-b:v",
    "-b:a",
    "-crf",
    "-preset",
    "-tune",
    "-g",
    "-bf",
    "-pix_fmt",
    "-q",
    "-q:a",
    "-vcodec",
    "-acodec",
    "-scodec",
    "-profile:v",
    "-level",
    "-rc",
    "-rc_lookahead",
    // 输出-容器级
    "-movflags",
    "-metadata",
    "-tag:v",
    "-tag:a",
    "-disposition",
    "-shortest",
    "-dn",
    // 滤镜
    "-vf",
    "-af",
    "-filter_complex",
    "-filter:v",
    "-filter:a",
    "-lavfi",
    // 高级
    "-map",
    "-map_metadata",
    "-codec",
    "-vbsf",
    "-absf",
    "-pass",
    "-passlogfile",
    // 硬件加速（NVENC）
    "-spatial_aq",
    "-temporal_aq",
    "-cbr",
    "-constqp",
    "-cq",
    "-qp",
    "-b_ref_mode",
    "-surfaces",
    // 硬件加速（QSV）
    "-look_ahead",
    "-extbrc",
    "-rdo",
    "-mbbrc",
    "-adaptive_i",
    "-adaptive_b",
    "-async_depth",
    // 硬件加速（AMF）
    "-quality",
    "-header_insertion_spacing",
    "-vbaq",
    "-preanalysis",
    "-enforce_hrd",
    "-max_au_size",
    // 音频
    "-vol",
    "-sample_fmt",
    "-channel_layout",
    "-afade",
    "-atrim",
    // 字幕
    "-sn",
    "-fix_sub_duration",
    "-canvas_size",
    // 其他常用
    "-maxrate",
    "-bufsize",
    "-minrate",
    "-x264opts",
    "-x265opts",
    "-svtav1-params",
    "-svt_vp9_params",
])

/**
 * 合法位置标记
 */
export const VALID_ARG_MARKERS = ["@input", "@output", "@video", "@audio", "@filter", "@global"]

/**
 * 合法 tier 名称
 */
export const VALID_TIER_NAMES = ["cuda", "qsv", "amf", "cpu"]

/**
 * 验证 --arg 参数的位置标记合法性
 * @param {string} arg - --arg 参数值
 * @returns {{valid: boolean, marker: string|null, tier: string|null, rest: string, error: string|null}}
 */
export function validateArgMarker(arg) {
    if (!arg || typeof arg !== "string") {
        return {
            valid: false,
            marker: null,
            tier: null,
            rest: "",
            error: "arg must be a non-empty string",
        }
    }

    // 匹配 @marker[tier] rest 或 @marker rest
    const match = arg.match(/^(@\w+)(?:\[(\w+)\])?\s+(.*)$/)
    if (!match) {
        return {
            valid: false,
            marker: null,
            tier: null,
            rest: arg,
            error: `Invalid --arg format: "${arg}". Expected: @marker params (e.g., --arg "@video -tune film")`,
        }
    }

    const [, marker, tier, rest] = match

    if (!VALID_ARG_MARKERS.includes(marker)) {
        return {
            valid: false,
            marker,
            tier,
            rest,
            error: `Invalid position marker "${marker}". Valid markers: ${VALID_ARG_MARKERS.join(", ")}`,
        }
    }

    if (tier && !VALID_TIER_NAMES.includes(tier)) {
        return {
            valid: false,
            marker,
            tier,
            rest,
            error: `Invalid tier "${tier}" for ${marker}. Valid tiers: ${VALID_TIER_NAMES.join(", ")}`,
        }
    }

    return { valid: true, marker, tier: tier || null, rest, error: null }
}

/**
 * 解析 --arg 参数列表为结构化的 argOptions
 * @param {string[]} argList - --arg 参数数组
 * @param {Function} warn - 警告输出函数
 * @returns {Object} argOptions 结构
 */
export function parseArgOptions(argList, warn = console.warn) {
    const argOptions = {
        input: [],
        output: [],
        global: [],
        video: {},
        audio: [],
        filter: { pre: [], post: [] },
    }

    if (!Array.isArray(argList) || argList.length === 0) {
        return argOptions
    }

    for (const arg of argList) {
        const validation = validateArgMarker(arg)
        if (!validation.valid) {
            throw new Error(validation.error)
        }

        const { marker, tier, rest } = validation
        const tokens = rest.trim().split(/\s+/)

        // 验证参数名（warn 未知参数）
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]
            if (token.startsWith("-")) {
                // 检查是否是已知的 ffmpeg 参数
                const baseArg = token.split(":")[0] // 处理 -c:v -> -c
                if (!KNOWN_FFMPEG_ARGS.has(token) && !KNOWN_FFMPEG_ARGS.has(baseArg)) {
                    warn(
                        `Unknown ffmpeg argument: ${token}. It may be ignored by ffmpeg if invalid.`,
                    )
                }
            }
        }

        switch (marker) {
            case "@input":
                argOptions.input.push(...tokens)
                break
            case "@output":
                argOptions.output.push(...tokens)
                break
            case "@global":
                argOptions.global.push(...tokens)
                break
            case "@audio":
                argOptions.audio.push(...tokens)
                break
            case "@video": {
                const tierKey = tier || "*"
                if (!argOptions.video[tierKey]) {
                    argOptions.video[tierKey] = []
                }
                argOptions.video[tierKey].push(...tokens)
                break
            }
            case "@filter": {
                // 解析 pre=... post=... 语法
                const parts = rest.split(",").map((s) => s.trim())
                for (const part of parts) {
                    if (part.startsWith("pre=")) {
                        argOptions.filter.pre.push(part.slice(4))
                    } else if (part.startsWith("post=")) {
                        argOptions.filter.post.push(part.slice(5))
                    } else {
                        // 无标记的默认作为 post（或可以根据需求调整）
                        argOptions.filter.post.push(part)
                    }
                }
                break
            }
        }
    }

    return argOptions
}
