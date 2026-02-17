// fileManager.js
import fs from "fs-extra"
import path from "path"
import { argv } from "process"

// 默认图片扩展名
const DEFAULT_IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"]

/**
 * 函数1：遍历目录，递归读取所有文件，保存到filelist.json
 * @param {string} inputDir - 输入目录路径
 * @param {string} outputDir - 输出目录路径
 * @param {string[]} extensions - 文件扩展名过滤，默认为图片文件
 */
export async function scanAndSaveFileList(
    inputDir,
    outputDir,
    extensions = DEFAULT_IMAGE_EXTENSIONS,
) {
    try {
        // 确保输出目录存在
        await fs.ensureDir(outputDir)

        const fileList = []
        const outputFile = path.join(outputDir, "filelist.json")

        // 递归遍历目录
        await scanDirectory(inputDir, fileList, extensions)

        // 保存到JSON文件
        await fs.writeJson(outputFile, fileList, { spaces: 2 })

        console.log(`文件列表已保存到: ${outputFile}`)
        console.log(`共找到 ${fileList.length} 个文件`)
        return fileList
    } catch (error) {
        console.error("扫描目录时出错:", error)
        throw error
    }
}

/**
 * 递归扫描目录的辅助函数
 * @param {string} dirPath - 当前目录路径
 * @param {Array} fileList - 文件列表数组
 * @param {string[]} extensions - 扩展名过滤
 */
async function scanDirectory(dirPath, fileList, extensions) {
    try {
        const items = await fs.readdir(dirPath)

        for (const item of items) {
            const fullPath = path.join(dirPath, item)
            const stats = await fs.stat(fullPath)

            if (stats.isDirectory()) {
                // 递归扫描子目录
                await scanDirectory(fullPath, fileList, extensions)
            } else if (stats.isFile()) {
                // 检查文件扩展名
                const ext = path.extname(item).toLowerCase()
                if (!extensions || extensions.includes(ext)) {
                    fileList.push({
                        absolutePath: path.resolve(fullPath),
                        fileName: item,
                        size: stats.size,
                        extension: ext,
                        mtime: stats.mtime.toISOString(),
                    })
                }
            }
        }
    } catch (error) {
        console.error(`扫描目录 ${dirPath} 时出错:`, error)
    }
}

/**
 * 函数2：从filelist.json中还原文件列表
 * @param {string} inputFile - 输入文件路径（filelist.json）
 * @returns {Promise<Array>} 文件列表
 */
export async function loadFileList(inputFile) {
    try {
        const fileList = await fs.readJson(inputFile)
        console.log(`从 ${inputFile} 加载了 ${fileList.length} 个文件`)
        return fileList
    } catch (error) {
        console.error("加载文件列表时出错:", error)
        throw error
    }
}

/**
 * 函数3：过滤文件列表
 * @param {Array} fileList - 文件列表
 * @param {Object} options - 过滤选项
 * @param {number} options.minSize - 最小文件大小（字节）
 * @returns {Promise<Array>} 过滤后的文件列表
 */
export async function filterFileList(fileList, options = {}) {
    const { minSize = 0 } = options
    const filteredList = []

    console.log(`开始过滤文件列表，最小大小: ${minSize} 字节`)

    for (const fileInfo of fileList) {
        try {
            // 检查文件是否存在
            const exists = await fs.pathExists(fileInfo.absolutePath)

            if (!exists) {
                console.log(`文件不存在，跳过: ${fileInfo.absolutePath}`)
                continue
            }

            // 检查文件大小
            if (fileInfo.size < minSize) {
                console.log(`文件太小，跳过: ${fileInfo.absolutePath} (${fileInfo.size} 字节)`)
                continue
            }

            filteredList.push(fileInfo)
        } catch (error) {
            console.error(`检查文件 ${fileInfo.absolutePath} 时出错:`, error)
        }
    }

    console.log(`过滤完成，剩余 ${filteredList.length} 个文件`)
    return filteredList
}

/**
 * 保存过滤后的文件列表
 * @param {Array} filteredList - 过滤后的文件列表
 * @param {string} outputFile - 输出文件路径
 */
export async function saveFilteredFileList(filteredList, outputFile) {
    try {
        await fs.ensureDir(path.dirname(outputFile))
        await fs.writeJson(outputFile, filteredList, { spaces: 2 })
        console.log(`过滤后的文件列表已保存到: ${outputFile}`)
    } catch (error) {
        console.error("保存过滤后的文件列表时出错:", error)
        throw error
    }
}

// 使用示例
export async function main() {
    console.log(process.argv)
    const argv = process.argv.slice(2)
    try {
        // 示例1：扫描目录并保存文件列表
        const inputDir = path.resolve(argv[0])
        const outputDir = path.resolve(argv[1] || "./output")

        // 扫描所有图片文件
        const fileList = await scanAndSaveFileList(inputDir, outputDir)

        // 示例2：从JSON加载文件列表
        const loadedList = await loadFileList(path.join(outputDir, "filelist.json"))

        // 示例3：过滤文件（最小1MB）
        const filteredList = await filterFileList(loadedList, { minSize: 1024 * 1024 })

        // 保存过滤后的列表
        await saveFilteredFileList(filteredList, path.join(outputDir, "filtered-filelist.json"))
    } catch (error) {
        console.error("主流程出错:", error)
    }
}

// 如果直接运行此脚本
main()
