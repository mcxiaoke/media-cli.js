/*
 * Project: mediac
 * Created: 2024-04-17 09:31:27
 * Modified: 2024-04-17 09:31:27
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { promises as fsPromises } from "fs"
import path from "path"

/**
 * 合并路径中相邻的相同部分
 * 去除重复的路径段，处理UNC路径
 *
 * @param {string} inputPath - 输入路径
 * @returns {string} 合并后的路径
 */
function mergePath(inputPath) {
    const parts = inputPath.split(path.sep)
    let newPathParts = []

    // 逐级检查路径
    for (const part of parts) {
        // 如果当前部分与前一个部分不同，则添加到新路径部分中
        if (newPathParts.length === 0 || newPathParts[newPathParts.length - 1] !== part) {
            newPathParts.push(part)
        }
    }

    // 对于 UNC 路径，将前两个斜杠加回去
    if (inputPath.startsWith("\\\\")) {
        newPathParts = ["\\", ...newPathParts.slice(1)]
    }

    const newPath = newPathParts.join(path.sep)
    return newPath
}

/**
 * 合并路径并检查重名文件
 * 如果目标文件已存在，则在文件名后添加数字后缀
 *
 * @param {string} inputPath - 输入路径
 * @returns {Promise<string>} 合并后的路径（处理重名）
 */
async function mergePathChecked(inputPath) {
    const dirname = path.dirname(inputPath) // 获取路径中的目录部分
    const basename = path.basename(inputPath) // 获取路径中的文件名部分

    const absoluteDirname = path.resolve(dirname) // 将目录部分转换为绝对路径

    const parts = absoluteDirname.split(path.sep)
    let newPathParts = []

    // 逐级检查路径
    for (const part of parts) {
        // 如果当前部分与前一个部分不同，则添加到新路径部分中
        if (newPathParts.length === 0 || newPathParts[newPathParts.length - 1] !== part) {
            newPathParts.push(part)
        }
    }

    // 对于 UNC 路径，将前两个斜杠加回去
    if (absoluteDirname.startsWith("\\\\")) {
        newPathParts = ["\\", ...newPathParts.slice(1)]
    }

    const newDirPath = newPathParts.join(path.sep)

    // 检查新路径中是否存在与文件同名的目录
    let count = 0
    let newPath = path.join(newDirPath, basename)

    try {
        await fsPromises.access(newPath)
        while (true) {
            count++
            newPath = path.join(
                newDirPath,
                `${path.basename(basename, path.extname(basename))}_${count}${path.extname(basename)}`,
            )
            try {
                await fsPromises.access(newPath)
            } catch (error) {
                break
            }
        }
    } catch (error) {
        // 文件不存在，可以使用原始路径
    }

    return newPath
}

export { mergePath, mergePathChecked }
