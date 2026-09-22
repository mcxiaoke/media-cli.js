/*
 * Phase 2 滤镜三段式 + complexFilter 模板化 + -c:v 移除的单测
 *
 * 覆盖：
 *   - splitPresetFilterSegments：旧 filters 占位符拆分 / 无占位符归 pre / 显式字段优先
 *   - buildScaleFiltersFromPlan：三段式组装、scale 生成条件、无 tier 不泄漏占位符
 *   - resolveComplexFilterScale：{scaleFilter} 按 tier 替换、无 tier 剔除占位符
 *   - buildVideoArgsFromPlan：含 -c:v 的旧式 videoArgs 整体忽略、无 -c:v 时作为额外参数
 *   - buildVideoFilters（hwaccel.js）：pre/post/hasScale 参数
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    buildScaleFiltersFromPlan,
    buildVideoArgsFromPlan,
    resolveComplexFilterScale,
    splitPresetFilterSegments,
} from "../lib/ffmpeg_build.js"
import { buildVideoFilters } from "../lib/hwaccel.js"
import { TIERS } from "../lib/hwaccel.js"

const cudaTier = TIERS.find((t) => t.name === "cuda")
const cpuTier = TIERS.find((t) => t.name === "cpu")
const size = { w: 1920, h: 1080 }

/** 构造极简 entry：buildScaleFiltersFromPlan 只用到 info/dstArgs/preset
 *  ⚠️ pixelFormat 必须是**可识别的 8bit**：位深未知时会触发「保守按 10bit 对齐」
 *  （给 scale 加 `:format=nv12`），那些用例断言的是链路结构而非对齐，故给 8bit 源。
 *  对齐行为本身另有专门用例（见文件末尾 describe）。 */
const makeEntry = (over = {}) => ({
    info: { video: { width: 3840, height: 2160, pixelFormat: "yuv420p" } },
    dstArgs: { scaled: false },
    preset: { dimension: 1920 },
    path: "/tmp/in.mp4",
    name: "in",
    argv: { debug: false, strict: false },
    ...over,
})

const makeHwPlan = (tier, size) => ({ tier, size })

describe("splitPresetFilterSegments", () => {
    it("pure placeholder: filters is {scaleFilter}", () => {
        const r = splitPresetFilterSegments({ filters: "{scaleFilter}" })
        assert.strictEqual(r.pre, "")
        assert.strictEqual(r.post, "")
        assert.strictEqual(r.scaleRequested, true)
    })

    it("legacy split: 'xxx,{scaleFilter}' -> pre=xxx", () => {
        const r = splitPresetFilterSegments({ filters: "yadif=1,{scaleFilter}" })
        assert.strictEqual(r.pre, "yadif=1")
        assert.strictEqual(r.post, "")
        assert.strictEqual(r.scaleRequested, true)
    })

    it("legacy split: '{scaleFilter},yyy' -> post=yyy", () => {
        const r = splitPresetFilterSegments({ filters: "{scaleFilter},unsharp=luma_msize_x=3" })
        assert.strictEqual(r.pre, "")
        assert.strictEqual(r.post, "unsharp=luma_msize_x=3")
        assert.strictEqual(r.scaleRequested, true)
    })

    it("legacy split: 'xxx,{scaleFilter},yyy' -> pre/post both", () => {
        const r = splitPresetFilterSegments({ filters: "yadif=1,{scaleFilter},unsharp=3" })
        assert.strictEqual(r.pre, "yadif=1")
        assert.strictEqual(r.post, "unsharp=3")
        assert.strictEqual(r.scaleRequested, true)
    })

    it("no placeholder: whole filters treated as pre (P1-1: keep user filters)", () => {
        const r = splitPresetFilterSegments({ filters: "yadif=1" })
        assert.strictEqual(r.pre, "yadif=1")
        assert.strictEqual(r.post, "")
        assert.strictEqual(r.scaleRequested, false)
    })

    it("explicit pre_filters/post_filters take priority over legacy segments", () => {
        const r = splitPresetFilterSegments({
            pre_filters: "yadif=1",
            post_filters: "unsharp=3",
            filters: "old_pre,{scaleFilter},old_post",
        })
        assert.strictEqual(r.pre, "yadif=1")
        assert.strictEqual(r.post, "unsharp=3")
        assert.strictEqual(r.scaleRequested, true)
    })

    it("edge commas stripped", () => {
        const r = splitPresetFilterSegments({ filters: "yadif=1,,{scaleFilter}," })
        assert.strictEqual(r.pre, "yadif=1")
        assert.strictEqual(r.post, "")
    })
})

describe("buildScaleFiltersFromPlan (three-segment)", () => {
    it("tier + pre/post: assembles yadif -> scale_cuda -> unsharp", () => {
        const tp = { filters: "yadif=1,{scaleFilter},unsharp=3", speed: 1, framerate: 0 }
        const out = buildScaleFiltersFromPlan(
            makeEntry({ dstArgs: { scaled: true } }),
            makeHwPlan(cudaTier, size),
            tp,
        )
        assert.strictEqual(
            out,
            "yadif=1,scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda,unsharp=3",
        )
    })

    it("speed+framerate injected at correct positions (setpts before scale, fps after)", () => {
        const tp = { filters: "yadif=1,{scaleFilter}", speed: 1.5, framerate: 25 }
        const out = buildScaleFiltersFromPlan(
            makeEntry({ dstArgs: { scaled: true } }),
            makeHwPlan(cudaTier, size),
            tp,
        )
        assert.strictEqual(
            out,
            "yadif=1,setpts=PTS/1.5,scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda,fps=25",
        )
    })

    it("cpu tier outputs cpu scale=", () => {
        const tp = { filters: "{scaleFilter}", speed: 1, framerate: 0 }
        const out = buildScaleFiltersFromPlan(
            makeEntry({ dstArgs: { scaled: true } }),
            makeHwPlan(cpuTier, size),
            tp,
        )
        assert.strictEqual(out, "scale=w=1920:h=1080:flags=lanczos")
    })

    it("no scale needed: user-only filters keep, no extra same-size scale (P1-1)", () => {
        const tp = { filters: "yadif=1", speed: 1, framerate: 0 }
        const out = buildScaleFiltersFromPlan(
            makeEntry({ dstArgs: { scaled: false } }),
            makeHwPlan(cudaTier, size),
            tp,
        )
        assert.strictEqual(out, "yadif=1")
    })

    it("placeholder preset -> scale generated (占位符=声明要缩放；纯占位符且无缩放任务的场景由 buildFilterArgs 外层拦截，不会走到这里)", () => {
        const tp = { filters: "{scaleFilter}", speed: 1, framerate: 0 }
        const out = buildScaleFiltersFromPlan(
            makeEntry({ dstArgs: { scaled: false } }),
            makeHwPlan(cudaTier, size),
            tp,
        )
        assert.strictEqual(out, "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda")
    })

    it("no tier: placeholder never leaks, user filters kept", () => {
        const tp = { filters: "yadif=1,{scaleFilter},unsharp=3", speed: 1, framerate: 0 }
        const out = buildScaleFiltersFromPlan(makeEntry({ dstArgs: { scaled: true } }), null, tp)
        assert.ok(!out.includes("{scaleFilter}"), "placeholder must not leak")
        assert.strictEqual(out, "yadif=1,unsharp=3")
    })

    it("fps still applied when no tier", () => {
        const tp = { filters: "yadif=1", speed: 1, framerate: 10 }
        const out = buildScaleFiltersFromPlan(makeEntry({ dstArgs: { scaled: false } }), null, tp)
        assert.strictEqual(out, "yadif=1,fps=10")
    })
})

describe("resolveComplexFilterScale (hevc_speed template)", () => {
    const tmpl = "[0:v]setpts=PTS/1.5,{scaleFilter},fps=30[v];[0:a]atempo=1.5[a]"

    it("replaces {scaleFilter} with tier scale", () => {
        const out = resolveComplexFilterScale(tmpl, makeHwPlan(cudaTier, size), makeEntry(), {})
        assert.strictEqual(
            out,
            "[0:v]setpts=PTS/1.5,scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda,fps=30[v];[0:a]atempo=1.5[a]",
        )
    })

    it("no tier: placeholder removed, no literal leak", () => {
        const out = resolveComplexFilterScale(tmpl, null, makeEntry(), {})
        assert.ok(!out.includes("{scaleFilter}"), "placeholder must not leak")
        assert.ok(!out.includes("scale_cuda"), "hardcoded scale must not appear")
        assert.ok(out.includes("fps=30"), "rest of template preserved")
    })

    it("plain complexFilter without placeholder untouched", () => {
        const raw = "[0:v]null[v];[0:a]anull[a]"
        assert.strictEqual(
            resolveComplexFilterScale(raw, makeHwPlan(cudaTier, size), makeEntry(), {}),
            raw,
        )
    })
})

describe("buildVideoArgsFromPlan (-c:v removal)", () => {
    it("legacy videoArgs with -c:v ignored entirely, tier encoder used", () => {
        const tp = {
            videoArgs: "-c:v libx264 -preset slow",
            videoQuality: 28,
            videoCodecFamily: "h264",
        }
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier, size), tp)
        assert.ok(Array.isArray(out))
        assert.ok(!out.includes("libx264"), "old encoder must not appear")
        assert.ok(out.includes("h264_nvenc"), "tier encoder used")
        assert.ok(!out.some((a) => a === "-preset"), "whole videoArgs ignored (no stray preset)")
    })

    it("hw-independent videoArgs appended after tier encoder args", () => {
        const tp = { videoArgs: "-pix_fmt yuv420p", videoQuality: 28, videoCodecFamily: "hevc" }
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier, size), tp)
        assert.ok(out.includes("hevc_nvenc"))
        assert.deepStrictEqual(out.slice(-2), ["-pix_fmt", "yuv420p"])
    })

    it("no tier -> null (not part of this path)", () => {
        const out = buildVideoArgsFromPlan(makeEntry(), null, { videoArgs: "-x 1" })
        assert.strictEqual(out, null)
    })
})

describe("buildVideoFilters (hwaccel.js) three-segment support", () => {
    it("preFilters/postFilters/hasScale=false compose correctly", () => {
        const out = buildVideoFilters({
            tier: cudaTier,
            size,
            speed: 1.5,
            framerate: 25,
            preFilters: "yadif=1",
            postFilters: "unsharp=3",
            hasScale: false,
            // 8bit 源：无缩放 + 无对齐需求 → 不应出现在场滤镜（10bit/未知位深时会输出
            // 一个只做格式对齐的 scale，见文件末尾 describe）
            codecFamily: "h264",
            pixFmt: "yuv420p",
        })
        assert.strictEqual(out, "yadif=1,setpts=PTS/1.5,fps=25,unsharp=3")
    })

    it("default hasScale=true keeps legacy behavior (probe path unchanged)", () => {
        const out = buildVideoFilters({
            tier: cudaTier,
            size,
            speed: 1,
            framerate: 0,
            codecFamily: "h264",
            pixFmt: "yuv420p",
        })
        assert.strictEqual(out, "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda")
    })
})

describe("位深对齐（10bit 源 + h264 目标 → scale 的 format=nv12）", () => {
    // 实测依据 docs/ffmpeg/ffmpeg-metadata-fields-20260922.md §7.4：
    // h264 硬件编码器不吃 10bit 输入；对齐动作对 8bit 源无副作用，故**未知位深取保守方向**。
    const base = { tier: cudaTier, size, speed: 1, framerate: 0, codecFamily: "h264" }

    it("8bit 源：不加对齐（与历史行为一致）", () => {
        const out = buildVideoFilters({ ...base, pixFmt: "yuv420p" })
        assert.strictEqual(out, "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda")
        // 显式 8bit 位深同样不触发
        const out2 = buildVideoFilters({ ...base, pixFmt: "YUV4:2:0", bitDepth: 8 })
        assert.ok(!out2.includes("format=nv12"), out2)
    })

    it("10bit 源（pix_fmt 后缀）→ 加 :format=nv12", () => {
        const out = buildVideoFilters({ ...base, pixFmt: "yuv420p10le" })
        assert.ok(out.includes(":format=nv12"), out)
    })

    it("10bit 源（mediainfo 路径：pixelFormat 不含位深，靠 bitDepth）→ 加 :format=nv12", () => {
        const out = buildVideoFilters({ ...base, pixFmt: "YUV4:2:0", bitDepth: 10 })
        assert.ok(out.includes(":format=nv12"), out)
    })

    it("位深未知（无 pix_fmt 也无 bitDepth）→ 保守加 :format=nv12", () => {
        const out = buildVideoFilters({ ...base, pixFmt: "", bitDepth: undefined })
        assert.ok(out.includes(":format=nv12"), out)
    })

    it("hevc 目标不需要对齐（hevc 编码器可直接吃 p010）", () => {
        const out = buildVideoFilters({ ...base, codecFamily: "hevc", pixFmt: "yuv420p10le" })
        assert.ok(!out.includes("format=nv12"), out)
    })

    it("buildScaleFiltersFromPlan 也带对齐（真实链路入口）", () => {
        const out = buildScaleFiltersFromPlan(
            makeEntry({
                info: {
                    video: { width: 3840, height: 2160, pixelFormat: "YUV4:2:0", bitDepth: 10 },
                },
            }),
            makeHwPlan(cudaTier, size),
            { dimension: 1920 },
        )
        assert.ok(out.includes(":format=nv12"), out)
    })
})
