/*
 * File: ffmpeg_bin.js
 * Created: 2026-09-21
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * FFmpeg 可执行文件定位
 *
 * 定位优先级（解决「PATH 里无 fdk 的版本排在 nonfree 版之前」一类问题）：
 *   1. FFMPEG_PATH 环境变量（指向某个 ffmpeg(.exe) 的绝对/相对路径）
 *   2. FFMPEG_BINARY 环境变量（部分工具链/沙箱用此名）
 *   3. which("ffmpeg") 按 PATH 查找
 *
 * 环境变量值只有在「实际存在」时才采用：变量指向不存在的文件时继续
 * 往下找下一个来源，避免静默落到一个坏的 ffmpeg 上。
 */

import fs from "fs-extra"
import path from "node:path"
import which from "which"

/** 环境变量优先顺序（前者优先） */
const FFMPEG_ENV_KEYS = ["FFMPEG_PATH", "FFMPEG_BINARY"]
const FFPROBE_ENV_KEYS = ["FFPROBE_PATH", "FFPROBE_BINARY"]

/**
 * 解析 ffmpeg 可执行文件路径：环境变量优先，其次 which 按 PATH 查找
 * @returns {Promise<string|null>} 可执行文件路径；未找到返回 null
 */
export async function resolveFFmpegBinary() {
    for (const key of FFMPEG_ENV_KEYS) {
        const raw = process.env[key]
        if (!raw) continue
        const p = raw.trim()
        if (!p) continue
        try {
            // 只做存在性判断；是否可执行留到实际调用时由 ffmpeg 自身决定
            if (await fs.pathExists(p)) {
                return p
            }
        } catch {
            // 路径无效则继续尝试下一个来源
        }
    }
    return which("ffmpeg", { nothrow: true })
}

/**
 * Resolve ffprobe, preferring an explicit environment value and then the
 * sibling directory of the selected ffmpeg binary.
 * @param {string|null} [ffmpegPath]
 * @returns {Promise<string|null>}
 */
export async function resolveFFprobeBinary(ffmpegPath = null) {
    for (const key of FFPROBE_ENV_KEYS) {
        const raw = process.env[key]
        if (!raw) continue
        const candidate = raw.trim()
        if (candidate && (await fs.pathExists(candidate))) {
            return candidate
        }
    }
    if (ffmpegPath) {
        const sibling = path.join(
            path.dirname(ffmpegPath),
            process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
        )
        if (await fs.pathExists(sibling)) {
            return sibling
        }
    }
    return which("ffprobe", { nothrow: true })
}

export default { resolveFFmpegBinary, resolveFFprobeBinary }
