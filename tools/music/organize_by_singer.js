import fs from "fs/promises"
import path from "path"

// ====================== 配置常量 ======================
// 【可自行修改】输出目录（改为常量，不再通过命令行传入）
const OUTPUT_DIR = "C:\\Home\\音乐\\歌手分类20"
// 【可自行修改】触发创建独立文件夹的最小歌曲数
const MIN_SONGS = 20
// 支持的音频格式后缀
const AUDIO_EXTS = new Set([".mp3", ".flac", ".m4a", ".wav", ".ape", ".ogg"])
// 支持的分隔符（@ 或 -）
const SEPARATORS = ["@", "-"]

// ====================== 工具函数 ======================
/**
 * 从文件名中提取歌手名（支持@或-分隔）
 * @param {string} fileName 文件名
 * @returns {string|null} 歌手名（提取失败返回null）
 */
function extractSingerName(fileName) {
    // 找到第一个匹配的分隔符
    let separator = null
    for (const sep of SEPARATORS) {
        if (fileName.includes(sep)) {
            separator = sep
            break
        }
    }

    if (!separator) return null

    // 按分隔符切分，提取前面的部分作为歌手名，并去除首尾空格
    const singer = fileName.split(separator)[0].trim()
    return singer ? singer : null
}

/**
 * 递归扫描单个目录下的所有音频文件，并按歌手分组
 * @param {string} dir 要扫描的目录
 * @param {Map} singerMap 全局歌手-文件映射表
 */
async function scanDirectory(dir, singerMap) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
                // 递归扫描子目录
                await scanDirectory(fullPath, singerMap)
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase()
                if (AUDIO_EXTS.has(ext)) {
                    // 提取歌手名
                    const singer = extractSingerName(entry.name)
                    if (singer) {
                        if (!singerMap.has(singer)) {
                            singerMap.set(singer, [])
                        }
                        // 存储文件的完整路径，方便后续移动
                        singerMap.get(singer).push(fullPath)
                    }
                }
            }
        }
    } catch (err) {
        console.error(`❌ 扫描目录失败: ${dir} (原因: ${err.message})`)
    }
}

/**
 * 移动文件（跨分区自动复制后删除原文件）
 * @param {string} srcPath 源文件路径
 * @param {string} destPath 目标文件路径
 * @returns {boolean} 是否移动成功
 */
async function moveFile(srcPath, destPath) {
    try {
        // 先检查目标文件是否已存在，存在则跳过
        try {
            await fs.access(destPath)
            console.log(`   ⏭️ 跳过: ${path.basename(destPath)} (目标已存在)`)
            return false
        } catch {
            // 目标文件不存在，继续移动
        }

        // 尝试直接重命名（同盘极速移动）
        await fs.rename(srcPath, destPath)
        return true
    } catch (err) {
        // EXDEV 错误：输入和输出不在同一个硬盘分区，改为复制后删除
        if (err.code === "EXDEV") {
            try {
                await fs.copyFile(srcPath, destPath)
                await fs.unlink(srcPath)
                return true
            } catch (copyErr) {
                console.error(
                    `   ❌ 复制失败: ${path.basename(srcPath)} (原因: ${copyErr.message})`,
                )
                return false
            }
        } else {
            console.error(`   ❌ 移动失败: ${path.basename(srcPath)} (原因: ${err.message})`)
            return false
        }
    }
}

// ====================== 主函数 ======================
async function main() {
    // 获取命令行参数（多个输入目录）
    const inputDirs = process.argv.slice(2)

    // 参数校验
    if (!inputDirs.length) {
        console.log("❌ 参数缺失！")
        console.log("💡 用法: node organize.js <输入目录1> [输入目录2] [输入目录3] ...")
        console.log('   例如: node organize.js "D:\\杂乱音乐1" "D:\\杂乱音乐2"')
        process.exit(1)
    }

    // 打印任务信息
    console.log(`🚀 启动音乐自动分类归档任务...`)
    console.log(`📂 输入目录列表: ${inputDirs.join("、")}`)
    console.log(`📁 输出目录: ${OUTPUT_DIR}`)
    console.log(`📌 阈值: 歌曲数≥${MIN_SONGS} 才创建歌手文件夹\n`)

    // 检查所有输入目录是否存在
    for (const dir of inputDirs) {
        try {
            const stat = await fs.stat(dir)
            if (!stat.isDirectory()) {
                console.error(`❌ 输入目录不是有效的文件夹: ${dir}`)
                process.exit(1)
            }
        } catch {
            console.error(`❌ 输入目录不存在: ${dir}`)
            process.exit(1)
        }
    }

    // 确保输出目录存在
    await fs.mkdir(OUTPUT_DIR, { recursive: true })

    // 核心数据结构：按歌手分组映射表 Map<歌手名, 文件完整路径数组>
    const singerMap = new Map()

    // 扫描所有输入目录的音频文件
    console.log(`📡 正在扫描所有目录的音频文件...`)
    for (const dir of inputDirs) {
        await scanDirectory(dir, singerMap)
    }
    console.log(`📊 扫描完成！共发现 ${singerMap.size} 位独立歌手。\n`)

    // 统计变量
    let movedFilesCount = 0
    let eligibleSingersCount = 0
    let skippedSingersCount = 0

    // 执行移动和创建文件夹的逻辑
    for (const [singer, songPaths] of singerMap.entries()) {
        if (songPaths.length >= MIN_SONGS) {
            console.log(`🎵 [达标] ${singer} (共 ${songPaths.length} 首) -> 正在归档...`)
            eligibleSingersCount++

            // 创建歌手专属目录
            const singerDir = path.join(OUTPUT_DIR, singer)
            await fs.mkdir(singerDir, { recursive: true })

            // 移动该歌手的所有歌曲
            for (const srcPath of songPaths) {
                const fileName = path.basename(srcPath)
                const destPath = path.join(singerDir, fileName)

                const isMoved = await moveFile(srcPath, destPath)
                if (isMoved) {
                    movedFilesCount++
                }
            }
        } else {
            skippedSingersCount++
        }
    }

    // 打印最终报告
    console.log(`\n🎉 整理归档完成！`)
    console.log(`✅ 成功为 ${eligibleSingersCount} 位歌手创建了独立文件夹。`)
    console.log(`📦 共计移动了 ${movedFilesCount} 首歌曲（重名文件已跳过）。`)
    console.log(`⏭️ 跳过了 ${skippedSingersCount} 位歌曲数量不足 ${MIN_SONGS} 首的歌手。`)
}

// 启动执行
main().catch((err) => {
    console.error(`💥 发生致命错误: ${err.message}`)
    process.exit(1)
})
