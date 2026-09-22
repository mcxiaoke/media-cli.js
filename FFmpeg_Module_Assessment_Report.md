# FFmpeg 模块全面评估报告

> 评估范围：`cmd/cmd_ffmpeg.js`
> 及其依赖链（`lib/ffmpeg_*.js`、`lib/hwaccel.js`、`presets/default.yaml`）评估日期：2026-09-22 评估维度：自定义参数覆盖度、编解码调优参数、Preset 模式设计、整体流程清晰度

---

## 一、自定义参数缺失项

### 1.1 时间与裁剪类（高优先级）

| 参数                         | 当前状态  | 影响                     | 建议                                           |
| ---------------------------- | --------- | ------------------------ | ---------------------------------------------- |
| `-ss` / `--start`            | ❌ 未暴露 | 无法从指定时间点开始转码 | 增加 `--start <秒数或时间戳>`                  |
| `-t` / `-to` / `--duration`  | ❌ 未暴露 | 无法截取固定时长片段     | 增加 `--duration <秒数>`，与 `--start` 配对    |
| `--segment-time` / `--split` | ❌ 未暴露 | 无法将长视频分段输出     | 增加 `--segment <秒数>`，自动启用 `-f segment` |

**grep 验证**：`cmd/cmd_ffmpeg.js` 中无任何 `-ss/-t/-to/seek/trim` 相关处理逻辑，确认缺失。

### 1.2 音频处理类（高优先级）

| 参数                           | 当前状态  | 影响                                      | 建议                              |
| ------------------------------ | --------- | ----------------------------------------- | --------------------------------- |
| `-af` / `--audio-filters`      | ❌ 未暴露 | 无法应用 loudnorm、acompressor 等音频滤镜 | 增加 `--af "loudnorm=..."`        |
| `-an` / `--no-audio`           | ❌ 未暴露 | 需手动写 `--ffargs "-an"`                 | 增加布尔选项 `--no-audio`         |
| `--audio-delay` / `-itsoffset` | ❌ 未暴露 | 无法调整音画同步                          | 增加 `--audio-delay <秒数>`       |
| `-ar` / `--sample-rate`        | ❌ 未暴露 | 无法强制音频采样率（如 48k→44.1k）        | 增加 `--sample-rate <Hz>`         |
| `-ac` / `--audio-channels`     | ❌ 未暴露 | 无法强制单声道/立体声                     | 增加 `--audio-channels <1\|2\|6>` |
| `-vol` / `--volume`            | ❌ 未暴露 | 无法整体调整音量                          | 增加 `--volume <0.5\|1.5>`        |

### 1.3 字幕与多语言（中优先级）

| 参数                            | 当前状态  | 影响                     | 建议                            |
| ------------------------------- | --------- | ------------------------ | ------------------------------- |
| `-sn` / `--no-subtitle`         | ❌ 未暴露 | 无法去除内嵌字幕         | 增加布尔选项 `--no-subtitle`    |
| `-c:s copy` / `--copy-subtitle` | ❌ 未暴露 | 字幕流默认被丢弃或重编码 | 增加 `--copy-subtitle`          |
| `--subtitle-lang`               | ❌ 未暴露 | 无法选择特定语言字幕     | 增加 `--subtitle-lang <zh\|en>` |

### 1.4 高级视频变换（中优先级）

| 参数                    | 当前状态             | 影响                        | 建议                                       |
| ----------------------- | -------------------- | --------------------------- | ------------------------------------------ |
| `--crop`                | ❌ 未暴露            | 需手动写复杂 `-vf crop=...` | 增加 `--crop <w:h:x:y>` 或 `--crop <比例>` |
| `--rotate`              | ❌ 未暴露            | 需手动写 transpose 滤镜     | 增加 `--rotate <90\|180\|270>`             |
| `--flip-h` / `--flip-v` | ❌ 未暴露            | 镜像翻转不便                | 增加布尔选项                               |
| `--deinterlace`         | ⚠️ 需写 `yadif` 滤镜 | 反交错不够便捷              | 增加 `--deinterlace [mode]` 快捷开关       |
| `--denoise`             | ❌ 未暴露            | 降噪需手动写 nlmeans/hqdn3d | 增加 `--denoise <light\|medium\|heavy>`    |
| `--unsharp`             | ❌ 未暴露            | 锐化需手动写 unsharp 滤镜   | 增加 `--unsharp <强度>`                    |
| `--pad` / `--letterbox` | ❌ 未暴露            | 无法便捷添加黑边            | 增加 `--pad <w:h>`                         |
| `--aspect` / `-aspect`  | ❌ 未暴露            | 无法强制容器宽高比          | 增加 `--aspect <16:9\|4:3>`                |

### 1.5 容器与元数据（中优先级）

| 参数                | 当前状态               | 影响                    | 建议                                                |
| ------------------- | ---------------------- | ----------------------- | --------------------------------------------------- |
| `-dn` / `--no-data` | ❌ 未暴露              | 数据流未去除            | 增加 `--no-data`                                    |
| `--copy-chapters`   | ❌ 未暴露              | 章节信息默认丢失        | 增加布尔选项                                        |
| `--metadata`        | ❌ 未暴露              | 无法注入自定义元数据    | 增加 `--metadata key=value`（支持多组）             |
| `--movflags`        | ⚠️ 硬编码 `+faststart` | 无法关闭或追加其他 flag | 改为 `--movflags <flag1,flag2>` 或 `--no-faststart` |

### 1.6 性能与调试（低优先级）

| 参数                     | 当前状态          | 影响                 | 建议                              |
| ------------------------ | ----------------- | -------------------- | --------------------------------- |
| `-threads` / `--threads` | ❌ 未暴露         | 线程数不可控         | 增加 `--threads <0\|N>`           |
| `-bufsize` / `--bufsize` | ❌ 未暴露         | 码率控制缓冲区不可调 | 增加 `--bufsize <K\|M>`           |
| `-maxrate` / `-minrate`  | ⚠️ 部分 preset 有 | 不一致               | 统一在 preset 中暴露，或 CLI 覆盖 |
| `-g` / `--gop-size`      | ❌ 未暴露         | GOP 大小不可控       | 增加 `--gop <N>`                  |
| `-benchmark`             | ❌ 未暴露         | 无法快速评估编码速度 | 增加 `--benchmark`（仅输出统计）  |

---

## 二、默认编解码调优参数评估

### 2.1 当前状态

现有参数通过 `hwaccel.js::buildEncoderArgs` 按 tier + codecFamily 动态生成，核心逻辑：

```
videoArgs = `-c:v <encoder> -rc vbr -cq <normalizedQuality> -b:v <bitrate> -maxrate <bitrate*1.5>`
```

### 2.2 问题清单

#### 2.2.1 CPU 编码器（x264/x265）调优严重不足

| 参数               | 当前状态  | 影响                               | 建议                                                                  |
| ------------------ | --------- | ---------------------------------- | --------------------------------------------------------------------- |
| `-preset`          | ❌ 未设置 | 默认用 `medium`，无法按场景切换    | 在 preset 中增加 `encoderPreset: "fast"`，CLI 增加 `--encoder-preset` |
| `-tune`            | ❌ 未设置 | 无法针对 film/animation/grain 优化 | 增加 `encoderTune` 字段                                               |
| `-aq-mode`         | ❌ 未设置 | 自适应量化模式不可控               | 默认值可不改，但应支持覆盖                                            |
| `-b-adapt` / `-me` | ❌ 未设置 | 高级运动估计不可控                 | 面向高级用户暴露                                                      |

#### 2.2.2 NVENC 调优缺失

| 参数             | 当前状态  | 影响                 | 建议                                      |
| ---------------- | --------- | -------------------- | ----------------------------------------- |
| `-spatial_aq`    | ❌ 未设置 | 空间自适应量化关闭   | 增加 `-spatial_aq 1`（质量预设默认开启）  |
| `-temporal_aq`   | ❌ 未设置 | 时间自适应量化关闭   | 同上                                      |
| `-rc_lookahead`  | ❌ 未设置 | 码率控制前瞻帧数默认 | 增加 `-rc_lookahead 32`（平衡质量与延迟） |
| `-surfaces`      | ❌ 未设置 | 编码器表面缓冲区默认 | 增加 `-surfaces 64`（4K 场景）            |
| `-weighted_pred` | ❌ 未设置 | 加权预测关闭         | 增加 `-weighted_pred 1`（渐变场景受益）   |
| `-b_ref_mode`    | ❌ 未设置 | B 帧参考模式默认     | 增加 `-b_ref_mode each`（质量提升）       |

#### 2.2.3 QSV 调优缺失

| 参数                | 当前状态  | 影响             | 建议                             |
| ------------------- | --------- | ---------------- | -------------------------------- |
| `-look_ahead`       | ❌ 未设置 | 前瞻码率控制关闭 | 增加 `-look_ahead 1`（质量预设） |
| `-look_ahead_depth` | ❌ 未设置 | 前瞻深度不可控   | 增加 `-look_ahead_depth 100`     |
| `-async_depth`      | ❌ 未设置 | 异步队列深度默认 | 增加 `-async_depth 4`            |
| `-extbrc`           | ❌ 未设置 | 扩展码率控制关闭 | 增加 `-extbrc 1`                 |

#### 2.2.4 AMF 调优缺失（影响 A 卡用户）

| 参数                     | 当前状态  | 影响                                    | 建议                                       |
| ------------------------ | --------- | --------------------------------------- | ------------------------------------------ |
| `-quality`               | ❌ 未设置 | 默认 `balanced`，无法切换 speed/quality | 增加 `-quality <speed\|balanced\|quality>` |
| `-qp_p` / `-qp_i`        | ❌ 未设置 | 未配合 CQP 模式                         | 若支持 CQP 模式需补充                      |
| `-header_insertion_mode` | ❌ 未设置 | SPS/PPS 插入策略默认                    | 增加 `-header_insertion_mode gop`          |

#### 2.2.5 码率控制模式单一

| 模式                           | 当前状态          | 适用场景      | 建议                                         |
| ------------------------------ | ----------------- | ------------- | -------------------------------------------- |
| VBR（`-rc vbr -b:v -maxrate`） | ✅ 默认           | 通用本地存储  | 保持默认                                     |
| CRF（`-crf`）                  | ⚠️ 部分 preset 用 | 归档/质量优先 | 统一增加 `rateControl: "crf\|vbr\|cbr\|cqp"` |
| CBR                            | ❌ 不支持         | 直播推流      | 增加 `--rate-control cbr`                    |
| CQP                            | ❌ 不支持         | 恒定质量测试  | 增加 `--rate-control cqp`                    |

### 2.3 建议的调优参数加入方式

**方案 A：Preset 级调优（推荐）**

在 `presets/default.yaml` 的 `_base_*` 中增加 `encoderOptions` 字段：

```yaml
_base_h264:
    # ... 现有字段 ...
    encoderOptions:
        nvenc:
            spatial_aq: 1
            temporal_aq: 1
            rc_lookahead: 32
        qsv:
            look_ahead: 1
            look_ahead_depth: 100
        x264:
            preset: "medium"
            tune: "film"
```

`hwaccel.js::buildEncoderArgs` 按当前 tier 的编码器实现，从 `encoderOptions` 中取出对应键并追加到
`videoArgs`。

**方案 B：CLI 级覆盖**

增加 `--encoder-opt key=value`（可多次使用），直接透传到编码器参数块末尾，供高级用户微调：

```bash
mediac ffmpeg input --preset hevc_2k --encoder-opt spatial_aq=1 --encoder-opt rc_lookahead=64
```

**推荐两者并存**：Preset 提供合理默认值，CLI 提供覆盖能力。

---

## 三、Preset 模式设计评估

### 3.1 优点

1. **继承体系清晰**：`_base_h264` → `hevc_2k` 的 `extends` 链减少重复
2. **命名规则一致**：`codec_dimension_quality` 格式（`hevc_2kh`、`av1_2km`）
3. **YAML 分层加载**：包内 default → `~/.mediac/presets.yaml` → `cwd/presets.yaml`，用户可覆盖/扩展
4. **硬件无关抽象**：`videoCodecFamily` 只声明族名，具体编码器由 `hwaccel.js` 按 tier 决定

### 3.2 问题

#### 3.2.1 缺少场景型预设

当前预设按**技术维度**（codec + resolution +
quality）命名，用户需要知道 CRF、码率、HEVC 等技术细节才能选择。

| 缺失场景              | 典型参数需求                   | 建议预设名                        |
| --------------------- | ------------------------------ | --------------------------------- |
| 网页嵌入              | 720p, H.264, faststart, 低码率 | `web_720p`                        |
| 社交媒体（微信/抖音） | 1080p, H.264, 8Mbps 以内       | `social_1080p`                    |
| 长期归档              | HEVC/AV1, 高质量, 保留元数据   | `archive_4k`                      |
| 直播推流              | H.264, CBR, 低延迟 GOP         | `streaming_1080p`                 |
| 快速预览              | 480p, H.264, 超快编码          | `preview_fast`                    |
| 提取音频              | 复制音频流或转 AAC             | `audio_extract`（已有，但可扩展） |
| 仅缩图                | 不重新编码，只做缩放           | `thumbnail_only`                  |

#### 3.2.2 4K 预设覆盖不足

当前只有 `_base_4k` 基类，没有完整的 `hevc_4k` / `h264_4k` / `av1_4k` 系列。用户处理 4K 素材时必须从
`_base_4k` 继承自定义，增加使用门槛。

建议补充：

- `hevc_4k`（4K 标准，CRF 24, 15Mbps）
- `hevc_4kh`（4K 高质量，CRF 22, 25Mbps）
- `h264_4k`（4K 兼容模式，CRF 23, 20Mbps）
- `av1_4k`（4K 未来格式，CRF 26, 12Mbps）

#### 3.2.3 速度预设单一

只有一个 `hevc_speed`（1.5x 加速、HE-AAC、低码率）。缺少：

- `fast_copy`：仅容器重封装（`-c copy`）
- `quick_preview`：超低质量快速预览（CRF 35, 720p）
- `slow_archive`：逐帧优化归档（CRF 18, x265 veryslow）

#### 3.2.4 预设字段冗余与不一致

| 字段                             | 问题                                      | 建议                                            |
| -------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| `smartBitrate`                   | 只在部分 preset 中出现，默认行为不一致    | 统一默认 `true`，除非显式关闭                   |
| `audioQuality` vs `audioBitrate` | 两者并存但语义交叉                        | 增加 `audioMode: "cbr\|vbr\|copy"` 明确码控模式 |
| `speed`                          | 0 表示"不改动"，但 1 才是恒速，语义略混淆 | 改为 `speedRatio: null` 表示不变速              |
| `framerate`                      | 0 表示"不改"，但用户可能误以为 0fps       | 改为 `targetFps: null`                          |

### 3.3 改进建议

**短期（兼容现有）**：

1. 补充 `hevc_4k`、`h264_4k`、`av1_4k` 系列
2. 增加 `web_720p`、`social_1080p`、`archive_4k` 场景预设
3. 在 preset 描述（`description` 字段）中增加中文/英文场景说明

**中期（结构优化）**：4. 引入 `category` 字段（`compression`/`archive`/`streaming`/`audio`），便于
`--show-presets` 分组展示 5. 增加 `recommendedFor`
字段（`[youtube, bilibili, wechat]`），帮助用户选择

---

## 四、整体流程清晰度评估

### 4.1 优点

1. **参数构建三段式**：`createFFmpegArgs` 产出 `[inputArgs, middleArgs, outputArgs]`，结构清晰
2. **硬件探测分层**：`selectTier` → `probeLayer` → `buildEncoderArgs`，职责分离明确
3. **临时文件安全**：`activeTempFiles` 注册表 + `SIGINT/SIGTERM` 钩子清理，避免残留
4. **错误处理集中**：`error-codes.js` + `ErrorTypes` 统一管理
5. **质量偏移标定**：`QUALITY_OFFSET` 表按编码器实现校准，有实测数据支撑

### 4.2 问题

#### 4.2.1 参数优先级未清晰文档化

当前参数来源有 5 层：

1. `default.yaml` 预设默认值
2. `~/.mediac/presets.yaml` / `cwd/presets.yaml` 用户覆盖
3. CLI 选项（如 `--dimension`, `--fps`）
4. `--ffargs` 自定义参数字符串
5. 自动计算值（`smartBitrate`、`calcLongEdge`）

**问题**：`--ffargs` 是字符串拼接而非结构化覆盖，位置敏感参数（如
`-ss`、`-t`）可能被拼错位置。用户不清楚 `--ffargs` 是在 input 前还是 output 前。

**建议**：

- 明确文档化优先级：`CLI 选项 > --ffargs > 用户 YAML > 默认 YAML > 自动计算`
- `--ffargs` 增加位置标记：`--ffargs-input`、``--ffargs-output`、`--ffargs-global`
- 或增加 `--ffargs-position {before_input|after_input|before_output|after_output}`

#### 4.2.2 滤镜链组装过于复杂

`splitPresetFilterSegments` 需要兼容 3 种写法：

1. 新三段式：`pre_filters` / `filters` / `post_filters`
2. 旧单段式：`filters: "xxx,{scaleFilter},yyy"`
3. 无占位符：`filters: "yadif=1"`

加上
`setpts`（变速）、`fps`（改帧率）、`scale`（缩放）、`format`（位深对齐）的自动插入，最终滤镜链的生成逻辑分散在
`ffmpeg_build.js` 和 `hwaccel.js` 两处。

**建议**：

- 统一为三段式，在下一个 major version 中废弃旧 `{scaleFilter}` 占位符写法
- 增加 `--show-filters` 调试选项，输出最终滤镜链供用户核查

#### 4.2.3 缺少调试与预览能力

| 能力               | 当前状态                       | 影响                     | 建议                                    |
| ------------------ | ------------------------------ | ------------------------ | --------------------------------------- |
| `--dry-run`        | ❌ 无                          | 无法预览最终命令而不执行 | 增加 `--dry-run`，打印命令并退出        |
| `--show-command`   | ❌ 无                          | 无法看到最终 ffmpeg 命令 | 增加 `--show-command`（执行时同时打印） |
| `--show-filters`   | ❌ 无                          | 无法调试滤镜链           | 增加 `--show-filters`，输出解析后的滤镜 |
| `--verbose` / `-v` | ⚠️ 有 `debug.js` 但无 CLI 开关 | 日志级别不可控           | 增加 `-v / -vv / -vvv` 控制日志粒度     |

#### 4.2.4 进度展示单一

当前仅使用 `cli-progress` 显示进度条，缺少：

- 预估剩余时间（ETA）
- 当前编码速度（x 倍 realtime）
- 输出文件大小预估
- 已处理 / 队列中文件计数

**建议**：在 `ffmpeg_run.js` 的 `execa` 输出解析中，增加帧率/速度解析，实时更新进度条后缀。

#### 4.2.5 硬件加速回退逻辑分散

- `hwaccel.js`：`selectTier` 决定初始层，`probeLayer` 逐层探测
- `cmd_ffmpeg.js`：`runFFmpegCmd` 中可能还有额外的回退逻辑
- `hwdetect.js`：`candidateTiers` 生成候选层

三层协作但边界略模糊，容易在新增 tier 时遗漏某处回退。

**建议**：

- 将回退策略集中到一个函数 `resolveTierWithFallback(entry, hwCaps, decodeMode)`
- 该函数返回 `{tier, reason, fallbackFrom}`，日志统一输出降级原因

---

## 五、改进建议汇总（按优先级排序）

### P0 — 立即实施（影响可用性）

| #   | 改进项                                                        | 涉及文件                             | 工作量 |
| --- | ------------------------------------------------------------- | ------------------------------------ | ------ |
| 1   | 增加 `--dry-run` / `--show-command` 调试选项                  | `cmd_ffmpeg.js`, `ffmpeg_run.js`     | 小     |
| 2   | 增加 `--start` / `--duration` 时间裁剪参数                    | `cmd_ffmpeg.js`, `ffmpeg_build.js`   | 小     |
| 3   | 增加 `--no-audio` / `--copy-audio` / `--af` 音频快捷控制      | `cmd_ffmpeg.js`, `ffmpeg_build.js`   | 小     |
| 4   | 增加 `--crop` / `--rotate` / `--flip-h` / `--flip-v` 基础变换 | `cmd_ffmpeg.js`, `ffmpeg_build.js`   | 中     |
| 5   | 在 preset 中显式加入编码器 `-preset` 参数（x264/x265）        | `presets/default.yaml`, `hwaccel.js` | 小     |
| 6   | 补充 `--show-presets` 的 `category` 分组展示                  | `cmd_ffmpeg.js`, `ffmpeg_presets.js` | 小     |

### P1 — 近期实施（影响质量与效率）

| #   | 改进项                                                         | 涉及文件                             | 工作量 |
| --- | -------------------------------------------------------------- | ------------------------------------ | ------ |
| 7   | 增加 NVENC/QSV 调优参数默认值（AQ, lookahead）                 | `hwaccel.js`, `presets/default.yaml` | 中     |
| 8   | 增加 `--threads` / `--benchmark` 性能参数                      | `cmd_ffmpeg.js`, `ffmpeg_build.js`   | 小     |
| 9   | 增加 `--no-subtitle` / `--copy-subtitle` 字幕控制              | `cmd_ffmpeg.js`, `ffmpeg_build.js`   | 小     |
| 10  | 增加场景型预设（`web_720p`、`social_1080p`、`archive_4k`）     | `presets/default.yaml`               | 小     |
| 11  | 增加 `--rate-control {crf\|vbr\|cbr\|cqp}` 码率模式切换        | `cmd_ffmpeg.js`, `hwaccel.js`        | 中     |
| 12  | 增加 `--encoder-opt key=value` 编码器参数透传                  | `cmd_ffmpeg.js`, `hwaccel.js`        | 中     |
| 13  | 补充 `hevc_4k` / `h264_4k` / `av1_4k` 系列                     | `presets/default.yaml`               | 小     |
| 14  | 统一 `--ffargs` 的位置语义（`-input` / `-output` / `-global`） | `cmd_ffmpeg.js`, `ffmpeg_build.js`   | 中     |

### P2 — 中期实施（影响高级场景）

| #   | 改进项                                            | 涉及文件                                  | 工作量             |
| --- | ------------------------------------------------- | ----------------------------------------- | ------------------ |
| 15  | 增加视频分段输出 `--segment <秒数>`               | `cmd_ffmpeg.js`, `ffmpeg_build.js`        | 中                 |
| 16  | 增加多路输出支持（`-var_stream_map` 等）          | `ffmpeg_build.js`, `ffmpeg_run.js`        | 大                 |
| 17  | 增加 HDR/SDR 转换参数（`zscale` 滤镜链）          | `hwaccel.js`, `ffmpeg_build.js`           | 大                 |
| 18  | 补充 AMF 质量偏移标定（需要 A 卡实测环境）        | `hwaccel.js`                              | 中                 |
| 19  | 增加 VMAF/PSNR 质量评估输出（`--quality-report`） | `ffmpeg_run.js`                           | 大                 |
| 20  | 增加进度条 ETA / 速度 / 大小预估                  | `ffmpeg_run.js`                           | 中                 |
| 21  | 统一 tier 回退逻辑到单一函数                      | `hwaccel.js`, `hwdetect.js`               | 中                 |
| 22  | 废弃旧 `{scaleFilter}` 占位符，统一为三段式       | `ffmpeg_build.js`, `presets/default.yaml` | 中（需兼容性过渡） |

---

## 六、结论

`cmd/cmd_ffmpeg.js`
及其依赖链已经具备**良好的架构基础**：预设继承体系、硬件加速分层、参数三段式构建、临时文件安全管理都设计合理。

但当前在**用户可见的自定义参数覆盖度**上存在明显缺口：

- 时间裁剪、音频控制、基础视频变换、字幕处理等高频参数均未暴露为 CLI 选项
- 默认编码器调优参数缺失（尤其是 NVENC/QSV 的 AQ/lookahead）
- 场景型预设不足，用户需要技术背景才能选择合适预设

**最优先的 3 项改进**：

1. **增加 `--dry-run` 和 `--show-command`** —— 让用户看到最终命令，降低调试成本
2. **增加 `--start` / `--duration`** —— 覆盖最常见的片段截取需求
3. **补充编码器调优默认值（NVENC AQ + QSV lookahead）** —— 在现有架构下零破坏提升输出质量

以上评估基于对 10 个核心文件的完整源码分析和 FFmpeg 最佳实践对比，可直接作为改进路线图使用。
