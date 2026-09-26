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

> 下表由已注册的 yargs 命令生成（`node mediac --help`）。
> 此前列出的 `organize` / `oz` 命令并不存在。

| 命令                 | 别名                                    | 描述                                                             |
| -------------------- | --------------------------------------- | ---------------------------------------------------------------- |
| `compress`           | `cs`, `cps`                             | **压缩图像**：将图像压缩到目标大小或质量，保留元数据。           |
| `dcimr`              | `dm`, `dcim`                            | **重命名**：根据 EXIF 拍摄时间或文件属性重命名媒体文件。         |
| `decode`             | `dc`                                    | **文本解码**：解码包含乱码或无效字符的文本字符串。               |
| `execute [input]`    | `run`                                   | **运行独立任务**：目前仅为占位，尚未实现。                       |
| `ffmpeg`             | `transcode`, `aconv`, `vconv`, `avconv` | **格式转换**：使用 FFmpeg 预设转换视频或音频文件。               |
| `lrmove`             | `lv`                                    | **RAW 分离**：移动与 RAW 文件匹配的 JPEG 文件到指定文件夹。      |
| `move`               | `md`                                    | **移动文件**：根据文件名中的日期模式将文件移动到相应文件夹。     |
| `moveup`             | `mp`                                    | **目录扁平化**：将文件移动到上级目录或顶层目录。                 |
| `pick`               | `pk`                                    | **智能精选**：为照片日记筛选照片（基于时间分布算法）。           |
| `prefix`             | `pf`, `px`                              | **前缀重命名**：通过添加目录名或自定义字符串前缀重命名文件。     |
| `remove`             | `rm`, `rmf`                             | **删除文件**：根据文件大小、分辨率或名称模式批量删除文件。       |
| `rename`             | `fn`, `fxn`                             | **高级重命名**：修复文件名编码、正则替换、清理字符、繁简转换等。 |
| `test`（默认）       | `tt`                                    | 空操作命令，用于冒烟测试 CLI。                                   |
| `zipu`               | `zipunicode`                            | **智能解压**：自动检测文件名编码并解压 ZIP 文件，解决乱码问题。  |

## FFmpeg 转码命令

`mediac ffmpeg <输入>`（别名 `transcode` / `aconv` / `vconv` / `avconv`）基于预设转换视频与音频，
由一套硬件加速感知引擎驱动。完整参数手册与注意事项见
[docs/FFMPEG-USAGE.md](docs/FFMPEG-USAGE.md)。

反映当前实现的关键点：

- **默认 dry-run（试跑）。** 不加 `--doit` 只做扫描、选层、拼命令并落盘日志，**不产出任何文件**；
  加 `--doit` 才真正转码。
- **`--preset` 必填**（无默认预设），用 `--show-presets` 查看全部预设。
- **自动硬件分层。** 逐文件探测 CUDA / QSV / AMF / D3D11VA / 软解+硬编 / 纯 CPU 并平滑降级；
  编码器由所选层与预设的输出 codec 族共同决定（**不受输入位深影响**）。可用 `--hwaccel` /
  `--decode-mode` 干预，`--strict` 关闭一切降级（不支持的文件跳过而非重试）。
- **预设是 YAML、分层且可继承。** 内置单一来源为 `presets/default.yaml`（h264 / hevc / av1 / vp9 /
  音频族），用户层为 `~/.mediac/presets.yaml` 与 `./presets.yaml`；覆盖内置同名预设必须显式
  `_override: true`。
- **滤镜与额外编码参数写在预设 YAML 里，不走命令行。** `--video-args` / `--audio-args` /
  `--filters` 三个选项已在 S-4 重构中移除；请改用预设字段：`filters`（含 `{scaleFilter}` 占位符）、
  `pre_filters` / `post_filters`（三段式滤镜链）、`inputArgs` / `streamArgs` / `outputArgs`。
  换编码器请用 `--video-codec` 或 `--ffargs "vc=..."`，不要自行注入 `-c:v`。
- **`--metadata` 专用通道**，值可含空格；`--ffargs` 的键值分隔符是 `;` `:` `#`（不是逗号）。
- **内置安全护栏。** 智能码率（不超源、不放大）、临时文件写入 + 中断清理、`--delete-source-files`
  仅在产物非空时把源文件移入回收站（dry-run 绝不删除）。

```bash
# 先预览将执行的命令，再真正运行
mediac ffmpeg ./video.mp4 --preset hevc_2k
mediac ffmpeg ./video.mp4 --preset hevc_2k --doit
```

## 开发指南

### 环境要求

- Node.js (v22+)
- 外部工具：为了使用完整功能，请确保系统中安装了 `ffmpeg`, `ffprobe`, 和 `exiftool`
  并已添加到 PATH。

### 常用脚本

- `npm run check`: 语法检查。
- `npm run lint`: 使用 ESLint 检查代码质量。
- `npm run test:package`: 打包、隔离安装并冒烟测试 npm 发布产物。
- `npm run lint:fix`: 自动修复 ESLint 问题。
- `npm run prettier:fix`: 使用 Prettier 格式化代码。
- `npm start`: 本地运行 CLI 工具。

## 许可证

版权所有 2021-2026 @ Zhang Xiaoke

本项目采用 [Apache License 2.0](LICENSE) 许可证。
