/*
 * File: error-codes.js
 * Created: 2026-02-12 09:45:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * Error Code Definitions and Messages
 */

// 错误码映射
export const ErrorCodes = {
    // 文件系统错误 (1000-1099)
    1000: { type: "FILE_NOT_FOUND", message: "文件不存在", suggestion: "请检查文件路径是否正确" },
    1001: { type: "FILE_ACCESS_DENIED", message: "文件访问被拒绝", suggestion: "请检查文件权限" },
    1002: {
        type: "FILE_ALREADY_EXISTS",
        message: "文件已存在",
        suggestion: "使用不同的文件名或删除现有文件",
    },
    1003: { type: "INVALID_PATH", message: "无效的文件路径", suggestion: "请提供有效的文件路径" },
    1004: {
        type: "INSUFFICIENT_DISK_SPACE",
        message: "磁盘空间不足",
        suggestion: "清理磁盘空间或选择其他位置",
    },

    // 媒体处理错误 (2000-2099)
    2000: {
        type: "UNSUPPORTED_FORMAT",
        message: "不支持的文件格式",
        suggestion: "支持的格式: JPEG, PNG, MP4, MOV 等",
    },
    2001: { type: "CORRUPTED_FILE", message: "文件已损坏", suggestion: "文件可能已损坏，无法处理" },
    2002: { type: "PROCESSING_FAILED", message: "处理失败", suggestion: "文件处理过程中发生错误" },
    2003: {
        type: "INVALID_METADATA",
        message: "无效的元数据",
        suggestion: "文件的元数据可能已损坏",
    },
    2004: {
        type: "CONVERSION_FAILED",
        message: "格式转换失败",
        suggestion: "无法将文件转换为指定格式",
    },

    // 外部工具错误 (3000-3099)
    3000: {
        type: "FFMPEG_NOT_FOUND",
        message: "FFmpeg 未找到",
        suggestion: "请安装 FFmpeg 并添加到系统路径",
    },
    3001: {
        type: "FFMPEG_ERROR",
        message: "FFmpeg 执行错误",
        suggestion: "检查 FFmpeg 命令和参数",
    },
    3002: {
        type: "EXIFTOOL_NOT_FOUND",
        message: "ExifTool 未找到",
        suggestion: "请安装 ExifTool 并添加到系统路径",
    },
    3003: {
        type: "EXIFTOOL_ERROR",
        message: "ExifTool 执行错误",
        suggestion: "检查 ExifTool 命令和参数",
    },
    3004: { type: "SHARP_ERROR", message: "图像处理库错误", suggestion: "图像处理过程中发生错误" },

    // 用户输入错误 (4000-4099)
    4000: { type: "INVALID_ARGUMENT", message: "无效的参数", suggestion: "请检查命令参数是否正确" },
    4001: {
        type: "MISSING_REQUIRED_ARGUMENT",
        message: "缺少必需参数",
        suggestion: "请提供所有必需的命令参数",
    },
    4002: {
        type: "INVALID_OPTION_VALUE",
        message: "无效的选项值",
        suggestion: "请提供有效的选项值",
    },
    4003: {
        type: "CONFLICTING_OPTIONS",
        message: "冲突的选项",
        suggestion: "某些选项不能同时使用",
    },
    4004: {
        type: "INVALID_JSON_INPUT",
        message: "无效的 JSON 输入",
        suggestion: "请检查 JSON 文件格式和内容",
    },

    // 系统错误 (5000-5099)
    5000: {
        type: "INSUFFICIENT_MEMORY",
        message: "内存不足",
        suggestion: "关闭其他程序或减少并发处理数量",
    },
    5001: { type: "SYSTEM_ERROR", message: "系统错误", suggestion: "系统调用失败" },
    5002: {
        type: "PERMISSION_DENIED",
        message: "权限被拒绝",
        suggestion: "以管理员身份运行或检查权限设置",
    },

    // 网络错误 (6000-6099)
    6000: { type: "NETWORK_ERROR", message: "网络错误", suggestion: "检查网络连接" },
    6001: {
        type: "TIMEOUT_ERROR",
        message: "操作超时",
        suggestion: "网络连接可能较慢，请稍后重试",
    },
    6002: { type: "CONNECTION_REFUSED", message: "连接被拒绝", suggestion: "目标服务可能不可用" },

    // 配置错误 (7000-7099)
    7000: { type: "INVALID_CONFIG", message: "无效的配置", suggestion: "检查配置文件语法" },
    7001: { type: "MISSING_CONFIG", message: "缺少配置文件", suggestion: "创建必要的配置文件" },

    // 未知错误 (9000-9099)
    9000: { type: "UNKNOWN_ERROR", message: "未知错误", suggestion: "请联系开发者报告此问题" },
    9001: { type: "INTERNAL_ERROR", message: "内部错误", suggestion: "程序内部发生错误" },
}

// 根据错误码获取错误信息
export const getErrorInfo = (errorCode) => {
    return ErrorCodes[errorCode] || ErrorCodes[9000] // 默认返回未知错误
}

// 创建带错误码的错误
export const createErrorWithCode = (errorCode, additionalMessage = "", originalError = null) => {
    const errorInfo = getErrorInfo(errorCode)
    const message = additionalMessage
        ? `${errorInfo.message}: ${additionalMessage}`
        : errorInfo.message

    return {
        code: errorCode,
        type: errorInfo.type,
        message: message,
        suggestion: errorInfo.suggestion,
        originalError: originalError,
    }
}

// 导出错误类型常量
export const ErrorTypes = Object.keys(ErrorCodes).reduce((acc, code) => {
    acc[code] = ErrorCodes[code].type
    return acc
}, {})
