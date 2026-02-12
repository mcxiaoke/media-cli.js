# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

MediaCli is a multimedia file processing tool built with Node.js that utilizes ffmpeg, exiftool, and other libraries to compress, convert, rename, delete, and organize media files including images, videos, and audio. The project is structured as a command-line application with a modular architecture.

## Commands and Development

### Installation and Usage
```bash
# Install globally
npm install mediac -g

# Show help
mediac --help

# Run the application
npm start
```

### Available Commands
The application supports the following main commands through the cmd/ directory:
- `dcimr` / `dm` / `dcim` - Rename media files by EXIF metadata (e.g., date)
- `organize` / `oz` - Organize pictures by file modified date
- `lrmove` / `lv` - Move JPEG output of RAW files to other folder
- `compress` / `cs` / `cps` - Compress input images to target size
- `remove` / `rm` / `rmf` - Remove files by size/width-height/name-pattern/file-list
- `moveup` / `mp` - Move files to sub top folder or top folder
- `move` / `md` - Move files to folders by filename date patterns
- `prefix` / `pf` / `px` - Rename files by append dir name or string
- `rename` / `fn` / `fxn` - Rename files: fix encoding, replace by regex, clean chars, from tc to sc
- `zipu` / `zipunicode` - Smart unzip command (auto detect encoding)
- `decode` / `dc` - Decode text with messy or invalid chars
- `ffmpeg` / `transcode` / `aconv` / `vconv` / `avconv` - Convert audio or video files using ffmpeg

### Development Commands
```bash
# Run tests (currently placeholder)
npm test

# Format code with Prettier
npx prettier --write .

# Lint with StandardJS
npx standard
```

## Code Architecture

### Main Entry Point
- `index.js` - CLI entry point using yargs for command parsing, imports all command modules from cmd/ directory

### Command Structure
- `cmd/` directory contains individual command modules (cmd_*.js)
- Each command follows yargs command module pattern with builder and handler functions
- Commands share common utilities through lib/ directory

### Core Libraries
- `lib/core.js` - Utility functions for async operations, array manipulation, string formatting, object operations
- `lib/debug.js` - Logging and debugging utilities
- `lib/file.js` - File system operations and utilities
- `lib/exif.js` - EXIF metadata extraction and manipulation
- `lib/media_parser.js` - Media file parsing and analysis
- `lib/ffmpeg_presets.js` - FFmpeg configuration presets
- `lib/encoding.js` - Character encoding detection and conversion
- `lib/unicode.js` - Unicode and CJK character handling
- `lib/walk.js` - File system traversal utilities
- `lib/i18n.js` - Internationalization support

### Data Files
- `data/` directory contains JSON configuration files for media info and Chinese character processing

### Key Dependencies
The project relies heavily on:
- Media processing: `ffmpeg`, `exiftool-vendored`, `sharp`, `mediainfo.js`
- File operations: `fs-extra`, `adm-zip`, `file-type`
- CLI: `yargs`, `chalk`, `inquirer`
- Encoding: `chardet`, `iconv-lite`, `js-xxhash`
- Utilities: `dayjs`, `execa`, `p-map`, `p-queue`

## Important Files and Directories

- `index.js` - Main CLI entry point
- `package.json` - Project configuration and dependencies
- `cmd/` - Command implementations
- `lib/` - Core utility libraries
- `data/` - Configuration and data files
- `labs/` - Experimental/demo scripts (not part of main application)
- `scripts/` - Additional utility scripts

## Development Patterns

1. **Async Operations**: The codebase extensively uses async/await patterns with utility functions in `lib/core.js` for parallel processing, filtering, and mapping
2. **Error Handling**: Uses functional try-catch wrappers (`tryRun`, `tryRunAsync`) from core.js
3. **File Processing**: Leverages streams and queues for efficient batch processing of media files
4. **Internationalization**: Supports CJK character processing and multiple encodings
5. **Modular Commands**: Each command is a separate module following yargs conventions

## Configuration

- `.prettierrc.json` - Code formatting configuration
- Uses ESM modules (package.json has `"type": "module"`)
- TypeScript definitions available via `@types/node`

This architecture allows for easy extension of new commands while maintaining consistent patterns for file processing, error handling, and user interaction across the application.