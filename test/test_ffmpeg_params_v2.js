/**
 * 定稿（2026-09-22）CLI 参数体系单测 —— 极简追加模型
 *
 * 覆盖（对应 docs/ffmpeg/ffmpeg-cli-params-v2-20260922.md §5）：
 *   1. createFromArgv：--video-args / --audio-args 改「追加」，不再覆盖 preset.videoArgs/audioArgs
 *   2. createFromArgv：--filters 改「追加到后滤镜段」，保留 {scaleFilter}
 *   3. createFromArgv：--metadata 解析为 metadataPairs（值含空格原样保留，按 ';' 切分）
 *   4. buildVideoArgsFromPlan：userArgs.videoExtra 追加到编码器块末尾
 *   5. buildScaleFiltersFromPlan：追加的 post 滤镜保留缩放段、不泄漏占位符
 *   6. createFFmpegArgs：--audio-args / --metadata 端到端进入最终命令，用户 metadata 覆盖自动 title
 *
 * ⚠️ 不涉及真实 ffmpeg 执行（纯参数构建，无 tier 探测）。
 */
import assert from "node:assert/strict"
import { describe, it, before } from "node:test"

import presetsDefault from "../lib/ffmpeg_presets.js"
import { DEFAULT_PRESET_PATH } from "../lib/preset_loader.js"
import {
    createFFmpegArgs,
    buildVideoArgsFromPlan,
    buildScaleFiltersFromPlan,
    flattenFFArgs,
} from "../lib/ffmpeg_build.js"
import { TIERS, buildLayerArgs } from "../lib/hwaccel.js"
import { calculateDstArgs } from "../lib/ffmpeg_plan.js"

const cudaTier = TIERS.find((t) => t.name === "cuda")
const cpuTier = TIERS.find((t) => t.name === "cpu")
const size = { w: 1920, h: 1080 }

/** 构造极简 entry（与既有 ffmpeg build 测试同构，字段给足以避开可选链之外的读取） */
const makeEntry = (over = {}) => ({
    path: "/tmp/in.mp4",
    name: "in",
    size: 10 * 1024 * 1024,
    info: {
        video: { width: 3840, height: 2160, pixelFormat: "yuv420p", duration: 60 },
        audio: { duration: 60 },
    },
    dstArgs: {
        scaled: false,
        srcDuration: 60,
        srcVideoCodec: "hevc",
        srcAudioCodec: "aac",
    },
    argv: { debug: false, strict: false, decodeMode: "cpu" },
    fileDstTemp: "/tmp/out_tmp.mp4",
    ...over,
})

const presetOf = (over = {}) => ({
    name: "unit_test",
    type: "video",
    format: ".mp4",
    filters: "{scaleFilter}",
    videoCodecFamily: "h264",
    videoQuality: 24,
    framerate: 0,
    speed: 0,
    dimension: 0,
    inputArgs: "",
    streamArgs: "",
    outputArgs: "",
    audioArgs: "-c:a aac -b:a 128k",
    ...over,
})

const makeHwPlan = (tier, s = size) => ({ tier, size: s, caps: {} })

describe("createFromArgv — 追加语义 (video/audio)", () => {
    before(async () => {
        await presetsDefault.initPresetsAsync(DEFAULT_PRESET_PATH)
    })

    it("--video-args 存入 userArgs.videoExtra，且不覆盖 preset.videoArgs", () => {
        const preset = presetsDefault.createFromArgv({
            preset: "hevc_2k",
            videoArgs: "-tune animation -g 60",
        })
        assert.strictEqual(preset.userArgs.videoExtra, "-tune animation -g 60")
        // _base_hevc 的 videoArgs 是空串：追加语义下预设基线不应被用户串污染
        assert.ok(!String(preset.videoArgs).includes("-tune"), "preset.videoArgs must stay base")
    })

    it("--audio-args 存入 userArgs.audioExtra，且不覆盖 preset.audioArgs", () => {
        const preset = presetsDefault.createFromArgv({
            preset: "hevc_2k",
            audioArgs: "-ar 48000 -ac 2",
        })
        assert.strictEqual(preset.userArgs.audioExtra, "-ar 48000 -ac 2")
        assert.ok(String(preset.audioArgs).includes("-c:a"), "preset.audioArgs keeps -c:a")
        assert.ok(!String(preset.audioArgs).includes("-ar"), "preset.audioArgs not polluted")
    })
})

describe("createFromArgv — --filters 追加保 {scaleFilter}", () => {
    before(async () => {
        await presetsDefault.initPresetsAsync(DEFAULT_PRESET_PATH)
    })

    it("--filters 追加到 post_filters，filters 占位符保留", () => {
        const preset = presetsDefault.createFromArgv({
            preset: "hevc_2k",
            filters: "unsharp=3:3:1.0",
        })
        assert.strictEqual(preset.filters, "{scaleFilter}", "占位符不能被覆盖")
        assert.strictEqual(preset.post_filters, "unsharp=3:3:1.0")
    })

    it("buildScaleFiltersFromPlan：缩放段与追加滤镜共存，不泄漏占位符", () => {
        const tp = presetOf({ post_filters: "unsharp=3:3:1.0" })
        const out = buildScaleFiltersFromPlan(
            makeEntry({ dstArgs: { scaled: true } }),
            makeHwPlan(cpuTier),
            tp,
        )
        assert.ok(out.includes("scale=w=1920:h=1080"), "缩放段应存在")
        assert.ok(out.endsWith(",unsharp=3:3:1.0"), `追加应在末尾: ${out}`)
        assert.ok(!out.includes("{scaleFilter}"), "占位符不得泄漏")
    })
})

describe("createFromArgv — --metadata 解析", () => {
    before(async () => {
        await presetsDefault.initPresetsAsync(DEFAULT_PRESET_PATH)
    })

    it("按 ';' 切分组、'=' 取键，值内空格原样保留", () => {
        const preset = presetsDefault.createFromArgv({
            preset: "hevc_2k",
            metadata: "title=My Video;artist=Big Cat",
        })
        assert.deepStrictEqual(preset.userArgs.metadataPairs, [
            ["title", "My Video"],
            ["artist", "Big Cat"],
        ])
    })

    it("无 '=' 的片段与空片段被忽略", () => {
        const preset = presetsDefault.createFromArgv({
            preset: "hevc_2k",
            metadata: "novalue;;comment=hi",
        })
        assert.deepStrictEqual(preset.userArgs.metadataPairs, [["comment", "hi"]])
    })
})

describe("buildVideoArgsFromPlan — videoExtra 追加", () => {
    it("追加参数排在编码器块之后", () => {
        const tp = presetOf({
            userArgs: { videoExtra: "-tune film -g 60" },
        })
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.ok(out.includes("h264_nvenc"), "tier 编码器在前")
        assert.deepStrictEqual(out.slice(-4), ["-tune", "film", "-g", "60"], `追加应在末尾: ${out}`)
    })

    it("无 videoExtra 时不追加（copy 早返回路径保持纯净）", () => {
        const tp = presetOf({ userArgs: { videoCodec: "copy" } })
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.deepStrictEqual(out, ["-c:v", "copy"])
    })
})

describe("createFFmpegArgs — 端到端进入最终命令", () => {
    it("audioExtra 追加到音频块末尾", () => {
        const entry = makeEntry({
            preset: presetOf({
                dimension: 1920,
                userArgs: { audioExtra: "-ar 48000 -ac 2" },
            }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(/-c:a aac -b:a 128k -ar 48000 -ac 2/.test(cmd), `音频追加缺失: ${cmd}`)
    })

    it("用户 metadata 覆盖自动 title（排在自动项之后）", () => {
        const entry = makeEntry({
            name: "clip",
            preset: presetOf({
                dimension: 1920,
                userArgs: { metadataPairs: [["title", "My Big Movie"]] },
            }),
        })
        const args = createFFmpegArgs(entry, makeHwPlan(cpuTier)).args.flat()
        // 自动 title=clip 在前，用户 title=My Big Movie 在后（后写覆盖）
        const autoIdx = args.indexOf("title=clip")
        const userIdx = args.indexOf("title=My Big Movie")
        assert.ok(autoIdx >= 0, "应存在自动 title=clip")
        assert.ok(userIdx >= 0, "应存在用户 title=My Big Movie（值含空格、未被拆分）")
        assert.ok(userIdx > autoIdx, "用户 metadata 应排在自动项之后以覆盖")
    })

    it("无追加项时命令不含空 token（splitArgs 净化空白）", () => {
        const entry = makeEntry({
            preset: presetOf({ dimension: 1920, userArgs: { videoExtra: "   " } }),
        })
        const args = createFFmpegArgs(entry, makeHwPlan(cpuTier)).args.flat()
        assert.ok(!args.some((a) => a === "" || a === undefined), "不应有空白 token")
    })
})

describe("D2 — 变速的音视频同步产出（simple -vf setpts + -af atempo）", () => {
    it("createFFmpegArgs：speed≠1 同时产出 -vf setpts 与 -af atempo", () => {
        const entry = makeEntry({
            preset: presetOf({
                dimension: 1920,
                speed: 1.5,
                userArgs: { videoBitrate: 0, videoQuality: 24 },
            }),
            dstArgs: { scaled: true, srcDuration: 10, srcVideoCodec: "hevc", srcAudioCodec: "aac" },
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.match(cmd, /-vf [^ ]*setpts=PTS\/1\.5/, `视频 setpts 应在 -vf: ${cmd}`)
        assert.match(cmd, /-af atempo=1\.5/, `音频 atempo 应在 -af: ${cmd}`)
    })

    it("speed==1 时不产出 -af（无谓变速）", () => {
        const entry = makeEntry({
            preset: presetOf({ dimension: 1920, speed: 0 }),
            dstArgs: { scaled: true, srcDuration: 10, srcVideoCodec: "hevc", srcAudioCodec: "aac" },
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(!/-af /.test(cmd), `speed=1 不应有 -af: ${cmd}`)
    })
})

describe("D5 — speed≠1 强制音频重编码（禁用 copy）", () => {
    it("满足 copy 条件但 speed≠1 → 不产出 -c:a copy，且加 -af atempo", () => {
        // dstArgs 让 bitrateOk 成立（dstAudioBitrate+2000 > srcAudioBitrate）→ 平时会 copy
        const entry = makeEntry({
            preset: presetOf({
                dimension: 1920,
                speed: 1.5,
                audioArgs: "-c:a libfdk_aac -b:a 128k",
                userArgs: { audioCopy: false },
            }),
            dstArgs: {
                scaled: true,
                srcDuration: 10,
                srcVideoCodec: "hevc",
                srcAudioCodec: "aac",
                srcAudioBitrate: 100000,
                dstAudioBitrate: 100000,
            },
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(!/-c:a copy/.test(cmd), `speed≠1 不得 copy 音频: ${cmd}`)
        assert.match(cmd, /-af atempo=1\.5/, "应套用 atempo")
        assert.match(cmd, /-c:a libfdk_aac/, "音频应重编码")
    })

    it("speed==1 且满足 copy 条件 → 仍可 -c:a copy（不回归）", () => {
        const entry = makeEntry({
            preset: presetOf({ dimension: 1920, speed: 0, audioArgs: "-c:a libfdk_aac -b:a 128k" }),
            dstArgs: {
                scaled: true,
                srcDuration: 10,
                srcVideoCodec: "hevc",
                srcAudioCodec: "aac",
                srcAudioBitrate: 100000,
                dstAudioBitrate: 100000,
            },
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.match(cmd, /-c:a copy/, `speed=1 允许 copy: ${cmd}`)
    })
})

describe("D2 — 探测命令与真实同构（buildLayerArgs 用 simple -af，不再 -filter_complex）", () => {
    it("buildLayerArgs speed≠1 hasAudio → 产 -vf(setpts)+-af(atempo)，不含 -filter_complex", () => {
        const { inputArgs, outputArgs } = buildLayerArgs({
            tier: cpuTier,
            size,
            speed: 1.5,
            framerate: 0,
            hasAudio: true,
            quality: 30,
            codecFamily: "hevc",
        })
        const joined = outputArgs.join(" ")
        assert.ok(outputArgs.includes("-af"), "应产出 -af")
        assert.ok(joined.includes("atempo=1.5"), `应含 atempo: ${joined}`)
        assert.ok(!joined.includes("-filter_complex"), "simple 路径不应有 -filter_complex")
        assert.ok(inputArgs.length === 0, "cpu 层无 hwaccel 输入参数")
    })
})

describe("calculateDstArgs — 分辨率码率缩放（像素面积幂律 α=0.75）", () => {
    const makePlanEntry = ({
        width,
        height,
        bitrate,
        videoBitrate,
        dimension,
        maxBitrate = 0,
    }) => ({
        path: "/tmp/in.mp4",
        name: "in.mp4",
        info: { video: { width, height, bitrate, framerate: 24, format: "hevc" } },
        preset: { videoBitrate, maxBitrate, dimension, userArgs: {} },
    })

    it("预设档位与实际输出一致 → 码率不缩放（满分 1.0）", () => {
        // 1080p 预设压 1080p 源：anchorPixels==dstPixels → scale=1
        const args = calculateDstArgs(
            makePlanEntry({
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                videoBitrate: 4_000_000,
                dimension: 1920,
            }),
        )
        assert.strictEqual(args.dstVideoBitrate, 4_000_000)
    })

    it("4K 预设压 1080p 源 → 按像素比 0.25^0.75≈0.354 缩放", () => {
        // anchorPixels=3840×2160, dstPixels=1920×1080 → 16000000×(0.25^0.75)≈5656854
        const args = calculateDstArgs(
            makePlanEntry({
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                videoBitrate: 16_000_000,
                dimension: 3840,
            }),
        )
        const expected = Math.round(16_000_000 * 0.25 ** 0.75) // 5656854
        assert.strictEqual(args.dstVideoBitrate, expected)
    })

    it("maxBitrate 与 videoBitrate 同比例缩放（显式声明时）", () => {
        const args = calculateDstArgs(
            makePlanEntry({
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                videoBitrate: 16_000_000,
                dimension: 3840,
                maxBitrate: 24_000_000,
            }),
        )
        // videoBitrate 已按 0.25^0.75 缩放
        const scale = (1920 * 1080) / (3840 * 2160)
        const expectedMax = Math.round(24_000_000 * scale ** 0.75)
        assert.strictEqual(args.dstMaxBitrate, expectedMax)
        // 峰值上限仍是平均码率的 1.5 倍关系（同一缩放系数）
        assert.strictEqual(args.dstMaxBitrate, Math.round(args.dstVideoBitrate * 1.5))
    })

    it("CQ 模式下（未设置 videoBitrate），dstVideoBitrate 保持为 0", () => {
        const args = calculateDstArgs(
            makePlanEntry({
                width: 1920,
                height: 1080,
                bitrate: 8_000_000,
                videoBitrate: 0,
                dimension: 1920,
            }),
        )
        assert.strictEqual(args.dstVideoBitrate, 0, "dstVideoBitrate must stay 0 for CQ mode")
    })
})

describe("2026-09-23 修复验证", () => {
    it("CQ 模式在 createFFmpegArgs 中生成 -cq 或 -crf，且不输出目标正数码率", () => {
        const entry = makeEntry({
            dstArgs: {
                dstVideoBitrate: 0,
                dstVideoQuality: 24,
                srcVideoCodec: "h264",
                srcAudioCodec: "aac",
            },
        })
        const preset = presetOf({
            videoCodecFamily: "hevc",
            videoQuality: 24,
            videoBitrate: 0,
        })
        const plan = makeHwPlan(cudaTier)
        const res = createFFmpegArgs({ ...entry, preset }, plan)
        const cmd = flattenFFArgs(res.args)
        assert.ok(cmd.includes("-cq 29") || cmd.includes("-cq"), "must contain -cq")
        assert.ok(cmd.includes("-b:v 0"), "CQ mode must set -b:v 0")
    })

    it("音频 metadata tags 保持一维 flat 参数，不生成带逗号的异常 token", () => {
        const entry = makeEntry({
            path: "/tmp/song.flac",
            name: "song.flac",
            tags: {
                title: "Track Title",
                artist: "Artist Name",
            },
        })
        const preset = presetOf({
            type: "audio",
            audioArgs: "-c:a aac -b:a 128k",
        })
        const plan = makeHwPlan(cpuTier)
        const res = createFFmpegArgs({ ...entry, preset }, plan)
        const middle = res.args[1]
        for (const item of middle) {
            assert.ok(!Array.isArray(item), "middleArgs must not contain nested arrays")
        }
        const cmd = flattenFFArgs(res.args)
        assert.ok(cmd.includes("-metadata title=Track Title"), "must have proper title tag")
        assert.ok(cmd.includes("-metadata artist=Artist Name"), "must have proper artist tag")
        assert.ok(!cmd.includes("-metadata,title="), "must not have comma-joined tag")
    })

    it("纯音频任务不输出 -c:v 视频编码参数", () => {
        const entry = makeEntry()
        const preset = presetOf({
            type: "audio",
            audioArgs: "-c:a aac -b:a 128k",
        })
        const plan = makeHwPlan(cpuTier)
        const res = createFFmpegArgs({ ...entry, preset }, plan)
        const cmd = flattenFFArgs(res.args)
        assert.ok(!cmd.includes("-c:v"), "audio preset must not include -c:v")
        assert.ok(!cmd.includes("libx264"), "audio preset must not include libx264")
    })

    it("videoCodec=copy 自动将 videoCopy 置为 true 并清空滤镜", () => {
        const preset = presetsDefault.createFromArgv({
            preset: "hevc_2k",
            videoCodec: "copy",
        })
        assert.strictEqual(preset.userArgs.videoCopy, true)
        assert.strictEqual(preset.filters, "")
    })

    it("applyFfargs 允许覆盖默认 false 的布尔选项", () => {
        const argv = {
            videoCopy: false,
            audioCopy: false,
        }
        const merged = presetsDefault.applyFfargs(argv, {
            videoCopy: true,
            audioCopy: true,
        })
        assert.strictEqual(merged.videoCopy, true)
        assert.strictEqual(merged.audioCopy, true)
    })
})
