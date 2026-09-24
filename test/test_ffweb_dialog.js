import assert from "assert"
import test from "node:test"
import { sanitizeDialogTitle } from "../ffweb/dialog.js"

test("native dialog title sanitizer removes controls and bounds length", () => {
    const value = sanitizeDialogTitle(`  title\u0000\n$() ${"x".repeat(300)}  `)
    assert.ok(!value.includes("\u0000"))
    assert.ok(!value.includes("\n"))
    assert.ok(value.length <= 200)
    assert.ok(value.includes("$()"))
})
