/**
 * 重复文件移动工具
 * 功能：递归遍历目录B（含子目录），比对目录A中匹配的文件（兼容_thumb后缀双向匹配），
 *       确认后将匹配文件移动到deleted目录，并保留原目录结构
 * 使用：node scriptName.js <dirA> <dirB> <deletedDir>
 * 依赖：fs-extra, p-map, yargs
 */
import fs from "fs-extra"
import path from "path"
import { fileURLToPath } from "url"
import readline from "readline"
import pMap from "p-map"
import yargs from "yargs"
import { hideBin } from "yargs/helpers"

// ===================== 常量配置 =====================
/** 并行处理的最大线程数 */
const MAX_CONCURRENCY = 8
/** 缩略图后缀标识 */
const THUMB_SUFFIX = "_thumb"
/** 当前文件路径（ES Module兼容） */
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ===================== 工具函数 =====================
/**
 * 提取文件名的原始基准信息（去除_thumb后缀）
 * @param {string} fullFileName 完整文件名（含扩展名，如：a_thumb.jpg）
 * @returns {{originalBaseName: string, ext: string, hasThumbSuffix: boolean}} 解析结果
 */
function extractOriginalFileName(fullFileName) {
    const fileExt = path.extname(fullFileName)
    const fileNameWithoutExt = path.basename(fullFileName, fileExt)
    const hasThumb = fileNameWithoutExt.endsWith(THUMB_SUFFIX)

    // 去除thumb后缀得到原始基准名
    const originalNameWithoutExt = hasThumb
        ? fileNameWithoutExt.replace(THUMB_SUFFIX, "")
        : fileNameWithoutExt

    return {
        originalBaseName: `${originalNameWithoutExt}${fileExt}`, // 原始基准名+扩展名（如a.jpg）
        ext: fileExt,
        hasThumbSuffix: hasThumb,
    }
}

/**
 * 等待用户确认操作（同步交互）
 * @param {Array<{filePath: string, matchType: string, matchedAFileName: string}>} matchedFiles 匹配文件列表
 * @returns {Promise<boolean>} 用户确认状态（true=确认，false=取消）
 */
async function confirmOperation(matchedFiles) {
    return new Promise((resolve) => {
        const rlInterface = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })

        // 打印匹配文件列表
        console.log("\n📋 找到以下匹配文件：")
        matchedFiles.forEach(({ filePath, matchType, matchedAFileName }, index) => {
            console.log(`[${index + 1}] ${filePath}`)
            console.log(`   └─ 匹配类型：${matchType} | 匹配目录A文件：${matchedAFileName}`)
        })
        console.log(`\n总计：${matchedFiles.length} 个匹配文件`)

        // 等待用户输入
        rlInterface.question("\n✅ 是否确认移动这些文件到deleted目录？(y/n) ", (answer) => {
            rlInterface.close()
            const isConfirmed = answer.trim().toLowerCase() === "y"
            resolve(isConfirmed)
        })
    })
}

/**
 * 生成不重复的目标文件路径（避免覆盖）
 * @param {string} targetDir 目标目录
 * @param {string} fileName 原文件名
 * @returns {Promise<string>} 唯一的目标文件路径
 */
async function getUniqueTargetPath(targetDir, fileName) {
    let targetFilePath = path.join(targetDir, fileName)
    let suffixNum = 1

    // 循环检查文件是否存在，存在则添加数字后缀
    while (await fs.pathExists(targetFilePath)) {
        const fileExt = path.extname(fileName)
        const fileNameWithoutExt = path.basename(fileName, fileExt)
        targetFilePath = path.join(targetDir, `${fileNameWithoutExt}_${suffixNum}${fileExt}`)
        suffixNum++
    }
    return targetFilePath
}

/**
 * 递归遍历目录，获取所有文件的绝对路径（含子目录）
 * @param {string} dirPath 要遍历的目录路径
 * @returns {Promise<string[]>} 所有文件的绝对路径列表
 * @throws {Error} 目录不存在或无访问权限时抛出错误
 */
async function getFilesRecursively(dirPath) {
    let filePaths = []
    const dirEntries = await fs.readdir(dirPath, { withFileTypes: true })

    // 并行处理目录项，控制并发数
    const processResults = await pMap(
        dirEntries,
        async (entry) => {
            const entryFullPath = path.join(dirPath, entry.name)
            if (entry.isFile()) {
                return [entryFullPath]
            } else if (entry.isDirectory()) {
                // 递归遍历子目录
                return await getFilesRecursively(entryFullPath)
            }
            return [] // 忽略非文件/目录（如符号链接）
        },
        { concurrency: MAX_CONCURRENCY },
    )

    // 合并所有子目录的文件路径
    processResults.forEach((result) => {
        filePaths = filePaths.concat(result)
    })
    return filePaths
}

/**
 * 预加载目录A的文件映射表（提升比对效率）
 * @param {string} dirAPath 目录A的绝对路径
 * @returns {Promise<Map<string, string>>} 原始基准名 -> 目录A文件绝对路径的映射
 */
async function preloadDirAFileMap(dirAPath) {
    const fileMap = new Map()
    const dirAFilePaths = await getFilesRecursively(dirAPath)

    for (const aFilePath of dirAFilePaths) {
        const aFileName = path.basename(aFilePath)
        const { originalBaseName } = extractOriginalFileName(aFileName)
        // 存储原始基准名到实际文件路径的映射（覆盖重复基准名，取最后一个）
        fileMap.set(originalBaseName, aFilePath)
    }

    return fileMap
}

/**
 * 构建目标路径（保留原目录结构）
 * @param {string} sourceFilePath 源文件绝对路径
 * @param {string} sourceRootDir 源根目录（目录B）
 * @param {string} targetRootDir 目标根目录（deleted目录）
 * @returns {string} 带原目录结构的目标文件路径
 */
function buildTargetPathWithStructure(sourceFilePath, sourceRootDir, targetRootDir) {
    // 获取源文件相对源根目录的路径
    const relativePath = path.relative(sourceRootDir, sourceFilePath)
    // 拼接目标根目录和相对路径，保留原结构
    return path.join(targetRootDir, relativePath)
}

// ===================== 主逻辑 =====================
/**
 * 主处理函数
 * @param {string} dirA 基准目录路径
 * @param {string} dirB 待遍历目录路径
 * @param {string} deletedDir 目标删除目录路径
 */
async function mainProcess(dirA, dirB, deletedDir) {
    // 转换为绝对路径
    const absDirA = path.resolve(dirA)
    const absDirB = path.resolve(dirB)
    const absDeletedDir = path.resolve(deletedDir)

    try {
        // 1. 校验输入目录的合法性
        console.log("🔍 正在校验输入目录...")
        const dirCheckList = [
            { path: absDirA, name: "目录A（基准目录）" },
            { path: absDirB, name: "目录B（待遍历目录）" },
        ]

        for (const { path: checkPath, name } of dirCheckList) {
            if (!(await fs.pathExists(checkPath))) {
                throw new Error(`${name} "${checkPath}" 不存在`)
            }
            const dirStats = await fs.stat(checkPath)
            if (!dirStats.isDirectory()) {
                throw new Error(`${name} "${checkPath}" 不是合法目录`)
            }
        }

        // 2. 预加载目录A的文件映射
        console.log(`📂 正在加载目录A文件映射: ${absDirA}`)
        const dirAFileMap = await preloadDirAFileMap(absDirA)
        if (dirAFileMap.size === 0) {
            console.log("ℹ️ 目录A及其子目录中未找到任何文件，任务结束")
            process.exit(0)
        }

        // 3. 递归遍历目录B获取所有文件
        console.log(`📂 正在递归遍历目录B: ${absDirB}（并行数：${MAX_CONCURRENCY}）`)
        const dirBFilePaths = await getFilesRecursively(absDirB)
        if (dirBFilePaths.length === 0) {
            console.log("ℹ️ 目录B及其子目录中未找到任何文件，任务结束")
            process.exit(0)
        }
        console.log(`ℹ️ 目录B共找到 ${dirBFilePaths.length} 个文件`)

        // 4. 比对匹配文件（双向兼容thumb后缀）
        console.log(`🔍 正在比对匹配文件（兼容${THUMB_SUFFIX}后缀）`)
        const matchedFiles = []
        await pMap(
            dirBFilePaths,
            async (bFilePath) => {
                const bFileName = path.basename(bFilePath)
                const { originalBaseName: bOriginalName, hasThumbSuffix: bHasThumb } =
                    extractOriginalFileName(bFileName)

                // 检查目录A是否有匹配的原始基准名
                if (dirAFileMap.has(bOriginalName)) {
                    const aMatchedFilePath = dirAFileMap.get(bOriginalName)
                    const aMatchedFileName = path.basename(aMatchedFilePath)
                    const { hasThumbSuffix: aHasThumb } = extractOriginalFileName(aMatchedFileName)

                    // 判定匹配类型
                    let matchType = ""
                    if (aHasThumb && bHasThumb) {
                        matchType = "完全同名（均含thumb后缀）"
                    } else if (!aHasThumb && !bHasThumb) {
                        matchType = "完全同名（无thumb后缀）"
                    } else if (aHasThumb && !bHasThumb) {
                        matchType = "A含thumb后缀，B不含"
                    } else if (!aHasThumb && bHasThumb) {
                        matchType = "B含thumb后缀，A不含"
                    }

                    matchedFiles.push({
                        filePath: bFilePath,
                        matchType: matchType,
                        matchedAFileName: aMatchedFileName,
                    })
                }
            },
            { concurrency: MAX_CONCURRENCY },
        )

        if (matchedFiles.length === 0) {
            console.log(`ℹ️ 未找到任何匹配文件（兼容${THUMB_SUFFIX}后缀），任务结束`)
            process.exit(0)
        }

        // 5. 等待用户确认
        const isConfirmed = await confirmOperation(matchedFiles)
        if (!isConfirmed) {
            console.log("ℹ️ 用户取消操作，任务结束")
            process.exit(0)
        }

        // 6. 移动文件到deleted目录（保留原结构）
        console.log(`🚚 开始移动文件到: ${absDeletedDir}（保留原目录结构）`)
        await pMap(
            matchedFiles,
            async ({ filePath: sourceFilePath }) => {
                try {
                    // 构建带原结构的目标路径
                    const targetFilePath = buildTargetPathWithStructure(
                        sourceFilePath,
                        absDirB,
                        absDeletedDir,
                    )
                    // 确保目标目录存在
                    await fs.ensureDir(path.dirname(targetFilePath))
                    // 生成唯一目标路径（避免覆盖）
                    const uniqueTargetPath = await getUniqueTargetPath(
                        path.dirname(targetFilePath),
                        path.basename(targetFilePath),
                    )
                    // 移动文件
                    await fs.move(sourceFilePath, uniqueTargetPath, { overwrite: false })
                    console.log(`✅ 已移动: ${sourceFilePath} -> ${uniqueTargetPath}`)
                } catch (moveErr) {
                    console.error(`❌ 移动文件失败: ${sourceFilePath} | 错误: ${moveErr.message}`)
                }
            },
            { concurrency: MAX_CONCURRENCY },
        )

        console.log("\n🎉 所有匹配文件处理完成！")
        process.exit(0)
    } catch (mainErr) {
        console.error(`\n❌ 执行出错: ${mainErr.message}`)
        process.exit(1)
    }
}

// ===================== 入口函数 =====================
/**
 * 脚本入口，处理命令行参数并启动主逻辑
 */
function scriptEntry() {
    // 配置命令行参数解析
    const argv = yargs(hideBin(process.argv))
        .usage("使用方法: $0 <dirA> <dirB> <deletedDir>")
        .example(
            "$0 ./dirA ./dirB ./deleted",
            "递归比对dirB与dirA的文件（双向兼容_thumb后缀），确认后移动到deleted目录并保留原结构",
        )
        .help("h")
        .alias("h", "help")
        .showHelpOnFail(false)
        .parse()

    // 获取原始参数列表
    const cmdArgs = hideBin(process.argv)

    // 处理帮助请求或无参数
    if (cmdArgs.length === 0 || argv.help) {
        yargs(hideBin(process.argv)).showHelp()
        process.exit(0)
    }

    // 校验参数数量
    if (cmdArgs.length !== 3) {
        console.error("\n❌ 错误：必须提供且仅提供3个参数（目录A、目录B、deleted目录）\n")
        yargs(hideBin(process.argv)).showHelp()
        process.exit(1)
    }

    // 解构参数并校验非空
    const [dirA, dirB, deletedDir] = cmdArgs
    if (!dirA || !dirB || !deletedDir) {
        console.error("\n❌ 错误：参数不能为空字符串\n")
        yargs(hideBin(process.argv)).showHelp()
        process.exit(1)
    }

    // 启动主处理逻辑
    mainProcess(dirA, dirB, deletedDir)
}

// 启动脚本
scriptEntry()
