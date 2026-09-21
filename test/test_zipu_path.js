/*
 * File: test_zipu_path.js
 * Description: Zip Slip（路径穿越）回归测试
 *
 * ZIP 条目名来自包内字节，完全不可信。历史上 `path.join(zipDir, entryName)`
 * 会归一化 `..`，使 `../../evil.txt` 写到解压目录之外——可覆盖任意可写文件。
 * cmd_zipu.js 的 resolveSafeEntryPath() 负责封堵该漏洞，本文件为其回归保护。
 */

import assert from "assert"
import path from "path"
import { describe, it } from "node:test"

import { resolveSafeEntryPath } from "../cmd/cmd_zipu.js"

const ZIP_DIR = path.resolve("/out/myzip")

/** 断言解析结果一定落在 ZIP_DIR 内 */
function assertContained(result) {
    const rel = path.relative(ZIP_DIR, result)
    assert.ok(rel.length > 0, `结果不应等于解压根目录: ${result}`)
    assert.ok(!rel.startsWith(".."), `结果越界: ${result}`)
    assert.ok(!path.isAbsolute(rel), `结果越界(绝对路径): ${result}`)
}

describe("zipu - resolveSafeEntryPath", () => {
    it("should keep normal entry names inside the extraction dir", () => {
        assert.strictEqual(resolveSafeEntryPath(ZIP_DIR, "a.txt"), path.join(ZIP_DIR, "a.txt"))
        assert.strictEqual(
            resolveSafeEntryPath(ZIP_DIR, "sub/a.txt"),
            path.join(ZIP_DIR, "sub", "a.txt"),
        )
    })

    it("should block '..' traversal", () => {
        for (const name of [
            "../../evil.txt",
            "..\\..\\evil.txt",
            "a/../../b.txt",
            "sub/../../../x",
        ]) {
            assertContained(resolveSafeEntryPath(ZIP_DIR, name))
        }
    })

    it("should block absolute paths and drive letters", () => {
        for (const name of [
            "/etc/passwd",
            "C:\\Windows\\evil.txt",
            "\\\\server\\share\\evil.txt",
        ]) {
            assertContained(resolveSafeEntryPath(ZIP_DIR, name))
        }
    })

    it("should throw when the entry name yields nothing usable", () => {
        for (const name of ["", ".", "..", "/", "///"]) {
            assert.throws(() => resolveSafeEntryPath(ZIP_DIR, name), {
                message: /BadName/,
            })
        }
    })

    it("should not let '..' cancel out a legit parent directory", () => {
        // "a/../../b.txt" 的正确处置是 a/b.txt（丢弃 ..），而不是逃出根目录
        assert.strictEqual(
            resolveSafeEntryPath(ZIP_DIR, "a/../../b.txt"),
            path.join(ZIP_DIR, "a", "b.txt"),
        )
    })
})
