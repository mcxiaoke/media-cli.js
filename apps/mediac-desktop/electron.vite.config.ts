import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import vue from "@vitejs/plugin-vue"

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(appRoot, "../..")

const copyCoreData = {
  name: "copy-core-data",
  writeBundle() {
    const presetOutputDir = path.join(appRoot, "out/presets")
    fs.mkdirSync(presetOutputDir, { recursive: true })
    fs.copyFileSync(
      path.join(coreRoot, "presets", "default.yaml"),
      path.join(presetOutputDir, "default.yaml"),
    )
  },
}

export default defineConfig({
  main: {
    plugins: [
      copyCoreData,
      externalizeDepsPlugin({
        exclude: ["p-map", "systeminformation", "fs-extra", "execa", "yaml", "file-type"],
      }),
    ],
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [vue()],
  },
})
