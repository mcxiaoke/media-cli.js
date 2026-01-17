/*
 * Project: mediac
 * Created: 2024-04-17 07:42:26
 * Modified: 2024-04-17 07:42:26
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import fs from "fs/promises"
import inquirer from "inquirer"
import path from "path"

// 异步函数：遍历目录并合并具有相同名称的多层目录
async function mergeDuplicateDirs(rootDir) {
    const changes = []

    // 异步函数：递归遍历目录并记录需要改动的路径对比
    async function traverseDir(dirPath) {
        const items = await fs.readdir(dirPath)

        for (const item of items) {
            const itemPath = path.join(dirPath, item)
            const stats = await fs.stat(itemPath)

            if (stats.isDirectory()) {
                await traverseDir(itemPath)
            } else {
                await checkAndRecordChange(itemPath)
            }
        }
    }

    // 异步函数：检查并记录需要改动的路径对比
    async function checkAndRecordChange(filePath) {
        const fileName = path.basename(filePath)
        const newFilePath = path.join(rootDir, fileName)

        if (filePath !== newFilePath) {
            changes.push({ src: filePath, dst: newFilePath })
        }
    }

    // 异步函数：显示改动的路径对比，并提示用户确认
    async function displayChangesAndConfirm() {
        console.log("Changes to be made:")
        changes.forEach((change) => {
            console.log(`SRC ${change.src}`)
            console.log(`DST ${change.dst}`)
        })

        const answer = await confirmAction()
        return answer
    }

    // 异步函数：用户确认操作
    async function confirmAction() {
        const answer = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirm",
                message: "Confirm?",
            },
        ])
        return answer.confirm
    }

    // 异步函数：执行操作，移动文件到新位置，并保留一个目录
    async function executeChanges() {
        const distinctDirs = new Set()
        for (const change of changes) {
            distinctDirs.add(path.dirname(change.dst))
        }

        for (const dir of distinctDirs) {
            const files = await fs.readdir(dir)
            for (const file of files) {
                const filePath = path.join(dir, file)
                await moveFile(filePath, rootDir)
            }
        }
    }

    // 异步函数：移动文件到目标目录
    async function moveFile(filePath, rootDir) {
        const fileName = path.basename(filePath)
        const newFilePath = path.join(rootDir, fileName)
        console.log(`Moving file from ${filePath} to ${newFilePath}`)
        await fs.rename(filePath, newFilePath)
    }

    // 开始递归遍历目录并记录需要改动的路径对比
    await traverseDir(rootDir)

    // 显示改动的路径对比，并提示用户确认
    const confirmed = await displayChangesAndConfirm()

    // 如果用户确认操作，则执行操作，移动文件到新位置，并保留一个目录
    if (confirmed) {
        await executeChanges()
    } else {
        console.log("Operation canceled.")
    }
}

export default mergeDuplicateDirs
