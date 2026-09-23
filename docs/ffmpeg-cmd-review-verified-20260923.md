# FFmpeg 命令与子系统代码审查与验证报告 (2026-09-23)

## 概述

针对 `cmd/cmd_ffmpeg.js` 及其支撑模块（`lib/ffmpeg_plan.js`、`lib/ffmpeg_build.js`、`lib/ffmpeg_run.js`、`lib/ffmpeg_presets.js`、`lib/hwaccel.js`、`lib/hwdetect.js`、`presets/default.yaml`）进行了全面的代码逻辑审查与真机运行验证。

该子系统的整体架构设计优秀，具备分层 YAML 预设单源化、硬件分层探测（设备检测 + 探测干跑）及探测与真实命令严格同构的严谨设计。但在具体参数流转、分支逻辑和条件组合上，发现了 **5 个确凿的逻辑缺陷/Bug** 以及 **若干参数组合不合理之处**。

---

## 经实测验证的问题清单

### 1. [严重] CQ/CRF 恒定质量模式被全面架空（退化为 VBR 码率模式）
- **影响代码**：`lib/ffmpeg_plan.js` 第 357 行、`lib/hwaccel.js` 第 867 行
- **根因分析**：
  在 `calculateDstArgs` 中：
  ```javascript
  dstVideoBitrate = minNoZero(scaleBitrateByResolution(reqVideoBitrate), srcVideoBitrate)
  ```
  内置 YAML 绝大部分预设（如 `hevc_2k`, `hevc_4k`, `h264_2k`, `av1_2k`）均为恒定质量（CQ）模式，未声明 `videoBitrate`（`reqVideoBitrate = 0`）。
  `scaleBitrateByResolution(0)` 为 0，而 `minNoZero(0, srcVideoBitrate)` 会把 0 过滤掉，**直接返回了 `srcVideoBitrate`（源视频原始码率）**！
  在 `buildEncoderArgs` 中：
  ```javascript
  const b = bitrate || 0
  const usingVbr = b > 0  // 此时 b 为源视频码率 > 0，恒为 true！
  ```
  导致编码器全部走入 VBR 码率控制分支，生成 `-b:v ... -maxrate ...`，而预设或用户指定的 `-cq` / `-crf` 质量参数被完全丢弃。
- **验证结果**：
  实测以 `hevc_2k`（`videoQuality: 24`）转换一段 9Mbps 视频，生成的命令为 `-b:v 9000K -maxrate 13500K`，`-cq 24` 彻底丢失。
- **修复方案**：
  仅当 `reqVideoBitrate > 0` 时才计算 `dstVideoBitrate`，未设置码率时保持为 0：
  ```javascript
  dstVideoBitrate = reqVideoBitrate > 0
      ? minNoZero(scaleBitrateByResolution(reqVideoBitrate), srcVideoBitrate)
      : 0
  ```

---

### 2. [严重] 音频元数据 tags 产生嵌套数组导致命令行崩溃
- **影响代码**：`lib/ffmpeg_build.js` 第 685-687 行
- **根因分析**：
  ```javascript
  metaArgs.push(
      ...Object.entries(validTags).map(([key, value]) => [`-metadata`, `${key}=${value}`]),
  )
  ```
  `map` 返回的是二维数组 `[['-metadata', 'title=...'], ...]`，使用 `push(...)` 导致 `middleArgs` 中混入子数组。传递给 `execa` 时，Node.js 对数组参数做 `String()` 转换，合并成了单个参数 `"-metadata,title=xxx"`，导致 FFmpeg 报参数未知错误。
- **验证结果**：
  实测转码包含 title 与 artist 标签的 flac 音频，`flattenFFArgs` 输出了 `-metadata,title=...`，参数被损坏。
- **修复方案**：
  平铺推入一维参数：
  ```javascript
  for (const [key, value] of Object.entries(validTags)) {
      metaArgs.push("-metadata", `${key}=${value}`)
  }
  ```

---

### 3. [严重] 纯音频任务（`audio_extract`）执行了不必要的视频硬件加速探测
- **影响代码**：`lib/ffmpeg_run.js` 第 560-564 行、`lib/ffmpeg_build.js` 第 328-329 行
- **根因分析**：
  `resolveHwPlan` 仅检查了 `isAudioFile(entry.path)`。当使用 `audio_extract` 从 `.mp4`/`.mkv` 等视频中提取音频时，源文件是视频，导致其去探测 GPU 视频硬件编码（`h264_nvenc`/`qsv`/`d3d` 等），白白增加 10 帧干跑的性能开销，且若源文件视频流有损可能误伤音频提取。
  同时在 `createFFmpegArgs` 中，纯音频预设也被无条件注入了 `buildVideoArgs`（输出 `-c:v libx264 -crf 24`）。
- **修复方案**：
  当预设类型为 `audio` 时，直接分配 CPU 层占位，不探测视频硬件层；同时在 `createFFmpegArgs` 中仅对 `video` 预设生成视频滤镜和视频编码参数。

---

### 4. [严重] `--delete-source-files` 遗漏转码成功后的删除逻辑
- **影响代码**：`cmd/cmd_ffmpeg.js` 第 631-693 行与第 762-847 行
- **根因分析**：
  命令行帮助承诺“*如果目标文件已存在或转换成功，删除源文件*”。
  但代码只在 `planFFmpegTasks` 里处理了目标已存在的跳过任务（`dstExitsTasks`），而在 `runFFmpegTasks` 实际转码成功（`r.ok === true`）后，完全没有执行删除源文件的代码。
- **修复方案**：
  在 `runFFmpegTasks` 的 `pMap` 完成后，检查 `argv.deleteSourceFiles`，对 `r.ok === true` 且产物大小正常的文件执行 `helper.safeRemove`。

---

### 5. [严重] `--video-codec copy` / `vc=copy` 导致 `-vf` 滤镜与流复制冲突
- **影响代码**：`lib/ffmpeg_presets.js` 第 462 行、`lib/ffmpeg_build.js` 第 228 行
- **根因分析**：
  仅 `--video-copy` 会清空 `preset.filters = ""`，而通过 `--video-codec copy` 或 `--ffargs "vc=copy"` 传入时，`videoCodec` 为 copy 但 filters 保留了预设的缩放滤镜，导致命令行中同时存在 `-vf scale=...` 和 `-c:v copy`，FFmpeg 报错拒绝。
- **修复方案**：
  在 `createFromArgv` 中当 `argv.videoCodec === "copy"` 时同步设置 `videoCopy = true` 并清空 filters。

---

### 6. [参数与逻辑优化]
1. **音频码率模板 `{audioBitrate}` 未同步动态计算结果**：`calculateDstArgs` 把 `audioBitrate: dstAudioBitrate` 注释掉了，导致模板仍取预设初始码率。解除注释并支持 `{audioBitrate}` 和 `{audioBitrateK}`。
2. **`applyFfargs` 无法设置布尔选项**：`raw === false` 被误当成已提供值而拦截，需允许 `false` 被覆盖。
3. **`test_default_presets.js` 单测报错**：单测要求包含 `aac_he`，而 YAML 中命为 `aac_lowest`，在 `default.yaml` 补充 `aac_he` 预设。
4. **`fileDstSameDir` 在指定 `-o` 时误判跳过**：用户明确指定了新输出目录时，不应受源目录历史残留同名文件影响。
5. **分辨率缩放偶数对齐统一**：统一使用 `calcLongEdge`，确保宽高始终对齐到偶数，避免奇数分辨率引发编码器失败。
