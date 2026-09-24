import assert from "assert"
import path from "path"
import test from "node:test"
import { collectInputFiles } from "../lib/ffmpeg_scan.js"

const SAMPLE_VIDEO = path.resolve("data/videos/TEST2__mpeg4_avi_480.avi")

test("ffmpeg scan collects a media file and normalizes duplicate paths", async () => {
    const entries = await collectInputFiles([SAMPLE_VIDEO, SAMPLE_VIDEO])
    assert.strictEqual(entries.length, 1)
    assert.strictEqual(entries[0].path, SAMPLE_VIDEO)
    assert.strictEqual(entries[0].name, path.basename(SAMPLE_VIDEO))
    assert.ok(entries[0].size > 0)
})

test("ffmpeg scan accepts injected filesystem and media predicate", async () => {
    const calls = []
    const fakeStat = { isFile: () => true, size: 123 }
    const entries = await collectInputFiles(["C:/media/sample.custom"], {
        fs: {
            pathExists: async (filePath) => {
                calls.push(filePath)
                return true
            },
            stat: async () => fakeStat,
        },
        isMediaFile: (filePath) => filePath.endsWith(".custom"),
    })
    assert.deepStrictEqual(calls, ["C:/media/sample.custom"])
    assert.strictEqual(entries[0].size, 123)
    assert.strictEqual(entries[0].name, "sample.custom")
})
