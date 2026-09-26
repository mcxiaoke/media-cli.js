# AGENTS.md

本文档为 AI 编码助手（Claude Code 及其他通用 agent）提供在此仓库中工作的指导。

> 说明：仓库原先的 `CLAUDE.md` 已更名为 `AGENTS.md`，二者不再并存。

## 项目概述

MediaCli（npm 包名 `mediac`，当前版本 2.0.0）是一个基于 Node.js 开发的多媒体文件处理命令行工具，利用 ffmpeg、exiftool 等工具对图像、视频和音频文件进行压缩、转换、重命名、删除和组织整理。该工具设计为通过 npm 全局安装使用的 CLI 工具。

## 命令和工作流

### 安装和设置
- 全局安装：`npm install mediac -g`
- 本地运行：`npm start` 或 `node index.js`
- CLI 使用：`mediac --help` 或 `node index.js --help`

### 开发命令
- **语法检查**：`npm run check` - 使用 `scripts/check_syntax.cjs` 进行语法验证
- **代码检查**：`npm run lint` - ESLint 代码质量检查（根配置扫 CLI/核心的 `.js`，并串联桌面端 `desktop:lint`）
- **桌面端检查**：`npm run desktop:lint`（TS + Vue SFC，配置在 `apps/mediac-desktop/eslint.config.js`）、`npm run desktop:typecheck`

### 主要 CLI 命令

该工具提供多个子命令用于不同的媒体处理任务：

- `test` / `tt` - 测试命令（默认，显示帮助）
- `run` / `execute` - 执行测试任务和操作
- `compress` / `cs` - 压缩图像到目标大小
- `dcimr` / `dm`, `dcim` - 根据 EXIF 元数据（日期等）重命名媒体文件
- `lrmove` / `lv` - 移动 RAW 文件的 JPEG 输出
- `remove` / `rm` - 根据大小/宽高/名称模式删除文件
- `moveup` / `mp` - 移动文件到父级/顶层文件夹
- `move` / `md` - 按文件名日期模式移动文件
- `pick` - 智能照片选择，用于创建照片日记，支持 Burst 模式和感知哈希去重
- `prefix` / `pf` - 通过添加目录名或字符串前缀重命名文件
- `rename` / `fn` - 修复编码、正则替换、清理字符、繁体转简体中文
- `zipu` - 智能解压，自动检测编码
- `decode` / `dc` - 解码包含乱码或无效字符的文本
- `ffmpeg` / `transcode`, `aconv`, `vconv`, `avconv` - 使用 ffmpeg 预设转换音频/视频文件（硬件分层、**默认 dry-run，需 `--doit` 才执行**，详见 `docs/FFMPEG-USAGE.md`）

## 开发规范

### 模块结构
- ES 模块（import/export 语法）
- 每个命令是独立的模块，导出 command、aliases、describe、builder、handler
- `src/transcode/` 集中存放转码领域实现，CLI/Electron 统一从其 `index.js` facade 导入
- `lib/` 暂存其余共享工具，是 legacy 平铺层；不再承接新的跨领域职责
- 依赖边界由 `test/test_architecture_boundaries.js` 强制守卫：`lib/` 不得 import `cmd/`、`src/`、`apps/`；Electron main 不得 import `cmd/`；Electron renderer/preload 不得 import 根 `src/`、`lib/`、`cmd/`；Electron main 的媒体元数据探测必须经 transcode facade（禁止直连 `lib/mediainfo.js`）
- 桌面端统一从根项目调用：`npm run desktop:dev|typecheck|lint|build|test:e2e|package:win`

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
- 发布包安装态检查：`npm run test:package`
- `data/` 为不入库的本地媒体测试语料；依赖其中的用例在目录缺失时会 skip

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
- 视频/音频转换（ffmpeg）：实现集中在 `src/transcode/`，外部调用方只经该目录的 `index.js`
  - `cmd/cmd_ffmpeg.js`：命令入口（校验、扫描、任务编排、确认、汇总）
  - `presets/default.yaml`：内置预设唯一事实源（分层 YAML，支持 `extends` 继承与 `_override` 覆盖）
  - `src/transcode/preset_loader.js` / `ffmpeg_presets.js`：预设加载与对象模型；`lib/arg_parser.js`：共享 `--ffargs` 解析
  - `src/transcode/hwaccel.js` / `hwdetect.js` / `gpu.js`：硬件分层与编码器矩阵 / 本机能力探测 / GPU 支持矩阵
  - `src/transcode/ffmpeg_plan.js` / `ffmpeg_build.js` / `ffmpeg_run.js` / `ffmpeg_bin.js`：目标参数计算 / 命令行拼装 / 单文件执行 / 二进制定位
  - 完整参数与注意事项见 **`docs/FFMPEG-USAGE.md`**
  - 改动 ffmpeg 编码/滤镜参数前，须用真机 `ffmpeg -h encoder=X` 与 1 帧 `-f null -` 逐选项核验，勿凭文档臆造调优项

### 添加依赖

- 运行时依赖：`npm install [package]`
- 开发依赖：`npm install --save-dev [package]`
- 确保兼容 ES 模块

## 环境要求

- Node.js **>= 22**（见 `package.json` 的 `engines`，ES 模块）
- 外部工具：ffmpeg、ffprobe、exiftool（用于完整功能）
- ffmpeg 二进制定位优先级：`FFMPEG_PATH` → `FFMPEG_BINARY` → `PATH`（`which`）；可用 `MEDIAC_AUTO_CONFIRM` 跳过交互确认
- 开发机本机预装多版本 ffmpeg，位于 `C:\Home\Apps\ffmpeg`（每目录内含 `ffmpeg.exe`/`ffprobe.exe`）：
  - `bin` → **N-126733（master，2026-09-20）**：开发默认，PATH 中的 `ffmpeg` 即指向它；硬件/编码器参数本期全部基于它实测核准
  - `ff7` → n7.1.1；`ff8` → 8.1.2（gyan.dev）；`ff9` → 9.0.1（gyan.dev）
  - `nomercy-ffmpeg-8` → 8.1.2；`nomercy-ffmpeg-9` → 9.0（NoMercy MediaServer）
  - 另含 `NVEncC`/`QSVEncC`/`VCEEncC` 等视频编码 CLI、`presets`
  - 跨版本验证或复现版本差异时，直接以绝对路径调用对应版本（如 `C:\Home\Apps\ffmpeg\ff9\ffmpeg.exe`）
  - 测试素材见本地开发语料 `data/videos/`（该目录被 Git 忽略；`TEST2__*` 覆盖 h264/hevc/av1/vp9 与 8/10bit/422 等组合）
- 建议全局安装以使用 CLI 功能
