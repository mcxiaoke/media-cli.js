import assert from "assert"
import fs from "fs-extra"
import path from "path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { scanFFmpegInputs } from "../src/transcode/ffmpeg_scan.js"

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const VIDEO_FIXTURES = path.join(PROJECT_ROOT, "data", "videos")
const SAMPLE_VIDEO = path.join(VIDEO_FIXTURES, "TEST2__mpeg4_avi_480.avi")
const HAS_VIDEO_FIXTURES = fs.pathExistsSync(VIDEO_FIXTURES)
const HAS_SAMPLE_VIDEO = fs.pathExistsSync(SAMPLE_VIDEO)

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
    "ffmpeg scan applies regex exclude rules before slicing",
    { skip: !HAS_SAMPLE_VIDEO },
    async () => {
        const filtered = await scanFFmpegInputs({
            inputs: [SAMPLE_VIDEO],
            root: path.dirname(SAMPLE_VIDEO),
            walkOpts: { withFiles: true, needStats: true },
            argv: { exclude: "TEST2__mpeg4_avi_480", regex: true },
            presetType: "video",
        })
        assert.strictEqual(filtered.length, 0)
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

test(
    "scanFFmpegInputs accepts unified inputs list and deduplicates across directories",
    { skip: !HAS_SAMPLE_VIDEO },
    async () => {
        const dir = path.dirname(SAMPLE_VIDEO)
        const entries = await scanFFmpegInputs({
            inputs: [SAMPLE_VIDEO, dir, SAMPLE_VIDEO],
            argv: { start: 0, count: 100 },
            walkOpts: { withFiles: true, needStats: true },
            presetType: "video",
            deps: { applyFileNameRules: async (items) => items },
        })
        assert.ok(entries.length >= 1)
        const paths = entries.map((e) => e.path)
        const uniquePaths = new Set(paths)
        assert.strictEqual(paths.length, uniquePaths.size)
        assert.ok(paths.includes(SAMPLE_VIDEO))
    },
)

test(
    "scanFFmpegInputs supports string or array directories fallback without duplicate scanning",
    { skip: !HAS_SAMPLE_VIDEO },
    async () => {
        const dir = path.dirname(SAMPLE_VIDEO)
        const logged = []
        const entries = await scanFFmpegInputs({
            root: SAMPLE_VIDEO,
            argv: { directories: dir, start: 0, count: 100 },
            walkOpts: { withFiles: true, needStats: true },
            presetType: "video",
            deps: {
                applyFileNameRules: async (items) => items,
                onLog: (msg) => logged.push(msg),
            },
        })
        const paths = entries.map((e) => e.path)
        const uniquePaths = new Set(paths)
        assert.strictEqual(paths.length, uniquePaths.size)
        assert.ok(paths.includes(SAMPLE_VIDEO))
    },
)
