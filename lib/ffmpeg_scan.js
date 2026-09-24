import fs from "fs-extra"
import path from "path"
import * as core from "./core.js"
import * as mf from "./file.js"
import * as helper from "./helper.js"
import { applyFileNameRules } from "./rename.js"

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

/**
 * Collect CLI inputs with the same filelist/root/extra-directory semantics as
 * the legacy command adapter.
 */
export async function collectCliInputEntries(argv = {}, root, walkOpts = {}, deps = {}) {
    const fsApi = deps.fs || fs
    const walk = deps.walk || mf.walk
    const parseFilelist = deps.parseFilelist || mf.parseFilelist
    const onLog = deps.onLog || (() => {})

    if (typeof argv.filelist === "string" && argv.filelist.length > 0) {
        const listPath = path.resolve(argv.filelist)
        if (!(await fsApi.pathExists(listPath))) {
            const error = new Error(`Filelist not found: ${listPath}`)
            error.code = "INVALID_ARGUMENT"
            throw error
        }
        return parseFilelist(listPath, root)
    }

    const rootStat = await fsApi.stat(root)
    let fileEntries = []
    if (rootStat.isFile()) {
        const filter = walkOpts.entryFilter || Boolean
        const entry = {
            root: path.dirname(root),
            name: path.basename(root),
            path: root,
            stats: rootStat,
            ctime: rootStat.ctime || 0,
            mtime: rootStat.mtime || 0,
            size: rootStat.size || 0,
            isDir: false,
            isFile: true,
            index: 0,
        }
        if (filter(entry)) fileEntries = [entry]
    } else {
        fileEntries = await walk(root, walkOpts)
    }

    if (argv.directories?.length > 0) {
        const extraDirs = new Set(argv.directories.map((dir) => path.resolve(dir)))
        for (const dirPath of extraDirs) {
            const stat = await fsApi.stat(dirPath)
            if (!stat.isDirectory()) continue
            const dirFiles = await walk(dirPath, walkOpts)
            if (dirFiles.length > 0) {
                onLog({ level: "info", message: `Added ${dirFiles.length} files from ${dirPath}` })
                fileEntries = fileEntries.concat(dirFiles)
            }
        }
    }
    return fileEntries
}

/**
 * Run the complete FFmpeg input scan/filter/slice pipeline.
 * The caller owns preset creation and task construction.
 */
export async function scanFFmpegInputs({
    argv = {},
    root,
    walkOpts = {},
    presetType = "video",
    isAudioExtract = false,
    deps = {},
} = {}) {
    const applyRules = deps.applyFileNameRules || applyFileNameRules
    let fileEntries = await collectCliInputEntries(argv, root, walkOpts, deps)
    fileEntries = core.uniqueByFields(fileEntries, "path")

    if (presetType === "video" || isAudioExtract) {
        fileEntries = fileEntries.filter((entry) => helper.isVideoFile(entry.name))
    } else if (presetType === "audio") {
        fileEntries = fileEntries.filter((entry) => helper.isAudioFile(entry.name))
    }

    fileEntries = await applyRules(fileEntries, argv)
    const start = Number.isInteger(argv.start) ? argv.start : 0
    const count = Number.isInteger(argv.count) ? argv.count : 99999
    return fileEntries.slice(start, start + count)
}
