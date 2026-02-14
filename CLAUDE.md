# CLAUDE.md

本文档为 Claude Code (claude.ai/code) 提供在此仓库中工作的指导。

## 项目概述

MediaCli 是一个基于 Node.js 开发的多媒体文件处理命令行工具，利用 ffmpeg、exiftool 等工具对图像、视频和音频文件进行压缩、转换、重命名、删除和组织整理。该工具设计为通过 npm 全局安装使用的 CLI 工具。

## 命令和工作流

### 安装和设置
- 全局安装：`npm install mediac -g`
- 本地运行：`npm start` 或 `node index.js`
- CLI 使用：`mediac --help` 或 `node index.js --help`

### 开发命令
- **语法检查**：`npm run check` - 使用 `scripts/check_syntax.cjs` 进行语法验证
- **代码检查**：`npm run lint` - ESLint 代码质量检查
- **自动修复**：`npm run lint:fix` - ESLint 自动修复问题
- **代码格式化**：`npm run prettier:fix` - Prettier 代码格式化
- **测试**：`npm test` - 当前显示 "no test specified"（基础占位符）

### 主要 CLI 命令

该工具提供多个子命令用于不同的媒体处理任务：

- `test` / `tt` - 测试命令（默认，显示帮助）
- `run` / `execute` - 执行测试任务和操作
- `compress` / `cs` - 压缩图像到目标大小
- `dcimr` / `dm` - 根据 EXIF 元数据（日期等）重命名媒体文件
- `organize` / `oz` - 按文件修改日期整理图片
- `lrmove` / `lv` - 移动 RAW 文件的 JPEG 输出
- `remove` / `rm` - 根据大小/宽高/名称模式删除文件
- `moveup` / `mp` - 移动文件到父级/顶层文件夹
- `move` / `md` - 按文件名日期模式移动文件
- `pick` - 智能照片选择，用于创建照片日记，具有复杂的时间过滤算法
- `prefix` / `pf` - 通过添加目录名或字符串前缀重命名文件
- `rename` / `fn` - 修复编码、正则替换、清理字符、繁体转简体中文
- `zipu` - 智能解压，自动检测编码
- `decode` / `dc` - 解码包含乱码或无效字符的文本
- `ffmpeg` / `transcode` - 使用 ffmpeg 转换音频/视频文件

## 代码架构详解

### 主入口点
**index.js**：使用 yargs 进行命令解析的主要 CLI 入口点

```javascript
// 核心导入
import yargs from "yargs"
import * as log from"./lib/debug.js"
import { errorHandler, handleError } from "./lib/errors.js"

// 全局错误处理
process.on("uncaughtException", async (err) => {
    try {
        await handleError(err, { context: "uncaughtException" })
    } catch (e) {
        console.error("Fatal uncaughtException:", e)
        process.exit(1)
    }
})

// 命令注册
const ya = yargs(process.argv.slice(2))
    .command(await import("./cmd/cmd_run.js"))
    .command(await import("./cmd/cmd_dcim.js"))
    .command(await import("./cmd/cmd_compress.js"))
    // ... 其他命令
```

### 命令结构
**cmd/**：包含各个命令模块（cmd_*.js 文件）

每个命令模块的标准结构：
```javascript
// cmd/cmd_compress.js 示例
export { aliases, builder, command, describe, handler }

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = t("compress.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("quality", {
        alias: "q",
        type: "number",
        default: QUALITY_DEFAULT,
        description: t("compress.quality")
    })
    // ... 更多选项
}

const handler = async function cmdCompressTask(argv) {
    // 命令处理逻辑
}
```

### 核心库文件详解

#### **lib/debug.js**：综合日志系统
```javascript
// 彩色输出函数
export const showRed = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.red(a))))
}

// 文件日志记录
export const fileLog = (logText, logTag = "", logFileName = "mediac") => {
    const dt = dayjs().format("HH:mm:ss.SSS")
    const name = fileLogPath(logFileName)
    const cache = fileLogCache.get(name) || []
    cache.push(`[${dt}][${logTag}] ${logText}`)
    fileLogCache.set(name, cache)
}

// 日志级别控制
export const setVerbose = (level) => log.setLevel(Math.max(0, log.levels.WARN - level))
```

#### **lib/core.js**：核心工具和共享函数
包含文件处理、路径操作、通用工具函数等。

#### **lib/file.js**：文件系统操作
```javascript
// 文件遍历功能
export const walk = async function (root, options = {}) {
    const walker = new fdir()
        .withBasePath()
        .withFullPaths()

    if (options.entryFilter) {
        walker.withFilter(options.entryFilter)
    }

    const files = await walker.crawl(root).withPromise()
    return files
}
```

#### **lib/exif.js**：EXIF 元数据处理
```javascript
// EXIF 数据提取
export const getExifData = async function (filePath) {
    try {
        const exif = await exiftool.read(filePath)
        return {
            date: exif.DateTimeOriginal || exif.CreateDate,
            camera: exif.Make + " " + exif.Model,
            // ... 其他 EXIF 数据
        }
    } catch (error) {
        log.error("EXIF extraction failed:", error)
        return null
    }
}
```

#### **lib/helper.js**：通用辅助函数
包含输入验证、文件类型检测、进程管理等工具函数。

#### **lib/errors.js**：集中错误处理
```javascript
// 统一错误处理器
export const handleError = async function (error, context = {}) {
    const errorInfo = {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: new Date().toISOString()
    }

    log.error("Error occurred:", errorInfo)

    // 根据错误类型采取不同处理策略
    if (error.code === 'ENOENT') {
        log.showRed("文件不存在:", error.path)
    }
    // ... 其他错误处理
}
```

#### **lib/i18n.js**：国际化支持
```javascript
// 多语言支持系统
export const i18n = {
    'compress.description': '压缩输入图像到目标大小',
    'compress.quality': '输出图像质量',
    // ... 更多翻译键
}

export const t = (key) => {
    return i18n[key] || key
}
```

#### **lib/ffmpeg_presets.js**：FFmpeg 配置预设
包含各种视频/音频转换的预定义配置参数。

#### **lib/media_parser.js**：媒体文件解析
用于解析各种媒体格式的元数据和属性。

#### **lib/unicode.js**：Unicode 和字符编码
```javascript
// 字符编码检测和转换
export const detectEncoding = async function (buffer) {
    const detected = await chardet.detect(buffer)
    return detected
}

// 文本编码转换
export const convertEncoding = function (text, fromEncoding, toEncoding = 'utf8') {
    return iconv.encode(iconv.decode(text, fromEncoding), toEncoding)
}
```

#### **lib/encoding.js**：文本编码检测和转换
提供详细的编码识别和转换功能。

### 数据和配置文件

- **data/**：包含 JSON 数据文件，如字符集、媒体信息等
- **scripts/**：开发和维护脚本
- **eslint.config.js**：ESLint 配置（ESLint v9+ 扁平配置格式）
- **.prettierrc.json**：Prettier 格式化配置

## 技术栈详解

### 核心依赖

- **yargs** (^17.7.2)：命令行参数解析，提供命令注册、选项定义、帮助生成
- **sharp** (^0.34.5)：高性能图像处理，支持格式转换、压缩、调整大小
- **exiftool-vendored** (^35.6.0)：EXIF 元数据提取和操作
- **chalk** (^5.3.0)：终端字符串样式化，提供彩色输出
- **cli-progress** (^3.12.0)：进度条显示，用于长时间运行的操作
- **p-map** (^7.0.4)：基于 Promise 的并行映射，控制并发处理
- **dayjs** (^1.11.19)：轻量级日期时间处理库
- **fs-extra** (^11.3.3)：扩展的文件系统方法，提供 Promise 支持
- **inquirer** (^9.2.19)：交互式命令行提示
- **execa** (^9.6.1)：改进的子进程执行，用于调用外部工具如 ffmpeg
- **file-type** (^19.0.0)：文件类型检测，通过文件头识别格式
- **chardet** (^2.0.0)：字符编码检测
- **iconv-lite** (^0.6.3)：字符编码转换
- **micromatch** (^4.0.5)：模式匹配，用于文件过滤
- **p-queue** (^8.0.1)：Promise 队列，控制并发操作
- **adm-zip** (^0.5.12)：ZIP 文件处理
- **unzipper** (^0.11.3)：ZIP 解压功能

### 开发依赖

- **@eslint/js** (^10.0.1)：ESLint 核心
- **eslint-config-prettier** (^10.1.8)：Prettier ESLint 集成
- **eslint-plugin-prettier** (^5.5.5)：Prettier 插件
- **prettier** (^3.8.1)：代码格式化
- **globals** (^17.3.0)：JavaScript 全局变量定义

## 关键文件及其功能详解

### 配置文件

#### **package.json**
```json
{
  "name": "mediac",
  "version": "2.0.0",
  "type": "module", // 使用 ES 模块
  "main": "index.js",
  "bin": {
    "mediac": "./index.js" // CLI 命令映射
  },
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "start": "node index.js",
    "check": "node ./scripts/check_syntax.cjs",
    "lint": "eslint . --ext .js",
    "lint:fix": "eslint . --ext .js --fix",
    "prettier:fix": "prettier --write ."
  }
}
```

#### **eslint.config.js**
```javascript
// ESLint v9+ 扁平配置格式
export default [
  // 1. 基础 ESLint 推荐规则
  eslint.configs.recommended,

  // 2. Node.js 环境配置
  {
    languageOptions: {
      globals: {
        ...nodeGlobals.node, // Node 全局变量
        es2021: true,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-console": "off", // 允许 console.log
      "no-unused-vars": "off", // 未使用变量仅警告
    },
  },

  // 3. Prettier 集成
  {
    plugins: {
      prettier: prettierPlugin,
    },
    rules: prettierRules,
  },
]
```

#### **.prettierrc.json**
```json
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 4
}
```

### 文档文件
- **README.md**：项目概述、安装说明、使用示例
- **docs/**：额外文档，包括错误处理和国际化指南

### 入口点
- **index.js**：主 CLI 应用程序入口点
- **package.json** bin 字段：将 `mediac` 命令映射到 `index.js`

## 开发模式和架构设计

### 模块结构
- ES 模块（import/export 语法）
- 每个命令是独立的模块，具有标准化的导出
- 共享工具按功能组织在 lib/ 目录中

### 命令模式
```javascript
// 命令模块标准结构
export { aliases, builder, command, describe, handler }

// 命令定义
const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = "压缩图像命令"

// 选项构建器
const builder = (ya) => {
  return ya.option("quality", {
    alias: "q",
    type: "number",
    default: 86,
    description: "输出质量"
  })
}

// 命令处理器
const handler = async (argv) => {
  // 命令执行逻辑
}
```

### 错误处理架构

#### 集中式错误处理
```javascript
// lib/errors.js
export const handleError = async function (error, context = {}) {
    const errorInfo = {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: new Date().toISOString()
    }

    // 记录错误
    log.error("Error occurred:", errorInfo)

    // 根据错误类型处理
    switch (error.code) {
        case 'ENOENT':
            log.showRed("文件不存在:", error.path)
            break
        case 'EPERM':
            log.showRed("权限不足，无法访问文件")
            break
        default:
            log.showRed("未知错误:", error.message)
    }
}
```

#### 全局错误捕获
```javascript
// index.js 中的全局错误处理
process.on("uncaughtException", async (err) => {
    try {
        await handleError(err, { context: "uncaughtException" })
    } catch (e) {
        console.error("Fatal uncaughtException:", e)
        process.exit(1)
    }
})

process.on("unhandledRejection", async (reason) => {
    try {
        await handleError(reason, { context: "unhandledRejection" })
    } catch (e) {
        console.error("Fatal unhandledRejection:", e)
        process.exit(1)
    }
})
```

### 日志系统设计

#### 多级别日志
```javascript
// lib/debug.js
export const debug = function () {
    log.debug(...arguments)
}

export const info = function () {
    log.info(...arguments)
}

export const warn = function () {
    log.warn(...arguments)
}

export const error = function () {
    log.error(...arguments)
}
```

#### 彩色输出
```javascript
export const showRed = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.red(a))))
}

export const showGreen = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.green(a))))
}

export const showYellow = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.yellow(a))))
}
```

#### 文件日志
```javascript
// 文件日志缓存
const fileLogCache = new Map()

export const fileLog = (logText, logTag = "", logFileName = "mediac") => {
    const dt = dayjs().format("HH:mm:ss.SSS")
    const name = fileLogPath(logFileName)
    const cache = fileLogCache.get(name) || []
    cache.push(`[${dt}][${logTag}] ${logText}`)
    fileLogCache.set(name, cache)
}

export const flushFileLog = async () => {
    for (const [key, value] of fileLogCache) {
        try {
            await fs.appendFile(key, value.join("\n"), { encoding: "utf-8" })
        } catch (error) {
            log.show(error)
        }
    }
}
```

### 国际化设计

```javascript
// lib/i18n.js
export const i18n = {
    'app.description': 'MediaCli 是一个多媒体文件处理工具',
    'app.copyright': '版权所有 2021-2026 @ Zhang Xiaoke',
    'compress.description': '压缩输入图像到目标大小',
    'compress.quality': '输出图像质量 (1-100)',
    'compress.delete.source': '压缩后删除源文件',
    // ... 更多翻译
}

export const t = (key) => {
    return i18n[key] || key
}
```

## 特定命令功能详解

### `pick` 命令（智能照片选择）

```javascript
// cmd/cmd_pick.js 核心逻辑
async function cmdPickTask(argv) {
    // 1. 遍历输入目录，收集所有照片
    const files = await mf.walk(inputDir, {
        entryFilter: (f) => f.isFile && helper.isImageFile(f.path)
    })

    // 2. 按日期分组照片
    const photosByDate = groupPhotosByDate(files)

    // 3. 应用选择规则
    const selectedPhotos = []

    for (const [date, photos] of Object.entries(photosByDate)) {
        // 每天选择 1/5 的照片，最多 50 张
        const dailyLimit = Math.min(50, Math.ceil(photos.length / 5))

        // 如果当天照片少于 5 张，则全部选择
        const toSelect = photos.length < 5 ? photos.length : dailyLimit

        // 按时间排序并平均分布选择
        const sortedPhotos = photos.sort(byDateTime)
        const selected = selectEvenlyDistributed(sortedPhotos, toSelect)

        selectedPhotos.push(...selected)
    }

    // 4. 应用月度限制（最多 1000 张）
    if (selectedPhotos.length > 1000) {
        selectedPhotos = reduceByMonthlyLimit(selectedPhotos, 1000)
    }

    // 5. 生成统计报告
    generateStatsReport(selectedPhotos)
}
```

### `compress` 命令（图像压缩）

```javascript
// cmd/cmd_compress.js 核心功能
async function cmdCompressTask(argv) {
    // 1. 参数验证和处理
    const inputDir = await helper.validateInput(argv.input)
    const outputDir = argv.output || inputDir

    // 2. 查找图像文件
    const files = await mf.walk(inputDir, {
        entryFilter: (f) => f.isFile && helper.isImageFile(f.path)
    })

    // 3. 并行处理图像
    const progressBar = new cliProgress.SingleBar({})
    progressBar.start(files.length, 0)

    await pMap(files, async (file) => {
        try {
            // 计算压缩参数
            const params = calculateCompressParams(file, argv)

            // 执行压缩
            const result = await compressImage(file.path, outputDir, params)

            // 如果指定删除源文件
            if (argv.deleteSourceFiles && result.success) {
                await fs.remove(file.path)
            }

        } catch (error) {
            log.error(`压缩失败 ${file.path}:`, error.message)
        }

        progressBar.increment()
    }, { concurrency: cpus().length }) // 使用 CPU 核心数作为并发数

    progressBar.stop()
}

// 图像压缩核心函数
export const compressImage = async function (inputPath, outputDir, params) {
    try {
        const image = sharp(inputPath)
        const metadata = await image.metadata()

        // 计算缩放比例
        const scale = calculateScale(metadata.width, metadata.height, params.maxWidth)

        // 应用压缩设置
        if (scale < 1) {
            image.resize(Math.round(metadata.width * scale))
        }

        image.jpeg({ quality: params.quality })

        // 构建输出路径
        const outputPath = path.join(outputDir,
            applyFileNameRules(path.basename(inputPath), params.suffix))

        await image.toFile(outputPath)

        return { success: true, outputPath }

    } catch (error) {
        return { success: false, error: error.message }
    }
}
```

## 测试和质量保证

- 基础的 ESLint 设置，集成了 Prettier
- 语法检查脚本可用
- 当前没有正式的测试框架（测试脚本为占位符）
- 通过 CLI 命令进行手动测试

## 常见开发任务

### 添加新命令

1. 在 `cmd/` 目录创建新文件，遵循 `cmd_[name].js` 模式
2. 导出必需的 yargs 命令属性：command、aliases、describe、builder、handler
3. 在 `index.js` 中添加命令导入和注册
4. 在 `lib/i18n.js` 中添加相应的国际化字符串

```javascript
// 新命令模板
import chalk from "chalk"
import * as log from "../lib/debug.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

export { aliases, builder, command, describe, handler }

const command = "newcmd <input>"
const aliases = ["nc"]
const describe = t("newcmd.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("example", {
        alias: "e",
        type: "string",
        description: "示例选项"
    })
}

const handler = async function cmdNewTask(argv) {
    log.info("执行新命令", argv)
    // 命令逻辑
}
```

### 处理媒体文件

- 使用 `lib/file.js` 进行文件操作
- 使用 `lib/exif.js` 进行元数据提取
- 使用 `sharp` 进行图像处理
- 使用 `lib/ffmpeg_presets.js` 进行视频/音频转换预设

### 添加依赖

- 运行时依赖：`npm install [package]`
- 开发依赖：`npm install --save-dev [package]`
- 确保与现有工具链兼容（ES 模块、Node.js 版本）

## 环境要求

- Node.js（兼容 ES 模块和依赖项的版本）
- 外部工具：ffmpeg、ffprobe、exiftool（用于完整功能）
- 建议全局安装以使用 CLI 功能