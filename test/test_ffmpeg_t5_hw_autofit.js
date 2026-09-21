/*
 * Phase 4 (T5) 专项测试：硬件加速自动适配修复
 *
 * 覆盖：
 *   - codecFamilyOf 扩展 av1/vp9（含 av01/vp09 短名与 libaom-av1/libvpx-vp9）
 *   - ENCODER_MATRIX 新增 av1/vp9 行（cuda/qsv/amf/d3d 硬件层 + cpu 层）
 *   - buildEncoderArgs：矩阵缺键回退 CPU 编码器（cuda/vp9、amf/vp9 → libvpx-vp9）
 *     + 质量参数按实际编码器分发（回退后走 cpu 分支 -crf 而非 nvenc -cq）
 *     + av1/vp9 CPU 编码纯 CRF 模式补 -b:v 0
 *   - probeCacheKey 含 speed/framerate 段
 *   - buildEncoderArgs 质量参数按实际编码器分发（forcedEncoder 不受 ENCODER_MATRIX 影响）
 *   - candidateTiers：d3d 从自动候选链移除（显式白名单仍可用）
 *   - candidateTiers：消费 filterSupport 静态预筛（无 scale_cuda 的构建跳过 cuda）
 *   - resolveHwPlan 透传 videoBitrateK（经 selectTier → probeLayer → buildProbeArgs）
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
    TIERS,
    buildEncoderArgs,
    buildLayerArgs,
    buildProbeArgs,
    codecFamilyOf,
    codecFamilyOfPreset,
    probeCacheKey,
} from "../lib/hwaccel.js"
import { candidateTiers } from "../lib/hwdetect.js"

const cudaTier = TIERS.find((t) => t.name === "cuda")
const size = { w: 1920, h: 1080 }

describe("codecFamilyOf (av1/vp9 extension)", () => {
    it("AV1 hardware encoders -> av1", () => {
        assert.strictEqual(codecFamilyOf("av1_nvenc"), "av1")
        assert.strictEqual(codecFamilyOf("av1_qsv"), "av1")
        assert.strictEqual(codecFamilyOf("av1_amf"), "av1")
    })

    it("AV1 software encoders -> av1", () => {
        assert.strictEqual(codecFamilyOf("libaom-av1"), "av1")
        assert.strictEqual(codecFamilyOf("libsvtav1"), "av1")
    })

    it("av01 short name (ffprobe) -> av1", () => {
        assert.strictEqual(codecFamilyOf("av01"), "av1")
    })

    it("VP9 encoders -> vp9", () => {
        assert.strictEqual(codecFamilyOf("vp9_qsv"), "vp9")
        assert.strictEqual(codecFamilyOf("libvpx-vp9"), "vp9")
        assert.strictEqual(codecFamilyOf("vp09"), "vp9")
    })

    it("h264/hevc unchanged", () => {
        assert.strictEqual(codecFamilyOf("h264_nvenc"), "h264")
        assert.strictEqual(codecFamilyOf("hevc_qsv"), "hevc")
        assert.strictEqual(codecFamilyOf("libx265"), "hevc")
        assert.strictEqual(codecFamilyOf(""), "h264")
    })

    it("codecFamilyOfPreset accepts videoCodecFamily=av1/vp9", () => {
        assert.strictEqual(codecFamilyOfPreset({ videoCodecFamily: "av1" }), "av1")
        assert.strictEqual(codecFamilyOfPreset({ videoCodecFamily: "vp9" }), "vp9")
    })
})

describe("buildEncoderArgs (av1/vp9 matrix + fallback)", () => {
    it("cuda + av1 -> av1_nvenc with nvenc args", () => {
        const args = buildEncoderArgs("cuda", { codecFamily: "av1", quality: 28 })
        assert.strictEqual(args[1], "av1_nvenc")
        assert.ok(args.includes("-cq"), "nvenc cq arg present")
        assert.ok(!args.includes("-crf"), "cpu crf arg must not appear")
    })

    it("qsv + av1/vp9 -> av1_qsv/vp9_qsv with global_quality", () => {
        const av1 = buildEncoderArgs("qsv", { codecFamily: "av1", quality: 28 })
        assert.strictEqual(av1[1], "av1_qsv")
        assert.ok(av1.includes("-global_quality"))
        const vp9 = buildEncoderArgs("qsv", { codecFamily: "vp9", quality: 28 })
        assert.strictEqual(vp9[1], "vp9_qsv")
        assert.ok(vp9.includes("-global_quality"))
    })

    it("amf + av1 -> av1_amf", () => {
        const args = buildEncoderArgs("amf", { codecFamily: "av1", quality: 28 })
        assert.strictEqual(args[1], "av1_amf")
    })

    it("cuda + vp9 (no nvenc vp9) -> fallback libvpx-vp9 with cpu args", () => {
        const args = buildEncoderArgs("cuda", { codecFamily: "vp9", quality: 28 })
        assert.strictEqual(args[1], "libvpx-vp9")
        assert.ok(args.includes("-crf"), "fallback must use cpu crf args")
        assert.ok(
            args.includes("-b:v") && args[args.indexOf("-b:v") + 1] === "0",
            "libvpx-vp9 pure CRF needs -b:v 0",
        )
        assert.ok(!args.includes("-cq"), "must not emit nvenc args for cpu encoder")
        assert.ok(!args.includes("-rc"), "must not emit nvenc -rc for cpu encoder")
    })

    it("amf + vp9 (no amf vp9) -> fallback libvpx-vp9 with cpu args", () => {
        const args = buildEncoderArgs("amf", { codecFamily: "vp9", quality: 28 })
        assert.strictEqual(args[1], "libvpx-vp9")
        assert.ok(args.includes("-crf"))
    })

    it("cpu + av1 -> libaom-av1 with -b:v 0 (pure CRF)", () => {
        const args = buildEncoderArgs("cpu", { codecFamily: "av1", quality: 30 })
        assert.strictEqual(args[1], "libaom-av1")
        assert.ok(args.includes("-crf"))
        assert.ok(args.includes("-b:v") && args[args.indexOf("-b:v") + 1] === "0")
    })

    it("cpu + h264 -b:v 0 not added (libx264 crf fine without)", () => {
        const args = buildEncoderArgs("cpu", { codecFamily: "h264", quality: 24 })
        assert.strictEqual(args[1], "libx264")
        assert.ok(!args.includes("-b:v"))
    })

    it("bitrateK passthrough adds maxrate/bufsize (cpu branch)", () => {
        const args = buildEncoderArgs("cpu", {
            codecFamily: "h264",
            quality: 24,
            bitrateK: "2000K",
        })
        assert.ok(args.includes("-maxrate") && args[args.indexOf("-maxrate") + 1] === "2000K")
        assert.ok(args.includes("-bufsize"))
    })

    it("forcedEncoder=av1_nvenc on cpu tier -> av1_nvenc with nvenc args", () => {
        const args = buildEncoderArgs("cpu", {
            codecFamily: "av1",
            quality: 28,
            forcedEncoder: "av1_nvenc",
        })
        assert.strictEqual(args[1], "av1_nvenc")
        assert.ok(args.includes("-cq"))
    })
})

describe("buildLayerArgs -> buildProbeArgs bitrateK passthrough", () => {
    it("probe args include maxrate/bufsize when bitrateK set", () => {
        // buildProbeArgs 内的 buildLayerArgs 会组装同一套滤镜与编码器参数
        const probeArgs = buildProbeArgs({
            tier: cudaTier,
            size,
            speed: 1,
            codecFamily: "h264",
            quality: 28,
            bitrateK: "2000K",
            inputPath: "/tmp/in.mp4",
        })
        assert.ok(probeArgs.includes("-maxrate"), "probe must carry -maxrate")
        assert.ok(probeArgs.includes("-bufsize"), "probe must carry -bufsize")
        assert.strictEqual(probeArgs[probeArgs.indexOf("-maxrate") + 1], "2000K")
    })

    it("layer args without bitrateK omit maxrate/bufsize", () => {
        const { outputArgs } = buildLayerArgs({
            tier: cudaTier,
            size,
            speed: 1,
            codecFamily: "h264",
            quality: 28,
        })
        assert.ok(!outputArgs.includes("-maxrate"))
        assert.ok(!outputArgs.includes("-bufsize"))
    })
})

describe("probeCacheKey includes speed/framerate", () => {
    it("different speed -> different keys", () => {
        const base = { tierName: "cuda", codec: "h264", pixFmt: "yuv420p", dimension: 1920 }
        const k1 = probeCacheKey({ ...base, speed: 1 })
        const k2 = probeCacheKey({ ...base, speed: 1.5 })
        assert.notStrictEqual(k1, k2)
    })

    it("different framerate -> different keys", () => {
        const base = { tierName: "cuda", codec: "h264", pixFmt: "yuv420p", dimension: 1920 }
        const k1 = probeCacheKey({ ...base, framerate: undefined })
        const k2 = probeCacheKey({ ...base, framerate: 30 })
        assert.notStrictEqual(k1, k2)
    })

    it("same speed/framerate -> same key (existing fields stable)", () => {
        const base = {
            tierName: "cuda",
            codec: "hevc",
            pixFmt: "p010le",
            dimension: 3840,
            bitDepth: 10,
        }
        const k1 = probeCacheKey({ ...base, speed: 1, framerate: undefined })
        const k2 = probeCacheKey({ ...base, speed: 1, framerate: undefined })
        assert.strictEqual(k1, k2)
    })
})

describe("candidateTiers d3d removal + filterSupport prefilter", () => {
    const allUsable = { usable: { cuda: true, qsv: true, amf: true, d3d: true, cpu: true } }

    it("auto default chain excludes d3d even when usable", () => {
        const caps = {
            ...allUsable,
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.ok(!tiers.includes("d3d"), "d3d must not appear in auto chain")
        assert.deepStrictEqual(tiers, ["cuda", "qsv", "amf", "cpu"])
    })

    it("explicit hwaccel=d3d still works (whitelist override)", () => {
        const caps = {
            ...allUsable,
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto", hwaccel: "d3d" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("explicit hwaccel=d3d11va still normalizes to d3d layer", () => {
        const caps = {
            ...allUsable,
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto", hwaccel: "d3d11va" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("gpu mode with d3d still allowed (explicit)", () => {
        const caps = {
            ...allUsable,
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "gpu", hwaccel: "d3d11va" })
        assert.deepStrictEqual(tiers, ["d3d"])
    })

    it("filterSupport missing scale_cuda -> cuda skipped, qsv/amf kept", () => {
        const caps = {
            ...allUsable,
            filterSupport: { scale_cuda: false, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["qsv", "amf", "cpu"])
    })

    it("filterSupport missing vpp_amf (old ffmpeg) -> amf skipped", () => {
        const caps = {
            ...allUsable,
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: false },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["cuda", "qsv", "cpu"])
    })

    it("no filterSupport table (legacy caps) -> no prefilter, all kept", () => {
        const caps = { ...allUsable, filterSupport: undefined }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["cuda", "qsv", "amf", "cpu"])
    })
})
