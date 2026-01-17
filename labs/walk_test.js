/*
 * Project: mediac
 * Created: 2024-04-28 19:43:00
 * Modified: 2024-04-28 19:43:00
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { readdir, stat } from "fs/promises"
import path from "path"

/**
 * 遍历指定目录下的所有文件和目录
 * @param {string} dirPath - 要遍历的目录路径
 * @param {object} options - 可选参数对象
 * @param {boolean} options.includeFiles - 是否包含文件，默认为 true
 * @param {boolean} options.includeDirs - 是否包含目录，默认为 true
 * @param {function} options.filterFn - 文件和目录过滤函数，默认为 null
 * @param {boolean} options.withStats - 是否返回文件/目录的 stat 信息，默认为 false
 * @param {boolean} options.ignoreErrors - 是否忽略错误，默认为 false
 * @param {number} options.depth - 遍历的最大深度，默认为 Infinity
 * @param {number} options.concurrency - 并发操作的数量，默认为 10
 * @param {number} currentDepth - 当前遍历深度
 * @returns {Promise<Array>} - 文件和目录列表
 */
async function listFilesAndDirs(dirPath, options = {}, currentDepth = 0) {
    const {
        includeFiles = true,
        includeDirs = true,
        filterFn = null,
        withStats = false,
        ignoreErrors = false,
        depth = Infinity,
        concurrency = 10,
    } = options

    let items = []

    try {
        const dirItems = await readdir(dirPath)

        const promises = dirItems.map(async (item) => {
            const itemPath = path.join(dirPath, item)
            const itemStats = await stat(itemPath)

            if (itemStats.isDirectory() && includeDirs && currentDepth < depth) {
                if (!filterFn || filterFn(itemPath, itemStats)) {
                    items.push(
                        withStats ? { name: item, path: itemPath, stats: itemStats } : itemPath,
                    )
                    if (!withStats && includeFiles) {
                        const subItems = await listFilesAndDirs(
                            itemPath,
                            { ...options, includeDirs: false, depth, concurrency },
                            currentDepth + 1,
                        )
                        items = items.concat(subItems)
                    }
                }
            } else if (itemStats.isFile() && includeFiles) {
                if (!filterFn || filterFn(itemPath, itemStats)) {
                    items.push(
                        withStats ? { name: item, path: itemPath, stats: itemStats } : itemPath,
                    )
                }
            }
        })

        await Promise.all(promises)
    } catch (error) {
        if (!ignoreErrors) {
            throw error
        }
    }

    return items
}

// 示例用法：
const directoryPath = process.argv[2]

;(async () => {
    try {
        const fileList = await listFilesAndDirs(directoryPath, {
            includeFiles: true,
            includeDirs: true,
            filterFn: (itemPath, stats) => {
                // 过滤掉以 . 开头的隐藏文件/目录
                return !path.basename(itemPath).startsWith(".")
            },
            withStats: true,
            ignoreErrors: true,
            concurrency: 5, // 设置并发操作数量为 5
        })

        fileList.forEach((item) => console.log(item.path))
    } catch (error) {
        console.error("Error:", error)
    }
})()
