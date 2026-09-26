import fs from "fs-extra"
import path from "path"
import * as core from "../../lib/core.js"
import * as mf from "../../lib/file.js"
import * as helper from "../../lib/helper.js"
import { applyFileNameRules } from "../../lib/rename.js"

/**
 * 归一化后的输入条目（扫描/清单解析的产物）。
 * @typedef {object} ScanEntry
 * @property {string} root 该条目所属的扫描根
 * @property {string} path 绝对路径
 * @property {string} name 文件名
 * @property {number} size 字节大小
 */

/**
 * 收集桌面端/未来共享 Engine 使用的媒体文件条目。
 *
 * 基础收集保持无副作用；filterAndSliceEntries 统一 CLI/Desktop 的媒体类型、
 * 文件名规则和 start/count 语义。
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

async function filterAndSliceEntries(
    entries,
    argv,
    presetType,
    isAudioExtract,
    applyRules = applyFileNameRules,
) {
    let filtered = core.uniqueByFields(entries, "path")
    if (presetType === "video" || isAudioExtract) {
        filtered = filtered.filter((entry) => helper.isVideoFile(entry.name))
    } else if (presetType === "audio") {
        filtered = filtered.filter((entry) => helper.isAudioFile(entry.name))
    }

    filtered = await applyRules(filtered, argv)
    const start = Number.isInteger(Number(argv.start)) ? Number(argv.start) : 0
    const count = Number.isInteger(Number(argv.count)) ? Number(argv.count) : 99999
    return filtered.slice(start, start + count)
}

/**
 * Scan desktop (Electron) inputs with the same preset type, filename and slice
 * semantics as the CLI pipeline. The caller owns preset construction and task
 * preparation; this function only produces normalized ScanEntry objects.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.inputs] 输入文件/目录路径列表
 * @param {object} [opts.argv] 规范化后的选项（start/count/include/exclude/filelist 等）
 * @param {string} [opts.presetType] 预设类型（video / audio）
 * @param {boolean} [opts.isAudioExtract] 是否为音频提取预设（决定是否按视频文件过滤）
 * @param {object} [opts.deps] 可注入依赖（测试用）
 * @returns {Promise<ScanEntry[]>} 归一化后的输入条目
 */
export async function scanDesktopInputFiles({
    inputs = [],
    argv = {},
    presetType = "video",
    isAudioExtract = false,
    deps = {},
} = {}) {
    const fsApi = deps.fs || fs
    const parseFilelist = deps.parseFilelist || mf.parseFilelist
    const applyRules = deps.applyFileNameRules || applyFileNameRules
    let entries

    if (typeof argv.filelist === "string" && argv.filelist.length > 0) {
        const listPath = path.resolve(argv.filelist)
        if (!(await fsApi.pathExists(listPath))) {
            const error = new Error(`Filelist not found: ${listPath}`)
            error.code = "INVALID_ARGUMENT"
            throw error
        }
        entries = await parseFilelist(listPath, path.dirname(listPath))
    } else {
        entries = await collectInputFiles(inputs, deps)
    }

    return filterAndSliceEntries(entries, argv, presetType, isAudioExtract, applyRules)
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
    const fileEntries = await collectCliInputEntries(argv, root, walkOpts, deps)
    return filterAndSliceEntries(fileEntries, argv, presetType, isAudioExtract, applyRules)
}
