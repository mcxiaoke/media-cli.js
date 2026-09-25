import { test, expect } from "../fixtures"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe("MediCli Desktop - Unified Input Ingest Spec", () => {
  test("duplicate path staging is deduplicated with a single chip and skip log", async ({ appWindow }) => {
    const testVideoPath = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')

    // Add the same path twice through the unified ingest entry.
    // Serialize: wait for the first entry to land before re-adding, so the
    // main-process dedupe (stagedEntries) and the local dedupe both see it.
    await manualInput.fill(testVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()
    await expect(appWindow.locator('[data-testid="task-row"]')).toHaveCount(1, { timeout: 15000 })
    await manualInput.fill(testVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()

    // Only one chip is kept (dedupe in config + stageInputs skippedDuplicates)
    const chipList = appWindow.locator('[data-testid="chip-list"]')
    await expect(chipList).toBeVisible()
    await expect(chipList.locator(".chip")).toHaveCount(1)
    await expect(chipList).toContainText("TEST2__h264_60fps_1080.mp4")

    // Only one staged task row appears
    await expect(appWindow.locator('[data-testid="task-row"]')).toHaveCount(1)

    // Duplicate skip is reported in the log
    await appWindow.locator('[data-testid="btn-open-log"]').click()
    const logDrawer = appWindow.locator('[data-testid="log-drawer"]')
    await expect(logDrawer).toBeVisible()
    await expect(logDrawer).toContainText("跳过 1 个重复添加的文件")
  })

  test("IPC staging failure keeps stores consistent and marks plan STALE", async ({ appWindow, electronApp }) => {
    const consoleErrors: string[] = []
    appWindow.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    appWindow.on("pageerror", (err) => consoleErrors.push(String(err)))

    // 1. Stage one real file so plan already has tasks (STALE baseline)
    const testVideoPath = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')
    await manualInput.fill(testVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()
    await expect(appWindow.locator('[data-testid="task-row"]')).toHaveCount(1, { timeout: 15000 })

    // 2. Inject IPC failure from the main process side (replace stage handler).
    // Note: this callback runs inside the Electron main process scope, so the
    // channel name must be inlined rather than referenced from this module.
    await electronApp.evaluate(async ({ ipcMain }) => {
      ipcMain.removeHandler("ffmpeg:stage-inputs")
      ipcMain.handle("ffmpeg:stage-inputs", async () => {
        throw new Error("test injected stage failure")
      })
    })

    // 3. Add a second (different) path that will fail during staging
    const secondVideoPath = path.join(path.dirname(testVideoPath), "TEST2__h264_422_8bit.mkv")
    await manualInput.fill(secondVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()

    // config store keeps both paths (input list does not roll back)
    const chipList = appWindow.locator('[data-testid="chip-list"]')
    await expect(chipList).toContainText("TEST2__h264_60fps_1080.mp4")
    await expect(chipList).toContainText("TEST2__h264_422_8bit.mkv")

    // plan store is marked STALE while keeping exactly the one successfully staged task.
    // The staged task is still present so hasStaged wins and the tag reads 待规划.
    const stateTag = appWindow.locator('[data-testid="state-tag"]')
    await expect(stateTag).toContainText("待规划")
    await expect(appWindow.locator('[data-testid="task-row"]')).toHaveCount(1)

    // 4. Failure is recorded in the log drawer
    await appWindow.locator('[data-testid="btn-open-log"]').click()
    const logDrawer = appWindow.locator('[data-testid="log-drawer"]')
    await expect(logDrawer).toBeVisible()
    await expect(logDrawer).toContainText("暂存输入失败")

    // 5. No unhandled renderer errors beyond the expected console.error from the catch branch
    const fatalErrors = consoleErrors.filter((e) =>
      /TypeError|ReferenceError|SyntaxError|Unhandled/i.test(e)
    )
    expect(fatalErrors).toEqual([])
  })
})
