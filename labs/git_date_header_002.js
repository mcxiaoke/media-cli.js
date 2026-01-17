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

const execCommand = (command, cwd) => {
    return new Promise((resolve, reject) => {
        exec(command, { cwd }, (error, stdout, stderr) => {
            if (error) reject(error)
            else if (stderr) reject(stderr)
            else resolve(stdout.trim())
        })
    })
}

const getGitDates = async (file, directory) => {
    const addedLog = await execCommand(
        `git log --pretty=format:%aD --date=iso --diff-filter=A -- "${file}"`,
        directory,
    )
    const modified = (await stat(file)).mtime.toISOString()
    return {
        added: addedLog ? dayjs(addedLog.split("\n").pop()).format("YYYY-MM-DD HH:mm:ss ZZ") : null,
        modified: dayjs(modified).format("YYYY-MM-DD HH:mm:ss ZZ"),
    }
}

const updateFileComment = async (file, dates) => {
    const content = await readFile(file, "utf8")
    const dateRegex = /(\* Created: ).*?(\r?\n\s*\* Modified: ).*?(?=\r?\n)/
    const newContent = content.replace(dateRegex, `$1${dates.added}$2${dates.modified}`)

    if (newContent !== content) {
        await writeFile(file, newContent)
        return true
    }
    return false
}

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
            files = files.concat(await getFiles(resPath, supportedExtensions))
        } else if (dirent.isFile() && supportedExtensions.includes(extname(resPath))) {
            files.push(resPath)
        }
    }
    return files
}

;(async () => {
    try {
        if (process.argv.length < 3) {
            console.error("Usage: node script.js /path/to/your/directory")
            process.exit(1)
        }
        const directory = process.argv[2]
        const supportedExtensions = [".js", ".ts", ".css", ".html", ".json", ".md"]
        const files = await getFiles(directory, supportedExtensions)
        for (const file of files) {
            const dates = await getGitDates(file, directory)
            if (dates.added && dates.modified) {
                console.log(`Processing file: ${relative(directory, file)}`)
                if (await updateFileComment(file, dates)) {
                    console.log(`File updated: ${relative(directory, file)}`)
                } else {
                    console.log(`File not modified: ${relative(directory, file)}`)
                }
            } else {
                console.log(`Failed to get dates for: ${file}`)
            }
        }
    } catch (error) {
        console.error("Error:", error)
        process.exit(1)
    }
})()
