import assert from "assert"
import test from "node:test"
import {
    buildFFmpegTasks,
    createFFmpegExecutionPlan,
    deleteCompletedSources,
    isPlanCurrent,
    PLAN_OUTCOME,
    prepareFFmpegPlan,
} from "../lib/ffmpeg_planner.js"

test("shared planner propagates preset/argv metadata to every task", async () => {
    const seen = []
    const entries = [
        { path: "C:/media/a.mp4", name: "a.mp4", size: 10, root: "C:/media" },
        { path: "C:/media/b.mp4", name: "b.mp4", size: 20, root: "C:/media" },
    ]
    const preset = { name: "test", type: "video" }
    const argv = { output: "C:/out", outputMode: "dir", strict: true }
    const tasks = await buildFFmpegTasks({
        entries,
        preset,
        argv,
        testMode: true,
        buildTask: async (entry) => {
            seen.push(entry)
            return { ...entry, status: "pending" }
        },
    })
    assert.strictEqual(tasks.length, 2)
    assert.strictEqual(seen[0].preset, preset)
    assert.strictEqual(seen[0].argv.output, "C:/out")
    assert.strictEqual(seen[0].testMode, true)
    assert.strictEqual(seen[1].index, 1)
    assert.strictEqual(seen[1].total, 2)
})

test("shared planner creates the internal execution plan envelope", () => {
    const plan = createFFmpegExecutionPlan({
        id: "plan-1",
        preset: { name: "test" },
        argv: { outputMode: "dir" },
        tasks: [{ name: "a.mp4" }],
    })
    assert.strictEqual(plan.id, "plan-1")
    assert.strictEqual(plan.presetName, "test")
    assert.strictEqual(plan.mode, "plan")
    assert.strictEqual(plan.tasks[0].id, "task-0")
})

test("shared planner exposes empty and all-skipped outcomes without rebuilding tasks", async () => {
    const entry = { path: "C:/media/a.mp4", name: "a.mp4", size: 10, root: "C:/media" }
    const allSkipped = await prepareFFmpegPlan({
        entries: [entry],
        preset: { name: "test" },
        argv: {},
        buildTask: async (prepared) => ({ ...prepared, status: "skipped" }),
    })
    assert.strictEqual(allSkipped.outcome, PLAN_OUTCOME.ALL_SKIPPED)
    assert.strictEqual(allSkipped.executableTasks.length, 0)
    assert.strictEqual(allSkipped.plan.tasks.length, 1)

    const empty = await prepareFFmpegPlan({
        entries: [entry],
        preset: { name: "test" },
        argv: {},
        buildTask: async () => null,
    })
    assert.strictEqual(empty.outcome, PLAN_OUTCOME.EMPTY)
    assert.strictEqual(empty.plan.tasks.length, 0)
})

test("shared delete-source helper requires confirmation and validates output size", async () => {
    const removed = []
    const plan = {
        argv: { deleteSourceFiles: true },
        tasks: [
            { path: "C:/media/a.mp4", fileDst: "C:/out/a.mp4", status: "done" },
            { path: "C:/media/empty.mp4", fileDst: "C:/out/empty.mp4", status: "done" },
        ],
    }
    const unconfirmed = await deleteCompletedSources({
        plan,
        fsApi: { stat: async () => ({ size: 10 }) },
        safeRemove: async (filePath) => removed.push(filePath),
    })
    assert.strictEqual(unconfirmed.confirmed, false)
    assert.deepStrictEqual(removed, [])

    const confirmed = await deleteCompletedSources({
        plan,
        confirmDeleteSource: true,
        fsApi: {
            stat: async (filePath) => ({ size: filePath.endsWith("empty.mp4") ? 0 : 10 }),
        },
        safeRemove: async (filePath) => {
            removed.push(filePath)
            return filePath
        },
    })
    assert.strictEqual(confirmed.confirmed, true)
    assert.deepStrictEqual(confirmed.deleted, ["C:/media/a.mp4"])
    assert.deepStrictEqual(confirmed.kept, ["C:/media/empty.mp4"])
    assert.deepStrictEqual(removed, ["C:/media/a.mp4"])
})

test("stale plan identity is explicit", () => {
    assert.strictEqual(isPlanCurrent({ id: "plan-1" }, { id: "plan-1" }), true)
    assert.strictEqual(isPlanCurrent({ id: "plan-1" }, { id: "plan-2" }), false)
})
