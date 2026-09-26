import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, "../../")

export const test = base.extend<{
  electronApp: ElectronApplication
  appWindow: Page
}>({
  // Playwright 要求 fixture 函数首参必须是对象解构模式（否则抛
  // "First argument must use the object destructuring pattern"），
  // 而此 fixture 不依赖其它 fixture，故只能是空模式。
  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    const app = await electron.launch({
      cwd: appRoot,
      args: ["."],
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    })
    await use(app)
    await app.close()
  },
  appWindow: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState("domcontentloaded")
    await use(page)
  },
})

export { expect }
