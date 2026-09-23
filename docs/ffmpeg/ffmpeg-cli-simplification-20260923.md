# FFmpeg CLI 参数与代码精简优化方案

> **日期**: 2026-09-23  
> **状态**: 方案定稿，进入实施  
> **适用模块**: `cmd/cmd_ffmpeg.js`, `lib/ffmpeg_*.js`, `presets/default.yaml`  
> **核心定位**: `mediac ffmpeg` 专注于**自动化批量视频压制**（目录遍历、文件树保持、跨硬件加速分层、受控转码质量/尺寸/帧率/倍速、安全确认）。非压制向的复杂高级自定义交由原生 `ffmpeg` 处理。

---

## 0. 方案背景与目标

在既有实现中，CLI 暴露了 `--video-args` (`-va`), `--audio-args` (`-aa`), `--filters` (`-fs`), `--filter-complex` (`-fc`) 等原始字符串追加参数。在实际运行中，这组参数引入了多项设计与维护痛点：
1. **硬件分层与 Raw 参数天然冲突**：`mediac` 核心能力为 GPU/CPU 自动分层与降级（NVENC -> QSV -> AMF -> swdec -> CPU），而用户传入的 raw 参数（如 `-tune film`）大多为特定编码器专属，跨层或降级时极易导致崩溃，为此代码库不得不维护额外的启发式警告与 RESERVED 拦截代码。
2. **Yargs CLI 转义问题**：以 `-` 开头的参数值容易被 yargs 误吞，产生命令行写法心智负担。
3. **定位越界与功能冗余**：常用压制需求（`--dimension` 缩放、`--fps` 帧率、`--speed` 变速、`--anime` 动漫优化、`--video-codec`、`--video-bitrate`、`--video-quality`、`--video-copy`、`--metadata`）已 100% 结构化一等公民支持。复杂滤镜图与极端编码调优应由原生 `ffmpeg` 承担。

**本方案目标**：
- 移除 CLI raw 选项，收敛参数面为纯结构化选项。
- 拔除为 raw 参数服务的死代码、防御代码与词表文件。
- 修正陈旧的报错指引文案。
- 清理内置预设中的冗余空字符串属性。
- 保留批量处理前的两级防护确认（批量前检查确认 + 执行前终审确认）。

---

## 1. 参数与功能变更清单

### 1.1 命令行参数变更
| 命令行选项 | 别名 | 处理操作 | 说明 |
| --- | --- | --- | --- |
| `--video-args` | `-va` | **移除** | 消除与硬件分层的冲突；移除 RESERVED `-c:v` 拦截 |
| `--audio-args` | `-aa` | **移除** | 音频压制由 `--audio-bitrate`、`--audio-quality`、`--audio-copy` 承载 |
| `--filters` | `-fs` | **移除** | 压制滤镜已原生支持 `dimension`、`fps`、`speed` |
| `--filter-complex` | `-fc` | **移除** | 越界功能；压制工具无需暴露复杂滤镜图 |

### 1.2 保留的参数体系
- **预设系统**: `--preset`
- **受控结构化复合参数**: `--ffargs`（支持 `vb=`, `vq=`, `vc=`, `ab=`, `aq=`, `ac=`, `px=`, `sx=`, `sp=`, `dm=`, `fps=`, `md=` 等）
- **独立元数据通道**: `--metadata "title=X;artist=Y"`
- **单项覆盖**: `--dimension`, `--fps`, `--speed`, `--video-codec`, `--video-bitrate`, `--video-quality`, `--video-copy`, `--audio-copy` 等
- **执行与交互控制**: `--doit`, `--auto-confirm`, `--jobs`, `--output`, `--output-mode`, `--delete-source-files`, `--override`, `--strict`
- **确认机制**:
  - `ffmpeg.confirm.check`（准备任务前检查确认，防止大批量误跑）：**明确保留**。
  - `ffmpeg.confirm.process`（执行前终审确认）：**保留**。

---

## 2. 关联代码清理与精简范围

### 2.1 `cmd/cmd_ffmpeg.js`
- 移除 builder 中的 4 个 options（`video-args`, `audio-args`, `filters`, `filter-complex`）。
- 移除 `detectEncoderSpecificArgs` 启发式检测函数及引用。
- 移除 `planFFmpegTasks` 中的 RESERVED `-c:v` 拦截逻辑与专属参数告警逻辑。
- 清理 `prepareFFmpegCmd` 中的空 `switch (argv.decodeMode)` 占位块。

### 2.2 `lib/ffmpeg_args_known.js`
- 判定：`ENCODER_SPECIFIC_ARGS` 仅用于 `--video-args` 告警；`KNOWN_FFMPEG_ARGS` 在全库零引用。
- 处理：**删除整个文件**，并在依赖它的模块中移除 import。

### 2.3 `lib/ffmpeg_build.js`
- 移除内部辅助函数 `splitArgs`。
- `buildVideoArgsFromPlan`：移除追加 `userArgs.videoExtra` 的逻辑。
- `buildAudioArgs`：移除追加 `userArgs.audioExtra` 的逻辑。
- 移除复杂滤镜处理函数 `resolveComplexFilterScale`。
- `buildFilterArgs`：移除 `complexFilter` 分支，直接聚焦 `-vf` 单滤镜链。
- 清理 `tempPreset.extraArgs` 遗留无用赋值。

### 2.4 `lib/ffmpeg_presets.js`
- `ARG_ALIASES`：移除 `fs`, `filter`, `filters`, `fc`, `complex`, `filterComplex`。
- `applyFfargs`：移除针对 `filters` 与 `filterComplex` 的处理分支。
- 第 376 行未知 key 报错提示：修正文案，删除已废弃的 `Use --arg for advanced parameters.`。
- `createFromArgv`：移除 `argv.videoArgs`, `argv.audioArgs`, `argv.filters`, `argv.filterComplex` 相关逻辑。
- `FFmpegPreset.userArgs`：清理 `videoExtra`, `audioExtra` 字段。
- 清理构造函数中的 `extraArgs`。

### 2.5 `lib/preset_schema.js`
- 清理 `extraArgs`、`complexFilter` 等废弃字段定义。

### 2.6 `presets/default.yaml`
- 清理各预设块中冗余的空属性：`videoArgs: ""` 和 `complexFilter: ""`。

### 2.7 单元测试更新
- 更新 `test/test_ffmpeg_params_v2.js` 及相关测试用例，同步移除对已废除选项的断言，确保全量测试通过。

---

## 3. 验证方案

1. **语法与静态检查**:
   - `npm run check`
   - `npm run lint`
2. **自动化单元测试**:
   - `npm test`（确保全部单测 100% Pass）
3. **功能验证**:
   - 验证 `--preset hevc_2k`、`--dimension`、`--fps`、`--speed` 等核心压制功能正常组装命令。
   - 验证传入未知参数时 `.strictOptions()` 正确拦截。
