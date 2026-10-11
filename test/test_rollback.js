import assert from "node:assert/strict"
import fs from "fs-extra"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { createJournal } from "../lib/journal.js"
import { handler as rollbackHandler } from "../cmd/cmd_rollback.js"
import * as helper from "../lib/helper.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("Rollback command end-to-end: MOVE, RENAME, and TRASH restoration", async () => {
    const sandboxDir = path.join(ROOT, "temp", "test_rollback_sandbox")
    await fs.remove(sandboxDir)
    await fs.ensureDir(sandboxDir)

    const fileA = path.join(sandboxDir, "file_a.txt")
    const fileB = path.join(sandboxDir, "file_b.txt")
    const fileC = path.join(sandboxDir, "file_c.txt")

    await fs.writeFile(fileA, "Content A", "utf8")
    await fs.writeFile(fileB, "Content B", "utf8")
    await fs.writeFile(fileC, "Content C", "utf8")

    // 1. 模拟移动: fileA -> fileA_moved
    const fileAMoved = path.join(sandboxDir, "sub", "file_a_moved.txt")
    await fs.ensureDir(path.dirname(fileAMoved))
    await fs.move(fileA, fileAMoved)

    // 2. 模拟重命名: fileB -> fileB_renamed
    const fileBRenamed = path.join(sandboxDir, "file_b_renamed.txt")
    await fs.rename(fileB, fileBRenamed)

    // 3. 模拟安全删除: fileC -> safeRemove
    const fileCTrashed = await helper.safeRemove(fileC)
    assert.ok(fileCTrashed, "safeRemove should succeed")
    assert.ok(!(await fs.pathExists(fileC)), "original fileC should be removed")

    // 生成 Manifest
    const journal = createJournal({
        command: "multi_op_test",
        argv: { doit: true },
        cwd: sandboxDir,
    })

    journal.record({
        action: "MOVE",
        src: fileA,
        dst: fileAMoved,
        size: 9,
        status: "success",
    })

    journal.record({
        action: "RENAME",
        src: fileB,
        dst: fileBRenamed,
        size: 9,
        status: "success",
    })

    journal.record({
        action: "TRASH",
        src: fileC,
        dst: fileCTrashed,
        size: 9,
        status: "success",
    })

    const manifestPath = await journal.save()
    assert.ok(await fs.pathExists(manifestPath))

    // 先运行 DRY-RUN rollback (doit=false)
    await rollbackHandler({
        manifest: manifestPath,
        doit: false,
        yes: true,
    })

    // 验证 dry-run 下文件状态保持未恢复
    assert.ok(await fs.pathExists(fileAMoved))
    assert.ok(!(await fs.pathExists(fileA)))
    assert.ok(await fs.pathExists(fileBRenamed))
    assert.ok(!(await fs.pathExists(fileB)))
    assert.ok(await fs.pathExists(fileCTrashed))
    assert.ok(!(await fs.pathExists(fileC)))

    // 实际执行 ROLLBACK (doit=true)
    await rollbackHandler({
        manifest: manifestPath,
        doit: true,
        yes: true,
    })

    // 验证所有文件完全精准复原！
    assert.ok(await fs.pathExists(fileA), "fileA should be restored")
    assert.strictEqual(await fs.readFile(fileA, "utf8"), "Content A")
    assert.ok(!(await fs.pathExists(fileAMoved)), "fileAMoved should be removed")

    assert.ok(await fs.pathExists(fileB), "fileB should be restored")
    assert.strictEqual(await fs.readFile(fileB, "utf8"), "Content B")
    assert.ok(!(await fs.pathExists(fileBRenamed)), "fileBRenamed should be removed")

    assert.ok(await fs.pathExists(fileC), "fileC should be restored from trash")
    assert.strictEqual(await fs.readFile(fileC, "utf8"), "Content C")
    assert.ok(!(await fs.pathExists(fileCTrashed)), "fileCTrashed should be removed")

    // 清理测试环境
    await fs.remove(manifestPath)
    await fs.remove(sandboxDir)
})

test("listManifests, resolveManifestPath, and rollback list mode", async () => {
    const { listManifests, resolveManifestPath, findLatestManifest } =
        await import("../lib/journal.js")

    // 创建两个测试 manifest
    const j1 = createJournal({ command: "test_history_1", argv: { doit: true } })
    j1.record({ action: "MOVE", src: "a.txt", dst: "b.txt", status: "success" })
    const path1 = await j1.save()

    const j2 = createJournal({ command: "test_history_2", argv: { doit: true } })
    j2.record({ action: "RENAME", src: "x.txt", dst: "y.txt", status: "success" })
    const path2 = await j2.save()

    // 1. 测试 listManifests
    const list = await listManifests({ limit: 10 })
    assert.ok(list.length >= 2, "should have at least 2 manifests")
    assert.strictEqual(list[0].manifestPath, path2, "latest manifest should be first")
    assert.strictEqual(list[1].manifestPath, path1, "older manifest should be second")

    // 2. 测试 findLatestManifest
    const latest = await findLatestManifest()
    assert.strictEqual(latest, path2)

    // 3. 测试 resolveManifestPath
    const resolvedDirect = await resolveManifestPath(path1)
    assert.strictEqual(resolvedDirect, path1)

    const resolvedByNum1 = await resolveManifestPath("1")
    assert.strictEqual(resolvedByNum1, path2)

    const resolvedByNum2 = await resolveManifestPath("#2")
    assert.strictEqual(resolvedByNum2, path1)

    const resolvedBySession = await resolveManifestPath(j1.sessionId)
    assert.strictEqual(resolvedBySession, path1)

    // 4. 测试 rollbackHandler 的 list 模式 (--list 与 positional 'list')
    // 应该正常执行不报错
    await rollbackHandler({ list: true })
    await rollbackHandler({ manifest: "list" })

    // 5. 测试不带 manifest 参数时自动选取最新 manifest
    // (在 testMode 下执行 dry-run，不抛出缺少 manifest 错误)
    await rollbackHandler({ doit: false, yes: true })

    // 清理
    await fs.remove(path1)
    await fs.remove(path2)
})
