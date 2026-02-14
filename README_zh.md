# MediaCli

[English Documentation](README.md)

MediaCli 是一个基于 Node.js 开发的功能强大的多媒体文件处理命令行工具。它专为摄影师和媒体收藏者设计，利用
**ffmpeg** 和 **exiftool** 等工具，对图像、视频和音频文件进行高效的压缩、转换、整理、重命名和管理。

## 主要功能

- **智能整理**：根据 EXIF 元数据或文件属性按日期整理照片和视频。
- **批量处理**：批量压缩图像、转换音视频格式、重命名文件。
- **文件管理**：智能移动、删除文件，以及扁平化目录结构。
- **编码修复**：检测并修复文件名编码问题（如乱码修复），以及智能解压（自动识别编码）。
- **RAW 工作流**：管理 RAW + JPEG 文件的配套移动和整理。

## 安装

通过 npm 全局安装：

```bash
npm install mediac -g
```

或者本地开发运行：

```bash
git clone https://github.com/mcxiaoke/media-cli.js.git
cd media-cli.js
npm install
npm start -- --help
```

## 使用方法

基本用法：

```bash
mediac <命令> <输入路径> [选项]
```

查看特定命令的帮助信息：

```bash
mediac <命令> --help
```

### 命令列表

| 命令       | 别名         | 描述                                                             |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `compress` | `cs`, `cps`  | **压缩图像**：将图像压缩到目标大小或质量，保留元数据。           |
| `dcimr`    | `dm`, `dcim` | **重命名**：根据 EXIF 拍摄时间或文件属性重命名媒体文件。         |
| `organize` | `oz`         | **整理文件**：按文件修改日期将图片整理到文件夹（如 2023/10）。   |
| `ffmpeg`   | `transcode`  | **格式转换**：使用 FFmpeg 预设转换视频或音频文件。               |
| `pick`     | -            | **智能精选**：为照片日记筛选照片（基于时间分布算法）。           |
| `lrmove`   | `lv`         | **RAW 分离**：移动与 RAW 文件匹配的 JPEG 文件到指定文件夹。      |
| `remove`   | `rm`         | **删除文件**：根据文件大小、分辨率或名称模式批量删除文件。       |
| `moveup`   | `mp`         | **目录扁平化**：将文件移动到上级目录或顶层目录。                 |
| `move`     | `md`         | **移动文件**：根据文件名中的日期模式将文件移动到相应文件夹。     |
| `prefix`   | `pf`         | **前缀重命名**：通过添加目录名或自定义字符串前缀重命名文件。     |
| `rename`   | `fn`         | **高级重命名**：修复文件名编码、正则替换、清理字符、繁简转换等。 |
| `zipu`     | `zipunicode` | **智能解压**：自动检测文件名编码并解压 ZIP 文件，解决乱码问题。  |
| `decode`   | `dc`         | **文本解码**：解码包含乱码或无效字符的文本字符串。               |

## 开发指南

### 环境要求

- Node.js (v18+)
- 外部工具：为了使用完整功能，请确保系统中安装了 `ffmpeg`, `ffprobe`, 和 `exiftool`
  并已添加到 PATH。

### 常用脚本

- `npm run check`: 语法检查。
- `npm run lint`: 使用 ESLint 检查代码质量。
- `npm run lint:fix`: 自动修复 ESLint 问题。
- `npm run prettier:fix`: 使用 Prettier 格式化代码。
- `npm start`: 本地运行 CLI 工具。

## 许可证

版权所有 2021-2026 @ Zhang Xiaoke

本项目采用 [Apache License 2.0](LICENSE) 许可证。
