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

### 主要 CLI 命令

该工具提供多个子命令用于不同的媒体处理任务：

- `test` / `tt` - 测试命令（默认，显示帮助）
- `run` / `execute` - 执行测试任务和操作
- `compress` / `cs` - 压缩图像到目标大小
- `dcim` / `dm` - 根据 EXIF 元数据（日期等）重命名媒体文件
- `lrmove` / `lv` - 移动 RAW 文件的 JPEG 输出
- `remove` / `rm` - 根据大小/宽高/名称模式删除文件
- `moveup` / `mp` - 移动文件到父级/顶层文件夹
- `move` / `md` - 按文件名日期模式移动文件
- `pick` - 智能照片选择，用于创建照片日记，支持 Burst 模式和感知哈希去重
- `prefix` / `pf` - 通过添加目录名或字符串前缀重命名文件
- `rename` / `fn` - 修复编码、正则替换、清理字符、繁体转简体中文
- `zipu` - 智能解压，自动检测编码
- `decode` / `dc` - 解码包含乱码或无效字符的文本
- `ffmpeg` / `transcode` - 使用 ffmpeg 转换音频/视频文件

## 技术栈

### 核心依赖

- **yargs** (^17.7.2)：命令行参数解析
- **sharp** (^0.34.5)：高性能图像处理
- **exiftool-vendored** (^35.6.0)：EXIF 元数据提取
- **chalk** (^5.3.0)：终端彩色输出
- **cli-progress** (^3.12.0)：进度条显示
- **p-map** (^7.0.4)：并行映射处理
- **dayjs** (^1.11.19)：日期时间处理
- **fs-extra** (^11.3.3)：扩展文件系统
- **execa** (^9.6.1)：子进程执行
- **chardet** (^2.0.0)：字符编码检测
- **iconv-lite** (^0.6.3)：字符编码转换
- **micromatch** (^4.0.5)：模式匹配
- **p-queue** (^8.0.1)：Promise 队列
- **adm-zip** (^0.5.12)：ZIP 文件处理
- **music-metadata** (^7.14.0)：音频元数据
- **image-hash** (^7.0.1)：图像感知哈希

### 开发依赖

- **eslint** (^10.0.0)：代码检查
- **prettier** (^3.8.1)：代码格式化
- **c8** (^11.0.0)：测试覆盖率

## 开发规范

### 模块结构
- ES 模块（import/export 语法）
- 每个命令是独立的模块，导出 command、aliases、describe、builder、handler
- 共享工具按功能组织在 lib/ 目录中

### 命令模式
```javascript
// 命令模块标准结构
export { aliases, builder, command, describe, handler }

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = t("compress.description")

const builder = (ya) => {
  return ya.option("quality", { alias: "q", type: "number" })
}

const handler = async (argv) => {
  // 命令执行逻辑
}
```

### 国际化
- 使用 `lib/i18n.js` 提供中英文双语支持
- 翻译函数：`t("key", { param: value })`
- 自动检测系统语言

### 错误处理
- 使用 `lib/errors.js` 集中处理错误
- 全局错误捕获：uncaughtException、unhandledRejection
- 错误码定义：`lib/error-codes.js`

### 日志系统
- 使用 `lib/debug.js` 提供多级别日志
- 支持彩色终端输出
- 支持文件日志记录

## 测试

- 使用 Node.js 内置测试框架
- 测试文件位于 `test/` 目录
- 运行测试：`npm test`

## 常见开发任务

### 添加新命令

1. 在 `cmd/` 目录创建新文件 `cmd_[name].js`
2. 导出必需属性：command、aliases、describe、builder、handler
3. 在 `index.js` 中添加命令导入：`.command(await import("./cmd/cmd_[name].js"))`
4. 在 `lib/i18n.js` 中添加相应的翻译字符串

### 处理媒体文件

- 文件操作：`lib/file.js`
- EXIF 元数据：`lib/exif.js`
- 图像处理：`sharp` 库
- 视频/音频转换：`lib/ffmpeg_presets.js`

### 添加依赖

- 运行时依赖：`npm install [package]`
- 开发依赖：`npm install --save-dev [package]`
- 确保兼容 ES 模块

## 环境要求

- Node.js（兼容 ES 模块和依赖项的版本）
- 外部工具：ffmpeg、ffprobe、exiftool（用于完整功能）
- 建议全局安装以使用 CLI 功能
