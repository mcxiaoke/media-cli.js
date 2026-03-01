import { promises as fs } from "fs"
import * as mm from "music-metadata"
import os from "os"
import pMap from "p-map"
import path from "path"
import { open } from "sqlite"
import sqlite3 from "sqlite3"

// 配置
const SUPPORTED_EXTS = new Set([".mp3", ".flac", ".m4a", ".wav", ".ogg", ".wma"])
const CONCURRENCY = os.cpus().length * 2

/**
 * 健壮的异步移动函数
 * 优先使用 rename (秒切)，失败则降级为 copy + unlink (跨分区)
 */
async function moveFile(src, dest) {
    try {
        await fs.rename(src, dest)
    } catch (err) {
        if (err.code === "EXDEV") {
            await fs.copyFile(src, dest)
            await fs.unlink(src)
        } else {
            throw err
        }
    }
}

/** 递归获取文件 (异步生成器) */
async function* walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
        const res = path.resolve(dir, entry.name)
        if (entry.isDirectory()) {
            yield* walk(res)
        } else if (SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) {
            yield res
        }
    }
}

async function initDb(dbPath) {
    const db = await open({ filename: dbPath, driver: sqlite3.Database })
    await db.exec(`
        CREATE TABLE IF NOT EXISTS music_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT,
            filename TEXT,
            size INTEGER,
            artist TEXT,
            title TEXT,
            has_missing INTEGER,
            UNIQUE(filename, size)
        )
    `)
    return db
}

async function main() {
    const args = process.argv.slice(2)
    const isMoveMode = args.includes("--move")
    const dirs = args.filter((arg) => !arg.startsWith("--"))
    const [inputDir, outputDir] = dirs

    if (!inputDir || !outputDir) {
        console.log("❌ 参数缺失！用法: node scan_music.mjs <输入目录> <输出目录> [--move]")
        return
    }

    await fs.mkdir(outputDir, { recursive: true })
    const db = await initDb(path.join(outputDir, "music_tags.db"))
    const moveDir = path.join(outputDir, "missing_files")
    if (isMoveMode) await fs.mkdir(moveDir, { recursive: true })

    console.log(`📂 正在扫描目录结构...`)
    const allFiles = []
    for await (const f of walk(inputDir)) allFiles.push(f)

    const total = allFiles.length
    let processed = 0,
        skipped = 0,
        missingCount = 0
    const startTime = Date.now()

    console.log(`📊 准备处理 ${total} 个文件 (并发: ${CONCURRENCY})...\n`)

    await pMap(
        allFiles,
        async (filePath) => {
            try {
                const stats = await fs.stat(filePath)
                const filename = path.basename(filePath)
                const size = stats.size

                // 1. 数据库增量检查
                let cached = await db.get(
                    "SELECT has_missing FROM music_cache WHERE filename = ? AND size = ?",
                    [filename, size],
                )

                let isMissing = 0
                if (cached) {
                    skipped++
                    isMissing = cached.has_missing
                } else {
                    // 2. 解析元数据
                    const metadata = await mm.parseFile(filePath)
                    const artist = (metadata.common.artist || "").trim()
                    const title = (metadata.common.title || "").trim()

                    /** * 🔍 改进的缺失判定条件：
                     * 1. 为空或全是空格
                     * 2. 包含常见的“未知”占位符
                     */
                    const isInvalid = (str) => {
                        const s = str.toLowerCase()
                        return !s || s === "unknown" || s === "unknown artist" || s === "null"
                    }

                    isMissing = isInvalid(artist) || isInvalid(title) ? 1 : 0

                    await db.run(
                        `INSERT INTO music_cache (file_path, filename, size, artist, title, has_missing) 
                     VALUES (?, ?, ?, ?, ?, ?)`,
                        [filePath, filename, size, artist, title, isMissing],
                    )
                }

                // 3. 执行移动逻辑 (只有在 --move 模式且标签缺失时)
                if (isMissing && isMoveMode) {
                    missingCount++
                    const dest = path.join(moveDir, filename)
                    // 检查目标文件是否已存在，防止重名覆盖
                    try {
                        await fs.access(dest)
                        const ext = path.extname(filename)
                        const base = path.basename(filename, ext)
                        const newDest = path.join(moveDir, `${base}_${Date.now()}${ext}`)
                        await moveFile(filePath, newDest)
                    } catch {
                        await moveFile(filePath, dest)
                    }
                } else if (isMissing) {
                    missingCount++
                }
            } catch (err) {
                // 记录错误但不中断
            } finally {
                processed++
                if (processed % 50 === 0 || processed === total) {
                    const elapsed = (Date.now() - startTime) / 1000
                    const speed = (processed / elapsed).toFixed(1)
                    process.stdout.write(
                        `\r🚀 进度: ${((processed / total) * 100).toFixed(1)}% | 缺失: ${missingCount} | 跳过: ${skipped} | 速度: ${speed} f/s`,
                    )
                }
            }
        },
        { concurrency: CONCURRENCY },
    )

    // 导出报告
    const missingRows = await db.all("SELECT file_path FROM music_cache WHERE has_missing = 1")
    await fs.writeFile(
        path.join(outputDir, "missing_tags.txt"),
        missingRows.map((r) => r.file_path).join("\n"),
    )

    await db.close()
    console.log(`\n\n✨ 处理完毕！缺失项已${isMoveMode ? "移动至" : "记录在"}: ${outputDir}`)
}

main().catch(console.error)
