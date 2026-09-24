import assert from "assert"
import test from "node:test"
import { createFFmpegEngine } from "../lib/ffmpeg_engine.js"

function makeTask(index, status = "pending") {
    return { id: `task-${index}`, index, name: `a${index}.mp4`, status }
}

test("ffmpeg engine executes tasks and emits structured results", async () => {
    const events = []
    const engine = createFFmpegEngine({
        runTask: async (task, context) => {
            context.onProgress({ percent: 50, speed: "2x", entry: task })
            context.onLog(`[CMD] ${task.name}`)
            return { ok: true, fileDst: `${task.name}.mp4` }
        },
        onEvent: (event) => events.push(event),
    })

    const summary = await engine.execute(
        { id: "plan-1", tasks: [makeTask(0), makeTask(1)] },
        { concurrency: 2 },
    )

    assert.strictEqual(summary.success, 2)
    assert.strictEqual(summary.failed, 0)
    assert.strictEqual(summary.cancelled, 0)
    assert.ok(summary.elapsedMs >= 0)
    assert.ok(events.some((event) => event.type === "task.started"))
    assert.ok(events.some((event) => event.type === "task.progress"))
    assert.ok(events.some((event) => event.type === "task.log"))
    assert.strictEqual(events.at(-1).type, "session.summary")
    assert.ok(events.every((event) => event.runId === "plan-1"))
})

test("ffmpeg engine distinguishes skipped, failed, and cancelled tasks", async () => {
    const controller = new AbortController()
    const engine = createFFmpegEngine({
        runTask: async (task) => {
            if (task.index === 0) return { dstExists: true, fileDst: "existing.mp4" }
            if (task.index === 1) throw new Error("encode failed")
            return { ok: true }
        },
    })
    const summary = await engine.execute(
        { id: "plan-2", tasks: [makeTask(0), makeTask(1), makeTask(2)] },
        {
            concurrency: 1,
            signal: controller.signal,
            onTaskDone: ({ index }) => {
                if (index === 1) controller.abort()
            },
        },
    )
    assert.strictEqual(summary.skipped, 1)
    assert.strictEqual(summary.failed, 1)
    assert.strictEqual(summary.success, 0)
    assert.strictEqual(summary.cancelled, 1)
    assert.strictEqual(summary.isCancelled, true)
})

test("ffmpeg engine marks queued tasks cancelled after abort", async () => {
    const controller = new AbortController()
    const engine = createFFmpegEngine({
        runTask: async () => ({ ok: true }),
    })
    const summary = await engine.execute(
        { id: "plan-3", tasks: [makeTask(0), makeTask(1)] },
        {
            concurrency: 1,
            signal: controller.signal,
            onTaskDone: ({ index }) => {
                if (index === 0) controller.abort()
            },
        },
    )
    assert.strictEqual(summary.success, 1)
    assert.strictEqual(summary.cancelled, 1)
    assert.strictEqual(summary.isCancelled, true)
})

test("ffmpeg engine supports confirmed retry attempts", async () => {
    const attempts = []
    const engine = createFFmpegEngine({
        runTask: async (task, context) => {
            attempts.push(context.attempt)
            if (context.attempt === 1) throw new Error("hardware failed")
            return { ok: true, fileDst: "cpu.mp4" }
        },
    })
    const summary = await engine.execute(
        { id: "plan-4", tasks: [makeTask(0)] },
        {
            maxAttempts: 2,
            shouldRetry: () => true,
            confirmRetry: () => true,
            prepareAttempt: ({ task }) => ({ ...task, argv: { decodeMode: "cpu" } }),
        },
    )
    assert.deepStrictEqual(attempts, [1, 2])
    assert.strictEqual(summary.retryCount, 1)
    assert.strictEqual(summary.success, 1)
    assert.strictEqual(summary.failed, 0)
})
