/*
 * Project: mediac
 * Created: 2024-04-09 21:08:57
 * Modified: 2024-04-09 21:08:57
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { exec } from "child_process"
import dayjs from "dayjs"
import { readFile, readdir, stat, writeFile } from "fs/promises"
import { extname, join, relative } from "path"

async function getGitAddedDate(directory) {
    const supportedExtensions = [".js", ".ts", ".css", ".html", ".json", ".md"]

    try {
        // 获取当前目录下的所有文件
        const files = await getFiles(directory, supportedExtensions)

        // 获取每个文件的第一次添加时间，并修改文件头部注释
        for (const file of files) {
            try {
                const gitLog = await execCommand(
                    `git log --pretty=format:%aD --date=iso --diff-filter=A -- "${file}"`,
                    directory,
                )
                if (gitLog) {
                    const addedIsoDate = gitLog.split("\n")[0]
                    const addedFormattedDate = dayjs(addedIsoDate).format("YYYY-MM-DD HH:mm:ss ZZ")

                    const modifiedStats = await stat(file)
                    const modifiedDate = modifiedStats.mtime.toISOString()
                    const modifiedFormattedDate =
                        dayjs(modifiedDate).format("YYYY-MM-DD HH:mm:ss ZZ")

                    console.log(`Processing file: ${relative(directory, file)}`)
                    const updated = await updateFileComment(
                        file,
                        addedFormattedDate,
                        modifiedFormattedDate,
                    )
                    if (updated) {
                        console.log(`File updated: ${relative(directory, file)}`)
                    } else {
                        console.log(`File ignored: ${relative(directory, file)}`)
                    }
                }
            } catch (error) {
                console.error(`Error processing file: ${file}`)
                console.error(error)
            }
        }
    } catch (error) {
        console.error("Error retrieving files:")
        console.error(error)
    }
}

// 获取当前目录下的所有文件
async function getFiles(dir, supportedExtensions) {
    let files = []
    const dirContent = await readdir(dir)
    for (const item of dirContent) {
        const itemPath = join(dir, item)
        const stats = await stat(itemPath)
        if (stats.isDirectory() && !item.startsWith(".") && item !== "node_modules") {
            files = files.concat(await getFiles(itemPath, supportedExtensions))
        } else {
            const ext = extname(itemPath)
            if (supportedExtensions.includes(ext)) {
                files.push(itemPath)
            }
        }
    }
    return files
}

// 执行 shell 命令
function execCommand(command, directory) {
    return new Promise((resolve, reject) => {
        exec(command, { cwd: directory }, (error, stdout, stderr) => {
            if (error) {
                reject(error)
                return
            }
            if (stderr) {
                reject(new Error(stderr))
                return
            }
            resolve(stdout.trim())
        })
    })
}

// 更新文件头部注释
async function updateFileComment(file, addedDateStr, modifiedDateStr) {
    try {
        const content = await readFile(file, "utf8")
        const lines = content.split("\n")
        let updatedContent = ""
        let blockCommentStarted = false
        for (const line of lines) {
            if (line.trim().startsWith("/*")) {
                blockCommentStarted = true
            }
            if (blockCommentStarted && (line.includes("Created:") || line.includes("Modified:"))) {
                if (line.includes("Created:")) {
                    updatedContent += ` * Created: ${addedDateStr}\n`
                } else if (line.includes("Modified:")) {
                    updatedContent += ` * Modified: ${modifiedDateStr}\n`
                }
            } else {
                updatedContent += line + "\n"
            }
            if (line.trim().endsWith("*/")) {
                blockCommentStarted = false
            }
        }
        await writeFile(file, updatedContent.trim())
        return true
    } catch (error) {
        throw error
    }
}

// 检查命令行参数
if (process.argv.length < 3) {
    console.error("Usage: node script.js /path/to/your/directory")
    process.exit(1)
}

// 获取目录参数并调用函数
const directory = process.argv[2]
getGitAddedDate(directory)
