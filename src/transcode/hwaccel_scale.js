/*
 * File: hwaccel_scale.js
 * Created: 2026-09-26
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * 硬件加速尺寸计算、滤镜串生成与位深对齐判定（纯计算，无外部进程依赖）
 */

import { depthClassOf } from "../../lib/media_parser.js"

/** speed 允许范围（产品决策：只允许 0.5–2.0） */
export const SPEED_MIN = 0.5
export const SPEED_MAX = 2.0

// ---------------------------------------------------------------------------
// 尺寸计算
// ---------------------------------------------------------------------------

/**
 * 对齐到偶数（四舍五入后取偶）
 *
 * ⚠️ 实测结论：ffmpeg 的 scale 滤镜用「四舍五入」而非向下取整。
 *    1920x1080 → D=1080 时 607.5 取 608（不是 606）
 *    4096x2160 → D=1080 时 569.53 取 570（不是 568）
 *    因此这里必须用 Math.round，否则与滤镜实际行为不一致。
 */
export function toEven(x) {
    const v = Math.round(x)
    return v - (v % 2)
}

/**
 * 按「长边 = dimension」计算输出尺寸
 *
 * 规则：
 *   1. dimension 是长边，短边按原始宽高比推导
 *   2. 禁止放大：目标长边 = min(D, 源长边)
 *   3. 宽高均对齐到偶数（四舍五入，与 ffmpeg scale 一致）
 *
 * @param {number} srcW 输入宽
 * @param {number} srcH 输入高
 * @param {number} dimension 目标长边
 * @returns {{w:number,h:number}}
 */
export function calcLongEdge(srcW, srcH, dimension) {
    if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
        throw new Error(`calcLongEdge: invalid source size ${srcW}x${srcH}`)
    }
    if (!Number.isFinite(dimension) || dimension <= 0) {
        throw new Error(`calcLongEdge: invalid dimension ${dimension}`)
    }
    // 禁止放大：目标长边不超过源长边
    const target = Math.min(dimension, Math.max(srcW, srcH))
    if (srcW >= srcH) {
        // 横屏 / 正方形：宽是长边
        return { w: toEven(target), h: toEven((srcH * target) / srcW) }
    }
    // 竖屏：高是长边
    return { w: toEven((srcW * target) / srcH), h: toEven(target) }
}

// ---------------------------------------------------------------------------
// 滤镜串生成
// ---------------------------------------------------------------------------

/**
 * 校验 speed 范围
 * 产品决策：只允许 0.5–2.0，因此 atempo 无需链式拆分
 * （atempo 原生范围为 [0.5, 100]，0.5 恰好是下限）
 *
 * 注意：0 与 undefined/null 均表示「不变速」，返回 1（保持原速）。
 * 现有 CLI 的 --speed 默认值是 0，必须视为不变速，否则会误报范围错误。
 */
export function validateSpeed(speed) {
    if (speed === undefined || speed === null || speed === 0 || speed === 1) return 1
    const v = Number(speed)
    if (!Number.isFinite(v)) {
        throw new Error(`invalid speed: ${speed}`)
    }
    if (v < SPEED_MIN || v > SPEED_MAX) {
        throw new Error(`speed out of range [${SPEED_MIN}, ${SPEED_MAX}]: ${speed}`)
    }
    return v
}

/**
 * 生成缩放滤镜串
 *
 * ⚠️ filterArgs 可能是「选项 + 逗号分隔的尾部独立滤镜」混合串：
 *   cuda 层 = `"interp_algo=lanczos,format=cuda"` —— 逗号前是 scale_cuda 的选项，
 *   逗号后是**独立的 format 滤镜**（保持硬件帧的 no-op）。
 *   因此本函数按逗号拆分：选项段参与拼接，尾部滤镜原样保留。
 *
 * @param {object} tier TIERS 中的一层
 * @param {{w:number,h:number}} size calcLongEdge 的结果
 * @param {string} [swFormat] 位深对齐用的输出**选项**格式（如 "nv12"），见 scaleFormatOverride
 * @returns {string} 如 "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda"
 */
export function buildScaleFilter(tier, size, swFormat) {
    const parts = []
    // size 为 null：只做格式对齐、不做缩放（w/h 缺省 = iw/ih，scale_cuda/scale_qsv 均如此）。
    // 用在场次：任务本身不需要缩放，但 10bit 源 + h264 目标必须换格式（见 scaleFormatOverride），
    // 否则缩波段被整段跳过 → 硬件编码器打不开 10bit 帧 → 白落 libx264。
    if (size) {
        parts.push(`w=${size.w}`, `h=${size.h}`)
    }
    const [opts = "", ...trailing] = String(tier.filterArgs || "").split(",")
    if (opts) parts.push(opts)
    if (swFormat) parts.push(`format=${swFormat}`)
    if (parts.length === 0) return ""
    const head = `${tier.filter}=${parts.join(":")}`
    return trailing.length > 0 ? `${head},${trailing.join(",")}` : head
}

/**
 * scale 滤镜的输出格式覆盖（10bit 源 + h264 目标的位深对齐）
 *
 * ⚠️ 背景（实测：docs/ffmpeg/ffmpeg-hwaccel-support-matrix-20260921.md §3.1）：
 *   h264 硬件编码器（h264_nvenc / h264_qsv）**不吃 10bit 输入** ——
 *   `-h encoder=h264_nvenc` 的格式列表里虽列出 p010le，但驱动不支持，报
 *   `Nothing was written into output file`。于是「10bit 源 + h264 预设」在引入本函数前
 *   是**整链探测失败落 libx264**（即便 NVDEC/QSV 能硬解、NVENC/QSV 能编 8bit h264，
 *   实测 27.7x vs 10.9x 的差距就这样丢掉）。
 *
 * 解法：把 10bit→8bit 的转换放进 scale 的 `format=nv12` **选项**。三种写法的实测差异：
 *   `scale_cuda=w=..:h=..:format=nv12`  输出仍是硬件帧（sw_format 变 nv12，**0 拷贝**）✓
 *   `scale_cuda=..,format=nv12`         独立 format 滤镜，要求出显存 → Impossible to convert
 *   `-pix_fmt nv12`                     同样要求出显存 → 失败
 *   性能实测（4K→1080p h264_nvenc）：`:format=nv12` 16.5x ≈ 0 拷贝基准 16.3x，2 拷贝路径 6.92x。
 *
 * 适用范围：仅 cuda/qsv（硬件帧链路），且仅在本函数生效。
 * ⚠️ 已知局限（勿按注释臆断）：d3d / cpu 层同样会受"10bit 源 + h264 目标"影响，
 *    但 buildEncoderArgs 的 `-pix_fmt yuv420p` 目前**只注入 swdec 层**：
 *      - d3d 层：探测必然失败一次后降级（结果可接受，仅多耗一次探测）；
 *      - cpu 层：libx264 会产出 High 10 profile（部分播放器兼容性差）。
 *    需要覆盖这两层时请显式用 `--decode-mode cpu` + 8bit 源，或改用 hevc 族预设。
 *    hevc 族编码器可直接吃 p010/p012，无需覆盖。
 *
 * @param {object} tier
 * @param {object} [src]
 * @param {string} [src.codecFamily] 输出 codec 族（h264 才需要对齐）
 * @param {string} [src.pixFmt] 源像素格式
 * @param {number|string} [src.bitDepth] 显式位深（mediainfo 的 BitDepth）
 * @returns {string|undefined} "nv12" 或 undefined（不需要覆盖）
 */
export function scaleFormatOverride(tier, { codecFamily = "h264", pixFmt, bitDepth } = {}) {
    if (!tier || (tier.name !== "cuda" && tier.name !== "qsv")) return undefined
    if (codecFamily !== "h264") return undefined
    return needsDepthAlign(pixFmt, bitDepth) ? "nv12" : undefined
}

/**
 * 是否需要对位深做"对齐到 8bit"（10bit 源喂 h264 硬件编码器的前提）
 *
 * ⚠️ **位深未知时按"需要对齐"处理（保守方向）**——实测驱动的取舍：
 *   - 对齐动作对 8bit 源是**无副作用**的：swdec 的 `-pix_fmt yuv420p` 对 8bit 源本就是
 *     目标格式；cuda/qsv 的 `scale_*:format=nv12` 对 8bit 源本就是硬件帧的自然 sw_format
 *     （实测 8bit 全链路性能无差异）；
 *   - 反过来（10bit 当 8bit）会直接 `Error while opening encoder` 整层失败；
 *   - 未知位深的来源真实存在：ffprobe `bits_per_raw_sample` 缺失 68%、
 *     mediainfo `BitDepth` 缺失 3.9%（真实片库）/ 11.5%（测试集）。
 *
 * @param {string} [pixFmt] 源像素格式（mediainfo 路径可能是 "YUV4:2:0"）
 * @param {number|string} [bitDepth] 显式位深（mediainfo `BitDepth` / ffprobe `bits_per_raw_sample`）
 */
export function needsDepthAlign(pixFmt, bitDepth) {
    return depthClassOf(pixFmt, bitDepth) !== "8"
}

/**
 * 组装完整视频滤镜链（三段式：preFilters → setpts → scale → fps → postFilters）
 *
 * 顺序：preFilters（用户缩放前，如反交错） → setpts（变速） → scale（缩放）
 *      → fps（帧率） → postFilters（用户缩放后，如锐化）
 * 实测依据：docs/S-4-SCALE-PARAMS-20260920.md 2.5.3 节
 *
 * 本函数是滤镜链的**唯一组装源**：探测命令（buildLayerArgs）与真实命令
 * （ffmpeg_build.buildScaleFiltersFromPlan）都基于它生成，杜绝"探测用 tier 组装、
 * 真实用字面量"的错位。探测路径不传 preFilters/postFilters，行为与旧版一致。
 *
 * @param {object} opts
 * @param {object} opts.tier 层级定义
 * @param {{w:number,h:number}} opts.size 目标尺寸
 * @param {number} [opts.speed] 变速倍率（0.5–2.0）
 * @param {number} [opts.framerate] 目标帧率
 * @param {string} [opts.preFilters] 缩放前滤镜段（三段式，可选）
 * @param {string} [opts.postFilters] 缩放后滤镜段（三段式，可选）
 * @param {boolean} [opts.hasScale] 是否生成 scale 段（默认 true；尺寸未达标且无需改帧率时可由调用方关掉）
 * @returns {string}
 */
export function buildVideoFilters({
    tier,
    size,
    speed,
    framerate,
    preFilters = "",
    postFilters = "",
    hasScale = true,
    codecFamily = "h264",
    pixFmt,
    bitDepth,
}) {
    const chain = []
    // ⚠️ D3（实测）：硬件解码层（帧留在显存：cuda / qsv）一旦要跑**软件滤镜**（pre/post），
    //   必须先把帧下载一次到系统内存、缩放改用软件 scale，之后滤镜/编码在内存域进行
    //   （nvenc 会自己把内存帧上传）。否则 `scale_cuda` 的 cuda 帧喂不进软件滤镜：
    //   "Impossible to convert between ... cuda ..."；而 hwdownload 后再手动 hwupload
    //   又需设备上下文（"A hardware device reference is required"），故不走上传往返。
    const vramFrames = tier.hwFormat === "cuda" || tier.hwFormat === "qsv"
    const swDomain = vramFrames && !!(preFilters || postFilters)
    if (swDomain) {
        chain.push("hwdownload", "format=nv12")
    }
    if (preFilters) {
        chain.push(preFilters)
    }
    const sp = validateSpeed(speed)
    if (sp !== 1) {
        chain.push(`setpts=PTS/${sp}`)
    }
    if (swDomain) {
        // 缩放改软件 scale（保持偶数尺寸），不再有硬件缩放段
        if (hasScale && size) {
            chain.push(`scale=w=${size.w}:h=${size.h}:flags=lanczos`)
        }
    } else if (tier.requiresFilter) {
        // 10bit 源 + h264 目标：把位深转换放进 scale 的 format 选项（帧不出显存，
        // 见 scaleFormatOverride）。探测与真实命令共用本函数，保证同构。
        // ⚠️ 需要对齐时**即使不需要缩放也要输出**（size 传 null → 只换格式不做 1:1 重采样之外的
        //   尺寸变化；实测 1:1 成本 ~1%），否则「无需缩放」的任务会漏掉对齐而落回 libx264。
        const swFormat = scaleFormatOverride(tier, { codecFamily, pixFmt, bitDepth })
        if (hasScale || swFormat) {
            const filter = buildScaleFilter(tier, hasScale ? size : null, swFormat)
            if (filter) chain.push(filter)
        }
    }
    if (framerate && framerate > 0) {
        chain.push(`fps=${framerate}`)
    }
    if (postFilters) {
        chain.push(postFilters)
    }
    return chain.join(",")
}

/**
 * 组装音频滤镜串（变速）
 *
 * 因 speed 限制在 [0.5, 2.0]，与 atempo 原生范围 [0.5, 100] 兼容，
 * 无需链式拆分。
 *
 * @param {number} speed
 * @returns {string} 如 "atempo=1.5"，speed=1 时返回空串
 */
export function buildAudioFilters(speed) {
    const sp = validateSpeed(speed)
    return sp === 1 ? "" : `atempo=${sp}`
}
