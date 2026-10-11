/*
 * File: test_compress_presets.js
 * Created: 2026-10-11
 * Author: mcxiaoke
 * License: Apache License 2.0
 */

import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { listPrimaryPresetNames, resolveImagePreset } from "../lib/image_presets.js"
import { parseImageParams } from "../lib/query_parser.js"
import { parseCompressOpts, formatCompressOpts } from "../cmd/cmd_compress.js"

describe("Image Presets - resolveImagePreset", () => {
    it("lists all primary preset names", () => {
        const names = listPrimaryPresetNames()
        assert.deepEqual(names, [
            "webp-thumb",
            "webp-low",
            "webp-std",
            "webp-high",
            "jpeg-thumb",
            "jpeg-low",
            "jpeg-std",
            "jpeg-high",
        ])
    })

    it("resolves exact primary presets", () => {
        const p1 = resolveImagePreset("webp-std")
        assert.equal(p1.name, "webp-std")
        assert.equal(p1.format, "webp")
        assert.equal(p1.quality, 70)
        assert.equal(p1.size, 500)
        assert.equal(p1.width, 6000)
        assert.equal(p1.suffix, "_Z4K")
        assert.equal(p1.effort, 4)
        assert.equal(p1.smartSubsample, true)

        const p2 = resolveImagePreset("jpeg-high")
        assert.equal(p2.name, "jpeg-high")
        assert.equal(p2.format, "jpeg")
        assert.equal(p2.quality, 90)
        assert.equal(p2.size, 500)
        assert.equal(p2.width, 6000)
        assert.equal(p2.suffix, "_Z4K")
        assert.equal(p2.mozjpeg, true)
    })

    it("resolves alias names and normalizes case", () => {
        const p1 = resolveImagePreset("w-std")
        assert.equal(p1.name, "w-std")
        assert.equal(p1.format, "webp")
        assert.equal(p1.quality, 70)

        const p2 = resolveImagePreset("WEBP-HIGH")
        assert.equal(p2.name, "webp-high")
        assert.equal(p2.quality, 80)

        const p3 = resolveImagePreset("j-low")
        assert.equal(p3.name, "j-low")
        assert.equal(p3.format, "jpeg")

        const p4 = resolveImagePreset("jpg-std")
        assert.equal(p4.name, "jpg-std")
        assert.equal(p4.format, "jpeg")
    })

    it("returns null on invalid preset name and throws in parseCompressOpts", () => {
        assert.equal(resolveImagePreset("invalid-preset"), null)
        assert.throws(() => parseCompressOpts({ preset: "invalid-preset" }), /invalid-preset/)
    })
})

describe("Image Presets - extends inheritance", () => {
    // 全字段快照：锁定继承展开后的产物，任何字段增删改都会在此暴露，
    // 避免「基类改了却忘了某个预设该覆盖」这类静默漂移。
    const EXPECTED = {
        "webp-thumb": {
            format: "webp",
            quality: 50,
            width: 3200,
            size: 500,
            suffix: "_thumb",
            effort: 4,
            smartSubsample: true,
            description: "WebP thumb",
        },
        "webp-low": {
            format: "webp",
            quality: 60,
            width: 6000,
            size: 500,
            suffix: "_Z4K",
            effort: 4,
            smartSubsample: true,
            description: "WebP 低画质/高压缩率 (Q60, effort 4)",
        },
        "webp-std": {
            format: "webp",
            quality: 70,
            width: 6000,
            size: 500,
            suffix: "_Z4K",
            effort: 4,
            smartSubsample: true,
            description: "WebP 标准画质平衡 (Q70, effort 4, smartSubsample)",
        },
        "webp-high": {
            format: "webp",
            quality: 80,
            width: 6000,
            size: 500,
            suffix: "_Z4K",
            effort: 5,
            smartSubsample: true,
            description: "WebP 高画质模式 (Q80, effort 5, smartSubsample)",
        },
        "jpeg-thumb": {
            format: "jpeg",
            quality: 60,
            width: 3200,
            size: 500,
            suffix: "_thumb",
            mozjpeg: false,
            description: "JPEG thumb",
        },
        "jpeg-low": {
            format: "jpeg",
            quality: 70,
            width: 6000,
            size: 500,
            suffix: "_Z4K",
            mozjpeg: false,
            description: "JPEG 低画质模式 (Q70)",
        },
        "jpeg-std": {
            format: "jpeg",
            quality: 85,
            width: 6000,
            size: 500,
            suffix: "_Z4K",
            mozjpeg: true,
            description: "JPEG 标准画质模式 (Q85, mozjpeg 优化)",
        },
        "jpeg-high": {
            format: "jpeg",
            quality: 90,
            width: 6000,
            size: 500,
            suffix: "_Z4K",
            mozjpeg: true,
            description: "JPEG 高画质模式 (Q90, mozjpeg 优化)",
        },
    }

    it("merges base fields into every preset with no 'extends' leakage", () => {
        for (const [name, expected] of Object.entries(EXPECTED)) {
            const { name: resolvedName, ...fields } = resolveImagePreset(name)
            assert.equal(resolvedName, name)
            assert.deepEqual(fields, expected, `preset '${name}' fields mismatch`)
            assert.equal(
                Object.hasOwn(fields, "extends"),
                false,
                `preset '${name}' must not leak the 'extends' directive`,
            )
        }
    })

    it("lets a preset override a base field (webp-high effort 4 -> 5)", () => {
        assert.equal(resolveImagePreset("webp-high").effort, 5)
        assert.equal(resolveImagePreset("webp-low").effort, 4)
    })

    it("keeps jpeg-* presets on the jpeg base class", () => {
        // 回归防护：jpeg-thumb 曾误写 extends: "_base_webp"，导致 format 继承成 webp、
        // mozjpeg 永不消费（media-compress.js 按 format 分支，webp 分支只读 effort/smartSubsample）。
        for (const name of ["jpeg-thumb", "jpeg-low", "jpeg-std", "jpeg-high"]) {
            assert.equal(resolveImagePreset(name).format, "jpeg", `'${name}' must output jpeg`)
        }
    })

    it("keeps _base_* classes out of the selectable preset list", () => {
        assert.equal(
            listPrimaryPresetNames().some((n) => n.startsWith("_")),
            false,
        )
        assert.equal(resolveImagePreset("_base_webp"), null)
        assert.equal(resolveImagePreset("_base_jpeg"), null)
        assert.throws(() => parseCompressOpts({ preset: "_base_webp" }), /_base_webp/)
    })

    it("resolves every alias to the same fields as its primary preset", () => {
        const pairs = [
            ["w-thumb", "webp-thumb"],
            ["wt", "webp-thumb"],
            ["w-low", "webp-low"],
            ["wl", "webp-low"],
            ["w-std", "webp-std"],
            ["ws", "webp-std"],
            ["w-high", "webp-high"],
            ["wh", "webp-high"],
            ["j-thumb", "jpeg-thumb"],
            ["jpg-thumb", "jpeg-thumb"],
            ["jt", "jpeg-thumb"],
            ["j-low", "jpeg-low"],
            ["jpg-low", "jpeg-low"],
            ["jl", "jpeg-low"],
            ["j-std", "jpeg-std"],
            ["jpg-std", "jpeg-std"],
            ["js", "jpeg-std"],
            ["j-high", "jpeg-high"],
            ["jpg-high", "jpeg-high"],
            ["jh", "jpeg-high"],
        ]
        for (const [alias, primary] of pairs) {
            const { name: aliasName, ...aliasFields } = resolveImagePreset(alias)
            const { name: primaryName, ...primaryFields } = resolveImagePreset(primary)
            assert.equal(aliasName, alias)
            assert.equal(primaryName, primary)
            assert.deepEqual(
                aliasFields,
                primaryFields,
                `alias '${alias}' drifted from '${primary}'`,
            )
        }
    })
})

describe("Image Query Parser - format parameter", () => {
    it("parses f, fmt, and format parameter", () => {
        assert.equal(parseImageParams("f=webp").format, "webp")
        assert.equal(parseImageParams("fmt=jpeg").format, "jpeg")
        assert.equal(parseImageParams("format=jpg").format, "jpg")
        assert.equal(parseCompressOpts({ config: "format=jpg" }).format, "jpeg")
    })

    it("parses combined params with format", () => {
        const res = parseImageParams("q=80,w=3840,s=1000,f=webp")
        assert.equal(res.quality, 80)
        assert.equal(res.width, 3840)
        assert.equal(res.size, 1000)
        assert.equal(res.format, "webp")
    })

    it("throws on unsupported output format via parseCompressOpts", () => {
        assert.throws(() => parseCompressOpts({ config: "f=bmp" }), /bmp/)
    })
})

describe("Compress Options Resolution Priority", () => {
    it("uses default options when no args given", () => {
        const opts = parseCompressOpts({})
        assert.equal(opts.format, "jpeg")
        assert.equal(opts.quality, 85)
        assert.equal(opts.minFileSize, 500 * 1024)
        assert.equal(opts.maxWidth, 6000)
        assert.equal(opts.suffix, "_Z6K")
    })

    it("applies preset when preset is specified", () => {
        const opts = parseCompressOpts({ preset: "webp-std" })
        assert.equal(opts.format, "webp")
        assert.equal(opts.quality, 70)
        assert.equal(opts.minFileSize, 500 * 1024)
        assert.equal(opts.maxWidth, 6000)
        assert.equal(opts.suffix, "_Z4K")
        assert.equal(opts.effort, 4)
        assert.equal(opts.presetName, "webp-std")
    })

    it("-c overrides preset options", () => {
        const opts = parseCompressOpts({
            preset: "webp-std",
            config: "q=65,w=3840,s=200",
        })
        assert.equal(opts.format, "webp")
        assert.equal(opts.quality, 65)
        assert.equal(opts.minFileSize, 200 * 1024)
        assert.equal(opts.maxWidth, 3840)
    })

    it("CLI explicit options override everything", () => {
        const opts = parseCompressOpts({
            preset: "webp-low", // quality 60
            config: "q=65,w=4000",
            quality: 92,
            maxWidth: 5000,
            format: "jpeg",
            suffix: "_custom",
        })
        assert.equal(opts.quality, 92)
        assert.equal(opts.maxWidth, 5000)
        assert.equal(opts.format, "jpeg")
        assert.equal(opts.suffix, "_custom")
    })
})

describe("Compress Effective Params Summary", () => {
    // 确认提示前打印的摘要：用户按 y 之前必须能看到真实生效值。
    it("prints the fully resolved values, not the preset's declared ones", () => {
        const opts = parseCompressOpts({ preset: "webp-std", config: "q=65,w=3840,s=200" })
        const out = formatCompressOpts(opts)
        assert.match(out, /^preset {4}: webp-std$/m)
        assert.match(out, /^quality {3}: Q65$/m) // 被 -c 覆盖，不是预设的 Q70
        assert.match(out, /^max-width : 3840 px$/m) // 被 -c 覆盖，不是预设的 6000
        assert.match(out, /^min-size {2}: 200 KB$/m)
    })

    it("lists only the encoder params the target format actually consumes", () => {
        const webp = formatCompressOpts(parseCompressOpts({ preset: "webp-std" }))
        assert.match(webp, /^encoder {3}: effort=4, smartSubsample=true$/m)
        assert.doesNotMatch(webp, /mozjpeg/)

        const jpeg = formatCompressOpts(parseCompressOpts({ preset: "jpeg-high" }))
        assert.match(jpeg, /^encoder {3}: mozjpeg=true$/m)
        assert.doesNotMatch(jpeg, /effort|smartSubsample/)
    })

    it("marks the absent preset as (none)", () => {
        const out = formatCompressOpts(parseCompressOpts({}))
        assert.match(out, /^preset {4}: \(none\)$/m)
        assert.match(out, /^format {4}: jpeg$/m)
        assert.match(out, /^suffix {4}: _Z6K$/m)
    })
})
