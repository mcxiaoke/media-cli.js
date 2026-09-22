/*
 * 源特征归一化单测（docs/ffmpeg/ffmpeg-metadata-fields-20260922.md）
 *
 * 覆盖：位深分级、显示尺寸(SAR)、帧率标称优先、封面流(attached_pic)排除、DRM 兜底
 */
import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { bitDepthOfFormat, fromFFprobeJson, fromMediaInfoJson } from "../lib/media_parser.js"

const ffJson = (videoOver = {}, streamsOver = []) => ({
    format: { format_long_name: "test", size: "1", duration: "1", bit_rate: "1" },
    streams: [
        {
            codec_type: "video",
            codec_name: "h264",
            pix_fmt: "yuv420p",
            width: 1920,
            height: 1080,
            ...videoOver,
        },
        ...streamsOver,
    ],
})

describe("bitDepthOfFormat（位深分级）", () => {
    it("pix_fmt 后缀优先", () => {
        assert.strictEqual(bitDepthOfFormat("yuv420p10le"), 10)
        assert.strictEqual(bitDepthOfFormat("yuv420p12le"), 12)
        assert.strictEqual(bitDepthOfFormat("gray12le"), 12)
        assert.strictEqual(bitDepthOfFormat("yuv444p16le"), 16)
        assert.strictEqual(bitDepthOfFormat("p010le"), 10)
        assert.strictEqual(bitDepthOfFormat("p210le"), 10)
    })
    it("已知 8bit 格式 → 8（不受 bits_per_raw_sample 缺失影响）", () => {
        assert.strictEqual(bitDepthOfFormat("yuv420p"), 8)
        assert.strictEqual(bitDepthOfFormat("yuvj420p"), 8)
        assert.strictEqual(bitDepthOfFormat("nv12"), 8)
        assert.strictEqual(bitDepthOfFormat("gray"), 8)
        assert.strictEqual(bitDepthOfFormat("yuv410p"), 8)
    })
    it("mediainfo 拼接串不含位深 → 用显式 BitDepth", () => {
        assert.strictEqual(bitDepthOfFormat("YUV4:2:0", 10), 10)
        assert.strictEqual(bitDepthOfFormat("YUV4:2:0", "8"), 8)
    })
    it("都判不出 → undefined（不静默按 8bit）", () => {
        assert.strictEqual(bitDepthOfFormat("YUV4:2:0"), undefined)
        assert.strictEqual(bitDepthOfFormat(""), undefined)
        assert.strictEqual(bitDepthOfFormat(undefined, 0), undefined)
    })
})

describe("fromFFprobeJson：位深 / 帧率 / 显示尺寸 / 封面流 / DRM", () => {
    it("10bit 由 pix_fmt 后缀判出（bits_per_raw_sample 缺失也成立）", () => {
        const info = fromFFprobeJson(ffJson({ pix_fmt: "yuv420p10le" }))
        assert.strictEqual(info.video.bitDepth, 10)
    })

    it("帧率：r 离谱时落 avg；r 正常且接近 avg 时用 r（标称）", () => {
        const a = fromFFprobeJson(ffJson({ r_frame_rate: "1200000/1", avg_frame_rate: "25/1" }))
        assert.strictEqual(a.video.framerate, 25)
        const b = fromFFprobeJson(ffJson({ r_frame_rate: "24000/1001", avg_frame_rate: "23.979" }))
        assert.ok(Math.abs(b.video.framerate - 24000 / 1001) < 1e-6, "应取标称 r")
    })

    it("SAR≠1 → width 用显示宽度，并保留 codedWidth", () => {
        const info = fromFFprobeJson(
            ffJson({ width: 352, height: 288, sample_aspect_ratio: "178:163" }),
        )
        assert.strictEqual(info.video.width, Math.round((352 * 178) / 163)) // 384
        assert.strictEqual(info.video.height, 288)
        assert.strictEqual(info.video.codedWidth, 352)
    })

    it("SAR=1 → 不产生 codedWidth（避免无意义字段）", () => {
        const info = fromFFprobeJson(ffJson({ sample_aspect_ratio: "1:1" }))
        assert.strictEqual(info.video.codedWidth, undefined)
        assert.strictEqual(info.video.width, 1920)
    })

    it("attached_pic（封面）不算主视频；全是封面时无 video", () => {
        const main = { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 }
        const cover = {
            codec_type: "video",
            codec_name: "mjpeg",
            width: 320,
            height: 240,
            disposition: { attached_pic: 1 },
        }
        const withMain = fromFFprobeJson(ffJson({}, [main, cover]))
        assert.strictEqual(withMain.video.width, 1920)
        const coverOnly = {
            format: { format_long_name: "mp3", size: "1", duration: "1", bit_rate: "1" },
            streams: [cover, { codec_type: "audio", codec_name: "mp3" }],
        }
        assert.strictEqual(fromFFprobeJson(coverOnly).video, undefined)
    })

    it("视频流缺 codec_name（DRM/加密）→ 抛错以触发 mediainfo 兜底", () => {
        assert.throws(() => fromFFprobeJson(ffJson({ codec_name: undefined })), /no codec_name/)
    })
})

describe("fromMediaInfoJson：位深与显示尺寸", () => {
    const miJson = (videoOver = {}) => ({
        media: {
            track: [
                { "@type": "General", Format: "MPEG-4", FileSize: "1", Duration: "1000" },
                {
                    "@type": "Video",
                    Format: "AVC",
                    Width: "720",
                    Height: "480",
                    ColorSpace: "YUV",
                    ChromaSubsampling: "4:2:0",
                    ...videoOver,
                },
            ],
        },
    })

    it("BitDepth 存在 → 直接用", () => {
        assert.strictEqual(fromMediaInfoJson(miJson({ BitDepth: "10" })).video.bitDepth, 10)
    })

    it("BitDepth 缺失 → undefined（不猜 8bit）", () => {
        assert.strictEqual(fromMediaInfoJson(miJson()).video.bitDepth, undefined)
    })

    it("PixelAspectRatio（十进制）→ 显示宽度", () => {
        const info = fromMediaInfoJson(miJson({ PixelAspectRatio: "1.227" }))
        assert.strictEqual(info.video.width, Math.round(720 * 1.227))
        assert.strictEqual(info.video.codedWidth, 720)
    })
})
