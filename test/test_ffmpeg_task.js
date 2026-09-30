import assert from "assert"
import path from "node:path"
import test from "node:test"
import { SKIP_REASON } from "../src/transcode/ffmpeg_result.js"
import { buildCliTask } from "../src/transcode/ffmpeg_task.js"

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
    const cliDstDir = path.resolve(path.dirname("C:/media/sample.mp4"))
    assert.strictEqual(task.fileDst, path.join(cliDstDir, "sample_h264.mkv"))
    assert.match(task.fileDstTemp, /sample_h264_tmp@[a-f0-9]+@tmp_\.mkv$/)
    assert.deepStrictEqual(task.subtitles, [])
})

test("CLI task builder forwards AbortSignal to media probing", async () => {
    const controller = new AbortController()
    const logger = new Proxy({}, { get: () => () => {} })
    let receivedSignal
    await buildCliTask(
        {
            root: "C:/media",
            path: "C:/media/sample.mp4",
            name: "sample.mp4",
            size: 1024,
            index: 0,
            total: 1,
            startMs: Date.now(),
            signal: controller.signal,
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
            getMediaInfo: async (_file, options) => {
                receivedSignal = options?.signal
                return { duration: 12, bitrate: 1000, video: { format: "h264" } }
            },
            calculateDstArgs: () => ({ srcDuration: 12 }),
            createDstBaseName: () => ["sample_h264"],
            selectPreferredSubtitle: () => null,
            log: logger,
            t: (key) => key,
        },
    )
    assert.strictEqual(receivedSignal, controller.signal)
})

test("CLI task builder skips files missing the stream the preset requires", async () => {
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
            preset: { name: "audio", type: "audio", format: ".m4a", userArgs: {} },
        },
        {
            fs: { pathExists: async () => false },
            getMediaInfo: async () => ({ duration: 12, bitrate: 1000, video: { format: "h264" } }),
            calculateDstArgs: () => ({ srcDuration: 12 }),
            createDstBaseName: () => ["sample"],
            selectPreferredSubtitle: () => null,
            log: logger,
            t: (key) => key,
        },
    )
    assert.strictEqual(task.status, "skipped")
    assert.strictEqual(task.skipReason, SKIP_REASON.MISSING_AUDIO)
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
