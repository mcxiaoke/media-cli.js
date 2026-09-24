import assert from "assert"
import test from "node:test"
import { buildTask } from "../lib/ffmpeg_task.js"

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
    assert.strictEqual(task, null)
})
