import { promises as fs } from "fs"
import os from "os"
import pMap from "p-map"
import path from "path"

// 支持的音频扩展名
const SUPPORTED_EXTS = new Set([".mp3", ".flac", ".m4a", ".wav", ".ogg", ".wma", ".aac"])
const CONCURRENCY = os.cpus().length * 2

/**
 * 递归获取目录下所有的音频文件 (全异步生成器)
 */
async function* walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        const fullPath = path.resolve(dir, entry.name)
        if (entry.isDirectory()) {
            yield* walk(fullPath)
        } else if (SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) {
            yield fullPath
        }
    }
}

/**
 * 解析歌手名单 TXT，支持空格或换行符分隔
 */
async function loadTargetArtists(txtPath) {
    const content = await fs.readFile(txtPath, "utf8")
    // 按空白字符（空格、换行、Tab）分割，过滤空行，存入 Set 以实现 O(1) 极速查找
    const artistsArray = content.split(/\s+/).filter(Boolean)
    return new Set(artistsArray)
}

async function main() {
    // 解析命令行参数
    const args = process.argv.slice(2)
    if (args.length < 3) {
        console.log(
            "❌ 参数不足！\n用法: node extract_by_artist.mjs <输入目录> <输出目录> <歌手名单.txt>",
        )
        return
    }

    const [inputDir, outputDir, artistTxt] = args

    // 1. 加载目标歌手名单
    let targetArtists
    try {
        targetArtists = await loadTargetArtists(artistTxt)
        console.log(`📜 成功加载歌手名单，共包含 ${targetArtists.size} 位歌手。`)
    } catch (err) {
        console.error(`❌ 无法读取歌手名单 TXT: ${err.message}`)
        return
    }

    // 2. 确保输出目录存在
    await fs.mkdir(outputDir, { recursive: true })

    console.log(`📂 正在扫描输入目录...`)
    const allFiles = []
    for await (const f of walk(inputDir)) {
        allFiles.push(f)
    }
    const total = allFiles.length
    console.log(`📊 共找到 ${total} 个音频文件，开始并发匹配提取 (并发度: ${CONCURRENCY})...\n`)

    let processed = 0
    let matchedCount = 0
    const startTime = Date.now()

    // 3. 并发处理文件
    await pMap(
        allFiles,
        async (filePath) => {
            try {
                const filename = path.basename(filePath)

                // 正则匹配：提取开头直到第一个 '@' 或 '-' 之前的内容
                // 例如: "费玉清&邓妙华 @ -珍借.m4a" -> "费玉清&邓妙华 "
                const match = filename.match(/^(.+?)\s*(?:@|-)\s*/)

                if (match) {
                    const artistString = match[1].trim()

                    // 处理多人合唱的情况 (按 &、逗号、顿号拆分)
                    const fileArtists = artistString.split(/[&,，、]/).map((a) => a.trim())

                    // 只要文件包含名单中的任意一位歌手，就判定为匹配
                    const isMatch = fileArtists.some((artist) => targetArtists.has(artist))

                    if (isMatch) {
                        matchedCount++
                        const destPath = path.join(outputDir, filename)

                        // 异步复制文件。如果目标已存在会直接覆盖，如需防冲突可加逻辑
                        await fs.copyFile(filePath, destPath)
                    }
                }
            } catch (err) {
                // 忽略个别文件的读取/复制错误
            } finally {
                processed++
                // 实时进度显示
                if (processed % 100 === 0 || processed === total) {
                    const percent = ((processed / total) * 100).toFixed(1)
                    process.stdout.write(
                        `\r🚀 进度: ${percent}% | 已扫描: ${processed}/${total} | 成功提取: ${matchedCount} 首`,
                    )
                }
            }
        },
        { concurrency: CONCURRENCY },
    )

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log(`\n\n✨ 提取完成！`)
    console.log(`⏱️ 耗时: ${elapsed} 秒`)
    console.log(`✅ 共复制了 ${matchedCount} 首歌曲到: ${outputDir}`)
}

main().catch((err) => console.error("🔴 运行时错误:", err))
