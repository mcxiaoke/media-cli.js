/**
 * lib/gpu.js 硬件预探测列表的回归测试
 *
 * 覆盖项：
 *   - nvidiaGenerationOf 型号 → 代次解析（RTX 40/50/30/20/GTX 16/10/RTX 2050 特例/未知）
 *   - chromaOfPixFmt / bitDepthOfPixFmt 像素格式解析（ffprobe / mediainfo 两种口径）
 *   - normalizeDecodeCodec 源编码归一化
 *   - nvdecSupportOf 解码矩阵查询（关键断言：4:2:2 / 高位深 / AV1 / 未知组合）
 *   - nvencSupportOf 编码矩阵查询（4:2:2 仅 50 系、AV1 仅 40+、B 帧 20 系 partial）
 *   - gpuProbeList 预探测列表生成（结构完整、仅含支持矩阵条目）
 *
 * 不覆盖：真实 GPU 探测（detectGpus）依赖 systeminformation 与具体机器，不放单测。
 */

import assert from "assert"
import { describe, it } from "node:test"

import {
    NVIDIA_GEN,
    chromaOfPixFmt,
    bitDepthOfPixFmt,
    gpuProbeList,
    normalizeDecodeCodec,
    normalizeVendor,
    nvdecSupportOf,
    nvencSupportOf,
    nvidiaGenerationOf,
} from "../lib/gpu.js"
import { GPU_VENDOR_HWACCELS } from "../lib/hwdetect.js"

describe("nvidiaGenerationOf: 型号 → 代次", () => {
    it("resolves all consumer generations", () => {
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 5090"), NVIDIA_GEN.BLACKWELL)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 5080"), NVIDIA_GEN.BLACKWELL)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 4070"), NVIDIA_GEN.ADA)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 4060 Ti"), NVIDIA_GEN.ADA)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 3060"), NVIDIA_GEN.AMPERE)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 2060"), NVIDIA_GEN.TURING)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce GTX 1660 Ti"), NVIDIA_GEN.TURING)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce GTX 1060"), NVIDIA_GEN.PASCAL)
    })

    it("treats RTX 2050 as Ampere (silicon, not Turing)", () => {
        // 名义 20 系、硅片 Ampere：能力等同 30 系，见 docs 口径提醒
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 2050"), NVIDIA_GEN.AMPERE)
    })

    it("resolves mid-tier variants by leading digits (5050/4050/3050)", () => {
        // 前缀逐级匹配：5050→50、4050→40、3050→30，不会跨系错配
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 5050"), NVIDIA_GEN.BLACKWELL)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 5050 Laptop GPU"), NVIDIA_GEN.BLACKWELL)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 4050"), NVIDIA_GEN.ADA)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 4050 Ti"), NVIDIA_GEN.ADA)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 3050"), NVIDIA_GEN.AMPERE)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 3050 Ti"), NVIDIA_GEN.AMPERE)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 2090"), NVIDIA_GEN.TURING)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 2080 Ti"), NVIDIA_GEN.TURING)
    })

    it("returns null for non-NVIDIA or unknown models", () => {
        assert.equal(nvidiaGenerationOf("Intel(R) UHD Graphics 750"), null)
        assert.equal(nvidiaGenerationOf("AMD Radeon RX 6800"), null)
        assert.equal(nvidiaGenerationOf("GameViewer Virtual Display Adapter"), null)
        assert.equal(nvidiaGenerationOf(""), null)
        assert.equal(nvidiaGenerationOf(null), null)
        assert.equal(nvidiaGenerationOf("NVIDIA GeForce RTX 5050 Ti"), NVIDIA_GEN.BLACKWELL)
    })
})

describe("chromaOfPixFmt / bitDepthOfPixFmt: 像素格式解析", () => {
    it("parses ffprobe-style pix fmt", () => {
        assert.equal(chromaOfPixFmt("yuv420p"), "420")
        assert.equal(chromaOfPixFmt("yuv420p10le"), "420")
        assert.equal(chromaOfPixFmt("yuv422p10le"), "422")
        assert.equal(chromaOfPixFmt("yuv444p12le"), "444")
        assert.equal(chromaOfPixFmt("gray"), null)
        assert.equal(chromaOfPixFmt(""), null)
    })

    it("parses medisinfo-style BitDepth with explicit value", () => {
        assert.equal(bitDepthOfPixFmt("YUV4:2:0", 10), 10)
        assert.equal(bitDepthOfPixFmt("YUV4:2:2", 8), 8)
        // 无显式位深时按像素格式串推断
        assert.equal(bitDepthOfPixFmt("yuv420p"), 8)
        assert.equal(bitDepthOfPixFmt("yuv420p10le"), 10)
        assert.equal(bitDepthOfPixFmt("yuv444p12le"), 12)
        assert.equal(bitDepthOfPixFmt("yuv444p16le"), 16)
        assert.equal(bitDepthOfPixFmt("YUV4:2:0"), 8)
    })
})

describe("normalizeDecodeCodec: 源编码归一化", () => {
    it("normalizes common codec aliases", () => {
        assert.equal(normalizeDecodeCodec("h264"), "h264")
        assert.equal(normalizeDecodeCodec("avc1.640028"), "h264")
        assert.equal(normalizeDecodeCodec("hevc"), "hevc")
        assert.equal(normalizeDecodeCodec("hvc1.1.6.L153"), "hevc")
        assert.equal(normalizeDecodeCodec("av01.0.08M.08"), "av1")
        assert.equal(normalizeDecodeCodec("vp09.00.51.08"), "vp9")
        assert.equal(normalizeDecodeCodec("vp8"), "vp8")
        assert.equal(normalizeDecodeCodec("mpeg4"), "mpeg4")
        assert.equal(normalizeDecodeCodec("unknown"), null)
        assert.equal(normalizeDecodeCodec(""), null)
    })
})

describe("nvdecSupportOf: NVDEC 解码矩阵查询", () => {
    it("4:2:2 and high-bitdepth h264 are NO until gen50", () => {
        for (const gen of [
            NVIDIA_GEN.PASCAL,
            NVIDIA_GEN.TURING,
            NVIDIA_GEN.AMPERE,
            NVIDIA_GEN.ADA,
        ]) {
            assert.equal(nvdecSupportOf(gen, "h264", "yuv422p8le"), "no", `gen${gen} h264 4:2:2`)
            assert.equal(
                nvdecSupportOf(gen, "h264", "yuv422p10le"),
                "no",
                `gen${gen} h264 4:2:2 10bit`,
            )
            assert.equal(
                nvdecSupportOf(gen, "h264", "yuv420p10le"),
                "no",
                `gen${gen} h264 4:2:0 10bit`,
            )
            assert.equal(nvdecSupportOf(gen, "hevc", "yuv422p10le"), "no", `gen${gen} hevc 4:2:2`)
        }
        assert.equal(nvdecSupportOf(NVIDIA_GEN.BLACKWELL, "h264", "yuv422p10le"), "yes")
        assert.equal(nvdecSupportOf(NVIDIA_GEN.BLACKWELL, "hevc", "yuv422p10le"), "yes")
    })

    it("hevc 4:4:4 is NO on Pascal, YES on Turing+", () => {
        assert.equal(nvdecSupportOf(NVIDIA_GEN.PASCAL, "hevc", "yuv444p10le"), "no")
        for (const gen of [
            NVIDIA_GEN.TURING,
            NVIDIA_GEN.AMPERE,
            NVIDIA_GEN.ADA,
            NVIDIA_GEN.BLACKWELL,
        ]) {
            assert.equal(nvdecSupportOf(gen, "hevc", "yuv444p10le"), "yes", `gen${gen} hevc 4:4:4`)
        }
    })

    it("av1 decode is NO on Pascal, partial on Turing, YES on Ampere+", () => {
        assert.equal(nvdecSupportOf(NVIDIA_GEN.PASCAL, "av1", "yuv420p"), "no")
        assert.equal(nvdecSupportOf(NVIDIA_GEN.TURING, "av1", "yuv420p"), "partial")
        for (const gen of [NVIDIA_GEN.AMPERE, NVIDIA_GEN.ADA, NVIDIA_GEN.BLACKWELL]) {
            assert.equal(nvdecSupportOf(gen, "av1", "yuv420p"), "yes", `gen${gen} av1`)
        }
    })

    it("legacy codecs are supported everywhere; unknown combos return null", () => {
        for (const gen of [NVIDIA_GEN.PASCAL, NVIDIA_GEN.BLACKWELL]) {
            assert.equal(nvdecSupportOf(gen, "mpeg2", "yuv420p"), "yes")
            assert.equal(nvdecSupportOf(gen, "vc1", "yuv420p"), "yes")
        }
        assert.equal(nvdecSupportOf(NVIDIA_GEN.ADA, "h264", "gray"), null)
        assert.equal(nvdecSupportOf(NVIDIA_GEN.ADA, "unknown_codec", "yuv420p"), null)
        assert.equal(nvdecSupportOf(NVIDIA_GEN.ADA, "", ""), null)
        assert.equal(nvdecSupportOf(null, "h264", "yuv420p"), null)
    })
})

describe("nvencSupportOf: NVENC 编码矩阵查询", () => {
    it("yuv422p encode is NO until gen50 (scale chain makes it irrelevant for probing)", () => {
        for (const gen of [
            NVIDIA_GEN.PASCAL,
            NVIDIA_GEN.TURING,
            NVIDIA_GEN.AMPERE,
            NVIDIA_GEN.ADA,
        ]) {
            assert.equal(nvencSupportOf(gen, "h264", "yuv422p"), "no", `gen${gen} h264 4:2:2`)
            assert.equal(nvencSupportOf(gen, "hevc", "yuv422p"), "no", `gen${gen} hevc 4:2:2`)
        }
        assert.equal(nvencSupportOf(NVIDIA_GEN.BLACKWELL, "h264", "yuv422p"), "yes")
    })

    it("av1 encode requires gen40+; hevc bframe is partial on gen20", () => {
        assert.equal(nvencSupportOf(NVIDIA_GEN.AMPERE, "av1", "yuv420p"), "no")
        assert.equal(nvencSupportOf(NVIDIA_GEN.ADA, "av1", "yuv420p"), "yes")
        assert.equal(nvencSupportOf(NVIDIA_GEN.BLACKWELL, "av1", "yuv420p"), "yes")
        assert.equal(nvencSupportOf(NVIDIA_GEN.PASCAL, "hevc", "bframe"), "no")
        assert.equal(nvencSupportOf(NVIDIA_GEN.TURING, "hevc", "bframe"), "partial")
        assert.equal(nvencSupportOf(NVIDIA_GEN.AMPERE, "hevc", "bframe"), "yes")
    })
})

describe("gpuProbeList: 硬件预探测列表生成", () => {
    it("returns null without an NVIDIA GPU with known generation", () => {
        assert.equal(gpuProbeList([]), null)
        assert.equal(gpuProbeList(null), null)
        assert.equal(gpuProbeList([{ vendor: "intel", model: "UHD 750", generation: null }]), null)
        assert.equal(
            gpuProbeList([
                { vendor: "nvidia", model: "NVIDIA GeForce RTX 4070", generation: null },
            ]),
            null,
        )
    })

    it("builds a complete decode/encode list for gen40 Ada", () => {
        const probe = gpuProbeList([
            { vendor: "intel", model: "UHD 750", generation: null },
            { vendor: "nvidia", model: "NVIDIA GeForce RTX 4070", generation: NVIDIA_GEN.ADA },
        ])
        assert.ok(probe, "probe should exist")
        assert.equal(probe.vendor, "nvidia")
        assert.equal(probe.generation, NVIDIA_GEN.ADA)
        assert.equal(probe.arch, "Ada Lovelace")
        assert.ok(probe.decode.length > 0, "decode list should not be empty")
        assert.ok(probe.encode.length > 0, "encode list should not be empty")

        // gen40 解码列表：h264 4:2:2 应为 no，hevc 4:4:4 应为 yes
        const no = probe.decode.find(
            (d) => d.codec === "h264" && d.chroma === "422" && d.bitDepth === 8,
        )
        assert.equal(no?.support, "no")
        const yes444 = probe.decode.find(
            (d) => d.codec === "hevc" && d.chroma === "444" && d.bitDepth === 8,
        )
        assert.equal(yes444?.support, "yes")
        // gen40 编码列表：av1 应为 yes、h264 4:2:2 应为 no
        const av1 = probe.encode.find((e) => e.codec === "av1")
        assert.equal(av1?.support, "yes")
        const h264 = probe.encode.find((e) => e.codec === "h264" && e.format === "yuv422p")
        assert.equal(h264?.support, "no")
    })

    it("picks the NVIDIA GPU among multiple adapters (vendor priority)", () => {
        const probe = gpuProbeList([
            { vendor: "other", model: "GameViewer Virtual Display Adapter", generation: null },
            { vendor: "intel", model: "UHD 750", generation: null },
            { vendor: "nvidia", model: "NVIDIA GeForce RTX 4070", generation: NVIDIA_GEN.ADA },
        ])
        assert.equal(probe?.generation, NVIDIA_GEN.ADA)
        assert.equal(probe?.model, "NVIDIA GeForce RTX 4070")
    })
})

describe("normalizeVendor: 厂商名归一化", () => {
    it("normalizes common vendor strings", () => {
        assert.equal(normalizeVendor("NVIDIA"), "nvidia")
        assert.equal(normalizeVendor("Advanced Micro Devices, Inc. [AMD/ATI]"), "amd")
        assert.equal(normalizeVendor("Intel Corporation"), "intel")
        assert.equal(normalizeVendor("Microsoft Basic Display Adapter"), "other")
        assert.equal(normalizeVendor(""), "other")
        assert.equal(normalizeVendor(undefined), "other")
    })
})

describe("vendor 值域 ↔ GPU_VENDOR_HWACCELS 白名单键（防漂移）", () => {
    it("normalizeVendor 输出集合与 GPU_VENDOR_HWACCELS 键一一对应", () => {
        // T6：gpu.js 的 vendor 归一化结果直接作为 hwdetect.js 白名单定向键，
        // 两者值域必须完全一致，否则新 vendor 归一化会静默落到 other -> [d3d]。
        const whiteKeys = Object.keys(GPU_VENDOR_HWACCELS).sort()
        const vendorOutputs = ["NVIDIA", "amd", "Intel", "other", "AMD Radeon", "GameViewer"]
            .map((v) => normalizeVendor(v))
            .filter((v, i, arr) => arr.indexOf(v) === i)
            .sort()
        assert.deepStrictEqual(vendorOutputs, whiteKeys)
        assert.deepStrictEqual(whiteKeys, ["amd", "intel", "nvidia", "other"])
    })
})
