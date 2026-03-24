# MediaCli

[查看中文文档](README_zh.md)

MediaCli is a comprehensive multimedia file processing CLI tool. Specifically designed for
photographers and media collectors, it leverages powerful tools like **ffmpeg** and **exiftool** to
efficiently compress, convert, organize, rename, and manage image, video, and audio files.

## Features

- **Smart Organization**: Organize photos and videos by date (EXIF metadata or file attributes).
- **Batch Processing**: Compress images, convert videos/audio, and rename files in bulk.
- **File Management**: Intelligent file moving, deletion, and directory flattening.
- **Encoding Fixes**: Detect and fix filename encoding issues (e.g., GBK, Shift-JIS) and smart
  unzip.
- **Raw Workflow**: Utilities to manage RAW + JPEG workflows.

## Installation

Install globally via npm:

```bash
npm install mediac -g
```

Or run locally:

```bash
git clone https://github.com/mcxiaoke/media-cli.js.git
cd media-cli.js
npm install
npm start -- --help
```

## Usage

Basic usage syntax:

```bash
mediac <command> <input> [options]
```

To see help for a specific command:

```bash
mediac <command> --help
```

### Commands

| Command    | Aliases      | Description                                                                       |
| ---------- | ------------ | --------------------------------------------------------------------------------- |
| `compress` | `cs`, `cps`  | **Compress images** to target size/quality while preserving metadata.             |
| `dcimr`    | `dm`, `dcim` | **Rename media files** based on EXIF Date/Time or file attributes.                |
| `organize` | `oz`         | **Organize files** into date-based folder structures (e.g., 2023/10).             |
| `ffmpeg`   | `transcode`  | **Convert video/audio** using FFmpeg presets.                                     |
| `pick`     | -            | **Smart photo selection** for photo journals (filters by time/date distribution). |
| `lrmove`   | `lv`         | **Move JPEG files** that have matching RAW files to a separate folder.            |
| `remove`   | `rm`         | **Delete files** matching specific size, resolution, or name patterns.            |
| `moveup`   | `mp`         | **Flatten directories** by moving files to parent/top folders.                    |
| `move`     | `md`         | **Move files** to folders based on date patterns in filenames.                    |
| `prefix`   | `pf`         | **Batch rename** by prepending directory names or custom strings.                 |
| `rename`   | `fn`         | **Advanced rename** (fix encoding, regex replace, char cleanup, TC to SC).        |
| `zipu`     | `zipunicode` | **Smart Unzip** detecting filename encoding automatically.                        |
| `decode`   | `dc`         | **Decode text** containing messy or invalid characters.                           |

## Decode Command Detailed Usage

The `decode` command is used to identify and fix encoding issues in text, particularly for filenames or text content that appears garbled due to encoding mismatches.

### Usage

```bash
mediac decode [strings...] [options]
```

### Options

| Option        | Alias | Type    | Description                                  |
| ------------- | ----- | ------- | -------------------------------------------- |
| `--from-enc`  | `-f`  | string  | Source encoding to try first                 |
| `--to-enc`    | `-t`  | string  | Target encoding to convert to                |
| `--files`     | `-i`  | array   | Files to process (supports wildcards)        |
| `--recursive` | `-r`  | boolean | Recursively process files in subdirectories  |

### Examples

1. **Decode a single garbled string:**
   ```bash
   mediac decode "乱码字符串"
   ```

2. **Decode multiple strings:**
   ```bash
   mediac decode "乱码1" "乱码2" "乱码3"
   ```

3. **Decode with specific encoding settings:**
   ```bash
   mediac decode --from-enc gbk --to-enc utf8 "乱码字符串"
   ```

4. **Decode files:**
   ```bash
   mediac decode --files *.txt
   ```

5. **Recursively decode files in subdirectories:**
   ```bash
   mediac decode --files **/*.txt --recursive
   ```

### Supported Encodings

The decode command supports a wide range of encodings, including:
- UTF-8, UTF-16, UTF-32
- GBK, BIG5
- SHIFT_JIS, EUC-JP
- EUC-KR, CP949
- ISO-8859-1, ISO-8859-2

### How It Works

The decode command uses an intelligent approach to detect and fix encoding issues:
1. It first analyzes the input text to identify potential encoding problems
2. It then tries different encoding combinations to find the best match
3. It evaluates the quality of each decoding attempt
4. It returns the best decoding result with confidence scores

This makes it particularly effective for fixing filenames that were encoded in one encoding and displayed in another, a common issue when transferring files between different systems.

## Development

### Prerequisites

- Node.js (v18+)
- Tools: `ffmpeg`, `ffprobe`, `exiftool` must be installed and available in PATH for full
  functionality.

### Scripts

- `npm run check`: Verify syntax.
- `npm run lint`: Lint code with ESLint.
- `npm run lint:fix`: Fix linting errors.
- `npm run prettier:fix`: Format code with Prettier.
- `npm start`: Run the CLI locally.

## License

Copyright 2021-2026 @ Zhang Xiaoke.

Licensed under the [Apache License 2.0](LICENSE).
