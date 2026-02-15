/*
 * File: file.js
 * Created: 2021-07-23 15:52:16 +0800
 * Modified: 2024-04-09 22:13:41 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import * as cliProgress from "cli-progress"
import { fdir } from "fdir"
import fs from "fs-extra"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import { comparePathSmart, compareSmart } from "./core.js"
import * as log from "./debug.js"
import { handleError } from "./errors.js"
import { humanTime, isMediaFile, pathExt, pathShort } from "./helper.js"

export const FILE_SIZE_1K = 1024
export const FILE_SIZE_1M = FILE_SIZE_1K * 1024
export const FILE_SIZE_1G = FILE_SIZE_1M * 1024
export const FILE_SIZE_1T = FILE_SIZE_1G * 1024

class FileEntry {
    constructor(root, fpath, index, stats) {
        const parts = path.parse(fpath)
        const st = stats
        this.root = root
        this.path = fpath
        this.dir = parts.dir
        this.name = parts.base
        this.ext = parts.ext
        this.ctime = st.ctime || 0
        this.mtime = st.mtime || 0
        this.size = st.size || 0
        this.isDir = st.isDirectory() || false
        this.isFile = st.isFile() || false
        this.index = index
    }
}

async function walkUseFdir(root, withDirs = false, withFiles = false, maxDepth = 99) {
    const fd = new fdir()
    if (withDirs) {
        if (withFiles) {
            fd.withDirs()
        } else {
            fd.onlyDirs()
        }
    }
    fd.withMaxDepth(maxDepth).withErrors()
    const crawler = fd.withErrors().withFullPaths().crawl(root)
    return (await crawler.withPromise()).sort(compareSmart)
}

let walkLastUpdatedAt = 0 // 全局变量，用于跟踪上次进度条更新的时间，避免过于频繁的更新

/**
 * 异步遍历指定根目录下的文件和目录
 * 高性能的文件系统遍历函数，支持过滤、统计和进度显示
 *
 * @param {string} root - 要遍历的根目录路径
 * @param {Object} options - 遍历选项
 * @param {Function} options.entryFilter - 条目过滤器函数，返回true保留该条目
 * @param {boolean} options.withDirs - 是否包含目录
 * @param {boolean} options.withFiles - 是否包含文件
 * @param {number} options.maxDepth - 最大遍历深度
 * @param {boolean} options.needStats - 是否需要文件统计信息（大小、时间等）
 * @returns {Promise<Array>} 包含文件条目的数组
 */
export async function walk(root, options = {}) {
    const logTag = "walk"
    const entryFilter = options.entryFilter || Boolean // 默认过滤器，接受所有条目
    log.info(logTag, root, "options:", options)

    const initMs = Date.now() // 记录总开始时间
    let startMs = Date.now() // 记录阶段开始时间

    // 第一步：使用fdir快速获取所有文件和目录路径
    let files = await walkUseFdir(root, options.withDirs, options.withFiles, options.maxDepth)
    log.info(logTag, `Total ${files.length} entries found in ${humanTime(startMs)} `)

    // 根据文件数量和日志级别决定是否显示进度条
    const needBar = files.length > 9999 && !log.isVerbose()
    const bar1 = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic)
    needBar && bar1.start(files.length, 0)

    // 定义条目映射函数，将路径转换为包含详细信息的对象
    const entryMapper = async (fpath, index) => {
        try {
            // 如果需要统计信息，获取文件/目录的stat对象
            const st = options.needStats ? await fs.stat(fpath) : undefined

            // 构建文件条目对象
            const entry = {
                root, // 根目录路径
                name: path.basename(fpath), // 文件名
                path: fpath, // 完整路径
                stats: st, // fs.Stats对象
                ctime: st?.ctime || 0, // 创建时间
                mtime: st?.mtime || 0, // 修改时间
                size: st?.size || 0, // 文件大小
                isDir: st?.isDirectory() || false, // 是否为目录
                isFile: st?.isFile() || false, // 是否为文件
                index, // 在数组中的索引
            }

            log.debug(logTag, entry.index, pathShort(entry.path), st)

            // 控制进度条更新频率，每2秒最多更新一次
            const timeNow = Date.now()
            if (timeNow - walkLastUpdatedAt > 2 * 1000) {
                needBar && bar1.update(index)
                walkLastUpdatedAt = timeNow
            }

            return entry
        } catch (error) {
            log.error(logTag, error, pathShort(fpath))
            throw error
        }
    }

    // 并发处理所有文件路径，转换为条目对象
    startMs = Date.now()
    files = await pMap(files, entryMapper, { concurrency: cpus().length * 4 })
    needBar && bar1.update(files.length)
    needBar && bar1.stop()
    log.debug(logTag, `${files.length} files mapped in ${humanTime(startMs)}`)

    // 最后阶段：应用过滤器筛选条目
    startMs = Date.now()
    files = files.filter((entry) => entry && entryFilter(entry))
    log.info(logTag, `total ${files.length} files after filter in ${humanTime(initMs)}.`) // 总耗时

    return files
}

export async function getDirectorySizeR(directory) {
    let totalSize = 0

    async function getSizeRecursive(dir) {
        try {
            const files = await fs.readdir(dir)

            for (const file of files) {
                const filePath = path.join(dir, file)
                const stats = await fs.stat(filePath)

                if (stats.isDirectory()) {
                    await getSizeRecursive(filePath) // 递归处理子目录
                } else {
                    totalSize += stats.size // 累加文件大小
                }
            }
        } catch (error) {
            log.error(`Error reading directory ${dir}: ${error.message}`)
            await handleError(error, { operation: "getDirectorySizeR", dir })
        }
    }

    await getSizeRecursive(directory)
    return totalSize
}

export async function getDirectorySizeQ(directory) {
    let totalSize = 0
    const queue = [directory]

    while (queue.length > 0) {
        const currentDir = queue.shift()

        try {
            const files = await fs.readdir(currentDir)

            for (const file of files) {
                const filePath = path.join(currentDir, file)
                const stats = await fs.stat(filePath)

                if (stats.isDirectory()) {
                    queue.push(filePath) // 将子目录加入队列
                } else {
                    totalSize += stats.size // 累加文件大小
                }
            }
        } catch (error) {
            log.error(`Error reading directory ${currentDir}: ${error.message}`)
            await handleError(error, { operation: "getDirectorySizeQ", dir: currentDir })
        }
    }

    return totalSize
}

export async function getDirectorySize(directory, concurrency = 8) {
    let totalSize = 0
    const queue = [directory]

    async function processQueue() {
        while (queue.length > 0) {
            const currentDir = queue.shift()
            try {
                const files = await fs.readdir(currentDir)
                const fileStats = await Promise.all(
                    files.map((file) => fs.stat(path.join(currentDir, file))),
                )
                for (const stats of fileStats) {
                    if (stats.isDirectory()) {
                        queue.push(path.join(currentDir, stats.name)) // 将子目录加入队列
                    } else {
                        totalSize += stats.size // 累加文件大小
                    }
                }
            } catch (error) {
                log.error(`Error reading directory ${currentDir}: ${error.message}`)
                await handleError(error, { operation: "getDirectorySize", dir: currentDir })
            }
        }
    }

    const workers = Array.from({ length: concurrency }, processQueue)
    await Promise.all(workers)

    return totalSize
}

async function getFolderSize(folderPath, concurrencyLimit = 10) {
    try {
        await fs.access(folderPath)
    } catch (error) {
        throw new Error(`The supplied path is not accessible: ${error.message}`, {
            cause: error, // 保留原始错误的完整上下文
        })
    }

    let totalSize = 0
    const queue = [folderPath]

    async function processQueue() {
        while (queue.length > 0) {
            const currentPath = queue.shift()
            try {
                const files = await fs.readdir(currentPath)
                const fileStats = await Promise.all(
                    files.map(async (file) => {
                        const filePath = path.join(currentPath, file)
                        return fs.lstat(filePath)
                    }),
                )

                await Promise.all(
                    fileStats.map(async (stats) => {
                        if (stats.isDirectory()) {
                            queue.push(path.join(currentPath, stats.name))
                        } else {
                            totalSize += stats.size
                        }
                    }),
                )
            } catch (error) {
                log.error(`Error reading directory ${currentPath}: ${error.message}`)
                await handleError(error, { operation: "getFolderSize", dir: currentPath })
            }
        }
    }

    const workers = Array.from({ length: concurrencyLimit }, processQueue)
    await Promise.all(workers)

    return totalSize
}

export async function getDirectoryFileCount(directoryPath) {
    try {
        let fileCount = 0

        async function traverseDirectory(currentPath) {
            const files = await fs.readdir(currentPath)

            for (const file of files) {
                const filePath = path.join(currentPath, file)
                const stats = await fs.stat(filePath)

                if (stats.isFile()) {
                    fileCount++
                } else if (stats.isDirectory()) {
                    await traverseDirectory(filePath)
                }
            }
        }

        await traverseDirectory(directoryPath)
        return fileCount
    } catch (error) {
        log.warn("getDirectoryFileCount:", error)
        return -1 // 返回 -1 表示出现错误
    }
}

/**
 * 从文件路径向上查找，直到找到只有一个子目录的目录
 * @param {string} filePath - 文件路径（可以是相对路径或绝对路径）
 * @returns {Promise<string>} - 找到的目录路径（绝对路径）
 */
export async function findSingleParent(filePath) {
    // 将相对路径转换为绝对路径（相对于当前工作目录）
    const absolutePath = path.resolve(filePath)
    let currentDir = path.dirname(absolutePath)

    while (true) {
        const parentDir = path.dirname(currentDir)

        // 遇到根目录时停止（Windows: F:\, Linux: / 或 /mnt/usb）
        if (parentDir === currentDir) {
            return currentDir
        }

        try {
            const entries = await fs.readdir(parentDir, { withFileTypes: true })
            const subDirectories = entries.filter((entry) => entry.isDirectory())

            // 如果父目录只有一个子目录，则返回该父目录
            if (subDirectories.length === 1) {
                return parentDir
            }

            // 继续向上查找
            currentDir = parentDir
        } catch (error) {
            log.error(`读取目录失败: ${parentDir}`, error)
            return currentDir // 出错时返回当前目录
        }
    }
}

/**
 *  从多个文件路径中找到它们的共同根目录
 * @param {string[]} filePaths - 文件路径数组
 * @returns {string|null} - 共同根目录路径，如果没有共同根目录则返回null
 */
export function findCommonRoot(filePaths) {
    if (filePaths.length === 0) return null

    // 将每个文件路径转换为目录路径，并规范化
    const dirPaths = filePaths.map((filePath) => path.dirname(filePath))

    // 将每个目录路径拆分为组成部分
    const pathComponents = dirPaths.map((dir) => {
        // 规范化路径（处理./、../和多余的分隔符）
        const normalized = path.normalize(dir)
        // 拆分为路径组成部分
        return normalized.split(path.sep)
    })

    // 使用第一个路径作为基准
    const baseComponents = pathComponents[0]
    let commonLength = baseComponents.length

    // 与其他路径比较，找出共同部分
    for (let i = 1; i < pathComponents.length; i++) {
        const currentComponents = pathComponents[i]
        const maxLength = Math.min(commonLength, currentComponents.length)

        // 逐个组件比较
        let j = 0
        while (j < maxLength && baseComponents[j] === currentComponents[j]) {
            j++
        }

        commonLength = j
        if (commonLength === 0) break // 无共同路径
    }

    // 如果没有共同路径
    if (commonLength === 0) return null

    // 获取共同路径组件
    const commonComponents = baseComponents.slice(0, commonLength)

    // 处理根目录情况（Linux的/或Windows的C:\）
    if (commonComponents.length === 0) {
        // 返回根目录
        return path.sep
    }

    // 重新构建路径
    const result = path.join(...commonComponents)

    // 在Windows上处理盘符根目录（如C: -> C:\）
    if (
        process.platform === "win32" &&
        commonComponents.length === 1 &&
        commonComponents[0].match(/^[A-Za-z]:$/)
    ) {
        return commonComponents[0] + path.sep
    }

    return result
}
