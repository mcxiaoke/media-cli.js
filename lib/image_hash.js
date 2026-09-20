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
 * 将各种形态的 mtime 归一化为「秒级数字」
 *
 * walk 模式产出的 `f.mtime` 是 Date 对象，写入缓存 JSON 后变成字符串，
 * 而缓存里存的是秒级数字。若直接比较，Date/string/number 三者恒不相等，
 * 会导致缓存永不命中。所有比较与写入都必须先经过本函数。
 *
 * @param {Date|number|string|null|undefined} v - 原始 mtime
 * @returns {number} 秒级时间戳；无法解析时返回 0
 */
export function normalizeMtimeSec(v) {
    if (v === null || v === undefined || v === "") return 0
    if (v instanceof Date) {
        const t = v.getTime()
        return Number.isFinite(t) ? Math.floor(t / 1000) : 0
    }
    if (typeof v === "number") {
        if (!Number.isFinite(v)) return 0
        // 毫秒级时间戳（> 1e12）转换为秒
        return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v)
    }
    const d = new Date(v)
    const t = d.getTime()
    return Number.isFinite(t) ? Math.floor(t / 1000) : 0
}

/**
 * 批量计算图像特征（无缓存）
 *
 * 与 computeImageFeaturesWithCache 产出完全一致的结构，但跳过缓存读写。
 * 冷路径（无缓存）使用本函数，避免与热路径出现两套计算逻辑。
 *
 * @param {Array} files - 文件列表
 * @param {Object} options - 配置选项
 * @returns {Promise<Object>} { hashResults, qualityScores }
 */
export async function computeImageFeatures(files, options = {}) {
    const qualityScores = new Map()
    const concurrency = options.concurrency || HASH_CONFIG.PARALLEL
    // 按输入下标写入而非 push：pMap 的完成顺序不定，
    // push 会让 hashResults 的顺序随解码耗时变化，而 dedupByHashes 依赖稳定的遍历顺序。
    const slots = new Array(files.length)

    await pMap(
        files,
        async (f, index) => {
            const [aHash, pHash, quality] = await Promise.all([
                computeAverageHash(f.path, options),
                computePerceptualHash(f.path, options),
                calculateImageQualityScore(f.path, options.qualityConfig || QUALITY_CONFIG),
            ])
            if (pHash) {
                slots[index] = { file: f, aHash, pHash, quality }
                qualityScores.set(f.path, quality?.score || 0)
            }
        },
        { concurrency },
    )

    return { hashResults: slots.filter(Boolean), qualityScores }
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
    // 两侧都归一化后再比较，兼容 Date / 字符串 / 数字三种历史形态
    if (normalizeMtimeSec(cached.mtime) !== normalizeMtimeSec(file.mtime)) return false
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
    const qualityScores = new Map()
    const cacheEntries = cache?.entries || {}
    const updatedEntries = {}
    let cacheHits = 0
    let cacheMisses = 0

    const concurrency = options.concurrency || HASH_CONFIG.PARALLEL
    // 同上：按输入下标写入，保证输出顺序与输入一致（缓存命中项的返回尤其快，
    // push 会让「已缓存的」结果全部挤到数组前部，打乱去重的确定性）
    const slots = new Array(files.length)

    await pMap(
        files,
        async (f, index) => {
            const relPath = path.relative(rootPath, f.path)
            const cached = cacheEntries[relPath]
            const fileInfo = {
                mtime: normalizeMtimeSec(f.mtime || (f.stats && f.stats.mtime)),
                size: f.size || (f.stats && f.stats.size) || 0,
            }

            let result

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
                slots[index] = result
                qualityScores.set(f.path, result.quality?.score || 0)
            }
        },
        { concurrency }
    )

    log.info(`Cache stats: ${cacheHits} hits, ${cacheMisses} misses`)

    return {
        hashResults: slots.filter(Boolean),
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
 * 感知哈希去重核心：对已算好的哈希做两两比较，返回应移除的路径集合
 *
 * 这是唯一的去重实现。computeHashDedup（自行算哈希）与 cmd_pick 的
 * processImageHashDedup（复用缓存或已算好的哈希）都调用本函数，
 * 避免此前"两套几乎同构的实现各自漂移"的问题。
 *
 * 判定规则：
 * 1. 先用 aHash 快速筛选（距离 > threshold*2 直接跳过）
 * 2. 再用 pHash 精确匹配（距离 <= threshold 视为相似）
 * 3. 相似时保留质量评分更高者；评分相同则保留体积更大者
 *
 * 性能（鸽巢分桶剪枝）：
 * 朴素两两比较是 O(n²)。这里把 64 位哈希切成 threshold+1 块，依据鸽巢原理：
 * 若两个哈希的汉明距离 <= threshold，则至少有一块完全相同。因此只需与
 * "至少共享一个块值"的元素比较，其余组合必然距离 > threshold，可直接跳过。
 * 这是无损剪枝（不存在漏判）。
 *
 * 正确性关键：去重是贪婪过程，结果依赖比较顺序。本实现严格保持与朴素版
 * 一致的顺序（外层 i 升序，内层候选 j 升序），故结果完全一致——已用随机
 * 数据在多组阈值下与朴素实现逐项比对验证。
 *
 * @param {Array} hashResults - [{ file, aHash, pHash }]，pHash 为 null 的会被忽略
 * @param {number} threshold - 汉明距离阈值
 * @param {Map} qualityScores - path -> 质量分
 * @returns {Set<string>} 应移除的文件路径集合
 */
export function dedupByHashes(
    hashResults,
    threshold = HASH_CONFIG.THRESHOLD,
    qualityScores = new Map(),
) {
    const validHashes = hashResults.filter((r) => r && r.pHash !== null)
    const toRemove = new Set()
    if (validHashes.length < 2) return toRemove

    const popcount = (n) => {
        let c = 0
        while (n) {
            c += Number(n & 1n)
            n >>= 1n
        }
        return c
    }

    // 预先解析为 BigInt，避免在双层循环里反复 parse
    const items = validHashes.map((r) => {
        let p
        let a
        try {
            p = BigInt("0x" + r.pHash)
        } catch {
            p = 0n
        }
        try {
            a = r.aHash ? BigInt("0x" + r.aHash) : 0n
        } catch {
            a = 0n
        }
        return { file: r.file, pHash: p, aHash: a }
    })

    const n = items.length

    // ---- 鸽巢分桶：切 threshold+1 块，记录每块的值 ----
    const blocks = Math.max(1, Math.min(threshold + 1, 64))
    const chunk = Math.ceil(64 / blocks)
    const mask = (1n << BigInt(chunk)) - 1n

    // 每块一个 Map: 块值 -> 索引数组（升序）
    const tables = []
    for (let b = 0; b < blocks; b++) {
        tables.push(new Map())
    }
    for (let i = 0; i < n; i++) {
        for (let b = 0; b < blocks; b++) {
            const shift = BigInt(Math.min(b * chunk, 64))
            const val = (items[i].pHash >> shift) & mask
            const t = tables[b]
            if (!t.has(val)) t.set(val, [])
            t.get(val).push(i)
        }
    }

    // ---- 按原始顺序遍历，候选集为"共享任一块值"的 j ----
    for (let i = 0; i < n; i++) {
        if (toRemove.has(items[i].file.path)) continue

        const cand = new Set()
        for (let b = 0; b < blocks; b++) {
            const shift = BigInt(Math.min(b * chunk, 64))
            const val = (items[i].pHash >> shift) & mask
            const group = tables[b].get(val)
            if (!group) continue
            for (const j of group) {
                if (j > i) cand.add(j)
            }
        }
        if (cand.size === 0) continue

        const candidates = [...cand].sort((x, y) => x - y)

        for (const j of candidates) {
            if (toRemove.has(items[j].file.path)) continue

            const aHashDist = popcount(items[i].aHash ^ items[j].aHash)
            if (aHashDist > threshold * 2) continue

            const pHashDist = popcount(items[i].pHash ^ items[j].pHash)
            if (pHashDist > threshold) continue

            const scoreI = qualityScores.get(items[i].file.path) || 0
            const scoreJ = qualityScores.get(items[j].file.path) || 0
            const sizeI = items[i].file.size || 0
            const sizeJ = items[j].file.size || 0

            const keepI = scoreI > scoreJ || (scoreI === scoreJ && sizeI >= sizeJ)
            if (keepI) {
                toRemove.add(items[j].file.path)
            } else {
                toRemove.add(items[i].file.path)
                break
            }
        }
    }

    return toRemove
}

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
        { concurrency: HASH_CONFIG.PARALLEL },
    )

    const toRemove = dedupByHashes(hashResults, threshold, qualityScores)

    return { toRemove, removedCount: toRemove.size }
}
