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
