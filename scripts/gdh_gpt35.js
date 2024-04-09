/*
 * Project: mediac
 * Created: 2024-04-09 22:12:07
 * Modified: 2024-04-09 22:12:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import { exec } from 'child_process'
import dayjs from 'dayjs'
import { readFile, readdir, stat, writeFile } from 'fs/promises'
import { extname, join, relative } from 'path'

// 封装执行系统命令的函数
const execCommand = (command, cwd) => {
    return new Promise((resolve, reject) => {
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (error || stderr) {
                reject(error || stderr)
            } else {
                resolve(stdout.trim())
            }
        })
    })
}

// 获取 Git 中的文件添加和修改日期
const getGitDates = async (file, directory) => {
    const addedLog = await execCommand(`git log --pretty=format:%aD --date=iso --diff-filter=A -- "${file}"`, directory)
    const modified = (await stat(file)).mtime.toISOString()
    return {
        added: addedLog ? dayjs(addedLog.split('\n').pop()).format('YYYY-MM-DD HH:mm:ss ZZ') : null,
        modified: dayjs(modified).format('YYYY-MM-DD HH:mm:ss ZZ')
    }
}

// 更新文件注释中的日期信息
const updateFileComment = async (file, dates) => {
    const content = await readFile(file, 'utf8')
    const dateRegex = /(\* Created: ).*?(\r?\n\s*\* Modified: ).*?(?=\r?\n)/
    const newContent = content.replace(
        dateRegex,
        `$1${dates.added}$2${dates.modified}`
    )

    if (newContent !== content) {
        await writeFile(file, newContent)
        return true
    }
    return false
}

// 递归获取目录中指定扩展名的文件列表
const getFiles = async (dir, supportedExtensions) => {
    const dirents = await readdir(dir, { withFileTypes: true })
    let files = []
    for (const dirent of dirents) {
        const resPath = join(dir, dirent.name)
        if (dirent.isDirectory() && !dirent.name.startsWith('.') && dirent.name !== 'node_modules') {
            files = files.concat(await getFiles(resPath, supportedExtensions))
        } else if (dirent.isFile() && supportedExtensions.includes(extname(resPath))) {
            files.push(resPath)
        }
    }
    return files
};

// 主函数，执行文件注释更新操作
(async () => {
    try {
        if (process.argv.length < 3) {
            console.error('用法: node script.js /你的/目录/路径')
            process.exit(1)
        }
        const directory = process.argv[2]
        const supportedExtensions = ['.js', '.ts', '.css', '.html', '.json', '.md']
        const files = await getFiles(directory, supportedExtensions)
        for (const file of files) {
            const dates = await getGitDates(file, directory)
            if (dates.added && dates.modified) {
                console.log(`处理文件: ${relative(directory, file)}`)
                if (await updateFileComment(file, dates)) {
                    console.log(`文件已更新: ${relative(directory, file)}`)
                } else {
                    console.log(`文件未修改: ${relative(directory, file)}`)
                }
            } else {
                console.log(`未能获取日期信息: ${file}`)
            }
        }
    } catch (error) {
        console.error('错误:', error)
        process.exit(1)
    }
})()
