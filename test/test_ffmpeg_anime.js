/**
 * 动漫调优模式 (--anime) 与预设别名专项测试
 */

import assert from "assert"
import { describe, it, before } from "node:test"

import presets from "../lib/ffmpeg_presets.js"
import { DEFAULT_PRESET_PATH } from "../lib/preset_loader.js"
import { calculateDstArgs } from "../lib/ffmpeg_plan.js"
import { buildEncoderArgs } from "../lib/hwaccel.js"

describe("Anime mode & preset aliases", () => {
    before(async () => {
        await presets.initPresetsAsync(DEFAULT_PRESET_PATH)
    })
    it("resolves preset aliases correctly and sets anime flag", () => {
        // hevc_anime / anime
        const p1 = presets.createFromArgv({ preset: "anime" })
        assert.strictEqual(p1.name, "hevc_2k")
        assert.strictEqual(p1.userArgs.anime, true)

        const p2 = presets.createFromArgv({ preset: "hevc_anime" })
        assert.strictEqual(p2.name, "hevc_2k")
        assert.strictEqual(p2.userArgs.anime, true)

        // av1_anime
        const p3 = presets.createFromArgv({ preset: "av1_anime" })
        assert.strictEqual(p3.name, "av1_2k")
        assert.strictEqual(p3.userArgs.anime, true)

        // h264_anime
        const p4 = presets.createFromArgv({ preset: "h264_anime" })
        assert.strictEqual(p4.name, "h264_2k")
        assert.strictEqual(p4.userArgs.anime, true)

        // short aliases without anime
        const p5 = presets.createFromArgv({ preset: "av1" })
        assert.strictEqual(p5.name, "av1_2k")
        assert.strictEqual(p5.userArgs.anime, undefined)

        const p6 = presets.createFromArgv({ preset: "hevc" })
        assert.strictEqual(p6.name, "hevc_2k")

        const p7 = presets.createFromArgv({ preset: "h264" })
        assert.strictEqual(p7.name, "h264_2k")

        // explicit --anime flag
        const p8 = presets.createFromArgv({ preset: "hevc_2kh", anime: true })
        assert.strictEqual(p8.name, "hevc_2kh")
        assert.strictEqual(p8.userArgs.anime, true)
    })

    it("adjusts quality (+4 for AV1, +2 for HEVC/H264) in calculateDstArgs when anime mode is active and user didn't specify vq", () => {
        // AV1 preset default Q is 33 -> increases by 4 to 37 (Same-VMAF design)
        const av1Entry = {
            path: "test.mp4",
            name: "test",
            preset: presets.createFromArgv({ preset: "av1_2k", anime: true }),
            info: { video: { width: 1920, height: 1080 } },
        }
        const av1Dst = calculateDstArgs(av1Entry)
        assert.strictEqual(av1Dst.dstVideoQuality, 37)
        assert.strictEqual(av1Dst.anime, true)

        // HEVC preset default Q is 23 -> increases by 2 to 25 (Same-VMAF design)
        const hevcEntry = {
            path: "test.mp4",
            name: "test",
            preset: presets.createFromArgv({ preset: "hevc_2k", anime: true }),
            info: { video: { width: 1920, height: 1080 } },
        }
        const hevcDst = calculateDstArgs(hevcEntry)
        assert.strictEqual(hevcDst.dstVideoQuality, 25)
        assert.strictEqual(hevcDst.anime, true)

        // If user explicitly specifies videoQuality, respect user value
        const userEntry = {
            path: "test.mp4",
            name: "test",
            preset: presets.createFromArgv({ preset: "hevc_2k", videoQuality: 22, anime: true }),
            info: { video: { width: 1920, height: 1080 } },
        }
        const userDst = calculateDstArgs(userEntry)
        assert.strictEqual(userDst.dstVideoQuality, 22)
    })

    it("injects anime tuning parameters into buildEncoderArgs", () => {
        // NVENC: -spatial-aq 1 -temporal-aq 1
        const nvencArgs = buildEncoderArgs("cuda", {
            quality: 24,
            codecFamily: "hevc",
            anime: true,
        })
        assert.ok(nvencArgs.includes("-spatial-aq"))
        assert.ok(nvencArgs.includes("-temporal-aq"))

        // x264: -tune animation
        const x264Args = buildEncoderArgs("cpu", {
            quality: 20,
            codecFamily: "h264",
            anime: true,
        })
        assert.ok(x264Args.includes("-tune"))
        assert.ok(x264Args.includes("animation"))

        // x265: -x265-params no-sao=1:aq-mode=3
        const x265Args = buildEncoderArgs("cpu", {
            quality: 20,
            codecFamily: "hevc",
            anime: true,
        })
        assert.ok(x265Args.includes("-x265-params"))
        assert.ok(x265Args.includes("no-sao=1:aq-mode=3"))

        // SVT-AV1: -svtav1-params tune=0
        const svtArgs = buildEncoderArgs("cpu", {
            quality: 25,
            codecFamily: "av1",
            forcedEncoder: "libsvtav1",
            anime: true,
        })
        assert.ok(svtArgs.includes("-svtav1-params"))
        assert.ok(svtArgs.includes("tune=0"))

        // Non-anime mode should NOT have these extra flags
        const normalArgs = buildEncoderArgs("cuda", {
            quality: 24,
            codecFamily: "hevc",
            anime: false,
        })
        assert.ok(!normalArgs.includes("-spatial-aq"))
        assert.ok(!normalArgs.includes("-temporal-aq"))
    })

    it("verifies newly added AV1 and H264 presets exist in default yaml", () => {
        const names = presets.getAllNames()
        assert.ok(names.includes("av1_2kt"), "av1_2kt should exist")
        assert.ok(names.includes("av1_720p"), "av1_720p should exist")
        assert.ok(names.includes("h264_2kh"), "h264_2kh should exist")
        assert.ok(names.includes("h264_2kl"), "h264_2kl should exist")
        assert.ok(names.includes("h264_4kh"), "h264_4kh should exist")
        assert.ok(names.includes("h264_4kl"), "h264_4kl should exist")

        const p2kt = presets.getPreset("av1_2kt")
        assert.strictEqual(p2kt.videoQuality, 42)
        assert.strictEqual(p2kt.maxBitrate, 2000000)

        const p720 = presets.getPreset("av1_720p")
        assert.strictEqual(p720.videoQuality, 34)
        assert.strictEqual(p720.dimension, 1280)
    })
})
