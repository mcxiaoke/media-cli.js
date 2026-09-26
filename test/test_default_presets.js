/**
 * 内置默认预设（presets/default.yaml）单测
 *
 * 设计原则：**不写死预设总数**（那只会强迫每次增删预设都来改测试，
 * 不带来任何真实保护）。改守三类有意义的不变式：
 *   1. 关键规范名必须存在（MUST_EXIST）—— 防误删/重命名；同族新增不受影响。
 *   2. 每个 codec 族至少一个公开预设（REQUIRED_CODEC_FAMILIES）—— 防无声漏族。
 *   3. 结构不变式 —— 遍历**全部**已注册预设（不再只跑硬编码清单）：
 *        · default.yaml 随包存在、模块相对路径可解析
 *        · `_base_*` 模板不外泄到已注册集
 *        · 每个预设能经 FFmpegPreset 构造器构造
 *        · 视频预设符合 S-4：videoArgs 字段已彻底移除、videoCodecFamily 显式声明、
 *          无 complexFilter 时 filters === "{scaleFilter}"；有 complexFilter 时
 *          含 "{scaleFilter}" 模板且不含字面量 scale_cuda
 *        · 音频预设经 audioCodec / audioBitrate 结构化声明（audioArgs 已废弃）
 *        · getAllNames 返回副本
 *
 * 隔离策略：不调用 initPresetsAsync 全链（避免命中真实 ~/.mediac），
 * 直接用 DEFAULT_PRESET_PATH 单文件加载 + mergePresets 在空表上合并。
 */

import assert from "assert"
import fs from "fs-extra"
import { describe, it } from "node:test"

import presetsDefault from "../src/transcode/ffmpeg_presets.js"
import { DEFAULT_PRESET_PATH } from "../src/transcode/preset_loader.js"
import { loadPresetsFromYaml, mergePresets } from "../src/transcode/preset_loader.js"

// 关键规范名：各 codec 族的代表 + 场景/音频核心名。
// 语义是「这些名字不许悄悄消失」；新增同族预设不触发失败。
const MUST_EXIST_PRESETS = [
    // 视频族代表
    "h264_2k",
    "h264_4k",
    "hevc_2k",
    "hevc_4k",
    "av1_2k",
    "vp9_2k",
    // 音频族
    "audio_extract",
    "aac_high",
    "aac_medium",
    "aac_low",
    "aac_he",
    "aac_voice",
]

// codec 族覆盖：新增族要显式登记本表（防无声遗漏）。
const REQUIRED_CODEC_FAMILIES = {
    h264: /^h264_/,
    hevc: /^hevc_/,
    av1: /^av1_/,
    vp9: /^vp9_/,
    aac: /^aac_/,
}

describe("presets/default.yaml (built-in layer)", () => {
    it("default.yaml exists at the expected module-relative path", async () => {
        const exists = fs.pathExistsSync(DEFAULT_PRESET_PATH)
        assert.ok(exists, `default.yaml should exist at ${DEFAULT_PRESET_PATH}`)
        // 指向包内 presets 目录（模块相对定位，不依赖 cwd）
        assert.ok(DEFAULT_PRESET_PATH.includes("presets"), "path should mention presets dir")
        assert.ok(DEFAULT_PRESET_PATH.endsWith("default.yaml"), "path should end with default.yaml")
        assert.ok(
            !DEFAULT_PRESET_PATH.includes("presets.example.yaml"),
            "example must not be a search path",
        )
    })

    it("registers all must-exist presets, covers each codec family, and hides _base_* from the public set", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        assert.ok(layer, "default layer should load")
        const publicNames = Object.keys(layer.presets).filter((n) => !n.startsWith("_"))

        for (const name of MUST_EXIST_PRESETS) {
            assert.ok(publicNames.includes(name), `must-exist preset missing: ${name}`)
        }
        for (const name of publicNames) {
            assert.ok(!name.startsWith("_"), `_ prefix must not be public: ${name}`)
        }
        for (const [fam, re] of Object.entries(REQUIRED_CODEC_FAMILIES)) {
            assert.ok(
                publicNames.some((n) => re.test(n)),
                `no public preset registered for codec family: ${fam}`,
            )
        }
    })

    it("merges the default layer into an empty map (set identity, no _override noise)", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        // 不写死数量，只断言「集合恒等」：YAML 里的公开键 == 合并后的键
        const publicNames = Object.keys(layer.presets).filter((n) => !n.startsWith("_"))
        assert.strictEqual(merged.size, publicNames.length)
        for (const name of publicNames) {
            assert.ok(merged.has(name), `${name} should be registered from default layer`)
        }
        for (const name of merged.keys()) {
            assert.ok(!name.startsWith("_"), `_ prefix should be filtered: ${name}`)
        }
    })

    it("every built-in preset can be constructed as FFmpegPreset", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        const { FFmpegPreset } = presetsDefault
        assert.ok(merged.size > 0, "no presets merged (loader regression?)")
        for (const [name, preset] of merged) {
            const fp = new FFmpegPreset(name, preset)
            assert.strictEqual(fp.name, name, `${name}: name mismatch`)
            assert.ok(fp.format, `${name}: format should be set`)
            assert.ok(fp.type, `${name}: type should be set`)
        }
    })

    it("all video presets follow S-4 (no -c:v in videoArgs, explicit videoCodecFamily, {scaleFilter})", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        let checked = 0
        for (const [name, p] of merged) {
            if (p.type !== "video") continue
            checked++
            // videoArgs 已彻底移除
            assert.strictEqual(
                p.videoArgs,
                undefined,
                `${name}: videoArgs must be completely removed`,
            )
            // 必须显式声明 codec 族（不再靠 videoArgs 反推）
            assert.ok(p.videoCodecFamily, `${name}: videoCodecFamily must be declared (S-4)`)
            if (!p.complexFilter) {
                assert.strictEqual(
                    p.filters,
                    "{scaleFilter}",
                    `${name}: filters should be {scaleFilter} placeholder`,
                )
            } else {
                assert.ok(
                    p.complexFilter.includes("{scaleFilter}"),
                    `${name}: complexFilter should use {scaleFilter} template`,
                )
                assert.ok(
                    !p.complexFilter.includes("scale_cuda"),
                    `${name}: complexFilter must not hardcode scale_cuda`,
                )
            }
        }
        // 至少覆盖到 codec 族数（视频族 = 除 aac 之外的族）
        const videoFamilies = Object.keys(REQUIRED_CODEC_FAMILIES).filter((f) => f !== "aac").length
        assert.ok(
            checked >= videoFamilies,
            `expected at least ${videoFamilies} video presets, got ${checked}`,
        )
    })

    it("all audio presets have valid audioCodec defined", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        let checked = 0
        for (const [name, p] of merged) {
            if (p.type !== "audio") continue
            checked++
            assert.ok(
                p.audioCodec && typeof p.audioCodec === "string",
                `${name}: audioCodec should be defined as a string`,
            )
        }
        assert.ok(checked >= 1, "should have audio presets")
    })

    it("getAllNames returns a snapshot copy (mutation does not affect internal state)", async () => {
        const names = presetsDefault.getAllNames()
        const before = names.length
        names.push("HACKED")
        assert.ok(names.includes("HACKED"))
        assert.strictEqual(presetsDefault.getAllNames().length, before)
        assert.ok(!presetsDefault.getAllNames().includes("HACKED"))
    })
})
