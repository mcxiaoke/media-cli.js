import { test, expect } from "../fixtures"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

test.describe("MediCli Desktop - Real Transcode Workflow Spec", () => {
  const outputDir = path.resolve(__dirname, "../../temp/e2e-transcode-output")
  const screenshotDir = path.resolve(__dirname, "../../temp/e2e-screenshots")

  test.beforeEach(() => {
    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true })
    }
    fs.mkdirSync(outputDir, { recursive: true })
    fs.mkdirSync(screenshotDir, { recursive: true })
  })

  test("full transcode run: planning, live progress, completion, output verification and screenshots", async ({ appWindow }) => {
    const consoleErrors: string[] = []
    appWindow.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    appWindow.on("pageerror", (err) => consoleErrors.push(String(err)))
    appWindow.on("dialog", (dialog) => {
      void dialog.accept()
    })

    // 1. Add input file
    const testVideoPath = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')
    await manualInput.fill(testVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()

    await appWindow.screenshot({ path: path.join(screenshotDir, "01-input-staged.png") })

    // 2. Configure output directory to temp folder
    const inputOutputDir = appWindow.locator('[data-testid="input-output-dir"]')
    await inputOutputDir.fill(outputDir)

    // Select flat output mode
    const selectOutputMode = appWindow.locator('[data-testid="select-output-mode"]')
    await selectOutputMode.selectOption("file")

    // Select preset h264_2k
    const selectPreset = appWindow.locator('[data-testid="select-preset"]')
    await selectPreset.selectOption("h264_2k")

    // 3. Generate Plan
    const btnPlan = appWindow.locator('[data-testid="btn-plan"]')
    await btnPlan.click()

    const taskRow = appWindow.locator('[data-testid="task-row"]').first()
    await expect(taskRow).toBeVisible({ timeout: 15000 })

    const stateTag = appWindow.locator('[data-testid="state-tag"]')
    await expect(stateTag).toHaveText("待执行", { timeout: 15000 })

    await appWindow.screenshot({ path: path.join(screenshotDir, "02-plan-ready.png") })

    // 4. Start Transcode Execution
    const btnStart = appWindow.locator('[data-testid="btn-start"]')
    await expect(btnStart).toBeEnabled({ timeout: 10000 })
    await btnStart.click()

    // 5. Verify Running State
    const taskStatus = appWindow.locator('[data-testid="task-status"]').first()
    await expect(taskStatus).toHaveText(/转码中|已完成/, { timeout: 15000 })

    await appWindow.screenshot({ path: path.join(screenshotDir, "03-transcoding-running.png") })

    // 6. Wait for Transcode Completion (file is short, ~1 second video)
    await expect(taskStatus).toHaveText("已完成", { timeout: 45000 })
    await expect(stateTag).toContainText(/完成|待机/)

    // Start button must be disabled after all tasks finish
    await expect(btnStart).toBeDisabled()

    await appWindow.screenshot({ path: path.join(screenshotDir, "04-transcoding-completed.png") })

    // 7. Verify output file exists on disk
    function findMp4(dir: string): string[] {
      let results: string[] = []
      if (!fs.existsSync(dir)) return results
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) results = results.concat(findMp4(full))
        else if (entry.name.endsWith(".mp4") && !entry.name.includes("@tmp_")) results.push(full)
      }
      return results
    }

    const files = findMp4(outputDir)
    expect(files.length).toBeGreaterThan(0)
    const stats = fs.statSync(files[0])
    expect(stats.size).toBeGreaterThan(1000)

    // 7.1 Verify play source and play output buttons are visible and active
    const btnPlaySource = appWindow.locator('[data-testid="btn-play-source"]').first()
    await expect(btnPlaySource).toBeVisible()
    const btnPlayOutput = appWindow.locator('[data-testid="btn-play-output"]').first()
    await expect(btnPlayOutput).toBeVisible()

    // 7.2 Verify sticky output destination bar is visible
    const outputDestBar = appWindow.locator('[data-testid="output-dest-bar"]')
    await expect(outputDestBar).toBeVisible()
    await expect(appWindow.locator('[data-testid="ck-dest-beside"]')).toBeVisible()

    // 7.3 Capture UI screenshots for About Modal and Shana Compare Card
    const btnDetailToggle = appWindow.locator('[data-testid="btn-detail-toggle"]')
    if (await btnDetailToggle.isVisible()) {
      await btnDetailToggle.click()
      await appWindow.screenshot({ path: path.join(screenshotDir, "06-shana-compare-card.png") })
      await appWindow.locator('[data-testid="btn-collapse-detail"]').click()
    }

    const btnOpenAbout = appWindow.locator('[data-testid="status-about-btn"]')
    await btnOpenAbout.click()
    await expect(appWindow.locator('[data-testid="about-modal"]')).toBeVisible()
    await appWindow.screenshot({ path: path.join(screenshotDir, "05-about-modal.png") })
    await appWindow.locator('[data-testid="about-modal"] .icon-btn').click()

    // 8. Verify no fatal console errors occurred in renderer
    const fatalErrors = consoleErrors.filter((e) =>
      /TypeError|ReferenceError|SyntaxError|Unhandled/i.test(e)
    )
    expect(fatalErrors).toEqual([])
  })

  test("one-click direct execution: auto-plans and transcodes without manual plan button click", async ({ appWindow }) => {
    const consoleErrors: string[] = []
    appWindow.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    appWindow.on("pageerror", (err) => consoleErrors.push(String(err)))
    appWindow.on("dialog", (dialog) => {
      void dialog.accept()
    })

    // 1. Stage input video
    const testVideoPath = path.resolve(__dirname, "../../../../../data/videos/TEST2__h264_60fps_1080.mp4")
    const manualInput = appWindow.locator('[data-testid="input-manual-path"]')
    await manualInput.fill(testVideoPath)
    await appWindow.locator('[data-testid="btn-manual-add"]').click()

    const taskRow = appWindow.locator('[data-testid="task-row"]').first()
    await expect(taskRow).toBeVisible({ timeout: 15000 })
    await expect(appWindow.locator('[data-testid="task-status"]').first()).toHaveText("待规划")

    // 2. Set output directory
    const inputOutputDir = appWindow.locator('[data-testid="input-output-dir"]')
    await inputOutputDir.fill(outputDir)
    await appWindow.locator('[data-testid="select-output-mode"]').selectOption("file")

    // 3. Directly click "开始转码" WITHOUT clicking "生成计划"
    const btnStart = appWindow.locator('[data-testid="btn-start"]')
    await expect(btnStart).toBeEnabled()
    await btnStart.click()

    // 4. Verify it auto-plans and enters running/completed state
    const taskStatus = appWindow.locator('[data-testid="task-status"]').first()
    await expect(taskStatus).toHaveText(/转码中|已完成/, { timeout: 20000 })

    await appWindow.screenshot({ path: path.join(screenshotDir, "08-one-click-auto-plan-running.png") })

    // Wait for completion
    await expect(taskStatus).toHaveText("已完成", { timeout: 45000 })
    await appWindow.screenshot({ path: path.join(screenshotDir, "09-one-click-completed-playback.png") })

    // Verify output file exists
    const files = fs.readdirSync(outputDir).filter((f) => f.endsWith(".mp4") && !f.includes("@tmp_"))
    expect(files.length).toBeGreaterThan(0)
  })
})
