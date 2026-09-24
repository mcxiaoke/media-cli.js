import fs from "fs-extra"
import path from "path"
import * as mf from "./file.js"
import * as helper from "./helper.js"

/**
 * 收集 WebUI/未来共享 Engine 使用的媒体文件条目。
 *
 * 当前阶段只抽取无副作用的输入收集，不改变 CLI 的 filelist、过滤和切片
 * 语义；CLI 专用规则仍由后续 ffmpeg_engine 统一迁移。
 *
 * @param {string[]} inputs
 * @param {object} deps
 * @returns {Promise<object[]>}
 */
export async function collectInputFiles(inputs, deps = {}) {
    const fsApi = deps.fs || fs
    const walk = deps.walk || mf.walk
    const isMediaFile = deps.isMediaFile || helper.isMediaFile
    const fileList = []

    for (const inputPath of inputs) {
        if (!inputPath || !(await fsApi.pathExists(inputPath))) continue
        const stat = await fsApi.stat(inputPath)
        if (stat.isFile()) {
            if (isMediaFile(inputPath)) {
                fileList.push({
                    root: path.dirname(inputPath),
                    path: inputPath,
                    name: path.basename(inputPath),
                    size: stat.size,
                })
            }
        } else if (stat.isDirectory()) {
            const files = await walk(inputPath, {
                withFiles: true,
                needStats: true,
                entryFilter: (entry) => entry.isFile && isMediaFile(entry.name),
            })
            for (const file of files) {
                fileList.push({
                    root: file.root || inputPath,
                    path: file.path,
                    name: file.name,
                    size: file.size,
                })
            }
        }
    }

    const unique = []
    const seen = new Set()
    for (const item of fileList) {
        const key = path.normalize(item.path)
        if (!seen.has(key)) {
            seen.add(key)
            unique.push(item)
        }
    }
    return unique
}
