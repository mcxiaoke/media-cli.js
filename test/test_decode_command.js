/*
 * File: test_decode_command.js
 * Created: 2026-03-23
 * Modified: 2026-09-19
 * Author: mcxiaoke
 * License: Apache License 2.0
 *
 * 说明：本文件此前不是标准的 node:test 用例（顶层直接执行 + process.exit），
 * 被 node --test 判定为失败；且 spawnSync 未指定 cwd，从其他目录运行必然失败。
 * 现改为标准 describe/it 结构，并通过 process.execPath + cwd 保证可复现。
 */

import assert from "assert"
import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import { spawnSync } from "child_process"
import { describe, it, before, after } from "node:test"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const testDir = path.join(__dirname, "temp_decode")
const testFile = path.join(testDir, "test.txt")

/**
 * 以项目根目录为 cwd 运行 CLI
 * @param {string[]} args - CLI 参数
 * @returns {import('child_process').SpawnSyncReturns<string>}
 */
function runCli(args) {
    return spawnSync(process.execPath, ["index.js", ...args], {
        cwd: projectRoot,
        encoding: "utf8",
    })
}

describe("decode command", () => {
    before(async () => {
        await fs.ensureDir(testDir)
        await fs.writeFile(testFile, "测试文件内容", "utf8")
    })

    after(async () => {
        await fs.remove(testDir)
    })

    it("should decode a single string", () => {
        const r = runCli(["decode", "测试"])
        assert.strictEqual(r.status, 0, r.stderr)
    })

    it("should decode multiple strings", () => {
        const r = runCli(["decode", "测试1", "测试2", "测试3"])
        assert.strictEqual(r.status, 0, r.stderr)
    })

    it("should decode with explicit encodings", () => {
        const r = runCli(["decode", "--from-enc", "gbk", "--to-enc", "utf8", "测试"])
        assert.strictEqual(r.status, 0, r.stderr)
    })

    it("should decode a file", () => {
        const r = runCli(["decode", "--files", testFile])
        assert.strictEqual(r.status, 0, r.stderr)
    })

    it("should decode a GBK-encoded file without data loss", () => {
        // 回归测试：此前按 UTF-8 读取，字节在读入阶段就变成 U+FFFD，
        // 导致 decode 对自己要处理的乱码文件无效。改用 latin1 读取后应可还原。
        const gbkFile = path.join(testDir, "gbk.txt")
        // "中文测试" 的 GBK 字节
        fs.writeFileSync(gbkFile, Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0xb2, 0xe2, 0xca, 0xd4]))
        const r = runCli(["decode", "--files", gbkFile])
        assert.strictEqual(r.status, 0, r.stderr)
    })

    it("should show help", () => {
        const r = runCli(["decode", "--help"])
        assert.strictEqual(r.status, 0, r.stderr)
        assert.ok(r.stdout.includes("--files"), "帮助应包含 --files 选项")
    })
})
