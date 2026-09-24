import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "electron-vite"
import vue from "@vitejs/plugin-vue"

const appRoot = path.dirname(fileURLToPath(import.meta.url))
const coreRoot = path.resolve(appRoot, "../..")
const coreDataFiles = [
  "hanzi_rarely.txt",
  "hanzi_complex.txt",
  "hanzi_common_3500.txt",
  "hanzi_common_7000.txt",
  "hanzi_common_japanese.txt",
]

const copyCoreData = {
  name: "copy-core-data",
  writeBundle() {
    const outputDir = path.join(appRoot, "out/main")
    fs.mkdirSync(outputDir, { recursive: true })
    for (const fileName of coreDataFiles) {
      fs.copyFileSync(path.join(coreRoot, "lib", fileName), path.join(outputDir, fileName))
    }
  },
}

export default defineConfig({
  main: {
    plugins: [copyCoreData],
    build: {
      externalizeDeps: true,
    },
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
