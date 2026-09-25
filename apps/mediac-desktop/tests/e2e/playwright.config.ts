import { defineConfig } from "@playwright/test"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: "./specs",
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  // Electron e2e 受系统调度/窗口焦点影响偶发超时，重试 1 次；
  // trace: "on-first-retry" 会自动记录重试轨迹便于定位 flaky 根因
  retries: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.resolve(__dirname, "../../temp/e2e-report") }],
  ],
  use: {
    actionTimeout: 15000,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
})
