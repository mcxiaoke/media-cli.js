import path from "path"
import { CLEAN_REGEX } from "./config.js"

// 将清洗后的字符串转化为 32位 整数构成的定型数组
function stringToBigramHashes(str) {
    const cleanStr = str.toLowerCase().replace(CLEAN_REGEX, "").trim()
    if (cleanStr.length < 2) return new Uint32Array(0)

    const hashes = new Uint32Array(cleanStr.length - 1)
    for (let i = 0; i < cleanStr.length - 1; i++) {
        hashes[i] = (cleanStr.charCodeAt(i) << 16) | cleanStr.charCodeAt(i + 1)
    }
    return hashes.sort()
}

// 零内存分配的双指针交集算法
function calculateDice(arr1, arr2) {
    if (arr1.length === 0 || arr2.length === 0) return 0

    let matches = 0,
        i = 0,
        j = 0
    while (i < arr1.length && j < arr2.length) {
        if (arr1[i] === arr2[j]) {
            matches++
            i++
            j++
        } else if (arr1[i] < arr2[j]) {
            i++
        } else {
            j++
        }
    }
    return (2.0 * matches) / (arr1.length + arr2.length)
}

export function findSimilarFiles(filePaths, threshold) {
    console.log(`\n⚙️ [1/3] 正在提取文件名并计算特征哈希...`)
    const startTime = Date.now()

    const hashedFiles = filePaths.map((filePath) => {
        // 只取文件名进行比对（忽略路径和扩展名）
        const basename = path.parse(filePath).name
        return {
            fullPath: filePath,
            hashes: stringToBigramHashes(basename),
        }
    })

    console.log(`⚙️ [2/3] 特征计算完毕 (耗时 ${Date.now() - startTime}ms)。开始高强度两两比对...`)
    const compareStartTime = Date.now()
    const results = []
    let compareCount = 0
    const total = hashedFiles.length

    // 经典 O(N^2)/2 遍历
    for (let i = 0; i < total; i++) {
        const fileA = hashedFiles[i]
        if (fileA.hashes.length === 0) continue

        for (let j = i + 1; j < total; j++) {
            compareCount++
            const fileB = hashedFiles[j]
            if (fileB.hashes.length === 0) continue

            const score = calculateDice(fileA.hashes, fileB.hashes)

            if (score >= threshold) {
                results.push({
                    score: parseFloat(score.toFixed(4)),
                    file1: fileA.fullPath,
                    file2: fileB.fullPath,
                })
            }
        }
    }

    // 按相似度从高到低排序
    results.sort((a, b) => b.score - a.score)

    console.log(
        `⚙️ [3/3] 比对完成！共执行了 ${compareCount.toLocaleString()} 次计算 (耗时 ${Date.now() - compareStartTime}ms)。`,
    )
    return results
}
