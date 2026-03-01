const fs = require("fs/promises")
const path = require("path")

/**
 * 计算文件名的等效长度（中文=1，英文=0.5）
 * @param {string} fileName - 文件名
 * @returns {number} 等效长度
 */
function calculateFileNameLength(fileName) {
    let totalLength = 0
    // 遍历每个字符
    for (const char of fileName) {
        // 判断是否为中文字符（Unicode范围）
        if (/[\u4e00-\u9fa5]/.test(char)) {
            totalLength += 1 // 中文算1个
        } else {
            totalLength += 0.5 // 非中文算0.5个
        }
    }
    return totalLength
}

/**
 * 将指定目录下文件名超长的文件移动到目标目录
 * @param {string} inputDir - 输入目录路径
 * @param {string} outputDir - 输出目录路径
 * @param {number} maxLength - 文件名最大等效长度阈值，默认30
 */
async function moveLongNamedFiles(inputDir, outputDir, maxLength = 30) {
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
        try {
            await fs.access(resolvedOutputDir)
        } catch (err) {
            await fs.mkdir(resolvedOutputDir, { recursive: true })
            console.log(`已创建输出目录: ${resolvedOutputDir}`)
        }

        // 读取输入目录下的所有文件/目录
        const files = await fs.readdir(resolvedInputDir, { withFileTypes: true })

        // 统计移动的文件数量
        let movedCount = 0

        // 遍历所有文件项
        for (const file of files) {
            // 只处理文件，跳过目录
            if (file.isFile()) {
                const fileName = file.name
                // 计算文件名的等效长度
                const fileEffectiveLength = calculateFileNameLength(fileName)

                // 判断等效长度是否超过阈值
                if (fileEffectiveLength > maxLength) {
                    const oldPath = path.join(resolvedInputDir, fileName)
                    const newPath = path.join(resolvedOutputDir, fileName)

                    // 移动文件
                    await fs.rename(oldPath, newPath)
                    console.log(
                        `已移动: ${fileName} (等效长度: ${fileEffectiveLength.toFixed(1)}) -> ${resolvedOutputDir}`,
                    )
                    movedCount++
                }
            }
        }

        console.log(`\n操作完成！共移动 ${movedCount} 个文件`)
        return movedCount
    } catch (error) {
        console.error(`执行出错: ${error.message}`)
        process.exit(1)
    }
}

// 解析命令行参数
async function main() {
    // 获取命令行参数 (process.argv[0]是node路径, process.argv[1]是脚本路径)
    const args = process.argv.slice(2)

    // 参数校验
    if (args.length < 2) {
        console.error(
            "使用方法: node moveFiles.js <输入目录> <输出目录> [文件名最大等效长度(默认30)]",
        )
        console.error("说明: 中文算1个字符，英文/数字/符号算0.5个字符")
        console.error("示例: node moveFiles.js ./source ./target 30")
        process.exit(1)
    }

    // 解析参数
    const inputDir = args[0]
    const outputDir = args[1]
    const maxLength = args[2] ? parseFloat(args[2]) : 30

    // 验证长度参数是否为有效数字
    if (isNaN(maxLength) || maxLength <= 0) {
        console.error("错误: 文件名最大等效长度必须是大于0的数字（支持小数，如29.5）")
        process.exit(1)
    }

    // 执行移动操作
    await moveLongNamedFiles(inputDir, outputDir, maxLength)
}

// 启动脚本
main()
