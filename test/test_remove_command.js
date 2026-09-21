/*
 * File: test_remove_command.js
 * Created: 2026-03-23
 * Modified: 2026-09-19
 * Author: mcxiaoke
 * License: Apache License 2.0
 *
 * 说明：本测试文件此前 7 个用例中 6 个失败，因而被排除在 npm test 之外，
 * 造成"测试全绿"的假象。失败根因有两类：
 *   1. 给 builder() 传入 `{}` 而非 yargs 实例 → TypeError: ya.option is not a function
 *   2. mock 了 console.log 去断言输出，但源码走 lib/debug.js 的 log 模块
 *      → 断言永远收集不到内容
 * 现已改为：用真实 yargs 实例验证 builder；用 handler 的真实副作用
 * （抛出特定错误 / 不抛错）来断言行为，不再依赖输出文本。
 */

import assert from "assert"
import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import { describe, it, before, after } from "node:test"
import yargs from "yargs"
import inquirer from "inquirer"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

import { builder, handler } from "../cmd/cmd_remove.js"

const testDir = path.join(__dirname, "test_remove")
const testFile1 = path.join(testDir, "test1.txt")
const testFile2 = path.join(testDir, "test2.txt")
const testFile3 = path.join(testDir, "test3.txt")

// handler 在匹配到文件后会调用 inquirer 等待用户确认，测试中必须 stub，
// 否则进程会一直阻塞在交互提示上。
const originalPrompt = inquirer.prompt
inquirer.prompt = async () => ({ yes: false })

describe("remove command", () => {
    before(async () => {
        await fs.ensureDir(testDir)
        await fs.writeFile(testFile1, "test content 1")
        await fs.writeFile(testFile2, "test content 2")
        await fs.writeFile(testFile3, "test content 3")
    })

    after(async () => {
        inquirer.prompt = originalPrompt
        await fs.remove(testDir)
    })

    it("should parse command line options correctly", () => {
        // 必须传真实 yargs 实例：builder 内部链式调用 .option()
        const ya = yargs([])
        const result = builder(ya, false)
        assert.ok(result, "builder 应返回 yargs 实例")
        assert.strictEqual(typeof result.option, "function", "应可链式调用 option")
    })

    it("should handle invalid input path", async () => {
        const invalidPath = path.join(testDir, "non_existent_dir")
        await assert.rejects(
            async () => handler({ input: invalidPath, doit: false }),
            (error) => {
                assert.ok(error.message.includes("Invalid Input"))
                return true
            },
        )
    })

    it("should require at least one condition", async () => {
        await assert.rejects(
            async () => handler({ input: testDir, doit: false }),
            (error) => {
                // 缺少任何删除条件时应拒绝执行
                assert.strictEqual(error.type, "MISSING_REQUIRED_ARGUMENT")
                return true
            },
        )
    })

    it("should reject NaN numeric conditions", async () => {
        // 回归测试：--width abc 解析为 NaN，旧实现因 NaN == 0 为 false 而放行
        await assert.rejects(
            async () => handler({ input: testDir, width: NaN, doit: false }),
            (error) => {
                assert.strictEqual(error.type, "MISSING_REQUIRED_ARGUMENT")
                return true
            },
        )
    })

    it("should accept size condition without throwing", async () => {
        // --sizel 提供有效数值时应通过校验（dry-run，不实际删除）
        await assert.doesNotReject(async () => handler({ input: testDir, sizel: 1, doit: false }))
    })

    it("should accept pattern condition without throwing", async () => {
        await assert.doesNotReject(async () =>
            handler({ input: testDir, pattern: "test1", doit: false }),
        )
    })

    it("should accept time condition without throwing", async () => {
        // 回归测试：--mtime 此前被必需条件校验漏掉，单独使用会报错
        await assert.doesNotReject(async () =>
            handler({ input: testDir, mtime: "1y", doit: false }),
        )
    })

    it("should accept audio condition without throwing", async () => {
        // 回归测试：--audio 此前同样被校验漏掉
        await assert.doesNotReject(async () =>
            handler({ input: testDir, audio: "du=100", doit: false }),
        )
    })

    it("should accept video condition without throwing", async () => {
        // 回归测试：--video 此前是死选项且单独使用会被拒绝
        await assert.doesNotReject(async () =>
            handler({ input: testDir, video: "du=100", doit: false }),
        )
    })
})
