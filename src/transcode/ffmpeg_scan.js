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
 * 媒体类型过滤、文件名规则与 start/count 切片。
 *
 * 基础收集保持无副作用；调用方（scanFFmpegInputs）负责遍历与清单解析。
 *
 * @param {object[]} entries 扫描得到的原始条目
 * @param {object} argv 规范化后的选项（start/count/include/exclude/filelist 等）
 * @param {string} presetType 预设类型（video / audio）
 * @param {boolean} isAudioExtract 是否为音频提取预设（决定是否按视频文件过滤）
 * @param {Function} [applyRules] 文件名规则实现（测试注入）
 * @returns {Promise<object[]>}
 */
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
 * Collect CLI inputs with the same filelist/root/extra-directory semantics as
 * the legacy command adapter.
 */
export async function collectCliInputEntries(
    argv = {},
    root,
    walkOpts = {},
    deps = {},
    inputs = null,
) {
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

    const rawInputs =
        inputs && inputs.length > 0
            ? Array.isArray(inputs)
                ? inputs
                : [inputs]
            : [
                  root,
                  ...(Array.isArray(argv.directories)
                      ? argv.directories
                      : argv.directories
                        ? [argv.directories]
                        : []),
              ].filter(Boolean)

    const resolvedRoots = [...new Set(rawInputs.map((item) => path.resolve(item)))]
    let fileEntries = []
    const seenPaths = new Set()

    for (const inputPath of resolvedRoots) {
        if (!(await fsApi.pathExists(inputPath))) continue
        const stat = await fsApi.stat(inputPath)
        if (stat.isFile()) {
            const filter = walkOpts.entryFilter || Boolean
            const entry = {
                root: path.dirname(inputPath),
                name: path.basename(inputPath),
                path: inputPath,
                stats: stat,
                ctime: stat.ctime || 0,
                mtime: stat.mtime || 0,
                size: stat.size || 0,
                isDir: false,
                isFile: true,
                index: 0,
            }
            const normPath = path.normalize(inputPath)
            if (!seenPaths.has(normPath) && filter(entry)) {
                seenPaths.add(normPath)
                fileEntries.push(entry)
            }
        } else if (stat.isDirectory()) {
            const dirFiles = await walk(inputPath, walkOpts)
            let addedCount = 0
            for (const file of dirFiles) {
                const normPath = path.normalize(file.path)
                if (!seenPaths.has(normPath)) {
                    seenPaths.add(normPath)
                    fileEntries.push(file)
                    addedCount++
                }
            }
            if (addedCount > 0 && inputPath !== root) {
                onLog({ level: "info", message: `Added ${addedCount} files from ${inputPath}` })
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
    inputs,
    argv = {},
    root,
    walkOpts = {},
    presetType = "video",
    isAudioExtract = false,
    deps = {},
} = {}) {
    const applyRules = deps.applyFileNameRules || applyFileNameRules
    const fileEntries = await collectCliInputEntries(argv, root, walkOpts, deps, inputs)
    return filterAndSliceEntries(fileEntries, argv, presetType, isAudioExtract, applyRules)
}
