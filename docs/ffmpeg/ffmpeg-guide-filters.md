# FFmpeg 滤镜（filters）使用与详解指南

> 版本基准：本文参数以 FFmpeg 官方文档（`temp/ffmpeg-docs` 离线副本：`ffmpeg-filters.md`、`ffmpeg-scaler.md`、`ffmpeg-resampler.md`）为准，并用本机 `F:\Temp\ffmpeg\ffmpeg-9-nonfree`（libavfilter 12.4.100）核对。
> 阅读约定：滤镜参数用 `:` 分隔，滤镜之间用 `,` 连接成链，链之间用 `;` 分隔。**含特殊字符时务必用引号包裹整个滤镜图。**

---

## 目录

1. [滤镜图（filtergraph）语法](#1-滤镜图filtergraph语法)
2. [简单滤镜 vs 复杂滤镜](#2-简单滤镜-vs-复杂滤镜)
3. [转义规则（最容易踩的坑）](#3-转义规则最容易踩的坑)
4. [时间轴编辑与运行时命令](#4-时间轴编辑与运行时命令)
5. [多输入滤镜的公共选项（framesync）](#5-多输入滤镜的公共选项framesync)
6. [视频：尺寸、缩放与构图](#6-视频尺寸与构图) ★扩充
7. [视频：叠加、水印与文字](#7-视频叠加水印与文字)
8. [视频：时间、帧率与变速](#8-视频时间与帧率) ★扩充
9. [视频：颜色、格式与色彩空间](#9-视频颜色格式与色彩空间)
10. [视频：降噪、去隔行与修复](#10-视频降噪去隔行与修复)
11. [视频：转场、拼接与多画面](#11-视频转场拼接与多画面)
12. [音频：重采样与声道](#12-音频重采样与声道) ★扩充
13. [音频：音量、动态与均衡](#13-音频音量动态与均衡) ★扩充
14. [音频：混合、淡入淡出与编辑](#14-音频混合淡入淡出与编辑)
15. [音频：响度标准化](#15-音频响度标准化)
16. [复杂滤镜图实战配方](#16-复杂滤镜图实战配方)
17. [滤镜调试与速查](#17-滤镜调试与速查)
18. [常用场景完整配方](#18-常用场景完整配方) ★新增

---

## 1. 滤镜图（filtergraph）语法

滤镜图是一个**有向图**，由若干滤镜（filter）通过 link 连接而成。

```
FILTER_NAME[@id]=arguments
```

完整形式（含输入输出标签）：

```
[in_link_1]...[in_link_N] filter_name@id=arguments [out_link_1]...[out_link_M]
```

**三类参数写法：**

| 写法 | 示例 | 说明 |
| --- | --- | --- |
| `key=value` 列表 | `scale=w=1280:h=720` | 最清晰，推荐 |
| 纯值列表 | `fade=in:0:30` | 按选项声明顺序赋值（`fade` 依次为 `type:start_frame:nb_frames`） |
| 混合 | `crop=640:480:0:0` | 直接值必须在前，`key=value` 在后 |

**BNF 语法（官方原文）：**

```
NAME             ::= sequence of alphanumeric characters and '_'
FILTER_NAME      ::= NAME["@"NAME]
LINKLABEL        ::= "[" NAME "]"
LINKLABELS       ::= LINKLABEL [LINKLABELS]
FILTER_ARGUMENTS ::= sequence of chars (possibly quoted)
FILTER           ::= [LINKLABELS] FILTER_NAME ["=" FILTER_ARGUMENTS] [LINKLABELS]
FILTERCHAIN      ::= FILTER [,FILTERCHAIN]
FILTERGRAPH      ::= [sws_flags=flags;] FILTERCHAIN [;FILTERGRAPH]
```

**要点：**

- 一个 filterchain 内用 `,` 连接，表示串行；多个 filterchain 用 `;` 分隔。
- `[label]` 命名链接点；同名 label 自动连线。
- 未标注的输出 pad 默认连到下一个滤镜第一个未标注输入 pad。
- 首滤镜未标输入默认 `in`，末滤镜未标输出默认 `out`。
- 可以带 `@id` 给滤镜实例命名（便于运行时发命令），如 `scale@sc=1280:720`。
- 官方示例（把上半部分镜像到下半部分）：

```bash
ffmpeg -i INPUT -vf "split [main][tmp]; [tmp] crop=iw:ih/2:0:0, vflip [flip]; [main][flip] overlay=0:H/2" OUTPUT
```

- 可在滤镜图最前面写 `sws_flags=flags;` 设置自动插入的 scale 滤镜的算法：

```bash
-vf "sws_flags=lanczos;scale=1280:720"
```

---

## 2. 简单滤镜 vs 复杂滤镜

| 类型 | 选项 | 说明 |
| --- | --- | --- |
| **简单滤镜图** | `-vf`（=`-filter:v`）、`-af`（=`-filter:a`） | 单输入单输出，绑定到某个输出流 |
| **复杂滤镜图** | `-filter_complex` / `-lavfi` | 全局选项，可多输入多输出；输出用 `-map "[label]"` 取用 |

```bash
# 简单滤镜：单流处理
ffmpeg -i in.mp4 -vf "scale=1280:-2,fps=30" -af "volume=0.8" out.mp4

# 复杂滤镜：双输入叠加
ffmpeg -i video.mp4 -i logo.png -filter_complex "[0:v][1:v]overlay=W-w-10:10[out]" -map "[out]" -map 0:a? out.mp4
```

> `-map 0:a?` 中的 `?` 表示该流不存在时不报错。

---

## 3. 转义规则（最容易踩的坑）

滤镜图有**三层转义**，这是绝大多数「命令莫名报错」的根源：

1. **第一层**：滤镜选项值内部，需转义 `:` 和 `\`、`'`。
2. **第二层**：整个滤镜描述内部，需转义 `\`、`'` 以及 `[` `]` `,` `;`。
3. **第三层**：Shell 命令行层，取决于 shell（Windows cmd 用 `^`，PowerShell/bash 用 `\` 或反引号）。

官方示例——要在 `drawtext` 中显示：

```
this is a 'string': may contain one, or more, special characters
```

逐层转义后（第一层）：

```
text=this is a \'string\'\: may contain one, or more, special characters
```

嵌入滤镜图后（第二层）：

```
drawtext=text=this is a \\\'string\\\'\\: may contain one\, or more\, special characters
```

**规避建议（强烈推荐）：**

- **文本内容用 `textfile=` 而不是 `text=`**，彻底避开转义地狱。
- 滤镜图整体用**双引号**包裹，内部用**单引号**处理嵌套。
- 文件路径中的 `:`（Windows 盘符）需写成 `\:`，如 `subtitles=C\:/subs/a.srt`。
- 官方提示：`-vf drawtext=/text=/tmp/some_text` 这种 `/选项名=路径` 语法可从文件读取选项值。

```bash
# 反例（易错）
-vf "drawtext=text='It''s a test':x=10:y=10"

# 正例（用文件）
-vf "drawtext=textfile=label.txt:fontsize=32:fontcolor=white:x=20:y=20"
```

---

## 4. 时间轴编辑与运行时命令

### 4.1 `enable` 时间轴

支持时间轴的滤镜都有通用 `enable` 选项，表达式非零时启用：

| 常量 | 含义 |
| --- | --- |
| `t` | 时间戳（秒），未知时为 NAN |
| `n` | 输入帧序号（从 0 开始） |
| `w` / `h` | 输入帧宽高（仅视频） |
| `pos` | 文件位置（已废弃，勿用） |

```bash
# 10 秒到 3 分钟之间启用模糊
-vf "smartblur=enable='between(t,10,3*60)'"

# 3 秒后启用 curves 调色
-vf "curves=enable='gte(t,3)':preset=cross_process"

# 每 10 秒反向旋转
-vf "rotate=enable='lt(mod(t,20),10)'"
```

> 用 `ffmpeg -filters` 查看哪些滤镜支持时间轴（Timeline 列显示 `T`）。

### 4.2 运行时命令

部分选项可在运行中通过命令修改，这类选项在 `ffmpeg -h filter=<name>` 输出中标记为 `T`。命令名即选项名，参数为新值。可通过 `sendcmd` / `zmq` 发送。

```bash
# 用 sendcmd 在 5 秒时把音量降到 0.3
ffmpeg -i in.mp4 -filter_complex "sendcmd='5 volume volume 0.3';[0:a]volume=1.0[a]" -map 0:v -map "[a]" out.mp4
```

---

## 5. 多输入滤镜的公共选项（framesync）

`overlay`、`blend`、`psnr`、`libvmaf` 等双输入滤镜共享以下选项（**只能按名称设置，不能用简写**）：

| 选项 | 取值 | 说明 |
| --- | --- | --- |
| `eof_action` | `repeat`(默认) / `endall` / `pass` | 副输入 EOF 时的行为：重复末帧 / 同时结束 / 主输入直通 |
| `shortest` | 0/1 | 为 1 时在最短输入结束时终止输出，默认 0 |
| `repeatlast` | 0/1 | 为 1 时把副输入末帧延续到主输入结束，默认 1 |
| `ts_sync_mode` | `default` / `nearest` | 副输入取「时间戳最近的下/等值帧」或「绝对最近帧」 |

---

## 6. 视频：尺寸与构图

### 6.1 `scale` —— 缩放（最常用）

| 选项 | 说明 |
| --- | --- |
| `w`, `h` | 输出宽高表达式；`0` 表示保持输入；`-n` 表示按比例计算并保证被 n 整除 |
| `eval` | `init`（仅初始化时求值）/ `frame`（每帧求值） |
| 其他 | 接受所有 libswscale 缩放选项 + framesync 选项 |

**常用表达式常量：** `iw`/`in_w`、`ih`/`in_h`、`a`（宽高比）、`sar`、`dar`、`hsub`/`vsub`、`n`、`t`。

```bash
# 缩到 720p（宽自动、保证偶数）
-vf "scale=1280:-2"

# 缩到高度 720，宽自动
-vf "scale=-2:720"

# 保持比例放进 1920x1080 画布（不拉伸）
-vf "scale=1920:1080:force_original_aspect_ratio=decrease"

# 缩放到原来的一半，用 lanczos
-vf "scale=iw/2:ih/2:flags=lanczos"

# 只保证宽高为偶数（编码器要求）
-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"
```

**缩放算法（`flags` / `sws_flags`）：**

| 算法 | 特点 | 适用 |
| --- | --- | --- |
| `neighbor` / `point` | 最近邻，最快 | 像素画、无插值需求 |
| `bilinear` | 双线性 | 快速通用 |
| `bicubic`（默认） | 双三次 | 通用平衡 |
| `lanczos` | Lanczos | **缩小首选**，锐度高 |
| `spline` | 自然双三次样条 | 平滑 |
| `area` | 区域平均 | **大幅缩小首选**，抗锯齿好 |
| `gaussian` | 高斯 | 柔和 |
| `sinc` | 无窗 sinc | 高质量但振铃 |
| `bicublin` | 亮度双三次 + 色度双线性 | 色度不敏感场景 |

> 新版还可直接用 `scale=...:scaler=lanczos` 指定算法；`sws_flags` 写法已标记为 deprecated 但兼容。

**`scale` 的完整参数（本机实测，含色彩管理）：**

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `w` / `width` | 输入宽 | 输出宽表达式（支持 timeline） |
| `h` / `height` | 输入高 | 输出高表达式 |
| `size` / `s` | — | 尺寸简写，如 `size=1280x720` |
| `flags` | `""` | 缩放算法与附加开关（用 `+` 连接） |
| `interl` | false | 输入是隔行 |
| `in_color_matrix` | auto | 输入 YCbCr 类型：`bt601` `bt709` `bt2020` `bt2020nc` `smpte240m` `fcc` `bt470bg` |
| `out_color_matrix` | auto | 输出 YCbCr 类型 |
| `in_range` / `out_range` | auto | 色域范围：`limited`(`tv`/`mpeg`) / `full`(`pc`/`jpeg`) |
| `in_chroma_loc` / `out_chroma_loc` | auto | 色度位置：`left` `center` `topleft` `top` `bottomleft` `bottom` |
| `in_primaries` / `out_primaries` | auto | 基色：`bt709` `bt470m` `bt470bg` `smpte170m` `smpte240m` `film` `bt2020` `smpte428` `smpte431` `smpte432` `jedec-p22` |
| `in_trc` / `out_trc` | auto | 传输特性（gamma 曲线） |

**`flags` 中的附加开关（可与算法组合）：**

| 标志 | 作用 |
| --- | --- |
| `accurate_rnd` | 精确舍入（提高精度，稍慢） |
| `full_chroma_int` | 完整色度插值 |
| `full_chroma_inp` | 完整色度输入 |
| `bitexact` | 输出可复现（测试用） |
| `print_info` | 打印调试信息 |

**抖动（`sws_dither`，缩放到低位深时用）：**

| 取值 | 说明 |
| --- | --- |
| `auto` | 自动（默认） |
| `none` | 不抖动 |
| `bayer` | 有序抖动，快，有图案感 |
| `ed` | 误差扩散，质量好 |
| `a_dither` | 算术抖动（加法） |
| `x_dither` | 算术抖动（异或），图案感更弱 |

**alpha 混合（`alphablend`，输入有 alpha 而输出没有时）：** `none`（默认）/ `uniform_color` / `checkerboard`

```bash
# 高质量缩小（推荐组合：lanczos + 精确舍入 + 完整色度插值）
ffmpeg -i in.mp4 -vf "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int" \
  -c:v libx264 -crf 20 -c:a copy out.mp4

# 大幅缩小用 area（抗锯齿最好）
ffmpeg -i 4k.mp4 -vf "scale=1280:720:flags=area" -c:v libx264 -crf 22 out.mp4

# 新版 scaler= 写法 + 提高 lanczos tap 数（更锐）
ffmpeg -i in.mp4 -vf "scale=1920:1080:scaler=lanczos:param0=4" -c:v libx264 -crf 20 out.mp4

# 全图 sws_flags 写法（影响所有自动插入的 scale）
ffmpeg -i in.mp4 -vf "sws_flags=lanczos;scale=1280:720" -c:v libx264 -crf 22 out.mp4

# 色域范围修复：「发灰」→ 转 full range
ffmpeg -i in.mp4 -vf "scale=in_range=limited:out_range=full" -c:v libx264 -crf 20 out.mp4

# 色域范围修复：过曝/死黑 → 转 limited range
ffmpeg -i in.mp4 -vf "scale=in_range=full:out_range=limited" -c:v libx264 -crf 20 out.mp4

# 明确标记色彩矩阵（避免播放器猜错导致偏色）
ffmpeg -i in.mp4 -vf "scale=in_color_matrix=bt709:out_color_matrix=bt709" -c:v libx264 -crf 20 out.mp4

# 10bit → 8bit 缩放并加误差扩散抖动，减少色带
ffmpeg -i in10bit.mkv -vf "scale=1920:1080:sws_dither=ed" -pix_fmt yuv420p -c:v libx264 -crf 20 out.mp4
```

### 6.2 缩放尺寸表达式系统（完整）

`scale` / `crop` / `pad` 等共享同一套表达式语言：

**常量：**

| 常量 | 含义 |
| --- | --- |
| `in_w` / `iw` | 输入宽 |
| `in_h` / `ih` | 输入高 |
| `out_w` / `ow` | 输出宽 |
| `out_h` / `oh` | 输出高 |
| `a` | 输入宽高比（`iw/ih`） |
| `sar` | 样本宽高比 |
| `dar` | 显示宽高比（`iw/ih*sar`） |
| `hsub` / `vsub` | 水平/垂直色度抽样（`yuv422p` 为 2/1） |
| `n` | 帧序号（从 0 开始） |
| `t` | 时间戳（秒） |

**函数：**

| 函数 | 用途 |
| --- | --- |
| `trunc(x)` | 向零取整 |
| `ceil(x)` / `floor(x)` | 上/下取整 |
| `round(x)` | 四舍五入 |
| `min(x,y)` / `max(x,y)` | 最小/最大 |
| `sqrt(x)` / `hypot(x,y)` / `abs(x)` | 平方根 / 斜边 / 绝对值 |
| `if(c,a,b)` | 条件表达式 |
| `lt(a,b)` `gt(a,b)` `eq(a,b)` `lte` `gte` | 比较 |
| `mod(x,y)` | 取模 |
| `pow(x,y)` / `log(x)` / `exp(x)` | 幂 / 对数 / 指数 |

```bash
# 尺寸写法速查
-vf "scale=1280:-2"                                     # 定宽，高按比例且为偶数
-vf "scale=-2:720"                                      # 定高
-vf "scale=-1:720"                                      # 定高（宽可为奇数）
-vf "scale=iw/2:ih/2"                                   # 缩到一半
-vf "scale=iw*1.5:ih*1.5"                               # 放大 1.5 倍
-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"                 # 只保证偶数（不改尺寸）
-vf "scale=1920:1080:force_original_aspect_ratio=decrease"       # 等比装进画布
-vf "scale=1920:1080:force_original_aspect_ratio=increase"       # 等比填满画布
-vf "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2"
-vf "scale=w='min(1920,iw)':h=-2"                             # 不超过 1920 宽
-vf "scale=w='if(gt(a,1),1920,-2)':h='if(gt(a,1),-2,1080)'"      # 按横竖屏分别处理
-vf "scale=w='if(gte(iw,ih),min(1920,iw),-2)':h='if(gte(iw,ih),-2,min(1920,ih))'"   # 长边限 1920
```

**横竖屏自适应（短视频场景必备）：**

```bash
# 横屏缩到 1920x1080、竖屏缩到 1080x1920，统一装进 1920x1920 画布居中
ffmpeg -i in.mp4 -vf "\
scale=w='if(gt(a,1),1920,1080)':h='if(gt(a,1),1080,1920)':force_original_aspect_ratio=decrease,\
pad=1920:1920:(ow-iw)/2:(oh-ih)/2:black,\
setsar=1" -c:v libx264 -crf 22 out.mp4

# 批量统一到 1080p 并补边（不拉伸）
ffmpeg -i in.mp4 -vf "\
scale=1920:1080:force_original_aspect_ratio=decrease,\
pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,\
setsar=1" -c:v libx264 -crf 22 -c:a copy out.mp4
```

### 6.3 色度采样与位深处理

**常见像素格式对照：**

| 格式 | 位深 | 色度 | 用途 |
| --- | --- | --- | --- |
| `yuv420p` | 8 | 4:2:0 | **最兼容**，H.264/HEVC 主流 |
| `yuv422p` | 8 | 4:2:2 | 专业采集、中间格式 |
| `yuv444p` | 8 | 4:4:4 | 无损/高质量，兼容性差 |
| `yuv420p10le` | 10 | 4:2:0 | **10bit 主力格式** |
| `p010le` | 10 | 4:2:0 | 硬件路径常用 10bit 格式 |
| `yuv420p12le` | 12 | 4:2:0 | 12bit |
| `nv12` | 8 | 4:2:0 | 半平面（硬件首选） |
| `gray` / `gray10le` | 8/10 | 单通道 | 灰度 |

```bash
# 8bit → 10bit（提升编码精度，减少色带）
ffmpeg -i in8bit.mp4 -vf "scale=1920:1080,format=yuv420p10le" -c:v libx265 -crf 22 out10bit.mkv

# 4:2:0 → 4:4:4（色彩精度提升）
ffmpeg -i in.mp4 -vf "scale=1920:1080,format=yuv444p" -c:v libx264 -crf 18 -profile:v high444 out.mp4

# 色度位置修正（某些采集卡需要）
ffmpeg -i in.mp4 -vf "scale=1920:1080:in_chroma_loc=left:out_chroma_loc=left" -c:v libx264 -crf 20 out.mp4

# 提亮暗部并输出 10bit（避免色带）
ffmpeg -i in.mp4 -vf "eq=brightness=0.05,format=yuv420p10le" -c:v libx265 -crf 22 out.mkv
```

### 6.4 `zscale` —— 高质量缩放与色彩空间转换

基于 z.lib（zimg），在**色彩空间/HDR 转换**场景下优于 `scale`。

**完整参数（本机实测）：**

| 参数 | 说明 |
| --- | --- |
| `w` / `h` | 输出尺寸表达式 |
| `d` / `dither` | 抖动类型（`none` / `ordered` / `random` / `error_diffusion`） |
| `f` / `filter` | 缩放滤波类型（默认 `bilinear`） |
| `r` / `range` | 输出色域范围 |
| `p` / `primaries` | 输出基色 |
| `t` / `transfer` | 输出传输特性 |
| `m` / `matrix` | 输出色彩矩阵 |
| `rin` / `rin` | **输入**色域范围 |
| `pin` | **输入**基色 |
| `tin` | **输入**传输特性 |
| `min` | **输入**色彩矩阵 |
| `npl` | 名义峰值亮度（HDR 用） |

```bash
# 缩放（zscale 的基础用途，稳定可用）
ffmpeg -i in.mp4 -vf "zscale=w=1920:h=1080:f=lanczos" -c:v libx264 -crf 20 out.mp4

# 色彩空间转换（不带线性化）
ffmpeg -i in.mp4 -vf "zscale=t=bt709:m=bt709:p=bt709:r=limited" -c:v libx264 -crf 20 out.mp4
```

**HDR → SDR 经典链路（需要 zscale 的线性光支持）：**

```bash
-vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
```

> ⚠️ **重要兼容性提示**：`zscale=t=linear`（转线性光）依赖 libzimg 的完整色彩空间图。
> 经本机对 **ffmpeg 7 / 8 / 8.1.2 / 9 / 9.0.1 五个构建**实测，该路径均返回
> `code 3074: no path between colorspaces`——属于**本机 libzimg 构建的已知限制**，
> 而非命令写法错误。若你遇到同样报错，请改用下列**已验证可用**的替代方案。

**替代方案 A：`tonemap` + `format`（已验证可用）**

```bash
# 用 format=gbrpf32le 直接进入浮点线性空间，跳过 zscale 的 linear 转换
ffmpeg -i hdr.mkv -vf "format=gbrpf32le,tonemap=tonemap=hable:desat=0,format=yuv420p" \
  -c:v libx264 -crf 20 out.mp4
```

**替代方案 B：`libplacebo`（已验证可用，质量最佳）**

```bash
ffmpeg -i hdr.mkv -vf "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p" \
  -c:v libx264 -crf 20 out.mp4
```

**替代方案 C：硬件色调映射（见硬件加速文档）**

```bash
# QSV
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i hdr.mkv \
  -vf "vpp_qsv=tonemap=1:format=nv12,hwdownload,format=nv12" -c:v hevc_qsv out.mp4
# VAAPI
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i hdr.mkv \
  -vf "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,hwdownload,format=nv12" -c:v h264_vaapi out.mp4
```

> 若你的构建中 `zscale=t=linear` 可用（可用 `ffmpeg -i in.mp4 -vf "zscale=t=linear" -f null -` 快速自测），
> 则经典链路的色彩精度最佳，优先使用它。

### 6.5 `crop` —— 裁剪

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `w`/`out_w` | `iw` | 输出宽（仅配置时求值一次） |
| `h`/`out_h` | `ih` | 输出高 |
| `x` | `(in_w-out_w)/2` | 左上角水平位置（每帧求值） |
| `y` | `(in_h-out_h)/2` | 左上角垂直位置（每帧求值） |
| `keep_aspect` | 0 | 保持显示宽高比 |
| `exact` | 0 | 精确裁剪（不对齐到色度采样边界） |

```bash
# 居中裁剪 640x480
-vf "crop=640:480"

# 裁掉左右黑边各 100
-vf "crop=iw-200:ih:100:0"

# 裁掉上下各 60
-vf "crop=iw:ih-120:0:60"

# 取右下四分之一
-vf "crop=iw/2:ih/2:iw/2:ih/2"
```

### 6.6 `cropdetect` —— 自动检测黑边

```bash
# 检测并打印建议裁剪参数（limit 阈值，round 对齐）
-vf "cropdetect=limit=24:round=2:reset=0"
```

### 6.7 `pad` —— 加边框/画布

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `w` / `h` | 0（=输入） | 输出画布尺寸 |
| `x` / `y` | 0 | 原图在画布中的位置；负值自动居中 |
| `color` | `black` | 填充色 |
| `eval` | `init` | 表达式求值时机 |
| `aspect` | — | 按宽高比填充 |

```bash
# 放进 1920x1080 居中，黑边
-vf "pad=1920:1080:(ow-iw)/2:(oh-ih)/2"

# 白边
-vf "pad=iw+20:ih+20:10:10:white"

# 按 16:9 填充
-vf "pad=ih*16/9:ih:(ow-iw)/2:0:black"
```

### 6.8 `transpose` / `hflip` / `vflip` / `rotate`

| 滤镜 | 说明 |
| --- | --- |
| `hflip` | 水平翻转 |
| `vflip` | 垂直翻转 |
| `transpose` | `0`=逆时针90°+垂直翻转、`1`=顺时针90°、`2`=逆时针90°、`3`=顺时针90°+垂直翻转 |
| `rotate` | `rotate=角度[弧度]`，支持 `t` 表达式；可选 `ow`/`oh` 输出尺寸、`fillcolor` |

```bash
-vf "transpose=1"                       # 顺时针旋转 90°
-vf "hflip"                             # 镜像
-vf "rotate=PI/6:ow=rotw(PI/6):oh=roth(PI/6):c=black"   # 旋转 30° 带黑边
```

### 6.9 `setdar` / `setsar`

```bash
-vf "setdar=16/9"      # 设置显示宽高比
-vf "setsar=1"         # 方形像素（消除 anamorphic）
```

---

## 7. 视频：叠加、水印与文字

### 7.1 `overlay` —— 叠加（画中画/水印核心）

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `x`, `y` | 0 | 叠加位置表达式 |
| `eval` | `frame` | `init` 只算一次（静止水印更省） |
| `format` | — | 输出像素格式：`yuv420`、`yuv420p10`、`yuv422`、`yuv444`、`rgb`、`gbrp`、`auto` |
| `eof_action`/`shortest`/`repeatlast` | — | framesync 选项 |

**常用位置表达式：**

| 表达式 | 位置 |
| --- | --- |
| `10:10` | 左上角 |
| `W-w-10:10` | 右上角 |
| `10:H-h-10` | 左下角 |
| `W-w-10:H-h-10` | 右下角 |
| `(W-w)/2:(H-h)/2` | 居中 |
| `x='if(eq(mod(t,10),0),...)'` | 动态移动 |

> `W`/`H` 是主视频宽高，`w`/`h` 是叠加视频宽高。

```bash
# 右下角水印，静态位置（init 更省）
ffmpeg -i in.mp4 -i logo.png -filter_complex "[0:v][1:v]overlay=W-w-20:H-h-20:eval=init[out]" -map "[out]" -map 0:a? out.mp4

# 带透明度水印（先给 logo 调 alpha）
ffmpeg -i in.mp4 -i logo.png -filter_complex "[1:v]format=rgba,colorchannelmixer=aa=0.5[wm];[0:v][wm]overlay=W-w-20:20[out]" -map "[out]" out.mp4

# 画中画：副视频缩放后叠在右下角
ffmpeg -i main.mp4 -i pip.mp4 -filter_complex "[1:v]scale=480:-2[small];[0:v][small]overlay=W-w-20:H-h-20[out]" -map "[out]" -map 0:a out.mp4

# 水印在 10~20 秒之间显示
-vf "overlay=10:10:enable='between(t,10,20)'"
```

### 7.2 `drawtext` —— 绘制文字

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `text` | — | 文本内容（转义复杂，建议用 `textfile`） |
| `textfile` | — | 从文件读取文本（**推荐**） |
| `fontfile` / `font` | — | 字体文件路径 / 字体族名（需 fontconfig） |
| `fontsize` | 16 | 字号 |
| `fontcolor` | black | 字色 |
| `fontcolor_expr` | — | 动态字色表达式（覆盖 `fontcolor`） |
| `x`, `y` | 0 | 位置表达式 |
| `box` | 0 | 是否绘制背景框 |
| `boxcolor` | white | 框颜色 |
| `boxborderw` | 0 | 框边框宽度，支持 `上\|右\|下\|左` 形式 |
| `borderw` | 0 | 文字描边宽度 |
| `bordercolor` | black | 描边颜色 |
| `shadowx` / `shadowy` / `shadowcolor` | 0/0/black | 阴影 |
| `alpha` | 1.0 | 透明度（支持表达式） |
| `line_spacing` | 0 | 行距 |
| `text_align` | — | 垂直(T/M/B) + 水平(L/C/R) 组合 |
| `y_align` | `text` | `y` 的参照：`text` / `baseline` / `font` |
| `expansion` | `normal` | `none` / `normal` / `strftime`(废弃) |
| `fix_bounds` | — | 自动修正坐标避免裁切 |
| `text_shaping` | 1 | 文本整形（RTL、阿拉伯文连字） |

**可用表达式常量（x/y 中）：** `w`/`W`、`h`/`H`、`text_w`/`tw`、`text_h`/`th`、`line_h`/`lh`、`ascent`、`descent`、`n`、`t`、`sar`、`dar`、`pict_type`、`rand(min,max)`。

```bash
# 右下角时间码
-vf "drawtext=fontfile=C\\:/Windows/Fonts/arial.ttf:text='%{pts\\:hms}':fontsize=32:fontcolor=white:box=1:boxcolor=black@0.5:x=W-tw-20:y=H-th-20"

# 顶部居中标题，带描边
-vf "drawtext=textfile=title.txt:fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(W-tw)/2:y=40"

# 帧号
-vf "drawtext=text='Frame %{n}':x=20:y=20:fontsize=28:fontcolor=yellow"

# 用本地时间
-vf "drawtext=text='%{localtime\\:%Y-%m-%d %H\\\\\\:%M\\\\\\:%S}':x=10:y=10:fontsize=24:fontcolor=white"
```

### 7.3 `subtitles` / `ass` —— 烧录字幕

> 📖 **完整字幕处理请见专文**：《FFmpeg 字幕处理完全指南》（`ffmpeg-guide-subtitles.md`）——
> 涵盖字幕格式全景、提取/转换/封装、ASS 样式详解、时间轴同步、图形字幕（PGS/DVD/DVB）、批量脚本等。
> 本节仅列滤镜参数与基础用法。

| 选项 | 说明 |
| --- | --- |
| `filename` / `f` | 字幕文件路径（**必须**） |
| `original_size` | 原视频尺寸（ASS 字体缩放需要） |
| `fontsdir` | 附加字体目录 |
| `alpha` | 处理 alpha 通道 |
| `charenc` | 输入字符编码（非 UTF-8 时需要，仅 `subtitles`） |
| `stream_index` / `si` | 从容器中取第几个字幕流（仅 `subtitles`） |
| `force_style` | 覆盖样式，ASS 格式 `KEY=VALUE` 逗号分隔 |
| `wrap_unicode` | 按 Unicode 换行规则断行 |
| `shaping` | `auto` / `simple` / `complex`（阿拉伯文等复杂脚本需 `complex`） |

```bash
# 烧录外挂 SRT
-vf "subtitles=sub.srt"

# 烧录容器内第 2 条字幕流
-vf "subtitles=movie.mkv:si=1"

# 强制样式（字体、颜色、描边、位置）
-vf "subtitles=sub.ass:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=30'"

# Windows 路径转义
-vf "subtitles=C\\:/subs/movie.srt:fontsdir=C\\:/fonts"

# 与缩放组合（先缩放再烧录，保证字体比例正确）
-vf "scale=1280:720,subtitles=sub.srt:original_size=1920x1080"
```

### 7.4 `drawbox` / `drawgrid`

```bash
# 红色半透明边框
-vf "drawbox=x=10:y=10:w=200:h=100:color=red@0.5:t=4"

# 铺满的矩形（遮挡）
-vf "drawbox=x=0:y=0:w=iw:h=100:color=black:t=fill"

# 网格（每 100 像素）
-vf "drawgrid=w=100:h=100:t=1:c=white@0.5"
```

### 7.5 `delogo` / `removelogo` —— 去台标

```bash
# 用周围像素插值遮盖台标区域
-vf "delogo=x=20:y=20:w=200:h=80"

# 用遮罩图片去除复杂 logo
-vf "removelogo=logo_mask.bmp"
```

---

## 8. 视频：时间与帧率

### 8.1 帧率概念：CFR / VFR 与三种帧率滤镜

**先分清三个概念：**

| 概念 | 含义 |
| --- | --- |
| **CFR**（恒定帧率） | 每帧间隔固定，如 25fps。绝大多数编码器/播放器期望 CFR |
| **VFR**（可变帧率） | 帧间隔不等（屏幕录制、手机拍摄、动画常见）。直接转码可能产生音画不同步 |
| **时间基**（timebase） | 时间戳的单位分数（如 `1/1000`）。帧率与时间基是两件事 |

**三种帧率相关滤镜的区别（关键，最易混淆）：**

| 滤镜 | 行为 | 适用 |
| --- | --- | --- |
| `fps` | **丢帧/复制帧**达到目标 CFR，重写时间戳 | 通用 CFR 转换（**最常用**） |
| `framerate` | 在给定帧率间做**线性插值混合**（blend），不做运动估计 | VFR→CFR 平滑转换、避免丢帧抖动 |
| `minterpolate` | **运动估计插帧**（生成新的中间帧） | 30→60fps 真插帧、慢动作 |

> `-r` 是输出选项（等价于在滤镜图末尾插 `fps`）；`-framerate` 是某些 demuxer 的输入选项（如 `image2`、`v4l2`），**与 `framerate` 滤镜不是一回事**。

### 8.2 `fps` —— 恒定帧率转换（最常用）

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `fps` | 25 | 目标帧率；支持 `source_fps`、`ntsc`(30000/1001)、`pal`(25)、`film`(24)、`ntsc_film`(24000/1001) |
| `start_time` | — | 假定首帧 PTS（用于补齐/裁掉开头；设 0 可给晚开始的流补帧） |
| `round` | `near` | 时间戳取整：`zero`(向 0) `inf`(远离 0) `down`(-∞) `up`(+∞) `near`(最近) |
| `eof_action` | `round` | `round`(同其他帧) / `pass`(时长未到则直通末帧) |

```bash
# 基础：转 30fps
ffmpeg -i in.mp4 -vf "fps=30" -c:v libx264 -crf 20 -c:a copy out.mp4

# 用预定义帧率
ffmpeg -i in.mp4 -vf "fps=film" -c:v libx264 -crf 20 out.mp4      # 24fps
ffmpeg -i in.mp4 -vf "fps=ntsc" -c:v libx264 -crf 20 out.mp4      # 29.97fps
ffmpeg -i in.mp4 -vf "fps=pal" -c:v libx264 -crf 20 out.mp4       # 25fps

# 保持源帧率但强制 CFR（修复 VFR）
ffmpeg -i vfr.mp4 -vf "fps=source_fps" -c:v libx264 -crf 20 -c:a copy cfr.mp4

# VFR 修复：给晚开始的流补帧（start_time=0）
ffmpeg -i vfr.mp4 -vf "fps=30:start_time=0" -c:v libx264 -crf 20 -c:a copy out.mp4

# 降帧率（60→24，用于电影感）
ffmpeg -i in60.mp4 -vf "fps=24" -c:v libx264 -crf 20 -c:a copy out.mp4

# 用 -r 输出选项（等价写法，但作用在滤镜图末尾）
ffmpeg -i in.mp4 -r 30 -c:v libx264 -crf 20 -c:a copy out.mp4
```

### 8.3 `framerate` —— 插值混合帧率转换

`framerate` 用**线性插值混合相邻帧**来生成新帧（不丢帧、不做运动估计），适合 VFR→CFR 平滑化。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `fps` | 50 | 目标帧率 |
| `interp_start` | 15 | 开始线性插值的点（0~255） |
| `interp_end` | 240 | 结束线性插值的点（0~255） |
| `scene` | 8.2 | 场景变化阈值（0~100） |
| `flags` | `scene_change_detect+scd` | 标志 |

```bash
# VFR → CFR 平滑转换（比 fps 更平滑，但有拖影）
ffmpeg -i vfr.mp4 -vf "framerate=fps=30" -c:v libx264 -crf 20 -c:a copy out.mp4

# 混合式升帧（30→60，会产生运动模糊感）
ffmpeg -i in30.mp4 -vf "framerate=fps=60" -c:v libx264 -crf 20 out60.mp4

# 调整插值范围（减少拖影）
ffmpeg -i vfr.mp4 -vf "framerate=fps=30:interp_start=30:interp_end=200" -c:v libx264 -crf 20 out.mp4
```

> **`fps` vs `framerate` 选择**：
> - 需要「帧数不变、时间正确」→ `fps`（丢/复制帧）
> - 需要「画面平滑、可接受轻微拖影」→ `framerate`（插值混合）
> - 需要「真实新帧、无拖影」→ `minterpolate`（运动估计，很慢）

### 8.4 `minterpolate` —— 运动估计插帧

用运动估计生成真实中间帧，用于**升帧**（30→60）或**高质量慢动作**。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `fps` | 60 | 输出帧率 |
| `mi_mode` | `mci` | 运动插值模式：`dup`(0) `blend`(1) `mci`(2) |
| `mc_mode` | `obmc` | 运动补偿模式：`obmc`(0) `aobmc`(1) |
| `me_mode` | `bilat` | 运动估计模式：`bidir`(0) `bilat`(1) |
| `me` | `epzs` | 运动估计算法：`epzs`(1) `esa`(2) `tss`(3) `tdls`(4) `ntss`(5) `fss`(6) `ds`(7) `hexbs`(8) `epzs`(9) |
| `mb_size` | 16 | 宏块大小 4~16 |
| `search_param` | 32 | 搜索范围 |
| `vsbmc` | 0 | 可变大小块运动补偿 |
| `scd` | `fdiff` | 场景变化检测：`none`(0) `fdiff`(1) |
| `scd_threshold` | 10 | 场景变化阈值 |

```bash
# 30fps → 60fps 真插帧（质量优先，很慢）
ffmpeg -i in30.mp4 -vf "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1" \
  -c:v libx264 -crf 20 -c:a copy out60.mp4

# 快速插帧（质量一般）
ffmpeg -i in30.mp4 -vf "minterpolate=fps=60:mi_mode=blend" -c:v libx264 -crf 20 out60.mp4

# 2 倍慢动作（先插帧再变速，得到平滑慢动作）
ffmpeg -i in30.mp4 -vf "minterpolate=fps=60,setpts=2.0*PTS" -c:v libx264 -crf 20 -an slow.mp4

# 高质量慢动作（插帧 + 变速 + 音频降速）
ffmpeg -i in.mp4 -filter_complex "\
[0:v]minterpolate=fps=120:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,setpts=4.0*PTS[v];\
[0:a]atempo=0.5,atempo=0.5[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out_slow4x.mp4
```

> **性能警告**：`minterpolate` 是 CPU 密集的，1080p 通常只有实时速度的 0.1~1 倍。建议先用 `-ss`/`-t` 截取短片段测试。

### 8.5 `framestep` / `select` —— 抽帧

```bash
# 每 5 帧取 1 帧（5 倍抽帧，时间戳不变）
ffmpeg -i in.mp4 -vf "framestep=5" -c:v libx264 -crf 20 out.mp4

# 每 5 帧取 1 帧并修正时间戳（变成正常速度播放）
ffmpeg -i in.mp4 -vf "select='not(mod(n,5))',setpts=N/FRAME_RATE/TB" -c:v libx264 -crf 20 -an out.mp4

# 每秒取 1 帧做缩略图序列
ffmpeg -i in.mp4 -vf "fps=1" -c:v libx264 -crf 25 thumbs_%04d.jpg
```

### 8.6 `trim` / `atrim` —— 裁剪片段

| 选项 | 说明 |
| --- | --- |
| `start` / `end` | 起止时间（秒），`end` 是第一个被丢弃的帧 |
| `start_pts` / `end_pts` | 以时间基为单位 |
| `duration` | 最大时长 |
| `start_frame` / `end_frame` | 按帧序号 |

> `trim` **不修改时间戳**，若希望输出从 0 开始，后面要接 `setpts=PTS-STARTPTS`。

```bash
# 保留第 2 分钟
-vf "trim=60:120,setpts=PTS-STARTPTS"

# 保留前 5 秒
-vf "trim=duration=5,setpts=PTS-STARTPTS"

# 音视频同步裁剪
-filter_complex "[0:v]trim=10:20,setpts=PTS-STARTPTS[v];[0:a]atrim=10:20,asetpts=PTS-STARTPTS[a]" -map "[v]" -map "[a]"
```

### 8.7 `setpts` / `asetpts` —— 时间戳重写

| 常量 | 含义 |
| --- | --- |
| `PTS` | 输入时间戳 |
| `STARTPTS` | 首帧时间戳 |
| `N` | 帧序号（音频为已消费样本数） |
| `T` | 当前帧时间（秒） |
| `TB` | 时间基 |
| `FRAME_RATE` / `FR` | 帧率（仅 CFR） |
| `SAMPLE_RATE` / `SR` | 采样率（音频） |
| `NB_SAMPLES` / `S` | 当前帧样本数（音频） |
| `PREV_INPTS` / `PREV_OUTPTS` | 上一输入/输出 PTS |
| `INTERLACED` | 是否隔行 |

```bash
-vf "setpts=PTS-STARTPTS"            # 归零
-vf "setpts=0.5*PTS"                 # 2 倍速（画面）
-vf "setpts=2.0*PTS"                 # 0.5 倍速
-vf "setpts=PTS/1.25"                # 1.25 倍速
-af "asetpts=PTS-STARTPTS"
-vf "setpts=N/30/TB"                 # 强制按 30fps 重排时间戳
```

> 变速时音频要用 `atempo`（见 §14.3），`setpts` 只改视频。

### 8.8 变速（speed change）完整方案

变速 = **视频改时间戳**（`setpts`）+ **音频改速度**（`atempo`）。两者必须配合，否则音画不同步。

**变速系数对照表：**

| 目标 | 视频 `setpts` | 音频 `atempo` | 时长变化 |
| --- | --- | --- | --- |
| 2 倍速 | `0.5*PTS` 或 `PTS/2` | `2.0` | 减半 |
| 4 倍速 | `0.25*PTS` | `2.0,atempo=2.0`（串联） | 1/4 |
| 1.5 倍速 | `PTS/1.5` | `1.5` | 缩短 1/3 |
| 1.25 倍速 | `PTS/1.25` | `1.25` | 缩短 1/5 |
| 0.5 倍慢速 | `2.0*PTS` | `0.5` | 加倍 |
| 0.25 倍慢速 | `4.0*PTS` | `0.5,atempo=0.5` | 4 倍 |

> `atempo` 单次范围 **0.5~100**，超出需串联多个。

```bash
# 2 倍速（音视频同步）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out_2x.mp4

# 4 倍速（atempo 串联）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=0.25*PTS[v];[0:a]atempo=2.0,atempo=2.0[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out_4x.mp4

# 1.25 倍速
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=PTS/1.25[v];[0:a]atempo=1.25[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out_1.25x.mp4

# 0.5 倍慢动作（音视频同步）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=2.0*PTS[v];[0:a]atempo=0.5[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out_slow.mp4

# 纯视频变速（保留原音频，会产生不同步，慎用）
ffmpeg -i in.mp4 -vf "setpts=0.5*PTS" -c:v libx264 -crf 20 -an out_videoonly.mp4

# 变速且改变音调（asetrate 会变调，类似磁带快进）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]asetrate=44100*2,aresample=44100[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out_chipmunk.mp4

# 高质量变速保持音调（rubberband，需 lib 支持）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=PTS/1.5[v];[0:a]rubberband=tempo=1.5[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac out.mp4
```

### 8.9 延时摄影与定格动画

```bash
# 延时摄影：抽帧 + 压缩时间（1 秒 1 帧 → 30fps 播放，即 30 倍速）
ffmpeg -i timelapse.mp4 -vf "fps=1,setpts=N/30/TB" -c:v libx264 -crf 20 -an out.mp4

# 延时摄影：每隔 N 秒取一帧
ffmpeg -i in.mp4 -vf "select='not(mod(n,30))',setpts=N/FRAME_RATE/TB" -c:v libx264 -crf 20 -an out.mp4

# 图片序列 → 延时视频（每张图 1 帧，30fps 播放）
ffmpeg -framerate 30 -i img_%04d.jpg -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4

# 图片序列 → 每张图持续 2 秒
ffmpeg -framerate 1/2 -i img_%04d.jpg -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4

# 视频 → 定格动画（每 0.5 秒取 1 帧，每帧持续 0.5 秒）
ffmpeg -i in.mp4 -vf "fps=2,setpts=N/2/TB" -c:v libx264 -crf 20 -an out.mp4

# 生成延时视频并加音轨
ffmpeg -i timelapse.mp4 -i bgm.mp3 -filter_complex "\
[0:v]fps=1,setpts=N/30/TB[v];\
[1:a]atrim=0:60,asetpts=PTS-STARTPTS[a]" \
  -map "[v]" -map "[a]" -shortest -c:v libx264 -crf 20 -c:a aac out.mp4
```

### 8.10 音视频同步与时间戳修复

```bash
# 音频延迟 500ms（音频慢于视频时）
ffmpeg -i in.mp4 -af "adelay=500|500" -c:v copy -c:a aac out.mp4

# 音频提前 500ms（用正数 itsoffset 延迟视频）
ffmpeg -itsoffset 0.5 -i in.mp4 -c:v copy -c:a copy out.mp4

# 用 aresample 动态补偿（持续微调，适合长时间素材）
ffmpeg -i in.mp4 -af "aresample=async=1000" -c:v copy -c:a aac out.mp4

# 重置所有时间戳为 0 起点
ffmpeg -i in.mp4 -vf "setpts=PTS-STARTPTS" -af "asetpts=PTS-STARTPTS" \
  -c:v libx264 -crf 20 -c:a aac out.mp4

# 修复 VFR 素材的音画不同步（先转 CFR 再对齐）
ffmpeg -i vfr.mp4 -vf "fps=30,setpts=PTS-STARTPTS" -af "aresample=async=1:first_pts=0" \
  -c:v libx264 -crf 20 -c:a aac out.mp4

# 强制输出 CFR（解决 VFR 播放问题）
ffmpeg -i vfr.mp4 -vf "fps=30" -fps_mode cfr -c:v libx264 -crf 20 -c:a copy out.mp4
```

### 8.11 `select` / `aselect` —— 按条件选帧

```bash
# 只保留偶数帧
-vf "select='not(mod(n,2))',setpts=N/FRAME_RATE/TB"

# 只保留关键帧
-vf "select='eq(pict_type,I)',setpts=N/FRAME_RATE/TB"

# 每 30 帧取 1 帧（做缩略图序列）
-vf "select='not(mod(n,30))'"

# 按时间区间
-vf "select='between(t,10,20)',setpts=N/FRAME_RATE/TB"
```

### 8.12 `mpdecimate` / `decimate` —— 去重复帧

```bash
# 丢弃视觉重复帧（修复录制产生的重复帧）
-vf "mpdecimate=hi=64*12:lo=64*5:frac=0.33,setpts=N/FRAME_RATE/TB"

# 按周期丢弃（如 5 帧丢 1 帧，用于 30→24 近似）
-vf "decimate=cycle=5"
```

### 8.13 `reverse` —— 倒放

```bash
# 视频倒放（需缓存整段，务必先 trim）
-filter_complex "[0:v]trim=0:5,setpts=PTS-STARTPTS,reverse[v];[0:a]atrim=0:5,asetpts=PTS-STARTPTS,areverse[a]" -map "[v]" -map "[a]"
```

---

## 9. 视频：颜色、格式与色彩空间

### 9.1 `format` / `noformat` —— 像素格式

```bash
-vf "format=yuv420p"          # 最兼容的 8bit 格式
-vf "format=yuv420p10le"      # 10bit
-vf "format=rgb24"            # RGB
-vf "format=rgba"             # 带 alpha
```

### 9.2 `eq` —— 亮度/对比度/饱和度/伽马

| 选项 | 默认 | 范围 |
| --- | --- | --- |
| `contrast` | 1.0 | -1000~1000 |
| `brightness` | 0.0 | -1~1 |
| `saturation` | 1.0 | 0~3 |
| `gamma` | 1.0 | 0.1~10 |
| `gamma_r` / `gamma_g` / `gamma_b` | 1.0 | 分通道伽马 |
| `gamma_weight` | 1.0 | 防止高亮裁切 |

```bash
-vf "eq=contrast=1.1:brightness=0.02:saturation=1.2:gamma=0.95"
```

### 9.3 `curves` —— 曲线调色

```bash
-vf "curves=preset=vintage"
-vf "curves=preset=cross_process"
-vf "curves=all='0/0 0.5/0.58 1/1'"        # 提亮中间调
-vf "curves=r='0/0 0.5/0.6 1/1':b='0/0.05 0.5/0.5 1/0.95'"   # 暖调
```

> 可用 preset：`none` `color_negative` `cross_process` `darker` `increase_contrast` `lighter` `linear_contrast` `medium_contrast` `negative` `strong_contrast` `vintage`。

### 9.4 `hue` —— 色相/饱和度

```bash
-vf "hue=h=90"                        # 色相旋转 90°
-vf "hue=s=0"                         # 去色（黑白）
-vf "hue=h=30:s=1.2"                  # 偏暖 + 加饱和
-vf "hue=h=t*20"                      # 色相随时间旋转
```

### 9.5 `colorbalance` / `colorchannelmixer` / `colorlevels`

```bash
# 阴影偏蓝、高光偏暖
-vf "colorbalance=rs=-0.1:bs=0.1:rh=0.05:bh=-0.05"

# 通道混合（复古）
-vf "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131"

# 色阶（黑点/白点/伽马）
-vf "colorlevels=rimin=0.05:rimax=0.95:gimin=0.05:gimax=0.95:bimin=0.05:bimax=0.95"
```

### 9.6 `colorspace` / `colormatrix` / `zscale` —— 色彩空间转换

```bash
# 将 BT.601 转为 BT.709
-vf "colorspace=all=bt709:iall=bt601-6-625:fast=1"
-vf "colormatrix=bt601:bt709"
```

### 9.7 `tonemap` —— HDR 色调映射

`tonemap` 需要单精度浮点输入，必须先用 `zscale` 线性化：

| 算法 | 特点 |
| --- | --- |
| `none` | 不做色调映射，只对过亮像素去饱和 |
| `clip` | 硬裁剪，范围内色彩最准 |
| `linear` | 线性拉伸到显示色域 |
| `gamma` | 对数转移曲线 |
| `reinhard` | 保亮度，细节变平 |
| `hable` | **细节保留最好**（略暗） |
| `mobius` | 平滑映射，色彩准确与细节折中 |

```bash
# 方式一：tonemap + format（不依赖 zscale 的线性光支持，兼容性最好）
-vf "format=gbrpf32le,tonemap=tonemap=hable:desat=0,format=yuv420p"

# 方式二：zscale 经典链路（构建支持 zscale=t=linear 时色彩精度最佳）
-vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"

# 用 mobius 保留更多色彩
-vf "format=gbrpf32le,tonemap=tonemap=mobius:param=0.3,format=yuv420p"
```

> `tonemap` 要求**单精度浮点输入**。`format=gbrpf32le` 可直接满足该要求；
> 若用 zscale 链路，`zscale=t=linear` 负责线性化（见 §6.4 的兼容性提示）。

### 9.8 `libplacebo` —— 高质量 GPU 色调映射

```bash
-vf "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p"
```

---

## 10. 视频：降噪、去隔行与修复

### 10.1 去隔行

| 滤镜 | 说明 |
| --- | --- |
| `yadif` | 通用去隔行，`mode=0/1`（帧/场）、`parity=-1/0/1`、`deint=0/1` |
| `bwdif` | 更好的质量（Bob Weaver），参数同 `yadif` |
| `w3fdif` | 加权 3 场去隔行，`filter=simple/complex` |
| `nnedi` | 神经网络去隔行（慢，质量高） |
| `fieldmatch` | 场匹配（用于 IVTC） |
| `pullup` / `detelecine` | 反电视电影（24→30 还原） |
| `tinterlace` | 交错/去交错模式转换 |

```bash
-vf "yadif=mode=1:parity=-1:deint=0"     # 输出逐行
-vf "bwdif=mode=0:parity=-1:deint=1"
-vf "fieldmatch,decimate"                # IVTC 组合
```

### 10.2 降噪

| 滤镜 | 说明 |
| --- | --- |
| `hqdn3d` | 快速高质量 3D 降噪（时间+空间），参数 `luma_spatial:chroma_spatial:luma_tmp:chroma_tmp` |
| `nlmeans` | 非局部均值，质量高但很慢 |
| `atadenoise` | 自适应时域平均降噪 |
| `fftdnoiz` | 频域降噪 |
| `bm3d` | BM3D 降噪（很慢，很好） |
| `removegrain` | 空间降噪（多种模式） |
| `vaguedenoiser` | 小波降噪 |
| `smartblur` | 智能模糊（保边） |
| `deband` | 去色带（渐变区域） |
| `gradfun` | 去色带 |

```bash
-vf "hqdn3d=4:3:6:4.5"                    # 轻量降噪
-vf "hqdn3d=1.5:1.5:6:6"                  # 偏保守
-vf "nlmeans=s=3.0:p=7:r=15"              # 高质量（慢）
-vf "deband=1thr=0.02:2thr=0.02:3thr=0.02:4thr=0.02:range=16"   # 去色带
-vf "atadenoise=s=9:p=7"
```

### 10.3 锐化

```bash
-vf "unsharp=5:5:1.0:5:5:0.0"             # 亮度锐化，色度不锐化
-vf "unsharp=luma_msize_x=7:luma_msize_y=7:luma_amount=1.5"
-vf "cas=strength=0.5"                    # 对比度自适应锐化（AMD FidelityFX）
```

### 10.4 去抖与稳定

```bash
# 两遍法：先分析，再稳定
ffmpeg -i in.mp4 -vf "vidstabdetect=shakiness=10:accuracy=15:result=transforms.trf" -f null -
ffmpeg -i in.mp4 -vf "vidstabtransform=input=transforms.trf:smoothing=30:zoom=5,unsharp=5:5:0.8:3:3:0.4" -c:a copy out.mp4
```

### 10.5 质量评估滤镜

| 滤镜 | 说明 |
| --- | --- |
| `psnr` | 峰值信噪比，`stats_file` 输出逐帧数据 |
| `ssim` | 结构相似度 |
| `libvmaf` | Netflix VMAF，`model`、`log_path`、`log_fmt`、`n_threads`、`n_subsample` |
| `xpsnr` | 加权 PSNR |
| `vif` | 视觉信息保真度 |
| `signalstats` | 信号统计（YUV 范围、色度等） |
| `blackdetect` / `freezedetect` | 黑场/冻结检测 |
| `scdet` | 场景切换检测 |
| `blackframe` | 黑帧检测 |
| `blockdetect` / `blurdetect` | 块效应/模糊检测 |

```bash
# 对齐时间戳后测 PSNR
ffmpeg -i distorted.mp4 -i reference.mp4 -lavfi "[0:v]settb=AVTB,setpts=PTS-STARTPTS[main];[1:v]settb=AVTB,setpts=PTS-STARTPTS[ref];[main][ref]psnr=stats_file=psnr.log" -f null -

# 检测黑场
-vf "blackdetect=d=0.5:pix_th=0.10"

# 检测冻结
-vf "freezedetect=n=-60dB:d=2"

# 场景切换时间点
-vf "scdet=threshold=10" -f null -
```

---

## 11. 视频：转场、拼接与多画面

### 11.1 `concat` 滤镜 —— 滤镜级拼接

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `n` | 2 | 段数 |
| `v` | 1 | 每段视频流数（=输出视频流数） |
| `a` | 0 | 每段音频流数 |
| `unsafe` | 0 | 格式不一致时不报错 |

> **要求**：所有段的时间戳都从 0 开始；分辨率不同必须先 `scale` 统一；帧率不同会产生 VFR 输出。

```bash
# 拼接 3 段（各含 1 视频 + 2 音频）
ffmpeg -i opening.mkv -i episode.mkv -i ending.mkv -filter_complex \
  "[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" out.mkv

# 先统一分辨率再拼接
ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
  "[0:v]scale=1280:720,setsar=1[v0];[1:v]scale=1280:720,setsar=1[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]" \
  -map "[v]" -map "[a]" out.mp4
```

> **替代方案**：如果所有段编码参数完全一致，直接用 concat demuxer 更快且无重编码：
> ```bash
> printf "file '%s'\n" *.mp4 > list.txt
> ffmpeg -f concat -safe 0 -i list.txt -c copy out.mp4
> ```

### 11.2 `xfade` —— 交叉转场

| 选项 | 说明 |
| --- | --- |
| `transition` | 转场类型（见下表） |
| `duration` / `d` | 转场时长 |
| `offset` | 转场开始时间（相对第一个输入） |

> **要求**：两个输入必须 CFR、分辨率/像素格式/帧率/时间基一致。

**常用转场类型：** `fade`、`fadeblack`、`fadewhite`、`fadegrays`、`wipeleft/right/up/down`、`slideleft/right/up/down`、`smoothleft/right/up/down`、`circleopen`、`circleclose`、`circlecrop`、`rectcrop`、`radial`、`dissolve`、`pixelize`、`diagtl/tr/bl/br`、`hlslice`、`vuslice`、`squeezeh`、`squeezev`、`hblur`、`distance`、`vertopen/close`、`horzopen/close`、`custom`。

```bash
# 两段各 10 秒，在 9 秒处开始 1 秒淡入淡出
ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
  "[0:v][1:v]xfade=transition=fade:duration=1:offset=9[v]" -map "[v]" out.mp4

# 带音频交叉淡化
ffmpeg -i a.mp4 -i b.mp4 -filter_complex \
  "[0:v][1:v]xfade=transition=wipeleft:duration=1:offset=9[v];[0:a][1:a]acrossfade=d=1[a]" \
  -map "[v]" -map "[a]" out.mp4
```

### 11.3 `hstack` / `vstack` —— 简单堆叠

```bash
# 左右并排（要求同高）
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][1:v]hstack=inputs=2[out]" -map "[out]" out.mp4

# 上下堆叠（要求同宽）
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v][1:v]vstack=inputs=2[out]" -map "[out]" out.mp4

# 先统一高度再并排
ffmpeg -i a.mp4 -i b.mp4 -filter_complex "[0:v]scale=-2:720[l];[1:v]scale=-2:720[r];[l][r]hstack[out]" -map "[out]" out.mp4
```

### 11.4 `xstack` —— 自定义布局多画面

| 选项 | 说明 |
| --- | --- |
| `inputs` | 输入数 |
| `layout` | 每个输入的位置 `列_行`，用 `\|` 分隔；可用 `w0`/`h0` 表示某输入的宽/高，支持 `+` 累加 |
| `grid` | 固定网格 `列x行`（与 `layout` 互斥） |
| `fill` | 未使用像素的填充色 |

```bash
# 2x2 四画面
ffmpeg -i a.mp4 -i b.mp4 -i c.mp4 -i d.mp4 -filter_complex \
  "[0:v][1:v][2:v][3:v]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[out]" -map "[out]" out.mp4

# 主画面 + 右侧三个小画面
ffmpeg -i main.mp4 -i p1.mp4 -i p2.mp4 -i p3.mp4 -filter_complex \
  "[1:v]scale=480:270[s1];[2:v]scale=480:270[s2];[3:v]scale=480:270[s3];\
   [0:v]scale=1440:810[m];[m][s1][s2][s3]xstack=inputs=4:layout=0_0|w0_0|w0_h0|w0_h0+h1[out]" \
  -map "[out]" out.mp4

# 3x3 九画面
-vf 不可用，需 -filter_complex，layout=0_0|0_h0|0_h0+h1|w0_0|w0_h0|w0_h0+h1|w0+w3_0|w0+w3_h0|w0+w3_h0+h1
```

### 11.5 `split` / `asplit` —— 分流

```bash
# 一路输入分两路，一路正常一路去色后叠加
-filter_complex "[0:v]split=2[main][tmp];[tmp]hue=s=0[gray];[main][gray]overlay=W-w:0[out]"
```

### 11.6 `tile` —— 拼图（缩略图网格）

```bash
# 生成 4x4 缩略图网格
-vf "select='not(mod(n,100))',scale=320:180,tile=4x4"
```

### 11.7 `thumbnail` —— 选代表帧

```bash
# 从每 100 帧中选最有代表性的一帧
-vf "thumbnail=100,scale=320:180"
```

---

## 12. 音频：重采样与声道

### 12.1 音频基础参数速查

| 参数 | 说明 | 常用值 |
| --- | --- | --- |
| 采样率 | 每秒采样点数 | 8000（电话）、22050、32000、44100（CD）、48000（视频标准）、96000、192000 |
| 位深 | 每样本比特数 | 16（CD）、24（专业）、32（浮点） |
| 声道布局 | 声道数与排布 | `mono` `stereo` `2.1` `5.1` `7.1` |
| 样本格式 | 数据排列 | `u8` `s16` `s16p` `s32` `flt` `fltp` `dbl` |

**为什么视频一律用 48000 Hz？**
视频（H.264/HEVC/AAC）的时间基与 48kHz 高度兼容（48000 可被 24/25/30/50/60 整除），而 44100 会导致部分帧的音频样本数不整，产生累积漂移。**跨格式转码时统一到 48000 是最稳的做法。**

```bash
# 统一到 48kHz 立体声（视频转码标准做法）
ffmpeg -i in.mp4 -c:v copy -c:a aac -ar 48000 -ac 2 -b:a 160k out.mp4

# 检查源音频参数
ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate,channels,channel_layout,codec_name -of default=nw=1 in.mp4
```

### 12.2 `aresample` —— 重采样（完整参数）

语法：`aresample=[sample_rate:]resampler_options`

**核心选项（来自 `ffmpeg-resampler.md`）：**

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `osr` / `out_sample_rate` | 0 | 输出采样率 |
| `isr` / `in_sample_rate` | 0 | 输入采样率 |
| `osf` / `out_sample_fmt` | none | 输出样本格式 |
| `isf` / `in_sample_fmt` | none | 输入样本格式 |
| `tsf` / `internal_sample_fmt` | none | 内部样本格式 |
| `ochl` / `out_chlayout` | — | 输出声道布局 |
| `ichl` / `in_chlayout` | — | 输入声道布局 |
| `clev` / `center_mix_level` | — | 中置混音电平（dB，-32~32） |
| `slev` / `surround_mix_level` | — | 环绕混音电平（dB，-32~32） |
| `lfe_mix_level` | — | LFE 混入非 LFE 电平（dB） |
| `rmvol` / `rematrix_volume` | 1.0 | 重矩阵音量 |
| `resampler` | `swr` | 重采样引擎：`swr`(内置) / `soxr`(SoX，质量更高) |
| `precision` | 20 | **仅 soxr**：精度位数（20=High Quality，28=Very High Quality） |
| `cheby` | 0 | **仅 soxr**：通带滚降（Chebyshev） |
| `cutoff` | 0.97(swr)/0.91(soxr) | 截止频率比（0~1） |
| `filter_size` | 32 | **仅 swr**：重采样滤波器大小 |
| `phase_shift` | 10 | **仅 swr**：相位偏移（0~30） |
| `linear_interp` | 1 | 线性插值（关掉可提速） |
| `exact_rational` | 1 | 使用精确相位计数 |
| `dither_method` | 0 | 抖动方法（见下表） |
| `dither_scale` | 1 | 抖动缩放 |
| `filter_type` | — | **仅 swr**：`cubic` / `blackman_nuttall` / `kaiser` |
| `kaiser_beta` | 9 | **仅 swr**：Kaiser 窗 beta（2~16） |
| `output_sample_bits` | 0 | 抖动用的输出位深 |
| `matrix_encoding` | none | 矩阵立体声编码：`none` / `dolby` / `dplii` |
| `async` | 0 | **仅 swr**：按时间戳拉伸/压缩（见下） |
| `first_pts` | — | **仅 swr**：假定首帧 PTS |
| `min_comp` | FLT_MAX | 触发补偿的最小时间差（秒） |
| `min_hard_comp` | 0.1 | 硬补偿（增删样本）阈值 |
| `comp_duration` | 1.0 | 补偿持续时间（秒） |
| `max_soft_comp` | 0 | 最大软补偿比例 |

**抖动方法（`dither_method`）：**

| 取值 | 说明 |
| --- | --- |
| `rectangular` | 矩形抖动 |
| `triangular` | 三角抖动 |
| `triangular_hp` | 高通三角抖动 |
| `lipshitz` | Lipshitz 噪声整形 |
| `shibata` | Shibata 噪声整形 |
| `low_shibata` / `high_shibata` | 低/高 Shibata |
| `f_weighted` | F 加权噪声整形 |
| `modified_e_weighted` / `improved_e_weighted` | 改进 E 加权 |

```bash
# 基础重采样
ffmpeg -i in.mp4 -af "aresample=48000" -c:v copy out.mp4

# 高质量重采样（SoX 引擎，Very High Quality）
ffmpeg -i in.flac -af "aresample=48000:resampler=soxr:precision=28" -c:a pcm_s24le out.wav

# 降采样到 44.1kHz 并加三角抖动（避免量化噪声）
ffmpeg -i in48.wav -af "aresample=44100:dither_method=triangular_hp:output_sample_bits=16" -c:a pcm_s16le out.wav

# 音视频同步补偿（最多 1000 样本/秒的拉伸）
ffmpeg -i in.mp4 -af "aresample=async=1000" -c:v copy -c:a aac out.mp4

# 硬补偿模式（增删样本，适合长时间素材漂移）
ffmpeg -i in.mp4 -af "aresample=async=1000:min_hard_comp=0.05:comp_duration=0.5" -c:v copy -c:a aac out.mp4

# 给晚开始的音频补静音
ffmpeg -i in.mp4 -af "aresample=first_pts=0" -c:v copy -c:a aac out.mp4

# 5.1 → 立体声（指定混音电平）
ffmpeg -i in51.mkv -af "aresample=ochl=stereo:clev=3:slev=3" -c:v copy out.mp4
```

> `-ar` 是全局选项，通常比滤镜写法更简单；`aresample` 的优势在于能处理 `async` 同步与精细抖动控制。

### 12.3 `aformat` —— 音频格式约束

`aformat` 不做转换，只**声明**期望的格式，让滤镜图自动插入转换。

```bash
# 约束为 48kHz 立体声浮点
-af "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"

# 约束为 5.1
-af "aformat=channel_layouts=5.1"

# 在滤镜链中间统一格式（避免后续滤镜格式不匹配）
-filter_complex "[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a];[a]loudnorm=I=-16[a2]"
```

### 12.4 `pan` —— 声道重映射（功能最强）

`pan` 用表达式精确控制每个输出声道由哪些输入声道混合而成。

**语法：** `pan=<输出布局>|<c0=表达式>|<c1=表达式>|...`

**可用声道名（取决于输入布局）：** `c0` `c1`...（按索引）、`FL` `FR` `FC` `LFE` `BL` `BR` `SL` `SR`、单声道 `c0`。

```bash
# 立体声 → 单声道（等功率下混）
-af "pan=mono|c0=0.5*FL+0.5*FR"

# 单声道 → 立体声（复制）
-af "pan=stereo|c0=c0|c1=c0"

# 左右互换
-af "pan=stereo|c0=c1|c1=c0"

# 只保留左声道（输出双声道）
-af "pan=stereo|c0=c0|c1=c0"

# 5.1 → 立体声（标准下混，含中置与环绕）
-af "pan=stereo|c0=FL+0.707*FC+0.707*BL|c1=FR+0.707*FC+0.707*BR"

# 5.1 → 立体声（含 LFE）
-af "pan=stereo|c0=FL+0.707*FC+0.707*BL+0.5*LFE|c1=FR+0.707*FC+0.707*BR+0.5*LFE"

# 立体声 → 5.1（中置与环绕为 0，仅复制左右）
-af "pan=5.1|FL=FL|FR=FR|FC=0|LFE=0|BL=0|BR=0"

# 音量归一化下混（防止削波）
-af "pan=stereo|c0=0.5*FL+0.5*FR|c1=0.5*FR+0.5*FL"

# 用 gain 控制各声道增益
-af "pan=stereo|c0=0.8*FL|c1=0.8*FR"
```

### 12.5 `channelmap` / `channelsplit` / `amerge` / `join`

| 滤镜 | 用途 | 关键选项 |
| --- | --- | --- |
| `channelmap` | 按索引重排/选择声道 | `map`（输入声道号列表）、`channel_layout` |
| `channelsplit` | 一个多声道流 → 多个单声道流 | `channel_layout`、`channels` |
| `amerge` | 多个流 → 一个多声道流 | `inputs`、`layout_mode` |
| `join` | 多个流 → 按指定布局合并 | `inputs`、`channel_layout`、`map` |

```bash
# channelmap：按索引重排（取第 0、2、1 声道）
ffmpeg -i in.mp4 -af "channelmap=0|2|1" -c:v copy out.mp4

# channelmap：从 5.1 中提取左右声道
ffmpeg -i in51.mkv -af "channelmap=0|1:channel_layout=5.1" -c:v copy out.mkv

# channelsplit：拆成立体声左右两路
ffmpeg -i in.mp4 -filter_complex "[0:a]channelsplit=channel_layout=stereo[L][R]" \
  -map "[L]" left.wav -map "[R]" right.wav

# amerge：两个单声道合并为立体声
ffmpeg -i left.wav -i right.wav -filter_complex "[0:a][1:a]amerge=inputs=2[a]" \
  -map "[a]" -c:a pcm_s16le stereo.wav

# join：按指定布局精确合并
ffmpeg -i left.wav -i right.wav -filter_complex \
  "[0:a][1:a]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[a]" \
  -map "[a]" -c:a pcm_s16le out.wav
```

### 12.6 `volume` + `volumedetect` —— 音量与电平检测

**`volume` 选项：**

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `volume` | 1.0 | 音量表达式（支持 `t`、`n`、`nb_channels` 等） |
| `precision` | `float` | `fixed` / `float` / `double` |
| `eval` | `once` | `once` / `frame` |
| `replaygain` | `drop` | `drop`/`ignore`/`track`/`album` |
| `replaygain_preamp` | 0.0 | 预放大（dB） |
| `replaygain_noclip` | 1 | 防削波 |

```bash
# 检测峰值与平均电平
ffmpeg -i in.mp4 -af "volumedetect" -f null -
# 输出：mean_volume / max_volume（dB）

# 固定增益
-af "volume=0.5"          # 减半
-af "volume=1.5"          # 提升 50%
-af "volume=6dB"          # 提升 6dB
-af "volume=-3dB"
-af "volume='if(lt(t,5),1,0.3)':eval=frame"    # 5 秒后降到 30%
```

---

## 13. 音频：音量、动态与均衡

### 13.1 `equalizer` / `bass` / `treble` —— 均衡

**`equalizer` 选项：**

| 选项 | 说明 |
| --- | --- |
| `frequency` / `f` | 中心频率（Hz） |
| `width_type` / `t` | 带宽类型：`h`(Hz) `q`(Q值) `o`(倍频程) `s`(斜率) `k`(kHz) |
| `width` / `w` | 带宽值 |
| `gain` / `g` | 增益（dB） |
| `mix` / `m` | 滤波信号混合比（0~1，默认 1） |
| `channels` / `c` | 作用的声道 |
| `normalize` / `n` | 归一化 biquad 系数 |
| `transform` / `a` | IIR 变换类型：`di` `dii` `tdi` `tdii` `latt` `svf` `zdf` |
| `precision` / `r` | 精度：`auto` `s16` `s32` `f32` `f64` |

```bash
# 降低 1kHz 附近（去齿音/中频）
-af "equalizer=f=1000:t=q:w=1:g=-6"

# 提升低频
-af "equalizer=f=100:t=h:w=200:g=4"

# bass / treble 简写
-af "bass=g=6:f=100:w=0.5"
-af "treble=g=-4:f=8000:w=0.5"

# 多段 EQ 串联
-af "equalizer=f=100:g=3,equalizer=f=1000:g=-2,equalizer=f=8000:g=2"
```

### 13.2 高通 / 低通 / 带通

```bash
-af "highpass=f=80"                       # 去低频隆隆声
-af "lowpass=f=12000"                     # 去高频嘶声
-af "bandpass=f=1000:width_type=h:width=200"
-af "bandreject=f=50:width_type=h:width=10"   # 去 50Hz 工频
```

### 13.3 `acompressor` / `sidechaincompress` / `alimiter` —— 动态处理

**`acompressor` 完整参数（本机实测）：**

| 参数 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `level_in` | 1 | 0.015625~64 | 输入增益 |
| `mode` | `downward` | 0/1 | `downward`(向下压缩) / `upward`(向上压缩) |
| `threshold` | 0.125 | 0.000976563~1 | 阈值（线性，≈ -18dB） |
| `ratio` | 2 | 1~20 | 压缩比 |
| `attack` | 20 | 0.01~2000 | 启动时间（毫秒） |
| `release` | 250 | 0.01~9000 | 释放时间（毫秒） |
| `makeup` | 1 | 1~64 | 补偿增益 |
| `knee` | 2.82843 | 1~8 | 拐点（越大约平缓） |
| `link` | `average` | 0/1 | 声道联动：`average` / `maximum` |
| `detection` | `rms` | 0/1 | 检测方式：`peak` / `rms` |
| `level_sc` | 1 | 0.015625~64 | 侧链增益 |
| `mix` | 1 | 0~1 | 干湿比 |

**阈值换算参考（线性值 → dB）：** 0.125≈-18dB、0.089≈-21dB、0.05≈-26dB、0.25≈-12dB

```bash
# 语音播客压缩（温和）
ffmpeg -i in.wav -af "acompressor=threshold=0.089:ratio=3:attack=20:release=250:makeup=2:knee=2.83" out.wav

# 强压缩（把动态压平，适合手机外放）
ffmpeg -i in.wav -af "acompressor=threshold=0.05:ratio=9:attack=10:release=200:makeup=4:detection=peak" out.wav

# 侧链压缩（背景音乐随人声降低，做「说话时音乐变小」）
ffmpeg -i voice.wav -i music.wav -filter_complex "\
[1:a]asplit=2[sc][mix];\
[0:a][sc]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=500[ducked];\
[ducked][mix]amix=inputs=2:duration=first:weights='1 0.6'[a]" \
  -map "[a]" -c:a aac out.m4a

# 向上压缩（提升安静部分，让小声内容可听清）
ffmpeg -i in.wav -af "acompressor=mode=upward:threshold=0.3:ratio=3:makeup=1" out.wav
```

**`alimiter` 完整参数：**

| 参数 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `level_in` | 1 | 0.015625~64 | 输入电平 |
| `level_out` | 1 | 0.015625~64 | 输出电平 |
| `limit` | 1 | 0.0625~1 | 限幅阈值 |
| `attack` | 5 | 0.1~80 | 启动时间（毫秒） |
| `release` | 50 | 1~8000 | 释放时间（毫秒） |
| `asc` | false | — | 自动电平补偿 |
| `asc_level` | 0.5 | 0~1 | ASC 电平 |
| `level` | true | — | 自动电平 |
| `latency` | false | — | 补偿延迟 |

```bash
# 标准限幅（防削波，常用于最终输出前）
ffmpeg -i in.wav -af "alimiter=limit=0.95:attack=5:release=50" out.wav

# 广播级限幅（-1dBFS 上限）
ffmpeg -i in.wav -af "alimiter=limit=0.891:level=disabled" out.wav

# 完整母带链：EQ → 压缩 → 限幅
ffmpeg -i in.wav -af "\
equalizer=f=100:g=2,\
equalizer=f=3000:g=-2,\
acompressor=threshold=0.1:ratio=3:attack=20:release=250:makeup=2,\
alimiter=limit=0.95" out.wav
```

### 13.4 `dynaudnorm` / `speechnorm` —— 归一化与修复

**`dynaudnorm` 完整参数：**

| 参数 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `framelen` / `f` | 500 | 10~8000 | 帧长（毫秒） |
| `gausssize` / `g` | 31 | 3~301 | 高斯滤波窗口 |
| `peak` / `p` | 0.95 | 0~1 | 目标峰值 |
| `maxgain` / `m` | 10 | 1~100 | 最大放大倍数 |
| `targetrms` / `r` | 0 | 0~1 | 目标 RMS（0=用峰值） |
| `coupling` / `n` | true | — | 声道联动 |
| `correctdc` / `c` | false | — | DC 校正 |
| `altboundary` / `b` | false | — | 替代边界处理 |
| `compress` / `s` | 0 | 0~30 | 压缩因子 |
| `threshold` / `t` | 0 | 0~1 | 静音阈值 |

**`speechnorm` 完整参数：**

| 参数 | 默认 | 范围 | 说明 |
| --- | --- | --- | --- |
| `peak` / `p` | 0.95 | 0~1 | 目标峰值 |
| `expansion` / `e` | 2 | 1~50 | 最大扩展因子 |
| `compression` / `c` | 2 | 1~50 | 最大压缩因子 |
| `threshold` / `t` | 0 | 0~1 | 阈值 |
| `raise` / `r` | 0.001 | 0~1 | 扩展上升量 |
| `fall` / `f` | 0.001 | 0~1 | 压缩下降量 |
| `channels` / `h` | `all` | — | 作用的声道 |

```bash
# 动态范围归一化（语音优先，逐帧调整音量）
ffmpeg -i in.wav -af "dynaudnorm=f=150:g=15:p=0.9:m=10" out.wav

# 大动态素材（演讲、采访）
ffmpeg -i in.wav -af "dynaudnorm=f=500:g=31:p=0.95:m=20:r=0.0" out.wav

# 语音专用归一化（更快、更适合人声）
ffmpeg -i in.wav -af "speechnorm=e=12.5:c=12.5:t=0.001:r=0.0001:f=0.0001" out.wav

# 温和的语音归一化
ffmpeg -i in.wav -af "speechnorm=p=0.9:e=4:c=4:t=0.001" out.wav

# 去点击噪声（黑胶/老录音修复）
ffmpeg -i in.wav -af "adeclick=window=55:overlap=75:threshold=2:burst=2" out.wav

# 去爆音/噼啪声
ffmpeg -i in.wav -af "adeclip" out.wav

# 去直流偏移
ffmpeg -i in.wav -af "dcshift=shift=0.02" out.wav

# 去齿音（人声处理）
ffmpeg -i in.wav -af "deesser=i=0.5:m=0.5:f=0.5:s=o" out.wav

# 自动音量均衡（提升安静段、压低响亮段）
ffmpeg -i in.wav -af "adynamicequalizer=threshold=0.1:ratio=3" out.wav
```

### 13.5 `afftdn` / `anlmdn` / `arnndn` —— 降噪

```bash
# FFT 降噪
-af "afftdn=nf=-25"

# 非局部均值降噪
-af "anlmdn=s=0.00001:p=0.002:r=0.01"

# RNN 降噪（需模型文件）
-af "arnndn=m=bd.rnnn"
```

---

## 14. 音频：混合、淡入淡出与编辑

### 14.1 `amix` —— 混音

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `inputs` | 2 | 输入数 |
| `duration` | `longest` | `longest` / `shortest` / `first` |
| `dropout_transition` | 2 | 输入结束时音量重归一的过渡时间（秒） |
| `weights` | 全 1 | 各输入权重，空格分隔 |
| `normalize` | 1 | 是否自动缩放（关闭可能削波） |

```bash
# 三路混音，长度取第一路
-filter_complex "amix=inputs=3:duration=first:dropout_transition=3"

# 人声 1.0 + 音乐 0.25，不做归一化
-filter_complex "[0:a][1:a]amix=inputs=2:duration=longest:weights='1 0.25':normalize=0[a]"
```

> `amix` 只支持浮点样本，整数输入会自动插入 `aresample`。

### 14.2 `afade` / `acrossfade` —— 淡入淡出

**`afade` 选项：**

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `type` / `t` | `in` | `in` 淡入 / `out` 淡出 |
| `start_sample` / `ss` | 0 | 起始样本序号 |
| `nb_samples` / `ns` | 44100 | 持续样本数 |
| `start_time` / `st` | 0 | 起始时间（优先于 `start_sample`） |
| `duration` / `d` | — | 持续时长（优先于 `nb_samples`） |
| `curve` | `tri` | `tri` `qsin` `hsin` `esin` `log` `ipar` `qua` `cub` `squ` `cbr` `par` `exp` `iqsin` `ihsin` `dese` `desi` `losi` `sinc` `isinc` `noise` `nofade` |

```bash
# 淡入 3 秒
-af "afade=t=in:st=0:d=3"

# 从 10 秒起淡出 2 秒
-af "afade=t=out:st=10:d=2"

# 交叉淡化（两段音频衔接）
-filter_complex "[0:a][1:a]acrossfade=d=2:c1=tri:c2=tri[a]"
```

### 14.3 `atempo` / `rubberband` —— 变速（不变调）

```bash
# 1.25 倍速（atempo 范围 0.5~100）
-af "atempo=1.25"

# 2 倍速（超出范围需串联）
-af "atempo=2.0,atempo=2.0"       # = 4 倍

# 0.75 倍速
-af "atempo=0.75"

# 高质量变速（rubberband）
-af "rubberband=tempo=1.25:pitch=1.0"
```

### 14.4 音视频同时变速

```bash
# 视频 1.25 倍速 + 音频同步变速
-filter_complex "[0:v]setpts=PTS/1.25[v];[0:a]atempo=1.25[a]" -map "[v]" -map "[a]" out.mp4
```

### 14.5 `silencedetect` / `silenceremove`

```bash
# 检测静音段
-af "silencedetect=noise=-30dB:d=0.5"

# 移除开头静音
-af "silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB"

# 移除中间静音
-af "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-40dB"
```

### 14.6 其他实用音频滤镜

| 滤镜 | 用途 |
| --- | --- |
| `atrim` | 裁剪音频段 |
| `apad` | 补静音（`apad=pad_dur=2`） |
| `adelay` | 延迟（`adelay=1000\|1000` 毫秒） |
| `areverse` | 倒放 |
| `aecho` | 回声 |
| `chorus` | 合唱效果 |
| `tremolo` / `vibrato` | 颤音 |
| `stereowiden` / `extrastereo` | 立体声展宽 |
| `haas` | Haas 效应 |
| `aphaser` | 移相 |
| `firequalizer` | FIR 均衡器 |
| `asubboost` | 低频增强 |
| `asupercut` / `asubcut` | 超低频/超高频切除 |
| `adecorrelate` | 去相关（上混） |
| `surround` | 环绕声处理 |

---

## 15. 音频：响度标准化

### 15.1 `loudnorm` —— EBU R128 响度标准化

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `I` / `i` | -24.0 | 目标整体响度（LUFS），范围 -70~-5 |
| `LRA` / `lra` | 7.0 | 目标响度范围，1.0~50.0 |
| `TP` / `tp` | -2.0 | 最大真峰值（dBTP），-9.0~0.0 |
| `measured_I` | — | 输入实测 IL（两遍法用） |
| `measured_LRA` | — | 输入实测 LRA |
| `measured_TP` | — | 输入实测 TP |
| `measured_thresh` | — | 输入实测阈值 |
| `offset` | 0.0 | 偏移增益 |
| `linear` | true | 线性归一化（需提供实测值，否则退回动态） |
| `dual_mono` | false | 单声道按双单声道处理 |
| `print_format` | `none` | `summary` / `json` / `none` |
| `stats_file` | — | 输出统计文件（配合 `print_format`） |

**常用目标响度：**

| 标准 | 目标 |
| --- | --- |
| EBU R128（欧洲广播） | -23 LUFS |
| ATSC A/85（美国广播） | -24 LKFS |
| **流媒体（Spotify/YouTube/Apple Music）** | **-14 LUFS** |
| 播客 | -16 LUFS |

```bash
# 单遍（动态模式，直播可用）
-af "loudnorm=I=-16:TP=-1.5:LRA=11"

# 两遍（精确，文件推荐）
# 第一遍：测量
ffmpeg -i in.mp4 -af "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json" -f null - 2>measure.json
# 第二遍：应用测得值
-af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=-22.3:measured_LRA=8.1:measured_TP=-1.2:measured_thresh=-32.8:offset=0.1:linear=true"
```

### 15.2 `ebur128` —— 响度测量

```bash
# 按 EBU R128 测量（输出 I/LRA/TP 等）
ffmpeg -i in.mp4 -af "ebur128=peak=true" -f null -
```

### 15.3 `drmeter` —— 动态范围测量

```bash
-af "drmeter"
```

---

## 16. 复杂滤镜图实战配方

### 16.1 全功能转码模板

```bash
ffmpeg -i input.mkv \
  -filter_complex "\
    [0:v]scale=1920:1080:force_original_aspect_ratio=decrease,\
         pad=1920:1080:(ow-iw)/2:(oh-ih)/2,\
         setsar=1,\
         unsharp=5:5:0.8:3:3:0.4[v];\
    [0:a]loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx265 -preset slow -crf 22 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  output.mp4
```

### 16.2 水印 + 字幕 + 转场 + 混音

```bash
ffmpeg -i main.mp4 -i logo.png -i bgm.mp3 -i intro.mp4 \
  -filter_complex "\
    [0:v]scale=1280:720,setsar=1[main];\
    [intro:v]scale=1280:720,setsar=1[intro];\
    [intro][main]xfade=transition=fade:duration=1:offset=4[vx];\
    [1:v]format=rgba,colorchannelmixer=aa=0.7[wm];\
    [vx][wm]overlay=W-w-20:H-h-20:eval=init[vo];\
    [vo]subtitles=subs.srt:original_size=1280x720[v];\
    [2:a]volume=0.25[bgm];\
    [0:a][bgm]amix=inputs=2:duration=first:weights='1 1':normalize=0[a]" \
  -map "[v]" -map "[a]" \
  -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 160k out.mp4
```

### 16.3 多机位网格 + 独立音频

```bash
ffmpeg -i cam1.mp4 -i cam2.mp4 -i cam3.mp4 -i cam4.mp4 \
  -filter_complex "\
    [0:v]scale=640:360,setsar=1[c1];\
    [1:v]scale=640:360,setsar=1[c2];\
    [2:v]scale=640:360,setsar=1[c3];\
    [3:v]scale=640:360,setsar=1[c4];\
    [c1][c2][c3][c4]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[v];\
    [0:a][1:a][2:a][3:a]amix=inputs=4:duration=shortest[a]" \
  -map "[v]" -map "[a]" -c:v libx264 -crf 22 -c:a aac out.mp4
```

### 16.4 画中画 + 摄像头叠加 + 时间码

```bash
ffmpeg -i screen.mp4 -i webcam.mp4 \
  -filter_complex "\
    [1:v]scale=320:180,crop=320:180[face];\
    [0:v][face]overlay=W-w-20:H-h-20[tmp];\
    [tmp]drawtext=text='%{pts\\:hms}':fontsize=24:fontcolor=white:box=1:boxcolor=black@0.5:x=20:y=20[out]" \
  -map "[out]" -map 0:a? out.mp4
```

### 16.5 生成视频（lavfi 源滤镜）

```bash
# 测试源 + 正弦音
ffmpeg -f lavfi -i "testsrc=size=1280x720:rate=30:duration=10" \
       -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=10" \
       -c:v libx264 -crf 20 -c:a aac out.mp4

# 纯色背景
ffmpeg -f lavfi -i "color=c=black:s=1920x1080:d=5:r=30" -c:v libx264 -crf 20 out.mp4

# 音频波形可视化
ffmpeg -i in.mp3 -filter_complex "[0:a]showwaves=s=1280x720:mode=cline:rate=30[v]" -map "[v]" -map 0:a out.mp4

# 频谱可视化
ffmpeg -i in.mp3 -filter_complex "[0:a]showspectrum=s=1280x720:mode=combined:slide=scroll[v]" -map "[v]" out.mp4

# 频谱图（静态图片）
ffmpeg -i in.mp3 -filter_complex "[0:a]showspectrumpic=s=1920x1080:legend=1[out]" -map "[out]" -frames:v 1 spec.png
```

### 16.6 从视频生成 GIF

```bash
# 两遍法：先生成调色板，再应用（质量最佳）
ffmpeg -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,palettegen=stats_mode=diff" -y palette.png
ffmpeg -i in.mp4 -i palette.png -lavfi "fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -y out.gif
```

### 16.7 缩略图雪碧图（sprite sheet）

```bash
ffmpeg -i in.mp4 -vf "fps=1/10,scale=160:90,tile=10x10" -frames:v 1 sprite.jpg
```

### 16.8 音视频同步修复

```bash
# 音频延迟 500ms
-af "adelay=500|500"

# 用 aresample 动态同步
-af "aresample=async=1000"

# 整体时间戳偏移
-itsoffset 0.5 -i audio.mp3
```

---

## 17. 滤镜调试与速查

### 17.1 调试命令

```bash
ffmpeg -filters                     # 列出所有滤镜（含 Timeline 标记 T）
ffmpeg -h filter=scale              # 查看某滤镜的全部选项与默认值
ffmpeg -h filter=overlay
ffmpeg -h full | grep -A 50 "filter"    # 全部滤镜帮助
ffmpeg -v debug -i in.mp4 -vf "..." -f null -   # 调试模式看滤镜图构建
```

### 17.2 常用「空输出」测试

```bash
# 只跑滤镜不写文件（验证滤镜图是否正确）
ffmpeg -i in.mp4 -vf "scale=1280:-2" -f null -

# 只看流信息
ffmpeg -i in.mp4 -vf "showinfo" -f null -
```

### 17.3 常见错误速查

| 现象 | 原因与解决 |
| --- | --- |
| `No such filter` | 构建未启用该滤镜（如 `libvmaf`、`subtitles`、`libplacebo`）；查 `ffmpeg -filters` |
| `Invalid argument` / 参数解析失败 | 多为转义问题；用 `textfile` 替代 `text`，路径用 `\:` |
| `Filter ... has an unconnected output` | 滤镜图有未连接的输出 pad；检查 label 配对 |
| `Input link ... parameters ... do not match` | 拼接/叠加的两路格式不一致；先 `scale`/`format`/`setsar` 统一 |
| `The encoder ... requires even dimensions` | 加 `scale=trunc(iw/2)*2:trunc(ih/2)*2` 或 `scale=-2:H` |
| `Could not find codec parameters` | 路径含中文/空格；用引号包裹 |
| concat 后音画不同步 | 各段必须 `setpts=PTS-STARTPTS`；音视频时长需一致 |
| `drawtext` 中文乱码 | 指定支持中文的 `fontfile`（如 `msyh.ttc`），并确保文件为 UTF-8 |
| 输出变慢很多 | 滤镜是 CPU 密集的（`nlmeans`、`bm3d`、`nnedi`）；考虑换轻量替代或硬件滤镜 |

### 17.4 滤镜分类速查

| 需求 | 推荐滤镜 |
| --- | --- |
| 缩放 | `scale`、`zscale` |
| 裁剪/加边 | `crop`、`pad`、`cropdetect` |
| 旋转/翻转 | `transpose`、`hflip`、`vflip`、`rotate` |
| 叠加/水印 | `overlay`、`drawtext`、`drawbox` |
| 字幕 | `subtitles`、`ass` |
| 帧率 | `fps`、`framerate`、`minterpolate` |
| 裁剪片段 | `trim`、`atrim`、`setpts` |
| 调色 | `eq`、`curves`、`hue`、`colorbalance`、`colorlevels` |
| 色彩空间/HDR | `colorspace`、`colormatrix`、`zscale`、`tonemap`、`libplacebo` |
| 去隔行 | `yadif`、`bwdif`、`fieldmatch`、`nnedi` |
| 降噪 | `hqdn3d`、`nlmeans`、`atadenoise`、`deband` |
| 锐化 | `unsharp`、`cas` |
| 稳定 | `vidstabdetect` + `vidstabtransform` |
| 拼接 | `concat`、`xfade`、`acrossfade` |
| 多画面 | `hstack`、`vstack`、`xstack`、`tile` |
| 音频重采样 | `aresample`、`aformat` |
| 声道 | `pan`、`channelmap`、`amerge`、`join` |
| 音量/动态 | `volume`、`acompressor`、`alimiter`、`dynaudnorm` |
| 均衡 | `equalizer`、`bass`、`treble`、`highpass`、`lowpass` |
| 混音/淡变 | `amix`、`afade`、`acrossfade` |
| 变速 | `atempo`、`rubberband` |
| 响度 | `loudnorm`、`ebur128` |
| 质量评估 | `psnr`、`ssim`、`libvmaf`、`xpsnr` |
| 生成素材 | `testsrc`、`color`、`sine`、`showwaves`、`showspectrum`、`palettegen` |

---

## 18. 常用场景完整配方

> 本章覆盖前面章节未展开的高频实操场景，所有命令均可直接运行（把 `in.mp4` / `out.mp4` 换成实际路径）。

### 18.1 屏幕录制（Windows / Linux / macOS）

```bash
# Windows：ddagrab（Desktop Duplication，性能最好，需 D3D11）
ffmpeg -f lavfi -i "ddagrab=0:framerate=30" -c:v h264_nvenc -cq 24 -f mp4 screen.mp4

# Windows：gdigrab（兼容性好，支持区域与窗口）
ffmpeg -f gdigrab -framerate 30 -i desktop -c:v libx264 -preset ultrafast -crf 23 screen.mp4

# Windows：录制指定区域（左上 100,100 起，1280x720）
ffmpeg -f gdigrab -framerate 30 -offset_x 100 -offset_y 100 -video_size 1280x720 \
  -i desktop -c:v libx264 -preset ultrafast -crf 23 region.mp4

# Windows：录制指定窗口
ffmpeg -f gdigrab -framerate 30 -i title="Notepad" -c:v libx264 -preset ultrafast win.mp4

# Windows：同时录屏 + 麦克风
ffmpeg -f gdigrab -framerate 30 -i desktop \
  -f dshow -i audio="Microphone (Realtek Audio)" \
  -c:v libx264 -preset ultrafast -crf 23 -c:a aac -b:a 128k screen_av.mp4

# Linux：x11grab
ffmpeg -f x11grab -framerate 30 -video_size 1920x1080 -i :0.0 \
  -c:v libx264 -preset ultrafast -crf 23 screen.mp4

# macOS：avfoundation（屏幕是索引 1，摄像头是 0）
ffmpeg -f avfoundation -framerate 30 -i "1:0" -c:v h264_videotoolbox -b:v 6M screen.mp4

# 录制时限制时长与体积
ffmpeg -f gdigrab -framerate 30 -i desktop -t 600 -fs 500M \
  -c:v libx264 -preset ultrafast -crf 23 screen.mp4
```

### 18.2 字幕全流程

> 📖 更系统的字幕处理（含 ASS 样式、图形字幕、时间轴调整、批量脚本）见
> 《FFmpeg 字幕处理完全指南》（`ffmpeg-guide-subtitles.md`）。

```bash
# ---- 1. 提取字幕 ----
# 提取内封字幕为 SRT
ffmpeg -i in.mkv -map 0:s:0 -c:s srt subs.srt

# 提取全部字幕流
ffmpeg -i in.mkv -map 0:s -c:s srt "subs_%d.srt"

# ---- 2. 转换字幕格式 ----
ffmpeg -i subs.srt subs.ass
ffmpeg -i subs.ass subs.srt
ffmpeg -i subs.srt -c:s webvtt subs.vtt

# ---- 3. 烧录字幕（硬字幕）----
ffmpeg -i in.mp4 -vf "subtitles=subs.srt" -c:v libx264 -crf 20 -c:a copy out.mp4

# 烧录并统一字号（先缩放再烧录，保证字体比例）
ffmpeg -i in.mp4 -vf "scale=1280:720,subtitles=subs.srt:original_size=1920x1080" \
  -c:v libx264 -crf 20 -c:a copy out.mp4

# 强制样式（字体、大小、颜色、描边、位置）
ffmpeg -i in.mp4 -vf "subtitles=subs.ass:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=30'" \
  -c:v libx264 -crf 20 out.mp4

# ---- 4. 封装字幕（软字幕，不重编码）----
ffmpeg -i in.mp4 -i subs.srt -c copy -c:s mov_text -metadata:s:s:0 language=chi out.mp4

# MKV 内封 ASS 字幕（保留样式）
ffmpeg -i in.mp4 -i subs.ass -c:v copy -c:a copy -c:s copy out.mkv

# ---- 5. 字幕时间轴调整 ----
ffmpeg -itsoffset 2.5 -i subs.srt -c:s srt delayed.srt    # 整体延迟 2.5 秒
ffmpeg -itsoffset -1 -i subs.srt -c:s srt advanced.srt     # 整体提前 1 秒

# ---- 6. 多语言字幕 ----
ffmpeg -i in.mp4 -i chi.srt -i eng.srt \
  -map 0:v -map 0:a -map 1:s -map 2:s -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=chi -metadata:s:s:0 title="中文" \
  -metadata:s:s:1 language=eng -metadata:s:s:1 title="English" \
  out.mp4
```

### 18.3 图片序列与动图

```bash
# ---- 视频 → 图片序列 ----
ffmpeg -i in.mp4 -fps_mode passthrough frames/frame_%05d.png   # 每帧导出为 PNG
ffmpeg -i in.mp4 -vf "fps=1" -q:v 2 thumbs/thumb_%04d.jpg     # 每秒 1 帧 JPG
ffmpeg -ss 10 -t 5 -i in.mp4 -vf "fps=10" frames/f_%04d.png   # 指定区间

# ---- 图片序列 → 视频 ----
ffmpeg -framerate 30 -i frames/frame_%05d.png -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4
ffmpeg -framerate 1/2 -i img_%04d.jpg -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4  # 每张 2 秒
ffmpeg -loop 1 -i cover.jpg -i bgm.mp3 -shortest \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac out.mp4     # 静态图 + 音频

# ---- 视频 → GIF（两遍法，质量最佳）----
ffmpeg -i in.mp4 -vf "fps=12,scale=480:-1:flags=lanczos,palettegen=stats_mode=diff" -y palette.png
ffmpeg -i in.mp4 -i palette.png -lavfi "fps=12,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" -y out.gif

# ---- 视频 → 高质量 GIF（单命令）----
ffmpeg -i in.mp4 -vf "fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" out.gif

# ---- GIF → 视频 ----
ffmpeg -i in.gif -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -c:v libx264 -crf 20 -pix_fmt yuv420p out.mp4
```

### 18.4 封面与缩略图

```bash
# 取指定时间点的一帧作为封面
ffmpeg -ss 00:01:30 -i in.mp4 -frames:v 1 -q:v 2 cover.jpg

# 自动选取「最有代表性」的一帧（thumbnail 滤镜）
ffmpeg -i in.mp4 -vf "thumbnail=100,scale=1280:-1" -frames:v 1 cover.jpg

# 按场景变化选帧（每个场景首帧）
ffmpeg -i in.mp4 -vf "select='gt(scene,0.3)',scale=640:-1" -frames:v 10 -q:v 2 scene_%02d.jpg

# 缩略图雪碧图（10x10 网格）
ffmpeg -i in.mp4 -vf "fps=1/10,scale=160:90,tile=10x10" -frames:v 1 sprite.jpg

# 缩略图雪碧图 + 时间戳标注
ffmpeg -i in.mp4 -vf "fps=1/10,scale=320:180,drawtext=text='%{pts\:hms}':fontsize=16:fontcolor=white:box=1:boxcolor=black@0.6:x=4:y=4,tile=5x5" -frames:v 1 sprite.jpg

# 生成带封面的音频文件（MP3）
ffmpeg -i audio.mp3 -i cover.jpg -map 0:a -map 1:v -c:a copy -c:v mjpeg -id3v2_version 3 \
  -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" out.mp3

# 视频加封面（MP4 封面轨道）
ffmpeg -i in.mp4 -i cover.jpg -map 0 -map 1 -c copy -disposition:v:1 attached_pic out.mp4
```

### 18.5 元数据与章节

```bash
# 设置基础元数据
ffmpeg -i in.mp4 -c copy \
  -metadata title="我的视频" -metadata artist="作者" \
  -metadata album="专辑" -metadata date="2026" -metadata comment="备注" out.mp4

# 清除全部元数据
ffmpeg -i in.mp4 -c copy -map_metadata -1 out.mp4

# 从另一个文件复制元数据
ffmpeg -i in.mp4 -i source.mp4 -map 0 -c copy -map_metadata 1 out.mp4

# 设置音轨语言与标题
ffmpeg -i in.mkv -c copy \
  -metadata:s:a:0 language=chi -metadata:s:a:0 title="国语" \
  -metadata:s:a:1 language=jpn -metadata:s:a:1 title="日语" out.mkv

# 设置默认音轨
ffmpeg -i in.mkv -c copy -disposition:a:1 default -disposition:a:0 0 out.mkv

# 读取元数据
ffprobe -v error -show_entries format_tags -of json in.mp4

# 章节（metadata.txt 含 [CHAPTER] 段，TIMEBASE=1/1000，START/END 为毫秒）
ffmpeg -i in.mp4 -i metadata.txt -map_metadata 1 -c copy out.mp4
```

### 18.6 多音轨与流映射

```bash
# 查看所有流
ffprobe -v error -show_entries stream=index,codec_type,codec_name,channels -of csv in.mkv

# 只保留第一个视频流与指定音频流
ffmpeg -i in.mkv -map 0:v:0 -map 0:a:1 -c copy out.mkv

# 映射所有流 / 排除字幕
ffmpeg -i in.mkv -map 0 -c copy out.mkv
ffmpeg -i in.mkv -map 0 -map -0:s -c copy out.mkv

# 保留视频 + 第 1 音轨 + 全部字幕
ffmpeg -i in.mkv -map 0:v -map 0:a:0 -map 0:s -c copy out.mkv

# 多输入混合映射（视频来自 A，音频来自 B）
ffmpeg -i video.mp4 -i audio.m4a -map 0:v:0 -map 1:a:0 -c:v copy -c:a copy out.mp4

# 同一视频配多语言音轨
ffmpeg -i video.mp4 -i chi.m4a -i eng.m4a \
  -map 0:v -map 1:a -map 2:a -c:v copy -c:a aac \
  -metadata:s:a:0 language=chi -metadata:s:a:1 language=eng out.mp4
```

### 18.7 音视频提取与替换

```bash
# 提取音频（不重编码）
ffmpeg -i in.mp4 -vn -c:a copy out.m4a

# 提取音频并转格式
ffmpeg -i in.mp4 -vn -c:a libmp3lame -q:a 2 out.mp3
ffmpeg -i in.mp4 -vn -c:a flac -compression_level 8 out.flac
ffmpeg -i in.mp4 -vn -c:a libopus -b:a 128k out.opus

# 提取视频（去掉音频）
ffmpeg -i in.mp4 -an -c:v copy out.mp4

# 替换音频（保留原视频，不重编码视频）
ffmpeg -i in.mp4 -i newaudio.m4a -map 0:v -map 1:a -c:v copy -c:a copy -shortest out.mp4

# 提取原始流（用于分析）
ffmpeg -i in.mp4 -map 0:v:0 -c:v copy -f h264 raw.h264
ffmpeg -i in.mp4 -map 0:a:0 -c:a copy -f mp3 raw.mp3
```

### 18.8 封装转换与流拷贝

```bash
# MKV → MP4（不重编码）
ffmpeg -i in.mkv -c copy -movflags +faststart out.mp4

# 转 MP4 并确保 Apple 兼容（HEVC 用 hvc1 标签）
ffmpeg -i in.mkv -c:v copy -c:a copy -tag:v hvc1 -movflags +faststart out.mp4

# MP4 → MKV
ffmpeg -i in.mp4 -c copy out.mkv

# TS → MP4（修正时间戳）
ffmpeg -i in.ts -c copy -bsf:a aac_adtstoasc out.mp4

# 修复损坏文件的封装（忽略错误）
ffmpeg -err_detect ignore_err -i broken.mp4 -c copy fixed.mp4

# 只拷贝指定时长的片段（快速，无需重编码）
ffmpeg -ss 00:05:00 -t 00:01:00 -i in.mp4 -c copy clip.mp4
```

### 18.9 HDR 与广色域工作流

> ⚠️ 下面的 `zscale=t=linear` 链路依赖 libzimg 的线性光支持。本机五个 ffmpeg 构建实测均报
> `code 3074: no path between colorspaces`（环境限制，非写法错误）。若你也遇到该报错，
> 请改用「方案 A/B」的写法（见 §6.4 的说明），或先自测：`ffmpeg -i in.mp4 -vf "zscale=t=linear" -f null -`

```bash
# 检查 HDR 元数据
ffprobe -v error -select_streams v:0 -show_entries stream=color_space,color_transfer,color_primaries,side_data_list -of json in.mkv

# ---- 方案 A：tonemap + format（已验证可用，无需 zscale linear）----
ffmpeg -i hdr.mkv -vf "format=gbrpf32le,tonemap=tonemap=hable:desat=0,format=yuv420p" \
  -c:v libx264 -crf 20 -c:a copy sdr.mp4

# ---- 方案 B：libplacebo（已验证可用，质量最佳）----
ffmpeg -i hdr.mkv -vf "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p" \
  -c:v libx264 -crf 20 -c:a copy sdr.mp4

# ---- 方案 C：zscale 经典链路（构建支持时色彩精度最佳）----
ffmpeg -i hdr.mkv -vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p" \
  -c:v libx264 -crf 20 -c:a copy sdr.mp4

# HDR10 → SDR（mobius，色彩更准；同样需 zscale linear 支持）
ffmpeg -i hdr.mkv -vf "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=mobius:param=0.3,zscale=t=bt709:m=bt709:r=tv,format=yuv420p" \
  -c:v libx264 -crf 20 -c:a copy sdr.mp4

# SDR → HDR10（x265，硬件编码器不支持完整 HDR10 元数据）
ffmpeg -i sdr.mp4 -c:v libx265 -preset slow -crf 20 -pix_fmt yuv420p10le \
  -x265-params "hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400" \
  -c:a copy hdr.mkv

# 保留 HDR 转码（只改分辨率，不动色彩）
ffmpeg -i hdr.mkv -vf "zscale=w=1920:h=1080" -c:v libx265 -preset slow -crf 20 \
  -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
  -c:a copy hdr1080.mkv

# 手动设置 HDR 元数据（注意：-mastering_display / -content_light 是【输入选项】，
# 必须写在 -i 之前；-color_primaries 等是输出选项，写在输出文件之前）
ffmpeg -mastering_display "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)" \
  -content_light 1000,400 -i in.mkv -c copy \
  -color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc \
  out.mkv
```

> 注：选项名是 **`-mastering_display`**（不是 `-master_display`），本机 `ffmpeg -h full` 实测确认。
> 若元数据未生效，改用 x265 路径（`-x265-params master-display=...:max-cll=...`）更可靠。

### 18.10 AV1 工作流

```bash
# 编码为 AV1（SVT-AV1，推荐）
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 6 -crf 30 -g 240 -pix_fmt yuv420p10le \
  -c:a libopus -b:a 128k out.mkv

# AV1 归档（高质量慢速）
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 4 -crf 28 -svtav1-params "film-grain=8:tune=0" \
  -c:a copy out.mkv

# AV1 硬件编码（RTX 40 系 / Arc / RDNA3）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -c:v av1_nvenc -preset p6 -cq 30 -c:a copy out.mp4

# 解码 AV1 并转 H.264（兼容性）
ffmpeg -i av1.mp4 -c:v libx264 -preset medium -crf 20 -c:a copy h264.mp4

# WebM + AV1 + Opus（网页播放）
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 6 -crf 32 -c:a libopus -b:a 128k out.webm
```

### 18.11 时间与片段操作

```bash
# 快速裁剪（输入侧定位，快但可能非精确）
ffmpeg -ss 00:01:00 -t 00:00:30 -i in.mp4 -c copy clip.mp4

# 精确裁剪（输出侧定位，慢但精确）
ffmpeg -i in.mp4 -ss 00:01:00 -t 00:00:30 -c:v libx264 -crf 20 -c:a copy clip.mp4

# 从末尾裁剪
ffmpeg -sseof -00:00:30 -i in.mp4 -c copy tail.mp4

# 拼接多个文件（同编码，无需重编码）
printf "file '%s'\n" part1.mp4 part2.mp4 part3.mp4 > list.txt
ffmpeg -f concat -safe 0 -i list.txt -c copy merged.mp4

# 倒放
ffmpeg -i in.mp4 -vf "reverse" -af "areverse" -c:v libx264 -crf 20 -c:a aac reversed.mp4

# 循环播放 N 次
ffmpeg -stream_loop 3 -i in.mp4 -c copy looped.mp4
```

### 18.12 质量检测与内容分析

```bash
# 检测黑场
ffmpeg -i in.mp4 -vf "blackdetect=d=0.5:pix_th=0.10" -f null - 2>&1 | grep blackdetect

# 检测冻结帧
ffmpeg -i in.mp4 -vf "freezedetect=n=-60dB:d=2" -f null - 2>&1 | grep freezedetect

# 检测静音段
ffmpeg -i in.mp4 -af "silencedetect=noise=-30dB:d=0.5" -f null - 2>&1 | grep silence

# 场景切换检测
ffmpeg -i in.mp4 -vf "select='gt(scene,0.4)',showinfo" -f null - 2>&1 | grep pts_time

# 音量分析
ffmpeg -i in.mp4 -af "volumedetect" -f null - 2>&1 | grep -E "mean_volume|max_volume"

# 响度分析（EBU R128）
ffmpeg -i in.mp4 -af "ebur128=peak=true" -f null - 2>&1 | tail -20

# 视频信息概览
ffprobe -v error -show_format -show_streams -of json in.mp4
```

### 18.13 自动化脚本模板

```bash
#!/usr/bin/env bash
# 批量把视频统一为 1080p H.264 + AAC（Web 友好）
set -euo pipefail
SRC="./src"; DST="./dst"; mkdir -p "$DST"

find "$SRC" -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.mov" \) | while read -r f; do
  rel="${f#$SRC/}"; out="$DST/${rel%.*}.mp4"; mkdir -p "$(dirname "$out")"
  echo "==> $f"
  ffmpeg -y -hide_banner -loglevel warning -i "$f" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30" \
    -c:v libx264 -preset medium -crf 21 -profile:v high -level 4.1 -pix_fmt yuv420p \
    -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
    -c:a aac -b:a 160k -ar 48000 -ac 2 \
    -movflags +faststart "$out"
done
echo "完成"
```

```bash
#!/usr/bin/env bash
# 批量生成缩略图雪碧图 + 封面
mkdir -p thumbs
for f in *.mp4; do
  base="${f%.*}"
  ffmpeg -y -hide_banner -loglevel error -i "$f" \
    -vf "fps=1/10,scale=320:180,tile=5x5" -frames:v 1 "thumbs/${base}_sprite.jpg"
  ffmpeg -y -hide_banner -loglevel error -ss 00:00:05 -i "$f" \
    -vf "thumbnail=100,scale=1280:-1" -frames:v 1 "thumbs/${base}_cover.jpg"
  echo "done: $base"
done
```

---

## 附录：本文参数来源对照

| 章节 | 主要来源 |
| --- | --- |
| 1–5 语法/转义/时间轴/framesync | `ffmpeg-filters.md` §2 Filtering Introduction、§4 Filtergraph description、§5 Timeline editing、§6 Commands、§7 framesync |
| 6 尺寸与构图 | `ffmpeg-filters.md` §11.221 scale、§11.296 zscale、§11.47 crop、§11.48 cropdetect、§11.190 pad、§11.264 transpose、§11.219 rotate；`ffmpeg-scaler.md` |
| 7 叠加与文字 | `ffmpeg-filters.md` §11.188 overlay、§11.76 drawtext、§11.247 subtitles、§11.5 ass、§11.73 drawbox、§11.63 delogo |
| 8 时间、帧率与变速 | `ffmpeg-filters.md` §11.99 fps、§11.101 framerate、§11.170 minterpolate、§11.104 framestep、§11.265 trim、§20.19 setpts、§20.17 select、§11.174 mpdecimate、§11.216 reverse；本机 `ffmpeg -h filter=minterpolate`/`framerate` 实测 |
| 9 颜色与格式 | `ffmpeg-filters.md` §11.98 format、§11.82 eq、§11.50 curves、§11.130 hue、§11.28 colorbalance、§11.39 colorspace、§11.262 tonemap、§11.147 libplacebo |
| 10 降噪与修复 | `ffmpeg-filters.md` §11.293 yadif、§11.19 bwdif、§11.121 hqdn3d、§11.178 nlmeans、§11.54 deband、§11.267 unsharp、§11.274/11.275 vidstab |
| 11 转场与多画面 | `ffmpeg-filters.md` §20.9 concat、§11.289 xfade、§11.127 hstack、§11.283 vstack、§11.292 xstack、§20.33 split、§11.256 tile |
| 12 音频重采样与声道 | `ffmpeg-resampler.md`（全部重采样选项与抖动方法）；`ffmpeg-filters.md` §8.47 aresample、§8.26 aformat、§8.101 pan、§8.74 channelmap、§8.75 channelsplit、§8.34 amerge、§8.95 join |
| 13 音量动态与均衡 | `ffmpeg-filters.md` §8.87 equalizer、§8.71 bass、§8.116 treble、§8.94 highpass、§8.98 lowpass；本机 `ffmpeg -h filter=acompressor`/`alimiter`/`dynaudnorm`/`speechnorm` 实测 |
| 14 混音淡变编辑 | `ffmpeg-filters.md` §8.35 amix、§8.22 afade、§8.5 acrossfade、§8.65 atempo、§8.104 rubberband、§8.107 silencedetect、§8.108 silenceremove |
| 15 响度标准化 | `ffmpeg-filters.md` §8.97 loudnorm、§20.10 ebur128、§8.84 drmeter |
| 16 实战配方 | 综合上述滤镜的官方示例改写 |
| 17 调试 | `ffmpeg-filters.md` §3 graph2dot、各滤镜文档 |
| 18 常用场景 | `ffmpeg-all.md` §6 Examples、§5.4 Main options（`-map`/`-metadata`/`-disposition`）、§5.5 Video Options；各滤镜与采集设备文档 |
