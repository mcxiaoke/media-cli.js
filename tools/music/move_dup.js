// file-duplicate-handler.mjs
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

// 获取当前模块的路径（ES Module 中替代 __dirname）
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 检查并创建目录（如果不存在）
 * @param {string} dirPath 目录路径
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.access(dirPath)
    } catch (error) {
        if (error.code === "ENOENT") {
            await fs.mkdir(dirPath, { recursive: true })
            console.log(`✅ 目录已创建: ${dirPath}`)
        } else {
            throw error
        }
    }
}

/**
 * 递归获取目录下的所有文件（包含子目录）
 * @param {string} rootDir 根目录路径
 * @param {string} currentDir 当前遍历的子目录（相对路径）
 * @returns {Promise<Array<{name: string, fullPath: string, relativePath: string}>>} 文件信息数组
 */
async function getFilesRecursively(rootDir, currentDir = "") {
    const files = []
    const fullCurrentDir = path.join(rootDir, currentDir)

    try {
        const entries = await fs.readdir(fullCurrentDir, { withFileTypes: true })

        for (const entry of entries) {
            const entryRelativePath = path.join(currentDir, entry.name)
            const entryFullPath = path.join(rootDir, entryRelativePath)

            if (entry.isDirectory()) {
                // 递归遍历子目录
                const subDirFiles = await getFilesRecursively(rootDir, entryRelativePath)
                files.push(...subDirFiles)
            } else if (entry.isFile()) {
                // 收集文件信息：文件名、完整路径、相对根目录的路径
                files.push({
                    name: entry.name,
                    fullPath: entryFullPath,
                    relativePath: entryRelativePath,
                })
            }
        }
    } catch (error) {
        console.error(`❌ 读取目录失败: ${fullCurrentDir}`, error.message)
        throw error
    }

    return files
}

/**
 * 移动重复文件到输出目录（包含子目录）
 * @param {string} dir1 目录1路径
 * @param {string} dir2 目录2路径
 * @param {string} outputDir 输出目录路径
 */
async function moveDuplicateFiles(dir1, dir2, outputDir) {
    try {
        // 解析为绝对路径
        const absoluteDir1 = path.resolve(__dirname, dir1)
        const absoluteDir2 = path.resolve(__dirname, dir2)
        const absoluteOutputDir = path.resolve(__dirname, outputDir)

        // 确保输出目录存在
        await ensureDirectoryExists(absoluteOutputDir)

        // 递归获取目录1的所有文件，收集文件名（去重）
        console.log(`🔍 正在递归读取目录1: ${absoluteDir1}`)
        const dir1Files = await getFilesRecursively(absoluteDir1)
        const dir1FileNameSet = new Set(dir1Files.map((file) => file.name))
        console.log(
            `📄 目录1（含子目录）共找到 ${dir1Files.length} 个文件，不同文件名数量: ${dir1FileNameSet.size}`,
        )

        // 递归获取目录2的所有文件
        console.log(`🔍 正在递归读取目录2: ${absoluteDir2}`)
        const dir2Files = await getFilesRecursively(absoluteDir2)
        console.log(`📄 目录2（含子目录）共找到 ${dir2Files.length} 个文件`)

        // 遍历目录2的文件，检查文件名是否在目录1中存在
        let movedCount = 0
        for (const file of dir2Files) {
            if (dir1FileNameSet.has(file.name)) {
                const sourceFullPath = file.fullPath
                // 输出目录保持原文件的相对目录结构（可选，如需扁平化可直接用 file.name）
                const targetRelativePath = file.relativePath
                const targetFullPath = path.join(absoluteOutputDir, targetRelativePath)

                // 确保目标子目录存在
                await ensureDirectoryExists(path.dirname(targetFullPath))

                // 移动文件（跨设备降级为复制+删除）
                try {
                    await fs.rename(sourceFullPath, targetFullPath)
                    console.log(`🚚 已移动重复文件: ${file.relativePath}`)
                    movedCount++
                } catch (renameError) {
                    if (renameError.code === "EXDEV") {
                        await fs.copyFile(sourceFullPath, targetFullPath)
                        await fs.unlink(sourceFullPath)
                        console.log(`📤 已复制并删除重复文件: ${file.relativePath}`)
                        movedCount++
                    } else {
                        console.error(`❌ 移动文件失败: ${file.relativePath}`, renameError.message)
                    }
                }
            }
        }

        console.log(
            `\n🎉 处理完成！共移动 ${movedCount} 个重复文件到输出目录: ${absoluteOutputDir}`,
        )
    } catch (error) {
        console.error("\n❌ 程序执行出错:", error.message)
        process.exit(1)
    }
}

// 主函数：解析命令行参数并执行
async function main() {
    // 获取命令行参数（node 脚本名 dir1 dir2 outputDir）
    const args = process.argv.slice(2)

    // 检查参数数量
    if (args.length !== 3) {
        console.error("❌ 参数错误！正确用法：")
        console.error("node file-duplicate-handler.mjs <目录1> <目录2> <输出目录>")
        console.error("示例：node file-duplicate-handler.mjs ./dir1 ./dir2 ./output")
        process.exit(1)
    }

    const [dir1, dir2, outputDir] = args
    await moveDuplicateFiles(dir1, dir2, outputDir)
}

// 执行主函数
main()
