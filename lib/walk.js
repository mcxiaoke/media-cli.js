/*
 * File: walk.js
 * Created: 2024-03-29 15:34:51 +0800
 * Modified: 2024-04-09 22:13:41 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from "fs/promises"
import path from "path"

/**
 * 递归遍历目录，查找符合条件的文件
 *
 * @param {string} root - 根目录
 * @param {Function} predicate - 断言函数，接收文件名，返回boolean
 * @returns {Promise<Array>} 匹配的文件列表，包含name、path、stat属性
 */
async function walk(root, predicate) {
    let files = await fs.readdir(root)
    files = await Promise.all(
        files.map(async (fileName) => {
            const filePath = path.join(root, fileName)
            const stats = await fs.stat(filePath)
            if (stats.isDirectory()) {
                return this.walk(filePath, predicate)
            } else if (stats.isFile() && predicate(fileName)) {
                return {
                    name: fileName,
                    path: filePath,
                    stat: stats,
                }
            }
        }),
    )

    // Filter out undefined entries before concatenating
    return files.filter(Boolean).reduce((all, folderContents) => all.concat(folderContents), [])
}

/**
 * 异步生成器版本的目录遍历
 * 使用生成器函数递归遍历目录
 *
 * @param {string} dir - 目录路径
 * @returns {AsyncGenerator<string>} 异步生成器，产生每个文件路径
 */
async function* walk2(dir) {
    for await (const d of await fs.promises.opendir(dir)) {
        const entry = path.join(dir, d.name)
        if (d.isDirectory()) yield* await walk(entry)
        else if (d.isFile()) yield entry
    }
}
