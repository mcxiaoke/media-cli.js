# FFmpeg CLI 参数处理体系设计方案

> **版本**: 2026-09-22  
> **依据**: 项目自有文档 `docs/ffmpeg/`（含官方文档镜像、编码器参数指南、滤镜指南、硬件加速指南等）+
> `temp/ffmpeg-docs/`（官方文档完整镜像）+ 项目现有代码 (`cmd/cmd_ffmpeg.js`, `lib/ffmpeg_build.js`,
> `lib/ffmpeg_presets.js`, `lib/hwaccel.js`, `lib/arg_parser.js`)  
> **目标**: 在不破坏 auto 降级逻辑、不新增独立抽象层的前提下，让 CLI 自定义参数**可靠、位置可控、与硬件分层兼容、且易用**。

---

## 1. FFmpeg 命令行参数分类与位置规则

FFmpeg 命令行参数按**位置**分为 5 大类，顺序不可随意调换（官方文档 ffmpeg-cmd.md §1 Synopsis）：

```
ffmpeg [global_options] {[input_file_options] -i input_url} ... {[output_file_options] output_url} ...
```

### 1.1 参数分类矩阵（对照官方文档核实）

| 分类                | 位置                             | 典型参数                                                                                           | 当前支持                           | 问题                                                                                                        |
| ------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **全局选项**        | 命令最前                         | `-y`, `-nostats`, `-benchmark`, `-hide_banner`, `-loglevel`, `-init_hw_device`                     | ❌ 无 CLI 入口                     | 用户无法覆盖日志级别或关闭 banner；无法初始化指定 GPU 设备                                                  |
| **输入选项**        | `-i` 之前                        | `-ss`, `-t`, `-to`, `-f`, `-r` (输入), `-hwaccel`, `-hwaccel_device`, `-itsoffset`, `-stream_loop` | ❌ 无 CLI 入口                     | 无法 seek/trim、无法调整音画同步                                                                            |
| **输出选项-流级**   | 输出文件前，作用于特定流         | `-c:v`, `-c:a`, `-c:s`, `-b:v`, `-crf`, `-preset`, `-tune`, `-g`, `-bf`, `-pix_fmt`, `-q`          | ⚠️ 部分受限                        | `--ffargs` 只支持白名单；`--video-args` 含 `-c:v` 时整段丢弃；`-pix_fmt` 未暴露；`-q` (alias `-q:a`) 未暴露 |
| **输出选项-容器级** | 输出文件前                       | `-movflags`, `-metadata`, `-tag:v`, `-disposition`, `-shortest`                                    | ⚠️ `outputArgs` preset 级          | 用户无法通过 CLI 追加或覆盖                                                                                 |
| **滤镜**            | `-vf`/`-af`/`-filter_complex` 后 | `scale`, `fps`, `yadif`, `subtitles`, `volume`, `atempo`                                           | ⚠️ `--filters` 替换 preset.filters | 丢失 `{scaleFilter}` 占位符导致缩放失效                                                                     |
| **音频专属**        | 输出文件前                       | `-ar`, `-ac`, `-vol`, `-af`, `-sample_fmt`, `-channel_layout`                                      | ⚠️ 部分支持                        | `--ffargs` 支持 `ab`/`aq`/`ac`，但无位置控制                                                                |
| **字幕专属**        | 输出文件前                       | `-c:s`, `-sn`, `-fix_sub_duration`, `-canvas_size`                                                 | ❌ 无 CLI 入口                     | 字幕流默认被丢弃或重编码                                                                                    |

**对照修正说明**（基于 `temp/ffmpeg-docs/ffmpeg-cmd.md` 核实）：

- **`-pix_fmt`**: 官方标注为 `(*input/output,per-stream*)`，同时是输入选项和输出选项。当前
  `buildEncoderArgs` 在输出侧已处理，但用户无法通过 CLI 覆盖输入侧像素格式。
- **`-q`**: 官方文档中 `-q q` 是 "Set the audio quality (codec-specific, VBR)"，alias for
  `-q:a`。当前无 CLI 入口。
- **`-init_hw_device`**: 全局选项，用于显式创建硬件设备（如
  `-init_hw_device cuda:1`），官方文档 §5.11 Advanced options。当前无 CLI 入口，但 `hwaccel.js` 的
  `buildHwaccelArgs` 内部已隐式处理。
- **`-ss` 位置语义**（官方 §5.4 Main options）：放在 `-i` 前 = 快速 seek（默认 `-accurate_seek`
  会额外解码并丢弃中间段达到精确）；放在输出文件前 = 精确到帧（解码并丢弃直到目标时间戳）。

### 1.2 关键位置规则（官方文档确认）

- **`-ss` 位置决定精度**：放在 `-i` 前 = 快速 seek（可能非精确帧，但默认 `-accurate_seek`
  会额外解码并丢弃中间段达到精确）；放在输出文件前 = 精确到帧（解码并丢弃直到目标时间戳）。两者可叠加：`-ss 10 -i in.mp4 -t 30 out.mp4`
  = 从 10 秒开始取 30 秒。
- **`-t`/`-to` 位置**：放在 `-i`
  前 = 限制输入读取时长；放在输出文件前 = 限制输出写入时长。两者可叠加使用，`-t` 优先于 `-to`。
- **`-hwaccel` 是输入侧选项**（官方 §5.11：`*input,per-stream*`）：必须放在 `-i` 之前。当前
  `buildHwaccelArgs` 已正确处理，将其放入 `inputArgs`。
- **`-c:v`/`-c:a`/`-c:s`
  是输出侧选项**（官方 §5.4：`*input/output,per-stream*`，输出时选编码器）：放在输出文件之前。当前
  `buildEncoderArgs` 将其放入 `middleArgs`。
- **`-metadata` 是输出侧选项**（官方 §5.4：`*output,per-metadata*`）：放在输出文件之前。当前
  `buildMetaArgs` 将其放入 `middleArgs`。
- **`-movflags` 是容器级选项**：放在输出文件之前。当前 `outputArgs` 中硬编码 `+faststart`。
- **`-q` (alias `-q:a`) 是输出侧音频选项**：放在输出文件之前。当前无 CLI 入口。

---

## 2. 当前 CLI 参数体系的问题诊断

### 2.1 `--ffargs` 机制：白名单过滤，非白名单静默丢弃

```javascript
// lib/ffmpeg_presets.js:266-329
function applyFfargs(argv, ffargs) {
    for (const [key, value] of Object.entries(ffargs)) {
        const normalizedKey = ARG_ALIASES[key] || key
        // 只有 ARG_ALIASES 中的键才被处理，其余丢弃
    }
}
```

**ARG_ALIASES 白名单**（仅 21 个键）：

```javascript
{
    vb: 'videoBitrate', vbit: 'videoBitrate', vbk: 'videoBitrate', vbitrate: 'videoBitrate',
    vq: 'videoQuality', vquality: 'videoQuality',
    vc: 'videoCodec', vcodec: 'videoCodec',
    ab: 'audioBitrate', abit: 'audioBitrate', abk: 'audioBitrate', abitrate: 'audioBitrate',
    aq: 'audioQuality', aquality: 'audioQuality',
    ac: 'audioCodec', acodec: 'audioCodec',
    px: 'prefix', pf: 'prefix',
    sx: 'suffix', sf: 'suffix',
    sp: 'speed',
    dm: 'dimension', fps: 'framerate'
}
```

**问题**：`--ffargs "tune=animation,g=60,ss=10"` 中 `tune`、`g`、`ss`
均不在白名单，**被静默丢弃，无任何警告**。

### 2.2 `--video-args` 机制：整体替换，含 `-c:v` 时整段丢弃

```javascript
// lib/ffmpeg_build.js:254-261
const presetVa = tempPreset.videoArgs || ""
if (presetVa && /-c:v/.test(presetVa)) {
    warnLegacyVideoArgsIgnored()
    return encArgs // 整段 videoArgs 被忽略
}
```

**问题**：

- 用户想追加 `-tune film`，需要 `--video-args "-tune film"`（无
  `-c:v`）→ 合法，会附加在编码器参数之后。
- 但 `--video-args "-c:v libx264 -tune film"` → 整段丢弃，**连 `-tune film` 也丢了**。
- 无法区分「替换编码器」和「追加调优参数」。

### 2.3 `--filters` 机制：替换 preset.filters，丢失 `{scaleFilter}`

```javascript
// lib/ffmpeg_presets.js:378-379
if (typeof argv.filters === "string") {
    preset.filters = argv.filters // 替换，非追加
}
```

**问题**：`--filters "yadif"` 会覆盖
`preset.filters = "{scaleFilter}"`，导致**缩放滤镜丢失**。正确做法应是追加（`yadif,{scaleFilter}`）或支持三段式。

### 2.4 参数无法按位置控制

当前所有用户自定义参数最终都落在 `middleArgs`（输出文件前），无法：

- 将 `-ss` 放在 `-i` 之前（快速 seek）
- 将 `-metadata` 与 `-movflags` 分开控制
- 将 `-hwaccel` 相关参数与编码器参数分开

### 2.5 无法按 tier 差异化

`--video-args "-preset slow"` 对所有 tier 生效：

- NVENC 的 `-preset` 取值是 `p1`~`p7`（与 x264 的 `ultrafast`~`placebo` 完全不同语义）
- 统一透传会导致 NVENC 报错 `Invalid preset` 或静默忽略

---

## 3. 设计方案：两层参数体系 + 参数验证

### 3.1 设计原则

1. **不破坏 auto 降级**：`selectTier`/`probeLayer` 探测逻辑完全不动。
2. **不新增抽象层**：不引入新的类/模块，只扩展 `userArgs` 和 `buildEncoderArgs` 签名。
3. **向后兼容**：现有 `--ffargs` 白名单继续有效；现有 `--video-args`/`--filters` 行为不变。
4. **位置可控**：新增 `--arg` 参数带位置标记，明确落在 input 前 / output 前 / 编码器块内。
5. **tier 差异化**：编码器调优参数支持按 tier 名称（`cuda`/`qsv`/`amf`/`cpu`）分别指定。
6. **参数验证**：所有用户自定义参数必须经过合法性验证，非法参数提前报错，不静默丢弃。
7. **不做重复工作**：视频/音频基本质量参数（vb/vq/ab/aq/fps/dm/speed）已有 `--ffargs`
   支持，无需新增专用选项。

### 3.2 现有参数能力盘点

| 参数                  | 现有支持方式                              | 说明                         |
| --------------------- | ----------------------------------------- | ---------------------------- |
| `vb` / `videoBitrate` | `--ffargs "vb=2000"` 或 `--video-bitrate` | ✅ 已有                      |
| `vq` / `videoQuality` | `--ffargs "vq=22"` 或 `--video-quality`   | ✅ 已有                      |
| `fps` / `framerate`   | `--ffargs "fps=30"` 或 `--framerate`      | ✅ 已有                      |
| `dm` / `dimension`    | `--ffargs "dm=1920"` 或 `--dimension`     | ✅ 已有                      |
| `sp` / `speed`        | `--ffargs "sp=1.5"` 或 `--speed`          | ✅ 已有                      |
| `ab` / `audioBitrate` | `--ffargs "ab=128"` 或 `--audio-bitrate`  | ✅ 已有                      |
| `aq` / `audioQuality` | `--ffargs "aq=2"` 或 `--audio-quality`    | ✅ 已有                      |
| `ac` / `audioCodec`   | `--ffargs "ac=opus"`                      | ✅ 已有                      |
| `metadata`            | ❌ 无                                     | **新增到 ffargs 白名单**     |
| `ss` / `start`        | ❌ 无                                     | **通过 `--arg @input` 支持** |
| `t` / `duration`      | ❌ 无                                     | **通过 `--arg @input` 支持** |
| `tune`                | ❌ 无（非白名单，静默丢弃）               | **通过 `--arg @video` 支持** |
| `preset`              | ❌ 无（与 preset 名称冲突）               | **通过 `--arg @video` 支持** |

### 3.3 两层参数体系

```
┌─────────────────────────────────────────────────────────────┐
│  第一层：--ffargs 白名单（基础质量参数，已支持）              │
│  --ffargs "vb=2000,vq=22,fps=30,dm=1920,sp=1.5"              │
│  --ffargs "ab=128,aq=2,ac=opus,metadata=title=My Video"      │
├─────────────────────────────────────────────────────────────┤
│  第二层：--arg 位置标记（高级/位置敏感参数）                  │
│  --arg "@input -ss 10 -t 30"                                 │
│  --arg "@output -metadata title=MyVideo -movflags +faststart"│
│  --arg "@video -tune film"                                    │
│  --arg "@video[cuda] -spatial_aq 1"                         │
└─────────────────────────────────────────────────────────────┘
```

#### 第一层：--ffargs 白名单（增强）

**新增 `metadata` 到白名单**：

```javascript
// ARG_ALIASES 扩展
{
    // ... 现有 21 个键 ...
    md: 'metadata', meta: 'metadata', metadata: 'metadata'
}
```

**用法**：

```bash
# 基础质量参数 + 元数据
mediac ffmpeg input \
  --ffargs "vb=4000,vq=22,fps=30,metadata=title=My Video" \
  --preset hevc_2k
```

**处理逻辑**：`metadata` 值包含 `=` 时，按 `key=value` 解析，映射为 `-metadata key=value` 放入
`outputArgs`。

#### 第二层：`--arg` 位置标记（核心新增）

引入**位置前缀**语法，与 FFmpeg 命令行结构对齐：

```bash
--arg "@input -ss 10 -t 30"
--arg "@output -metadata title=MyVideo -movflags +faststart"
--arg "@video -preset slow -tune film"
--arg "@audio -ar 48000 -ac 2"
--arg "@filter pre=yadif,post=unsharp"
--arg "@global -y -hide_banner"
```

| 位置标记  | 对应 FFmpeg 位置                 | 追加到的数组段                     | 说明                          |
| --------- | -------------------------------- | ---------------------------------- | ----------------------------- |
| `@input`  | `-i` 之前                        | `inputArgs`                        | seek、trim、hwaccel、格式强制 |
| `@output` | 输出文件之前                     | `outputArgs` 前（middleArgs 末尾） | 元数据、容器标志、流映射      |
| `@video`  | 输出文件之前（视频流）           | `middleArgs`（编码器参数块末尾）   | `-c:v` 之后的编码器专属参数   |
| `@audio`  | 输出文件之前（音频流）           | `middleArgs`（音频参数块末尾）     | `-c:a` 之后的音频专属参数     |
| `@filter` | `-vf`/`-af`/`-filter_complex` 内 | `middleArgs`（滤镜链中）           | 追加到 pre/post/scale 段      |
| `@global` | 命令最前                         | 最前                               | `-y`、`-nostats`、`-loglevel` |

#### 编码器参数 tier 差异化语法

在 `@video` 和 `@audio` 内支持 tier 限定：

```bash
--arg "@video -preset slow"                     # 所有 tier
--arg "@video[cuda] -spatial_aq 1"              # 仅 NVENC 层
--arg "@video[qsv] -look_ahead 1"               # 仅 QSV 层
--arg "@video[cpu] -preset slow -tune film"      # 仅 CPU 层
--arg "@video[amf] -quality quality"            # 仅 AMF 层
```

**实现方式**：`buildEncoderArgs` 在生成完默认参数后，按当前 tier 名称选择对应的用户参数追加：

```javascript
// buildEncoderArgs 末尾追加
if (userArgs.videoOptions) {
    const globalOpts = userArgs.videoOptions["*"] || []
    const tierOpts = userArgs.videoOptions[tierName] || []
    args.push(...globalOpts, ...tierOpts)
}
```

### 3.4 参数合法性验证机制

**问题**：当前 `--ffargs` 非白名单参数静默丢弃，`--video-args` 含 `-c:v` 时整段丢弃但无明确提示。

**设计方案**：

#### 验证时机

在 `createFromArgv`（`lib/ffmpeg_presets.js`）中统一验证：

```javascript
function validateArg(arg, context) {
    // 1. 检查位置标记合法性
    const validMarkers = ["@input", "@output", "@video", "@audio", "@filter", "@global"]
    if (arg.startsWith("@") && !validMarkers.some((m) => arg.startsWith(m))) {
        throw new Error(
            `Invalid position marker in --arg: ${arg}. Valid markers: ${validMarkers.join(", ")}`,
        )
    }

    // 2. 检查参数名是否在 ffmpeg 支持列表中（可选，运行时验证）
    // 3. 检查 tier 标记合法性
    // 4. 检查 value 格式（如 -ss 需要是时间格式）
}
```

#### 验证规则

| 验证项              | 规则                                                                      | 错误处理                     |
| ------------------- | ------------------------------------------------------------------------- | ---------------------------- |
| 位置标记            | 必须是 `@input`, `@output`, `@video`, `@audio`, `@filter`, `@global` 之一 | 抛错，列出合法标记           |
| tier 标记           | `@video[xxx]` 中 `xxx` 必须是 `cuda`, `qsv`, `amf`, `cpu` 之一            | 抛错，列出合法 tier          |
| ffmpeg 参数名       | 以 `-` 开头的参数必须在已知 ffmpeg 参数列表中（维护一个基础列表）         | warn，提示未知参数可能不生效 |
| 参数值格式          | `-ss`/`-t`/`-to` 需要是有效时间格式；`-r` 需要是正数                      | warn 或抛错                  |
| `--ffargs` 非白名单 | 不再静默丢弃，改为 warn 并提示改用 `--arg`                                | warn                         |

#### 已知 ffmpeg 参数列表（基础验证用）

维护一个 `lib/ffmpeg_args_known.js`，包含常见参数名：

```javascript
export const KNOWN_FFMPEG_ARGS = new Set([
    // 全局
    "-y",
    "-n",
    "-nostats",
    "-benchmark",
    "-hide_banner",
    "-loglevel",
    // 输入
    "-ss",
    "-t",
    "-to",
    "-f",
    "-r",
    "-ar",
    "-ac",
    "-hwaccel",
    "-hwaccel_device",
    "-itsoffset",
    "-stream_loop",
    "-init_hw_device",
    // 输出-流级
    "-c:v",
    "-c:a",
    "-c:s",
    "-b:v",
    "-b:a",
    "-crf",
    "-preset",
    "-tune",
    "-g",
    "-bf",
    "-pix_fmt",
    "-q",
    "-q:a",
    "-vcodec",
    "-acodec",
    // 输出-容器级
    "-movflags",
    "-metadata",
    "-tag:v",
    "-tag:a",
    "-disposition",
    "-shortest",
    // 滤镜
    "-vf",
    "-af",
    "-filter_complex",
    "-filter:v",
    "-filter:a",
    // 高级
    "-map",
    "-codec",
    "-scodec",
    "-vbsf",
    "-absf",
    // 硬件加速
    "-spatial_aq",
    "-temporal_aq",
    "-rc_lookahead",
    "-cbr",
    "-constqp",
    "-look_ahead",
    "-extbrc",
    "-quality",
    "-profile",
    "-level",
])
```

---

## 4. CLI 新增选项设计

### 4.1 `--arg` 选项（核心新增）

```javascript
.option("arg", {
    alias: "a",
    type: "array",
    describe: t("ffmpeg.arg"),
    default: [],
})
```

### 4.2 `--ffargs` 白名单扩展

```javascript
// ARG_ALIASES 增加
md: 'metadata', meta: 'metadata', metadata: 'metadata'
```

### 4.3 保留现有选项（向后兼容）

| 现有选项          | 行为                       | 说明                                                  |
| ----------------- | -------------------------- | ----------------------------------------------------- |
| `--ffargs`        | 白名单扩展 + 非白名单 warn | 新增 `metadata`；未知键 warn 提示改用 `--arg`         |
| `--video-args`    | 不变                       | 继续支持无 `-c:v` 的追加；含 `-c:v` 时继续丢弃并 warn |
| `--filters`       | 不变                       | 继续支持替换；warn 提示如果替换后丢失 `{scaleFilter}` |
| `--audio-args`    | 不变                       | 继续支持整体替换 audioArgs                            |
| `--video-bitrate` | 不变                       | 直接覆盖 preset.videoBitrate                          |
| `--video-quality` | 不变                       | 直接覆盖 preset.videoQuality                          |
| `--dimension`     | 不变                       | 直接覆盖 preset.dimension                             |
| `--speed`         | 不变                       | 直接覆盖 preset.speed                                 |
| `--framerate`     | 不变                       | 直接覆盖 preset.framerate                             |

---

## 5. 实施范围与代码变更点

### 5.1 变更文件清单

| 文件                       | 函数/位置                   | 变更内容                                                           |
| -------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `cmd/cmd_ffmpeg.js`        | yargs builder               | 新增 `--arg` 选项（type: array）                                   |
| `lib/ffmpeg_presets.js`    | `ARG_ALIASES`               | 新增 `metadata` 白名单映射                                         |
| `lib/ffmpeg_presets.js`    | `createFromArgv`            | 解析 `--arg` 数组，生成 `userArgs.argOptions`；增加参数合法性验证  |
| `lib/ffmpeg_build.js`      | `createFFmpegArgs`          | 在组装三段数组时，将 `@input`/`@output`/`@global` 参数插入对应位置 |
| `lib/ffmpeg_build.js`      | `buildVideoArgsFromPlan`    | 将 `@video` 参数传入 `buildEncoderArgs`                            |
| `lib/ffmpeg_build.js`      | `buildAudioArgs`            | 将 `@audio` 参数追加到音频参数块                                   |
| `lib/ffmpeg_build.js`      | `buildScaleFiltersFromPlan` | 将 `@filter` 参数合并到 pre/post 段                                |
| `lib/hwaccel.js`           | `buildEncoderArgs`          | 接收 `videoOptions` 参数，末尾追加 tier 匹配的参数                 |
| `lib/ffmpeg_args_known.js` | 新增文件                    | 维护已知 ffmpeg 参数列表，用于 `--arg` 参数名验证                  |

### 5.2 关键数据结构

```javascript
// userArgs.argOptions 结构（由 createFromArgv 生成）
userArgs.argOptions = {
    input: ["-ss", "10", "-t", "30"], // @input
    output: ["-metadata", "title=My Video"], // @output
    global: ["-y", "-hide_banner"], // @global
    video: {
        "*": ["-tune", "film"], // 所有 tier
        cuda: ["-spatial_aq", "1"], // NVENC 专属
        qsv: ["-look_ahead", "1"], // QSV 专属
        cpu: ["-preset", "slow"], // CPU 专属
        amf: ["-quality", "quality"], // AMF 专属
    },
    audio: ["-ar", "48000", "-ac", "2"], // @audio
    filter: {
        pre: ["yadif"], // @filter pre=...
        post: ["unsharp=3:3:1.0"], // @filter post=...
    },
}
```

### 5.3 参数组装顺序（最终命令）

```javascript
// createFFmpegArgs 组装逻辑（伪代码）
const finalArgs = []

// 1. 全局选项（最前）
finalArgs.push(...(argOptions.global || []))

// 2. 输入选项（-i 之前）
finalArgs.push(...inputArgs) // 来自 preset + hwaccel
finalArgs.push(...(argOptions.input || [])) // 用户 @input
finalArgs.push("-i", entry.path)

// 3. 中间参数（middleArgs，输出文件之前）
//    视频编码器参数（含 tier 默认调优 + 用户 @video）
//    音频编码器参数（含 preset audioArgs + 用户 @audio）
//    滤镜链（含 pre + scale + post + 用户 @filter）
//    流映射与元数据
finalArgs.push(...middleArgs)

// 4. 输出选项（middleArgs 末尾，输出文件之前）
finalArgs.push(...(argOptions.output || [])) // 用户 @output

// 5. 输出文件
finalArgs.push(outputPath)
```

---

## 6. 与 Auto 降级模式的兼容性

### 6.1 探测阶段不受影响

`selectTier` → `probeLayer` 阶段**完全不调用 `buildEncoderArgs`**，只验证解码能力。因此
`--arg "@video[cuda] -spatial_aq 1"` 不会影响探测逻辑。

### 6.2 降级后参数自动切换

| 场景                                                                    | 行为                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `--arg "@video[cuda] -spatial_aq 1"` + auto 模式 + GPU 探测成功         | NVENC 编码，追加 `-spatial_aq 1`                                      |
| `--arg "@video[cuda] -spatial_aq 1"` + auto 模式 + GPU 探测失败降级 CPU | CPU 编码，**不追加** `-spatial_aq 1`（NVENC 专属参数对 libx264 无效） |
| `--arg "@video -tune film"` + auto 模式 + 任意 tier                     | 所有 tier 追加 `-tune film`（QSV/AMF 可能静默忽略，但无害）           |
| `--arg "@video[cpu] -preset slow"` + auto 模式 + GPU 成功               | GPU 编码，**不追加** `-preset slow`（CPU 专属）                       |

### 6.3 显式 `--decode-mode gpu` 时的硬失败

`--decode-mode gpu` 时探测失败即抛错，不会进入降级。此时 `--arg "@video[cuda] ..."`
只在 GPU 层生效，若 GPU 不可用则整条命令失败——这与用户的显式意图一致。

---

## 7. 向后兼容性保证

| 现有用法                             | 新体系下行为                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `--ffargs "vb=2000,vq=22"`           | 不变，继续走白名单                                                                |
| `--ffargs "tune=animation"`          | **变化**：不再静默丢弃，改为 **warn** 并提示改用 `--arg "@video -tune animation"` |
| `--video-args "-tune film"`          | 不变，附加到 videoArgs（无 `-c:v` 时合法）                                        |
| `--filters "yadif"`                  | 不变，替换 preset.filters（warn 丢失 scaleFilter）                                |
| `--arg "@input -ss 10"`              | 新能力，不影响旧用法                                                              |
| `--arg "@video[cuda] -spatial_aq 1"` | 新能力，不影响旧用法                                                              |

---

## 8. 使用示例集

### 8.1 基础场景（--ffargs 白名单）

```bash
# 基础质量参数 + 元数据（metadata 新增到白名单）
mediac ffmpeg input \
  --ffargs "vb=4000,vq=22,fps=30,metadata=title=My Video" \
  --preset hevc_2k

# 音频参数（已有支持）
mediac ffmpeg input \
  --ffargs "ab=128,aq=2,ac=opus" \
  --preset hevc_2k
```

### 8.2 中级场景（--arg 位置标记）

```bash
# 输入侧 seek + 输出侧元数据 + 视频调优
mediac ffmpeg input \
  --arg "@input -ss 10 -t 30" \
  --arg "@output -metadata title='My Video' -movflags +faststart" \
  --arg "@video -tune film" \
  --preset hevc_2k

# 按 tier 差异化调优
mediac ffmpeg input \
  --arg "@video[cuda] -spatial_aq 1 -rc_lookahead 64" \
  --arg "@video[qsv] -look_ahead 1 -extbrc 1" \
  --arg "@video[cpu] -preset slow" \
  --preset hevc_2k

# 滤镜追加（不丢失 scaleFilter）
mediac ffmpeg input \
  --arg "@filter pre=yadif,post=unsharp=3:3:1.0" \
  --preset hevc_2k

# 音频强制参数
mediac ffmpeg input \
  --arg "@audio -ar 48000 -ac 2 -vol 256" \
  --preset hevc_2k
```

### 8.3 高级场景（组合使用）

```bash
# ffargs 基础参数 + arg 高级参数
mediac ffmpeg input \
  --ffargs "vb=4000,vq=22" \
  --arg "@input -ss 10 -t 30" \
  --arg "@video -tune film -g 60" \
  --arg "@output -metadata title='Vacation 2024'" \
  --preset hevc_2k

# 直播推流：低延迟 + CBR + 强制关键帧
mediac ffmpeg input \
  --ffargs "vb=6000,fps=30" \
  --arg "@video -bf 0 -tune zerolatency" \
  --arg "@output -g 50 -force_key_frames 'expr:gte(t,n_forced*2)'" \
  --preset streaming_1080p
```

---

## 9. 待决策事项

| #   | 事项                                                                           | 建议                                                                                   |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| 1   | `--arg` 参数值是否需要 shell 转义？                                            | 建议整体用引号包裹，内部参数用空格分隔（与 ffmpeg 命令行一致）                         |
| 2   | `@filter` 的 `pre`/`post` 语法与现有 `pre_filters`/`post_filters` 字段的关系？ | `@filter pre=...` 追加到现有 `pre_filters` 之后，`post=...` 追加到 `post_filters` 之后 |
| 3   | 是否支持 `@video[*]` 作为 `@video` 的显式等价写法？                            | 支持，`*` 表示所有 tier，与无标记等价                                                  |
| 4   | 未知位置标记（如 `@foo`）如何处理？                                            | 抛错并提示可用标记：`@input`, `@output`, `@video`, `@audio`, `@filter`, `@global`      |
| 5   | `--arg` 与 `--ffargs` 同时指定同一参数时优先级？                               | `--arg` 优先，因其位置明确；warn 提示冲突                                              |
| 6   | `KNOWN_FFMPEG_ARGS` 列表是否完整？                                             | 不需要完整，只需要覆盖常见参数；未知参数 warn 但不阻止执行（ffmpeg 会自行报错）        |
| 7   | `--ffargs` 非白名单参数是 warn 还是抛错？                                      | **warn**（不抛错），保持向后兼容；提示用户改用 `--arg`                                 |

---

## 10. 附录：FFmpeg 参数位置速查表（对照官方文档）

| 参数              | 正确位置                               | 错误位置示例        | 后果                                 |
| ----------------- | -------------------------------------- | ------------------- | ------------------------------------ |
| `-ss`             | `-i` 前（快）或输出前（准）            | `-i` 后且不在输出前 | 作为输入 seek 但精度不可控           |
| `-t`              | `-i` 前 或 输出前                      | 全局位置            | 限制时长失效                         |
| `-hwaccel`        | `-i` 前                                | 输出前              | 不生效或报错                         |
| `-c:v`            | 输出前                                 | `-i` 前             | 被当作输入解码器（通常不支持）       |
| `-preset`         | 输出前（编码器参数块内）               | 全局位置            | 被忽略                               |
| `-movflags`       | 输出前                                 | `-i` 前             | 不生效                               |
| `-metadata`       | 输出前                                 | `-i` 前             | 不生效                               |
| `-vf`             | 输出前                                 | `-i` 前             | 输入滤镜（罕见，通常不是意图）       |
| `-y`              | 全局                                   | 输出前              | 仍可生效，但位置不标准               |
| `-pix_fmt`        | 输入前（输入格式）或输出前（输出格式） | 全局位置            | 被忽略                               |
| `-q:a`            | 输出前                                 | `-i` 前             | 作为输入选项（仅对音频抓取设备有效） |
| `-init_hw_device` | 全局                                   | 输出前              | 被忽略                               |

---

## 11. 易用性设计总结

| 用户类型            | 推荐用法                                                                      | 学习成本                                          |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| **普通用户**（90%） | `--ffargs "vb=2000,vq=22,metadata=title=X"`                                   | 零成本，与现有用法一致                            |
| **进阶用户**（9%）  | `--arg "@video -tune film"`, `--arg "@filter pre=yadif"`                      | 需了解 `@位置` 标记，但无需记忆 ffmpeg 完整命令行 |
| **高级用户**（1%）  | `--arg "@video[cuda] -spatial_aq 1"` + `--arg "@output -movflags +faststart"` | 需了解 ffmpeg 参数和位置规则                      |

**核心价值**：

- 普通用户继续用 `--ffargs`，新增 `metadata` 支持，不需要学习新语法
- 进阶用户用 `--arg "@video -tune film"`，不需要写完整的 ffmpeg 命令行
- 高级用户用 `--arg` 的 tier 差异化语法，mediac 的 preset +
  auto 降级仍为他们处理了编码器选择、缩放计算、硬件探测等繁琐工作

---

_本文档为 `cmd/cmd_ffmpeg.js` CLI 参数体系的改进设计依据，实施时应与本项目现有
`lib/ffmpeg_build.js`、`lib/ffmpeg_presets.js`、`lib/hwaccel.js` 的 S-4 架构保持一致。_
