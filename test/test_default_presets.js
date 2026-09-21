/**
 * 内置默认预设（presets/default.yaml）单测（Phase 1：预设单源化）
 *
 * 覆盖项：
 *   - default.yaml 随包存在且可被加载（通过模块内默认路径）
 *   - 公开预设名与预期的 21 个内置预设一致（QSV 示例不在其中）
 *   - 每个预设都能经 FFmpegPreset 构造器构造（字段类型与构造器契约匹配）
 *   - 视频预设 S-4 语义：videoArgs 不含 -c:v，filters 为 "{scaleFilter}"
 *     （hevc_speed 的 complexFilter 豁免：Phase 2 模板化）
 *   - getAllNames 返回副本（push 不影响内部状态）
 *   - 音频预设不受 S-4 影响
 *
 * 隔离策略：不调用 initPresetsAsync 全链（避免命中真实 ~/.mediac），
 * 直接用 DEFAULT_PRESET_PATH 单文件加载 + mergePresets 在空表上合并。
 */

import assert from "assert"
import fs from "fs-extra"
import { describe, it } from "node:test"

import presetsDefault from "../lib/ffmpeg_presets.js"
import { DEFAULT_PRESET_PATH } from "../lib/preset_loader.js"
import { loadPresetsFromYaml, mergePresets } from "../lib/preset_loader.js"

// 与 Phase 1 迁移清单一致的预期公开预设名（21 个内置，不含 QSV 新增示例）
const EXPECTED_PUBLIC_PRESETS = [
    "h264_2k",
    "h264_2km",
    "h264_2kl",
    "hevc_4ku",
    "hevc_4k",
    "hevc_4kl",
    "hevc_4kt",
    "hevc_2ku",
    "hevc_2kh",
    "hevc_2k",
    "hevc_2km",
    "hevc_2kl",
    "hevc_2kt",
    "hevc_speed",
    "audio_extract",
    "aac_high",
    "aac_medium",
    "aac_low",
    "aac_he",
    "aac_vbr",
    "aac_voice",
]

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

    it("loads exactly the 21 built-in public presets (no QSV examples, no _base)", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        assert.ok(layer, "default layer should load")
        const names = Object.keys(layer.presets).filter((n) => !n.startsWith("_"))
        assert.deepStrictEqual(names.sort(), [...EXPECTED_PUBLIC_PRESETS].sort())
    })

    it("merges the default layer into an empty map without warnings about _override", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        assert.strictEqual(merged.size, EXPECTED_PUBLIC_PRESETS.length)
        for (const name of EXPECTED_PUBLIC_PRESETS) {
            assert.ok(merged.has(name), `${name} should be registered from default layer`)
        }
        // 私有基类不注册
        for (const name of Object.keys(merged)) {
            assert.ok(!name.startsWith("_"), `_ prefix should be filtered: ${name}`)
        }
    })

    it("every built-in preset can be constructed as FFmpegPreset", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        const { FFmpegPreset } = presetsDefault
        for (const [name, preset] of merged) {
            const fp = new FFmpegPreset(name, preset)
            assert.strictEqual(fp.name, name, `${name}: name mismatch`)
            assert.ok(fp.format, `${name}: format should be set`)
            assert.ok(fp.type, `${name}: type should be set`)
        }
    })

    it("video presets follow S-4: no -c:v in videoArgs, filters is {scaleFilter}", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        const videoNames = EXPECTED_PUBLIC_PRESETS.filter((n) => merged.get(n)?.type === "video")
        assert.ok(videoNames.length >= 10, "should have video presets")
        for (const name of videoNames) {
            const p = merged.get(name)
            assert.ok(!p.videoArgs.includes("-c:v"), `${name}: videoArgs must not hardcode -c:v`)
            // complexFilter 存在时缩放写在 complexFilter 里（hevc_speed，Phase 2 模板化）：
            // {scaleFilter} 占位符由分层按 tier 现算替换，不再有字面量 scale_cuda / {dimension}
            if (!p.complexFilter) {
                assert.strictEqual(
                    p.filters,
                    "{scaleFilter}",
                    `${name}: filters should be {scaleFilter}`,
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
    })

    it("audio presets keep original audioArgs behavior", async () => {
        const layer = await loadPresetsFromYaml(DEFAULT_PRESET_PATH)
        const merged = mergePresets(new Map(), layer)
        for (const name of EXPECTED_PUBLIC_PRESETS) {
            const p = merged.get(name)
            if (p.type === "audio") {
                assert.ok(p.audioArgs.includes("-c:a"), `${name}: audioArgs should keep -c:a`)
            }
        }
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
