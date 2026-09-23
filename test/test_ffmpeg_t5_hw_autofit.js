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
    buildScaleFilter,
    buildVideoFilters,
    codecFamilyOf,
    codecFamilyOfPreset,
    probeCacheKey,
    resolveTiers,
    scaleFormatOverride,
    selectTier,
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

    it("cpu + av1 -> libsvtav1 with -b:v 0 (pure CRF)", () => {
        const args = buildEncoderArgs("cpu", { codecFamily: "av1", quality: 30 })
        assert.strictEqual(args[1], "libsvtav1")
        assert.ok(args.includes("-crf"))
        assert.ok(args.includes("-b:v") && args[args.indexOf("-b:v") + 1] === "0")
    })

    it("cpu + h264 -b:v 0 not added (libx264 crf fine without)", () => {
        const args = buildEncoderArgs("cpu", { codecFamily: "h264", quality: 24 })
        assert.strictEqual(args[1], "libx264")
        assert.ok(!args.includes("-b:v"))
    })

    it("bitrate passthrough adds b:v/maxrate/bufsize (cpu branch)", () => {
        const args = buildEncoderArgs("cpu", {
            codecFamily: "h264",
            quality: 24,
            bitrate: 2000000, // bps
        })
        assert.ok(args.includes("-b:v") && args[args.indexOf("-b:v") + 1] === "2000K")
        // maxbitrate 缺省 = bitrate × 1.5
        assert.ok(args.includes("-maxrate") && args[args.indexOf("-maxrate") + 1] === "3000K")
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

describe("buildLayerArgs -> buildProbeArgs bitrate passthrough", () => {
    it("probe args include maxrate/bufsize when bitrate set", () => {
        // buildProbeArgs 内的 buildLayerArgs 会组装同一套滤镜与编码器参数
        const probeArgs = buildProbeArgs({
            tier: cudaTier,
            size,
            speed: 1,
            codecFamily: "h264",
            quality: 28,
            bitrate: 2000000, // bps
            inputPath: "/tmp/in.mp4",
        })
        assert.ok(probeArgs.includes("-b:v"), "probe must carry -b:v")
        assert.ok(probeArgs.includes("-maxrate"), "probe must carry -maxrate")
        assert.strictEqual(probeArgs[probeArgs.indexOf("-b:v") + 1], "2000K")
        // maxbitrate 缺省 = bitrate × 1.5
        assert.strictEqual(probeArgs[probeArgs.indexOf("-maxrate") + 1], "3000K")
    })

    it("layer args without bitrate omit maxrate/bufsize", () => {
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

describe("candidateTiers auto: vendor-directed whitelist + filterSupport prefilter", () => {
    // T6 语义：auto 链 = GPU_VENDOR_HWACCELS[vendor] ∩ caps.hwaccels（-hwaccels 实测）
    //   → usable → filterSupport 预筛 → cpu。
    //   nvidia → [cuda, d3d]；intel → [qsv, d3d]；amd → [amf, d3d]；other/无 → [d3d]
    const nvidiaCaps = {
        gpus: [{ vendor: "nvidia", name: "RTX 4070" }],
        usable: { cuda: true, qsv: true, amf: true, d3d: true, cpu: true },
        filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: true },
    }

    it("nvidia main GPU -> [cuda, d3d, cpu] (vendor-directed)", () => {
        const tiers = candidateTiers(nvidiaCaps, { decodeMode: "auto" })
        assert.ok(tiers.includes("cuda"), "cuda is the primary candidate")
        assert.ok(tiers.includes("d3d"), "d3d is the fallback for nvidia machine")
        assert.deepStrictEqual(tiers, ["cuda", "d3d", "cpu"])
    })

    it("intel main GPU -> [qsv, d3d, cpu]", () => {
        const caps = {
            ...nvidiaCaps,
            gpus: [{ vendor: "intel", name: "UHD 750" }],
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["qsv", "d3d", "cpu"])
    })

    it("amd main GPU -> [amf, d3d, cpu]", () => {
        const caps = {
            ...nvidiaCaps,
            gpus: [{ vendor: "amd", name: "RX 6800" }],
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["amf", "d3d", "cpu"])
    })

    it("no gpus/vendor (legacy caps) -> other directed -> [d3d, cpu]", () => {
        const caps = {
            usable: { cuda: true, qsv: true, amf: true, d3d: true, cpu: true },
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("hwaccels whitelist: missing methods drop that tier (nvidia, only cuda) -> [cuda, cpu]", () => {
        const caps = {
            ...nvidiaCaps,
            hwaccels: ["cuda"], // -hwaccels 无 d3d11va
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["cuda", "cpu"])
    })

    it("hwaccels whitelist: d3d11va only -> [d3d, cpu] (cuda method absent)", () => {
        const caps = {
            ...nvidiaCaps,
            hwaccels: ["d3d11va"],
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("explicit hwaccel=d3d still works (whitelist override)", () => {
        const tiers = candidateTiers(nvidiaCaps, { decodeMode: "auto", hwaccel: "d3d" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("explicit hwaccel=d3d11va still normalizes to d3d layer", () => {
        const tiers = candidateTiers(nvidiaCaps, { decodeMode: "auto", hwaccel: "d3d11va" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("gpu mode with d3d still allowed (explicit)", () => {
        const tiers = candidateTiers(nvidiaCaps, { decodeMode: "gpu", hwaccel: "d3d11va" })
        assert.deepStrictEqual(tiers, ["d3d"])
    })

    it("filterSupport missing scale_cuda -> cuda skipped, d3d kept", () => {
        const caps = {
            ...nvidiaCaps,
            filterSupport: { scale_cuda: false, scale_qsv: true, vpp_amf: true },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("filterSupport missing vpp_amf (old ffmpeg) -> amf skipped on amd machine", () => {
        const caps = {
            ...nvidiaCaps,
            gpus: [{ vendor: "amd", name: "RX 6800" }],
            filterSupport: { scale_cuda: true, scale_qsv: true, vpp_amf: false },
        }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["d3d", "cpu"])
    })

    it("no filterSupport table (legacy caps) -> no prefilter, all kept", () => {
        const caps = { ...nvidiaCaps, filterSupport: undefined }
        const tiers = candidateTiers(caps, { decodeMode: "auto" })
        assert.deepStrictEqual(tiers, ["cuda", "d3d", "cpu"])
    })

    it("unknown hwaccel value -> warn, falls back to default chain (not silent)", () => {
        const tiers = candidateTiers(nvidiaCaps, { decodeMode: "auto", hwaccel: "vulkan" })
        assert.deepStrictEqual(tiers, ["cuda", "d3d", "cpu"])
    })

    it("gpu mode with unknown hwaccel -> throws (value domain narrowed)", () => {
        assert.throws(
            () => candidateTiers(nvidiaCaps, { decodeMode: "gpu", hwaccel: "vulkan" }),
            /requires --hwaccel/,
        )
        assert.throws(() => candidateTiers(nvidiaCaps, { decodeMode: "gpu" }), /requires --hwaccel/)
    })

    it("gpu mode rejects tiers unavailable on this machine", () => {
        const caps = {
            ...nvidiaCaps,
            usable: { cuda: true, qsv: false, amf: false, d3d: false, cpu: true },
        }
        assert.throws(
            () => candidateTiers(caps, { decodeMode: "gpu", hwaccel: "qsv" }),
            /not available/,
        )
    })
})

describe("swdec tier (T7: CPU 解码 + CPU scale + 硬件编码)", () => {
    // 语义：GPU 解码层被拦下时，避免直接落到 libx264/libx265。
    // 实测依据 docs/ffmpeg/ffmpeg-hwaccel-support-matrix-20260921.md §3：
    //   软解 + CPU scale + 硬编 = 1 次 PCIe 拷贝（720p→360p 实测 27.7x）
    //   硬解 + 下载 + CPU scale = 2 次拷贝（17.1x，比纯软解还慢）→ 故本层不加 -hwaccel
    //   libx264 全软 = 10.9x
    const nvCaps = {
        gpus: [{ vendor: "nvidia", name: "RTX 4070" }],
        usable: { cuda: true, qsv: false, amf: false, d3d: true, cpu: true },
        filterSupport: { scale_cuda: true },
        encoders: new Set(["h264_nvenc", "hevc_nvenc", "av1_nvenc", "libx264", "libx265"]),
    }

    it("nv 机器有 nvenc → 插入 swdec（d3d 之前、cpu 之前）", () => {
        assert.deepStrictEqual(candidateTiers(nvCaps, { decodeMode: "auto" }), [
            "cuda",
            "swdec",
            "d3d",
            "cpu",
        ])
    })

    it("intel 机器有 qsv 编码器 → [qsv, swdec, d3d, cpu]", () => {
        const caps = {
            ...nvCaps,
            gpus: [{ vendor: "intel", name: "UHD 750" }],
            usable: { cuda: false, qsv: true, amf: false, d3d: true, cpu: true },
            filterSupport: { scale_qsv: true },
            encoders: new Set(["h264_qsv", "hevc_qsv", "libx264"]),
        }
        assert.deepStrictEqual(candidateTiers(caps, { decodeMode: "auto" }), [
            "qsv",
            "swdec",
            "d3d",
            "cpu",
        ])
    })

    it("无 encoders 字段（旧 caps）→ 不插入，保持旧链（向后兼容）", () => {
        const caps = { ...nvCaps, encoders: undefined }
        assert.deepStrictEqual(candidateTiers(caps, { decodeMode: "auto" }), ["cuda", "d3d", "cpu"])
    })

    it("本机无该厂商硬件编码器 → 不插入", () => {
        const caps = { ...nvCaps, encoders: new Set(["libx264", "libx265"]) }
        assert.deepStrictEqual(candidateTiers(caps, { decodeMode: "auto" }), ["cuda", "d3d", "cpu"])
    })

    it("decodeMode=cpu → 不插入（显式全软意图保留）", () => {
        assert.deepStrictEqual(candidateTiers(nvCaps, { decodeMode: "cpu" }), ["cpu"])
    })

    it("显式 --hwaccel cuda → 不加 swdec（显式层不扩展）", () => {
        assert.deepStrictEqual(candidateTiers(nvCaps, { decodeMode: "auto", hwaccel: "cuda" }), [
            "cuda",
            "cpu",
        ])
    })

    it("resolveTiers 按厂商注入编码器行：nvidia→nvenc / intel→qsv / amd→amf", () => {
        // 三厂商各自带自己的硬件编码器（swdec 只查编码器，与解码能力无关）
        const capsOf = (vendor, encoders, usable) => ({
            gpus: [{ vendor }],
            usable: { cuda: false, qsv: false, amf: false, d3d: true, cpu: true, ...usable },
            filterSupport: { scale_cuda: true },
            encoders: new Set(encoders),
        })
        const swdecOf = (caps) =>
            resolveTiers({ caps, decodeMode: "auto" }).find((t) => t.name === "swdec")
        assert.strictEqual(swdecOf(nvCaps).encoderRow.h264, "h264_nvenc")
        assert.strictEqual(
            swdecOf(capsOf("intel", ["h264_qsv", "hevc_qsv"])).encoderRow.h264,
            "h264_qsv",
        )
        assert.strictEqual(
            swdecOf(capsOf("amd", ["h264_amf", "hevc_amf"])).encoderRow.h264,
            "h264_amf",
        )
        // swdec 层本身不启用任何硬件解码
        assert.strictEqual(swdecOf(nvCaps).hwaccel, null)
        assert.strictEqual(swdecOf(nvCaps).hwFormat, null)
        assert.strictEqual(swdecOf(nvCaps).filter, "scale")
    })

    it("buildEncoderArgs(swdec, {tier}) 用注入行（nvenc 编码器 + nvenc 质量参数）", () => {
        const tier = resolveTiers({ caps: nvCaps, decodeMode: "auto" }).find(
            (t) => t.name === "swdec",
        )
        const args = buildEncoderArgs("swdec", { quality: 28, codecFamily: "h264", tier })
        assert.strictEqual(args[1], "h264_nvenc")
        assert.ok(args.includes("-cq"), "nvenc 质量参数")
        assert.ok(!args.includes("-crf"), "不应出现 x264 的 -crf")
    })

    it("无 tier 注入时 swdec 退回 CPU 行（安全兜底）", () => {
        const args = buildEncoderArgs("swdec", { quality: 28, codecFamily: "h264" })
        assert.strictEqual(args[1], "libx264")
    })

    it("质量按实际编码器换算：swdec(nvenc) 与 cuda 层一致，与 cpu 层不同", () => {
        const tier = resolveTiers({ caps: nvCaps, decodeMode: "auto" }).find(
            (t) => t.name === "swdec",
        )
        const sw = buildEncoderArgs("swdec", { quality: 28, codecFamily: "h264", tier })
        const cuda = buildEncoderArgs("cuda", { quality: 28, codecFamily: "h264" })
        const cpu = buildEncoderArgs("cpu", { quality: 28, codecFamily: "h264" })
        const q = (a) => (a.includes("-cq") ? a[a.indexOf("-cq") + 1] : a[a.indexOf("-crf") + 1])
        assert.strictEqual(q(sw), q(cuda), "同实现（nvenc）质量值必须一致")
        assert.notStrictEqual(q(sw), q(cpu), "nvenc 有标定偏移，不应等于 x264 基准")
    })

    it("10bit 源 + h264 族 → 注入 -pix_fmt yuv420p（硬件编码器不吃 10bit 输入）", () => {
        const args = buildEncoderArgs("swdec", {
            quality: 28,
            codecFamily: "h264",
            pixFmt: "yuv420p10le",
        })
        assert.ok(args.includes("-pix_fmt"), "-pix_fmt present")
        assert.strictEqual(args[args.indexOf("-pix_fmt") + 1], "yuv420p")
    })

    it("8bit 源 / hevc 族 → 不注入 -pix_fmt", () => {
        const a = buildEncoderArgs("swdec", { quality: 28, codecFamily: "h264", pixFmt: "yuv420p" })
        assert.ok(!a.includes("-pix_fmt"), "8bit 源无需降位深")
        const b = buildEncoderArgs("swdec", {
            quality: 28,
            codecFamily: "hevc",
            pixFmt: "yuv420p10le",
        })
        assert.ok(!b.includes("-pix_fmt"), "hevc 编码器可直接吃 p010")
    })

    it("swdec 层不加 -hwaccel（整链留在内存，1 次上传）", () => {
        const tier = resolveTiers({ caps: nvCaps, decodeMode: "auto" }).find(
            (t) => t.name === "swdec",
        )
        const { inputArgs } = buildLayerArgs({
            tier,
            size,
            pixFmt: "yuv420p",
            codecFamily: "h264",
        })
        assert.deepStrictEqual(inputArgs, [], "不得出现 -hwaccel / -hwaccel_output_format")
    })

    it("strict 模式不把 swdec 当硬件层（要求硬件解码，缺失时抛错）", async () => {
        // 链里只剩 swdec/cpu（本机无可用硬件解码层）→ strict 应拒绝
        const caps = {
            ...nvCaps,
            usable: { cuda: false, qsv: false, amf: false, d3d: false, cpu: true },
        }
        await assert.rejects(
            () =>
                selectTier({
                    caps,
                    inputPath: "dummy.mp4",
                    srcW: 1280,
                    srcH: 720,
                    pixFmt: "yuv420p",
                    codec: "h264",
                    dimension: 720,
                    strict: true,
                }),
            /no hardware acceleration tier available/,
        )
    })
})

describe("10bit 源 + h264 目标的位深对齐（scale 的 format=nv12 选项）", () => {
    // 背景：h264_nvenc / h264_qsv 不吃 10bit 输入（-h encoder 列出的 p010le 实测不支持），
    // 不对齐则「10bit 源 + h264 预设」整链失败落 libx264。
    // 解法：把 10bit→8bit 放进 scale 的 format= 选项（帧仍是硬件帧，0 拷贝）；
    //       独立 format 滤镜 / -pix_fmt 都要求出显存，是错的。
    const cudaTierObj = TIERS.find((t) => t.name === "cuda")
    const qsvTierObj = TIERS.find((t) => t.name === "qsv")
    const cpuTierObj = TIERS.find((t) => t.name === "cpu")
    const swdecTierObj = TIERS.find((t) => t.name === "swdec")

    it("无覆盖时保持旧串（回归保护）", () => {
        assert.strictEqual(
            buildScaleFilter(cudaTierObj, size),
            "scale_cuda=w=1920:h=1080:interp_algo=lanczos,format=cuda",
        )
        assert.strictEqual(buildScaleFilter(qsvTierObj, size), "scale_qsv=w=1920:h=1080:mode=hq")
        assert.strictEqual(buildScaleFilter(cpuTierObj, size), "scale=w=1920:h=1080:flags=lanczos")
    })

    it("覆盖格式并入 scale 的选项段，尾部独立滤镜保留", () => {
        assert.strictEqual(
            buildScaleFilter(cudaTierObj, size, "nv12"),
            "scale_cuda=w=1920:h=1080:interp_algo=lanczos:format=nv12,format=cuda",
        )
        assert.strictEqual(
            buildScaleFilter(qsvTierObj, size, "nv12"),
            "scale_qsv=w=1920:h=1080:mode=hq:format=nv12",
        )
    })

    it("scaleFormatOverride：仅 cuda/qsv + h264 + 10bit 才覆盖", () => {
        assert.strictEqual(
            scaleFormatOverride(cudaTierObj, { codecFamily: "h264", pixFmt: "yuv420p10le" }),
            "nv12",
        )
        assert.strictEqual(
            scaleFormatOverride(qsvTierObj, { codecFamily: "h264", pixFmt: "yuv420p10le" }),
            "nv12",
        )
        // 8bit 源不需要
        assert.strictEqual(
            scaleFormatOverride(cudaTierObj, { codecFamily: "h264", pixFmt: "yuv420p" }),
            undefined,
        )
        // hevc 族编码器可直接吃 p010
        assert.strictEqual(
            scaleFormatOverride(cudaTierObj, { codecFamily: "hevc", pixFmt: "yuv420p10le" }),
            undefined,
        )
        // 非硬件帧链路（d3d/swdec/cpu）由 -pix_fmt 处理，不在此覆盖
        for (const t of [cpuTierObj, swdecTierObj, TIERS.find((x) => x.name === "d3d")]) {
            assert.strictEqual(
                scaleFormatOverride(t, { codecFamily: "h264", pixFmt: "yuv420p10le" }),
                undefined,
            )
        }
    })

    it("mediainfo 风格：pixelFormat 不含位深，靠显式 bitDepth 判定", () => {
        assert.strictEqual(
            scaleFormatOverride(cudaTierObj, {
                codecFamily: "h264",
                pixFmt: "YUV4:2:0",
                bitDepth: 10,
            }),
            "nv12",
        )
        assert.strictEqual(
            scaleFormatOverride(cudaTierObj, {
                codecFamily: "h264",
                pixFmt: "YUV4:2:0",
                bitDepth: 8,
            }),
            undefined,
        )
    })

    it("buildVideoFilters：10bit+h264 链中出现 format=nv12，8bit 不出现", () => {
        const ten = buildVideoFilters({
            tier: cudaTierObj,
            size,
            codecFamily: "h264",
            pixFmt: "yuv420p10le",
        })
        assert.ok(ten.includes(":format=nv12"), ten)
        const eight = buildVideoFilters({
            tier: cudaTierObj,
            size,
            codecFamily: "h264",
            pixFmt: "yuv420p",
        })
        assert.ok(!eight.includes("format=nv12"), eight)
    })

    it("无缩放时仍输出对齐滤镜（1:1，不带 w/h）", () => {
        const chain = buildVideoFilters({
            tier: cudaTierObj,
            size,
            hasScale: false,
            codecFamily: "h264",
            pixFmt: "yuv420p10le",
        })
        assert.strictEqual(chain, "scale_cuda=interp_algo=lanczos:format=nv12,format=cuda")
        // 无对齐需求时，无缩放 = 不输出任何滤镜（旧行为不变）
        assert.strictEqual(
            buildVideoFilters({
                tier: cudaTierObj,
                size,
                hasScale: false,
                codecFamily: "h264",
                pixFmt: "yuv420p",
            }),
            "",
        )
    })

    it("探测命令与真实命令同构：buildLayerArgs 也带对齐", () => {
        const { outputArgs } = buildLayerArgs({
            tier: cudaTierObj,
            size,
            codecFamily: "h264",
            pixFmt: "yuv420p10le",
        })
        const vf = outputArgs[outputArgs.indexOf("-vf") + 1]
        assert.ok(vf.includes("scale_cuda=w=1920:h=1080:interp_algo=lanczos:format=nv12"), vf)
        // 探测入口（buildProbeArgs）走同一条链路
        const probe = buildProbeArgs({
            tier: cudaTierObj,
            inputPath: "in.mp4",
            size,
            codecFamily: "h264",
            pixFmt: "yuv420p10le",
            bitDepth: 10,
        })
        assert.ok(
            probe.some((a) => String(a).includes(":format=nv12")),
            "probe args 含对齐",
        )
    })
})
