import fs from "fs"
import path from "path"

// ---------------------------------------------------------
// 核心逻辑 1：获取分隔符（- 或 @）前面的字符串长度
// ---------------------------------------------------------
function getPrefixLength(filename) {
    // 匹配第一个 - 或 @
    const match = filename.match(/[-@]/)
    if (match) {
        // 截取前面的部分并去掉两端空格，返回长度
        return filename.substring(0, match.index).trim().length
    }
    // 如果没有分隔符，默认返回整个文件名的长度
    return filename.length
}

// ---------------------------------------------------------
// 核心逻辑 2：根据你的规则，决定把哪一个文件当作“垃圾”移走
// ---------------------------------------------------------
function determineFileToMove(file1, file2) {
    // 只比较文件名部分，不包含前面的目录路径
    const name1 = path.basename(file1)
    const name2 = path.basename(file2)

    // 规则 1：优先移动文件名更短的
    if (name1.length !== name2.length) {
        return name1.length < name2.length ? file1 : file2
    }

    // 规则 2：如果一样长，移动分隔符（- 或 @）前面短于后面的
    const prefixLen1 = getPrefixLength(name1)
    const prefixLen2 = getPrefixLength(name2)

    if (prefixLen1 !== prefixLen2) {
        return prefixLen1 > prefixLen2 ? file1 : file2
    }

    // 兜底规则：如果长度和前缀都一模一样，默认将第二个文件移走
    return file2
}

// ---------------------------------------------------------
// 核心逻辑 3：安全移动文件（处理跨盘移动和同名冲突）
// ---------------------------------------------------------
function safeMoveFile(srcPath, destDir) {
    const filename = path.basename(srcPath)
    let destPath = path.join(destDir, filename)

    // 防冲突：如果回收站里已经有同名文件，自动追加数字后缀
    let counter = 1
    while (fs.existsSync(destPath)) {
        const ext = path.extname(filename)
        const base = path.basename(filename, ext)
        destPath = path.join(destDir, `${base}_${counter}${ext}`)
        counter++
    }

    try {
        // 尝试快速重命名（仅限同盘有效）
        fs.renameSync(srcPath, destPath)
    } catch (err) {
        // EXDEV 代表跨盘移动，必须先复制再删除
        if (err.code === "EXDEV") {
            fs.copyFileSync(srcPath, destPath)
            fs.unlinkSync(srcPath)
        } else {
            throw err
        }
    }
    return destPath
}

// ---------------------------------------------------------
// 主程序入口
// ---------------------------------------------------------
async function main() {
    const args = process.argv.slice(2)

    if (args.length < 2) {
        console.error("❌ 参数不足！")
        console.error('👉 用法示例: node mover.js ./similarity_report.json "E:\\Audio_Trash"')
        process.exit(1)
    }

    const reportPath = path.resolve(args[0])
    const trashDir = path.resolve(args[1])

    if (!fs.existsSync(reportPath)) {
        console.error(`❌ 找不到报告文件: ${reportPath}`)
        process.exit(1)
    }

    // 如果目标回收站目录不存在，递归创建它
    if (!fs.existsSync(trashDir)) {
        fs.mkdirSync(trashDir, { recursive: true })
        console.log(`📁 创建了目标目录: ${trashDir}`)
    }

    console.log("📖 正在读取并解析报告...")
    const reportData = JSON.parse(fs.readFileSync(reportPath, "utf-8"))

    let movedCount = 0
    let skippedCount = 0

    // 记录已经处理过的文件，防止一个文件在报告里出现多次导致重复移动报错
    const processedFiles = new Set()

    console.log(`🚀 开始处理 ${reportData.length} 对相似记录...\n`)

    for (const pair of reportData) {
        const { file1, file2, score } = pair

        // 【安全防线】：只处理相似度 100% 的记录
        // 如果你需要处理更低相似度的文件，可以注释掉这部分，但我强烈建议你人工核对后再批量执行
        if (score > 1.0) {
            skippedCount++
            continue
        }

        // 如果其中一个文件之前已经被移走了，直接跳过
        if (!fs.existsSync(file1) || !fs.existsSync(file2)) {
            continue
        }

        // 决策谁该被移走
        const fileToMove = determineFileToMove(file1, file2)
        const fileToKeep = fileToMove === file1 ? file2 : file1

        try {
            const finalDest = safeMoveFile(fileToMove, trashDir)
            movedCount++
            console.log(`✅ [移走] ${path.basename(fileToMove)}`)
            console.log(`   [保留] ${path.basename(fileToKeep)}\n`)
        } catch (error) {
            console.error(`❌ 移动文件失败: ${fileToMove}`)
            console.error(error)
        }
    }

    console.log("----------------------------------------")
    console.log(`🎉 任务完成！`)
    console.log(`🗑️  成功移走: ${movedCount} 个文件`)
    console.log(`⏭️  跳过(相似度未达100%): ${skippedCount} 对`)
}

main()
