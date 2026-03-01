#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

// 解决 ESModule 中 __dirname 问题
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 定义支持的音频文件扩展名（可根据需要扩展）
const AUDIO_EXTENSIONS = new Set([
    ".mp3",
    ".m4a",
    ".flac",
    ".wav",
    ".ogg",
    ".aac",
    ".wma",
    ".ape",
    ".alac",
])

/**
 * 检查文件是否为音频文件
 * @param {string} filePath 文件路径
 * @returns {boolean} 是否为音频文件
 */
function isAudioFile(filePath) {
    const ext = path.extname(filePath).toLowerCase()
    return AUDIO_EXTENSIONS.has(ext)
}

/**
 * 递归遍历目录，收集所有音频文件路径
 * @param {string} dir 要遍历的目录
 * @returns {Promise<string[]>} 音频文件路径数组
 */
async function collectAudioFiles(dir) {
    let audioFiles = []

    try {
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.resolve(dir, entry.name)

            if (entry.isDirectory()) {
                // 递归遍历子目录
                const subDirFiles = await collectAudioFiles(fullPath)
                audioFiles = [...audioFiles, ...subDirFiles]
            } else if (entry.isFile() && isAudioFile(fullPath)) {
                // 收集音频文件
                audioFiles.push(fullPath)
            }
        }
    } catch (err) {
        console.error(`遍历目录失败 ${dir}:`, err.message)
    }

    return audioFiles
}

/**
 * 移动音频文件到输出目录（重名跳过）
 * @param {string} sourcePath 源文件路径
 * @param {string} outputDir 输出目录
 */
async function moveAudioFile(sourcePath, outputDir) {
    try {
        // 获取文件名（含扩展名）
        const fileName = path.basename(sourcePath)
        const destPath = path.resolve(outputDir, fileName)

        // 检查目标文件是否已存在
        try {
            await fs.access(destPath)
            console.log(`✅ 跳过：${fileName} (目标目录已存在同名文件)`)
            return
        } catch {
            // 文件不存在，继续移动
        }

        // 确保输出目录存在（不存在则创建）
        await fs.mkdir(outputDir, { recursive: true })

        // 移动文件
        await fs.rename(sourcePath, destPath)
        console.log(`✅ 移动成功：${sourcePath} -> ${destPath}`)
    } catch (err) {
        console.error(`❌ 移动失败 ${sourcePath}:`, err.message)
    }
}

/**
 * 主函数
 */
async function main() {
    // 获取命令行参数
    const [inputDir, outputDir] = process.argv.slice(2)

    // 参数校验
    if (!inputDir || !outputDir) {
        console.error("❌ 用法错误！正确用法：")
        console.error("   node audio-mover.js <输入目录> <输出目录>")
        process.exit(1)
    }

    // 解析为绝对路径
    const inputPath = path.resolve(inputDir)
    const outputPath = path.resolve(outputDir)

    // 检查输入目录是否存在
    try {
        await fs.access(inputPath)
    } catch {
        console.error(`❌ 输入目录不存在：${inputPath}`)
        process.exit(1)
    }

    console.log(`🔍 开始扫描目录：${inputPath}`)
    console.log(`📁 输出目录：${outputPath}`)

    // 收集所有音频文件
    const audioFiles = await collectAudioFiles(inputPath)

    if (audioFiles.length === 0) {
        console.log("📭 未找到任何音频文件")
        process.exit(0)
    }

    console.log(`📊 共找到 ${audioFiles.length} 个音频文件，开始移动...`)

    // 逐个移动文件
    for (const file of audioFiles) {
        await moveAudioFile(file, outputPath)
    }

    console.log("\n🎉 所有操作完成！")
}

// 执行主函数
main().catch((err) => {
    console.error("❌ 程序执行出错：", err.message)
    process.exit(1)
})
