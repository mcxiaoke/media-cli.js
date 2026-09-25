/**
 * ffmpeg 二进制定位 + 构建能力探测的回归测试
 *
 * 覆盖项：
 *   - resolveFFmpegBinary 环境变量（FFMPEG_PATH/FFMPEG_BINARY）优先于 which，
 *     且变量指向不存在的文件时继续向下查找
 *   - parseVersionInfo 解析 -version 输出的版本标识与 configuration 串
 *   - parseEncoders / parseFilters 解析编码器与滤镜集合（libfdk_aac、hevc_nvenc 等）
 *   - fallbackAudioEncoder 对不可用音频编码器静态降级为 aac
 */

import assert from "assert"
import fsp from "fs/promises"
import path from "path"
import { after, before, describe, it } from "node:test"

import { resolveFFmpegBinary, resolveFFprobeBinary } from "../src/transcode/ffmpeg_bin.js"
import { fallbackAudioEncoder } from "../src/transcode/ffmpeg_build.js"
import { parseEncoders, parseFilters, parseVersionInfo } from "../src/transcode/hwdetect.js"

const TMP_DIR = path.join("temp", "test_ffmpeg_bin")

// 保存/恢复环境变量，避免污染其他用例或宿主环境
const ENV_KEYS = ["FFMPEG_PATH", "FFMPEG_BINARY", "FFPROBE_PATH", "FFPROBE_BINARY"]
function saveEnv() {
    const saved = {}
    for (const k of ENV_KEYS) {
        saved[k] = process.env[k]
        delete process.env[k]
    }
    return saved
}
function restoreEnv(saved) {
    for (const k of ENV_KEYS) {
        const v = saved[k]
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
    }
}

describe("ffmpeg binary resolution and capability probes", () => {
    let savedEnv
    let fakeBin

    before(async () => {
        savedEnv = saveEnv()
        await fsp.rm(TMP_DIR, { recursive: true, force: true })
        await fsp.mkdir(TMP_DIR, { recursive: true })
        fakeBin = path.join(TMP_DIR, "ffmpeg_fake.exe")
        await fsp.writeFile(fakeBin, "fake")
        await fsp.writeFile(path.join(TMP_DIR, "ffprobe.exe"), "fake-probe")
    })

    after(async () => {
        restoreEnv(savedEnv)
        await fsp.rm(TMP_DIR, { recursive: true, force: true })
    })

    describe("resolveFFmpegBinary", () => {
        it("prefers FFMPEG_PATH over FFMPEG_BINARY and which()", async () => {
            process.env.FFMPEG_PATH = fakeBin
            process.env.FFMPEG_BINARY = path.join(TMP_DIR, "binary_fallback.exe")
            await fsp.writeFile(process.env.FFMPEG_BINARY, "fake2")
            assert.strictEqual(await resolveFFmpegBinary(), fakeBin)
        })

        it("skips env values pointing to a non-existent file and tries the next source", async () => {
            process.env.FFMPEG_PATH = path.join(TMP_DIR, "no-such-ffmpeg.exe")
            process.env.FFMPEG_BINARY = fakeBin
            assert.strictEqual(await resolveFFmpegBinary(), fakeBin)
        })

        it("uses explicit extra candidates (bundled resources) ahead of PATH", async () => {
            delete process.env.FFMPEG_PATH
            delete process.env.FFMPEG_BINARY
            const bundled = path.join(TMP_DIR, "bundled", "ffmpeg.exe")
            await fsp.mkdir(path.dirname(bundled), { recursive: true })
            await fsp.writeFile(bundled, "fake-bundled")
            assert.strictEqual(await resolveFFmpegBinary({ extraCandidates: [bundled] }), bundled)
        })

        it("keeps env vars ahead of extra candidates", async () => {
            const bundled = path.join(TMP_DIR, "bundled", "ffmpeg.exe")
            await fsp.mkdir(path.dirname(bundled), { recursive: true })
            await fsp.writeFile(bundled, "fake-bundled")
            process.env.FFMPEG_PATH = fakeBin
            assert.strictEqual(await resolveFFmpegBinary({ extraCandidates: [bundled] }), fakeBin)
        })

        it("ignores missing or invalid extra candidates", async () => {
            delete process.env.FFMPEG_PATH
            delete process.env.FFMPEG_BINARY
            const missing = path.join(TMP_DIR, "no-such-bundled.exe")
            const resolved = await resolveFFmpegBinary({
                extraCandidates: [missing, null, "", undefined],
            })
            assert.notStrictEqual(resolved, missing)
        })

        it("returns null when no env var is set and ffmpeg is not on PATH", async () => {
            delete process.env.FFMPEG_PATH
            delete process.env.FFMPEG_BINARY
            // 无法保证测试机 PATH 上有没有 ffmpeg：要么 null，要么是可用的真路径
            //（两种情况都不该是 fakeBin），只为锁定「不会凭空编造路径」。
            const resolved = await resolveFFmpegBinary()
            if (resolved !== null) {
                assert.notStrictEqual(resolved, fakeBin)
                assert.ok(typeof resolved === "string" && resolved.length > 0)
            }
        })
    })

    describe("resolveFFprobeBinary", () => {
        it("prefers the sibling of the selected ffmpeg", async () => {
            delete process.env.FFPROBE_PATH
            delete process.env.FFPROBE_BINARY
            assert.strictEqual(
                await resolveFFprobeBinary(fakeBin),
                path.join(TMP_DIR, "ffprobe.exe"),
            )
        })

        it("prefers FFPROBE_PATH when explicitly configured", async () => {
            const explicit = path.join(TMP_DIR, "explicit-probe.exe")
            await fsp.writeFile(explicit, "explicit")
            process.env.FFPROBE_PATH = explicit
            assert.strictEqual(await resolveFFprobeBinary(fakeBin), explicit)
        })
    })

    describe("parseVersionInfo", () => {
        it("extracts version identifier and configuration string", () => {
            const stdout = [
                "ffmpeg version N-126733-gfddc59cf3-2026-09-20-nonfree Copyright (c) 2000-2026 the FFmpeg developers",
                "  built with gcc 14.3.0 (GCC)",
                "  configuration: --enable-gpl --enable-version3 --enable-libfdk-aac --enable-nvenc",
            ].join("\n")
            const r = parseVersionInfo(stdout)
            assert.match(r.version, /^N-126733-gfddc59cf3-2026-09-20-nonfree$/)
            assert.ok(r.configuration.includes("--enable-libfdk-aac"))
            assert.ok(r.configuration.includes("--enable-nvenc"))
        })

        it("returns empty strings on empty input", () => {
            assert.deepStrictEqual(parseVersionInfo(""), { version: "", configuration: "" })
        })
    })

    describe("parseEncoders", () => {
        it("collects encoder names from -encoders output", () => {
            const stdout = [
                "Encoders:",
                " V....D libfdk_aac             Fraunhofer FDK AAC (codec aac)",
                " V....D hevc_nvenc            NVIDIA NVENC HEVC encoder (codec hevc)",
                " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC encoder",
                "",
            ].join("\n")
            const set = parseEncoders(stdout)
            assert.strictEqual(set.has("libfdk_aac"), true)
            assert.strictEqual(set.has("hevc_nvenc"), true)
            assert.strictEqual(set.has("libx264"), true)
            assert.strictEqual(set.has("Encoders:"), false)
        })
    })

    describe("parseFilters", () => {
        it("collects filter names from -filters output (variable-width flags)", () => {
            const stdout = [
                "Filters:",
                " .. scale_cuda          V->V       GPU accelerated video resizer",
                " T.. yadif              V->V       Deinterlace the input image.",
                " .. setpts              V->V       Set PTS for the output video frame.",
                "",
            ].join("\n")
            const set = parseFilters(stdout)
            assert.strictEqual(set.has("scale_cuda"), true)
            assert.strictEqual(set.has("yadif"), true)
            assert.strictEqual(set.has("setpts"), true)
            assert.strictEqual(set.has("Filters:"), false)
        })
    })

    describe("fallbackAudioEncoder", () => {
        it("replaces an unavailable encoder with aac", () => {
            const out = fallbackAudioEncoder("-c:a libfdk_aac -b:a 96k", new Set(["aac"]))
            assert.strictEqual(out, "-c:a aac -b:a 96k")
        })

        it("replaces an unavailable pure codec name with aac", () => {
            const out = fallbackAudioEncoder("libfdk_aac", new Set(["aac"]))
            assert.strictEqual(out, "aac")
        })

        it("leaves an available pure codec name untouched", () => {
            const out = fallbackAudioEncoder("aac", new Set(["aac", "libopus"]))
            assert.strictEqual(out, "aac")
        })

        it("keeps the stream selector suffix when rewriting", () => {
            const out = fallbackAudioEncoder("-c:a:1 libfdk_aac -b:a 192k", new Set(["aac"]))
            assert.strictEqual(out, "-c:a:1 aac -b:a 192k")
        })

        it("leaves an available encoder untouched", () => {
            const args = "-c:a aac -b:a 128k"
            assert.strictEqual(fallbackAudioEncoder(args, new Set(["aac", "libfdk_aac"])), args)
        })

        it("leaves copy mode untouched even without the codec available", () => {
            const args = "-c:a copy"
            assert.strictEqual(fallbackAudioEncoder(args, new Set(["aac"])), args)
        })

        it("returns input unchanged when no encoder set is provided", () => {
            const args = "-c:a libfdk_aac -b:a 96k"
            assert.strictEqual(fallbackAudioEncoder(args, undefined), args)
            assert.strictEqual(fallbackAudioEncoder(args, null), args)
        })

        it("strict mode does not downgrade an unavailable encoder (returns input as-is)", () => {
            const args = "-c:a libfdk_aac -b:a 96k"
            // strict 语义：不降级也不抛错，原样返回；"跳过该文件"由
            // prepare 阶段的编码器预检负责（see cmd_ffmpeg.js prepareFFmpegCmd）
            assert.strictEqual(fallbackAudioEncoder(args, new Set(["aac"]), true), args)
        })

        it("strict mode keeps an available encoder untouched", () => {
            const args = "-c:a libfdk_aac -b:a 96k"
            assert.strictEqual(
                fallbackAudioEncoder(args, new Set(["aac", "libfdk_aac"]), true),
                args,
            )
        })

        it("strict mode keeps copy mode untouched", () => {
            const args = "-c:a copy"
            assert.strictEqual(fallbackAudioEncoder(args, new Set(["aac"]), true), args)
        })
    })
})
