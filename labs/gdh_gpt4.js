/*
 * Project: mediac
 * Created: 2024-04-09 22:12:51
 * Modified: 2024-04-09 22:12:51
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// 导入必要的node模块，包括执行子进程、日期处理、文件系统操作和路径操作。
import { exec } from "child_process"
import dayjs from "dayjs" // 一个用于解析、验证、操作和显示日期的库。
import { readFile, readdir, stat, writeFile } from "fs/promises" // 用于处理文件系统的Promise API。
import { extname, join, relative } from "path" // 用于处理文件路径的模块。

// 定义一个执行命令的异步函数。
const execCommand = (command, cwd) => {
    return new Promise((resolve, reject) => {
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (error) reject(error)
            else if (stderr) reject(stderr)
            else resolve(stdout.trim())
        })
    })
}

// 定义一个获取Git日期的异步函数。
const getGitDates = async (file, directory) => {
    const addedLog = await execCommand(
        `git log --pretty=format:%aD --date=iso --diff-filter=A -- "${file}"`,
        directory,
    )
    const modified = (await stat(file)).mtime.toISOString() // 获取文件修改时间。
    return {
        added: addedLog ? dayjs(addedLog.split("\n").pop()).format("YYYY-MM-DD HH:mm:ss ZZ") : null, // 格式化创建日期。
        modified: dayjs(modified).format("YYYY-MM-DD HH:mm:ss ZZ"), // 格式化修改日期。
    }
}

// 定义一个更新文件注释日期的异步函数。
const updateFileComment = async (file, dates) => {
    const content = await readFile(file, "utf8") // 读取文件内容。
    const dateRegex = /(\* Created: ).*?(\r?\n\s*\* Modified: ).*?(?=\r?\n)/ // 正则表达式匹配日期注释。
    const newContent = content.replace(
        dateRegex,
        `$1${dates.added}$2${dates.modified}`, // 替换为新的日期。
    )

    if (newContent !== content) {
        await writeFile(file, newContent) // 写入新的文件内容。
        return true
    }
    return false // 如果内容没有变化，返回false。
}

// 定义一个递归获取指定目录中所有支持扩展类型文件的异步函数。
const getFiles = async (dir, supportedExtensions) => {
    const dirents = await readdir(dir, { withFileTypes: true })
    let files = []
    for (const dirent of dirents) {
        const resPath = join(dir, dirent.name)
        if (
            dirent.isDirectory() &&
            !dirent.name.startsWith(".") &&
            dirent.name !== "node_modules"
        ) {
            files = files.concat(await getFiles(resPath, supportedExtensions)) // 递归查找。
        } else if (dirent.isFile() && supportedExtensions.includes(extname(resPath))) {
            files.push(resPath) // 收集支持的文件类型。
        }
    }
    return files // 返回所有找到的文件路径。
}

// 立即执行的异步函数。
;(async () => {
    try {
        if (process.argv.length < 3) {
            console.error("Usage: node script.js /path/to/your/directory") // 若没有提供足够的参数，则抛出错误指示。
            process.exit(1)
        }
        const directory = process.argv[2] // 获取命令行中提供的目录路径。
        const supportedExtensions = [".js", ".ts", ".css", ".html", ".json", ".md"] // 定义脚本支持的文件扩展名。
        const files = await getFiles(directory, supportedExtensions) // 获取所有支持的文件。
        for (const file of files) {
            const dates = await getGitDates(file, directory) // 获取每个文件的创建和修改日期。
            if (dates.added && dates.modified) {
                console.log(`Processing file: ${relative(directory, file)}`) // 打印处理中的文件。
                if (await updateFileComment(file, dates)) {
                    console.log(`File updated: ${relative(directory, file)}`) // 打印更新了的文件。
                } else {
                    console.log(`File not modified: ${relative(directory, file)}`) // 打印未修改的文件。
                }
            } else {
                console.log(`Failed to get dates for: ${file}`) // 打印获取日期失败的文件。
            }
        }
    } catch (error) {
        console.error("Error:", error) // 捕捉到错误并打印。
        process.exit(1)
    }
})()
