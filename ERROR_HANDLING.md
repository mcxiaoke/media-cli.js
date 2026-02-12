# 错误处理系统使用指南

## 📖 概述

本项目使用统一的错误处理系统来提供一致的错误处理体验。该系统包括错误类型定义、错误处理器、错误码映射和便捷的错误处理函数。

## 🚀 快速开始

### 基本用法

```javascript
import { createError, handleError, ErrorTypes } from "../lib/errors.js"

// 创建错误
const error = createError(
  ErrorTypes.FILE_NOT_FOUND,
  '指定的文件不存在',
  originalError,
  'ERROR'
)

// 处理错误
const result = await handleError(error, { context: 'additional info' })

if (result.recoverable && result.action === 'skip') {
  // 跳过当前操作
} else if (!result.recoverable) {
  // 终止操作
}
```

### 使用错误处理装饰器

```javascript
import { withErrorHandling } from "../lib/errors.js"

// 包装异步函数以自动处理错误
const safeFileOperation = withErrorHandling(async (filePath) => {
  // 你的文件操作代码
  await fs.move(src, dst)
  return { success: true }
}, { operation: 'file_move' })

// 使用包装后的函数
const result = await safeFileOperation('/path/to/file')
if (result) {
  // 操作成功
} else {
  // 操作失败，错误已被处理
}
```

## 📋 错误类型

### 文件系统错误
- `FILE_NOT_FOUND` - 文件不存在
- `FILE_ACCESS_DENIED` - 文件访问被拒绝
- `FILE_ALREADY_EXISTS` - 文件已存在
- `INVALID_PATH` - 无效的文件路径

### 媒体处理错误
- `UNSUPPORTED_FORMAT` - 不支持的文件格式
- `CORRUPTED_FILE` - 文件已损坏
- `PROCESSING_FAILED` - 处理失败

### 外部工具错误
- `FFMPEG_ERROR` - FFmpeg 执行错误
- `EXIFTOOL_ERROR` - ExifTool 执行错误
- `SHARP_ERROR` - 图像处理库错误

### 用户输入错误
- `INVALID_ARGUMENT` - 无效的参数
- `MISSING_REQUIRED_ARGUMENT` - 缺少必需参数

## 🎯 错误严重程度

- `INFO` - 信息性消息
- `WARN` - 警告，操作可继续
- `ERROR` - 错误，可能需要用户干预
- `FATAL` - 致命错误，程序将退出

## 🔧 自定义错误处理器

```javascript
import { errorHandler, ErrorTypes } from "../lib/errors.js"

// 注册自定义错误处理器
errorHandler.registerHandler(ErrorTypes.PROCESSING_FAILED, (error, context) => {
  console.log('自定义处理逻辑:', error.message)
  
  // 返回处理结果
  return {
    recoverable: true,
    action: 'retry', // 'skip', 'abort', 'retry'
    retryCount: 3
  }
})
```

## 📝 最佳实践

### 1. 使用特定的错误类型
```javascript
// ❌ 避免
throw createError(ErrorTypes.UNKNOWN_ERROR, 'Something went wrong')

// ✅ 推荐
throw createError(ErrorTypes.FILE_NOT_FOUND, 'Input file does not exist')
```

### 2. 提供有用的错误信息
```javascript
// ❌ 避免
throw createError(ErrorTypes.INVALID_ARGUMENT, 'Invalid input')

// ✅ 推荐
throw createError(
  ErrorTypes.INVALID_ARGUMENT,
  `Expected directory path, got: ${typeof input}`
)
```

### 3. 包含原始错误
```javascript
try {
  await someOperation()
} catch (originalError) {
  throw createError(
    ErrorTypes.PROCESSING_FAILED,
    'Failed to process media file',
    originalError
  )
}
```

### 4. 使用错误处理装饰器
```javascript
// 对于可能失败的操作，使用装饰器自动处理错误
const safeOperation = withErrorHandling(riskyOperation)
const result = await safeOperation(params)

if (result === null) {
  // 操作失败，错误已被处理
} else {
  // 操作成功
}
```

## 🔍 调试和日志

错误处理系统会自动记录错误到日志文件：
- 错误类型和信息
- 时间戳
- 上下文信息
- 原始错误（如果存在）

日志文件位置：`%TEMP%/mediac/mediac_log_YYYYMMDDHHmmss.txt`

## 🎨 用户友好的错误消息

系统会自动提供用户友好的错误消息和建议：

```
❌ 文件未找到: /path/to/missing/file.jpg
💡 建议: 请检查文件路径是否正确
```

## 🔄 错误恢复策略

错误处理器返回以下恢复策略：

- `skip` - 跳过当前操作，继续处理其他项目
- `abort` - 终止当前命令执行
- `retry` - 重试操作（需要自定义处理器支持）

## 📚 示例代码

完整的错误处理示例请参考：
- `cmd/cmd_lr.js` - 演示了基本错误处理用法
- `lib/errors.js` - 错误处理系统实现
- `lib/error-codes.js` - 错误码定义