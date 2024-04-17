/*
 * Project: mediac
 * Created: 2024-04-17 07:43:06
 * Modified: 2024-04-17 07:43:06
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import fs from 'fs/promises'
import inquirer from 'inquirer'
import path from 'path'

function processPath(inputPath) {
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
    if (inputPath.startsWith('\\\\')) {
        newPathParts = ['\\', ...newPathParts.slice(1)]
    }

    const newPath = newPathParts.join(path.sep)
    return newPath
}

function processPath2(inputPath) {
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
    if (absoluteDirname.startsWith('\\\\')) {
        newPathParts = ['\\', ...newPathParts.slice(1)]
    }

    const newDirPath = newPathParts.join(path.sep)
    const newPath = path.join(newDirPath, basename) // 将处理后的目录部分和原始文件名拼接成新路径
    return newPath
}


async function processDirectory(directoryPath) {
    try {
        // 读取目录中的文件和子目录
        const items = await fs.readdir(directoryPath)

        // 存储改动前后的路径对
        const processedPaths = []

        // 遍历每个项目
        for (const item of items) {
            const itemPath = path.join(directoryPath, item)

            // 获取项目的状态
            const stats = await fs.stat(itemPath)

            if (stats.isDirectory()) {
                // 如果是目录，则递归处理
                const subPaths = await processDirectory(itemPath)
                processedPaths.push(...subPaths)
            } else {
                // 处理文件路径
                const processedPathBefore = itemPath
                const processedPathAfter = processPath2(itemPath)
                if (processedPathAfter !== processedPathBefore) {
                    processedPaths.push({ src: processedPathBefore, dst: processedPathAfter })
                }
            }
        }

        return processedPaths
    } catch (error) {
        console.error(`Error processing directory ${directoryPath}:`, error)
        return []
    }
}


(async () => {
    const processedPaths = await processDirectory(process.argv[2])

    console.log('Changes in the directory:')
    for (const { src, dst } of processedPaths) {
        console.log(`SRC: ${src}`)
        console.log(`DST: ${dst}`)
    }
})()