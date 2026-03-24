/*
 * Project: mediacli.js
 * Created: 2026-03-24
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * 模块：图像哈希与质量评估算法
 *
 * 功能描述：
 * 提供图像相似度检测（哈希算法）和图像质量评估功能。
 * 主要用于照片去重和智能选择。
 *
 * 包含算法：
 * 1. 平均哈希 - 快速筛选
 * 2. 感知哈希 - 精确匹配
 * 3. 图像质量评估 (对比度 + 清晰度)
 * 4. 事件聚类
 */

import crypto from "crypto"
import fs from "fs-extra"
import path from "path"
import pMap from "p-map"
import sharp from "sharp"
import * as log from "./debug.js"

/**
 * 缓存版本号 - 配置变更时需要更新
 */
const CACHE_VERSION = 1

/**
 * 缓存配置
 */
export const CACHE_CONFIG = {
    VERSION: CACHE_VERSION,
    FILENAME: "pick_cache.json",
    MAX_AGE_DAYS: 30,
}

/**
 * 图像特征缓存结构
 *
 * 缓存文件格式：
 * {
 *   version: 1,
 *   createdAt: "2026-03-24T...",
 *   rootHash: "sha256 of root path",
 *   config: { ahashSize, phashSize, sampleSize },
 *   entries: {
 *     "relative/path.jpg": {
 *       mtime: 1234567890,
 *       size: 1234567,
 *       aHash: "abc123",
 *       pHash: "def456",
 *       quality: { score, contrast, sharpness }
 *     }
 *   }
 * }
 */

/**
 * 计算路径哈希（用于区分不同的照片库）
 *
 * @param {string} rootPath - 根目录路径
 * @returns {string} 哈希值
 */
function computeRootHash(rootPath) {
    return crypto.createHash("sha256").update(rootPath).digest("hex").slice(0, 16)
}

/**
 * 加载缓存文件
 *
 * @param {string} cachePath - 缓存文件路径
 * @param {string} rootPath - 根目录路径（用于验证）
 * @returns {Object|null} 缓存数据或 null
 */
export async function loadHashCache(cachePath, rootPath) {
    try {
        if (!(await fs.pathExists(cachePath))) {
            return null
        }

        const data = await fs.readJson(cachePath)

        if (data.version !== CACHE_VERSION) {
            log.debug(`Cache version mismatch: ${data.version} vs ${CACHE_VERSION}`)
            return null
        }

        const rootHash = computeRootHash(rootPath)
        if (data.rootHash !== rootHash) {
            log.debug(`Cache root hash mismatch`)
            return null
        }

        log.info(`Loaded cache: ${Object.keys(data.entries || {}).length} entries`)
        return data
    } catch (e) {
        log.debug(`Failed to load cache: ${e.message}`)
        return null
    }
}

/**
 * 保存缓存文件
 *
 * @param {string} cachePath - 缓存文件路径
 * @param {string} rootPath - 根目录路径
 * @param {Object} entries - 缓存条目
 * @param {Object} config - 配置参数
 */
export async function saveHashCache(cachePath, rootPath, entries, config = {}) {
    try {
        const data = {
            version: CACHE_VERSION,
            createdAt: new Date().toISOString(),
            rootHash: computeRootHash(rootPath),
            config: {
                ahashSize: config.ahashSize || HASH_CONFIG.AHASH_SIZE,
                phashSize: config.phashSize || HASH_CONFIG.PHASH_SIZE,
                sampleSize: config.sampleSize || QUALITY_CONFIG.SAMPLE_SIZE,
            },
            entries: entries,
        }

        await fs.ensureDir(path.dirname(cachePath))
        await fs.writeJson(cachePath, data, { spaces: 2 })

        log.info(`Saved cache: ${Object.keys(entries).length} entries to ${cachePath}`)
    } catch (e) {
        log.warn(`Failed to save cache: ${e.message}`)
    }
}

/**
 * 检查缓存条目是否有效
 *
 * @param {Object} cached - 缓存条目
 * @param {Object} file - 文件信息 { mtime, size }
 * @returns {boolean} 是否有效
 */
function isCacheValid(cached, file) {
    if (!cached) return false
    if (cached.mtime !== file.mtime) return false
    if (cached.size !== file.size) return false
    return true
}

/**
 * 批量计算图像特征（带缓存）
 *
 * @param {Array} files - 文件列表
 * @param {Object} cache - 缓存数据
 * @param {string} rootPath - 根目录路径
 * @param {Object} options - 配置选项
 * @returns {Object} { hashResults, qualityScores, cacheUpdated }
 */
export async function computeImageFeaturesWithCache(files, cache, rootPath, options = {}) {
    const hashResults = []
    const qualityScores = new Map()
    const cacheEntries = cache?.entries || {}
    const updatedEntries = {}
    let cacheHits = 0
    let cacheMisses = 0

    const concurrency = options.concurrency || HASH_CONFIG.PARALLEL

    await pMap(
        files,
        async (f) => {
            const relPath = path.relative(rootPath, f.path)
            const cached = cacheEntries[relPath]
            const fileInfo = {
                mtime: f.mtime || (f.stats && f.stats.mtime && Math.floor(f.stats.mtime.getTime() / 1000)) || 0,
                size: f.size || 0,
            }

            let result = null

            if (isCacheValid(cached, fileInfo)) {
                cacheHits++
                result = {
                    file: f,
                    aHash: cached.aHash,
                    pHash: cached.pHash,
                    quality: cached.quality,
                }
                updatedEntries[relPath] = cached
            } else {
                cacheMisses++
                const [aHash, pHash, quality] = await Promise.all([
                    computeAverageHash(f.path, options),
                    computePerceptualHash(f.path, options),
                    calculateImageQualityScore(f.path, options.qualityConfig || QUALITY_CONFIG),
                ])

                result = {
                    file: f,
                    aHash,
                    pHash,
                    quality,
                }

                if (pHash) {
                    updatedEntries[relPath] = {
                        mtime: fileInfo.mtime,
                        size: fileInfo.size,
                        aHash,
                        pHash,
                        quality,
                    }
                }
            }

            if (result.pHash) {
                hashResults.push(result)
                qualityScores.set(f.path, result.quality?.score || 0)
            }
        },
        { concurrency }
    )

    log.info(`Cache stats: ${cacheHits} hits, ${cacheMisses} misses`)

    return {
        hashResults,
        qualityScores,
        cacheEntries: updatedEntries,
        cacheHits,
        cacheMisses,
    }
}

/**
 * 图像哈希配置常量
 *
 * THRESHOLD: 汉明距离阈值，越小越严格（0-64）
 *   - 0: 完全相同
 *   - 5-10: 高度相似（推荐）
 *   - 15-20: 可能相似（宽松）
 *   - > 25: 可能不相似
 *
 * PARALLEL: 并行计算哈希的并发数
 *
 * AHASH_SIZE: 平均哈希尺寸，影响 aHash 精度
 *   - 8: 64 位哈希，快速筛选，容忍度高
 *   - 16: 256 位哈希，更精确但计算慢
 *
 * PHASH_SIZE: 感知哈希输入尺寸，影响 DCT 计算精度
 *   - 16: 较低精度，适合快速处理
 *   - 32: 标准精度（推荐）
 *   - 64: 高精度，但计算慢
 */
export const HASH_CONFIG = {
    THRESHOLD: 12,
    PARALLEL: 4,
    AHASH_SIZE: 8,
    PHASH_SIZE: 32,
}

/**
 * 图像质量评估配置
 *
 * ENABLED: 是否启用质量评估
 * SAMPLE_SIZE: 评估时的缩放尺寸，越大越精确但越慢
 * CONTRAST_WEIGHT: 对比度权重（0-1）
 * SHARPNESS_WEIGHT: 清晰度权重（0-1）
 *
 * 评分公式：
 *   totalScore = contrastScore * CONTRAST_WEIGHT + sharpnessScore * SHARPNESS_WEIGHT
 */
export const QUALITY_CONFIG = {
    ENABLED: true,
    SAMPLE_SIZE: 256,
    CONTRAST_WEIGHT: 0.5,
    SHARPNESS_WEIGHT: 0.5,
}

/**
 * 事件聚类配置
 *
 * GAP_THRESHOLD_MS: 事件间隔阈值（毫秒）
 *   - 30 分钟：默认值，适合大多数场景
 *   - 60 分钟：更严格，适合旅行等长时间拍摄
 *
 * MIN_EVENT_SIZE: 最小事件大小，小于此数量不视为独立事件
 */
export const EVENT_CONFIG = {
    GAP_THRESHOLD_MS: 30 * 60 * 1000,
    MIN_EVENT_SIZE: 3,
}

/**
 * 计算平均哈希
 *
 * 算法步骤：
 * 1. 缩放到 AHASH_SIZE x AHASH_SIZE
 * 2. 转为灰度图
 * 3. 计算所有像素的平均值
 * 4. 每个像素 > 平均值则为 1，否则为 0
 * 5. 生成 AHASH_SIZE^2 位的二进制哈希
 *
 * 特点：
 * - 计算速度快
 * - 对缩放、亮度变化有一定容忍度
 * - 但对旋转、裁剪敏感
 *
 * @param {string} filePath - 文件路径
 * @param {Object} options - 可选配置
 * @param {number} options.hashSize - 哈希尺寸，默认 8
 * @returns {string|null} 16 进制哈希字符串
 */
export async function computeAverageHash(filePath, options = {}) {
    const hashSize = options.hashSize || HASH_CONFIG.AHASH_SIZE

    try {
        const stats = await sharp(filePath).stats()
        const { channels } = stats
        const hasAlpha = channels.length === 4

        const image = sharp(filePath).resize(hashSize, hashSize, {
            fit: "cover",
            kernel: sharp.kernel.nearest,
        })

        if (hasAlpha) {
            image.removeAlpha()
        }

        const { data } = await image.grayscale().raw().toBuffer({ resolveWithObject: true })

        const avg = data.reduce((sum, b) => sum + b, 0) / data.length

        let hash = BigInt(0)
        for (let i = 0; i < data.length; i++) {
            if (data[i] > avg) {
                hash |= BigInt(1) << BigInt(i)
            }
        }

        return hash.toString(16).padStart(Math.ceil((hashSize * hashSize) / 4), "0")
    } catch (e) {
        log.debug(`Failed to compute aHash for ${filePath}: ${e.message}`)
        return null
    }
}

/**
 * 计算感知哈希
 *
 * 算法步骤：
 * 1. 缩放到 32x32
 * 2. 转为灰度图
 * 3. 计算 2D DCT（离散余弦变换）
 * 4. 取左上角 8x8 的低频系数（不含 DC 分量）
 * 5. 计算中位数，> 中数为 1，否则为 0
 * 6. 生成 63 位哈希
 *
 * 特点：
 * - 比 aHash 更精确
 * - 对缩放、压缩、轻微旋转有更好的容忍度
 * - 计算量较大
 *
 * @param {string} filePath - 文件路径
 * @param {Object} options - 可选配置
 * @param {number} options.pHashSize - DCT 输入尺寸，默认 32
 * @returns {string|null} 16 进制哈希字符串（16 字符 = 64 位）
 */
export async function computePerceptualHash(filePath, options = {}) {
    const pHashSize = options.pHashSize || HASH_CONFIG.PHASH_SIZE

    try {
        const stats = await sharp(filePath).stats()
        const { channels } = stats
        const hasAlpha = channels.length === 4

        const image = sharp(filePath).resize(pHashSize, pHashSize, {
            fit: "cover",
            kernel: sharp.kernel.lanczos3,
        })

        if (hasAlpha) {
            image.removeAlpha()
        }

        const { data } = await image.grayscale().raw().toBuffer({ resolveWithObject: true })

        const hash = computeDCTHash(data, pHashSize)
        return hash
    } catch (e) {
        log.debug(`Failed to compute pHash for ${filePath}: ${e.message}`)
        return null
    }
}

/**
 * 计算 DCT 哈希（pHash 的核心）
 *
 * @param {Uint8Array} data - 32x32 灰度图像数据
 * @param {number} size - 图像尺寸，默认 32
 * @returns {string} 16 字符 16 进制哈希
 */
function computeDCTHash(data, size = 32) {
    const reducedSize = 8
    const pixels = []

    for (let i = 0; i < data.length; i++) {
        pixels.push(data[i])
    }

    const dct = computeDCT2D(pixels, size)

    const dctLow = []
    for (let y = 0; y < reducedSize; y++) {
        for (let x = 0; x < reducedSize; x++) {
            if (y === 0 && x === 0) continue
            dctLow.push(dct[y * size + x])
        }
    }

    const median = dctLow.sort((a, b) => a - b)[Math.floor(dctLow.length / 2)]

    let hash = BigInt(0)
    let bitIndex = 0
    for (let y = 0; y < reducedSize; y++) {
        for (let x = 0; x < reducedSize; x++) {
            if (y === 0 && x === 0) continue
            if (dct[y * size + x] > median) {
                hash |= BigInt(1) << BigInt(bitIndex)
            }
            bitIndex++
        }
    }

    return hash.toString(16).padStart(16, "0")
}

/**
 * 计算 2D 离散余弦变换 (DCT-II)
 *
 * DCT 是 JPEG 压缩的核心算法，能将图像从空间域转换到频率域。
 * 低频系数代表图像的主要结构，高频系数代表细节和噪声。
 *
 * @param {Array} data - 输入数据
 * @param {number} size - 数据尺寸
 * @returns {Float64Array} DCT 系数
 */
function computeDCT2D(data, size) {
    const result = new Float64Array(size * size)
    const temp = new Float64Array(size * size)

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            let sum = 0
            for (let i = 0; i < size; i++) {
                sum += data[y * size + i] * Math.cos((Math.PI * (2 * i + 1) * x) / (2 * size))
            }
            temp[y * size + x] = sum
        }
    }

    for (let x = 0; x < size; x++) {
        for (let y = 0; y < size; y++) {
            let sum = 0
            for (let i = 0; i < size; i++) {
                sum += temp[i * size + x] * Math.cos((Math.PI * (2 * i + 1) * y) / (2 * size))
            }
            const coeff = y === 0 ? 1 / Math.sqrt(size) : Math.sqrt(2 / size)
            result[y * size + x] = sum * coeff
        }
    }

    return result
}

/**
 * 计算汉明距离
 *
 * 汉明距离 = 两个等长字符串对应位置不同字符的数量
 * 对于哈希比较，距离越小表示图片越相似
 *
 * 参考值：
 * - 0-5: 几乎相同
 * - 5-10: 高度相似
 * - 10-15: 可能相似
 * - > 20: 可能不相似
 *
 * @param {string} hash1 - 哈希1
 * @param {string} hash2 - 哈希2
 * @returns {number} 汉明距离
 */
export function hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2) return 64

    const h1 = BigInt("0x" + hash1)
    const h2 = BigInt("0x" + hash2)
    const xor = h1 ^ h2

    let distance = 0
    let n = xor
    while (n) {
        distance += Number(n & BigInt(1))
        n >>= BigInt(1)
    }
    return distance
}

/**
 * 事件聚类 - 识别同一天内的不同拍摄事件
 *
 * 工作原理：
 * 1. 按时间排序照片
 * 2. 相邻照片间隔 > GAP_THRESHOLD_MS 时，视为新事件
 * 3. 返回事件数组
 *
 * 应用场景：
 * - 上午拍了风景，下午拍了人像，晚上拍了美食
 * - 这三个事件应该分别有代表性照片被选中
 *
 * @param {Array} files - 文件列表（需包含 date 字段）
 * @param {number} gapThresholdMs - 事件间隔阈值（毫秒）
 * @returns {Array} 事件数组，每个事件是文件数组
 */
export function clusterByEvents(files, gapThresholdMs = EVENT_CONFIG.GAP_THRESHOLD_MS) {
    if (!files || files.length === 0) {
        return []
    }

    const sortedFiles = [...files].sort((a, b) => a.date - b.date)
    const events = []
    let currentEvent = [sortedFiles[0]]

    for (let i = 1; i < sortedFiles.length; i++) {
        const prevTime = sortedFiles[i - 1].date.getTime()
        const currTime = sortedFiles[i].date.getTime()
        const gap = currTime - prevTime

        if (gap > gapThresholdMs) {
            events.push(currentEvent)
            currentEvent = [sortedFiles[i]]
        } else {
            currentEvent.push(sortedFiles[i])
        }
    }

    if (currentEvent.length > 0) {
        events.push(currentEvent)
    }

    return events
}

/**
 * 计算单张图片的质量评分
 *
 * 评分维度：
 * 1. 对比度：邻域像素差异的平均值，反映图像层次感
 * 2. 清晰度：拉普拉斯方差，反映边缘锐利程度
 *
 * @param {string} filePath - 文件路径
 * @param {Object} config - 配置参数
 * @returns {Object} { score, contrast, sharpness }
 */
export async function calculateImageQualityScore(filePath, config = QUALITY_CONFIG) {
    try {
        const sampleSize = config.SAMPLE_SIZE
        const image = sharp(filePath)

        const { data, info } = await image
            .resize(sampleSize, sampleSize, { fit: "cover" })
            .grayscale()
            .raw()
            .toBuffer({ resolveWithObject: true })

        const contrast = calculateContrast(data, info.width, info.height)
        const sharpnessVariance = await calculateLaplacianVariance(filePath)

        const contrastScore = Math.min(contrast * 2, 50)
        const sharpnessScore = Math.min(sharpnessVariance * 0.5, 50)

        const totalScore =
            contrastScore * config.CONTRAST_WEIGHT + sharpnessScore * config.SHARPNESS_WEIGHT

        return {
            score: totalScore,
            contrast: contrastScore,
            sharpness: sharpnessScore,
        }
    } catch (e) {
        return { score: 0, contrast: 0, sharpness: 0 }
    }
}

/**
 * 计算图像对比度
 *
 * 方法：计算每个像素与其 4 邻域像素差异的平均值
 * 对比度高 = 图像层次分明，视觉效果好
 *
 * @param {Uint8Array} data - 灰度图像数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @returns {number} 对比度值
 */
function calculateContrast(data, width, height) {
    let sum = 0
    let count = 0

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x
            const center = data[idx]

            const neighbors = [data[idx - 1], data[idx + 1], data[idx - width], data[idx + width]]

            for (const n of neighbors) {
                sum += Math.abs(center - n)
                count++
            }
        }
    }

    return count > 0 ? sum / count : 0
}

/**
 * 计算拉普拉斯方差（清晰度评估）
 *
 * 方法：
 * 1. 使用拉普拉斯算子卷积图像
 * 2. 计算卷积结果的方差
 *
 * 原理：
 * - 拉普拉斯算子检测边缘
 * - 清晰图像边缘锐利，方差大
 * - 模糊图像边缘模糊，方差小
 *
 * 拉普拉斯核：
 * [0,  1, 0]
 * [1, -4, 1]
 * [0,  1, 0]
 *
 * @param {string} filePath - 文件路径
 * @returns {number} 拉普拉斯方差
 */
export async function calculateLaplacianVariance(filePath) {
    try {
        const { data } = await sharp(filePath)
            .grayscale()
            .convolve({
                width: 3,
                height: 3,
                kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0],
            })
            .raw()
            .toBuffer({ resolveWithObject: true })

        const mean = data.reduce((sum, b) => sum + b, 0) / data.length
        const variance = data.reduce((sum, b) => sum + Math.pow(b - mean, 2), 0) / data.length

        return variance
    } catch (e) {
        return 0
    }
}

/**
 * 批量计算图像质量评分
 *
 * @param {Array} files - 文件列表
 * @param {Object} config - 配置参数
 * @returns {Map} 质量评分 Map<path, score>
 */
export async function calculateQualityScores(files, config = QUALITY_CONFIG) {
    if (!config.ENABLED || !files || files.length === 0) {
        return new Map()
    }

    const scores = new Map()

    await pMap(
        files,
        async (f) => {
            const result = await calculateImageQualityScore(f.path, config)
            scores.set(f.path, result.score)
        },
        { concurrency: HASH_CONFIG.PARALLEL }
    )

    return scores
}

/**
 * 图像哈希去重处理
 *
 * 流程：
 * 1. 计算所有图片的 aHash 和 pHash
 * 2. 两两比较：
 *    a. 先用 aHash 快速筛选（阈值 * 2）
 *    b. 再用 pHash 精确匹配（阈值）
 * 3. 相似图片保留质量评分更高的
 *
 * @param {Array} files - 文件列表
 * @param {number} threshold - 汉明距离阈值
 * @param {Object} options - 可选配置
 * @returns {Object} { toRemove: Set<path>, removedCount }
 */
export async function computeHashDedup(files, threshold = HASH_CONFIG.THRESHOLD, options = {}) {
    if (!files || files.length === 0) {
        return { toRemove: new Set(), removedCount: 0 }
    }

    const qualityScores = options.qualityScores || (await calculateQualityScores(files))

    const hashResults = await pMap(
        files,
        async (f) => {
            const [aHash, pHash] = await Promise.all([
                computeAverageHash(f.path, options),
                computePerceptualHash(f.path, options),
            ])
            return { file: f, aHash, pHash }
        },
        { concurrency: HASH_CONFIG.PARALLEL }
    )

    const validHashes = hashResults.filter((r) => r.pHash !== null)
    const toRemove = new Set()

    for (let i = 0; i < validHashes.length; i++) {
        if (toRemove.has(validHashes[i].file.path)) continue

        for (let j = i + 1; j < validHashes.length; j++) {
            if (toRemove.has(validHashes[j].file.path)) continue

            const aHashDist = hammingDistance(validHashes[i].aHash, validHashes[j].aHash)
            if (aHashDist > threshold * 2) continue

            const pHashDist = hammingDistance(validHashes[i].pHash, validHashes[j].pHash)

            if (pHashDist <= threshold) {
                const scoreI = qualityScores.get(validHashes[i].file.path) || 0
                const scoreJ = qualityScores.get(validHashes[j].file.path) || 0

                const sizeI = validHashes[i].file.size || 0
                const sizeJ = validHashes[j].file.size || 0

                const keepI = scoreI > scoreJ || (scoreI === scoreJ && sizeI >= sizeJ)

                if (keepI) {
                    toRemove.add(validHashes[j].file.path)
                } else {
                    toRemove.add(validHashes[i].file.path)
                    break
                }
            }
        }
    }

    return { toRemove, removedCount: toRemove.size }
}
