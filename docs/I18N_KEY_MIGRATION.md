# I18N 翻译键迁移映射

## 通用键迁移

### 旧键 -> 新键

#### 通用消息
- `commands.lrmove.aborted` -> `common.aborted.by.user`
- `compress.delete.aborted` -> `common.aborted.by.user`
- `dcim.aborted.by.user` -> `common.aborted.by.user`
- `ffmpeg.aborted.by.user` -> `common.aborted.by.user`

- `commands.lrmove.nothing.to.do` -> `common.nothing.to.do`
- `compress.nothing.to.do` -> `common.nothing.to.do`
- `dcim.nothing.to.do` -> `common.nothing.to.do`
- `move.nothing.to.do` -> `common.nothing.to.do`
- `prefix.nothing.to.do` -> `common.nothing.to.do`

- `compress.continue.processing` -> `common.continue.processing`
- `dcim.continue.processing` -> `common.continue.processing`

- `dcim.test.mode.note` -> `common.test.mode.note` (使用参数)
- `ffmpeg.test.mode.note` -> `common.test.mode.note`
- `remove.test.mode.note` -> `common.test.mode.note`
- `rename.no.file.renamed.in.test.mode` -> `common.test.mode.note`

#### 状态
- `file.status.exists` -> `status.exists`
- `file.status.processing` -> `status.processing`
- `file.status.completed` -> `status.completed`
- `file.status.failed` -> `file.failed`

- `status.finished` -> `status.completed`
- `success.completed` -> `status.completed`

#### 选项
- `option.compress.include` -> `option.common.include`
- `option.ffmpeg.include` -> `option.common.include`
- `option.remove.include` -> `option.common.include`
- `option.rename.include` -> `option.common.include`
- `option.move.include` -> `option.common.include`
- `option.run.include` -> `option.common.include`
- `option.prefix.include` -> `option.common.include`

- `option.compress.exclude` -> `option.common.exclude`
- `option.ffmpeg.exclude` -> `option.common.exclude`
- `option.remove.exclude` -> `option.common.exclude`
- `option.rename.exclude` -> `option.common.exclude`
- `option.move.exclude` -> `option.common.exclude`
- `option.run.exclude` -> `option.common.exclude`
- `option.prefix.exclude` -> `option.common.exclude`

- `option.compress.regex` -> `option.common.regex`
- `option.ffmpeg.regex` -> `option.common.regex`
- `option.remove.regex` -> `option.common.regex`
- `option.run.regex` -> `option.common.regex`

- `option.compress.extensions` -> `option.common.extensions`
- `option.ffmpeg.extensions` -> `option.common.extensions`
- `option.remove.extensions` -> `option.common.extensions`
- `option.rename.extensions` -> `option.common.extensions`
- `option.move.extensions` -> `option.common.extensions`
- `option.run.extensions` -> `option.common.extensions`

- `option.compress.output` -> `option.common.output`
- `option.ffmpeg.output` -> `option.common.output`
- `option.move.output` -> `option.common.output`
- `option.run.output` -> `option.common.output`

- `option.rename.input` -> `option.common.input`
- `option.move.input` -> `option.common.input`

- `option.compress.jobs` -> `option.common.jobs`
- `option.ffmpeg.jobs` -> `option.common.jobs`
- `option.rename.jobs` -> `option.common.jobs`
- `option.prefix.jobs` -> `option.common.jobs`

- `option.compress.doit` -> `option.common.doit`
- `option.dcim.doit` -> `option.common.doit`
- `option.ffmpeg.doit` -> `option.common.doit`
- `option.remove.doit` -> `option.common.doit`
- `option.rename.doit` -> `option.common.doit`
- `option.move.doit` -> `option.common.doit`
- `option.moveup.doit` -> `option.common.doit`
- `option.prefix.doit` -> `option.common.doit`
- `option.zipu.doit` -> `option.common.doit`

- `option.rename.max.depth` -> `option.common.max.depth`
- `option.move.max.depth` -> `option.common.max.depth`

## 命令特定的简化键

### compress
- `compress.delete.source` (保留)
- `compress.delete.source.only` (保留)
- `compress.quality` -> `compress.quality`
- `compress.size` -> `compress.size`
- `compress.width` -> `compress.width`
- `compress.config` -> `compress.config`
- `compress.force` -> `compress.force`
- `compress.override` -> `compress.override`
- `compress.suffix` -> `compress.suffix`

### dcim
- `dcim.backup` (保留)
- `dcim.fast` (保留)
- `dcim.prefix` (保留)
- `dcim.suffix` (保留)
- `dcim.template` (保留)

### ffmpeg
- `ffmpeg.ffargs` (保留)
- `ffmpeg.output.mode` (保留)
- `ffmpeg.start` (保留)
- `ffmpeg.count` (保留)
- `ffmpeg.preset` (保留)
- `ffmpeg.show.presets` (保留)
- `ffmpeg.override` (保留)
- `ffmpeg.prefix` (保留)
- `ffmpeg.suffix` (保留)
- `ffmpeg.dimension` (保留)
- `ffmpeg.fps` (保留)
- `ffmpeg.speed` (保留)
- `ffmpeg.video.args` (保留)
- `ffmpeg.video.bitrate` (保留)
- `ffmpeg.video.copy` (保留)
- `ffmpeg.video.quality` (保留)
- `ffmpeg.audio.args` (保留)
- `ffmpeg.audio.bitrate` (保留)
- `ffmpeg.audio.copy` (保留)
- `ffmpeg.audio.quality` (保留)
- `ffmpeg.filters` (保留)
- `ffmpeg.filter.complex` (保留)
- `ffmpeg.error.file` (保留)
- `ffmpeg.hwaccel` (保留)
- `ffmpeg.decode.mode` (保留)
- `ffmpeg.delete.source` (保留)
- `ffmpeg.info` (保留)
- `ffmpeg.debug` (保留)

### rename
- `rename.cargs` (保留)
- `rename.clean` (保留)
- `rename.separator` (保留)
- `rename.replace` (保留)
- `rename.replace.flags` (保留)
- `rename.fixenc` (保留)
- `rename.regex` (保留)
- `rename.zhcn` (保留)
- `rename.prefix.media` (保留)
- `rename.suffix.media` (保留)
- `rename.suffix.date` (保留)
- `rename.video.dimension` (保留)
- `rename.merge.dirs` (保留)
- `rename.type` (保留)

### 其他
- `option.moveup.output` (保留)
- `option.moveup.mode` (保留)
- `option.moveup.topmost` (保留)
- `option.prefix.length` (保留)
- `option.prefix.prefix` (保留)
- `option.prefix.auto` (保留)
- `option.prefix.dirname` (保留)
- `option.prefix.media` (保留)
- `option.prefix.clean.only` (保留)
- `option.prefix.clean` (保留)
- `option.prefix.all` (保留)
- `option.zipu.encoding` (保留)
- `option.zipu.override` (保留)
- `option.zipu.start` (保留)
- `option.zipu.count` (保留)
- `option.zipu.tcsc` (保留)
- `option.zipu.purge` (保留)
