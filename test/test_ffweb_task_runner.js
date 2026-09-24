import assert from "assert"
import test from "node:test"
import { TaskRunner } from "../ffweb/task_runner.js"

test("creating a new WebUI plan invalidates the previous executable plan", async () => {
    const runner = new TaskRunner()
    runner.currentPlan = { id: "old-plan", tasks: [{ path: "old.mp4" }] }
    runner.summary = { success: 1 }

    await assert.rejects(() => runner.createPlan({ inputs: [] }), /inputs|non-empty/i)

    assert.strictEqual(runner.currentPlan, null)
    assert.strictEqual(runner.summary, null)
})
