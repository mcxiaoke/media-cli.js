/*
 * Project: mediac
 * Created: 2024-04-16 20:07:01
 * Modified: 2024-04-16 20:07:01
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// cue-splitter-cli.js

import fs from "fs"
import path from "path"
import yargs from "yargs"
import { splitAudioByCue } from "./cue-splitter.mjs"

// 定义命令行参数
const argv = yargs(process.argv.slice(2))
    .usage("Usage: $0 <inputDir>")
    .demandCommand(1, "Please specify the input directory")
    .help().argv

const inputDir = argv._[0]

// 检查输入目录是否存在
if (!fs.existsSync(inputDir)) {
    console.error("Input directory does not exist.")
    process.exit(1)
}

// 递归遍历目录，找到所有的cue文件
const cueFiles = findCueFiles(inputDir)
if (cueFiles.length === 0) {
    console.error("No cue files found in the input directory.")
    process.exit(1)
}

console.log(`Found ${cueFiles.length} cue file(s) in the input directory.`)
console.log("Splitting audio by cue files...")

// 分离音轨
;(async () => {
    for (const cueFile of cueFiles) {
        const audioFilePath = path.join(path.dirname(cueFile), parseAudioFilePath(cueFile))
        if (!fs.existsSync(audioFilePath)) {
            console.error(
                `Audio file ${audioFilePath} not found for cue file ${cueFile}. Skipping...`,
            )
            continue
        }

        console.log(`Splitting audio for cue file: ${cueFile}`)
        const cueFileName = path.basename(cueFile, ".cue")
        const cueOutputDir = path.join(inputDir, cueFileName)

        try {
            await fs.promises.mkdir(cueOutputDir, { recursive: true })
            const cueInfo = await splitAudioByCue(cueFile, audioFilePath, cueOutputDir)
            console.log(`Audio split successfully for cue file: ${cueFile}`)
            console.log(cueInfo)
        } catch (error) {
            console.error(`Error splitting audio for cue file ${cueFile}: ${error.message}`)
        }
    }
})()

/**
 * 递归查找指定目录及其子目录中的所有CUE文件
 *
 * @param {string} dir - 要搜索的目录
 * @returns {Array<string>} 找到的所有CUE文件路径
 */
function findCueFiles(dir) {
    let cueFiles = []
    const files = fs.readdirSync(dir)
    files.forEach((file) => {
        const filePath = path.join(dir, file)
        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
            cueFiles = cueFiles.concat(findCueFiles(filePath))
        } else if (path.extname(file) === ".cue") {
            cueFiles.push(filePath)
        }
    })
    return cueFiles
}

/**
 * 从CUE文件中解析出音频文件路径
 * 读取CUE文件内容并提取FILE行中的音频文件名
 *
 * @param {string} cueFile - CUE文件路径
 * @returns {string} 音频文件名，如果未找到则返回空字符串
 */
function parseAudioFilePath(cueFile) {
    const cueContent = fs.readFileSync(cueFile, "utf8")
    const fileLine = cueContent.match(/^FILE\s+"(.+)"\s+/m)
    if (fileLine) {
        return fileLine[1]
    }
    return ""
}
