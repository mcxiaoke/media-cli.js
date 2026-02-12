/*
 * File: i18n.js
 * Created: 2026-02-12 09:55:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * Internationalization (i18n) System
 */

import os from "os"

// 支持的语言
export const Languages = {
    ZH_CN: "zh-CN",
    EN_US: "en-US",
}

// 翻译资源 - 每个键包含中英文
const translations = {
    // 通用消息
    "commands.lrmove.description": {
        zh: "将 RAW 目录下的 JPEG 输出文件夹移动到其他位置",
        en: "Move JPEG output of RAW files to other folder",
    },
    "commands.lrmove.total.folders": {
        zh: "共找到 {{count}} 个 JPEG 文件夹",
        en: "Total {{count}} JPEG folders found",
    },
    "commands.lrmove.nothing.to.do": { zh: "无需操作，中止执行。", en: "Nothing to do, abort." },
    "commands.lrmove.move.confirm": {
        zh: "确定要移动这 {{count}} 个包含文件的 JPEG 文件夹吗？",
        en: "Are you sure to move these {{count}} JPEG folder with files?",
    },
    "commands.lrmove.moved": { zh: "已移动: {{src}} 到 {{dst}}", en: "Moved: {{src}} to {{dst}}" },
    "commands.lrmove.failed": {
        zh: "移动失败: {{error}} {{src}} 到 {{dst}}",
        en: "Failed: {{error}} {{src}} to {{dst}}",
    },
    "commands.lrmove.aborted": {
        zh: "操作已取消，用户中止。",
        en: "Will do nothing, aborted by user.",
    },
    "commands.lrmove.will.do.nothing": {
        zh: "将不执行任何操作，已由用户中止。",
        en: "Will do nothing, aborted by user.",
    },

    // 通用操作
    "operation.completed": {
        zh: "操作完成: 成功 {{success}} 个, 失败 {{error}} 个",
        en: "Operation completed: {{success}} success, {{error}} errors",
    },
    "operation.cancelled": {
        zh: "操作已取消，未执行任何更改。",
        en: "Operation cancelled, no changes made.",
    },

    // 文件操作
    "file.not.found": { zh: "文件未找到", en: "File not found" },
    "file.access.denied": { zh: "文件访问被拒绝", en: "File access denied" },
    "file.already.exists": { zh: "文件已存在", en: "File already exists" },
    "invalid.path": { zh: "无效的文件路径", en: "Invalid file path" },
    "file.moved": { zh: "已移动", en: "Moved" },
    "file.failed": { zh: "失败", en: "Failed" },

    // 路径标识
    "path.source": { zh: "源", en: "Source" },
    "path.destination": { zh: "目标", en: "Destination" },
    "path.input": { zh: "输入", en: "Input" },

    // 处理状态
    "status.processing": { zh: "处理中", en: "Processing" },
    "status.exists": { zh: "已存在", en: "Exists" },
    "status.skipped": { zh: "已跳过", en: "Skipped" },
    "status.completed": { zh: "已完成", en: "Completed" },

    // 模式标识
    "mode.test": { zh: "测试模式", en: "Test Mode" },
    "mode.dryrun": { zh: "试运行", en: "Dry Run" },
    "mode.fast": { zh: "快速模式", en: "Fast Mode" },

    // 操作类型
    "operation.rename": { zh: "重命名", en: "Rename" },
    "operation.move": { zh: "移动", en: "Move" },
    "operation.compress": { zh: "压缩", en: "Compress" },
    "operation.delete": { zh: "删除", en: "Delete" },

    // compress 命令专用
    "compress.description": {
        zh: "压缩输入图片到指定大小",
        en: "Compress input images to target size",
    },
    "compress.preparing": { zh: "准备压缩参数...", en: "Preparing compress arguments..." },
    "compress.files.skipped": {
        zh: "{{count}} 个图片文件已跳过",
        en: "${{count}} image files skipped",
    },
    "compress.nothing.to.do": { zh: "无需操作，中止执行。", en: "Nothing to do, abort." },
    "compress.tasks.summary": { zh: "任务统计", en: "Tasks Summary" },
    "compress.delete.confirm": {
        zh: "确定要删除 {{count}} 个原始文件吗？",
        en: "Are you sure to delete ${count} original files?",
    },
    "compress.delete.aborted": {
        zh: "操作已取消，用户中止。",
        en: "Will do nothing, aborted by user.",
    },
    "compress.safely.removed": {
        zh: "{{count}} 个文件已安全删除",
        en: "${{count}} files are safely removed",
    },
    "compress.processing": {
        zh: "{{index}}/{{total}} {{path}} {{srcSize}}x{{srcSize}}=>{{dstSize}}x{{dstSize}} {{format}} {{humanSize}}",
        en: "${{index}}/{{total}} {{path}} {{srcSize}}x{{srcSize}}=>{{dstSize}}x{{dstSize}} {{format}} {{humanSize}}",
    },
    "compress.dst.path": {
        zh: "{{index}}/{{total}} 目标: {{path}}",
        en: "${{index}}/{{total}} DST: {{path}}",
    },
    "compress.check.exists": {
        zh: "检查 源={{srcExists}} 目标={{dstExists}} {{path}}",
        en: "Check S=${{srcExists}} D=${{dstExists}} {{path}}",
    },
    "compress.safe.delete": {
        zh: "安全删除: {{index}}/{{total}} {{path}}",
        en: "SafeDel: ${{index}}/{{total}} {{path}}",
    },
    "compress.no.files.found": { zh: "没有找到文件，中止。", en: "No files found, abort." },
    "compress.continue.processing": {
        zh: "按 y 继续处理...",
        en: "Press y to continue processing...",
    },
    "compress.total.files.found": {
        zh: "共找到 {{count}} 个文件",
        en: "Total {{count}} files found",
    },
    "compress.confirm": {
        zh: "确定要压缩 {{count}} 个文件吗？\n[应用于大于 {{sizeK}}K 的文件，目标长边宽度为 {{maxWidth}}] \n{{note}}",
        en: "Are you sure to compress {{count}} files?\n[Apply to files larger than {{sizeK}}K, target long side width is {{maxWidth}}] \n{{note}}",
    },
    "compress.warning.delete": {
        zh: "(注意: 您将删除原始文件!)",
        en: "(Note: You will delete original files!)",
    },
    "compress.warning.keep": { zh: "(将保留原始文件)", en: "(Original files will be kept)" },
    "compress.note.no.thumbnail": {
        zh: "不会生成缩略图。",
        en: "no thumbnails will be generated.",
    },
    "compress.files.compressed": { zh: "个文件已压缩", en: "files compressed" },
    "compress.tasks.failed": { zh: "个任务失败", en: "tasks failed" },
    "compress.failed.list": { zh: "失败文件列表", en: "Failed files list" },

    // dcim 命令专用
    "dcim.description": {
        zh: "根据 EXIF 元数据重命名媒体文件，例如按日期",
        en: "Rename media files by exif metadata eg. date",
    },
    "dcim.total.files.found": {
        zh: "共找到 {{count}} 个媒体文件",
        en: "Total {{count}} media files found",
    },
    "dcim.no.files.found": { zh: "未找到文件，退出。", en: "No files found, exit now." },
    "dcim.continue.processing": { zh: "按 y 继续处理...", en: "Press y to continue processing..." },
    "dcim.aborted.by.user": {
        zh: "操作已取消，用户中止。",
        en: "Will do nothing, aborted by user.",
    },
    "dcim.processing.exif": {
        zh: "处理文件，读取 EXIF 数据...",
        en: "Processing files, reading EXIF data...",
    },
    "dcim.files.parsed": {
        zh: "共解析 {{count}} 个媒体文件",
        en: "Total {{count}} media files parsed",
    },
    "dcim.files.skipped": {
        zh: "共跳过 {{count}} 个媒体文件",
        en: "Total {{count}} media files skipped",
    },
    "dcim.files.processed": {
        zh: "共处理 {{count}} 个文件，耗时 {{time}}",
        en: "Total {{count}} files processed in {{time}}",
    },
    "dcim.files.skipped.by.size": {
        zh: "共 {{count}} 个媒体文件因大小被跳过",
        en: "Total {{count}} media files are skipped by size",
    },
    "dcim.files.skipped.by.date": {
        zh: "共 {{count}} 个媒体文件因日期被跳过",
        en: "Total {{count}} media files are skipped by date",
    },
    "dcim.nothing.to.do": { zh: "无需操作，退出。", en: "Nothing to do, exit now." },
    "dcim.files.ready": {
        zh: "共 {{count}} 个媒体文件准备按 EXIF 重命名",
        en: "Total {{count}} media files ready to rename by exif",
    },
    "dcim.task.sample": { zh: "任务示例列表:", en: "task sample list:" },
    "dcim.rename.confirm": {
        zh: "确定要重命名 {{count}} 个文件吗？",
        en: "Are you sure to rename {{count}} files?",
    },
    "dcim.test.mode.note": {
        zh: "所有 {{count}} 个文件，测试模式下不会重命名。",
        en: "All {{count}} files, NO file renamed in TEST MODE.",
    },
    "dcim.files.renamed": {
        zh: "所有 {{count}} 个文件已重命名。",
        en: "All {{count}} file were renamed.",
    },

    // ffmpeg 命令专用
    "ffmpeg.description": {
        zh: "使用 ffmpeg 转换音频或视频文件",
        en: "convert audio or video files using ffmpeg.",
    },
    "ffmpeg.input": { zh: "输入: {{path}}", en: "Input: {{path}}" },
    "ffmpeg.add.files": {
        zh: "添加 {{count}} 个额外文件来自 {{path}}",
        en: "Add {{count}} extra files from {{path}}",
    },
    "ffmpeg.total.files": {
        zh: "应用文件名规则后剩余 {{count}} 个文件",
        en: "Total {{count}} files left after filename rules.",
    },
    "ffmpeg.no.files.left": {
        zh: "规则应用后无文件剩余，无需操作。",
        en: "No files left after rules, nothing to do.",
    },
    "ffmpeg.check.details": {
        zh: "请在继续前检查以上详细信息！",
        en: "Please CHECK above details BEFORE continue!",
    },
    "ffmpeg.preparing.tasks": {
        zh: "正在准备任务文件和 ffmpeg 命令行参数...",
        en: "Now Preparing task files and ffmpeg cmd args...",
    },
    "ffmpeg.all.skipped": {
        zh: "所有任务都被跳过，无需操作。",
        en: "All tasks are skipped, nothing to do.",
    },
    "ffmpeg.test.mode": { zh: "测试模式 (试运行)", en: "TEST MODE (DRY RUN)" },
    "ffmpeg.processing.file": { zh: "处理文件: {{path}}", en: "Processing file: {{path}}" },
    "ffmpeg.conversion.success": { zh: "转换成功: {{path}}", en: "Conversion success: {{path}}" },
    "ffmpeg.conversion.failed": { zh: "转换失败: {{path}}", en: "Conversion failed: {{path}}" },
    "ffmpeg.confirm.continue": {
        zh: "确定要继续处理这 {{count}} 个文件吗？",
        en: "Are you sure to continue to process these {{count}} files?",
    },
    "ffmpeg.confirm.check": {
        zh: "请检查以上数值，按 y/yes 继续。[{{preset}}]",
        en: "Please check above values, press y/yes to continue. [{{preset}}]",
    },
    "ffmpeg.confirm.delete.source": {
        zh: "{{count}} 个条目的目标文件已存在，要删除它们的源文件吗？",
        en: "Destination files of {{count}} entries already exists, do you want to delete the source files of them?",
    },
    "ffmpeg.confirm.process": {
        zh: "确定要处理这 {{count}} 个文件吗？[{{preset}}] (总时长 {{duration}})",
        en: "Are you sure to process these {{count}} files? [{{preset}}] (total {{duration}})",
    },
    "ffmpeg.not.found": {
        zh: "未找到 ffmpeg 可执行文件",
        en: "ffmpeg executable not found in path",
    },
    "ffmpeg.confirm.retry": {
        zh: "{{count}} 个任务失败，要重试这些任务吗？",
        en: "{{count}} tasks failed, do you want to retry these tasks?",
    },
    "ffmpeg.test.mode.note": {
        zh: "测试模式下未处理任何文件。",
        en: "NO file processed in TEST MODE.",
    },
    "ffmpeg.total.processed": {
        zh: "共 {{count}} 个文件已处理，耗时 {{time}}",
        en: "Total {{count}} files processed in {{time}}",
    },
    "ffmpeg.aborted.by.user": {
        zh: "操作已取消，用户中止。",
        en: "Will do nothing, aborted by user.",
    },
    "ffmpeg.include": { zh: "文件名包含模式", en: "filename include pattern" },
    "ffmpeg.exclude": { zh: "文件名排除模式", en: "filename exclude pattern" },
    "ffmpeg.regex": { zh: "通过正则模式匹配文件名", en: "match filenames by regex pattern" },
    "ffmpeg.extensions": {
        zh: "按扩展名包含文件（例如 .wav|.flac）",
        en: "include files by extensions (eg. .wav|.flac)",
    },

    // remove 命令专用
    "remove.description": {
        zh: "根据指定条件删除文件",
        en: "Remove files by given size/width-height/name-pattern/file-list",
    },
    "remove.scanning": { zh: "扫描文件...", en: "Scanning files..." },
    "remove.found.files": {
        zh: "找到 {{count}} 个符合条件的文件",
        en: "Found {{count}} files matching criteria",
    },
    "remove.confirm.delete": {
        zh: "确定要删除 {{count}} 个文件（大小:{{size}}），使用以上条件（类型={{type}}）吗？",
        en: "Are you sure to remove {{count}} files (Size:{{size}}) using above conditions (type={{type}})?",
    },
    "remove.deleted": { zh: "已删除 {{count}} 个文件", en: "Deleted {{count}} files" },
    "remove.skipped": { zh: "跳过 {{count}} 个文件", en: "Skipped {{count}} files" },
    "remove.files.skipped": { zh: "跳过 {{count}} 个文件", en: "Skipped {{count}} files" },
    "remove.files.to.remove": {
        zh: "待删除 {{count}} 个文件（类型={{type}}）",
        en: "{{count}} files to be removed (type={{type}})",
    },
    "remove.attention.list": {
        zh: "注意: 使用文件名列表，忽略所有其他条件",
        en: "Attention: use file name list, ignore all other conditions",
    },
    "remove.attention.delete": {
        zh: "注意: 将删除所有{{reverse}}列表中的文件！",
        en: "Attention: Will DELETE all files {{reverse}} name list!",
    },
    "remove.required.conditions": {
        zh: "未提供删除条件参数",
        en: "required remove condition args not supplied",
    },
    "remove.test.mode.note": {
        zh: "{{count}} 个文件，测试模式下未删除任何文件。",
        en: "{{count}} files, NO file removed in TEST MODE.",
    },
    "remove.failed": { zh: "删除失败", en: "Failed to remove file" },
    "remove.summary": {
        zh: "{{count}} 个文件已删除，耗时 {{time}}（类型={{type}}）",
        en: "{{count}} files removed in {{time}} (type={{type}})",
    },
    "remove.include": { zh: "文件名包含模式", en: "filename include pattern" },
    "remove.exclude": { zh: "文件名排除模式", en: "filename exclude pattern" },
    "remove.regex": { zh: "通过正则模式匹配文件名", en: "match filenames by regex pattern" },
    "remove.extensions": {
        zh: "按扩展名包含文件（例如 .wav|.flac）",
        en: "include files by extensions (eg. .wav|.flac)",
    },

    // decode 命令专用
    "decode.description": {
        zh: "解码带有乱码或无效字符的文本",
        en: "Decode text with messy or invalid chars",
    },
    "decode.text.input.required": { zh: "需要文本输入", en: "text input required" },

    // move 命令专用
    "move.description": {
        zh: "按照文件名日期模式移动文件到文件夹",
        en: "Move files to folders by filename date patterns",
    },
    "move.no.date.skip": { zh: "无日期，跳过", en: "No Date, Skip" },
    "move.duplicate.file.skip": { zh: "重复文件，跳过", en: "Duplicate File, Skip" },
    "move.in.destination": { zh: "已在目标中", en: "In Destination" },
    "move.same.file.skip": { zh: "相同文件，跳过", en: "Same File, Skip" },
    "move.different.file.need.rename": {
        zh: "不同文件，需要重命名",
        en: "Different File, Need Rename",
    },
    "move.total.entries.found": { zh: "共找到", en: "Total" },
    "move.total.entries.left.after.rules": { zh: "规则后剩余", en: "left after rules" },
    "move.found": { zh: "找到", en: "Found" },
    "move.total.files.skipped": { zh: "共跳过", en: "Total skipped" },
    "move.total.files.ready.to.move": { zh: "共准备移动", en: "Total ready to move" },
    "move.nothing.to.do": { zh: "无需操作，中止。", en: "Nothing to do, abort." },
    "move.sample.files": { zh: "示例文件", en: "Sample files" },
    "move.no.files.will.be.moved": {
        zh: "测试模式，不会移动文件",
        en: "TEST MODE (DRY RUN), no files will be moved",
    },
    "move.confirm.move": {
        zh: "确定要移动 {{count}} 个文件吗？",
        en: "Are you sure to move {{count}} files?",
    },
    "move.files.skipped.in.dir": {
        zh: "{{count}} 个文件在 {{dir}} 中被跳过",
        en: "{{count}} files are skipped in {{dir}}",
    },
    "move.files.moved.to.dir": {
        zh: "{{count}} 个文件已移动到 {{dir}}",
        en: "{{count}} files are moved to {{dir}}",
    },

    // moveup 命令专用
    "moveup.description": {
        zh: "移动文件到子顶级文件夹或顶级文件夹",
        en: "Move files to sub top folder or top folder",
    },

    // prefix 命令专用
    "prefix.description": {
        zh: "通过追加目录名或字符串重命名文件",
        en: "Rename files by append dir name or string",
    },
    "prefix.nothing.to.do": { zh: "无需操作，退出。", en: "Nothing to do, exit now." },
    "prefix.confirm.rename": {
        zh: "确定要重命名这 {{count}} 个文件吗？",
        en: "Are you sure to rename these {{count}} files?",
    },

    // run 命令专用
    "run.description": { zh: "运行独立任务", en: "Run standalone tasks" },

    // zipu 命令专用
    "zipu.description": {
        zh: "智能解压命令（自动检测编码）",
        en: "Smart unzip command (auto detect encoding)",
    },

    // rename 命令专用
    "rename.description": {
        zh: "重命名文件：修复编码、正则替换、清理字符",
        en: "Reanme files: fix encoding, replace by regex, clean chars, from tc to sc.",
    },
    "rename.processing": { zh: "处理文件名...", en: "Processing filenames..." },
    "rename.fixed.encoding": { zh: "修复编码: {{path}}", en: "Fixed encoding: {{path}}" },
    "rename.applied.regex": { zh: "应用正则: {{path}}", en: "Applied regex: {{path}}" },
    "rename.cleaned.chars": { zh: "清理字符: {{path}}", en: "Cleaned chars: {{path}}" },
    "rename.converted.tc.to.sc": { zh: "繁体转简体: {{path}}", en: "Converted tc to sc: {{path}}" },
    "rename.one.operation.required": {
        zh: "replace|clean|encoding|zhcn|mergeDirs, 至少需要其中一个",
        en: "replace|clean|encoding|zhcn|mergeDirs, one is required",
    },
    "rename.no.files.found": {
        zh: "未找到文件，中止 (type={{type}})",
        en: "No files found, abort. (type={{type}})",
    },
    "rename.total.entries.found": { zh: "共找到", en: "Total" },
    "rename.no.files.left.after.rules": {
        zh: "规则后无文件剩余，无需操作",
        en: "No files left after rules, nothing to do.",
    },
    "rename.duplicate.names.warning": {
        zh: "{{count1}}=>{{count2}} 部分文件有重复名称，请检查",
        en: "{{count1}}=>{{count2}} some files have duplicate names, please check.",
    },
    "rename.files.skipped": {
        zh: "共跳过 {{count}} 个文件 (type={{type}})",
        en: "Total {{count}} files are skipped. (type={{type}})",
    },
    "rename.files.ready.to.rename": {
        zh: "共 {{count}} 个文件准备重命名 (type={{type}})",
        en: "Total {{count}} files ready to rename. (type={{type}})",
    },
    "rename.nothing.to.do": {
        zh: "无需操作，中止 (type={{type}})",
        en: "Nothing to do, abort. (type={{type}})",
    },
    "rename.confirm.rename": {
        zh: "确定要重命名这些 {{count}} 个文件吗 (type={{type}})?",
        en: "Are you sure to rename these {{count}} files (type={{type}})?",
    },
    "rename.no.file.renamed.in.test.mode": {
        zh: "{{count}} 个文件，测试模式下未重命名 (type={{type}})",
        en: "{{count}} files, NO file renamed in TEST MODE. (type={{type}})",
    },
    "rename.all.files.renamed": {
        zh: "所有 {{count}} 个文件已重命名 (type={{type}})",
        en: "All {{count}} file were renamed. (type={{type}})",
    },
    "error.type.must.be.one.of": { zh: "类型必须是以下之一", en: "type must be one of" },

    // 文件状态
    "file.status.exists": { zh: "已存在", en: "Exists" },
    "file.status.processing": { zh: "处理中", en: "Processing" },
    "file.status.completed": { zh: "已完成", en: "Completed" },
    "file.status.failed": { zh: "失败", en: "Failed" },

    // 确认消息
    "confirm.delete.original": {
        zh: "确定要删除原始文件吗？",
        en: "Are you sure to delete original files?",
    },
    "confirm.override.existing": {
        zh: "确定要覆盖已存在的文件吗？",
        en: "Are you sure to override existing files?",
    },

    // 命令选项描述
    // lrmove
    "option.lrmove.input": { zh: "输入文件夹路径", en: "Input folder path" },
    "option.lrmove.output": { zh: "输出文件夹路径", en: "Output folder path" },

    // compress
    "option.compress.output": { zh: "存储输出文件的文件夹", en: "Folder store ouput files" },
    "option.compress.delete.source": {
        zh: "压缩后删除原始图片文件",
        en: "Delete original image files after compress",
    },
    "option.compress.quality": {
        zh: "目标图片文件压缩质量",
        en: "Target image file compress quality",
    },
    "option.compress.size": {
        zh: "处理大于此大小的文件 (单位:K)",
        en: "Processing file bigger than this size (unit:k)",
    },
    "option.compress.width": {
        zh: "图片长边的最大宽度",
        en: "Max width of long side of image thumb",
    },
    "option.compress.config": {
        zh: "压缩配置查询字符串，例如: q=85,w=6000,s=2048,suffix=_Z4K",
        en: "compress config in one query string, such as: q=85,w=6000,s=2048,suffix=_Z4K",
    },
    "option.compress.jobs": { zh: "并行运行的作业数", en: "multi jobs running parallelly" },
    "option.compress.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },
    "option.compress.force": { zh: "强制压缩所有文件", en: "Force compress all files" },
    "option.compress.override": { zh: "覆盖已存在的目标文件", en: "Override existing dst files" },
    "option.compress.suffix": {
        zh: "压缩文件的文件名后缀",
        en: "filename suffix for compressed files",
    },
    "option.compress.include": { zh: "文件名包含模式", en: "filename include pattern" },
    "option.compress.exclude": { zh: "文件名排除模式", en: "filename exclude pattern" },
    "option.compress.regex": {
        zh: "通过正则模式匹配文件名",
        en: "match filenames by regex pattern",
    },
    "option.compress.extensions": {
        zh: "按扩展名包含文件（例如 .jpg|.png）",
        en: "include files by extensions (eg. .jpg|.png)",
    },
    "option.compress.delete.source.only": {
        zh: "仅删除原始图片文件，不压缩",
        en: "Just delete original image files only, no compression",
    },

    // dcim
    "option.dcim.backup": { zh: "重命名前备份原始文件", en: "backup original file before rename" },
    "option.dcim.fast": {
        zh: "快速模式 (使用文件修改时间，不解析 EXIF)",
        en: "fast mode (use file modified time, no exif parse)",
    },
    "option.dcim.prefix": {
        zh: "原始/图片/视频文件的自定义文件名前缀",
        en: "custom filename prefix for raw/image/video files",
    },
    "option.dcim.suffix": { zh: "自定义文件名后缀", en: "custom filename suffix" },
    "option.dcim.template": {
        zh: "文件名日期格式模板，参见 https://day.js.org/docs/en/display/format",
        en: "filename date format template, see https://day.js.org/docs/en/display/format",
    },
    "option.dcim.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // ffmpeg
    "option.ffmpeg.output": { zh: "存储输出文件的文件夹", en: "Folder store ouput files" },
    "option.ffmpeg.ffargs": {
        zh: "ffmpeg 的复杂组合字符串参数",
        en: "complex combined string parameters for ffmpeg",
    },
    "option.ffmpeg.output.mode": {
        zh: "输出模式: 保持文件夹树/保持父目录/扁平化文件",
        en: "Output mode: keep folder tree/keep parent dir/ flatten files",
    },
    "option.ffmpeg.start": {
        zh: "要处理的文件列表的起始索引",
        en: "start index of file list to process",
    },
    "option.ffmpeg.count": {
        zh: "要处理的文件列表的分组大小",
        en: "group size of file list to process",
    },
    "option.ffmpeg.preset": {
        zh: "ffmpeg 命令的转换预设参数",
        en: "convert preset args for ffmpeg command",
    },
    "option.ffmpeg.show.presets": { zh: "显示预设详细信息列表", en: "show presets details list" },
    "option.ffmpeg.override": {
        zh: "强制覆盖已存在的文件",
        en: "force to override existting files",
    },
    "option.ffmpeg.prefix": { zh: "添加到输出文件名的前缀", en: "add prefix to output filename" },
    "option.ffmpeg.suffix": { zh: "添加到文件名的后缀", en: "add suffix to filename" },
    "option.ffmpeg.dimension": { zh: "视频的最大边长", en: "chang max side for video" },
    "option.ffmpeg.fps": { zh: "输出帧率值", en: "output framerate value" },
    "option.ffmpeg.speed": { zh: "改变视频和音频的速度", en: "chang speed for video and audio" },
    "option.ffmpeg.video.args": {
        zh: "在 ffmpeg 命令中设置视频参数",
        en: "Set video args in ffmpeg command",
    },
    "option.ffmpeg.video.bitrate": {
        zh: "在 ffmpeg 命令中设置视频比特率 (单位:K)",
        en: "Set video bitrate (in kbytes) in ffmpeg command",
    },
    "option.ffmpeg.video.copy": {
        zh: "复制视频流到输出，不重新编码",
        en: "Copy video stream to ouput, no re-encoding",
    },
    "option.ffmpeg.video.quality": {
        zh: "在 ffmpeg 命令中设置视频质量",
        en: "Set video quality in ffmpeg command",
    },
    "option.ffmpeg.audio.args": {
        zh: "在 ffmpeg 命令中设置音频参数",
        en: "Set audio args in ffmpeg command",
    },
    "option.ffmpeg.audio.bitrate": {
        zh: "在 ffmpeg 命令中设置音频比特率 (单位:K)",
        en: "Set audio bitrate (in kbytes) in ffmpeg command",
    },
    "option.ffmpeg.audio.copy": {
        zh: "复制音频流到输出，不重新编码",
        en: "Copy audio stream to ouput, no re-encoding",
    },
    "option.ffmpeg.audio.quality": {
        zh: "在 ffmpeg 命令中设置音频质量",
        en: "Set audio quality in ffmpeg command",
    },
    "option.ffmpeg.filters": {
        zh: "在 ffmpeg 命令中设置滤镜",
        en: "Set filters in ffmpeg command",
    },
    "option.ffmpeg.filter.complex": {
        zh: "在 ffmpeg 命令中设置复杂滤镜",
        en: "Set complex filters in ffmpeg command",
    },
    "option.ffmpeg.error.file": {
        zh: "将错误日志写入文件 [json 或 text]",
        en: "Write error logs to file [json or text]",
    },
    "option.ffmpeg.hwaccel": {
        zh: "视频解码和编码的硬件加速",
        en: "hardware acceleration for video decode and encode",
    },
    "option.ffmpeg.decode.mode": {
        zh: "视频解码模式: auto/gpu/cpu",
        en: "video decode mode: auto/gpu/cpu",
    },
    "option.ffmpeg.jobs": { zh: "并行运行的作业数", en: "multi jobs running parallelly" },
    "option.ffmpeg.delete.source": {
        zh: "如果目标存在则删除源文件",
        en: "delete source file if destination is exists",
    },
    "option.ffmpeg.info": { zh: "显示媒体文件信息", en: "show info of media files" },
    "option.ffmpeg.debug": {
        zh: "启用 ffmpeg 转换的调试模式",
        en: "enable debug mode for ffmpeg convert",
    },
    "option.ffmpeg.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // remove
    "option.remove.loose": {
        zh: "如果为 true，条件操作为 OR，默认为 AND",
        en: "If true, operation of conditions is OR, default AND",
    },
    "option.remove.output": {
        zh: "移动文件到此文件夹，或直接删除",
        en: "move files to this folder, or just deleted",
    },
    "option.remove.output.tree": {
        zh: "在输出文件夹中保持文件夹树结构",
        en: "keep folder tree structure in output folder",
    },
    "option.remove.width": {
        zh: "宽度小于此值的文件将被删除",
        en: "Files width smaller than value will be removed",
    },
    "option.remove.height": {
        zh: "高度小于此值的文件将被删除",
        en: "Files height smaller than value will be removed",
    },
    "option.remove.measure": {
        zh: '文件 x*y 尺寸，宽度和高度，例如: "123x456"',
        en: 'File x*y dimension, width and height, eg: "123x456"',
    },
    "option.remove.sizel": {
        zh: "大小大于此值的文件将被删除 (单位:K)",
        en: "Files size bigger than value will be removed (unit:k)",
    },
    "option.remove.sizer": {
        zh: "大小小于此值的文件将被删除 (单位:K)",
        en: "Files size smaller than value will be removed (unit:k)",
    },
    "option.remove.pattern": {
        zh: "文件名模式匹配此值的文件将被删除",
        en: "Files name pattern matched value will be removed",
    },
    "option.remove.not.match": {
        zh: "文件名模式不匹配此值的文件将被删除",
        en: "Files name pattern not matched value will be removed",
    },
    "option.remove.list": {
        zh: "文件名列表文件，或包含文件名的目录",
        en: "File name list file, or dir contains files for file name",
    },
    "option.remove.video": { zh: "根据视频元数据删除文件", en: "Remove files by video metadata" },
    "option.remove.type": {
        zh: "应用于文件类型 (a=全部,f=文件,d=目录)",
        en: "applied to file type (a=all,f=file,d=dir)",
    },
    "option.remove.reverse": {
        zh: "如果为 true 删除不在列表中的文件",
        en: "delete files in list, if true delete files not in the list",
    },
    "option.remove.corrupted": { zh: "删除损坏的文件", en: "delete corrupted files" },
    "option.remove.badchars": {
        zh: "删除包含非法或错误 Unicode 字符的文件",
        en: "delete files with illegal or bad unicode chars",
    },
    "option.remove.delete.permanently": {
        zh: "永久删除文件，而不仅仅是移动它",
        en: "delete file permanently, not just move it",
    },
    "option.remove.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // rename
    "option.rename.input": { zh: "输入目录", en: "input directory" },
    "option.rename.cargs": {
        zh: "用于解析的复杂组合字符串参数",
        en: "complex combined string arguments for parse",
    },
    "option.rename.include": { zh: "文件名包含模式", en: "filename include pattern" },
    "option.rename.exclude": { zh: "文件名排除模式", en: "filename exclude pattern" },
    "option.rename.extensions": {
        zh: "按扩展名包含文件（例如 .mp4|.mkv）",
        en: "include files by extensions (eg. .mp4|.mkv)",
    },
    "option.rename.clean": {
        zh: "移除文件名中的丑陋和特殊字符",
        en: "remove ugly and special chars in filename",
    },
    "option.rename.separator": {
        zh: "清洁文件名的单词分隔符",
        en: "word separator for clean filenames",
    },
    "option.rename.replace": {
        zh: "通过模式替换文件名中的字符 [from,to]",
        en: "replace filename chars by pattern [from,to]",
    },
    "option.rename.replace.flags": {
        zh: "替换操作的特殊标志",
        en: "special flag for replace operations",
    },
    "option.rename.fixenc": { zh: "通过猜测编码修复文件名", en: "fix filenames by guess encoding" },
    "option.rename.regex": { zh: "使用正则表达式进行替换", en: "use regex for replace operation" },
    "option.rename.zhcn": {
        zh: "将中文字符从繁体转换为简体",
        en: "convert from tc to sc for Chinese chars",
    },
    "option.rename.prefix.media": {
        zh: "添加前缀到文件名，支持媒体模板参数",
        en: "add prefix to filename, support media template args",
    },
    "option.rename.suffix.media": {
        zh: "添加后缀到文件名，支持媒体模板参数",
        en: "add suffix to filename, support media template args",
    },
    "option.rename.suffix.date": {
        zh: "添加后缀到文件名，支持日期时间模板参数",
        en: "add suffix to filename, support date time template args",
    },
    "option.rename.video.dimension": {
        zh: "根据尺寸将视频文件移动到目录",
        en: "move video files to dir according to dimension",
    },
    "option.rename.merge.dirs": {
        zh: "减少重复命名的目录层次结构",
        en: "reduce duplicate named directory hierarchy",
    },
    "option.rename.jobs": { zh: "并行运行的作业数", en: "multi jobs running parallelly" },
    "option.rename.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },
    "option.rename.type": {
        zh: "应用于文件类型 (a=全部,f=文件,d=目录)",
        en: "applied to file type (a=all,f=file,d=dir)",
    },
    "option.rename.max.depth": {
        zh: "遍历目录时的最大深度",
        en: "max depth when walk directories and files",
    },

    // decode
    "option.decode.strings": { zh: "要解码的字符串列表", en: "string list to decode" },
    "option.decode.from.enc": {
        zh: "源编码名称，例如: utf8|gbk|shift_jis",
        en: "from encoding name eg. utf8|gbk|shift_jis",
    },
    "option.decode.to.enc": {
        zh: "目标编码名称，例如: utf8|gbk|shift_jis",
        en: "to encoding name eg. utf8|gbk|shift_jis",
    },

    // move
    "option.move.input": { zh: "输入目录", en: "input directory" },
    "option.move.output": { zh: "存储输出文件的文件夹", en: "Folder store output files" },
    "option.move.include": { zh: "文件名包含模式", en: "filename include pattern" },
    "option.move.exclude": { zh: "文件名排除模式", en: "filename exclude pattern" },
    "option.move.extensions": {
        zh: "按扩展名包含文件（例如 .wav|.flac）",
        en: "include files by extensions (eg. .wav|.flac)",
    },
    "option.move.max.depth": {
        zh: "遍历目录时的最大深度",
        en: "max depth when walk directories and files",
    },
    "option.move.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // moveup
    "option.moveup.output": { zh: "输出子文件夹名称", en: "Output sub folder name" },
    "option.moveup.mode": { zh: "输出的文件名前缀模式", en: "filename prefix mode for output" },
    "option.moveup.topmost": {
        zh: "移动文件到根目录下的子目录",
        en: "move files to sub dirs in root dir",
    },
    "option.moveup.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // prefix
    "option.prefix.length": { zh: "前缀字符串的最大长度", en: "max length of prefix string" },
    "option.prefix.include": { zh: "包含文件名模式", en: "include filename patterns" },
    "option.prefix.exclude": { zh: "排除文件名模式", en: "exclude filename patterns" },
    "option.prefix.prefix": { zh: "输出文件名前缀字符串", en: "filename prefix str for output" },
    "option.prefix.mode": { zh: "输出的文件名前缀模式", en: "filename prefix mode for output" },
    "option.prefix.auto": { zh: "模式自动", en: "mode auto" },
    "option.prefix.dirname": { zh: "模式目录名", en: "mode dirname" },
    "option.prefix.prefix": { zh: "模式前缀", en: "mode prefix" },
    "option.prefix.media": { zh: "模式媒体", en: "mode media" },
    "option.prefix.clean.only": { zh: "仅清理模式", en: "mode clean only" },
    "option.prefix.clean": { zh: "移除文件名中的特殊字符", en: "remove special chars in filename" },
    "option.prefix.all": { zh: "强制重命名所有文件", en: "force rename all files" },
    "option.prefix.jobs": { zh: "并行运行的作业数", en: "multi jobs running parallelly" },
    "option.prefix.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // run
    "option.run.output": { zh: "存储输出文件的文件夹", en: "Folder store output files" },
    "option.run.include": { zh: "文件名包含模式", en: "filename include pattern" },
    "option.run.exclude": { zh: "文件名排除模式", en: "filename exclude pattern" },
    "option.run.regex": { zh: "通过正则模式匹配文件名", en: "match filenames by regex pattern" },
    "option.run.extensions": {
        zh: "按扩展名包含文件（例如 .wav|.flac）",
        en: "include files by extensions (eg. .wav|.flac)",
    },

    // zipu
    "option.zipu.encoding": {
        zh: "用于 zip 文件名的编码",
        en: "use this encoding for zip filenames",
    },
    "option.zipu.override": {
        zh: "强制解压，覆盖已存在的文件",
        en: "force unzip, override existing files",
    },
    "option.zipu.start": {
        zh: "要处理的文件列表的起始索引",
        en: "start index of file list to process",
    },
    "option.zipu.count": {
        zh: "要处理的文件列表的分组大小",
        en: "group size of file list to process",
    },
    "option.zipu.tcsc": { zh: "将中文从繁体转换为简体", en: "convert Chinese from TC to SC" },
    "option.zipu.purge": { zh: "解压成功后删除 zip 文件", en: "delete zip file after unzipped ok" },
    "option.zipu.doit": {
        zh: "以真实模式执行系统操作，而非试运行",
        en: "execute os operations in real mode, not dry run",
    },

    // 跳过原因
    "skip.dst.exists": { zh: "目标已存在", en: "Destination Exists" },
    "skip.invalid.format": { zh: "格式无效", en: "Invalid Format" },
    "skip.size.limit": { zh: "大小超限", en: "Size Limit Exceeded" },

    // 输入验证
    "input.path.empty": { zh: "输入路径不能为空", en: "Input path cannot be empty" },
    "input.path.not.exists": {
        zh: "输入路径不存在: {{path}}",
        en: "Input path does not exist: {{path}}",
    },
    "input.invalid": { zh: "无效输入: {{path}}", en: "Invalid input: {{path}}" },

    // 通用提示
    "please.check.path": {
        zh: "请检查文件路径是否正确",
        en: "Please check if the file path is correct",
    },
    "please.check.permissions": { zh: "请检查文件权限", en: "Please check file permissions" },
    "use.help.for.guide": { zh: "使用 --help 查看使用指南", en: "Use --help for usage guide" },

    // 错误消息
    "error.argument": { zh: "参数错误", en: "Argument error" },
    "error.processing": { zh: "处理错误", en: "Processing error" },
    "error.unknown": { zh: "未知错误", en: "Unknown error" },

    // 成功消息
    "success.completed": { zh: "操作完成", en: "Operation completed" },
    "success.moved": { zh: "移动完成", en: "Move completed" },

    // 状态消息
    "status.processing": { zh: "处理中...", en: "Processing..." },
    "status.checking": { zh: "检查中...", en: "Checking..." },
    "status.finished": { zh: "已完成", en: "Finished" },

    // 确认消息
    "confirm.continue": { zh: "是否继续？", en: "Do you want to continue?" },
    "confirm.yes": { zh: "是", en: "Yes" },
    "confirm.no": { zh: "否", en: "No" },

    // 帮助信息
    "help.usage": { zh: "用法", en: "Usage" },
    "help.commands": { zh: "命令", en: "Commands" },
    "help.options": { zh: "选项", en: "Options" },
    "help.examples": { zh: "示例", en: "Examples" },

    // 程序信息
    "app.name": { zh: "MediaCli", en: "MediaCli" },
    "app.description": { zh: "多媒体文件处理工具", en: "Multimedia file processing tool" },
    "app.copyright": {
        zh: "版权所有 2021-2026 @ Zhang Xiaoke",
        en: "Copyright 2021-2026 @ Zhang Xiaoke",
    },
}

class I18n {
    constructor() {
        this.currentLanguage = this.detectLanguage()
        this.fallbackLanguage = Languages.EN_US
    }

    // 检测系统语言
    detectLanguage() {
        // 使用 os-locale 的方法检测系统语言
        const locale =
            process.env.LC_ALL ||
            process.env.LC_MESSAGES ||
            process.env.LANG ||
            process.env.LANGUAGE

        if (locale) {
            const normalized = locale
                .replace(/[.:].*/, "")
                .replace(/@.*/, "")
                .replace(/_/, "-")
            // 检查是否是中文
            if (normalized.includes("zh") || normalized.includes("CN")) {
                return Languages.ZH_CN
            }
            // 检查是否是英文
            if (normalized.includes("en")) {
                return Languages.EN_US
            }
        }

        // 如果没有环境变量，使用 Intl API 获取系统区域
        try {
            const systemLocale = new Intl.DateTimeFormat().resolvedOptions().locale
            if (systemLocale.includes("zh") || systemLocale.includes("CN")) {
                return Languages.ZH_CN
            }
            if (systemLocale.includes("en")) {
                return Languages.EN_US
            }
        } catch (e) {
            // 忽略错误
        }

        // 默认为英文
        return Languages.EN_US
    }

    // 设置语言
    setLanguage(language) {
        if (Object.values(Languages).includes(language)) {
            this.currentLanguage = language
        }
    }

    // 获取当前语言
    getLanguage() {
        return this.currentLanguage
    }

    // 翻译文本
    t(key, params = {}) {
        let text = this.getText(key)

        // 替换参数
        Object.keys(params).forEach((param) => {
            const placeholder = `{{${param}}}`
            text = text.replace(new RegExp(placeholder, "g"), params[param])
        })

        return text
    }

    // 获取文本（内部方法）
    getText(key) {
        const translation = translations[key]

        if (!translation) {
            return key // 如果找不到翻译，返回键名
        }

        // 尝试获取当前语言的文本
        const langKey = this.currentLanguage === Languages.ZH_CN ? "zh" : "en"
        if (translation[langKey]) {
            return translation[langKey]
        }

        // 回退到默认语言
        const fallbackKey = this.fallbackLanguage === Languages.ZH_CN ? "zh" : "en"
        if (translation[fallbackKey]) {
            return translation[fallbackKey]
        }

        // 如果都找不到，返回键名
        return key
    }

    // 检查是否支持中文
    isChineseSupported() {
        return this.currentLanguage === Languages.ZH_CN
    }

    // 强制使用中文
    useChinese() {
        this.currentLanguage = Languages.ZH_CN
    }

    // 强制使用英文
    useEnglish() {
        this.currentLanguage = Languages.EN_US
    }
}

// 创建全局实例
export const i18n = new I18n()

// 便捷的翻译函数
export const t = (key, params = {}) => i18n.t(key, params)
