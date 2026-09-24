import { test, expect } from "../fixtures"

test.describe("MediCli Desktop - Smoke & Visual Spec", () => {
  test("launch app, verify UI layout, theme, and initial state", async ({ appWindow }) => {
    // 1. HeaderBar check
    const headerBar = appWindow.locator('[data-testid="header-bar"]')
    await expect(headerBar).toBeVisible()
    await expect(headerBar).toContainText("mediac FFmpeg Studio")

    const stateTag = appWindow.locator('[data-testid="state-tag"]')
    await expect(stateTag).toBeVisible()
    await expect(stateTag).toContainText("待机")

    // 2. ConfigPanel cards check
    const configPanel = appWindow.locator('[data-testid="config-panel"]')
    await expect(configPanel).toBeVisible()

    await expect(appWindow.locator('[data-testid="card-input-output"]')).toBeVisible()
    await expect(appWindow.locator('[data-testid="card-preset"]')).toBeVisible()
    await expect(appWindow.locator('[data-testid="card-video"]')).toBeVisible()
    await expect(appWindow.locator('[data-testid="card-audio"]')).toBeVisible()
    await expect(appWindow.locator('[data-testid="card-advanced"]')).toBeVisible()

    // 3. HeroEmpty dropzone check
    const heroEmpty = appWindow.locator('[data-testid="hero-empty"]')
    await expect(heroEmpty).toBeVisible()
    await expect(heroEmpty).toContainText("拖入媒体文件或目录开始转码")

    // 4. ExecutionBoard compact state check
    const execBoard = appWindow.locator('[data-testid="execution-board"]')
    await expect(execBoard).toBeVisible()
    await expect(execBoard).toHaveClass(/compact/)

    // 5. Theme toggle check
    const themeBtn = appWindow.locator('[data-testid="btn-theme-toggle"]')
    const html = appWindow.locator("html")
    const initialTheme = await html.getAttribute("data-theme")

    await themeBtn.click()
    const newTheme = await html.getAttribute("data-theme")
    expect(newTheme).not.toBe(initialTheme)

    await themeBtn.click()
    expect(await html.getAttribute("data-theme")).toBe(initialTheme)

    // 6. Sidebar collapse check
    const sidebar = appWindow.locator("aside.side")
    await expect(sidebar).not.toHaveClass(/collapsed/)

    const sidebarToggle = appWindow.locator('[data-testid="btn-sidebar-toggle"]')
    await sidebarToggle.click()
    await expect(sidebar).toHaveClass(/collapsed/)

    await sidebarToggle.click()
    await expect(sidebar).not.toHaveClass(/collapsed/)
  })
})
