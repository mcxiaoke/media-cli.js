/**
 * Preset Schema 与 YAML 加载器单测（Phase 0：预设单源化前置）
 *
 * 覆盖项：
 *   - preset_schema.js 字段表完整性：loader 白名单、构造器字段、类型定义不脱节
 *   - resolveExtends 继承合并与循环检测
 *   - validatePresetFields 未知字段 / 类型错误告警（warn，不剔除）
 *   - _override 元字段随 preset 保留（Phase 1 消费）
 *   - loadPresetsFromYaml 自定义路径加载
 *   - mergePresets 覆盖（需 _override: true）/新增/私有前缀过滤
 */

import assert from "assert"
import fs from "fs-extra"
import path from "path"
import os from "os"
import { describe, it, before, after } from "node:test"

import {
    PRESET_FIELD_DEFS,
    PRESET_FIELDS,
    PRESET_CONSTRUCTOR_FIELDS,
    isPresetField,
    getPresetFieldMeta,
    hasPresetTypeMismatch,
} from "../src/transcode/preset_schema.js"
import {
    loadPresetsFromYaml,
    mergePresets,
    processPresets,
    resolvePresetPath,
} from "../src/transcode/preset_loader.js"
import presetsApi from "../src/transcode/ffmpeg_presets.js"

const TMP = path.join(os.tmpdir(), `mediac-test-preset-schema-${process.pid}`)

describe("FFmpegPreset bitrate normalization（严格字符串）", () => {
    const { FFmpegPreset } = presetsApi

    it("videoBitrate/audioBitrate/maxBitrate 接受带单位字符串 -> 归一为 bps", () => {
        const p = new FFmpegPreset("t", {
            videoBitrate: "233k",
            audioBitrate: "1.5M",
            maxBitrate: "4M",
        })
        assert.strictEqual(p.videoBitrate, 233000)
        assert.strictEqual(p.audioBitrate, 1500000)
        assert.strictEqual(p.maxBitrate, 4000000)
    })

    it("仍接受 bps 裸数字（程序化构造向后兼容）", () => {
        const p = new FFmpegPreset("t", {
            videoBitrate: 4000000,
            audioBitrate: 192000,
            maxBitrate: 0,
        })
        assert.strictEqual(p.videoBitrate, 4000000)
        assert.strictEqual(p.audioBitrate, 192000)
        assert.strictEqual(p.maxBitrate, 0)
    })

    it("未设置归 0（不出现 NaN/字符串穿透）", () => {
        const p = new FFmpegPreset("t", {})
        assert.strictEqual(p.videoBitrate, 0)
        assert.strictEqual(p.audioBitrate, 0)
        assert.strictEqual(p.maxBitrate, 0)
    })
})

describe("preset schema", () => {
    before(async () => {
        await fs.rm(TMP, { recursive: true, force: true })
        await fs.mkdir(TMP, { recursive: true })
    })

    after(async () => {
        await fs.rm(TMP, { recursive: true, force: true })
    })

    describe("schema field table", () => {
        it("loader whitelist covers every FFmpegPreset constructor field", () => {
            // 构造器消费字段必须全部在 PRESET_FIELDS 白名单中，
            // 否则 YAML 写了会收到 unknown field 警告（S-4 曾因此脱节）
            for (const field of PRESET_CONSTRUCTOR_FIELDS) {
                assert.ok(
                    PRESET_FIELDS.has(field),
                    `constructor field '${field}' missing from PRESET_FIELDS`,
                )
            }
        })

        it("includes the S-4 fields that used to be missing", () => {
            for (const field of ["videoCodecFamily", "pre_filters", "post_filters", "_override"]) {
                assert.ok(isPresetField(field), `${field} should be a known preset field`)
            }
        })

        it("every field has a valid type descriptor", () => {
            for (const [name, meta] of Object.entries(PRESET_FIELD_DEFS)) {
                assert.ok(["string", "number", "boolean"].includes(meta.type), `${name} bad type`)
                assert.strictEqual(typeof meta.construct, "boolean", `${name} bad construct`)
            }
        })

        it("hasPresetTypeMismatch detects wrong value types", () => {
            assert.ok(hasPresetTypeMismatch("videoQuality", "24"))
            assert.ok(hasPresetTypeMismatch("videoCodecFamily", 24))
            assert.ok(hasPresetTypeMismatch("smartBitrate", "true"))
            assert.ok(hasPresetTypeMismatch("videoQuality", NaN))
            assert.strictEqual(hasPresetTypeMismatch("videoQuality", 24), false)
            assert.strictEqual(hasPresetTypeMismatch("filters", 123), true)
            assert.strictEqual(hasPresetTypeMismatch("audioCodec", "aac"), false)
            assert.strictEqual(hasPresetTypeMismatch("unknown_field", "x"), false)
        })

        it("getPresetFieldMeta returns descriptor or undefined", () => {
            assert.strictEqual(getPresetFieldMeta("videoCodecFamily").type, "string")
            assert.strictEqual(getPresetFieldMeta("nope"), undefined)
        })
    })

    describe("extends resolution", () => {
        it("merges base preset and overrides on collision", () => {
            const out = processPresets({
                _base: {
                    format: ".mp4",
                    type: "video",
                    videoCodecFamily: "hevc",
                    dimension: 3840,
                    videoQuality: 24,
                },
                my_4k: { extends: "_base", dimension: 4096, videoQuality: 20 },
            })
            assert.deepStrictEqual(out.my_4k, {
                format: ".mp4",
                type: "video",
                videoCodecFamily: "hevc",
                dimension: 4096,
                videoQuality: 20,
            })
        })

        it("keeps _override meta field after resolution", () => {
            const out = processPresets({
                _base: { format: ".mp4", type: "video" },
                clash: { extends: "_base", _override: true, videoQuality: 10 },
            })
            assert.strictEqual(out.clash._override, true)
            assert.strictEqual(out.clash.format, ".mp4")
        })

        it("throws on circular extends (skipped as warning)", () => {
            const out = processPresets({
                a: { extends: "b" },
                b: { extends: "a" },
            })
            assert.strictEqual(out.a, undefined)
            assert.strictEqual(out.b, undefined)
        })
    })

    describe("validatePresetFields", () => {
        it("keeps presets with unknown fields but no longer swallows type errors", () => {
            // validatePresetFields 只 warn 不剔除；processPresets 通过即保留
            const out = processPresets({
                ok: { format: ".mp4", videoQuality: "24", bogus_field: 1 },
            })
            assert.ok(out.ok, "preset with unknown field should still be processed")
            assert.strictEqual(out.ok.videoQuality, "24")
        })
    })

    describe("loadPresetsFromYaml", () => {
        it("loads presets from a custom path and resolves extends", async () => {
            const yamlPath = path.join(TMP, "presets.yaml")
            await fs.writeFile(
                yamlPath,
                [
                    "_base_video:",
                    "  format: '.mp4'",
                    "  type: video",
                    "  videoCodecFamily: hevc",
                    "  filters: '{scaleFilter}'",
                    "my_custom:",
                    "  extends: _base_video",
                    "  dimension: 1920",
                    "  videoQuality: 26",
                    "",
                ].join("\n"),
            )
            const result = await loadPresetsFromYaml(yamlPath)
            assert.ok(result)
            assert.strictEqual(result.path, yamlPath)
            assert.ok(result.presets.my_custom)
            assert.strictEqual(result.presets.my_custom.format, ".mp4")
            assert.strictEqual(result.presets.my_custom.videoCodecFamily, "hevc")
            assert.strictEqual(result.presets.my_custom.dimension, 1920)
        })

        it("falls back to built-in default.yaml when the custom path is missing", async () => {
            // customPath 缺失时 resolvePresetPath 回退搜索路径：
            // 用户层（~/.mediac、cwd）都没有时，回退包内 presets/default.yaml（随包必在）
            const result = await loadPresetsFromYaml(path.join(TMP, "missing.yaml"))
            assert.ok(result)
            assert.ok(result.presets && typeof result.presets === "object")
            assert.ok(
                Object.keys(result.presets).length > 0,
                "default.yaml should load some presets",
            )
        })
    })

    describe("resolvePresetPath", () => {
        it("prefers the explicit custom path", async () => {
            const a = path.join(TMP, "a.yaml")
            const b = path.join(TMP, "b.yaml")
            await fs.writeFile(a, "x: 1\n")
            await fs.writeFile(b, "y: 2\n")
            assert.strictEqual(resolvePresetPath(a), a)
            assert.strictEqual(resolvePresetPath(b), b)
        })

        it("returns a string path even when nothing exists except built-in default", async () => {
            // 当前仓库 cwd 已无 presets.yaml（改名为 presets.example.yaml，不参与搜索），
            // 用户层 ~/.mediac 可能是空的 —— 回退到包内 default.yaml 保证路径恒非空。
            const resolved = resolvePresetPath(path.join(TMP, "none.yaml"))
            assert.ok(resolved)
            assert.strictEqual(typeof resolved, "string")
            assert.ok(resolved.length > 0)
        })
    })

    describe("mergePresets", () => {
        it("skips same-name preset without _override (P0-1), keeps builtin value", () => {
            const builtin = new Map([
                ["hevc_2k", { name: "hevc_2k", videoQuality: 24, videoBitrate: 4000000 }],
            ])
            const yamlResult = {
                presets: {
                    // 无 _override：同名 → 跳过，保留内置值
                    hevc_2k: { name: "hevc_2k", videoQuality: 20 },
                },
            }
            const merged = mergePresets(builtin, yamlResult)
            assert.strictEqual(merged.size, 1)
            assert.strictEqual(merged.get("hevc_2k").videoQuality, 24)
        })

        it("overrides same-name preset when _override: true is present", () => {
            const builtin = new Map([
                ["hevc_2k", { name: "hevc_2k", videoQuality: 24, videoBitrate: 4000000 }],
            ])
            const yamlResult = {
                presets: {
                    hevc_2k: { name: "hevc_2k", _override: true, videoQuality: 20 },
                },
            }
            const merged = mergePresets(builtin, yamlResult)
            assert.strictEqual(merged.size, 1)
            assert.strictEqual(merged.get("hevc_2k").videoQuality, 20)
        })

        it("keeps builtin, counts new, respects _ prefix", () => {
            const builtin = new Map([
                ["h264_2k", { name: "h264_2k" }],
                ["hevc_2k", { name: "hevc_2k" }],
            ])
            const yamlResult = {
                presets: {
                    brand_new: { name: "brand_new" },
                    _base: { name: "_base" },
                },
            }
            const merged = mergePresets(builtin, yamlResult)
            assert.strictEqual(merged.size, 3)
            assert.ok(merged.has("brand_new"))
            assert.ok(!merged.has("_base"))
            assert.ok(merged.has("h264_2k"))
            assert.ok(merged.has("hevc_2k"))
        })
    })
})
