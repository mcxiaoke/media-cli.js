import { createHash } from "crypto"
import { promises as fsp } from "fs"
import fs from "fs-extra"
import xxhash from "xxhash-wasm"

export const md5Hash = (str) => createHash("md5").update(str).digest("hex")
export const md5Short = (str, limit = 8) => md5Hash(str).slice(limit)

/**
 * 计算字符串的哈希值
 * 使用快速的哈希算法
 *
 * @param {string} str - 要哈希的字符串
 * @param {number} seed - 哈希种子，默认为0
 * @returns {number} 哈希值
 */
export function hashCode(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i)
        h1 = Math.imul(h1 ^ ch, 2654435761)
        h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)

    return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

const XXHASH_PART_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 计算文件 xxHash64
 * @param {string} path - 文件路径
 * @param {number} seed - 可选种子，默认0
 * @returns {Promise<string>} 16进制 hash
 */
export async function hashFileXXH64(path, seed = 0) {
    const { create64 } = await xxhash()
    const hasher = create64()
    const stream = fs.createReadStream(path, { highWaterMark: 1024 * 1024 }) // 1MB块

    for await (const chunk of stream) {
        hasher.update(chunk)
    }

    return hasher.digest().toString(16)
}

/**
 * 计算文件前 N MB 的 xxHash64
 * @param {string} path - 文件路径
 * @param {number} maxBytes - 最大读取字节数（默认 20MB）
 * @param {number} seed - 可选种子
 * @returns {Promise<string>} 16进制 hash
 */
export async function hashFileXXH64Partial(path, maxBytes = XXHASH_PART_SIZE, seed = 0) {
    const { create64 } = await xxhash()
    const hasher = create64()
    const stream = fs.createReadStream(path, { highWaterMark: 1024 * 1024 }) // 1MB块
    let readBytes = 0

    for await (const chunk of stream) {
        const remaining = maxBytes - readBytes
        if (remaining <= 0) break

        const buf = chunk.length > remaining ? chunk.slice(0, remaining) : chunk
        hasher.update(buf)
        readBytes += buf.length
    }

    return hasher.digest().toString(16)
}

/**
 * 判断两个文件内容是否相同（仅比较前 maxBytes）
 * 使用xxHash64计算部分文件哈希来比较
 *
 * @param {string} path1 - 第一个文件路径
 * @param {string} path2 - 第二个文件路径
 * @param {number} maxBytes - 最大比较字节数，默认20MB
 * @returns {Promise<boolean>} 如果相同返回true
 */
export async function isSameFileXXH64Partial(path1, path2, maxBytes = XXHASH_PART_SIZE) {
    try {
        const [stat1, stat2] = await Promise.all([fsp.stat(path1), fsp.stat(path2)])

        if (stat1.size !== stat2.size) return false

        const [hash1, hash2] = await Promise.all([
            hashFileXXH64Partial(path1, maxBytes),
            hashFileXXH64Partial(path2, maxBytes),
        ])

        return hash1 === hash2
    } catch (err) {
        console.error("判断文件相同出错:", err)
        return false
    }
}

const hashCache = new Map()

/**
 * 判断两个文件内容是否相同（使用缓存优化）
 * 使用Map缓存已计算的哈希值，提高性能
 *
 * @param {string} path1 - 第一个文件路径
 * @param {string} path2 - 第二个文件路径
 * @param {number} maxBytes - 最大比较字节数，默认20MB
 * @returns {Promise<boolean>} 如果相同返回true
 */
export async function isSameFileCached(path1, path2, maxBytes = XXHASH_PART_SIZE) {
    const [stat1, stat2] = await Promise.all([fsp.stat(path1), fsp.stat(path2)])
    if (stat1.size !== stat2.size) return false

    const hash1 = hashCache.get(path1) || (await hashFileXXH64Partial(path1, maxBytes))
    const hash2 = hashCache.get(path2) || (await hashFileXXH64Partial(path2, maxBytes))

    hashCache.set(path1, hash1)
    hashCache.set(path2, hash2)

    return hash1 === hash2
}

/**
 * 计算文件的前N MB和后N MB的xxHash64
 * 返回两个哈希值，用于快速文件比较
 *
 * @param {string} path - 文件路径
 * @param {number} maxBytes - 默认计算前后5M
 * @param {number} seed - 哈希种子，默认为0
 * @returns {Promise<Object<{front:string, back:string}>>} 包含前后哈希值的对象
 */
export async function hashFileXXH64FrontAndBack(path, maxBytes = 5 * 1024 * 1024, seed = 0) {
    const { create64 } = await xxhash()
    const stat = await fs.stat(path)
    const size = stat.size

    // ---------------- 前 N MB ----------------
    const hasherFront = create64(seed)
    let readBytes = 0
    const frontStream = fs.createReadStream(path, { highWaterMark: 1024 * 1024 })
    for await (const chunk of frontStream) {
        const remaining = maxBytes - readBytes
        if (remaining <= 0) break
        const buf = chunk.length > remaining ? chunk.slice(0, remaining) : chunk
        hasherFront.update(buf)
        readBytes += buf.length
    }

    // ---------------- 后 N MB ----------------
    const hasherBack = create64(seed)
    const backStart = Math.max(0, size - maxBytes)
    readBytes = 0
    const backStream = fs.createReadStream(path, {
        highWaterMark: 1024 * 1024,
        start: backStart,
    })
    for await (const chunk of backStream) {
        const remaining = maxBytes - readBytes
        if (remaining <= 0) break
        const buf = chunk.length > remaining ? chunk.slice(0, remaining) : chunk
        hasherBack.update(buf)
        readBytes += buf.length
    }

    return {
        front: hasherFront.digest().toString(16),
        back: hasherBack.digest().toString(16),
    }
}
