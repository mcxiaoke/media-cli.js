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
  ZH_CN: 'zh-CN',
  EN_US: 'en-US'
}

// 语言资源
const resources = {
  [Languages.ZH_CN]: {
    // 通用消息
    'commands.lrmove.description': '将 RAW 目录下的 JPEG 输出文件夹移动到其他位置',
    'commands.lrmove.total.folders': '共找到 {{count}} 个 JPEG 文件夹',
    'commands.lrmove.nothing.to.do': '无需操作，中止执行。',
    'commands.lrmove.move.confirm': '确定要移动这 {{count}} 个包含文件的 JPEG 文件夹吗？',
    'commands.lrmove.moved': '已移动: {{src}} 到 {{dst}}',
    'commands.lrmove.failed': '移动失败: {{error}} {{src}} 到 {{dst}}',
    'commands.lrmove.aborted': '操作已取消，用户中止。',
    'commands.lrmove.will.do.nothing': '将不执行任何操作，已由用户中止。',
    
    // 通用操作
    'operation.completed': '操作完成: 成功 {{success}} 个, 失败 {{error}} 个',
    'operation.cancelled': '操作已取消，未执行任何更改。',
    
    // 文件操作
    'file.not.found': '文件未找到',
    'file.access.denied': '文件访问被拒绝',
    'file.already.exists': '文件已存在',
    'invalid.path': '无效的文件路径',
    'file.moved': '已移动',
    'file.failed': '失败',
    
    // 路径标识
    'path.source': '源',
    'path.destination': '目标',
    'path.input': '输入',
    
    // 处理状态
    'status.processing': '处理中',
    'status.exists': '已存在',
    'status.skipped': '已跳过',
    'status.completed': '已完成',
    
    // 模式标识
    'mode.test': '测试模式',
    'mode.dryrun': '试运行',
    'mode.fast': '快速模式',
    
    // 操作类型
    'operation.rename': '重命名',
    'operation.move': '移动',
    'operation.compress': '压缩',
    'operation.delete': '删除',
    
    // compress 命令专用
    'compress.description': '压缩输入图片到指定大小',
    'compress.preparing': '准备压缩参数...',
    'compress.files.skipped': '{{count}} 个图片文件已跳过',
    'compress.nothing.to.do': '无需操作，中止执行。',
    'compress.tasks.summary': '任务统计',
    'compress.delete.confirm': '确定要删除 {{count}} 个原始文件吗？',
    'compress.delete.aborted': '操作已取消，用户中止。',
    'compress.safely.removed': '{{count}} 个文件已安全删除',
    'compress.processing': '{{index}}/{{total}} {{path}} {{srcSize}}x{{srcSize}}=>{{dstSize}}x{{dstSize}} {{format}} {{humanSize}}',
    'compress.dst.path': '{{index}}/{{total}} 目标: {{path}}',
    'compress.check.exists': '检查 源={{srcExists}} 目标={{dstExists}} {{path}}',
    'compress.safe.delete': '安全删除: {{index}}/{{total}} {{path}}',
    'compress.no.files.found': '没有找到文件，中止。',
    'compress.continue.processing': '按 y 继续处理...',
    'compress.total.files.found': '共找到 {{count}} 个文件',
    'compress.confirm': '确定要压缩 {{count}} 个文件吗？\n[应用于大于 {{sizeK}}K 的文件，目标长边宽度为 {{maxWidth}}] \n{{note}}',
    'compress.warning.delete': '(注意: 您将删除原始文件!)',
    'compress.warning.keep': '(将保留原始文件)',
    'compress.note.no.thumbnail': '不会生成缩略图。',
    'compress.files.compressed': '个文件已压缩',
    'compress.tasks.failed': '个任务失败',
    'compress.failed.list': '失败文件列表',
    
    // dcim 命令专用
    'dcim.description': '根据 EXIF 元数据重命名媒体文件，例如按日期',
    'dcim.total.files.found': '共找到 {{count}} 个媒体文件',
    'dcim.no.files.found': '未找到文件，退出。',
    'dcim.continue.processing': '按 y 继续处理...',
    'dcim.aborted.by.user': '操作已取消，用户中止。',
    'dcim.processing.exif': '处理文件，读取 EXIF 数据...',
    'dcim.files.parsed': '共解析 {{count}} 个媒体文件',
    'dcim.files.skipped': '共跳过 {{count}} 个媒体文件',
    'dcim.files.processed': '共处理 {{count}} 个文件，耗时 {{time}}',
    'dcim.files.skipped.by.size': '共 {{count}} 个媒体文件因大小被跳过',
    'dcim.files.skipped.by.date': '共 {{count}} 个媒体文件因日期被跳过',
    'dcim.nothing.to.do': '无需操作，退出。',
    'dcim.files.ready': '共 {{count}} 个媒体文件准备按 EXIF 重命名',
    'dcim.task.sample': '任务示例列表:',
    'dcim.rename.confirm': '确定要重命名 {{count}} 个文件吗？',
    'dcim.test.mode.note': '所有 {{count}} 个文件，测试模式下不会重命名。',
    'dcim.files.renamed': '所有 {{count}} 个文件已重命名。',
    
    // ffmpeg 命令专用
    'ffmpeg.description': '使用 ffmpeg 转换音频或视频文件',
    'ffmpeg.input': '输入: {{path}}',
    'ffmpeg.add.files': '添加 {{count}} 个额外文件来自 {{path}}',
    'ffmpeg.total.files': '应用文件名规则后剩余 {{count}} 个文件',
    'ffmpeg.no.files.left': '规则应用后无文件剩余，无需操作。',
    'ffmpeg.check.details': '请在继续前检查以上详细信息！',
    'ffmpeg.preparing.tasks': '正在准备任务文件和 ffmpeg 命令行参数...',
    'ffmpeg.all.skipped': '所有任务都被跳过，无需操作。',
    'ffmpeg.test.mode': '测试模式 (试运行)',
    'ffmpeg.processing.file': '处理文件: {{path}}',
    'ffmpeg.conversion.success': '转换成功: {{path}}',
    'ffmpeg.conversion.failed': '转换失败: {{path}}',
    'ffmpeg.confirm.continue': '确定要继续处理这 {{count}} 个文件吗？',
    'ffmpeg.confirm.check': '请检查以上数值，按 y/yes 继续。[{{preset}}]',
    'ffmpeg.confirm.delete.source': '{{count}} 个条目的目标文件已存在，要删除它们的源文件吗？',
    'ffmpeg.confirm.process': '确定要处理这 {{count}} 个文件吗？[{{preset}}] (总时长 {{duration}})',
    'ffmpeg.not.found': '未找到 ffmpeg 可执行文件',
    'ffmpeg.confirm.retry': '{{count}} 个任务失败，要重试这些任务吗？',
    'ffmpeg.test.mode.note': '测试模式下未处理任何文件。',
    'ffmpeg.total.processed': '共 {{count}} 个文件已处理，耗时 {{time}}',
    'ffmpeg.aborted.by.user': '操作已取消，用户中止。',
    'ffmpeg.include': '文件名包含模式',
    'ffmpeg.exclude': '文件名排除模式',
    'ffmpeg.regex': '通过正则模式匹配文件名',
    'ffmpeg.extensions': '按扩展名包含文件（例如 .wav|.flac）',
    
    // remove 命令专用
    'remove.description': '根据指定条件删除文件',
    'remove.scanning': '扫描文件...',
    'remove.found.files': '找到 {{count}} 个符合条件的文件',
    'remove.confirm.delete': '确定要删除 {{count}} 个文件（大小:{{size}}），使用以上条件（类型={{type}}）吗？',
    'remove.deleted': '已删除 {{count}} 个文件',
    'remove.skipped': '跳过 {{count}} 个文件',
    'remove.files.skipped': '跳过 {{count}} 个文件',
    'remove.files.to.remove': '待删除 {{count}} 个文件（类型={{type}}）',
    'remove.attention.list': '注意: 使用文件名列表，忽略所有其他条件',
    'remove.attention.delete': '注意: 将删除所有{{reverse}}列表中的文件！',
    'remove.required.conditions': '未提供删除条件参数',
    'remove.test.mode.note': '{{count}} 个文件，测试模式下未删除任何文件。',
    'remove.failed': '删除失败',
    'remove.summary': '{{count}} 个文件已删除，耗时 {{time}}（类型={{type}}）',
    'remove.include': '文件名包含模式',
    'remove.exclude': '文件名排除模式',
    'remove.regex': '通过正则模式匹配文件名',
    'remove.extensions': '按扩展名包含文件（例如 .wav|.flac）',
    
    // decode 命令专用
    'decode.description': '解码带有乱码或无效字符的文本',
    'decode.text.input.required': '需要文本输入',
    
    // move 命令专用
    'move.description': '按照文件名日期模式移动文件到文件夹',
    'move.no.date.skip': '无日期，跳过',
    'move.duplicate.file.skip': '重复文件，跳过',
    'move.in.destination': '已在目标中',
    'move.same.file.skip': '相同文件，跳过',
    'move.different.file.need.rename': '不同文件，需要重命名',
    'move.total.entries.found': '共找到',
    'move.total.entries.left.after.rules': '规则后剩余',
    'move.found': '找到',
    'move.total.files.skipped': '共跳过',
    'move.total.files.ready.to.move': '共准备移动',
    'move.nothing.to.do': '无需操作，中止。',
    'move.sample.files': '示例文件',
    'move.no.files.will.be.moved': '测试模式，不会移动文件',
    'move.confirm.move': '确定要移动 {{count}} 个文件吗？',
    'move.files.skipped.in.dir': '{{count}} 个文件在 {{dir}} 中被跳过',
    'move.files.moved.to.dir': '{{count}} 个文件已移动到 {{dir}}',
    
    // moveup 命令专用
    'moveup.description': '移动文件到子顶级文件夹或顶级文件夹',
    
    // prefix 命令专用
    'prefix.description': '通过追加目录名或字符串重命名文件',
    'prefix.nothing.to.do': '无需操作，退出。',
    'prefix.confirm.rename': '确定要重命名这 {{count}} 个文件吗？',
    
    // run 命令专用
    'run.description': '运行独立任务',
    
    // zipu 命令专用
    'zipu.description': '智能解压命令（自动检测编码）',
    
    // rename 命令专用
    'rename.description': '重命名文件：修复编码、正则替换、清理字符',
    'rename.processing': '处理文件名...',
    'rename.fixed.encoding': '修复编码: {{path}}',
    'rename.applied.regex': '应用正则: {{path}}',
    'rename.cleaned.chars': '清理字符: {{path}}',
    'rename.converted.tc.to.sc': '繁体转简体: {{path}}',
    'rename.one.operation.required': 'replace|clean|encoding|zhcn|mergeDirs, 至少需要其中一个',
    'rename.no.files.found': '未找到文件，中止 (type={{type}})',
    'rename.total.entries.found': '共找到',
    'rename.no.files.left.after.rules': '规则后无文件剩余，无需操作',
    'rename.duplicate.names.warning': '{{count1}}=>{{count2}} 部分文件有重复名称，请检查',
    'rename.files.skipped': '共跳过 {{count}} 个文件 (type={{type}})',
    'rename.files.ready.to.rename': '共 {{count}} 个文件准备重命名 (type={{type}})',
    'rename.nothing.to.do': '无需操作，中止 (type={{type}})',
    'rename.confirm.rename': '确定要重命名这些 {{count}} 个文件吗 (type={{type}})?',
    'rename.no.file.renamed.in.test.mode': '{{count}} 个文件，测试模式下未重命名 (type={{type}})',
    'rename.all.files.renamed': '所有 {{count}} 个文件已重命名 (type={{type}})',
    'error.type.must.be.one.of': '类型必须是以下之一',
    
    // 文件状态
    'file.status.exists': '已存在',
    'file.status.processing': '处理中',
    'file.status.completed': '已完成',
    'file.status.failed': '失败',
    
    // 确认消息
    'confirm.delete.original': '确定要删除原始文件吗？',
    'confirm.override.existing': '确定要覆盖已存在的文件吗？',
    
    // 命令选项描述
    // lrmove
    'option.lrmove.input': '输入文件夹路径',
    'option.lrmove.output': '输出文件夹路径',
    
    // compress
    'option.compress.output': '存储输出文件的文件夹',
    'option.compress.delete.source': '压缩后删除原始图片文件',
    'option.compress.quality': '目标图片文件压缩质量',
    'option.compress.size': '处理大于此大小的文件 (单位:K)',
    'option.compress.width': '图片长边的最大宽度',
    'option.compress.config': '压缩配置查询字符串，例如: q=85,w=6000,s=2048,suffix=_Z4K',
    'option.compress.jobs': '并行运行的作业数',
    'option.compress.doit': '以真实模式执行系统操作，而非试运行',
    'option.compress.force': '强制压缩所有文件',
    'option.compress.override': '覆盖已存在的目标文件',
    'option.compress.suffix': '压缩文件的文件名后缀',
    'option.compress.include': '文件名包含模式',
    'option.compress.exclude': '文件名排除模式',
    'option.compress.regex': '通过正则模式匹配文件名',
    'option.compress.extensions': '按扩展名包含文件（例如 .jpg|.png）',
    'option.compress.delete.source.only': '仅删除原始图片文件，不压缩',
    
    // dcim
    'option.dcim.backup': '重命名前备份原始文件',
    'option.dcim.fast': '快速模式 (使用文件修改时间，不解析 EXIF)',
    'option.dcim.prefix': '原始/图片/视频文件的自定义文件名前缀',
    'option.dcim.suffix': '自定义文件名后缀',
    'option.dcim.template': '文件名日期格式模板，参见 https://day.js.org/docs/en/display/format',
    'option.dcim.doit': '以真实模式执行系统操作，而非试运行',
    
    // ffmpeg
    'option.ffmpeg.output': '存储输出文件的文件夹',
    'option.ffmpeg.ffargs': 'ffmpeg 的复杂组合字符串参数',
    'option.ffmpeg.output.mode': '输出模式: 保持文件夹树/保持父目录/扁平化文件',
    'option.ffmpeg.start': '要处理的文件列表的起始索引',
    'option.ffmpeg.count': '要处理的文件列表的分组大小',
    'option.ffmpeg.preset': 'ffmpeg 命令的转换预设参数',
    'option.ffmpeg.show.presets': '显示预设详细信息列表',
    'option.ffmpeg.override': '强制覆盖已存在的文件',
    'option.ffmpeg.prefix': '添加到输出文件名的前缀',
    'option.ffmpeg.suffix': '添加到文件名的后缀',
    'option.ffmpeg.dimension': '视频的最大边长',
    'option.ffmpeg.fps': '输出帧率值',
    'option.ffmpeg.speed': '改变视频和音频的速度',
    'option.ffmpeg.video.args': '在 ffmpeg 命令中设置视频参数',
    'option.ffmpeg.video.bitrate': '在 ffmpeg 命令中设置视频比特率 (单位:K)',
    'option.ffmpeg.video.copy': '复制视频流到输出，不重新编码',
    'option.ffmpeg.video.quality': '在 ffmpeg 命令中设置视频质量',
    'option.ffmpeg.audio.args': '在 ffmpeg 命令中设置音频参数',
    'option.ffmpeg.audio.bitrate': '在 ffmpeg 命令中设置音频比特率 (单位:K)',
    'option.ffmpeg.audio.copy': '复制音频流到输出，不重新编码',
    'option.ffmpeg.audio.quality': '在 ffmpeg 命令中设置音频质量',
    'option.ffmpeg.filters': '在 ffmpeg 命令中设置滤镜',
    'option.ffmpeg.filter.complex': '在 ffmpeg 命令中设置复杂滤镜',
    'option.ffmpeg.error.file': '将错误日志写入文件 [json 或 text]',
    'option.ffmpeg.hwaccel': '视频解码和编码的硬件加速',
    'option.ffmpeg.decode.mode': '视频解码模式: auto/gpu/cpu',
    'option.ffmpeg.jobs': '并行运行的作业数',
    'option.ffmpeg.delete.source': '如果目标存在则删除源文件',
    'option.ffmpeg.info': '显示媒体文件信息',
    'option.ffmpeg.debug': '启用 ffmpeg 转换的调试模式',
    'option.ffmpeg.doit': '以真实模式执行系统操作，而非试运行',
    
    // remove
    'option.remove.loose': '如果为 true，条件操作为 OR，默认为 AND',
    'option.remove.output': '移动文件到此文件夹，或直接删除',
    'option.remove.output.tree': '在输出文件夹中保持文件夹树结构',
    'option.remove.width': '宽度小于此值的文件将被删除',
    'option.remove.height': '高度小于此值的文件将被删除',
    'option.remove.measure': '文件 x*y 尺寸，宽度和高度，例如: "123x456"',
    'option.remove.sizel': '大小大于此值的文件将被删除 (单位:K)',
    'option.remove.sizer': '大小小于此值的文件将被删除 (单位:K)',
    'option.remove.pattern': '文件名模式匹配此值的文件将被删除',
    'option.remove.not.match': '文件名模式不匹配此值的文件将被删除',
    'option.remove.list': '文件名列表文件，或包含文件名的目录',
    'option.remove.video': '根据视频元数据删除文件',
    'option.remove.type': '应用于文件类型 (a=全部,f=文件,d=目录)',
    'option.remove.reverse': '如果为 true 删除不在列表中的文件',
    'option.remove.corrupted': '删除损坏的文件',
    'option.remove.badchars': '删除包含非法或错误 Unicode 字符的文件',
    'option.remove.delete.permanently': '永久删除文件，而不仅仅是移动它',
    'option.remove.doit': '以真实模式执行系统操作，而非试运行',
    
    // rename
    'option.rename.input': '输入目录',
    'option.rename.cargs': '用于解析的复杂组合字符串参数',
    'option.rename.include': '文件名包含模式',
    'option.rename.exclude': '文件名排除模式',
    'option.rename.extensions': '按扩展名包含文件（例如 .mp4|.mkv）',
    'option.rename.clean': '移除文件名中的丑陋和特殊字符',
    'option.rename.separator': '清洁文件名的单词分隔符',
    'option.rename.replace': '通过模式替换文件名中的字符 [from,to]',
    'option.rename.replace.flags': '替换操作的特殊标志',
    'option.rename.fixenc': '通过猜测编码修复文件名',
    'option.rename.regex': '使用正则表达式进行替换',
    'option.rename.zhcn': '将中文字符从繁体转换为简体',
    'option.rename.prefix.media': '添加前缀到文件名，支持媒体模板参数',
    'option.rename.suffix.media': '添加后缀到文件名，支持媒体模板参数',
    'option.rename.suffix.date': '添加后缀到文件名，支持日期时间模板参数',
    'option.rename.video.dimension': '根据尺寸将视频文件移动到目录',
    'option.rename.merge.dirs': '减少重复命名的目录层次结构',
    'option.rename.jobs': '并行运行的作业数',
    'option.rename.doit': '以真实模式执行系统操作，而非试运行',
    'option.rename.type': '应用于文件类型 (a=全部,f=文件,d=目录)',
    'option.rename.max.depth': '遍历目录时的最大深度',
    
    // decode
    'option.decode.strings': '要解码的字符串列表',
    'option.decode.from.enc': '源编码名称，例如: utf8|gbk|shift_jis',
    'option.decode.to.enc': '目标编码名称，例如: utf8|gbk|shift_jis',
    
    // move
    'option.move.input': '输入目录',
    'option.move.output': '存储输出文件的文件夹',
    'option.move.include': '文件名包含模式',
    'option.move.exclude': '文件名排除模式',
    'option.move.extensions': '按扩展名包含文件（例如 .wav|.flac）',
    'option.move.max.depth': '遍历目录时的最大深度',
    'option.move.doit': '以真实模式执行系统操作，而非试运行',
    
    // moveup
    'option.moveup.output': '输出子文件夹名称',
    'option.moveup.mode': '输出的文件名前缀模式',
    'option.moveup.topmost': '移动文件到根目录下的子目录',
    'option.moveup.doit': '以真实模式执行系统操作，而非试运行',
    
    // prefix
    'option.prefix.length': '前缀字符串的最大长度',
    'option.prefix.include': '包含文件名模式',
    'option.prefix.exclude': '排除文件名模式',
    'option.prefix.prefix': '输出文件名前缀字符串',
    'option.prefix.mode': '输出的文件名前缀模式',
    'option.prefix.auto': '模式自动',
    'option.prefix.dirname': '模式目录名',
    'option.prefix.prefix': '模式前缀',
    'option.prefix.media': '模式媒体',
    'option.prefix.clean.only': '仅清理模式',
    'option.prefix.clean': '移除文件名中的特殊字符',
    'option.prefix.all': '强制重命名所有文件',
    'option.prefix.jobs': '并行运行的作业数',
    'option.prefix.doit': '以真实模式执行系统操作，而非试运行',
    
    // run
    'option.run.output': '存储输出文件的文件夹',
    'option.run.include': '文件名包含模式',
    'option.run.exclude': '文件名排除模式',
    'option.run.regex': '通过正则模式匹配文件名',
    'option.run.extensions': '按扩展名包含文件（例如 .wav|.flac）',
    
    // zipu
    'option.zipu.encoding': '用于 zip 文件名的编码',
    'option.zipu.override': '强制解压，覆盖已存在的文件',
    'option.zipu.start': '要处理的文件列表的起始索引',
    'option.zipu.count': '要处理的文件列表的分组大小',
    'option.zipu.tcsc': '将中文从繁体转换为简体',
    'option.zipu.purge': '解压成功后删除 zip 文件',
    'option.zipu.doit': '以真实模式执行系统操作，而非试运行',
    
    // 跳过原因
    'skip.dst.exists': '目标已存在',
    'skip.invalid.format': '格式无效',
    'skip.size.limit': '大小超限',
    
    // 输入验证
    'input.path.empty': '输入路径不能为空',
    'input.path.not.exists': '输入路径不存在: {{path}}',
    'input.invalid': '无效输入: {{path}}',
    
    // 通用提示
    'please.check.path': '请检查文件路径是否正确',
    'please.check.permissions': '请检查文件权限',
    'use.help.for.guide': '使用 --help 查看使用指南',
    
    // 错误消息
    'error.argument': '参数错误',
    'error.processing': '处理错误',
    'error.unknown': '未知错误',
    
    // 成功消息
    'success.completed': '操作完成',
    'success.moved': '移动完成',
    
    // 状态消息
    'status.processing': '处理中...',
    'status.checking': '检查中...',
    'status.finished': '已完成',
    
    // 确认消息
    'confirm.continue': '是否继续？',
    'confirm.yes': '是',
    'confirm.no': '否',
    
    // 帮助信息
    'help.usage': '用法',
    'help.commands': '命令',
    'help.options': '选项',
    'help.examples': '示例',
    
    // 程序信息
    'app.name': 'MediaCli',
    'app.description': '多媒体文件处理工具',
    'app.copyright': '版权所有 2021-2026 @ Zhang Xiaoke'
  },
  
  [Languages.EN_US]: {
    // 通用消息
    'commands.lrmove.description': 'Move JPEG output of RAW files to other folder',
    'commands.lrmove.total.folders': 'Total {{count}} JPEG folders found',
    'commands.lrmove.nothing.to.do': 'Nothing to do, abort.',
    'commands.lrmove.move.confirm': 'Are you sure to move these {{count}} JPEG folder with files?',
    'commands.lrmove.moved': 'Moved: {{src}} to {{dst}}',
    'commands.lrmove.failed': 'Failed: {{error}} {{src}} to {{dst}}',
    'commands.lrmove.aborted': 'Will do nothing, aborted by user.',
    'commands.lrmove.will.do.nothing': 'Will do nothing, aborted by user.',
    
    // 通用操作
    'operation.completed': 'Operation completed: {{success}} success, {{error}} errors',
    'operation.cancelled': 'Operation cancelled, no changes made.',
    
    // 文件操作
    'file.not.found': 'File not found',
    'file.access.denied': 'File access denied',
    'file.already.exists': 'File already exists',
    'invalid.path': 'Invalid file path',
    'file.moved': 'Moved',
    'file.failed': 'Failed',
    
    // 路径标识
    'path.source': 'Source',
    'path.destination': 'Destination',
    'path.input': 'Input',
    
    // 处理状态
    'status.processing': 'Processing',
    'status.exists': 'Exists',
    'status.skipped': 'Skipped',
    'status.completed': 'Completed',
    
    // 模式标识
    'mode.test': 'Test Mode',
    'mode.dryrun': 'Dry Run',
    'mode.fast': 'Fast Mode',
    
    // 操作类型
    'operation.rename': 'Rename',
    'operation.move': 'Move',
    'operation.compress': 'Compress',
    'operation.delete': 'Delete',
    
    // compress command specific
    'compress.description': 'Compress input images to target size',
    'compress.preparing': 'Preparing compress arguments...',
    'compress.files.skipped': '${{count}} image files skipped',
    'compress.nothing.to.do': 'Nothing to do, abort.',
    'compress.tasks.summary': 'Tasks Summary',
    'compress.delete.confirm': 'Are you sure to delete ${count} original files?',
    'compress.delete.aborted': 'Will do nothing, aborted by user.',
    'compress.safely.removed': '${{count}} files are safely removed',
    'compress.processing': '${{index}}/{{total}} {{path}} {{srcSize}}x{{srcSize}}=>{{dstSize}}x{{dstSize}} {{format}} {{humanSize}}',
    'compress.dst.path': '${{index}}/{{total}} DST: {{path}}',
    'compress.check.exists': 'Check S=${{srcExists}} D=${{dstExists}} {{path}}',
    'compress.safe.delete': 'SafeDel: ${{index}}/{{total}} {{path}}',
    'compress.no.files.found': 'No files found, abort.',
    'compress.continue.processing': 'Press y to continue processing...',
    'compress.total.files.found': 'Total {{count}} files found',
    'compress.confirm': 'Are you sure to compress {{count}} files?\n[Apply to files larger than {{sizeK}}K, target long side width is {{maxWidth}}] \n{{note}}',
    'compress.warning.delete': '(Note: You will delete original files!)',
    'compress.warning.keep': '(Original files will be kept)',
    'compress.note.no.thumbnail': 'no thumbnails will be generated.',
    'compress.files.compressed': 'files compressed',
    'compress.tasks.failed': 'tasks failed',
    'compress.failed.list': 'Failed files list',
    
    // dcim command specific
    'dcim.description': 'Rename media files by exif metadata eg. date',
    'dcim.total.files.found': 'Total {{count}} media files found',
    'dcim.no.files.found': 'No files found, exit now.',
    'dcim.continue.processing': 'Press y to continue processing...',
    'dcim.aborted.by.user': 'Will do nothing, aborted by user.',
    'dcim.processing.exif': 'Processing files, reading EXIF data...',
    'dcim.files.parsed': 'Total {{count}} media files parsed',
    'dcim.files.skipped': 'Total {{count}} media files skipped',
    'dcim.files.processed': 'Total {{count}} files processed in {{time}}',
    'dcim.files.skipped.by.size': 'Total {{count}} media files are skipped by size',
    'dcim.files.skipped.by.date': 'Total {{count}} media files are skipped by date',
    'dcim.nothing.to.do': 'Nothing to do, exit now.',
    'dcim.files.ready': 'Total {{count}} media files ready to rename by exif',
    'dcim.task.sample': 'task sample list:',
    'dcim.rename.confirm': 'Are you sure to rename {{count}} files?',
    'dcim.test.mode.note': 'All {{count}} files, NO file renamed in TEST MODE.',
    'dcim.files.renamed': 'All {{count}} file were renamed.',
    
    // ffmpeg command specific
    'ffmpeg.description': 'convert audio or video files using ffmpeg.',
    'ffmpeg.input': 'Input: {{path}}',
    'ffmpeg.add.files': 'Add {{count}} extra files from {{path}}',
    'ffmpeg.total.files': 'Total {{count}} files left after filename rules.',
    'ffmpeg.no.files.left': 'No files left after rules, nothing to do.',
    'ffmpeg.check.details': 'Please CHECK above details BEFORE continue!',
    'ffmpeg.preparing.tasks': 'Now Preparing task files and ffmpeg cmd args...',
    'ffmpeg.all.skipped': 'All tasks are skipped, nothing to do.',
    'ffmpeg.test.mode': 'TEST MODE (DRY RUN)',
    'ffmpeg.processing.file': 'Processing file: {{path}}',
    'ffmpeg.conversion.success': 'Conversion success: {{path}}',
    'ffmpeg.conversion.failed': 'Conversion failed: {{path}}',
    'ffmpeg.confirm.continue': 'Are you sure to continue to process these {{count}} files?',
    'ffmpeg.confirm.check': 'Please check above values, press y/yes to continue. [{{preset}}]',
    'ffmpeg.confirm.delete.source': 'Destination files of {{count}} entries already exists, do you want to delete the source files of them?',
    'ffmpeg.confirm.process': 'Are you sure to process these {{count}} files? [{{preset}}] (total {{duration}})',
    'ffmpeg.not.found': 'ffmpeg executable not found in path',
    'ffmpeg.confirm.retry': '{{count}} tasks failed, do you want to retry these tasks?',
    'ffmpeg.test.mode.note': 'NO file processed in TEST MODE.',
    'ffmpeg.total.processed': 'Total {{count}} files processed in {{time}}',
    'ffmpeg.aborted.by.user': 'Will do nothing, aborted by user.',
    'ffmpeg.include': 'filename include pattern',
    'ffmpeg.exclude': 'filename exclude pattern',
    'ffmpeg.regex': 'match filenames by regex pattern',
    'ffmpeg.extensions': 'include files by extensions (eg. .wav|.flac)',
    
    // remove command specific
    'remove.description': 'Remove files by given size/width-height/name-pattern/file-list',
    'remove.scanning': 'Scanning files...',
    'remove.found.files': 'Found {{count}} files matching criteria',
    'remove.confirm.delete': 'Are you sure to remove {{count}} files (Size:{{size}}) using above conditions (type={{type}})?',
    'remove.deleted': 'Deleted {{count}} files',
    'remove.skipped': 'Skipped {{count}} files',
    'remove.files.skipped': 'Skipped {{count}} files',
    'remove.files.to.remove': '{{count}} files to be removed (type={{type}})',
    'remove.attention.list': 'Attention: use file name list, ignore all other conditions',
    'remove.attention.delete': 'Attention: Will DELETE all files {{reverse}} name list!',
    'remove.required.conditions': 'required remove condition args not supplied',
    'remove.test.mode.note': '{{count}} files, NO file removed in TEST MODE.',
    'remove.failed': 'Failed to remove file',
    'remove.summary': '{{count}} files removed in {{time}} (type={{type}})',
    'remove.include': 'filename include pattern',
    'remove.exclude': 'filename exclude pattern',
    'remove.regex': 'match filenames by regex pattern',
    'remove.extensions': 'include files by extensions (eg. .wav|.flac)',
    
    // decode command specific
    'decode.description': 'Decode text with messy or invalid chars',
    'decode.text.input.required': 'text input required',
    
    // move command specific
    'move.description': 'Move files to folders by filename date patterns',
    'move.no.date.skip': 'No Date, Skip',
    'move.duplicate.file.skip': 'Duplicate File, Skip',
    'move.in.destination': 'In Destination',
    'move.same.file.skip': 'Same File, Skip',
    'move.different.file.need.rename': 'Different File, Need Rename',
    'move.total.entries.found': 'Total',
    'move.total.entries.left.after.rules': 'left after rules',
    'move.found': 'Found',
    'move.total.files.skipped': 'Total skipped',
    'move.total.files.ready.to.move': 'Total ready to move',
    'move.nothing.to.do': 'Nothing to do, abort.',
    'move.sample.files': 'Sample files',
    'move.no.files.will.be.moved': 'TEST MODE (DRY RUN), no files will be moved',
    'move.confirm.move': 'Are you sure to move {{count}} files?',
    'move.files.skipped.in.dir': '{{count}} files are skipped in {{dir}}',
    'move.files.moved.to.dir': '{{count}} files are moved to {{dir}}',
    
    // moveup command specific
    'moveup.description': 'Move files to sub top folder or top folder',
    
    // prefix command specific
    'prefix.description': 'Rename files by append dir name or string',
    'prefix.nothing.to.do': 'Nothing to do, exit now.',
    'prefix.confirm.rename': 'Are you sure to rename these {{count}} files?',
    
    // run command specific
    'run.description': 'Run standalone tasks',
    
    // zipu command specific
    'zipu.description': 'Smart unzip command (auto detect encoding)',
    
    // rename command specific
    'rename.description': 'Reanme files: fix encoding, replace by regex, clean chars, from tc to sc.',
    'rename.processing': 'Processing filenames...',
    'rename.fixed.encoding': 'Fixed encoding: {{path}}',
    'rename.applied.regex': 'Applied regex: {{path}}',
    'rename.cleaned.chars': 'Cleaned chars: {{path}}',
    'rename.converted.tc.to.sc': 'Converted tc to sc: {{path}}',
    'rename.one.operation.required': 'replace|clean|encoding|zhcn|mergeDirs, one is required',
    'rename.no.files.found': 'No files found, abort. (type={{type}})',
    'rename.total.entries.found': 'Total',
    'rename.no.files.left.after.rules': 'No files left after rules, nothing to do.',
    'rename.duplicate.names.warning': '{{count1}}=>{{count2}} some files have duplicate names, please check.',
    'rename.files.skipped': 'Total {{count}} files are skipped. (type={{type}})',
    'rename.files.ready.to.rename': 'Total {{count}} files ready to rename. (type={{type}})',
    'rename.nothing.to.do': 'Nothing to do, abort. (type={{type}})',
    'rename.confirm.rename': 'Are you sure to rename these {{count}} files (type={{type}})?',
    'rename.no.file.renamed.in.test.mode': '{{count}} files, NO file renamed in TEST MODE. (type={{type}})',
    'rename.all.files.renamed': 'All {{count}} file were renamed. (type={{type}})',
    'error.type.must.be.one.of': 'type must be one of',
    
    // File status
    'file.status.exists': 'Exists',
    'file.status.processing': 'Processing',
    'file.status.completed': 'Completed',
    'file.status.failed': 'Failed',
    
    // Confirmation messages
    'confirm.delete.original': 'Are you sure to delete original files?',
    'confirm.override.existing': 'Are you sure to override existing files?',
    
    // Command option descriptions
    // lrmove
    'option.lrmove.input': 'Input folder path',
    'option.lrmove.output': 'Output folder path',
    
    // compress
    'option.compress.output': 'Folder store ouput files',
    'option.compress.delete.source': 'Delete original image files after compress',
    'option.compress.quality': 'Target image file compress quality',
    'option.compress.size': 'Processing file bigger than this size (unit:k)',
    'option.compress.width': 'Max width of long side of image thumb',
    'option.compress.config': 'compress config in one query string, such as: q=85,w=6000,s=2048,suffix=_Z4K',
    'option.compress.jobs': 'multi jobs running parallelly',
    'option.compress.doit': 'execute os operations in real mode, not dry run',
    'option.compress.force': 'Force compress all files',
    'option.compress.override': 'Override existing dst files',
    'option.compress.suffix': 'filename suffix for compressed files',
    'option.compress.include': 'filename include pattern',
    'option.compress.exclude': 'filename exclude pattern',
    'option.compress.regex': 'match filenames by regex pattern',
    'option.compress.extensions': 'include files by extensions (eg. .jpg|.png)',
    'option.compress.delete.source.only': 'Just delete original image files only, no compression',
    
    // dcim
    'option.dcim.backup': 'backup original file before rename',
    'option.dcim.fast': 'fast mode (use file modified time, no exif parse)',
    'option.dcim.prefix': 'custom filename prefix for raw/image/video files',
    'option.dcim.suffix': 'custom filename suffix',
    'option.dcim.template': 'filename date format template, see https://day.js.org/docs/en/display/format',
    'option.dcim.doit': 'execute os operations in real mode, not dry run',
    
    // ffmpeg
    'option.ffmpeg.output': 'Folder store ouput files',
    'option.ffmpeg.ffargs': 'complex combined string parameters for ffmpeg',
    'option.ffmpeg.output.mode': 'Output mode: keep folder tree/keep parent dir/ flatten files',
    'option.ffmpeg.start': 'start index of file list to process',
    'option.ffmpeg.count': 'group size of file list to process',
    'option.ffmpeg.preset': 'convert preset args for ffmpeg command',
    'option.ffmpeg.show.presets': 'show presets details list',
    'option.ffmpeg.override': 'force to override existting files',
    'option.ffmpeg.prefix': 'add prefix to output filename',
    'option.ffmpeg.suffix': 'add suffix to filename',
    'option.ffmpeg.dimension': 'chang max side for video',
    'option.ffmpeg.fps': 'output framerate value',
    'option.ffmpeg.speed': 'chang speed for video and audio',
    'option.ffmpeg.video.args': 'Set video args in ffmpeg command',
    'option.ffmpeg.video.bitrate': 'Set video bitrate (in kbytes) in ffmpeg command',
    'option.ffmpeg.video.copy': 'Copy video stream to ouput, no re-encoding',
    'option.ffmpeg.video.quality': 'Set video quality in ffmpeg command',
    'option.ffmpeg.audio.args': 'Set audio args in ffmpeg command',
    'option.ffmpeg.audio.bitrate': 'Set audio bitrate (in kbytes) in ffmpeg command',
    'option.ffmpeg.audio.copy': 'Copy audio stream to ouput, no re-encoding',
    'option.ffmpeg.audio.quality': 'Set audio quality in ffmpeg command',
    'option.ffmpeg.filters': 'Set filters in ffmpeg command',
    'option.ffmpeg.filter.complex': 'Set complex filters in ffmpeg command',
    'option.ffmpeg.error.file': 'Write error logs to file [json or text]',
    'option.ffmpeg.hwaccel': 'hardware acceleration for video decode and encode',
    'option.ffmpeg.decode.mode': 'video decode mode: auto/gpu/cpu',
    'option.ffmpeg.jobs': 'multi jobs running parallelly',
    'option.ffmpeg.delete.source': 'delete source file if destination is exists',
    'option.ffmpeg.info': 'show info of media files',
    'option.ffmpeg.debug': 'enable debug mode for ffmpeg convert',
    'option.ffmpeg.doit': 'execute os operations in real mode, not dry run',
    
    // remove
    'option.remove.loose': 'If true, operation of conditions is OR, default AND',
    'option.remove.output': 'move files to this folder, or just deleted',
    'option.remove.output.tree': 'keep folder tree structure in output folder',
    'option.remove.width': 'Files width smaller than value will be removed',
    'option.remove.height': 'Files height smaller than value will be removed',
    'option.remove.measure': 'File x*y dimension, width and height, eg: "123x456"',
    'option.remove.sizel': 'Files size bigger than value will be removed (unit:k)',
    'option.remove.sizer': 'Files size smaller than value will be removed (unit:k)',
    'option.remove.pattern': 'Files name pattern matched value will be removed',
    'option.remove.not.match': 'Files name pattern not matched value will be removed',
    'option.remove.list': 'File name list file, or dir contains files for file name',
    'option.remove.video': 'Remove files by video metadata',
    'option.remove.type': 'applied to file type (a=all,f=file,d=dir)',
    'option.remove.reverse': 'delete files in list, if true delete files not in the list',
    'option.remove.corrupted': 'delete corrupted files',
    'option.remove.badchars': 'delete files with illegal or bad unicode chars',
    'option.remove.delete.permanently': 'delete file permanently, not just move it',
    'option.remove.doit': 'execute os operations in real mode, not dry run',
    
    // rename
    'option.rename.input': 'input directory',
    'option.rename.cargs': 'complex combined string arguments for parse',
    'option.rename.include': 'filename include pattern',
    'option.rename.exclude': 'filename exclude pattern',
    'option.rename.extensions': 'include files by extensions (eg. .mp4|.mkv)',
    'option.rename.clean': 'remove ugly and special chars in filename',
    'option.rename.separator': 'word separator for clean filenames',
    'option.rename.replace': 'replace filename chars by pattern [from,to]',
    'option.rename.replace.flags': 'special flag for replace operations',
    'option.rename.fixenc': 'fix filenames by guess encoding',
    'option.rename.regex': 'use regex for replace operation',
    'option.rename.zhcn': 'convert from tc to sc for Chinese chars',
    'option.rename.prefix.media': 'add prefix to filename, support media template args',
    'option.rename.suffix.media': 'add suffix to filename, support media template args',
    'option.rename.suffix.date': 'add suffix to filename, support date time template args',
    'option.rename.video.dimension': 'move video files to dir according to dimension',
    'option.rename.merge.dirs': 'reduce duplicate named directory hierarchy',
    'option.rename.jobs': 'multi jobs running parallelly',
    'option.rename.doit': 'execute os operations in real mode, not dry run',
    'option.rename.type': 'applied to file type (a=all,f=file,d=dir)',
    'option.rename.max.depth': 'max depth when walk directories and files',
    
    // decode
    'option.decode.strings': 'string list to decode',
    'option.decode.from.enc': 'from encoding name eg. utf8|gbk|shift_jis',
    'option.decode.to.enc': 'to encoding name eg. utf8|gbk|shift_jis',
    
    // move
    'option.move.input': 'input directory',
    'option.move.output': 'Folder store output files',
    'option.move.include': 'filename include pattern',
    'option.move.exclude': 'filename exclude pattern',
    'option.move.extensions': 'include files by extensions (eg. .wav|.flac)',
    'option.move.max.depth': 'max depth when walk directories and files',
    'option.move.doit': 'execute os operations in real mode, not dry run',
    
    // moveup
    'option.moveup.output': 'Output sub folder name',
    'option.moveup.mode': 'filename prefix mode for output',
    'option.moveup.topmost': 'move files to sub dirs in root dir',
    'option.moveup.doit': 'execute os operations in real mode, not dry run',
    
    // prefix
    'option.prefix.length': 'max length of prefix string',
    'option.prefix.include': 'include filename patterns',
    'option.prefix.exclude': 'exclude filename patterns',
    'option.prefix.prefix': 'filename prefix str for output',
    'option.prefix.mode': 'filename prefix mode for output',
    'option.prefix.auto': 'mode auto',
    'option.prefix.dirname': 'mode dirname',
    'option.prefix.prefix': 'mode prefix',
    'option.prefix.media': 'mode media',
    'option.prefix.clean.only': 'mode clean only',
    'option.prefix.clean': 'remove special chars in filename',
    'option.prefix.all': 'force rename all files',
    'option.prefix.jobs': 'multi jobs running parallelly',
    'option.prefix.doit': 'execute os operations in real mode, not dry run',
    
    // run
    'option.run.output': 'Folder store output files',
    'option.run.include': 'filename include pattern',
    'option.run.exclude': 'filename exclude pattern',
    'option.run.regex': 'match filenames by regex pattern',
    'option.run.extensions': 'include files by extensions (eg. .wav|.flac)',
    
    // zipu
    'option.zipu.encoding': 'use this encoding for zip filenames',
    'option.zipu.override': 'force unzip, override existing files',
    'option.zipu.start': 'start index of file list to process',
    'option.zipu.count': 'group size of file list to process',
    'option.zipu.tcsc': 'convert Chinese from TC to SC',
    'option.zipu.purge': 'delete zip file after unzipped ok',
    'option.zipu.doit': 'execute os operations in real mode, not dry run',
    
    // 跳过原因
    'skip.dst.exists': 'Destination Exists',
    'skip.invalid.format': 'Invalid Format',
    'skip.size.limit': 'Size Limit Exceeded',
    
    // 输入验证
    'input.path.empty': 'Input path cannot be empty',
    'input.path.not.exists': 'Input path does not exist: {{path}}',
    'input.invalid': 'Invalid input: {{path}}',
    
    // 通用提示
    'please.check.path': 'Please check if the file path is correct',
    'please.check.permissions': 'Please check file permissions',
    'use.help.for.guide': 'Use --help for usage guide',
    
    // 错误消息
    'error.argument': 'Argument error',
    'error.processing': 'Processing error',
    'error.unknown': 'Unknown error',
    
    // 成功消息
    'success.completed': 'Operation completed',
    'success.moved': 'Move completed',
    
    // 状态消息
    'status.processing': 'Processing...',
    'status.checking': 'Checking...',
    'status.finished': 'Finished',
    
    // 确认消息
    'confirm.continue': 'Do you want to continue?',
    'confirm.yes': 'Yes',
    'confirm.no': 'No',
    
    // 帮助信息
    'help.usage': 'Usage',
    'help.commands': 'Commands',
    'help.options': 'Options',
    'help.examples': 'Examples',
    
    // 程序信息
    'app.name': 'MediaCli',
    'app.description': 'Multimedia file processing tool',
    'app.copyright': 'Copyright 2021-2026 @ Zhang Xiaoke'
  }
}

class I18n {
  constructor() {
    this.currentLanguage = this.detectLanguage()
    this.fallbackLanguage = Languages.EN_US
  }
  
  // 检测系统语言
  detectLanguage() {
    const envLang = process.env.LANG || process.env.LANGUAGE || ''
    const envLcAll = process.env.LC_ALL || ''
    
    // 优先使用环境变量
    if (envLang.includes('zh') || envLang.includes('cn') || 
        envLcAll.includes('zh') || envLcAll.includes('cn')) {
      return Languages.ZH_CN
    }
    
    // 检查是否为中文 Windows 系统
    if (process.platform === 'win32') {
      // Windows 系统下，默认使用中文
      return Languages.ZH_CN
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
    Object.keys(params).forEach(param => {
      const placeholder = `{{${param}}}`
      text = text.replace(new RegExp(placeholder, 'g'), params[param])
    })
    
    return text
  }
  
  // 获取文本（内部方法）
  getText(key) {
    // 尝试获取当前语言的文本
    if (resources[this.currentLanguage] && resources[this.currentLanguage][key]) {
      return resources[this.currentLanguage][key]
    }
    
    // 回退到默认语言
    if (resources[this.fallbackLanguage] && resources[this.fallbackLanguage][key]) {
      return resources[this.fallbackLanguage][key]
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