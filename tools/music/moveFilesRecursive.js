import fs from "fs/promises"
import path, { dirname } from "path"
import { fileURLToPath } from "url"

// 解决 ES Module 中 __dirname 缺失的问题
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * 递归遍历目录，获取所有文件的完整路径
 * @param {string} dir - 要遍历的目录
 * @returns {Array<string>} 所有文件的完整路径数组
 */
async function getAllFilesRecursive(dir) {
    let results = []
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = path.resolve(dir, entry.name)
        if (entry.isDirectory()) {
            // 递归遍历子目录
            const subDirFiles = await getAllFilesRecursive(fullPath)
            results = results.concat(subDirFiles)
        } else if (entry.isFile()) {
            // 添加文件路径到结果数组
            results.push(fullPath)
        }
    }
    return results
}

/**
 * 移动文件，重名时保留尺寸更大的文件
 * @param {string} inputDir - 输入根目录
 * @param {string} outputDir - 输出目录
 */
async function moveFilesWithSizeCheck(inputDir, outputDir) {
    try {
        // 解析并规范化路径
        const resolvedInputDir = path.resolve(inputDir)
        const resolvedOutputDir = path.resolve(outputDir)

        // 验证输入目录是否存在
        try {
            await fs.access(resolvedInputDir)
        } catch (err) {
            throw new Error(`输入目录不存在: ${resolvedInputDir}`, { cause: err })
        }

        // 确保输出目录存在，不存在则创建（递归创建多层）
        await fs.mkdir(resolvedOutputDir, { recursive: true })
        console.log(`输出目录已准备好: ${resolvedOutputDir}`)

        // 递归获取所有文件路径
        const allFiles = await getAllFilesRecursive(resolvedInputDir)
        console.log(`共找到 ${allFiles.length} 个文件待处理`)

        let movedCount = 0
        let skippedCount = 0
        let replacedCount = 0

        // 遍历所有文件
        for (const filePath of allFiles) {
            // 获取文件名（仅名称，不含路径）
            const fileName = path.basename(filePath)
            // 目标文件路径
            const targetPath = path.join(resolvedOutputDir, fileName)

            try {
                // 获取源文件的状态（包含大小）
                const sourceStat = await fs.stat(filePath)

                // 检查目标文件是否存在
                try {
                    const targetStat = await fs.stat(targetPath)

                    // 目标文件存在，对比大小
                    if (sourceStat.size > targetStat.size) {
                        // 源文件更大，先删除目标文件再移动
                        await fs.unlink(targetPath)
                        await fs.rename(filePath, targetPath)
                        console.log(
                            `[替换] ${fileName} (源: ${sourceStat.size}B > 目标: ${targetStat.size}B)`,
                        )
                        replacedCount++
                    } else {
                        // 目标文件更大，跳过
                        console.log(
                            `[跳过] ${fileName} (源: ${sourceStat.size}B ≤ 目标: ${targetStat.size}B)`,
                        )
                        skippedCount++
                    }
                } catch (err) {
                    // 目标文件不存在，直接移动
                    await fs.rename(filePath, targetPath)
                    console.log(`[移动] ${fileName} (${sourceStat.size}B)`)
                    movedCount++
                }
            } catch (err) {
                console.error(`处理文件失败 ${filePath}: ${err.message}`)
            }
        }

        // 输出统计信息
        console.log(`
=== 操作完成 ===
✅ 成功移动: ${movedCount} 个
🔄 替换（源文件更大）: ${replacedCount} 个
🚫 跳过（目标文件更大）: ${skippedCount} 个
📊 总计处理: ${movedCount + replacedCount + skippedCount} 个
        `)
    } catch (error) {
        console.error(`执行出错: ${error.message}`)
        process.exit(1)
    }
}

/**
 * 主函数：解析命令行参数并执行
 */
async function main() {
    // 解析命令行参数
    const args = process.argv.slice(2)

    // 参数校验
    if (args.length !== 2) {
        console.error("使用方法: node moveFilesRecursive.js <输入目录> <输出目录>")
        console.error("示例: node moveFilesRecursive.js ./source ./target")
        process.exit(1)
    }

    const [inputDir, outputDir] = args
    await moveFilesWithSizeCheck(inputDir, outputDir)
}

// 启动脚本
main()
