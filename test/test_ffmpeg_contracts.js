import assert from "assert"
import test from "node:test"
import {
    normalizeCliOptions,
    normalizeDesktopOptions,
    toLegacyArgvOptions,
} from "../src/transcode/ffmpeg_options.js"
import { createEventFactory, ENGINE_EVENT } from "../src/transcode/ffmpeg_events.js"
import {
    createInternalExecutionPlan,
    createPublicPlanSnapshot,
} from "../src/transcode/ffmpeg_plan_snapshot.js"

test("normalizeDesktopOptions creates the shared domain shape", () => {
    const options = normalizeDesktopOptions({
        inputs: ["C:/media/a.mp4", "C:/media/a.mp4"],
        output: "C:/out",
        preset: "hevc_2k",
        options: { fps: 30, audioCodec: "copy", strict: true },
    })
    assert.strictEqual(options.mode, "plan")
    assert.deepStrictEqual(options.inputs, ["C:/media/a.mp4"])
    assert.strictEqual(options.outputMode, "dir")
    assert.strictEqual(options.framerate, 30)
    assert.strictEqual(options.audioCopy, true)
    assert.strictEqual(options.strict, true)
    assert.strictEqual(options.decodeMode, "auto")
})

test("normalizeCliOptions applies injected ffargs and keeps doit as explicit mode", () => {
    const options = normalizeCliOptions(
        {
            input: "C:/media",
            preset: "h264_2k",
            ffargs: "vq=23;vb=2M",
            doit: true,
        },
        {
            parseFfargs: () => ({ videoQuality: 23, videoBitrate: "2M" }),
            applyFfargs: (argv, ffargs) => ({ ...argv, ...ffargs }),
        },
    )
    assert.strictEqual(options.mode, "execute")
    assert.strictEqual(options.videoQuality, 23)
    assert.strictEqual(options.videoBitrate, "2M")
})

test("FFmpeg option validation rejects unsafe domains", () => {
    assert.throws(
        () => normalizeDesktopOptions({ inputs: ["a.mp4"], options: { speed: 3 } }),
        /speed/,
    )
    assert.throws(
        () => normalizeDesktopOptions({ inputs: ["a.mp4"], options: { jobs: 0 } }),
        /jobs/,
    )
    assert.throws(
        () => normalizeDesktopOptions({ inputs: ["a.mp4"], outputMode: "flat" }),
        /outputMode/,
    )
})

test("legacy argv projection removes the shared envelope", () => {
    const options = normalizeDesktopOptions({ inputs: ["a.mp4"], preset: "hevc_2k" })
    const legacy = toLegacyArgvOptions(options)
    assert.strictEqual(legacy.schemaVersion, undefined)
    assert.strictEqual(legacy.mode, undefined)
    assert.strictEqual(legacy.inputs, undefined)
    assert.strictEqual(legacy.preset, undefined)
    assert.strictEqual(legacy.outputMode, "dir")
})

test("engine events have monotonic sequence and protected identity fields", () => {
    const createEvent = createEventFactory("run-1", () => new Date("2026-09-24T00:00:00.000Z"))
    const first = createEvent(ENGINE_EVENT.TASK_STARTED, { taskId: "a", seq: 999 })
    const second = createEvent(ENGINE_EVENT.TASK_PROGRESS, { taskId: "a", percent: 50 })
    assert.strictEqual(first.seq, 1)
    assert.strictEqual(second.seq, 2)
    assert.strictEqual(first.runId, "run-1")
    assert.strictEqual(first.type, ENGINE_EVENT.TASK_STARTED)
    assert.strictEqual(first.percent, undefined)
    assert.strictEqual(second.percent, 50)
})

test("internal execution plan assigns stable task identities", () => {
    const plan = createInternalExecutionPlan({
        id: "plan-1",
        presetName: "hevc_2k",
        mode: "execute",
        tasks: [{ index: 0, name: "a.mp4", status: "pending" }],
    })
    assert.strictEqual(plan.schemaVersion, 1)
    assert.strictEqual(plan.mode, "execute")
    assert.strictEqual(plan.tasks[0].id, "task-0")
    assert.strictEqual(plan.tasks[0].taskId, "task-0")
})

test("public plan snapshot excludes internal execution objects", () => {
    const snapshot = createPublicPlanSnapshot({
        id: "plan-1",
        presetName: "hevc_2k",
        preset: { name: "hevc_2k" },
        argv: { secret: true },
        tasks: [
            {
                index: 0,
                name: "a.mp4",
                path: "C:/a.mp4",
                size: 10,
                duration: 2,
                fileDst: "C:/out/a.mp4",
                fileDstTemp: "C:/out/a_tmp.mp4",
                hwPlan: { caps: { encoders: new Set(["h264_nvenc"]) } },
                status: "pending",
            },
        ],
    })
    assert.strictEqual(snapshot.tasks[0].id, "task-0")
    assert.strictEqual(snapshot.tasks[0].fileDst, "C:/out/a.mp4")
    assert.strictEqual(snapshot.preset, undefined)
    assert.strictEqual(snapshot.argv, undefined)
    assert.strictEqual(snapshot.tasks[0].fileDstTemp, undefined)
    assert.strictEqual(snapshot.tasks[0].hwPlan, undefined)
})
