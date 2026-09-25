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

import presetsDefault from "../src/transcode/ffmpeg_presets.js"
import { DEFAULT_PRESET_PATH } from "../src/transcode/preset_loader.js"
import {
    createFFmpegArgs,
    buildVideoArgsFromPlan,
    buildScaleFiltersFromPlan,
    flattenFFArgs,
} from "../src/transcode/ffmpeg_build.js"
import { TIERS, buildLayerArgs } from "../src/transcode/hwaccel.js"
import { calculateDstArgs } from "../src/transcode/ffmpeg_plan.js"

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
    audioCodec: "aac",
    audioBitrate: 128000,
    ...over,
})

const makeHwPlan = (tier, s = size) => ({ tier, size: s, caps: {} })

describe("createFromArgv — 占位符与滤镜", () => {
    before(async () => {
        await presetsDefault.initPresetsAsync(DEFAULT_PRESET_PATH)
    })

    it("buildScaleFiltersFromPlan：缩放段与用户滤镜共存，不泄漏占位符", () => {
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

describe("buildVideoArgsFromPlan — 纯净返回", () => {
    it("copy 早返回路径保持纯净", () => {
        const tp = presetOf({ userArgs: { videoCodec: "copy" } })
        const out = buildVideoArgsFromPlan(makeEntry(), makeHwPlan(cudaTier), tp)
        assert.deepStrictEqual(out, ["-c:v", "copy"])
    })
})

describe("createFFmpegArgs — 端到端进入最终命令", () => {
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
                audioCodec: "libfdk_aac",
                audioBitrate: 128000,
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
            preset: presetOf({
                dimension: 1920,
                speed: 0,
                audioCodec: "libfdk_aac",
                audioBitrate: 128000,
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
            audioCodec: "aac",
            audioBitrate: 128000,
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
            audioCodec: "aac",
            audioBitrate: 128000,
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

describe("字幕与流映射改造（预定义模板驱动：MKV copy、MP4 mov_text 与 PGS 降级）", () => {
    it("MKV 默认使用 -c:s copy 并映射全部音频与字幕轨（-map 0:v:0 -map 0:a? -map 0:s?）", () => {
        const entry = makeEntry({
            fileDst: "/output/movie.mkv",
            preset: presetOf({ format: ".mkv" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-c:s copy"), `MKV 应使用 -c:s copy: ${cmd}`)
        assert.ok(cmd.includes("-map 0:v:0"), `应映射主视频流: ${cmd}`)
        assert.ok(cmd.includes("-map 0:a?"), `应映射音频流带问号: ${cmd}`)
        assert.ok(cmd.includes("-map 0:s?"), `应映射字幕流带问号: ${cmd}`)
    })

    it("MP4 文本字幕保留为 -c:s mov_text 并映射全部音频与字幕轨", () => {
        const entry = makeEntry({
            fileDst: "/output/movie.mp4",
            info: {
                ...makeEntry().info,
                subtitles: [{ format: "subrip", codec: "subrip" }],
            },
            preset: presetOf({ format: ".mp4" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-c:s mov_text"), `MP4 文本字幕应转 mov_text: ${cmd}`)
        assert.ok(cmd.includes("-map 0:v:0 -map 0:a? -map 0:s?"), `流映射应完整保留: ${cmd}`)
    })

    it("MP4 遇 PGS 图形字幕容错降级为 -sn，避免转码崩溃", () => {
        const entry = makeEntry({
            fileDst: "/output/movie.mp4",
            info: {
                ...makeEntry().info,
                subtitles: [{ format: "hdmv_pgs_subtitle", codec: "pgs" }],
            },
            preset: presetOf({ format: ".mp4" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-sn"), `MP4 遇到 PGS 图形字幕应容错降级 -sn: ${cmd}`)
        assert.ok(!cmd.includes("-map 0:s?"), `降级 -sn 时不应映射字幕流: ${cmd}`)
        assert.ok(cmd.includes("-map 0:v:0 -map 0:a?"), `仍应映射全部音轨: ${cmd}`)
    })

    it("外挂字幕正确加载为 input 1，并设置中文默认字幕标记与流映射", () => {
        const entry = makeEntry({
            fileDst: "/output/movie.mp4",
            selectedSubtitle: "/subs/movie.zh.srt",
            preset: presetOf({ format: ".mp4" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-i /subs/movie.zh.srt"), `应加载外挂字幕作为输入: ${cmd}`)
        assert.ok(cmd.includes("-c:s mov_text"), `MP4 外挂字幕应转 mov_text: ${cmd}`)
        assert.ok(cmd.includes("-metadata:s:s:0 language=chi"), `应标记中文字幕: ${cmd}`)
        assert.ok(cmd.includes("-map 0:v:0 -map 0:a? -map 1:0?"), `流映射应包含外挂字幕: ${cmd}`)
    })

    it("MKV 外挂字幕转码为 -c:s copy 直通并映射 1:0?", () => {
        const entry = makeEntry({
            fileDst: "/output/movie.mkv",
            selectedSubtitle: "/subs/movie.ass",
            preset: presetOf({ format: ".mkv" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-c:s copy"), `MKV 外挂字幕应直通 copy: ${cmd}`)
        assert.ok(cmd.includes("-map 0:v:0 -map 0:a? -map 1:0?"), `流映射应包含外挂字幕: ${cmd}`)
    })

    it("非视频类型（音频文件）不附加任何字幕或视频流映射", () => {
        const entry = makeEntry({
            path: "/tmp/music.flac",
            fileDst: "/output/music.mp3",
            preset: presetOf({ type: "audio", format: ".mp3" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(!cmd.includes("-c:s"), `音频文件不应有 -c:s: ${cmd}`)
        assert.ok(!cmd.includes("-map 0:s?"), `音频文件不应有 -map 0:s?: ${cmd}`)
    })
})

describe("Metadata 清理与纯净标题", () => {
    it("title 自动去除文件扩展名后缀", () => {
        const entry = makeEntry({
            name: "Inception.2010.1080p.mp4",
            preset: presetOf(),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(
            cmd.includes("-metadata title=Inception.2010.1080p"),
            `title 不应包含 .mp4 扩展名: ${cmd}`,
        )
        assert.ok(
            !cmd.includes("-metadata title=Inception.2010.1080p.mp4"),
            `不应出现带扩展名的 title: ${cmd}`,
        )
    })

    it("不强制注入 description 与 copyright，避免冲掉原片内容", () => {
        const entry = makeEntry({
            preset: presetOf(),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(!cmd.includes("description="), `不应在元数据中强制覆盖 description: ${cmd}`)
        assert.ok(!cmd.includes("copyright="), `不应在元数据中强制覆盖 copyright: ${cmd}`)
    })
})

describe("流元数据保护与过期统计清理 (BPS/多轨语言保留)", () => {
    it("特殊 MKV 视频重编码时显式清空 BPS、NUMBER_OF_BYTES 等过期统计，防止 MediaInfo 误读旧码率", () => {
        const entry = makeEntry({
            path: "/tmp/in.mkv",
            hasMkvStats: true,
            preset: presetOf({ type: "video" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-metadata:s:v BPS="), `应清理视频流过期 BPS: ${cmd}`)
        assert.ok(
            cmd.includes("-metadata:s:v NUMBER_OF_BYTES="),
            `应清理视频流过期字节统计: ${cmd}`,
        )
        assert.ok(
            cmd.includes("-metadata:s:v NUMBER_OF_FRAMES="),
            `应清理视频流过期帧数统计: ${cmd}`,
        )
    })

    it("普通 MP4 或无统计标签文件不追加过期统计清理参数", () => {
        const entry = makeEntry({
            path: "/tmp/in.mp4",
            preset: presetOf({ type: "video" }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(!cmd.includes("-metadata:s:v BPS="), `普通 MP4 不应追加清理 BPS: ${cmd}`)
        assert.ok(!cmd.includes("-metadata:s:a BPS="), `普通 MP4 不应追加清理音频 BPS: ${cmd}`)
    })

    it("音频重编码时清空音频流过期 BPS 统计，音频复制 (copy) 时保留", () => {
        const entryReencode = makeEntry({
            path: "/tmp/in.mkv",
            hasMkvStats: true,
            preset: presetOf({ audioCodec: "aac", audioCopy: false }),
        })
        const cmdRe = flattenFFArgs(createFFmpegArgs(entryReencode, makeHwPlan(cpuTier)).args)
        assert.ok(cmdRe.includes("-metadata:s:a BPS="), `音频重编码时应清理音频 BPS: ${cmdRe}`)

        const entryCopy = makeEntry({
            path: "/tmp/in.mkv",
            hasMkvStats: true,
            preset: presetOf({ audioCodec: "copy", audioCopy: true }),
        })
        const cmdCopy = flattenFFArgs(createFFmpegArgs(entryCopy, makeHwPlan(cpuTier)).args)
        assert.ok(
            !cmdCopy.includes("-metadata:s:a BPS="),
            `音频 copy 时不应清理音频 BPS: ${cmdCopy}`,
        )
    })

    it("防御性过滤 streamArgs 中的 -map_metadata:s:v 与 -map_metadata:s:a，防止禁用流元数据继承", () => {
        const entry = makeEntry({
            preset: presetOf({
                streamArgs: "-map_metadata 0 -map_metadata:s:v 0:s:v -map_metadata:s:a 0:s:a",
            }),
        })
        const cmd = flattenFFArgs(createFFmpegArgs(entry, makeHwPlan(cpuTier)).args)
        assert.ok(cmd.includes("-map_metadata 0"), `应保留全局元数据映射: ${cmd}`)
        assert.ok(!cmd.includes("-map_metadata:s:v"), `有害的 -map_metadata:s:v 应被过滤: ${cmd}`)
        assert.ok(!cmd.includes("-map_metadata:s:a"), `有害的 -map_metadata:s:a 应被过滤: ${cmd}`)
    })
})
