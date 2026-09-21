import fs from "fs"
import { SIMILARITY_THRESHOLD } from "./config.js"
import { findSimilarFiles } from "./matcher.js"
import { scanAudioFiles } from "./scanner.js"

async function main() {
    const args = process.argv.slice(2)

    if (args.length === 0) {
        console.error("❌ 请提供至少一个包含音频文件的目录路径。")
        console.error('👉 用法示例: node index.js "D:\\Music" "E:\\Downloads\\Audio"')
        process.exit(1)
    }

    console.time("⏱️ 总执行耗时")
    try {
        console.log(`🚀 开始扫描 ${args.length} 个目录中的音频文件...`)
        const files = await scanAudioFiles(args)
        console.log(`✅ 扫盘结束，共找到 ${files.length.toLocaleString()} 个音频文件。`)

        if (files.length < 2) {
            console.log("⚠️ 文件数量少于 2 个，无需比对。")
            return
        }

        // 执行核心相似度对比算法
        const similarPairs = findSimilarFiles(files, SIMILARITY_THRESHOLD)

        console.log(`\n🎉 过滤后发现 ${similarPairs.length.toLocaleString()} 对相似音频文件！`)

        // 导出到 JSON 文件
        const reportPath = "./similarity_report.json"
        fs.writeFileSync(reportPath, JSON.stringify(similarPairs, null, 2), "utf-8")
        console.log(`📄 完整结果已保存至: ${reportPath} (可直接丢进编辑器查看)`)

        // 在终端预览相似度最高的前 5 条
        if (similarPairs.length > 0) {
            console.log("\n👀 预览前 5 对最相似的文件:")
            similarPairs.slice(0, 5).forEach((pair, idx) => {
                console.log(`\n[${idx + 1}] 相似度: ${(pair.score * 100).toFixed(1)}%`)
                console.log(`  ├─ ${pair.file1}`)
                console.log(`  └─ ${pair.file2}`)
            })
        }
    } catch (error) {
        console.error("❌ 程序执行出错:", error)
    }
    console.log("\n----------------------------------------")
    console.timeEnd("⏱️ 总执行耗时")
}

main()
