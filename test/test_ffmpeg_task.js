import assert from "assert"
import test from "node:test"
import { SKIP_REASON } from "../lib/ffmpeg_result.js"
import { buildCliTask, buildTask } from "../lib/ffmpeg_task.js"

test("ffmpeg task builder is injectable and returns a pending task", async () => {
    const input = {
        path: "C:/media/sample.mp4",
        name: "sample.mp4",
        size: 1024,
    }
    const activePreset = {
        name: "test_preset",
        type: "video",
        format: ".mkv",
    }
    const task = await buildTask(input, {
        index: 2,
        total: 4,
        activePreset,
        argv: { preset: "test_preset", override: true },
        output: "C:/out",
        fsApi: { pathExists: async () => false },
        getMediaInfo: async () => ({
            duration: 12,
            bitrate: 1000,
            video: { width: 1920, height: 1080, format: "h264" },
            audio: { format: "aac" },
        }),
        calculate: () => ({ dimension: 1280, framerate: 30 }),
        createBaseName: () => ["sample_h264"],
        chooseSubtitle: () => null,
        textHash: () => "hash",
    })

    assert.strictEqual(task.index, 2)
    assert.strictEqual(task.total, 4)
    assert.strictEqual(task.status, "pending")
    assert.strictEqual(task.fileDst, "C:\\out\\sample_h264.mkv")
    assert.strictEqual(task.fileDstTemp, "C:\\out\\sample_h264_tmp@hash@tmp_.mkv")
    assert.strictEqual(task.preset, activePreset)
    assert.strictEqual(task.argv.override, true)
})

test("ffmpeg task builder forwards AbortSignal to media probing", async () => {
    const controller = new AbortController()
    let receivedSignal
    const task = await buildTask(
        { path: "C:/media/sample.mp4", name: "sample.mp4", size: 1 },
        {
            index: 0,
            total: 1,
            activePreset: { name: "test", type: "video", format: ".mp4" },
            argv: {},
            signal: controller.signal,
            fsApi: { pathExists: async () => false },
            getMediaInfo: async (_file, options) => {
                receivedSignal = options.signal
                return { duration: 1, bitrate: 1, video: { format: "h264" } }
            },
            calculate: () => ({}),
            createBaseName: () => ["sample"],
            chooseSubtitle: () => null,
        },
    )
    assert.strictEqual(receivedSignal, controller.signal)
    assert.strictEqual(task.status, "pending")
})

test("ffmpeg task builder skips a file without the required stream", async () => {
    const task = await buildTask(
        { path: "C:/media/sample.mp4", name: "sample.mp4", size: 1 },
        {
            index: 0,
            total: 1,
            activePreset: { name: "audio", type: "audio", format: ".m4a" },
            argv: {},
            fsApi: { pathExists: async () => false },
            getMediaInfo: async () => ({ duration: 1, bitrate: 1, video: {} }),
        },
    )
    assert.strictEqual(task.status, "skipped")
    assert.strictEqual(task.skipReason, SKIP_REASON.MISSING_AUDIO)
})

test("CLI task builder is injectable and preserves output/subtitle fields", async () => {
    const logger = new Proxy({}, { get: () => () => {} })
    const task = await buildCliTask(
        {
            root: "C:/media",
            path: "C:/media/sample.mp4",
            name: "sample.mp4",
            size: 1024,
            index: 0,
            total: 1,
            startMs: Date.now(),
            argv: { outputMode: "dir", decodeMode: "auto", override: false },
            preset: {
                name: "test_preset",
                type: "video",
                format: ".mkv",
                userArgs: {},
                audioCodec: "aac",
            },
        },
        {
            fs: { pathExists: async () => false },
            getMediaInfo: async () => ({
                duration: 12,
                bitrate: 1000,
                video: { format: "h264", width: 1920, height: 1080, bitDepth: 8 },
                audio: { format: "aac", bitrate: 128 },
            }),
            calculateDstArgs: () => ({ srcDuration: 12, dimension: 1280 }),
            createDstBaseName: () => ["sample_h264"],
            selectPreferredSubtitle: () => null,
            log: logger,
            t: (key) => key,
        },
    )
    assert.strictEqual(task.status, undefined)
    assert.strictEqual(task.fileDst, "C:\\media\\sample_h264.mkv")
    assert.match(task.fileDstTemp, /sample_h264_tmp@[a-f0-9]+@tmp_\.mkv$/)
    assert.deepStrictEqual(task.subtitles, [])
})

test("CLI task builder reports existing destinations as skip", async () => {
    const logger = new Proxy({}, { get: () => () => {} })
    const task = await buildCliTask(
        {
            root: "C:/media",
            path: "C:/media/sample.mp4",
            name: "sample.mp4",
            size: 1024,
            index: 0,
            total: 1,
            startMs: Date.now(),
            argv: { outputMode: "dir", decodeMode: "auto", override: false },
            preset: {
                name: "test_preset",
                type: "video",
                format: ".mkv",
                output: "C:/out",
                userArgs: {},
                audioCodec: "aac",
            },
        },
        {
            fs: {
                pathExists: async () => true,
                stat: async () => ({ size: 99 }),
            },
            getMediaInfo: async () => ({ duration: 12, bitrate: 1000, video: { format: "h264" } }),
            calculateDstArgs: () => ({ srcDuration: 12 }),
            createDstBaseName: () => ["sample_h264"],
            selectPreferredSubtitle: () => null,
            log: logger,
            t: (key) => key,
        },
    )
    assert.strictEqual(task.dstExists, true)
    assert.strictEqual(task.dstExistsSize, 99)
    assert.strictEqual(task.status, "skipped")
    assert.strictEqual(task.skipReason, SKIP_REASON.DESTINATION_EXISTS)
    assert.strictEqual(task.fileDst, undefined)
})
