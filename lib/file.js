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

let walkLastUpdatedAt = 0  // 全局变量，用于跟踪上次进度条更新的时间，避免过于频繁的更新

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
    const entryFilter = options.entryFilter || Boolean  // 默认过滤器，接受所有条目
    log.info(logTag, root, "options:", options)

    const initMs = Date.now()  // 记录总开始时间
    let startMs = Date.now()   // 记录阶段开始时间

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
                root,                                    // 根目录路径
                name: path.basename(fpath),              // 文件名
                path: fpath,                             // 完整路径
                stats: st,                               // fs.Stats对象
                ctime: st?.ctime || 0,                  // 创建时间
                mtime: st?.mtime || 0,                  // 修改时间
                size: st?.size || 0,                    // 文件大小
                isDir: st?.isDirectory() || false,      // 是否为目录
                isFile: st?.isFile() || false,          // 是否为文件
                index,                                  // 在数组中的索引
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
            console.error(`Error reading directory ${dir}: ${error.message}`)
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
            console.error(`Error reading directory ${currentDir}: ${error.message}`)
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
                console.error(`Error reading directory ${currentDir}: ${error.message}`)
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
    } catch (err) {
        throw new Error("The supplied path is not accessible")
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
                console.error(`Error reading directory ${currentPath}: ${error.message}`)
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
