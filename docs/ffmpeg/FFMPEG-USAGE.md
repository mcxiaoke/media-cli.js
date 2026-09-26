## mediac ffmpeg 使用文档与注意事项

> 适用版本：v2.0.0（S-4 硬件分层重构、ffmpeg 参数定稿之后）。
> 命令：`mediac ffmpeg <input> [options]`，别名 `transcode` / `aconv` / `vconv` / `avconv`。
> 描述：使用 ffmpeg 转换音频或视频文件。
>
> 本文反映**当前代码实际行为**，与旧版（硬编码预设、`--arg` 位置标记、`--video-args` 整体替换）有重要差异，迁移时请先读「注意事项」一节。

---

### 1. 子系统构成

`ffmpeg` 子命令不是单文件，而是一套协作模块。排查问题时按职责定位文件：

| 文件 | 职责 |
| ---- | ---- |
| `cmd/cmd_ffmpeg.js` | 命令入口：解析参数、校验、扫描文件、任务编排、确认、执行汇总 |
| `src/transcode/index.js` | CLI/Electron 使用的转码领域 facade；外部调用方不直接导入内部模块 |
| `presets/default.yaml` | **内置预设的唯一事实源**（随 npm 包发布） |
| `src/transcode/preset_loader.js` | YAML 分层加载、`extends` 继承、`_override` 覆盖规则、字段校验 |
| `src/transcode/ffmpeg_presets.js` | 预设对象模型、`--ffargs` 别名映射、`createFromArgv`（命令行覆盖预设） |
| `lib/arg_parser.js` | `--ffargs` 复合字符串解析器 |
| `src/transcode/hwaccel.js` | 硬件分层（TIERS）、编码器矩阵、质量归一化、滤镜/编码器参数组装、逐层探测 |
| `src/transcode/hwdetect.js` / `src/transcode/gpu.js` | 本机能力探测（`-hwaccels`/`-encoders`/`-filters`、GPU 厂商、NVDEC 支持矩阵） |
| `src/transcode/ffmpeg_plan.js` | 目标码率/尺寸/帧率计算、输出命名、字幕优选 |
| `src/transcode/ffmpeg_build.js` | 纯函数拼装最终 ffmpeg 命令行参数（输入/滤镜/视频/音频/元数据/输出） |
| `src/transcode/ffmpeg_run.js` | 单文件执行、进度解析、临时文件管理、失败恢复、日志落盘 |
| `src/transcode/ffmpeg_bin.js` | 定位 ffmpeg 可执行文件（环境变量优先） |

执行链路：`planFFmpegTasks`（校验+扫描+建任务+dry-run 预览+确认）→ `runFFmpegTasks`（并发 `runFFmpegCmd`）→ 每文件 `resolveHwPlan`（选层）→ `createFFmpegArgs`（拼参数）→ `executeFFmpeg`（起子进程）。

---

### 2. 快速开始

```bash
# 0) 查看有哪些预设（只读，不动文件）
mediac ffmpeg . --show-presets

# 1) 试跑（默认 dry-run）：只打印将执行的命令，不写任何文件
mediac ffmpeg ./video.mp4 --preset hevc_2k

# 2) 真正执行：必须加 --doit
mediac ffmpeg ./video.mp4 --preset hevc_2k --doit

# 3) 整目录批量 + 输出到指定目录，保留源目录结构
mediac ffmpeg ./Movies --preset hevc_2k -o ./Out --output-mode tree --doit

# 4) 提取视频中的音频
mediac ffmpeg ./video.mp4 --preset audio_extract --doit
```

> **两个最容易踩的坑**：① 不写 `--doit` 一律是 dry-run，不会产出文件；② 不写 `--preset`（或写了不存在的名字）会直接报错退出，本命令没有"默认预设"。

---

### 3. 参数总览

按功能分组列出。**类型**列中 `number` 的选项默认值多为 `0`，`0` 表示"未指定/不改动"。

#### 3.1 输入与文件筛选

| 选项 | 别名 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `<input>` | — | string | 位置参数：输入目录或单个媒体文件 |
| `--filelist` | — | string | 从文本文件读取要处理的路径（一行一个，支持 `#` 注释）；命中时**跳过目录遍历** |
| `--extensions` | `-e` | string | 需要处理的扩展名列表（默认常见视频/音频） |
| `--include` | `-I` | string | 文件名包含规则（默认启用正则） |
| `--exclude` | `-E` | string | 文件名排除规则，默认 `shana\|.m4a` |
| `--regex` | `-re` | boolean | `include/exclude` 是否按正则解释，默认 `true` |
| `--start` | — | number | 处理后列表起始索引，默认 `0` |
| `--count` | — | number | 从起始索引处理的数量，默认 `99999` |

#### 3.2 输出与命名

| 选项 | 别名 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `--output` | `-o` | string | 输出目录；不给则输出到源文件同目录 |
| `--output-mode` | `-om` | choices | `tree`（保持目录树）/ `dir`（默认，只保留父目录名）/ `file`（扁平到 `-o` 指定的目录） |
| `--prefix` | `-P` | string | 输出文件名前缀，支持模板变量 |
| `--suffix` | `-S` | string | 输出文件名后缀，支持模板变量 |
| `--override` | `-O` | boolean | 目标已存在时覆盖（默认跳过并打印 `Skip[Dst]`） |

模板变量（`prefix`/`suffix`/预设字段可用）：`{preset}` `{width}` `{height}` `{dimension}` `{speed}` `{videoQuality}` `{audioQuality}` `{framerate}` `{videoBitrateK}` `{audioBitrateK}` 等，由当前文件的计算结果填充。`{videoBitrateK}`/`{audioBitrateK}` 是带 `K` 的字符串，仅用于文件名/后缀等模板注入。

#### 3.3 预设

| 选项 | 类型 | 说明 |
| ---- | ---- | ---- |
| `--preset` | choices | **必填**，从预设名中选一个 |
| `--show-presets` | boolean | 打印全部预设详情后退出 |

#### 3.4 视频控制

| 选项 | 别名 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `--dimension` | — | number | 长边最大像素；**只在需要缩小**时生效（不放大） |
| `--fps` / `--framerate` | — | number | 目标帧率；**只在低于源帧率**时才加 `fps` 滤镜 |
| `--speed` | — | number | 变速倍率 `0.5–2.0`，`0`=不变速（音视频同步变速） |
| `--video-codec` | `-vc` | string | 显式指定视频编码器（穿透分层，如 `h264_nvenc`/`libx264`/`copy`） |
| `--video-bitrate` | `-vb` | string | 视频码率：裸数字=bps，或带 `k/m/g`（如 `233k`、`3M`），见 §9.18 |
| `--video-quality` | `-vq` | number | 视频质量（CRF 基准，见 §5） |
| `--video-copy` | — | boolean | 视频流直拷不重编码（会清空滤镜） |

> ⚠️ 旧版 `--video-args`（`-va`）已在 S-4 重构中移除。视频侧的额外参数请写进预设 YAML
> 的 `filters` / `pre_filters` / `post_filters`（滤镜）或 `outputArgs`（输出参数）；
> 换编码器用 `--video-codec` / `--ffargs "vc=..."`。

#### 3.5 音频控制

| 选项 | 别名 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `--audio-bitrate` | `-ab` | string | 音频码率：裸数字=bps，或带 `k/m/g`（如 `128k`、`3M`） |
| `--audio-quality` | `-aq` | number | 音频质量（VBR 等级） |
| `--audio-copy` | — | boolean | 音频流直拷不重编码 |

> ⚠️ 旧版 `--audio-args`（`-aa`）已在 S-4 重构中移除。音频编码器与码率分别由
> `--audio-codec`（或 `--ffargs "ac=..."`）与 `--audio-bitrate` 表达。

#### 3.6 元数据

| 选项 | 别名 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `--metadata` | — | string | 输出元数据专用通道，`;` 分隔多组 `key=value`，**值可含空格** |
| `--ffargs` | — | string | 复合字符串参数（别名见 §6.1） |

> ⚠️ 旧版 `--filters`（`-fs`）与 `--filter-complex`（`-fc`）已在 S-4 重构中移除。
> 滤镜一律由预设 YAML 声明：`filters`（`{scaleFilter}` 占位符，缩放由 tier 层替换）、
> `pre_filters`（缩放前）、`post_filters`（缩放后）。

#### 3.7 硬件加速与执行控制

| 选项 | 别名 | 类型 | 说明 |
| ---- | ---- | ---- | ---- |
| `--hwaccel` | `-hw` | string | 指定/过滤硬件层：`cuda`/`qsv`/`amf`/`d3d`(=`d3d11va`/`d3d12va`/`dxva2`)/`cpu`/`auto` |
| `--decode-mode` | — | choices | `auto`（默认，逐层降级）/ `gpu`（只用指定层，失败即硬报错）/ `cpu`（纯软解） |
| `--strict` | — | boolean | 严格模式：禁用一切自动降级，不支持的文件跳过+warn |
| `--jobs` | `-j` | number | 并发数；不给时视频预设默认 1、音频预设默认 4 |
| `--delete-source-files` | — | boolean | 产物成功且非空后删除源（走回收站，需确认，dry-run 不删） |
| `--doit` | `-d` | boolean | **真正执行**（否则只 dry-run） |
| `--auto-confirm` | `-A` | boolean | 跳过所有 y/N 交互确认，便于自动化 |
| `--error-file` | — | string | 将单文件错误写为 `json` 或 text 文件 |
| `--info` | — | boolean | 仅用 ffprobe 打印媒体信息后退出 |
| `--debug` | — | boolean | 提升 ffmpeg 日志级别为 `repeat+level+info` |

---

### 4. 内置预设

以下为 `presets/default.yaml` 注册的全部可用预设（`_base_*` 为继承模板，不对外注册）。质量值为 CRF 基准（h264/hevc 0–51、VP9 0–63，越小质量越高），码率是"上限参考"（受 §5.4"不超源"约束）。

**H.264 / AVC**

| 预设 | 长边 | 质量 | 码率 | 音频 |
| ---- | ---- | ---- | ---- | ---- |
| `h264_4ku` | 3840 | 22 | 20M | 256k |
| `h264_4k` | 3840 | 23 | 15M | 256k |
| `h264_4kl` | 3840 | 25 | 10M | 192k |
| `h264_2k` | 1920 | 24 | 4M | 192k |
| `h264_2km` | 1920 | 26 | 2M | 128k |
| `h264_2kl` | 1920 | 26 | 1.6M | 96k |

**H.265 / HEVC**

| 预设 | 长边 | 质量 | 码率 | 备注 |
| ---- | ---- | ---- | ---- | ---- |
| `hevc_4ku` | 3840 | 20 | 16M | |
| `hevc_4k` | 3840 | 22 | 10M | |
| `hevc_4kl` | 3840 | 24 | 6M | |
| `hevc_4kt` | 3840 | 26 | 4M | |
| `hevc_2ku` | 1920 | 22 | 8M | |
| `hevc_2kh` | 1920 | 22 | 6M | |
| `hevc_2k` | 1920 | 24 | 4M | 默认推荐 |
| `hevc_2km` | 1920 | 26 | 2M | |
| `hevc_2kl` | 1920 | 26 | 1.6M | |
| `hevc_2kt` | 1920 | 28 | 1.2M | 关智能码率，30fps |
| `hevc_preview` | 720 | 35 | 800k | 快速预览，15fps |

**AV1**（编码器按硬件层选：NVENC→`av1_nvenc`、QSV→`av1_qsv`、AMF→`av1_amf`、CPU→按构建在 `libsvtav1`/`libaom-av1`/`librav1e` 中取存在的）

| 预设 | 长边 | 质量 | 码率 |
| ---- | ---- | ---- | ---- |
| `av1_4ku` | 3840 | 24 | 25M |
| `av1_4k` | 3840 | 26 | 15M |
| `av1_4kl` | 3840 | 28 | 8M |
| `av1_2ku` | 1920 | 24 | 8M |
| `av1_2kh` | 1920 | 26 | 6M |
| `av1_2k` | 1920 | 28 | 4M |
| `av1_2km` | 1920 | 30 | 2M |
| `av1_2kl` | 1920 | 32 | 1.6M |

**VP9**（输出 `.webm` + `libopus` 音频；NVENC/AMF 无 VP9 编码 → 恒走 CPU `libvpx-vp9`；CRF 0–63）

| 预设 | 长边 | CRF | 音频 |
| ---- | ---- | ---- | ---- |
| `vp9_4k` | 3840 | 38 | 256k |
| `vp9_2ku` | 1920 | 30 | 256k |
| `vp9_2kh` | 1920 | 34 | 192k |
| `vp9_2k` | 1920 | 38 | 192k |
| `vp9_2km` | 1920 | 42 | 128k |
| `vp9_2kl` | 1920 | 46 | 128k |

**场景预设**

| 预设 | 长边 | 说明 |
| ---- | ---- | ---- |
| `web_720p` | 1280 | 网页嵌入，720p H.264，高兼容低码率 |
| `social_1080p` | 1920 | 社交媒体，1080p H.264，质量与体积平衡 |
| `archive_4k` | 3840 | 长期归档，4K HEVC，高质量低码率 |

**音频预设**

| 预设 | 输出 | 说明 |
| ---- | ---- | ---- |
| `audio_extract` | `.m4a` | 从视频提取音频（aac 源直拷，否则重编码） |
| `aac_high` | `.m4a` | AAC CBR 256k |
| `aac_medium` | `.m4a` | AAC CBR 192k |
| `aac_low` | `.m4a` | AAC CBR 128k |
| `aac_he` | `.m4a` | HE-AAC，96k 低码率 |
| `aac_voice` | `.m4a` | AAC，48k 人声 |

> 内置 AAC 预设默认使用 `libfdk_aac`（需 nonfree 构建）。若本机 ffmpeg 无该编码器，运行时会**自动降级到原生 `aac`**（严格模式下改为跳过该文件），详见 §9.7。

---

### 5. 核心机制

#### 5.1 预设分层与自定义

预设来自三层 YAML（优先级 低→高）：

1. 包内 `presets/default.yaml`（内置层，总是存在）
2. `~/.mediac/presets.yaml|yml`（用户全局层）
3. `cwd/presets.yaml|yml`（项目局部层）

规则：
- **继承**：`extends: _base_hevc` 合并父预设字段（子覆盖父）。
- **同名覆盖**：与内置预设同名时**默认拒绝并 warn 跳过**，必须显式写 `_override: true` 才允许覆盖（防止旧硬编码预设静默架空 S-4 预设）。
- **未知/错类型字段**：命中白名单外（如把 `videoBitrate` 写成 `videoBitrat`）会 warn「已忽略」而非静默吞掉——改完预设发现"参数没生效"时优先看这条告警。
- 以 `_` 开头的条目（`_base_*`）只作模板，不注册为可用预设。

#### 5.2 硬件分层（谁决定用什么编码器）

解码"层"（TIERS，按优先级）：`cuda`(N卡) → `qsv`(Intel) → `amf`(AMD) → `d3d`(d3d11va 通用兜底) → `swdec`(CPU解码+硬件编码) → `cpu`(纯软)。auto 模式实际候选链按**本机主 GPU 厂商**定向，再与 `ffmpeg -hwaccels`/`-encoders` 实测集取交集，最后总以 `cpu` 兜底。例：N 卡机 → `[cuda, d3d, cpu]`。

关键分工：
- **preset 只声明"输出什么 codec 族 + 质量/码率"**（`videoCodecFamily`），不关心硬件实现。
- **tier 决定"用哪个具体编码器 + 该编码器专属参数"**（见 `ENCODER_MATRIX`）。
- 二者组合后，质量参数再按编码器实现分发（NVENC 用 `-rc vbr -tune hq -rc-lookahead 20` 再叠加 `-cq/-b:v`，QSV 用 `-global_quality`/ICQ，CPU 用 `-crf -preset`，libvpx-vp9 纯 CRF 必带 `-b:v 0` 且禁带 `-maxrate/-bufsize`）。`-rc-lookahead` 除了改善码率分配，还会**启用 NVENC 的场景自适应关键帧与自适应 B 帧决策**（`h264_nvenc` 帮助中 `-no-scenecut`/`-b_adapt` 明确以"lookahead 开启"为前提），故 CQ 模式下亦有实义。

> **编码器族由 preset 决定，与输入位深无关。** 输入位深只影响"哪一层能解码"。历史上"10bit 输入就切 hevc"是 bug，已纠正。

#### 5.3 质量归一化（为什么同一数值各家体积不同）

质量以 x264/x265 的 CRF 为**统一基准**，NVENC/QSV 按 495 次标定做阶梯偏移换算（`QUALITY_OFFSET`，低质量区偏移大、高质量区趋近 0）。因此同一个 `--video-quality 24` 在 NVENC 与 x264 下产物体积并不等效属正常现象。AMF 未标定（本机无 A 卡），偏移取 0，质量值暂不下发，仅保留最保守码率控制。

#### 5.4 智能码率与"不放大"

`calculateDstArgs` 逐文件计算目标参数，恒定护栏：
- 目标码率 **不超过源码率**（`min(目标, 源)`），并按分辨率比例缩放。
- `--dimension` 只在长边需要变小时才加 `scale` 滤镜；帧率只在 `目标 < 源 × 0.98` 时才加 `fps`（避免同族抖动误重采样）。
- 预设 `smartBitrate: true` 时音频按源码率就近取档位（320/256/192/128/96/64/48k）。

---

### 6. `--ffargs` 复合参数与别名

`--ffargs` 用一行字符串批量设置常用参数，键经别名映射后等价于对应独立选项。

**分隔符是 `;` 或 `:` 或 `#`（三选一），不是逗号。** 逗号仅在 `[a,b,c]` 数组内部作元素分隔。值含空格时用引号包裹。

```bash
mediac ffmpeg ./v.mp4 --preset hevc_2k --ffargs "vq=23;vb=4000;ab=128;sp=1.5" --doit
```

别名对照（`左=右`）：

| ffargs 键 | 等价选项 | 键 | 等价选项 |
| ---- | ---- | ---- | ---- |
| `vb` / `vbit` / `vbk` / `vbitrate` | `--video-bitrate` | `ab` / `abit` / `abk` / `abitrate` | `--audio-bitrate` |
| `vq` / `vquality` | `--video-quality` | `aq` / `aquality` | `--audio-quality` |
| `vc` / `vcodec` | `--video-codec`（编码器，**非** copy） | `ac` / `acodec` | 音频编码器 |
| `px` / `pf` | `--prefix` | `sx` / `sf` | `--suffix` |
| `sp` | `--speed` | `dm` | `--dimension` |
| `fps` | `--framerate` | `md` / `meta` / `metadata` | `--metadata` |

> 注意：`vc`/`ac` 现表示**编码器**（codec），不再像旧版那样误映射为"流复制"。要流复制请用 `--video-copy` / `--audio-copy`，或 `vc=copy`。

**参数优先级**（高→低）：命令行独立选项 > `--ffargs` > 预设默认值。（`createFromArgv` 会把高层覆盖写进 `userArgs`。）

---

### 7. 元数据 `--metadata`

元数据是独立追加通道，专门用来保住**含空格的取值**（其它参数通道会按空白切 token，装不下空格值）。

```bash
mediac ffmpeg ./v.mp4 --preset hevc_2k \
  --metadata "title=我的 旅行 视频;comment=made by mediac" --doit
```

- 多组用 `;` 分隔，每组 `key=value`，`=` 后到段尾整体作值（内部空格原样保留）。
- 追加顺序在自动元数据（`description` / `copyright` / `title=源文件名`）**之后**，靠 ffmpeg "后写覆盖" 生效。
- 产物 `comment` 字段默认写入**完整 ffmpeg 命令行**（截断至 1000 字符），可据此精确追溯真实参数。

---

### 8. 典型示例

```bash
# 缩到 1080p、CRF 26，覆盖已存在产物
mediac ffmpeg ./Movies -o ./Out --preset hevc_2k --dimension 1920 --video-quality 26 -O --doit

# 1.5 倍速（音视频同步变速）
mediac ffmpeg ./clip.mp4 --preset hevc_2k --speed 1.5 --doit

# 视频流直拷、仅重压音频为 128k AAC
mediac ffmpeg ./v.mp4 --preset hevc_2k --video-copy --audio-bitrate 128 --doit

# 强制用 NVENC hevc
mediac ffmpeg ./v.mp4 --preset hevc_2k --video-codec hevc_nvenc --doit

# 纯 CPU 转码（不用任何硬件），失败也不降级重试
mediac ffmpeg ./v.mp4 --preset hevc_2k --decode-mode cpu --strict --doit

# 只探测某文件信息
mediac ffmpeg ./v.mp4 --preset hevc_2k --info

# 指定文件清单批量（便于参数矩阵测试）
mediac ffmpeg . --filelist samples.txt --preset vp9_2k --show-presets  # 先看预设
mediac ffmpeg . --filelist samples.txt --preset vp9_2k --doit
```

---

### 9. 注意事项（务必阅读）

**9.1 默认是 dry-run。** 不加 `--doit` 只做全流程演练（扫描、选层、拼命令、落盘日志、抽样预览），**不产出任何文件**。dry-run 大批量（>20 个）会抽样约 1/10，并明确提示，勿误以为处理了全部。

**9.2 `--preset` 必填且无默认值。** 缺失或名字不存在会直接报错退出。列名字用 `--show-presets`。

**9.3 滤镜与额外编码参数一律写在预设 YAML 里，命令行不提供注入通道。**
S-4 重构移除了 `--video-args` / `--audio-args` / `--filters` / `--filter-complex`，原因是
"往编码器块追加参数"会与硬件分层矩阵冲突（同一参数在不同层语义不同，甚至直接
`Unrecognized option` 导致整层探测失败、静默降级到 CPU）。请改用：

- `filters` / `pre_filters` / `post_filters` —— 三段式滤镜链，`{scaleFilter}` 由 tier 层替换；
- `inputArgs` / `streamArgs` / `outputArgs` —— 输入侧、流映射、输出侧参数串；
- `--video-codec` / `--ffargs "vc=..."` —— 显式指定编码器（穿透 ENCODER_MATRIX）。

**`-pix_fmt` 尤其不要手写**：在 cuda / qsv 帧留在显存的链路上手动加 `-pix_fmt yuv420p` 会把帧
拉出显存、破坏 0 拷贝路径，探测直接 rc≠0 → auto 静默降级到 swdec/cpu（实测错误文案
`Impossible to convert between the formats supported by the filter`）。位深对齐**本已由分层
自动完成**（cuda/qsv 走 `scale_*:format=nv12`；swdec 层自动补 `-pix_fmt yuv420p`），无需用户干预。

**9.4 编码器由"硬件层 + 预设 codec 族"共同决定，不由输入位深决定。** `--hwaccel`/`--decode-mode` 改的是解码通路和所选层，具体编码器名由该层的编码器矩阵按输出族挑选。

**9.5 `--speed` 只接受 `0.5–2.0`（`0` 表示不变速）。** 变速会：视频加 `setpts=PTS/倍率`、音频加 `atempo=倍率`（simple `-vf`+`-af`，由 muxer 按 PTS 保同步，不需要 complexFilter）。因此 **speed≠1 会强制音频重编码**，此时 `--audio-copy` / copy 启发式被忽略并 warn。

**9.6 `--dimension` / 码率 / 帧率都"只降不升"。** 不会放大分辨率、不会把码率提到超过源、不会把帧率提到超过源。想强制更高码率需理解这一护栏。

**9.7 AAC 依赖 nonfree 构建。** 内置 AAC 预设用 `libfdk_aac`。本机 ffmpeg 若无该编码器：普通模式自动降级到原生 `aac`；`--strict` 模式不降级、直接跳过该文件（记 `Skip[StrictCodec]`）。用 `FFMPEG_PATH`/`FFMPEG_BINARY` 指定带 fdk 的构建可避免降级。

**9.8 `--strict` 会改变失败语义。** 禁用硬件层回退 CPU、编码器降级、失败重试、10bit 软解规避；任何"本机软硬件不支持"的文件按**跳过+warn**处理（不标失败、不重试、不进失败汇总），结束时汇总跳过总数。适合要"确定性结果、不静默降级"的批处理。

**9.9 `--delete-source-files` 有安全护栏。** 仅当产物**存在且体积 >0 字节**才删源；0 字节/半截的坏产物会保留源并提示 `Skip[BadDst]`；dry-run 绝不删；删除是移入**回收站**（`safeRemove`，非永久删除）且需要确认。

**9.10 目标已存在默认跳过。** 打印 `Skip[Dst]` 并保留源；只有 `--override/-O` 才覆盖。`--override` 此前是"假参数"（声明了却没被读），现已真正生效。

**9.11 流复制与滤镜互斥。** `--video-copy` 会清空预设的 `filters`/`complexFilter`，且不参与硬件分层探测；`--audio-copy` 与变速互斥（见 9.5）。

**9.12 临时文件与中断安全。** 产物先写成 `基名_tmp@<哈希>@tmp_.ext`，成功后原子改名；`-n` 让 ffmpeg 自身也不覆盖既有文件；Ctrl+C（SIGINT）/ SIGTERM / 进程 exit 会统一清理在途临时文件，不留半截产物。

**9.13 探测命令与真实命令同构。** dry-run 预览用 CPU 层生成"示意命令"；真实执行对每个文件逐层干跑探测（`probeLayer`，按 层|编码|位深|像素格式|尺寸 缓存）再定层。选层与真实命令行都会落盘到 `FFCMD` 日志，可从产物 `comment` 精确复原真实命令。

**9.14 按类型过滤输入 + 坏文件跳过。** 视频预设只处理含视频轨的文件、音频预设只处理音频；`ffprobe` 读不到时长/码率（坏格式）、时长 <1s、目标类型缺对应流等情况会 `Skip[...]` 跳过。单个坏文件不会中断整批。

**9.15 字幕自动挂载。** 扫描源同目录与 `subs/` 下的 `.ass/.ssa/.srt`，**优先中文字幕**；MP4 内嵌字幕仅 `tx3g` 可转 `mov_text`，其它内嵌字幕直接 `-sn` 丢弃。外置字幕按 `-map 0:v -map 0:a -map 1` 注入并把中文轨设默认。

**9.16 VP9 / AV1 无硬编时走 CPU。** VP9 无 NVENC/AMF 编码器 → 恒 CPU `libvpx-vp9`，`.webm` 容器音频只能 `opus`/`vorbis`（内置 VP9 预设用 `libopus`）。AV1 在 CPU/通用层会按运行时探测在候选里取该构建**真实存在**的编码器，避免 `Unknown encoder`。

**9.17 yargs 选项写法约束。** 子命令启用 `.strictOptions()`：拼错/未知的选项直接报错，而非静默忽略。选项值若以 `-` 开头（如负数、以 `-` 起的串），须用 `--opt=-xxx` 形式绑定，否则会被当成另一个选项；单横线多字符名会被逐字母聚簇（`-abc` → `a/b/c`）。

**9.18 单位。** `--video-bitrate` / `--audio-bitrate` 为字符串码率：裸数字=bps，带 `k/m/g` 后缀按 **1000 进制**（`k`=×1000，`m`=×1e6，`g`=×1e9，大小写均可）换算为 bps，与 ffmpeg `-b:v "3M"`=3_000_000 一致；`--video-quality` / `--audio-quality` 无量纲（CRF / VBR 等级）。

**9.19 CLI 与 WebUI 共用 Planner。** 相同输入、输出模式和选项会生成相同的 task 集合；空计划/全跳过计划会保留在 Plan 中并由 Engine 统一汇总。WebUI 的 `deleteSourceFiles` 请求必须同时提供 `deleteSourceConfirmed: true` 或 `autoConfirm: true`，否则 API 拒绝执行；CLI 仍使用交互确认。

---

### 10. 环境变量

| 变量 | 作用 |
| ---- | ---- |
| `FFMPEG_PATH` | 指定 ffmpeg 可执行文件路径（最高优先，需文件真实存在） |
| `FFMPEG_BINARY` | 部分工具链的备选名（次优先）；两者都不设时按 `PATH` 查找 |
| `MEDIAC_AUTO_CONFIRM` | 等价于 `--auto-confirm`，跳过交互确认 |

> 执行用的 ffmpeg 与能力探测用的是同一个二进制，避免"探测说有 fdk、执行时 Unknown encoder"的不一致。

---

### 11. 排查建议

- 命令行到底长什么样 → 看控制台 `CMD:` 行、`FFCMD` 日志的 `Plan`/`CMD` 行，或产物 `comment` 元数据。
- 为什么没走硬件加速 → `Plan` 行里的 `tier=` 与 `tried=[...]`、`reason=` 会说明降级路径；`hwdetect` 日志说明各层是否入场（`-hwaccels`/`-encoders`/滤镜预筛）。
- 预设改了没生效 → 找 `PresetLoader` 的 unknown field / `_override` skipped 告警。
- 音频莫名变成 `aac` 而非 `libfdk_aac` → 本机构建缺 fdk，见 9.7。
- 想复现/调试单条命令 → 从日志 `CMD` 行拷出参数，配合 `--debug` 提高 ffmpeg 日志级别再看 `[error]` 根因行。
