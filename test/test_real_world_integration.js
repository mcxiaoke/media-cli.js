import assert from "node:assert/strict"
import fs from "fs-extra"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { handler as moveupHandler } from "../cmd/cmd_moveup.js"
import { handler as prefixHandler } from "../cmd/cmd_prefix.js"
import { handler as removeHandler } from "../cmd/cmd_remove.js"
import { handler as rollbackHandler } from "../cmd/cmd_rollback.js"
import { getJournalDir } from "../lib/journal.js"
import * as helper from "../lib/helper.js"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("Real-world scenario: moveup -> rollback", async () => {
    const sandbox = path.join(ROOT, "temp", "real_test_moveup")
    await fs.remove(sandbox)
    const subDir = path.join(sandbox, "sub_photos")
    await fs.ensureDir(subDir)

    // 创建 5 个测试文件
    for (let i = 1; i <= 5; i++) {
        await fs.writeFile(path.join(subDir, `photo_${i}.jpg`), `photo content ${i}`, "utf8")
    }

    // 1. Dry-run moveup
    await moveupHandler({
        input: sandbox,
        flat: true,
        doit: false,
        yes: true,
    })
    // 验证文件仍在原子目录
    for (let i = 1; i <= 5; i++) {
        assert.ok(await fs.pathExists(path.join(subDir, `photo_${i}.jpg`)))
    }

    // 2. Doit moveup
    await moveupHandler({
        input: sandbox,
        flat: true,
        doit: true,
        yes: true,
    })
    // 验证文件已被移动到根目录
    for (let i = 1; i <= 5; i++) {
        assert.ok(await fs.pathExists(path.join(sandbox, `photo_${i}.jpg`)))
    }

    // 找到刚刚生成的 moveup doit manifest
    const journalFiles = (await fs.readdir(getJournalDir())).filter(
        (f) => f.startsWith("moveup_") && f.endsWith(".json"),
    )
    let doitManifest = null
    for (const f of journalFiles) {
        const full = path.join(getJournalDir(), f)
        const data = await fs.readJson(full)
        if (
            data.command === "moveup" &&
            data.input === sandbox &&
            !data.dryRun &&
            data.status === "success"
        ) {
            doitManifest = full
        }
    }
    assert.ok(doitManifest, "moveup doit manifest should be found")

    // 3. Rollback moveup
    await rollbackHandler({
        manifest: doitManifest,
        doit: true,
        yes: true,
    })
    // 验证所有文件被精准移回子目录！
    for (let i = 1; i <= 5; i++) {
        assert.ok(await fs.pathExists(path.join(subDir, `photo_${i}.jpg`)))
        assert.ok(!(await fs.pathExists(path.join(sandbox, `photo_${i}.jpg`))))
    }

    await fs.remove(sandbox)
})

test("Real-world scenario: prefix -> rollback", async () => {
    const sandbox = path.join(ROOT, "temp", "real_test_prefix")
    await fs.remove(sandbox)
    await fs.ensureDir(sandbox)

    // 创建 5 个测试文件（大于 1024 字节以满足 prefix 的过滤条件）
    for (let i = 1; i <= 5; i++) {
        await fs.writeFile(path.join(sandbox, `vacation_${i}.jpg`), Buffer.alloc(2048, i), "utf8")
    }

    // 1. Dry-run prefix
    await prefixHandler({
        input: sandbox,
        prefix: "PRE_",
        mode: "prefix",
        doit: false,
        yes: true,
    })
    for (let i = 1; i <= 5; i++) {
        assert.ok(await fs.pathExists(path.join(sandbox, `vacation_${i}.jpg`)))
    }

    // 2. Doit prefix
    await prefixHandler({
        input: sandbox,
        prefix: "PRE",
        mode: "prefix",
        doit: true,
        yes: true,
    })

    // 找到刚刚生成的 doit prefix manifest (非 dry-run)
    const journalFiles = (await fs.readdir(getJournalDir())).filter(
        (f) => f.startsWith("prefix_") && f.endsWith(".json"),
    )
    let doitManifest = null
    let manifestData = null
    for (const f of journalFiles) {
        const full = path.join(getJournalDir(), f)
        const data = await fs.readJson(full)
        if (data.command === "prefix" && !data.dryRun && data.status === "success") {
            doitManifest = full
            manifestData = data
        }
    }
    assert.ok(doitManifest, "doit manifest should be found")

    // 验证所有目标改名文件真实存在
    for (const op of manifestData.operations) {
        assert.ok(await fs.pathExists(op.dst), `dst should exist: ${op.dst}`)
    }

    // 3. Rollback prefix
    await rollbackHandler({
        manifest: doitManifest,
        doit: true,
        yes: true,
    })

    // 验证回滚后：源路径恢复，改名路径消失
    for (const op of manifestData.operations) {
        assert.ok(await fs.pathExists(op.src), `src should be restored: ${op.src}`)
        assert.ok(!(await fs.pathExists(op.dst)), `dst should be gone: ${op.dst}`)
    }

    await fs.remove(sandbox)
})

test("Real-world scenario: safeRemove in remove command -> volume-local .mediac/deleted -> rollback", async () => {
    const sandbox = path.join(ROOT, "temp", "real_test_remove")
    await fs.remove(sandbox)
    await fs.ensureDir(sandbox)

    for (let i = 1; i <= 3; i++) {
        await fs.writeFile(path.join(sandbox, `rem_${i}.jpg`), `rem content ${i}`, "utf8")
    }

    // 1. Dry-run remove
    await removeHandler({
        input: sandbox,
        pattern: "rem_",
        doit: false,
        yes: true,
    })
    for (let i = 1; i <= 3; i++) {
        assert.ok(await fs.pathExists(path.join(sandbox, `rem_${i}.jpg`)))
    }

    // 2. Doit remove
    await removeHandler({
        input: sandbox,
        pattern: "rem_",
        doit: true,
        yes: true,
    })
    for (let i = 1; i <= 3; i++) {
        assert.ok(!(await fs.pathExists(path.join(sandbox, `rem_${i}.jpg`))))
    }

    // 验证同盘 .mediac/deleted 目录存在
    const deletedDir = helper.getSafeDeletedDir(sandbox)
    assert.ok(await fs.pathExists(deletedDir), "volume-local .mediac/deleted should exist")

    // 验证 deleted 目录内存在复制的 manifest
    const filesInDeleted = await fs.readdir(deletedDir)
    const copiedManifest = filesInDeleted.find(
        (f) => f.startsWith("remove_") && f.endsWith(".json"),
    )
    assert.ok(copiedManifest, "manifest should be copied to deleted dir")

    // 找到刚刚生成的 doit remove manifest (非 dry-run)
    const journalFiles = (await fs.readdir(getJournalDir())).filter(
        (f) => f.startsWith("remove_") && f.endsWith(".json"),
    )
    let doitManifest = null
    for (const f of journalFiles) {
        const full = path.join(getJournalDir(), f)
        const data = await fs.readJson(full)
        if (data.command === "remove" && !data.dryRun && data.status === "success") {
            doitManifest = full
        }
    }
    assert.ok(doitManifest, "doit remove manifest should be found")

    // 3. Rollback remove
    await rollbackHandler({
        manifest: doitManifest,
        doit: true,
        yes: true,
    })
    // 验证被删除的文件从 .mediac/deleted 精准恢复回 sandbox！
    for (let i = 1; i <= 3; i++) {
        assert.ok(await fs.pathExists(path.join(sandbox, `rem_${i}.jpg`)))
    }

    await fs.remove(sandbox)
})
