import assert from "assert"
import fs from "fs-extra"
import path from "path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
    collectInputFiles,
    scanDesktopInputFiles,
    scanFFmpegInputs,
} from "../src/transcode/ffmpeg_scan.js"

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const VIDEO_FIXTURES = path.join(PROJECT_ROOT, "data", "videos")
const SAMPLE_VIDEO = path.join(VIDEO_FIXTURES, "TEST2__mpeg4_avi_480.avi")
const HAS_VIDEO_FIXTURES = fs.pathExistsSync(VIDEO_FIXTURES)
const HAS_SAMPLE_VIDEO = fs.pathExistsSync(SAMPLE_VIDEO)

test(
    "ffmpeg scan collects a media file and normalizes duplicate paths",
    { skip: !HAS_SAMPLE_VIDEO },
    async () => {
        const entries = await collectInputFiles([SAMPLE_VIDEO, SAMPLE_VIDEO])
        assert.strictEqual(entries.length, 1)
        assert.strictEqual(entries[0].path, SAMPLE_VIDEO)
        assert.strictEqual(entries[0].name, path.basename(SAMPLE_VIDEO))
        assert.ok(entries[0].size > 0)
    },
)

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

test(
    "ffmpeg scan applies media type rules and start/count",
    { skip: !HAS_VIDEO_FIXTURES },
    async () => {
        const root = VIDEO_FIXTURES
        const entries = await scanFFmpegInputs({
            argv: { start: 0, count: 1 },
            root,
            walkOpts: { withFiles: true, needStats: true },
            presetType: "video",
            deps: { applyFileNameRules: async (items) => items },
        })
        assert.strictEqual(entries.length, 1)
        assert.ok(entries[0].path)
    },
)

test(
    "ffmpeg desktop scan shares preset type, filename and filelist rules",
    { skip: !HAS_SAMPLE_VIDEO },
    async () => {
        const filtered = await scanDesktopInputFiles({
            inputs: [SAMPLE_VIDEO],
            argv: { exclude: "TEST2__mpeg4_avi_480", regex: true },
            presetType: "video",
        })
        assert.strictEqual(filtered.length, 0)

        const listPath = path.join(PROJECT_ROOT, "temp", "test_ffmpeg_desktop_scan_filelist.txt")
        await fs.outputFile(listPath, `${SAMPLE_VIDEO}\n`)
        try {
            const entries = await scanDesktopInputFiles({
                inputs: [],
                argv: { filelist: listPath },
                presetType: "video",
            })
            assert.strictEqual(entries.length, 1)
            assert.strictEqual(entries[0].path, SAMPLE_VIDEO)
        } finally {
            await fs.remove(listPath)
        }
    },
)

test("ffmpeg scan keeps filelist input semantics", { skip: !HAS_SAMPLE_VIDEO }, async () => {
    const listPath = path.join(PROJECT_ROOT, "temp", "test_ffmpeg_scan_filelist.txt")
    await fs.outputFile(listPath, `${SAMPLE_VIDEO}\n# comment\n`)
    try {
        const entries = await scanFFmpegInputs({
            argv: { filelist: listPath, start: 0, count: 10 },
            root: path.dirname(SAMPLE_VIDEO),
            presetType: "video",
            deps: { applyFileNameRules: async (items) => items },
        })
        assert.strictEqual(entries.length, 1)
        assert.strictEqual(entries[0].path, SAMPLE_VIDEO)
    } finally {
        await fs.remove(listPath)
    }
})
