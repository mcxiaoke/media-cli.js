import assert from "node:assert/strict"
import fs from "fs-extra"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createJournal } from "../lib/journal.js"
import { getLogRootDir } from "../lib/debug.js"
import * as helper from "../lib/helper.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("OperationJournal lifecycle and schema", async () => {
    const journal = createJournal({
        command: "moveup",
        argv: { input: "./test_in", doit: true, mode: "auto" },
        dryRun: false,
    })

    assert.strictEqual(journal.command, "moveup")
    assert.strictEqual(journal.version, "1.0")
    assert.strictEqual(journal.dryRun, false)

    journal.record({
        action: "MOVE",
        src: path.join(ROOT, "temp", "a.jpg"),
        dst: path.join(ROOT, "temp", "b.jpg"),
        size: 1024,
        status: "success",
    })

    journal.record({
        action: "MOVE",
        src: path.join(ROOT, "temp", "c.jpg"),
        dst: path.join(ROOT, "temp", "d.jpg"),
        size: 2048,
        status: "failed",
        error: "Permission denied",
    })

    assert.strictEqual(journal.summary.total, 2)
    assert.strictEqual(journal.summary.succeeded, 1)
    assert.strictEqual(journal.summary.failed, 1)

    const manifestPath = await journal.save()
    assert.ok(await fs.pathExists(manifestPath))

    const content = await fs.readJson(manifestPath)
    assert.strictEqual(content.version, "1.0")
    assert.strictEqual(content.status, "partial")
    assert.strictEqual(content.operations.length, 2)
    assert.strictEqual(content.operations[0].action, "MOVE")
    assert.strictEqual(content.operations[0].reversible, true)
    assert.strictEqual(content.operations[1].status, "failed")

    // 测试 copyTo
    const copyTargetDir = path.join(ROOT, "temp", "test_journal_copy")
    const copied = await journal.copyTo(copyTargetDir)
    assert.ok(copied.length > 0)
    assert.ok(await fs.pathExists(copied[0]))

    // 清理
    await fs.remove(manifestPath)
    await fs.remove(copyTargetDir)
})

test("getLogRootDir points to AppData/Local/mediac on Windows or data home", () => {
    const dir = getLogRootDir()
    assert.ok(dir.includes("mediac"))
    if (process.platform === "win32") {
        assert.ok(dir.toLowerCase().includes("appdata"))
    }
})

test("safeRemove places file in volume-local .mediac/deleted preserving structure", async () => {
    const testDir = path.join(ROOT, "temp", "test_safe_remove_nested", "sub1", "sub2")
    await fs.ensureDir(testDir)
    const testFile = path.join(testDir, "sample.txt")
    await fs.writeFile(testFile, "hello safe remove", "utf8")

    const removedPath = await helper.safeRemove(testFile)
    assert.ok(removedPath, "safeRemove should return the destination path")
    assert.ok(await fs.pathExists(removedPath), "removed file should exist at destination")
    assert.ok(!(await fs.pathExists(testFile)), "original file should be gone")

    // 检查目录结构是否被保留 (sub1/sub2/sample.txt)
    assert.ok(
        removedPath.includes(path.join("sub1", "sub2")),
        "should preserve original relative path",
    )
    assert.ok(
        removedPath.includes(path.join(".mediac", "deleted")),
        "should be inside .mediac/deleted",
    )

    // 清理
    await fs.remove(removedPath)
    await fs.remove(path.join(ROOT, "temp", "test_safe_remove_nested"))
})
