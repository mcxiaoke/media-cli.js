/*
 * Phase 3 (T4) 专项测试：decoder/encoder 显式指定
 *
 * 覆盖：
 *   - buildVideoArgsFromPlan：userArgs.videoCodec="hevc_nvenc" 穿透 ENCODER_MATRIX
 *     （输出含 hevc_nvenc 与 nvenc 质量参数 -cq；旧式 videoArgs 中的 libx264 不出现）
 *   - userArgs.videoCodec="copy" → 直接返回 ["-c:v","copy"]（--video-copy 回归修复）
 *   - createFromArgv：--video-codec / --video-copy 写 userArgs.videoCodec 且不写 videoArgs
 *   - codecFamilyOfPreset 优先级：显式 encoder 解析 > videoCodecFamily
 *   - candidateTiers：auto 模式下 --hwaccel 作白名单过滤候选层
 *   - probeCacheKey 含 forcedEncoder 段（不同显式编码器不同缓存键）
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import presetsDefault from "../lib/ffmpeg_presets.js"
import { DEFAULT_PRESET_PATH } from "../lib/preset_loader.js"
import { buildVideoArgsFromPlan } from "../lib/ffmpeg_build.js"
import { TIERS, codecFamilyOfPreset, probeCacheKey } from "../lib/hwaccel.js"
import { candidateTiers } from "../lib/hwdetect.js"

const cudaTier = TIERS.find((t) => t.name === "cuda")
const size = { w: 1920, h: 1080 }

/** 构造极简 entry（与 test_ffmpeg_build_filters.js 同构） */
const makeEntry = (over = {}) => ({
    info: { video: { width: 3840, height: 2160, pixelFormat: "" } },
    dstArgs: { scaled: false },
    preset: { dimension: 1920 },
    path: "/tmp/in.mp4",
    name: "in",
    argv: { debug: false, strict: false },
    ...over,
})

const makeHwPlan = (tier, s = size) => ({ tier, size: s })

describe("buildVideoArgsFromPlan (forcedEncoder)", () => {
    it("userArgs.videoCodec=hevc_nvenc: encoder + nvenc quality args used", () => {
        const tp = {
            userArgs: { videoCodec: "hevc_nvenc" },
            videoQuality: 26,
            videoCodecFamily: "h264", // 显式 encoder 优先，family 被解析为 hevc
        }
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.ok(out.includes("hevc_nvenc"), "forced encoder must be used")
        assert.ok(!out.includes("h264_nvenc"), "tier matrix encoder must not appear")
        assert.ok(out.includes("-cq"), "nvenc quality arg present")
        // 26 经 nvenc 标定表映射（示例实测 26 -> 31），只断言存在数值
        const cqIdx = out.indexOf("-cq")
        assert.ok(cqIdx >= 0 && /^\d+$/.test(out[cqIdx + 1]), "nvenc cq value is numeric")
    })

    it("userArgs.videoCodec=copy: returns ['-c:v','copy'] without tier args", () => {
        const tp = { userArgs: { videoCodec: "copy" }, videoQuality: 24, videoCodecFamily: "h264" }
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.deepStrictEqual(out, ["-c:v", "copy"])
    })

    it("forcedEncoder wins over legacy videoArgs with -c:v libx264", () => {
        const tp = {
            userArgs: { videoCodec: "hevc_nvenc" },
            videoArgs: "-c:v libx264 -preset slow",
            videoQuality: 26,
            videoCodecFamily: "h264",
        }
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.ok(out.includes("hevc_nvenc"), "forced encoder used")
        assert.ok(!out.some((a) => a.includes("libx264")), "legacy encoder must not appear")
        assert.ok(!out.some((a) => a === "-preset"), "legacy videoArgs ignored")
    })

    it("forced encoder with libx264: crf quality path", () => {
        const tp = {
            userArgs: { videoCodec: "libx264" },
            videoQuality: 23,
            videoCodecFamily: "h264",
        }
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.ok(out.includes("libx264"))
        assert.ok(out.includes("-crf"))
        assert.ok(out.includes("23"))
    })
})

describe("createFromArgv (video-codec / video-copy)", () => {
    it("--video-codec hevc_nvenc -> userArgs.videoCodec, no -c:v in videoArgs", async () => {
        await presetsDefault.initPresetsAsync(DEFAULT_PRESET_PATH)
        const preset = presetsDefault.createFromArgv({
            preset: "h264_2k",
            videoCodec: "hevc_nvenc",
        })
        assert.strictEqual(preset.userArgs.videoCodec, "hevc_nvenc")
        // 旧式写入已删除：videoArgs 不得含 -c:v（否则会被 build 忽略 + warn）
        assert.ok(!/-\s*c:v/.test(preset.videoArgs || ""))
    })

    it("--video-copy -> userArgs.videoCodec=copy, videoArgs has no -c:v copy", async () => {
        await presetsDefault.initPresetsAsync(DEFAULT_PRESET_PATH)
        const preset = presetsDefault.createFromArgv({
            preset: "h264_2k",
            videoCopy: true,
        })
        assert.strictEqual(preset.userArgs.videoCodec, "copy")
        assert.strictEqual(preset.userArgs.videoCopy, true)
        assert.ok(!/-\s*c:v\s+copy/.test(preset.videoArgs || ""))
    })
})

describe("codecFamilyOfPreset priority", () => {
    it("explicit encoder wins over videoCodecFamily", () => {
        const preset = {
            userArgs: { videoCodec: "hevc_nvenc" },
            videoCodecFamily: "h264",
        }
        assert.strictEqual(codecFamilyOfPreset(preset), "hevc")
    })

    it("videoCodecFamily used when no explicit encoder", () => {
        assert.strictEqual(codecFamilyOfPreset({ videoCodecFamily: "hevc" }), "hevc")
        assert.strictEqual(codecFamilyOfPreset({ videoCodecFamily: "h264" }), "h264")
    })

    it("copy is not treated as a family source", () => {
        const preset = {
            userArgs: { videoCodec: "copy" },
            videoCodecFamily: "hevc",
        }
        assert.strictEqual(codecFamilyOfPreset(preset), "hevc")
    })
})

describe("candidateTiers auto whitelist (hwaccel)", () => {
    const caps = { usable: { cuda: true, qsv: false, d3d: false, cpu: true } }

    it("hwaccel=cuda (available) -> [cuda, cpu]", () => {
        const tiers = candidateTiers(caps, { decodeMode: "auto", hwaccel: "cuda" })
        assert.deepStrictEqual(tiers, ["cuda", "cpu"])
    })

    it("hwaccel=qsv (unavailable) -> [cpu] (auto degrade)", () => {
        const tiers = candidateTiers(caps, { decodeMode: "auto", hwaccel: "qsv" })
        assert.deepStrictEqual(tiers, ["cpu"])
    })

    it("hwaccel=auto -> default chain (vendor tiers + cpu)", () => {
        const tiers = candidateTiers(caps, { decodeMode: "auto", hwaccel: "auto" })
        assert.deepStrictEqual(tiers, ["cuda", "cpu"])
    })

    it("decodeMode=gpu with explicit hwaccel -> [name]", () => {
        const tiers = candidateTiers(caps, { decodeMode: "gpu", hwaccel: "cuda" })
        assert.deepStrictEqual(tiers, ["cuda"])
    })

    it("decodeMode=cpu -> [cpu] regardless of hwaccel", () => {
        const tiers = candidateTiers(caps, { decodeMode: "cpu", hwaccel: "cuda" })
        assert.deepStrictEqual(tiers, ["cpu"])
    })
})

describe("probeCacheKey includes forcedEncoder", () => {
    it("different forced encoders -> different keys", () => {
        const base = {
            tierName: "cuda",
            codec: "hevc",
            codecFamily: "hevc",
            pixFmt: "yuv420p",
            dimension: 1920,
            bitDepth: 8,
        }
        const k1 = probeCacheKey({ ...base, forcedEncoder: "hevc_nvenc" })
        const k2 = probeCacheKey({ ...base, forcedEncoder: "hevc_qsv" })
        const k3 = probeCacheKey({ ...base })
        assert.notStrictEqual(k1, k2)
        assert.notStrictEqual(k1, k3)
        // ⚠️ key 尾部还有 speed/framerate 段（T5 新增），用 includes 而非 endsWith
        assert.ok(k1.includes("|hevc_nvenc"))
    })
})
