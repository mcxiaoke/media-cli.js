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

let walkLastUpdatedAt = 0
// 异步函数 walk(root, options) 从指定的根目录开始遍历目录，返回一个包含遍历结果的对象数组
export async function walk(root, options = {}) {
    const logTag = "walk"
    const entryFilter = options.entryFilter || Boolean
    log.info(logTag, root, "options:", options)
    const initMs = Date.now()
    let startMs = Date.now()
    let files = await walkUseFdir(root, options.withDirs, options.withFiles, options.maxDepth)
    log.info(logTag, `Total ${files.length} entries found in ${humanTime(startMs)} `)
    const needBar = files.length > 9999 && !log.isVerbose()
    const bar1 = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic)
    needBar && bar1.start(files.length, 0)
    const entryMapper = async (fpath, index) => {
        try {
            const st = options.needStats ? await fs.stat(fpath) : undefined
            const entry = {
                root,
                name: path.basename(fpath),
                path: fpath,
                stats: st,
                ctime: st?.ctime || 0,
                mtime: st?.mtime || 0,
                size: st?.size || 0,
                isDir: st?.isDirectory() || false,
                isFile: st?.isFile() || false,
                index,
            }
            log.debug(logTag, entry.index, pathShort(entry.path), st)
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
    startMs = Date.now()
    files = await pMap(files, entryMapper, { concurrency: cpus().length * 4 })
    needBar && bar1.update(files.length)
    needBar && bar1.stop()
    log.debug(logTag, `${files.length} files mapped in ${humanTime(startMs)}`)
    startMs = Date.now()
    files = files.filter((entry) => entry && entryFilter(entry))
    log.info(logTag, `total ${files.length} files after filter in ${humanTime(initMs)}.`)
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
