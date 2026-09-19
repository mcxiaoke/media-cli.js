import { execa } from "execa"
import fs from "fs-extra"
import pMap from "p-map"
import path from "path"
import { fileURLToPath } from "url"

// ========== 1. 基础配置（重点改这里！） ==========
const CONFIG = {
    // 【必改】vips.exe的实际路径（复制你电脑里的vips.exe路径）
    vipsPath: "vips.exe",
    // 缩放配置（不用改）
    size: {
        type: "down", // 仅缩小不放大
        dimension: 3000, // 最大尺寸3000px
    },
    outputDir: "./quality-test", // 输出目录（不用改）
    // Q值配置（不用改）
    quality: {
        heic: [40, 45, 50, 55, 60, 65, 70, 75, 80],
        jpg: [50, 55, 60, 65, 70, 75, 80, 85, 90],
    },
    concurrency: 4, // 4线程（不用改）
}

// ========== 2. 工具函数（不用改） ==========
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function calcRelativePercent(fileSize, originalSize) {
    if (originalSize === 0 || fileSize === 0) return "——"
    const percent = (fileSize / originalSize) * 100
    return `${percent.toFixed(2)}%`
}

function getBaseFileName(filePath) {
    const fileName = path.basename(filePath)
    const ext = path.extname(fileName)
    return fileName.replace(ext, "")
}

// ========== 3. 单个图片处理任务（不用改） ==========
async function processImageTask(task) {
    const { inputFile, outputFile, q, type } = task
    let commandArgs
    let outputPathWithParams = outputFile

    try {
        if (type === "JPG") {
            outputPathWithParams = `${outputFile}[Q=${q}]`
        } else if (type === "HEIC") {
            outputPathWithParams = `${outputFile}[Q=${q}]`
        }

        commandArgs = [
            "thumbnail",
            inputFile,
            outputPathWithParams,
            "--size",
            CONFIG.size.type,
            CONFIG.size.dimension.toString(),
        ]

        console.log(`🔧 处理 [${type} Q${q}] - ${path.basename(outputFile)}`)
        await execa(CONFIG.vipsPath, commandArgs, {
            stdio: "pipe",
            windowsHide: true,
        })

        if (!(await fs.pathExists(outputFile))) throw new Error("文件未生成")
        const stat = await fs.stat(outputFile)
        const size = formatFileSize(stat.size)

        console.log(`✅ 完成 [${type} Q${q}] - ${size}`)
        return {
            path: outputFile,
            fileName: path.basename(outputFile),
            type,
            q,
            rawSize: stat.size,
            size,
        }
    } catch (error) {
        console.error(`❌ 失败 [${type} Q${q}] - ${error.message}`)
        return {
            path: outputFile,
            fileName: path.basename(outputFile),
            type,
            q,
            rawSize: 0,
            size: "处理失败",
        }
    }
}

// ========== 4. 主流程（不用改） ==========
async function generateTestFiles(inputFile) {
    const absInputFile = path.resolve(inputFile)
    if (!(await fs.pathExists(absInputFile))) throw new Error(`源文件不存在: ${absInputFile}`)

    const originalStat = await fs.stat(absInputFile)
    const originalSize = originalStat.size
    const baseFileName = getBaseFileName(absInputFile)

    await fs.ensureDir(CONFIG.outputDir)
    console.log(`📁 输出目录: ${path.resolve(CONFIG.outputDir)}`)

    const tasks = []
    // JPG任务
    for (const q of CONFIG.quality.jpg) {
        tasks.push({
            inputFile: absInputFile,
            outputFile: path.join(CONFIG.outputDir, `${baseFileName}_jpg_q${q}.jpg`),
            q,
            type: "JPG",
        })
    }
    // HEIC任务
    for (const q of CONFIG.quality.heic) {
        tasks.push({
            inputFile: absInputFile,
            outputFile: path.join(CONFIG.outputDir, `${baseFileName}_heic_q${q}.heic`),
            q,
            type: "HEIC",
        })
    }

    console.log(`\n🚀 开始处理 ${tasks.length} 个任务（4线程）`)
    const allResults = await pMap(tasks, processImageTask, { concurrency: 4, stopOnError: false })

    // 加入原始文件对比
    const resultsWithOriginal = [
        {
            path: absInputFile,
            fileName: `[SRC] ${path.basename(absInputFile)}`,
            type: "SRC",
            q: "—",
            rawSize: originalSize,
            size: formatFileSize(originalSize),
        },
        ...allResults,
    ]

    // 排序输出
    const sortedResults = resultsWithOriginal.sort((a, b) => {
        if (a.rawSize === 0) return 1
        if (b.rawSize === 0) return -1
        return a.rawSize - b.rawSize
    })

    console.log("\n📊 结果汇总（按大小排序）:")
    console.log(
        "┌─────────┬─────┬──────────────────────────────┬───────────────────────┬───────────┐",
    )
    console.log(
        "│ 格式    │ Q值 │ 文件名                       │ 文件大小              │ 相对原始文件 │",
    )
    console.log(
        "├─────────┼─────┼──────────────────────────────┼───────────────────────┼───────────┤",
    )
    sortedResults.forEach((item) => {
        const typeStr = item.type.padEnd(7, " ")
        const qStr = item.q.toString().padStart(3, " ")
        const fileNameStr = item.fileName.padEnd(30, " ").slice(0, 30)
        const sizeStr = item.size.padStart(17, " ")
        const percentStr = calcRelativePercent(item.rawSize, originalSize).padStart(9, " ")
        console.log(`│ ${typeStr} │ ${qStr} │ ${fileNameStr} │ ${sizeStr} │ ${percentStr} │`)
    })
    console.log(
        "└─────────┴─────┴──────────────────────────────┴───────────────────────┴───────────┘",
    )

    console.log(`\n🎉 完成！文件在: ${path.resolve(CONFIG.outputDir)}`)
}

// ========== 5. 入口函数（不用改） ==========
async function main() {
    try {
        const inputFile = process.argv[2]
        if (!inputFile) throw new Error("请指定源文件，比如：node vipstest.mjs ./test.HEIC")

        // 检查依赖
        await Promise.all([import("p-map"), import("execa"), import("fs-extra")])

        // 检查vips是否能调用（替代文件存在性检查，更实用）
        try {
            await execa(CONFIG.vipsPath, ["--version"])
        } catch (e) {
            throw new Error(`无法调用vips.exe`, { cause: e })
        }

        await generateTestFiles(inputFile)
    } catch (error) {
        console.error("\n❌ 执行失败:", error.message)
        process.exit(1)
    }
}

main()
