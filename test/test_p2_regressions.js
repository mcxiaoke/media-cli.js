/**
 * P2 轮修复的回归测试
 *
 * 覆盖项：
 *   - fileHash 在文件不可读时 reject（此前永不 settle，调用方直接挂死）
 *   - countOccurrences / uniqueByFields 不被 __proto__ / toString 污染
 *   - comparePathSmart 中西混排路径走本地化比较而非 ASCII 比较
 *   - isSameFileCached 在文件内容被改写后不再返回旧哈希
 *   - getSafeDeletedDir 落在用户目录下（而非盘根，避免非管理员 EACCES）
 */

import assert from "assert"
import fsp from "fs/promises"
import os from "os"
import path from "path"
import { describe, it, before, after } from "node:test"

import * as core from "../lib/core.js"
import * as file from "../lib/file.js"
import * as helper from "../lib/helper.js"
import * as tools from "../lib/tools.js"

const TMP_DIR = path.join("temp", "test_p2")

describe("P2 regressions", () => {
    before(async () => {
        await fsp.rm(TMP_DIR, { recursive: true, force: true })
        await fsp.mkdir(TMP_DIR, { recursive: true })
    })

    after(async () => {
        await fsp.rm(TMP_DIR, { recursive: true, force: true })
    })

    describe("fileHash", () => {
        it("rejects instead of hanging when the file does not exist", async () => {
            const missing = path.join(TMP_DIR, "no-such-file.bin")
            await assert.rejects(
                () => helper.fileHash(missing),
                (err) => err instanceof Error && /ENOENT/.test(err.message),
            )
        })

        it("rejects instead of hanging when the target is a directory", async () => {
            await assert.rejects(
                () => helper.fileHash(TMP_DIR),
                (err) => err instanceof Error,
            )
        })

        it("still computes the correct digest for a real file", async () => {
            const f = path.join(TMP_DIR, "hello.txt")
            await fsp.writeFile(f, "hello")
            assert.strictEqual(await helper.fileHash(f), "5d41402abc4b2a76b9719d911017c592")
        })
    })

    describe("prototype-key safety", () => {
        it("countOccurrences counts __proto__ and toString as ordinary values", () => {
            const result = core.countOccurrences(["__proto__", "toString", "a", "a"])
            const map = new Map(result)
            // 修复前这两项会得到 NaN 或直接被吞掉
            assert.strictEqual(map.get("__proto__"), 1)
            assert.strictEqual(map.get("toString"), 1)
            assert.strictEqual(map.get("a"), 2)
        })

        it("uniqueByFields keeps __proto__ / toString keys instead of treating them as seen", () => {
            const rows = [{ k: "__proto__" }, { k: "toString" }, { k: "toString" }]
            const out = core.uniqueByFields(rows, "k")
            assert.strictEqual(out.length, 2)
            assert.deepStrictEqual(
                out.map((r) => r.k),
                ["__proto__", "toString"],
            )
        })
    })

    describe("comparePathSmart", () => {
        it("treats mixed CJK/ASCII paths as non-ASCII (locale-aware branch)", () => {
            // 阿(a) 与 波(bo)：拼音序 阿 < 波，但码点序 波(6CE2) < 阿(963F)，
            // 两条分支结果相反，可明确区分走了哪一支。
            // 修复前 /\p{ASCII}/u 只要含任一 ASCII 字符即命中 → 走 toLowerCase 码点比较。
            const a = "D:/x/阿.jpg"
            const b = "D:/x/波.jpg"
            const expected = a.localeCompare(b, ["ja", "zh"])
            assert.strictEqual(core.comparePathSmart(a, b), expected)

            // 若 ICU 数据完整，两条分支应当确实不同；否则跳过该断言
            const asciiBranch = a.toLowerCase() < b.toLowerCase() ? -1 : 1
            if (asciiBranch !== expected) {
                assert.notStrictEqual(core.comparePathSmart(a, b), asciiBranch)
            }
        })

        it("still uses the fast ASCII branch for pure-ASCII paths", () => {
            assert.strictEqual(core.comparePathSmart("D:/ab/A.txt", "D:/ab/B.txt"), -1)
            assert.strictEqual(core.comparePathSmart("D:/ab/B.txt", "D:/ab/A.txt"), 1)
        })
    })

    describe("isSameFileCached", () => {
        it("does not reuse a stale hash after the file content changes", async () => {
            const a = path.join(TMP_DIR, "same_a.bin")
            const b = path.join(TMP_DIR, "same_b.bin")
            await fsp.writeFile(a, "AAAA")
            await fsp.writeFile(b, "AAAA")

            assert.strictEqual(await tools.isSameFileCached(a, b), true)

            // 内容改写但长度不变：旧实现命中路径缓存，会误判仍相同
            await fsp.writeFile(b, "BBBB")
            assert.strictEqual(await tools.isSameFileCached(a, b), false)
        })
    })

    describe("safe delete dir", () => {
        it("lives under the user home, not the volume root", () => {
            const dir = helper.getSafeDeletedDir("C:/some/where/file.jpg")
            const home = os.homedir()
            assert.ok(
                dir.toLowerCase().startsWith(home.toLowerCase()),
                `expected under ${home}, got ${dir}`,
            )
            assert.ok(dir.includes("deleted"))
        })
    })

    describe("filenameSafe", () => {
        it("still strips illegal characters but keeps lowercase s", () => {
            assert.strictEqual(helper.filenameSafe("test.jpg"), "test.jpg")
            assert.strictEqual(helper.filenameSafe("abc.psd"), "abc.psd")
            assert.strictEqual(helper.filenameSafe("a<b>c:d.jpg"), "abcd.jpg")
        })

        it("escapes Windows reserved device names", () => {
            for (const name of ["CON", "con", "NUL", "COM1.mp4", "LPT9"]) {
                assert.ok(helper.isReservedWindowsName(name), `${name} should be reserved`)
                assert.strictEqual(helper.filenameSafe(name), `_${name}`)
            }
        })

        it("does not treat names merely starting with a reserved word as reserved", () => {
            for (const name of ["CONTENT.txt", "CONSOLE.log", "NULLABLE.js"]) {
                assert.strictEqual(helper.isReservedWindowsName(name), false)
                assert.strictEqual(helper.filenameSafe(name), name)
            }
        })

        it("normalizes NFD input to NFC so macOS/camera names match", () => {
            const nfd = "Cafe\u0301.jpg" // e + U+0301 combining acute
            const nfc = "Caf\u00e9.jpg"
            assert.strictEqual(helper.filenameSafe(nfd), nfc)
        })
    })

    describe("moveSafe", () => {
        it("moves a file (fast path stays a rename) and reports the destination", async () => {
            const src = path.join(TMP_DIR, "mv_src.txt")
            const dst = path.join(TMP_DIR, "mv_dst.txt")
            await fsp.writeFile(src, "payload")
            const out = await file.moveSafe(src, dst)
            assert.strictEqual(out, dst)
            assert.strictEqual(await fsp.readFile(dst, "utf8"), "payload")
            await assert.rejects(() => fsp.stat(src))
        })

        it("propagates non-EXDEV errors instead of silently copying", async () => {
            const missing = path.join(TMP_DIR, "does-not-exist.txt")
            const dst = path.join(TMP_DIR, "whatever.txt")
            await assert.rejects(
                () => file.moveSafe(missing, dst),
                (err) => err instanceof Error && /ENOENT/.test(err.message),
            )
        })
    })
})
