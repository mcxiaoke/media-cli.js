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
import { parseCompressOpts } from "../cmd/cmd_compress.js"

describe("Image Presets - resolveImagePreset", () => {
    it("lists all primary preset names", () => {
        const names = listPrimaryPresetNames()
        assert.deepEqual(names, [
            "webp-low",
            "webp-std",
            "webp-high",
            "jpeg-low",
            "jpeg-std",
            "jpeg-high",
        ])
    })

    it("resolves exact primary presets", () => {
        const p1 = resolveImagePreset("webp-std")
        assert.equal(p1.name, "webp-std")
        assert.equal(p1.format, "webp")
        assert.equal(p1.quality, 75)
        assert.equal(p1.size, 500)
        assert.equal(p1.width, 6000)
        assert.equal(p1.suffix, "_W75")
        assert.equal(p1.effort, 4)
        assert.equal(p1.smartSubsample, true)

        const p2 = resolveImagePreset("jpeg-high")
        assert.equal(p2.name, "jpeg-high")
        assert.equal(p2.format, "jpeg")
        assert.equal(p2.quality, 90)
        assert.equal(p2.size, 500)
        assert.equal(p2.width, 6000)
        assert.equal(p2.suffix, "_J90")
        assert.equal(p2.mozjpeg, true)
    })

    it("resolves alias names and normalizes case", () => {
        const p1 = resolveImagePreset("w-std")
        assert.equal(p1.name, "w-std")
        assert.equal(p1.format, "webp")
        assert.equal(p1.quality, 75)

        const p2 = resolveImagePreset("WEBP-HIGH")
        assert.equal(p2.name, "webp-high")
        assert.equal(p2.quality, 82)

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
        assert.equal(opts.quality, 75)
        assert.equal(opts.minFileSize, 500 * 1024)
        assert.equal(opts.maxWidth, 6000)
        assert.equal(opts.suffix, "_W75")
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
            preset: "webp-low", // quality 50
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
