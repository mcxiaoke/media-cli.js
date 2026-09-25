import assert from "assert"
import test from "node:test"
import { createFFmpegEngine } from "../src/transcode/ffmpeg_engine.js"

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

test("ffmpeg engine summarizes empty and all-skipped plans", async () => {
    const events = []
    const emptyEngine = createFFmpegEngine({
        runTask: async () => {
            throw new Error("empty plans must not start ffmpeg")
        },
        onEvent: (event) => events.push(event),
    })
    const emptySummary = await emptyEngine.execute(
        { id: "plan-empty", tasks: [] },
        { onSummary: async (summary) => events.push(summary) },
    )
    assert.strictEqual(emptySummary.total, 0)
    assert.strictEqual(emptySummary.success, 0)
    assert.strictEqual(events.at(-1).total, 0)

    const skippedTask = { ...makeTask(0), status: "skipped", skipReason: "missing_video" }
    const skippedEngine = createFFmpegEngine({
        runTask: async () => {
            throw new Error("skipped tasks must not start ffmpeg")
        },
    })
    const skippedSummary = await skippedEngine.execute({ id: "plan-skipped", tasks: [skippedTask] })
    assert.strictEqual(skippedSummary.total, 1)
    assert.strictEqual(skippedSummary.skipped, 1)
    assert.strictEqual(skippedSummary.success, 0)
})

test("ffmpeg engine forwards process lifecycle callbacks", async () => {
    const spawned = []
    const exited = []
    const engine = createFFmpegEngine({
        runTask: async (task, context) => {
            context.onSpawn({ pid: 1234 }, { pid: 1234 })
            context.onExit({ pid: 1234, code: 0, signal: null })
            return { ok: true }
        },
    })
    await engine.execute(
        { id: "plan-5", tasks: [makeTask(0)] },
        {
            onTaskSpawn: (child, metadata) => spawned.push({ child, metadata }),
            onTaskExit: (metadata, context) => exited.push({ metadata, context }),
        },
    )
    assert.strictEqual(spawned.length, 1)
    assert.strictEqual(spawned[0].metadata.taskId, "task-0")
    assert.strictEqual(exited.length, 1)
    assert.strictEqual(exited[0].metadata.pid, 1234)
})
