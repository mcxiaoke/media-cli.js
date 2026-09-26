/**
 * FFmpeg 错误解析与错误报告持久化模块
 *
 * 专注于 stderr 关键错误提取、取消异常判定、Error 实例对象序列化与磁盘错误报告输出。
 */
import dayjs from "dayjs"
import fs from "fs-extra"
import path from "path"
import * as log from "../../lib/debug.js"

export function isCancellationError(error, signal = null) {
    return Boolean(
        signal?.aborted ||
        error?.name === "AbortError" ||
        error?.code === "ABORT_ERR" ||
        error?.isCanceled ||
        error?.isTerminated,
    )
}

/**
 * 从 ffmpeg 的 stderr 中提取「有意义的错误行」
 *
 * ⚠️ 直接取 stderr 前 N 字符是错的：`--debug` 时 -v 级别是 `repeat+level+info`，
 * stderr 开头是 "Input #0, matroska,webm, from ..." 这类正常 info 输出，
 * 真正的错误被挤到后面 → 用户看到的错误信息毫无价值（曾发生）。
 *
 * ffmpeg 在 `-v repeat+level+info` 下会给每行加级别前缀：
 *   [info]  ...                                   ← 正常输出
 *   [error] Impossible to convert between ...      ← 真正的错误（第一条最有信息量）
 *   [error] Link 'xxx' -> 'yyy':                   ← 后续是上下文/像素格式清单
 *   [error]     dst: cuda
 *   [info] Conversion failed!                      ← 尾部总结（无信息量）
 *
 * 策略：**从前往后**找第一条 `[error]` 行（错误块的头部才是根因）。
 * 取最后一条会抓到 "dst: cuda" 这类清单噪声。
 *
 * @param {Error|string} error
 * @param {number} maxLen
 * @returns {string}
 */
export function extractFFmpegError(error, maxLen = 200) {
    const raw = (error && (error.stderr || error.message)) || ""
    if (!raw) return "[Unknown]"
    const lines = String(raw)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    if (lines.length === 0) return "[Unknown]"

    const strip = (s) => s.replace(/^\[[a-z]+\]\s*/i, "")

    // 1) 从前往后找第一条 [error] 行（错误块头部 = 根因）
    for (let i = 0; i < lines.length; i++) {
        if (/\[error\]/i.test(lines[i])) {
            const body = strip(lines[i])
            // 跳过纯上下文的噪声行（"Link '...'", "Pixel formats:", "src:", "dst:"）
            if (/^(link\s|pixel formats|src:|dst:)/i.test(body)) continue
            return body.substring(0, maxLen)
        }
    }
    // 2) 无 [error] 标记时，找含错误特征词的行（排除无信息量的尾部总结）
    const errRe =
        /error|invalid|failed|cannot|could not|unable|unsupported|not supported|no such|denied|corrupt|missing|out of range|exceed|truncat/i
    const noise = /^conversion failed!?$/i
    for (let i = 0; i < lines.length; i++) {
        const body = strip(lines[i])
        if (noise.test(body)) continue
        if (errRe.test(body)) return body.substring(0, maxLen)
    }
    // 3) 兜底：最后一条（去掉级别前缀）
    return strip(lines[lines.length - 1]).substring(0, maxLen)
}

/**
 * Error 实例的自身属性（message/stack）不可枚举，`JSON.stringify(error)` 会得到 `{}`，
 * 错误原因随之丢失。序列化前先摊平成普通对象。
 */
export function serializeError(error) {
    if (!error) return String(error)
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack || null,
            ...(error.stderr ? { stderr: String(error.stderr) } : {}),
        }
    }
    return error
}

/**
 * 在输出目录写入错误日志文件
 *
 * `--error-file` 支持三种取值：
 *   - `json` / `text`：写入输出目录，文件名自动生成（`<name>_<preset>_error_<时间戳>.ext`）；
 *   - 其它任意字符串：视为**显式文件路径**（相对路径基于输出目录解析），扩展名 `.json`
 *     决定 JSON 格式，其余按文本；多个失败文件共用同一路径时**追加**而非覆盖，避免丢历史。
 *
 * @param {Object} entry - 文件对象
 * @param {Error} error - 错误对象
 * @returns {Promise<void>}
 */
export async function writeErrorFile(entry, error) {
    if (!entry.errorFile) {
        return
    }
    try {
        const mode =
            entry.errorFile === "json" || entry.errorFile === "text" ? entry.errorFile : null
        const explicitPath = mode ? null : path.resolve(entry.fileDstDir || ".", entry.errorFile)
        const useJson = mode ? mode === "json" : explicitPath.toLowerCase().endsWith(".json")
        const nowStr = dayjs().format("YYYYMMDDHHmmss")
        // 确保输出目录存在，避免写入错误日志失败
        await fs.ensureDir(entry.fileDstDir)
        const errorFile = explicitPath
            ? explicitPath
            : path.join(
                  entry.fileDstDir,
                  `${path.parse(entry.name).name}_${entry.preset.name}_error_${nowStr}${useJson ? ".json" : ".txt"}`,
              )
        const errorObj = {
            ...entry,
            error: serializeError(error),
            date: Date.now(),
        }
        if (useJson) {
            await fs.appendFile(errorFile, `${JSON.stringify(errorObj, null, 4)}\n`)
        } else {
            const errData = Object.entries(errorObj)
                .map(([key, value]) => `${key} =: ${value}`)
                .join("\n")
            await fs.appendFile(errorFile, `${errData}\n\n`)
        }
    } catch (e) {
        log.error("writeErrorFile", "Failed to write error file", e.message)
    }
}
