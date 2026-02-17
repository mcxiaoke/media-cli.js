/*
 * File: errors.js
 * Created: 2026-02-12 09:45:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * Unified Error Handling System
 */

import chalk from "chalk"
import * as log from "./debug.js"
import { ErrorCodes } from "./error-codes.js"

// 错误类型枚举
export const ErrorTypes = {
    // 文件系统错误
    FILE_NOT_FOUND: "FILE_NOT_FOUND",
    FILE_ACCESS_DENIED: "FILE_ACCESS_DENIED",
    FILE_ALREADY_EXISTS: "FILE_ALREADY_EXISTS",
    INVALID_PATH: "INVALID_PATH",

    // 媒体处理错误
    UNSUPPORTED_FORMAT: "UNSUPPORTED_FORMAT",
    CORRUPTED_FILE: "CORRUPTED_FILE",
    PROCESSING_FAILED: "PROCESSING_FAILED",

    // 外部工具错误
    FFMPEG_ERROR: "FFMPEG_ERROR",
    EXIFTOOL_ERROR: "EXIFTOOL_ERROR",
    SHARP_ERROR: "SHARP_ERROR",

    // 用户输入错误
    INVALID_ARGUMENT: "INVALID_ARGUMENT",
    MISSING_REQUIRED_ARGUMENT: "MISSING_REQUIRED_ARGUMENT",
    INVALID_JSON_INPUT: "INVALID_JSON_INPUT",

    // 系统错误
    INSUFFICIENT_MEMORY: "INSUFFICIENT_MEMORY",
    INSUFFICIENT_DISK_SPACE: "INSUFFICIENT_DISK_SPACE",

    // 网络错误
    NETWORK_ERROR: "NETWORK_ERROR",
    TIMEOUT_ERROR: "TIMEOUT_ERROR",

    // 未知错误
    UNKNOWN_ERROR: "UNKNOWN_ERROR",
}

// 错误严重程度
export const ErrorSeverity = {
    INFO: "INFO",
    WARN: "WARN",
    ERROR: "ERROR",
    FATAL: "FATAL",
}

// 错误类型到退出码映射（可按需扩展）
// 根据已有的 ErrorCodes 映射查找合适的退出码（使用错误码的数字键作为退出码）
export const getExitCodeForType = (type) => {
    for (const [code, info] of Object.entries(ErrorCodes)) {
        if (info && info.type === type) return parseInt(code, 10)
    }
    return 1
}

// 自定义错误类
export class MediaCliError extends Error {
    constructor(type, message, originalError = null, severity = ErrorSeverity.ERROR) {
        super(message)
        this.name = "MediaCliError"
        this.type = type
        this.severity = severity
        this.originalError = originalError
        this.timestamp = new Date().toISOString()

        // 保持原始错误的堆栈
        if (originalError && originalError.stack) {
            this.stack = originalError.stack
        }
    }
}

// 错误处理器
export class ErrorHandler {
    constructor() {
        this.handlers = new Map()
        this.setupDefaultHandlers()
    }

    // 注册错误处理器
    registerHandler(errorType, handler) {
        this.handlers.set(errorType, handler)
    }

    // 默认错误处理器
    setupDefaultHandlers() {
        // 文件不存在错误
        this.registerHandler(ErrorTypes.FILE_NOT_FOUND, (error, context) => {
            log.showRed(chalk.bold("文件未找到:"), error.message)
            log.showYellow("请检查文件路径是否正确")
            return { recoverable: true, action: "skip" }
        })

        // 权限错误
        this.registerHandler(ErrorTypes.FILE_ACCESS_DENIED, (error, context) => {
            log.showRed(chalk.bold("访问被拒绝:"), error.message)
            log.showYellow("请检查文件权限或尝试以管理员身份运行")
            return { recoverable: false, action: "abort" }
        })

        // 格式不支持错误
        this.registerHandler(ErrorTypes.UNSUPPORTED_FORMAT, (error, context) => {
            log.showYellow(chalk.bold("不支持的格式:"), error.message)
            log.showGray("跳过此文件，继续处理其他文件")
            return { recoverable: true, action: "skip" }
        })

        // 处理失败错误
        this.registerHandler(ErrorTypes.PROCESSING_FAILED, (error, context) => {
            log.showRed(chalk.bold("处理失败:"), error.message)
            if (error.originalError) {
                log.debug("原始错误:", error.originalError.message || error.originalError)
            }
            return { recoverable: true, action: "skip" }
        })

        // 参数错误
        this.registerHandler(ErrorTypes.INVALID_ARGUMENT, (error, context) => {
            log.showRed(chalk.bold("参数错误:"), error.message)
            log.showYellow("使用 --help 查看正确的参数格式")
            return { recoverable: false, action: "abort" }
        })

        // 外部工具错误
        this.registerHandler(ErrorTypes.FFMPEG_ERROR, (error, context) => {
            log.showRed(chalk.bold("FFmpeg 错误:"), error.message)
            log.showYellow("请确保 FFmpeg 已正确安装并可用")
            return { recoverable: true, action: "skip" }
        })
    }

    // 处理错误
    async handle(error, context = {}) {
        let mediaCliError = error

        // 如果不是 MediaCliError，包装成 MediaCliError
        if (!(error instanceof MediaCliError)) {
            mediaCliError = this.wrapError(error)
        }

        // 记录错误到日志
        log.error(`[${mediaCliError.type}] ${mediaCliError.message}`)
        log.fileLog(`Error: ${mediaCliError.type} - ${mediaCliError.message}`, "ErrorHandler")

        // 根据严重程度处理
        if (mediaCliError.severity === ErrorSeverity.FATAL) {
            const exitCode = getExitCodeForType(mediaCliError.type) || 1
            log.showRed(chalk.bold("致命错误，程序将退出:"), mediaCliError.message)
            process.exit(exitCode)
        }

        // 查找对应的处理器
        const handler = this.handlers.get(mediaCliError.type)
        if (handler) {
            return await handler(mediaCliError, context)
        }

        // 默认处理
        log.showRed(chalk.bold("未知错误:"), mediaCliError.message)
        if (mediaCliError.originalError) {
            log.debug("原始错误:", mediaCliError.originalError)
        }

        return { recoverable: false, action: "abort" }
    }

    // 包装普通错误为 MediaCliError
    wrapError(error) {
        if (error instanceof MediaCliError) {
            return error
        }

        let errorType = ErrorTypes.UNKNOWN_ERROR
        let severity = ErrorSeverity.ERROR

        // 根据错误特征推断类型
        const errorMessage = error.message || ""

        if (error.code === "ENOENT") {
            errorType = ErrorTypes.FILE_NOT_FOUND
        } else if (error.code === "EACCES" || error.code === "EPERM") {
            errorType = ErrorTypes.FILE_ACCESS_DENIED
        } else if (errorMessage.includes("ffmpeg") || errorMessage.includes("FFmpeg")) {
            errorType = ErrorTypes.FFMPEG_ERROR
        } else if (errorMessage.includes("exiftool") || errorMessage.includes("ExifTool")) {
            errorType = ErrorTypes.EXIFTOOL_ERROR
        } else if (errorMessage.includes("timeout")) {
            errorType = ErrorTypes.TIMEOUT_ERROR
            severity = ErrorSeverity.WARN
        }

        return new MediaCliError(errorType, error.message || "未知错误", error, severity)
    }
}

// 创建全局错误处理器实例
export const errorHandler = new ErrorHandler()

// 便捷的错误创建函数
export const createError = (
    type,
    message,
    originalError = null,
    severity = ErrorSeverity.ERROR,
) => {
    return new MediaCliError(type, message, originalError, severity)
}

// 便捷的错误处理函数
export const handleError = async (error, context = {}) => {
    return await errorHandler.handle(error, context)
}

// 错误恢复装饰器
export const withErrorHandling = (fn, context = {}) => {
    return async (...args) => {
        try {
            return await fn(...args)
        } catch (error) {
            const result = await handleError(error, context)
            if (result.recoverable && result.action === "skip") {
                return null // 跳过当前操作
            } else if (!result.recoverable || result.action === "abort") {
                throw error // 重新抛出错误
            }
            return null
        }
    }
}
