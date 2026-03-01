import fs from "fs/promises"
import path, { dirname } from "path"
import { fileURLToPath } from "url"

// 解决 ES Module 中 __dirname 缺失的问题
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 定义支持的音频文件后缀（可根据需要扩展）
const AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".wma"])

/**
 * 递归遍历目录，获取所有音频文件的完整路径
 * @param {string} dir - 要遍历的目录
 * @returns {Array<string>} 所有音频文件的完整路径数组
 */
async function getAllAudioFiles(dir) {
    let audioFiles = []
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = path.resolve(dir, entry.name)
        if (entry.isDirectory()) {
            // 递归遍历子目录
            const subDirAudioFiles = await getAllAudioFiles(fullPath)
            audioFiles = audioFiles.concat(subDirAudioFiles)
        } else if (entry.isFile()) {
            // 筛选音频文件
            const ext = path.extname(entry.name).toLowerCase()
            if (AUDIO_EXTENSIONS.has(ext)) {
                audioFiles.push(fullPath)
            }
        }
    }
    return audioFiles
}

/**
 * 从文件名中提取歌手名
 * 匹配规则：文件名中 @ 或 - 前的部分作为歌手名（去空格、去特殊字符）
 * @param {string} fileName - 文件名（不含路径）
 * @returns {string|null} 提取的歌手名，提取失败返回null
 */
function extractSingerFromFileName(fileName) {
    // 先去掉文件后缀
    const nameWithoutExt = path.basename(fileName, path.extname(fileName))

    // 正则匹配：匹配 @ 或 - 分隔符前的歌手名（支持前后空格）
    // 匹配组：捕获分隔符前的非空字符（排除纯空格）
    const regex = /^([^@-]+?)\s*[@-]\s*.+/
    const match = nameWithoutExt.match(regex)

    if (match && match[1]) {
        // 清洗歌手名：去首尾空格、去全角/半角空格、去特殊符号（保留中文/英文/数字）
        let singer = match[1]
            .trim()
            .replace(/\s+/g, "") // 去掉所有空格（包括全角）
            .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "") // 只保留中文、英文、数字

        // 过滤空字符串
        return singer.length > 0 ? singer : null
    }
    return null
}

/**
 * 主逻辑：提取歌手名并生成txt文件
 * @param {string} inputDir - 输入目录（存放音频文件）
 * @param {string} outputDir - 输出目录（存放歌手名单txt）
 */
async function generateSingerList(inputDir, outputDir) {
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

        // 确保输出目录存在，不存在则创建
        await fs.mkdir(resolvedOutputDir, { recursive: true })
        console.log(`输出目录已准备好: ${resolvedOutputDir}`)

        // 1. 获取所有音频文件
        const audioFiles = await getAllAudioFiles(resolvedInputDir)
        if (audioFiles.length === 0) {
            console.warn("⚠️  未在输入目录中找到任何音频文件")
            return
        }
        console.log(`找到 ${audioFiles.length} 个音频文件，开始提取歌手名...`)

        // 2. 提取歌手名并去重
        const singerSet = new Set()
        const failedFiles = [] // 记录提取失败的文件

        for (const filePath of audioFiles) {
            const fileName = path.basename(filePath)
            const singer = extractSingerFromFileName(fileName)

            if (singer) {
                singerSet.add(singer)
            } else {
                failedFiles.push(fileName)
            }
        }

        // 3. 转换为排序后的数组（提升可读性）
        const singerList = Array.from(singerSet).sort((a, b) => {
            // 中文按拼音排序（Node.js 内置支持）
            return a.localeCompare(b, "zh-CN")
        })

        // 4. 写入txt文件
        const txtFilePath = path.join(resolvedOutputDir, "歌手名单.txt")
        const txtContent = singerList.join("\n")
        await fs.writeFile(txtFilePath, txtContent, "utf8")

        // 5. 输出统计信息
        console.log(`
=== 提取完成 ===
✅ 成功提取歌手数: ${singerList.length} 个
📝 歌手名单已保存至: ${txtFilePath}
⚠️  提取失败的文件数: ${failedFiles.length} 个
        `)

        // 可选：打印提取失败的文件（方便排查）
        if (failedFiles.length > 0) {
            console.log("提取失败的文件（文件名格式不匹配）：")
            failedFiles.forEach((file) => console.log(`- ${file}`))
        }
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
        console.error("使用方法: node extractSingerNames.mjs <输入目录> <输出目录>")
        console.error("示例: node extractSingerNames.mjs ./audio ./output")
        process.exit(1)
    }

    const [inputDir, outputDir] = args
    await generateSingerList(inputDir, outputDir)
}

// 启动脚本
main()
