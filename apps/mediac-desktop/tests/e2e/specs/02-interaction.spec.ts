import { test, expect } from "../fixtures"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe("MediCli Desktop - Interaction & State Machine Spec", () => {
  test("input addition, plan generation, inspection, STALE state and drawers", async ({ appWindow }) => {
    const consoleErrors: string[] = []
    appWindow.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    appWindow.on("pageerror", (err) => consoleErrors.push(String(err)))
    appWindow.on("dialog", (dialog) => {
      void dialog.accept()
    })

    // 1. Add manual input file from project test materials
    const testVideoPath = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')
    await manualInput.fill(testVideoPath)

    const btnManualAdd = appWindow.locator('[data-testid="btn-manual-add"]')
    await btnManualAdd.click()

    // Verify chip list contains the added item
    const chipList = appWindow.locator('[data-testid="chip-list"]')
    await expect(chipList).toBeVisible()
    await expect(chipList).toContainText("TEST2__h264_60fps_1080.mp4")

    // 2. Generate Plan
    const btnPlan = appWindow.locator('[data-testid="btn-plan"]')
    await btnPlan.click()

    // Verify table appears and HeroEmpty is gone
    const taskTable = appWindow.locator('[data-testid="tasks-table"]')
    await expect(taskTable).toBeVisible({ timeout: 15000 })
    await expect(appWindow.locator('[data-testid="hero-empty"]')).not.toBeVisible()

    // Verify task row
    const taskRow = appWindow.locator('[data-testid="task-row"]').first()
    await expect(taskRow).toBeVisible()
    await expect(taskRow).toContainText("TEST2__h264_60fps_1080.mp4")

    // Test row single click selection
    await taskRow.click()
    await expect(taskRow).toHaveClass(/sel/)

    // Test row right click
    await taskRow.click({ button: "right" })
    await expect(taskRow).toHaveClass(/sel/)

    // Verify state is READY (待执行)
    const stateTag = appWindow.locator('[data-testid="state-tag"]')
    await expect(stateTag).toContainText("待执行")

    const btnStart = appWindow.locator('[data-testid="btn-start"]')
    await expect(btnStart).toBeEnabled()

    // 3. Inspect task details & metadata
    const btnInspect = appWindow.locator('[data-testid="btn-inspect-task"]').first()
    await btnInspect.click()

    const inspector = appWindow.locator('[data-testid="inspector-mask"]')
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText("TEST2__h264_60fps_1080.mp4")
    await expect(inspector).toContainText("1920×1080")
    await expect(inspector).toContainText("8 bit")
    await expect(inspector).toContainText("FFmpeg 命令行")

    // Test copy command button
    const btnCopyCmd = appWindow.locator('[data-testid="btn-copy-cmd"]')
    await expect(btnCopyCmd).toBeVisible()
    await btnCopyCmd.click()
    await expect(btnCopyCmd).toContainText("已复制")

    // Test toggle and copy raw metadata
    const btnToggleRaw = appWindow.locator('[data-testid="btn-toggle-raw-meta"]')
    await expect(btnToggleRaw).toBeVisible()
    await btnToggleRaw.click()

    const rawMetaBox = appWindow.locator('[data-testid="insp-raw-meta-box"]')
    await expect(rawMetaBox).toBeVisible()
    await expect(rawMetaBox).toContainText('"video"')

    const btnCopyRaw = appWindow.locator('[data-testid="btn-copy-raw-meta"]')
    await btnCopyRaw.click()
    await expect(btnCopyRaw).toContainText("已复制")

    // Close inspector drawer
    const btnCloseInspect = appWindow.locator('[data-testid="btn-close-inspector"]')
    await btnCloseInspect.click()
    await expect(inspector).not.toBeVisible()

    // 4. Test STALE state machine: modify video parameter
    const videoCardToggle = appWindow.locator('[data-testid="card-video"] .card-title.toggle')
    await videoCardToggle.click()

    const videoBody = appWindow.locator('[data-testid="video-body"]')
    await expect(videoBody).toBeVisible()

    // Change dimension to 1280
    const selectDimension = appWindow.locator('[data-testid="select-dimension"]')
    await selectDimension.selectOption("1280")

    // Check dirty indicator and STALE banner
    const staleAlert = appWindow.locator('[data-testid="stale-alert"]')
    await expect(staleAlert).toBeVisible()
    await expect(staleAlert).toContainText("参数已变更，请点击「更新计划」")

    // Verify button text changed to "更新计划" and Start button is disabled
    await expect(btnPlan).toContainText("更新计划")
    await expect(btnStart).toBeDisabled()

    // Click Update Plan to re-synchronize
    await btnPlan.click()
    await expect(staleAlert).not.toBeVisible({ timeout: 15000 })
    await expect(btnPlan).toContainText("生成计划")
    await expect(btnStart).toBeEnabled()

    // 5. Test Log drawer & Copy log
    const btnOpenLog = appWindow.locator('[data-testid="btn-open-log"]')
    await btnOpenLog.click()

    const logDrawer = appWindow.locator('[data-testid="log-drawer"]')
    await expect(logDrawer).toBeVisible()

    const btnCopyLog = appWindow.locator('[data-testid="btn-copy-log"]')
    await expect(btnCopyLog).toBeVisible()
    await btnCopyLog.click()
    await expect(btnCopyLog).toContainText("已复制")

    const btnCloseLog = appWindow.locator('[data-testid="btn-close-log"]')
    await btnCloseLog.click()
    await expect(logDrawer).not.toBeVisible()

    // 6. Test Settings modal
    const btnOpenSettings = appWindow.locator('[data-testid="btn-open-settings"]')
    await btnOpenSettings.click()

    const settingsModal = appWindow.locator('[data-testid="settings-modal"]')
    await expect(settingsModal).toBeVisible()
    await expect(settingsModal).toContainText("FFmpeg 核心")

    const btnCloseSettings = settingsModal.locator(".icon-btn")
    await btnCloseSettings.click()
    await expect(settingsModal).not.toBeVisible()

    // 7. Verify no fatal console errors
    const fatalErrors = consoleErrors.filter((e) =>
      /TypeError|ReferenceError|SyntaxError|Unhandled/i.test(e)
    )
    expect(fatalErrors).toEqual([])
  })

  test("two-phase pipeline: instant metadata probing, format tag, quick preview, and task deletion", async ({ appWindow }) => {
    // 1. Initial empty state
    await expect(appWindow.locator('[data-testid="hero-empty"]')).toBeVisible()

    // 2. Add input file and verify immediate table display before clicking plan
    const testVideoPath = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')
    await manualInput.fill(testVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()

    // Immediate appearance of TaskTable
    const taskTable = appWindow.locator('[data-testid="tasks-table"]')
    await expect(taskTable).toBeVisible({ timeout: 10000 })
    await expect(appWindow.locator('[data-testid="hero-empty"]')).not.toBeVisible()

    // Verify format tag (MP4) and staged status badge
    const formatTag = appWindow.locator(".fmt-tag").first()
    await expect(formatTag).toBeVisible()
    await expect(formatTag).toHaveText("MP4")

    const taskStatus = appWindow.locator('[data-testid="task-status"]').first()
    await expect(taskStatus).toHaveText("待规划")

    // Verify bottom preview bar
    const bottomBar = appWindow.locator('[data-testid="table-bottom-bar"]')
    await expect(bottomBar).toBeVisible()

    // Verify bottom quick preview
    const quickPreview = appWindow.locator('[data-testid="task-quick-preview"]')
    await expect(quickPreview).toBeVisible()
    await expect(quickPreview).toContainText("1920x1080")
    await expect(quickPreview).toContainText("待推演")

    // 3. Test single row deletion
    const btnRemove = appWindow.locator('[data-testid="btn-remove-task"]').first()
    await btnRemove.click()

    // Verify table is empty and HeroEmpty returns
    await expect(appWindow.locator('[data-testid="hero-empty"]')).toBeVisible()
    await expect(taskTable).not.toBeVisible()
  })

  test("checkbox left-click decoupling, row dblclick inspection, right-click context menu, and resizable drawers", async ({ appWindow }) => {
    // 1. Ingest two video files
    const video1 = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const video2 = path.resolve(__dirname, "../../../../../data/videos/TEST2__hevc_60fps_1080.mp4")

    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')
    const btnManualAdd = appWindow.locator('[data-testid="btn-manual-add"]')

    await manualInput.fill(video1)
    await btnManualAdd.click()

    await manualInput.fill(video2)
    await btnManualAdd.click()

    // 2. Generate Plan
    const btnPlan = appWindow.locator('[data-testid="btn-plan"]')
    await btnPlan.click()

    const taskRows = appWindow.locator('[data-testid="task-row"]')
    await expect(taskRows).toHaveCount(2, { timeout: 15000 })

    const row0 = taskRows.nth(0)
    const row1 = taskRows.nth(1)

    const ck0 = row0.locator('[data-testid="task-checkbox"]')
    const ck1 = row1.locator('[data-testid="task-checkbox"]')

    // Initially all selected
    await expect(ck0).toHaveClass(/on/)
    await expect(ck1).toHaveClass(/on/)

    // 3. Test bottom button styling and toggle all
    const btnToggleAll = appWindow.locator('[data-testid="btn-toggle-all"]')
    await expect(btnToggleAll).toBeVisible()
    await expect(btnToggleAll).toHaveClass(/btn-secondary/)
    await btnToggleAll.click()

    // Now all unselected
    await expect(ck0).not.toHaveClass(/on/)
    await expect(ck1).not.toHaveClass(/on/)

    // 4. Test checkbox left-click selection and filename click decoupling
    await ck0.click({ button: "left" })
    await expect(ck0).toHaveClass(/on/)
    await expect(ck1).not.toHaveClass(/on/)

    // Clicking filename of row0 or row1 must NOT change checkbox checked status!
    const row1Filename = row1.locator(".t-main span").last()
    await row1Filename.click()
    // row1 is now focused, but checkbox states remain unchanged
    await expect(ck0).toHaveClass(/on/)
    await expect(ck1).not.toHaveClass(/on/)

    // 5. Test right-click context menu
    await row1.click({ button: "right" })
    const ctxMenu = appWindow.locator('[data-testid="task-context-menu"]')
    await expect(ctxMenu).toBeVisible()

    // Test select all from context menu
    const ctxSelectAll = appWindow.locator('[data-testid="ctx-select-all"]')
    await ctxSelectAll.click()
    await expect(ctxMenu).not.toBeVisible()
    await expect(ck0).toHaveClass(/on/)
    await expect(ck1).toHaveClass(/on/)

    // 6. Test double click row to open inspection drawer
    await row0.dblclick()
    const inspector = appWindow.locator('[data-testid="inspector-mask"]')
    await expect(inspector).toBeVisible()
    await expect(inspector).toContainText("TEST2__h264_60fps_1080.mp4")

    const resizer = appWindow.locator('[data-testid="inspector-drawer-resizer"]')
    await expect(resizer).toBeVisible()

    const btnCloseInspect = appWindow.locator('[data-testid="btn-close-inspector"]')
    await btnCloseInspect.click()
    await expect(inspector).not.toBeVisible()

    // 7. Test log drawer width toggle and resizer
    const btnOpenLog = appWindow.locator('[data-testid="btn-open-log"]')
    await btnOpenLog.click()
    const logDrawer = appWindow.locator('[data-testid="log-drawer"]')
    await expect(logDrawer).toBeVisible()

    const logResizer = appWindow.locator('[data-testid="log-drawer-resizer"]')
    await expect(logResizer).toBeVisible()

    const btnToggleWidth = appWindow.locator('[data-testid="btn-toggle-log-width"]')
    await expect(btnToggleWidth).toBeVisible()
    await btnToggleWidth.click()
    await expect(btnToggleWidth).toContainText("标准宽度")

    const btnCloseLog = appWindow.locator('[data-testid="btn-close-log"]')
    await btnCloseLog.click()
    await expect(logDrawer).not.toBeVisible()
  })
})

