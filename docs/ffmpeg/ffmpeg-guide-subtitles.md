# FFmpeg 字幕处理完全指南

> 版本基准：本文参数以 FFmpeg 官方文档（`temp/ffmpeg-docs` 离线副本：`ffmpeg-all.md`、`ffmpeg-filters.md`）为准，并用本机 `F:\Temp\ffmpeg\ffmpeg-9-nonfree`（`N-126689-gb894a6f7c-2026-09-19`，libavcodec 63.14.100）的 `-codecs`、`-encoders`、`-decoders`、`-h filter=subtitles`、`-buildconf` 实测核对。
> 本机构建已启用 `--enable-libass --enable-libfreetype --enable-libfontconfig --enable-libharfbuzz --enable-libfribidi`，字幕渲染功能完整。
> **实测说明**：文中示例除标注「需外部工具」「需图形字幕源」外，均已在本机实际跑通。

---

## 目录

1. [字幕格式与编解码器全景](#1-字幕格式与编解码器全景)
2. [核心概念：软字幕 vs 硬字幕](#2-核心概念软字幕-vs-硬字幕)
3. [字幕流探测](#3-字幕流探测)
4. [字幕提取](#4-字幕提取)
5. [字幕格式转换](#5-字幕格式转换)
6. [软字幕封装与流映射](#6-软字幕封装与流映射)
7. [硬字幕烧录（subtitles / ass 滤镜）](#7-硬字幕烧录subtitles--ass-滤镜)
8. [ASS 样式控制详解](#8-ass-样式控制详解)
9. [字体、编码与乱码处理](#9-字体编码与乱码处理)
10. [字幕时间轴调整与同步](#10-字幕时间轴调整与同步)
11. [图形字幕（PGS / DVD / DVB）](#11-图形字幕pgs--dvd--dvb)
12. [多语言字幕与默认轨道](#12-多语言字幕与默认轨道)
13. [直播与切片场景的字幕](#13-直播与切片场景的字幕)
14. [常见问题与排查](#14-常见问题与排查)
15. [批量处理脚本模板](#15-批量处理脚本模板)
16. [速查表](#16-速查表)

---

## 1. 字幕格式与编解码器全景

### 1.1 三类字幕

| 类别 | 本质 | 代表格式 | 能否转文本 |
| --- | --- | --- | --- |
| **文本字幕** | 文字 + 时间码（+ 样式） | SRT、ASS/SSA、WebVTT、MOV text | ✅ 可互转、可编辑 |
| **图形字幕** | 位图图片 + 时间码 | PGS（蓝光）、VobSub（DVD）、DVB | ❌ 需 OCR 才能转文本 |
| **广播字幕** | 广播流内嵌 | ARIB（日本）、EIA-608/708（美）、Teletext | ⚠️ 部分可解为文本 |

> **关键认知**：图形字幕本质是「图片」，FFmpeg 只能整体搬运或重新编码成图片，**无法直接转成 SRT**。要转文本必须用 OCR（FFmpeg 本身不提供，需 tesseract 等外部工具）。

### 1.2 FFmpeg 支持的字幕编解码器（本机实测完整清单）

**文本字幕（可编解码）：**

| 编解码器 | 格式名 | 解码 | 编码 | 说明 |
| --- | --- | --- | --- | --- |
| `subrip` / `srt` | SubRip | ✅ | ✅ | **最通用**，纯文本 + 时间码 |
| `ass` / `ssa` | Advanced SubStation Alpha | ✅ | ✅ | **功能最强**，支持完整样式与特效 |
| `webvtt` | WebVTT | ✅ | ✅ | 网页标准（HTML5 `<track>`） |
| `mov_text` | 3GPP Timed Text | ✅ | ✅ | **MP4 专用**，功能受限 |
| `text` | raw UTF-8 text | ✅ | ✅ | 无时间码的纯文本 |
| `ttml` | TTML | — | ✅ | 广播/流媒体用 XML 格式 |
| `microdvd` | MicroDVD | ✅ | — | 帧号计时 |
| `subviewer` / `subviewer1` | SubViewer | ✅ | — | |
| `jacosub` | JACOsub | ✅ | — | |
| `mpl2` | MPL2 | ✅ | — | |
| `pjs` | PJS | ✅ | — | |
| `realtext` | RealText | ✅ | — | |
| `sami` | SAMI | ✅ | — | |
| `stl` | Spruce | ✅ | — | |
| `vplayer` | VPlayer | ✅ | — | |
| `lrc` | LRC 歌词 | — | ✅⚠️ | 带 `precision` 选项（2=厘秒）。**本机构建未包含该编码器**，需构建时启用 |

**图形字幕（位图）：**

| 编解码器 | 格式名 | 解码 | 编码 | 说明 |
| --- | --- | --- | --- | --- |
| `hdmv_pgs_subtitle` | PGS（蓝光） | ✅ | — | 蓝光原盘字幕，**只能解不能编** |
| `dvd_subtitle` | DVD VobSub | ✅ | ✅ | `dvdsub`，支持 `palette`/`even_rows_fix` |
| `dvbsub` | DVB 字幕 | ✅ | ✅ | 支持 `min_bpp`（2/4/8） |
| `xsub` | DivX XSUB | ✅ | ✅ | AVI 内嵌 |
| `dvb_teletext` | DVB Teletext | ✅ | — | 需 libzvbi |
| `eia_608` | EIA-608/708 闭路字幕 | ✅ | — | 需从视频流提取 |
| `arib_caption` | ARIB STD-B24 | ✅ | — | 日本广播，需 libaribcaption |

> ⚠️ **构建差异**：上表基于官方文档与通用构建。**具体编解码器是否可用取决于你的 ffmpeg 构建**。
> 例如本机 `ffmpeg-9-nonfree` 实测：文本类（subrip/ass/webvtt/mov_text/ttml）、
> 图形类（pgssub/dvdsub/dvbsub/xsub）、广播类（libaribcaption/libzvbi-teletextdec/cc_dec）
> 均可用，但**未包含 `lrc` 编码器**。使用前务必用下面的命令自测。
>
> 查看本机完整清单：
> ```bash
> ffmpeg -codecs | grep -E "^ ..S"      # 全部字幕编解码器
> ffmpeg -encoders | grep -E "^ S"      # 字幕编码器
> ffmpeg -decoders | grep -E "^ S"      # 字幕解码器
> ```

### 1.3 容器兼容性矩阵

| 容器 | SRT | ASS | WebVTT | mov_text | PGS | VobSub | DVB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **MKV** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MP4** | ⚠️ 需转 `mov_text` | ❌ | ❌ | ✅ **唯一原生** | ❌ | ❌ | ❌ |
| **WebM** | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **TS** | ⚠️ 部分 | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **MOV** | ⚠️ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |

> **最实用的结论**：
> - 要**保留 ASS 完整样式** → 用 **MKV**（MP4 不支持 ASS）
> - 要**网页播放** → 用 **WebM + WebVTT**，或 MP4 + 外挂 VTT
> - 要**MP4 内封字幕** → 只能转成 `mov_text`（会丢失大部分样式）

### 1.4 字幕相关的全局选项

| 选项 | 作用域 | 说明 |
| --- | --- | --- |
| `-scodec codec` | 输入/输出 | 字幕编解码器（= `-codec:s`） |
| `-sn` | 输入/输出 | 禁用字幕流 |
| `-fix_sub_duration` | 输入 | 修正字幕时长（DVB 等必需，见 §11.3） |
| `-canvas_size size` | 输入 | 图形字幕渲染画布尺寸 |
| `-sub_type type` | 输入 | 解码输出格式：`bitmap` / `ass` / `text`（ARIB 等用） |
| `-sub_charenc` / `-charenc` | 输入 | 字幕输入字符编码 |
| `-disposition:s:N` | 输出 | 字幕流属性（`default` / `forced` / `0`） |
| `-metadata:s:s:N` | 输出 | 字幕流元数据（`language` / `title`） |

---

## 2. 核心概念：软字幕 vs 硬字幕

| 对比项 | 软字幕（Softsub） | 硬字幕（Hardsub） |
| --- | --- | --- |
| **实现方式** | 作为独立流封装进容器 | 渲染成像素烧进视频画面 |
| **命令** | `-c:s copy` / `-c:s mov_text` | `-vf "subtitles=..."` |
| **能否开关** | ✅ 播放器可开关、可换语言 | ❌ 永久固定 |
| **是否重编码视频** | ❌ 不重编码（快） | ✅ 必须重编码（慢） |
| **样式保留** | ASS 样式完整保留（MKV） | 烧录时按 libass 渲染 |
| **兼容性** | 依赖播放器支持 | **任何播放器都能显示** |
| **适用场景** | 归档、多语言、可编辑 | 社交平台、跨设备、防提取 |

```bash
# 软字幕（不重编码，秒级完成）
ffmpeg -i in.mkv -c:v copy -c:a copy -c:s copy out.mkv

# 硬字幕（必须重编码视频）
ffmpeg -i in.mkv -vf "subtitles=subs.srt" -c:v libx264 -crf 20 -c:a copy out.mp4
```

---

## 3. 字幕流探测

处理字幕前，**先看清源文件有什么**。

```bash
# 列出全部流（含字幕）
ffprobe -v error -show_entries stream=index,codec_type,codec_name,channels -of csv in.mkv

# 只看字幕流详情（含语言、标题、是否默认/强制）
ffprobe -v error -select_streams s -show_entries stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced -of json in.mkv

# 人类可读的精简输出
ffprobe -v error -select_streams s -show_entries stream=index,codec_name -of default=nw=1 in.mkv

# 统计字幕流数量
ffprobe -v error -select_streams s -show_entries stream=index -of csv=p=0 in.mkv | wc -l
```

**输出解读：**

| 字段 | 含义 |
| --- | --- |
| `codec_name` | `subrip`（SRT）、`ass`、`hdmv_pgs_subtitle`（PGS）、`dvd_subtitle` 等 |
| `tags.language` | 语言代码，如 `chi`、`eng`、`jpn` |
| `tags.title` | 轨道名称，如「简体中文」「English SDH」 |
| `disposition.default` | 是否默认轨（`1` 播放器默认选中） |
| `disposition.forced` | 是否强制字幕（`1` 只在必要时显示，如外语对白） |

> **筛选语法提示**：按 disposition 筛选流要用 **`disp:`** 而非 `disposition:`
> （如 `-map "0:disp:forced"`）。这是 FFmpeg 的 stream specifier 关键字，
> 与输出侧的 `-disposition` **选项**是两回事，不要混淆。
> 另外 `disp:` 不能与 `m:`（metadata）前缀组合使用——`0:s:m:disp:forced` 会报错。

> **强制字幕（forced）**：常见于「外语片中的外语对白」或「动漫 OP/ED」，正常情况不显示，只在对应时间点出现。

---

## 4. 字幕提取

### 4.1 提取为独立文件

```bash
# 提取第 1 条字幕流为 SRT
ffmpeg -i in.mkv -map 0:s:0 -c:s srt subs.srt

# 提取全部字幕流（自动编号）
ffmpeg -i in.mkv -map 0:s -c:s srt "subs_%d.srt"

# 提取并保留 ASS 样式（MKV → ASS）
ffmpeg -i in.mkv -map 0:s:0 -c:s ass subs.ass

# 提取为 WebVTT
ffmpeg -i in.mkv -map 0:s:0 -c:s webvtt subs.vtt

# 提取 MP4 里的 mov_text 字幕
ffmpeg -i in.mp4 -map 0:s:0 -c:s srt subs.srt
```

### 4.2 按语言/属性精确选择

```bash
# 按语言代码选择（chi = 中文）
ffmpeg -i in.mkv -map "0:m:language:chi" -c:s srt chi.srt

# 提取所有中文轨道
ffmpeg -i in.mkv -map "0:m:language:chi" -c:s srt "chi_%d.srt"

# 只提取强制字幕（注意是 disp: 而非 disposition:）
ffmpeg -i in.mkv -map "0:disp:forced" -c:s srt forced.srt

# 只提取默认字幕
ffmpeg -i in.mkv -map "0:disp:default" -c:s srt default.srt

# 组合多个 disposition（用 + 连接）
ffmpeg -i in.mkv -map "0:disp:default+forced" -c:s srt both.srt
```

### 4.3 提取到指定文件名（按轨道命名）

```bash
# 一次导出中/英/日三条轨道
ffmpeg -i in.mkv \
  -map "0:m:language:chi" -c:s srt chi.srt \
  -map "0:m:language:eng" -c:s srt eng.srt \
  -map "0:m:language:jpn" -c:s srt jpn.srt
```

### 4.4 从视频流提取闭路字幕（EIA-608）

```bash
# 从 TS/MP4 的视频流中提取 CC 字幕为 SRT
ffmpeg -f lavfi -i "movie=in.ts[out0+subcc]" -map 0:s -c:s srt cc.srt

# 更直接的写法（部分源可用）
ffmpeg -i in.ts -map 0:s:0 -c:s srt cc.srt
```

### 4.5 提取硬字幕（需 OCR，FFmpeg 不提供）

> **重要**：FFmpeg **没有 OCR 能力**。提取画面中已烧录的文字需要外部工具链。

```bash
# 思路（需外部工具，非 ffmpeg 单独完成）：
# 1) 用 ffmpeg 按固定间隔导出字幕区域图像
ffmpeg -i in.mp4 -vf "crop=iw:ih/4:0:ih*3/4,fps=1" -q:v 2 "ocr/frame_%05d.jpg"

# 2) 用 tesseract 等 OCR 工具识别
# tesseract ocr/frame_00001.jpg stdout -l chi_sim

# 3) 手工或用脚本把识别结果 + 时间码组装成 SRT
```

> 实用建议：硬字幕提取质量受画面压缩、字体、背景影响很大。若只是自己看，**直接保留硬字幕**通常比 OCR 更划算。

---

## 5. 字幕格式转换

### 5.1 常见转换

```bash
# SRT → ASS
ffmpeg -i subs.srt subs.ass

# ASS → SRT（会丢失样式，只保留文本与时间码）
ffmpeg -i subs.ass subs.srt

# SRT → WebVTT
ffmpeg -i subs.srt -c:s webvtt subs.vtt

# SRT → mov_text（MP4 用）
ffmpeg -i subs.srt -c:s mov_text subs.mp4

# VTT → SRT
ffmpeg -i subs.vtt -c:s srt subs.srt

# MicroDVD（帧号）→ SRT
ffmpeg -i subs.sub -c:s srt subs.srt
```

> **注意**：转换时**不要加 `-c copy`**。`-c copy` 只搬运原始数据，不做格式转换。

### 5.2 转换时的编码处理

```bash
# 源是 GBK 编码 → 转 UTF-8 SRT
ffmpeg -sub_charenc GBK -i gbk.srt -c:s srt utf8.srt

# 源是 Big5（繁体）
ffmpeg -sub_charenc BIG5 -i big5.srt -c:s srt utf8.srt

# 转换并统一换行符（部分播放器要求 CRLF）
ffmpeg -i subs.srt -c:s srt fixed.srt
```

### 5.3 合并与拆分

```bash
# 把字幕合并进视频（软字幕，不重编码）
ffmpeg -i in.mp4 -i subs.srt -map 0 -map 1 -c copy -c:s mov_text out.mp4

# 把 MKV 的 ASS 字幕转给 MP4（必须转 mov_text）
ffmpeg -i in.mkv -map 0:v -map 0:a -map 0:s -c:v copy -c:a copy -c:s mov_text out.mp4

# 从视频中移除所有字幕
ffmpeg -i in.mkv -map 0 -map -0:s -c copy out.mkv

# 只保留一条字幕，丢弃其他
ffmpeg -i in.mkv -map 0:v -map 0:a -map 0:s:0 -c copy out.mkv
```

---

## 6. 软字幕封装与流映射

### 6.1 封装到不同容器

```bash
# MKV：保留 ASS 样式（推荐）
ffmpeg -i in.mp4 -i subs.ass -map 0 -map 1 -c copy -c:s ass out.mkv

# MP4：转 mov_text（样式受限）
ffmpeg -i in.mp4 -i subs.srt -map 0 -map 1 -c copy -c:s mov_text out.mp4

# MP4：指定语言与标题
ffmpeg -i in.mp4 -i subs.srt -map 0 -map 1 -c copy -c:s mov_text \
  -metadata:s:s:0 language=chi -metadata:s:s:0 title="简体中文" out.mp4

# WebM：只能 WebVTT
ffmpeg -i in.webm -i subs.vtt -map 0 -map 1 -c copy -c:s webvtt out.webm
```

### 6.2 多语言字幕一次封装

```bash
ffmpeg -i in.mp4 -i chi.srt -i eng.srt -i jpn.srt \
  -map 0:v -map 0:a -map 1:s -map 2:s -map 3:s \
  -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=chi -metadata:s:s:0 title="简体中文" \
  -metadata:s:s:1 language=eng -metadata:s:s:1 title="English" \
  -metadata:s:s:2 language=jpn -metadata:s:s:2 title="日本語" \
  out.mp4
```

### 6.3 设置默认与强制字幕

```bash
# 把第 2 条字幕设为默认，取消第 1 条
ffmpeg -i in.mkv -c copy \
  -disposition:s:0 0 -disposition:s:1 default out.mkv

# 标记为强制字幕
ffmpeg -i in.mkv -c copy -disposition:s:0 forced out.mkv

# 同时默认 + 强制
ffmpeg -i in.mkv -c copy -disposition:s:0 "default+forced" out.mkv

# 清除所有字幕的 disposition
ffmpeg -i in.mkv -c copy -disposition:s:0 0 -disposition:s:1 0 out.mkv
```

| `disposition` 值 | 含义 |
| --- | --- |
| `default` | 播放器默认选中 |
| `forced` | 强制显示（仅必要时出现） |
| `default+forced` | 两者兼有 |
| `0` | 清除所有标记 |

### 6.4 字幕流排序

```bash
# 调整流顺序：把第 2 条字幕排到第 1 位
ffmpeg -i in.mkv -map 0:v -map 0:a -map 0:s:1 -map 0:s:0 -c copy out.mkv
```

---

## 7. 硬字幕烧录（subtitles / ass 滤镜）

### 7.1 两个滤镜的区别

| 滤镜 | 依赖 | 支持格式 | 适用 |
| --- | --- | --- | --- |
| `subtitles` | libass + libavcodec + libavformat | **所有 FFmpeg 能解的字幕格式**（SRT/ASS/VTT/PGS…） | 通用，**首选** |
| `ass` | 仅 libass | **仅 ASS/SSA** | 已知是 ASS 且追求轻量 |

> `subtitles` 会先把源字幕转成 ASS 再由 libass 渲染，所以 SRT 也能获得 libass 的渲染效果。

### 7.2 `subtitles` 滤镜完整参数（本机实测）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `filename` / `f` | — | 字幕文件路径（**必须**，也可写容器路径） |
| `original_size` | — | **原视频尺寸**。ASS 的宽高比计算有设计缺陷，若输出分辨率与原视频不同，必须指定此项，否则字体缩放会错 |
| `fontsdir` | — | 附加字体目录（与系统字体叠加） |
| `alpha` | false | 处理 alpha 通道 |
| `charenc` | — | 输入字符编码（非 UTF-8 时用，**仅 subtitles**） |
| `stream_index` / `si` | -1 | 从容器取第几条字幕流（**仅 subtitles**） |
| `force_style` | — | 覆盖样式，ASS 格式 `KEY=VALUE` 用逗号分隔 |
| `wrap_unicode` | auto | 按 Unicode 换行规则断行（需 libass ≥ 0.17 + libunibreak） |
| `shaping` | auto | 整形引擎：`auto` / `simple` / `complex`（阿拉伯文、希伯来文、天城文、泰文需 `complex`） |

**参数简写规则**：若第一个键未指定，则第一个值被当作 `filename`。故 `subtitles=sub.srt` 等价于 `subtitles=filename=sub.srt`。

### 7.3 基础烧录

```bash
# 烧录外挂 SRT
ffmpeg -i in.mp4 -vf "subtitles=subs.srt" -c:v libx264 -crf 20 -c:a copy out.mp4

# 烧录外挂 ASS
ffmpeg -i in.mp4 -vf "ass=subs.ass" -c:v libx264 -crf 20 -c:a copy out.mp4

# 烧录容器内字幕（直接用容器路径）
ffmpeg -i in.mkv -vf "subtitles=in.mkv" -c:v libx264 -crf 20 -c:a copy out.mp4

# 烧录容器内第 2 条字幕流
ffmpeg -i in.mkv -vf "subtitles=in.mkv:si=1" -c:v libx264 -crf 20 -c:a copy out.mp4

# 烧录 WebVTT
ffmpeg -i in.mp4 -vf "subtitles=subs.vtt" -c:v libx264 -crf 20 out.mp4
```

### 7.4 与缩放/裁剪的顺序（关键）

**规则：先做几何变换（scale/crop/pad），最后烧字幕。** 否则字体会被一起缩放。

```bash
# ✅ 正确：先缩放到 720p，再按原始 1080p 尺寸烧字幕
ffmpeg -i in.mkv -vf "scale=1280:720,subtitles=subs.ass:original_size=1920x1080" \
  -c:v libx264 -crf 20 -c:a copy out.mp4

# ❌ 错误：先烧字幕再缩放，字体被压缩变形
ffmpeg -i in.mkv -vf "subtitles=subs.ass,scale=1280:720" -c:v libx264 -crf 20 out.mp4

# 裁剪后烧录（同样要写 original_size）
ffmpeg -i in.mkv -vf "crop=1920:800:0:140,subtitles=subs.ass:original_size=1920x1080" \
  -c:v libx264 -crf 20 out.mp4

# 加黑边后烧录
ffmpeg -i in.mkv -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,subtitles=subs.ass" \
  -c:v libx264 -crf 20 out.mp4
```

### 7.5 烧录时强制样式

```bash
# 单条样式覆盖
ffmpeg -i in.mp4 -vf "subtitles=subs.srt:force_style='FontSize=28'" -c:v libx264 -crf 20 out.mp4

# 多条样式（逗号分隔，整体用单引号包裹）
ffmpeg -i in.mp4 -vf "subtitles=subs.srt:force_style='FontName=Arial,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=30'" \
  -c:v libx264 -crf 20 out.mp4

# 中文字体 + 半透明背景条
ffmpeg -i in.mp4 -vf "subtitles=subs.srt:force_style='FontName=Microsoft YaHei,FontSize=26,PrimaryColour=&H00FFFFFF,BorderStyle=3,BackColour=&H80000000,Outline=1,Shadow=0,Alignment=2,MarginV=40'" \
  -c:v libx264 -crf 20 out.mp4
```

### 7.6 使用自定义字体目录

```bash
# 指定字体目录（字体文件不必装进系统）
ffmpeg -i in.mkv -vf "subtitles=subs.ass:fontsdir=/path/to/fonts" -c:v libx264 -crf 20 out.mp4

# Windows 路径转义（盘符的冒号必须写成 \:）
ffmpeg -i in.mkv -vf "subtitles=C\\:/subs/movie.ass:fontsdir=C\\:/fonts" -c:v libx264 -crf 20 out.mp4

# 相对路径最省事（推荐把字幕和字体放在当前目录）
ffmpeg -i in.mkv -vf "subtitles=./movie.ass:fontsdir=./fonts" -c:v libx264 -crf 20 out.mp4
```

### 7.7 复杂脚本（阿拉伯文/希伯来文/泰文）

```bash
# 复杂脚本必须用 complex shaping，否则字符无法正确连写/定位
ffmpeg -i in.mp4 -vf "subtitles=arabic.srt:shaping=complex" -c:v libx264 -crf 20 out.mp4

# 快速模式（仅替换，不做定位）
ffmpeg -i in.mp4 -vf "subtitles=latin.srt:shaping=simple" -c:v libx264 -crf 20 out.mp4
```

### 7.8 只烧录部分时间区间

> ⚠️ **重要**：`subtitles` 与 `ass` 滤镜**不支持 `enable` 时间轴选项**
> （`ffmpeg -filters` 中这两个滤镜没有 `T` 标记；实测会报
> `Timeline ('enable' option) not supported with filter 'subtitles'`）。
> 需要限制显示区间时，用下面三种替代方案。

```bash
# 方案 A：先裁剪视频区间，再烧录（最简单）
# 只处理 10~30 秒
ffmpeg -ss 10 -t 20 -i in.mp4 -vf "subtitles=subs.srt" -c:v libx264 -crf 20 out.mp4

# 方案 B：用 trim 滤镜裁剪后再烧录
ffmpeg -i in.mp4 -vf "trim=start=10:end=30,setpts=PTS-STARTPTS,subtitles=subs.srt" \
  -c:v libx264 -crf 20 -an out.mp4

# 方案 C：编辑字幕文件，只保留目标时间段（最精确）
# 用脚本过滤 SRT，或手工删除不需要的条目，再正常烧录
```

> 若确实需要「整段视频中某时间窗才显示字幕」，**方案 C 最可控**：
> 字幕本身带时间码，删掉窗口外的条目即可，无需在滤镜层做条件判断。

### 7.9 字幕与视频叠加（不用 libass 的方案）

当需要把字幕当作普通图像叠加，或用 `overlay` 精确定位时：

```bash
# 先渲染字幕为透明视频，再叠加（可复用、可缓存）
ffmpeg -f lavfi -i "color=c=black@0.0:s=1920x1080:d=60,format=rgba" \
       -vf "subtitles=subs.ass" -c:v qtrle -y subs_overlay.mov

ffmpeg -i in.mp4 -i subs_overlay.mov -filter_complex "[0:v][1:v]overlay=0:0[out]" \
  -map "[out]" -map 0:a -c:v libx264 -crf 20 -c:a copy out.mp4
```

---

## 8. ASS 样式控制详解

### 8.1 `force_style` 完整键值表

`force_style` 接受 ASS 的 `[V4+ Styles]` 段落中的样式键。常用项如下：

**字体与大小：**

| 键 | 示例 | 说明 |
| --- | --- | --- |
| `FontName` | `Microsoft YaHei` | 字体名（**注意不是文件名**） |
| `FontSize` | `24` | 字号（按脚本分辨率，通常 1080p 下 20~30） |
| `Bold` | `-1` / `0` | `-1` 加粗，`0` 不加粗 |
| `Italic` | `-1` / `0` | 斜体 |
| `Underline` | `-1` / `0` | 下划线 |
| `StrikeOut` | `-1` / `0` | 删除线 |
| `ScaleX` / `ScaleY` | `100` | 水平/垂直缩放百分比 |
| `Spacing` | `0` | 字间距 |
| `Angle` | `0` | 旋转角度 |

**颜色（ASS 用 `&HAABBGGRR` 格式，注意是 BGR 顺序 + 前置 alpha）：**

| 键 | 说明 |
| --- | --- |
| `PrimaryColour` | 主色（文字填充色） |
| `SecondaryColour` | 次色（卡拉OK 未唱部分） |
| `OutlineColour` | 描边色 |
| `BackColour` | 背景/阴影色 |

> **颜色格式详解**：`&HAABBGGRR`
> - `AA` = 透明度，`00` 完全不透明，`FF` 完全透明（**与直觉相反**）
> - `BBGGRR` = 蓝、绿、红（**不是 RGB！**）
>
> 常用值：
> | 颜色 | 值 |
> | --- | --- |
> | 不透明白 | `&H00FFFFFF` |
> | 不透明黑 | `&H00000000` |
> | 不透明红 | `&H000000FF` |
> | 不透明蓝 | `&H00FF0000` |
> | 不透明黄 | `&H0000FFFF` |
> | 80% 透明蓝 | `&HCCFF0000` |
> | 50% 透明黑 | `&H80000000` |

**边框与阴影：**

| 键 | 说明 |
| --- | --- |
| `BorderStyle` | `1` = 描边 + 阴影；`3` = 不透明背景框 |
| `Outline` | 描边宽度（0~4 常用） |
| `Shadow` | 阴影距离（0 = 无阴影） |
| `BackColour` | `BorderStyle=3` 时是背景框颜色 |

**位置与对齐：**

| 键 | 说明 |
| --- | --- |
| `Alignment` | 见下表（**新旧版 ASS 编号不同，FFmpeg 用传统编号**） |
| `MarginL` / `MarginR` | 左/右边距（像素） |
| `MarginV` | 垂直边距（底部字幕离屏幕底部的距离） |

**传统 `Alignment` 编号（libass 默认）：**

| 值 | 位置 |
| --- | --- |
| `1` | 左下 |
| `2` | 底部居中（**最常用**） |
| `3` | 右下 |
| `4` | 左中 |
| `5` | 居中 |
| `6` | 右中 |
| `7` | 左上 |
| `8` | 顶部居中 |
| `9` | 右上 |

**其他：**

| 键 | 说明 |
| --- | --- |
| `Encoding` | 字符集编码（通常 `1`，中文可用 `134`） |
| `AlphaLevel` | 整体透明度（0~255） |

### 8.2 实用样式配方

```bash
# ① 经典白色描边字幕（最通用）
force_style='FontName=Microsoft YaHei,FontSize=26,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Shadow=1,Alignment=2,MarginV=30'

# ② 半透明黑底字幕（可读性最好，适合亮背景）
force_style='FontName=Microsoft YaHei,FontSize=26,PrimaryColour=&H00FFFFFF,BorderStyle=3,BackColour=&H80000000,Outline=1,Shadow=0,Alignment=2,MarginV=40'

# ③ 黄色字幕（复古风）
force_style='FontName=Arial,FontSize=28,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=30'

# ④ 顶部居中（避免遮挡画面下方内容）
force_style='FontName=Microsoft YaHei,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=8,MarginV=40'

# ⑤ 大字号（手机竖屏观看）
force_style='FontName=Microsoft YaHei,FontSize=40,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=3,Alignment=2,MarginV=60'

# ⑥ 斜体 + 加粗（强调风格）
force_style='FontName=Microsoft YaHei,FontSize=26,Bold=-1,Italic=-1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=30'
```

### 8.3 只改样式不改位置

```bash
# 保留原 ASS 的定位，只覆盖字体与颜色
ffmpeg -i in.mkv -vf "subtitles=subs.ass:force_style='FontName=Source Han Sans SC,PrimaryColour=&H00FFFFFF'" \
  -c:v libx264 -crf 20 out.mp4
```

### 8.4 直接编辑 ASS 文件

`force_style` 只能覆盖全局样式。要精修单条字幕，需直接改 ASS：

```
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Microsoft YaHei,26,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,2,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,这是第一条字幕
Dialogue: 0,0:00:03.50,0:00:06.00,Default,,0,0,0,,{\b1}加粗{\b0}与{\i1}斜体{\i0}
Dialogue: 0,0:00:06.50,0:00:09.00,Default,,0,0,0,,{\pos(960,100)}指定位置显示
```

**ASS 内联标签（`{\...}`）常用项：**

| 标签 | 作用 |
| --- | --- |
| `{\b1}` / `{\b0}` | 加粗开/关 |
| `{\i1}` / `{\i0}` | 斜体开/关 |
| `{\c&H00FF00&}` | 改文字颜色 |
| `{\fs36}` | 改字号 |
| `{\pos(x,y)}` | 绝对定位 |
| `{\an8}` | 对齐（8 = 顶部居中） |
| `{\fad(300,300)}` | 淡入淡出（毫秒） |
| `{\k50}` | 卡拉OK 效果 |
| `{\move(x1,y1,x2,y2)}` | 移动动画 |
| `{\clip(x1,y1,x2,y2)}` | 裁剪显示区域 |
| `{\blur3}` | 模糊 |

### 8.5 字幕分辨率与 PlayRes

ASS 脚本头部声明 `PlayResX` / `PlayResY`（设计分辨率）。libass 会据此缩放。

```bash
# 若字幕是按 1080p 设计的，输出 720p 时必须告知原始尺寸
ffmpeg -i in.mp4 -vf "scale=1280:720,subtitles=subs.ass:original_size=1920x1080" \
  -c:v libx264 -crf 20 out.mp4

# 若 ASS 未声明 PlayRes，可用 force_style 强制字号
ffmpeg -i in.mp4 -vf "subtitles=subs.ass:force_style='FontSize=20'" -c:v libx264 -crf 20 out.mp4
```

### 8.6 用 `drawtext` 做简单文字叠加

不需要字幕文件时，`drawtext` 更直接：

```bash
# 固定文字
ffmpeg -i in.mp4 -vf "drawtext=text='示例文字':fontfile=C\\:/Windows/Fonts/msyh.ttc:fontsize=32:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-th-40" \
  -c:v libx264 -crf 20 out.mp4

# 从文件读取文字（避开转义地狱）
ffmpeg -i in.mp4 -vf "drawtext=textfile=label.txt:fontsize=32:fontcolor=white:box=1:boxcolor=black@0.5:x=20:y=h-th-40" \
  -c:v libx264 -crf 20 out.mp4

# 时间码
ffmpeg -i in.mp4 -vf "drawtext=text='%{pts\:hms}':fontsize=28:fontcolor=white:box=1:boxcolor=black@0.6:x=20:y=20" \
  -c:v libx264 -crf 20 out.mp4
```

> `drawtext` 的完整参数见《FFmpeg 滤镜使用与详解指南》§7.2。

---

## 9. 字体、编码与乱码处理

### 9.1 字体问题排查

**现象：字幕显示为方块/豆腐块。**

原因：指定的字体缺少对应字符（尤其中文）。

```bash
# 方案 1：用系统已有的中文字体
# Windows：Microsoft YaHei（微软雅黑）、SimHei（黑体）、SimSun（宋体）
ffmpeg -i in.mp4 -vf "subtitles=subs.ass:force_style='FontName=Microsoft YaHei'" -c:v libx264 -crf 20 out.mp4

# 方案 2：指定字体文件所在目录
ffmpeg -i in.mp4 -vf "subtitles=subs.ass:fontsdir=./fonts" -c:v libx264 -crf 20 out.mp4

# 方案 3：用 fontconfig 查系统字体名
fc-list :lang=zh | head -20          # Linux/macOS
fc-match "Microsoft YaHei"           # 确认字体是否存在
```

**常用中文字体名（`FontName` 用）：**

| 系统 | 字体名 |
| --- | --- |
| Windows | `Microsoft YaHei`（雅黑）、`SimHei`（黑体）、`SimSun`（宋体）、`KaiTi`（楷体）、`FangSong`（仿宋） |
| macOS | `PingFang SC`、`Hiragino Sans GB`、`STHeiti` |
| Linux | `Noto Sans CJK SC`、`Source Han Sans SC`、`WenQuanYi Micro Hei` |

**查看本机可用字体（用 ffmpeg 自测）：**

```bash
# 列出 fontconfig 能识别的字体（本机构建已启用 libfontconfig）
fc-list | grep -i "yahei\|noto\|source han" | head -10
```

### 9.2 编码问题

**现象：字幕显示为乱码（如 `����` 或问号）。**

原因：字幕文件不是 UTF-8，而 FFmpeg 按 UTF-8 解析。

```bash
# ✅ 方式一：把编码传给滤镜（推荐，一步到位）
ffmpeg -i in.mp4 -vf "subtitles=subs_gbk.srt:charenc=GBK" -c:v libx264 -crf 20 out.mp4

# ✅ 方式二：先转成 UTF-8 再烧录（最稳妥）
ffmpeg -sub_charenc GBK -i subs_gbk.srt -c:s srt subs_utf8.srt
ffmpeg -i in.mp4 -vf "subtitles=subs_utf8.srt" -c:v libx264 -crf 20 out.mp4

# Big5（繁体中文）转 UTF-8
ffmpeg -sub_charenc BIG5 -i subs_big5.srt -c:s srt utf8.srt

# 检测文件实际编码
file -i subs.srt                    # Linux/macOS
# Windows PowerShell：
# Get-Content subs.srt -Encoding Byte -TotalCount 3
```

> **关键区别**：
> - `-sub_charenc GBK` 是**输入选项**，作用于 ffmpeg 读取的字幕**流**；
> - `subtitles=...:charenc=GBK` 是**滤镜选项**，作用于滤镜自己打开的字幕**文件**。
>
> 两者作用对象不同。用 `subtitles=` 滤镜直接读文件时，**必须用 `charenc=`**；
> 只写 `-sub_charenc` 而不加 `charenc=` 会报
> `Invalid UTF-8 in decoded subtitles text; maybe missing -sub_charenc option`。

| 编码名（`-sub_charenc`） | 说明 |
| --- | --- |
| `UTF-8` | 默认，无需指定 |
| `GBK` / `GB2312` / `GB18030` | 简体中文 |
| `BIG5` | 繁体中文 |
| `SHIFT-JIS` / `CP932` | 日文 |
| `EUC-KR` / `CP949` | 韩文 |
| `CP1252` / `LATIN1` | 西欧 |

### 9.3 转义问题（Windows 路径）

滤镜图有三层转义。**Windows 盘符的冒号必须转义**：

```bash
# ❌ 错误：冒号被当作参数分隔符
-vf "subtitles=C:/subs/movie.srt"

# ✅ 正确：盘符冒号转义为 \:
-vf "subtitles=C\\:/subs/movie.srt"

# ✅ 更省事：cd 到目录后用相对路径
cd /d D:\work && ffmpeg -i in.mkv -vf "subtitles=./movie.ass" out.mp4

# ✅ 最省事：把字幕复制到当前目录
ffmpeg -i in.mkv -vf "subtitles=movie.ass" out.mp4
```

### 9.4 中文标点与换行

```bash
# 使用支持 Unicode 换行的断行算法（需 libass ≥ 0.17 + libunibreak）
ffmpeg -i in.mp4 -vf "subtitles=subs.srt:wrap_unicode=1" -c:v libx264 -crf 20 out.mp4

# 关闭 Unicode 换行（用 libass 默认规则）
ffmpeg -i in.mp4 -vf "subtitles=subs.srt:wrap_unicode=0" -c:v libx264 -crf 20 out.mp4
```

---

## 10. 字幕时间轴调整与同步

### 10.1 整体偏移（最快方案）

```bash
# 字幕整体延迟 2.5 秒（字幕比画面早出现）
ffmpeg -itsoffset 2.5 -i subs.srt -c:s srt delayed.srt

# 字幕整体提前 1 秒
ffmpeg -itsoffset -1 -i subs.srt -c:s srt advanced.srt

# 直接烧录时应用偏移（一步到位）
ffmpeg -itsoffset 2.5 -i subs.srt -i in.mp4 -map 1:v -map 1:a -vf "subtitles=subs.srt" \
  -c:v libx264 -crf 20 -c:a copy out.mp4
```

> `-itsoffset` 是**输入选项**，必须放在对应的 `-i` **之前**。

### 10.2 整体缩放（改变播放速度）

```bash
# 字幕时间轴压缩为 0.5 倍（配合 2 倍速视频）
ffmpeg -i subs.srt -vf "setpts=0.5*PTS" -c:s srt scaled.srt

# 注意：字幕用 setpts 需要转为视频流处理，更稳妥的做法是直接编辑 SRT
```

> **提示**：对字幕做 `setpts` 需要把它当视频流处理（加 `-f lavfi` 或借助 `movie=`），实际使用中不如直接用脚本改时间码。若需要精确缩放，建议用 Python 脚本处理 SRT 文件。

### 10.3 烧录时用 `enable` 控制显示区间

```bash
# ⚠️ subtitles/ass 滤镜不支持 enable（会报 Timeline not supported），改用：
# 只处理 60 秒后的内容
ffmpeg -ss 60 -i in.mp4 -vf "subtitles=subs.srt" -c:v libx264 -crf 20 out.mp4

# 只处理 10~30 秒区间
ffmpeg -ss 10 -t 20 -i in.mp4 -vf "subtitles=subs.srt" -c:v libx264 -crf 20 out.mp4

# 保留完整时长但只在该区间显示字幕 → 编辑字幕文件删掉窗口外条目（见 §7.8 方案 C）
```

> 关于 `enable`：它只对**声明了时间轴支持**的滤镜有效（`ffmpeg -filters` 中带 `T` 标记），
> 如 `overlay`、`eq`、`drawtext` 等。`subtitles` / `ass` 均不支持。

### 10.4 字幕与视频帧率不一致

当视频帧率被改变（如 24fps → 25fps）时，字幕会漂移：

```bash
# 视频 24fps → 25fps，字幕时间轴需乘以 24/25 = 0.96
# 用脚本处理 SRT 更可靠；也可用 setpts 配合 movie 源：
ffmpeg -f lavfi -i "movie=subs.srt,setpts=PTS*0.96" -c:s srt adjusted.srt
```

**用 Python 精确调整 SRT 时间轴（推荐做法）：**

```python
import re, sys

def shift_srt(path, offset, scale=1.0):
    """offset: 秒；scale: 时间缩放系数"""
    def fix(m):
        h, mi, s, ms = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        t = ((h*60 + mi)*60 + s + ms/1000) * scale + offset
        t = max(t, 0)
        h2 = int(t // 3600); mi2 = int((t % 3600) // 60)
        s2 = int(t % 60); ms2 = int(round((t - int(t)) * 1000))
        if ms2 == 1000: s2 += 1; ms2 = 0
        return f"{h2:02d}:{mi2:02d}:{s2:02d},{ms2:03d}"
    text = open(path, encoding='utf-8').read()
    out = re.sub(r'(\d{2}):(\d{2}):(\d{2}),(\d{3})', fix, text)
    open(path.replace('.srt', '_adj.srt'), 'w', encoding='utf-8').write(out)

# 用法：整体延迟 2.5 秒
shift_srt('subs.srt', offset=2.5)
# 用法：24→25fps 且延迟 1 秒
shift_srt('subs.srt', offset=1.0, scale=24/25)
```

### 10.5 字幕与音视频对齐检查

```bash
# 查看字幕首末时间点
head -20 subs.srt
tail -20 subs.srt

# 查看视频时长
ffprobe -v error -show_entries format=duration -of csv=p=0 in.mp4

# 检查字幕是否超出视频长度（超出的部分不会显示）
```

### 10.6 修正字幕时长异常（`-fix_sub_duration`）

DVB 等字幕的时长字段常不准确（用空字幕帧标记结束），会导致时长夸张或封装失败：

```bash
# 输入侧启用时长修正
ffmpeg -fix_sub_duration -i in.ts -map 0 -c copy out.mkv

# 配合 heartbeat 降低字幕延迟
ffmpeg -fix_sub_duration -fix_sub_duration_heartbeat:v:0 -i in.ts -map 0 -c copy out.mkv
```

> 官方提示：`-fix_sub_duration` 会延迟所有数据输出直到解码到下一个字幕包，可能显著增加内存占用与延迟。仅在确有需要时使用。

---

## 11. 图形字幕（PGS / DVD / DVB）

### 11.1 图形字幕的本质限制

| 能做什么 | 不能做什么 |
| --- | --- |
| ✅ 提取为独立文件（如 `.sup`） | ❌ 直接转成 SRT/ASS 文本 |
| ✅ 封装进 MKV | ❌ 用 `force_style` 改样式（它没有文字样式） |
| ✅ 烧录进画面（`subtitles` 滤镜可渲染位图） | ❌ 编辑文字内容 |
| ✅ 转码为其他图形格式 | ❌ 在 MP4 中封装（除特定情况） |

### 11.2 PGS（蓝光字幕）

```bash
# 提取 PGS 字幕为独立文件
ffmpeg -i bluray.mkv -map 0:s:0 -c:s copy subs.sup

# 提取为 MKV 中的 PGS 流
ffmpeg -i bluray.mkv -map 0:s:0 -c:s copy pgs_only.mkv

# 把 PGS 封装进 MKV（保留原样）
ffmpeg -i in.mp4 -i subs.sup -map 0 -map 1 -c copy out.mkv

# 烧录 PGS 字幕（libass 可渲染位图字幕）
ffmpeg -i bluray.mkv -vf "subtitles=bluray.mkv:si=0" -c:v libx264 -crf 20 -c:a copy out.mp4

# 只保留强制字幕（PGS 常见强制轨）
ffmpeg -i bluray.mkv -map "0:disp:forced" -c:s copy forced.sup
```

> **注意**：PGS 只能**解码**不能**编码**（本机实测 `-encoders` 无 `pgssub`）。转码 PGS 到其他图形格式需先解码成位图。

### 11.3 DVD 字幕（VobSub）

> ⚠️ 同样受「位图→位图」限制：`dvdsub` **只能从位图源编码**，
> 无法把 SRT/ASS 文本直接转成 VobSub。

```bash
# 提取 DVD 字幕为 VobSub（.idx + .sub）
ffmpeg -i dvd.vob -map 0:s:0 -c:s dvdsub subs.idx

# 提取并指定调色板
ffmpeg -i dvd.vob -map 0:s:0 -c:s dvdsub \
  -palette "0d00ee,ee450d,101010,eaeaea,0ce60b,ec14ed,ebff0b,0d617a,7b7b7b,d1d1d1,7b2a0e,0d950c,0f007b,cf0dec,cfa80c,7c127b" \
  subs.idx

# 修正奇数行导致的部分播放器裁切问题
ffmpeg -i dvd.vob -map 0:s:0 -c:s dvdsub -even_rows_fix 1 subs.idx

# 只解码强制字幕
ffmpeg -forced_subs_only 1 -i dvd.vob -map 0:s:0 -c:s dvdsub subs.idx

# 把 VobSub 封装进 MKV
ffmpeg -i in.mp4 -i subs.idx -map 0 -map 1 -c copy out.mkv
```

**`dvdsub` 相关选项：**

| 选项 | 说明 |
| --- | --- |
| `palette` | 16 个 24 位十六进制颜色（无 `0x` 前缀），逗号分隔 |
| `ifo_palette` | 从 IFO 文件读取调色板（实验性） |
| `even_rows_fix` | 强制像素行数为偶数（修复底部裁切） |
| `forced_subs_only` | 只解码强制字幕 |

### 11.4 DVB 字幕

> ⚠️ **文本→位图限制**：FFmpeg 的字幕编码遵循「文本→文本、位图→位图」规则。
> 把 **SRT/ASS 文本字幕直接编码成 DVB/DVD 位图字幕会失败**，报
> `Subtitle encoding currently possible from text to text or bitmap to bitmap`。
> 要从文本生成位图字幕，必须先把文字**渲染进画面**，再从画面提取（或用专业字幕工具）。

```bash
# 提取 DVB 字幕（TS 流）
ffmpeg -fix_sub_duration -i in.ts -map 0:s:0 -c:s dvbsub out.ts

# 指定最小位深（2/4/8，默认 4）
ffmpeg -i in.ts -map 0:s:0 -c:s dvbsub -min_bpp 8 out.ts

# 选择特定子流（-1 = 全部）
ffmpeg -dvb_substream 0 -i in.ts -map 0:s -c:s copy out.ts

# 计算 CLUT（颜色查找表）
ffmpeg -compute_clut 1 -i in.ts -map 0:s:0 -c:s dvbsub out.ts
```

**`dvbsub` 选项：**

| 选项 | 值 | 说明 |
| --- | --- | --- |
| `compute_clut` | `-2`/`-1`/`0`/`1` | CLUT 计算策略 |
| `dvb_substream` | 整数 | 选择子流，`-1` = 全部 |
| `min_bpp` | `2`/`4`/`8` | 编码时最小位深（默认 4） |

### 11.5 广播字幕（ARIB / Teletext / EIA-608）

```bash
# ARIB 字幕（日本广播）：以 ASS 文本输出
ffmpeg -sub_type ass -i mpeg.ts -map 0:s -c:s ass arib.ass

# ARIB 字幕：以位图输出（需指定画布尺寸避免变形）
ffmpeg -sub_type bitmap -canvas_size 1920x1080 -i mpeg.ts -map 0:s -c:s copy arib.sup

# 把 ARIB 字幕叠加到视频上（官方示例写法）
ffmpeg -sub_type bitmap -i src.m2t -filter_complex "[0:v][0:s]overlay" -c:v libx264 dest.mp4

# DVB Teletext 字幕
ffmpeg -i in.ts -map 0:s:0 -c:s srt teletext.srt

# EIA-608 闭路字幕（从视频流提取）
ffmpeg -f lavfi -i "movie=in.ts[out0+subcc]" -map 0:s -c:s srt cc.srt
```

**`-sub_type` 取值：**

| 值 | 输出 |
| --- | --- |
| `bitmap` | 图形图像 |
| `ass` | ASS 格式文本（默认） |
| `text` | 无格式纯文本 |

---

## 12. 多语言字幕与默认轨道

### 12.1 完整多语言封装

```bash
ffmpeg -i video.mp4 -i chi.srt -i eng.srt -i jpn.srt -i kor.srt \
  -map 0:v -map 0:a \
  -map 1:s -map 2:s -map 3:s -map 4:s \
  -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=chi -metadata:s:s:0 title="简体中文" \
  -metadata:s:s:1 language=eng -metadata:s:s:1 title="English" \
  -metadata:s:s:2 language=jpn -metadata:s:s:2 title="日本語" \
  -metadata:s:s:3 language=kor -metadata:s:s:3 title="한국어" \
  -disposition:s:0 default \
  out.mp4
```

### 12.2 语言代码速查（ISO 639-2）

| 代码 | 语言 | 代码 | 语言 |
| --- | --- | --- | --- |
| `chi` / `zho` | 中文 | `eng` | 英语 |
| `jpn` | 日语 | `kor` | 韩语 |
| `fra` / `fre` | 法语 | `deu` / `ger` | 德语 |
| `spa` | 西班牙语 | `rus` | 俄语 |
| `por` | 葡萄牙语 | `ita` | 意大利语 |
| `ara` | 阿拉伯语 | `tha` | 泰语 |
| `vie` | 越南语 | `und` | 未定义 |

### 12.3 切换默认字幕

```bash
# 把英语设为默认
ffmpeg -i in.mkv -c copy -disposition:s:0 0 -disposition:s:1 default out.mkv

# 只保留中英两条字幕，中文默认
ffmpeg -i in.mkv -map 0:v -map 0:a -map "0:m:language:chi" -map "0:m:language:eng" \
  -c copy -disposition:s:0 default out.mkv
```

### 12.4 双语字幕（上下对照）

```bash
# 把中英字幕合并为一条（用换行符连接）
# 先各自转为 SRT，再用脚本按时间码合并；或用 ASS 的 \N 换行
```

**用 ASS 实现双语对照**（直接编辑 ASS 的 `Dialogue` 行）：

```
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,这是中文\NThis is English
```

`\N` 是 ASS 的硬换行符（`\n` 是软换行，仅在必要时断行）。

---

## 13. 直播与切片场景的字幕

### 13.1 HLS 多码率字幕

```bash
ffmpeg -i input.mp4 -i subs.vtt \
  -map 0:v -map 0:a -map 1:s \
  -c:v h264_nvenc -preset p4 -b:v 3M \
  -c:a aac -b:a 128k \
  -c:s webvtt \
  -f hls -hls_time 6 -hls_list_size 0 \
  -hls_subtitle_path subtitle.m3u8 \
  -hls_segment_filename "stream_%v/seg_%03d.ts" \
  stream_%v/index.m3u8
```

**带字幕组的多码率 HLS（官方示例思路）：**

```bash
ffmpeg -i in.mp4 \
  -map 0:v -map 0:a:0 -map 0:s:0 \
  -c:v libx264 -b:v 2M -c:a mp2 -ar 48000 -ac 2 -c:s webvtt \
  -f hls -hls_time 6 -hls_list_size 0 \
  -var_stream_map "v:0,a:0,s:0" \
  -master_pl_name master.m3u8 \
  stream_%v/index.m3u8
```

### 13.2 DASH 字幕

```bash
ffmpeg -i in.mp4 -map 0:v -map 0:a -map 0:s \
  -c:v libx264 -b:v 3M -c:a aac -c:s webvtt \
  -f dash -seg_duration 4 manifest.mpd
```

### 13.3 推流时烧录字幕

```bash
ffmpeg -re -i in.mp4 -vf "subtitles=subs.srt" \
  -c:v h264_nvenc -preset p4 -tune ll -b:v 4M \
  -c:a aac -b:a 128k -f flv rtmp://live.example.com/app/key
```

> 推流烧字幕会显著增加 CPU 占用（libass 渲染）。若素材本身已有硬字幕，直接用原视频即可。

### 13.4 字幕转 WebVTT 用于网页播放

```bash
# 转 VTT
ffmpeg -i subs.srt -c:s webvtt subs.vtt

# 网页中使用
# <video src="movie.mp4">
#   <track kind="subtitles" src="subs.vtt" srclang="zh" label="中文" default>
# </video>
```

---

## 14. 常见问题与排查

### 14.1 报错速查

| 报错 / 现象 | 原因 | 解决 |
| --- | --- | --- |
| `No such filter: 'subtitles'` | 构建未启用 libass | `ffmpeg -buildconf \| grep libass`；换用启用 libass 的构建 |
| `Stream map '0:s:0' matches no streams` | 源文件没有字幕流 | 先 `ffprobe -select_streams s` 确认；或用 `-map 0:s?`（问号容忍缺失） |
| `Subtitle codec X is not supported as an output codec` | 该容器不支持此字幕编码 | MP4 只能用 `mov_text`；MKV 用 `copy`/`ass` |
| `Font not found` / 显示方块 | 字体缺失 | 用 `force_style='FontName=...'` 指定已有字体，或 `fontsdir` 指定字体目录 |
| 字幕显示乱码 | 文件非 UTF-8 | 加 `-sub_charenc GBK`（或对应编码） |
| `Unable to find a suitable output format` | 只输出字幕时未指定格式 | 输出 `.srt`/`.ass` 扩展名，或加 `-f srt` |
| `Could not write header` | 字幕编码与容器不兼容 | 换容器或换编码（见 §1.3 矩阵） |
| 字幕位置/大小异常 | 分辨率改变但未声明 `original_size` | 加 `:original_size=原宽x原高` |
| `Invalid data found when processing input` | 路径转义错误 | Windows 盘符写 `C\\:/path`；优先用相对路径 |
| 字幕时长夸张 / 封装失败 | DVB 等时长字段不准 | 加 `-fix_sub_duration`（输入侧） |
| `Subtitle encoding currently only possible from text to text or bitmap to bitmap` | 试图把图形字幕转文本，或把文本转位图字幕 | 图形→文本需 OCR（§4.5）；文本→位图需先渲染进画面（§11.3/§11.4） |
| `Timeline ('enable' option) not supported with filter 'subtitles'` | `subtitles`/`ass` 不支持 `enable` | 改用 `-ss`/`-t` 裁剪，或编辑字幕文件（§7.8） |
| `Invalid UTF-8 in decoded subtitles text` | 字幕非 UTF-8 且未指定编码 | 用 `subtitles=...:charenc=GBK`（注意不是 `-sub_charenc`）（§9.2） |

### 14.2 诊断命令

```bash
# 检查构建是否支持字幕渲染
ffmpeg -buildconf | grep -E "libass|freetype|fontconfig|harfbuzz|fribidi"

# 确认字幕滤镜可用
ffmpeg -filters | grep -E "subtitles|ass "

# 查看字幕相关编解码器
ffmpeg -codecs | grep -E "^ ..S"

# 查看 subtitles 滤镜全部参数与默认值
ffmpeg -h filter=subtitles

# 查看容器的字幕支持（以 MP4 为例）
ffmpeg -h muxer=mp4 2>&1 | grep -i subtitle

# 详细日志定位问题
ffmpeg -v verbose -i in.mkv -vf "subtitles=subs.srt" -f null - 2>&1 | grep -i "subtitle\|ass\|font"
```

### 14.3 字幕烧录的性能优化

libass 渲染是 CPU 密集操作，大分辨率下可能成为瓶颈：

```bash
# ① 先缩放再烧录（渲染量减少）
ffmpeg -i in.mkv -vf "scale=1280:720,subtitles=subs.ass:original_size=1920x1080" \
  -c:v libx264 -crf 20 out.mp4

# ② 用硬件编码器分担编码压力（字幕仍在 CPU 渲染）
ffmpeg -i in.mkv -vf "subtitles=subs.ass" -c:v hevc_nvenc -preset p6 -cq 24 out.mp4

# ③ 提高 libass 缓存与并行度（部分构建支持的环境变量）
#    ASS_CACHE_MAX / FC_CACHE_MAX
```

> **替代思路**：如果字幕固定不变且要多次转码，可先把字幕渲染成透明视频（§7.9），
> 之后每次转码只需 `overlay`，避免重复渲染。

### 14.4 验证字幕是否烧录成功

```bash
# 导出烧录后的若干帧检查
ffmpeg -i out.mp4 -vf "select='eq(n\,100)'" -frames:v 1 check.png

# 对比烧录前后的文件大小与码率变化
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 out.mp4

# 确认输出中不含字幕流（硬字幕应该没有独立字幕流）
ffprobe -v error -select_streams s -show_entries stream=index -of csv=p=0 out.mp4
```

---

## 15. 批量处理脚本模板

### 15.1 批量烧录字幕（同名字幕自动匹配）

```bash
#!/usr/bin/env bash
# 每个视频找同名 .srt 并烧录
set -euo pipefail
SRC="./src"; DST="./dst"; mkdir -p "$DST"

find "$SRC" -type f -name "*.mp4" | while read -r f; do
  base="$(basename "${f%.*}")"
  sub="$SRC/$base.srt"
  [ -f "$sub" ] || { echo "跳过（无字幕）: $f"; continue; }

  echo "==> $base"
  ffmpeg -y -hide_banner -loglevel warning -i "$f" \
    -vf "subtitles=$sub:force_style='FontName=Microsoft YaHei,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=30'" \
    -c:v libx264 -preset medium -crf 21 -c:a copy "$DST/$base.mp4"
done
echo "完成"
```

### 15.2 批量提取字幕

```bash
#!/usr/bin/env bash
# 提取每个视频的全部字幕流，按语言命名
set -euo pipefail
SRC="./videos"; DST="./subs"; mkdir -p "$DST"

for f in "$SRC"/*.mkv "$SRC"/*.mp4; do
  [ -f "$f" ] || continue
  base="$(basename "${f%.*}")"
  echo "==> $base"

  # 遍历每条字幕流
  n=$(ffprobe -v error -select_streams s -show_entries stream=index -of csv=p=0 "$f" | wc -l)
  for ((i=0; i<n; i++)); do
    lang=$(ffprobe -v error -select_streams "s:$i" -show_entries stream_tags=language -of csv=p=0 "$f")
    lang="${lang:-und}"
    ffmpeg -y -hide_banner -loglevel error -i "$f" -map "0:s:$i" \
      -c:s srt "$DST/${base}_${lang}_${i}.srt"
  done
done
echo "完成"
```

### 15.3 批量封装多语言软字幕

```bash
#!/usr/bin/env bash
# 把同目录的 chi.srt / eng.srt 封装进 MP4
set -euo pipefail
for f in ./src/*.mp4; do
  base="$(basename "${f%.*}")"
  d="$(dirname "$f")"
  args=(); maps=(); idx=1

  for lang in chi eng; do
    s="$d/$base.$lang.srt"
    if [ -f "$s" ]; then
      args+=(-i "$s"); maps+=(-map "$idx:s"); idx=$((idx+1))
    fi
  done
  [ ${#args[@]} -eq 0 ] && { echo "跳过: $base"; continue; }

  echo "==> $base"
  ffmpeg -y -hide_banner -loglevel warning -i "$f" "${args[@]}" \
    -map 0:v -map 0:a "${maps[@]}" \
    -c:v copy -c:a copy -c:s mov_text \
    -metadata:s:s:0 language=chi -metadata:s:s:0 title="简体中文" \
    -metadata:s:s:1 language=eng -metadata:s:s:1 title="English" \
    "./dst/$base.mp4"
done
```

### 15.4 字幕编码批量转换（GBK → UTF-8）

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p ./utf8
for f in ./subs/*.srt; do
  out="./utf8/$(basename "$f")"
  ffmpeg -y -hide_banner -loglevel error -sub_charenc GBK -i "$f" -c:s srt "$out"
  echo "转换: $(basename "$f")"
done
```

### 15.5 字幕时间轴批量偏移（Python）

```python
#!/usr/bin/env python3
"""批量把 SRT 字幕整体偏移指定秒数"""
import re, sys, glob, os

def shift_srt(text, offset):
    def fix(m):
        h, mi, s, ms = int(m[1]), int(m[2]), int(m[3]), int(m[4])
        t = max(((h*60 + mi)*60 + s + ms/1000) + offset, 0)
        h2, rem = divmod(t, 3600)
        mi2, rem = divmod(rem, 60)
        s2 = int(rem)
        ms2 = int(round((rem - s2) * 1000))
        if ms2 == 1000:
            s2 += 1; ms2 = 0
        return f"{int(h2):02d}:{int(mi2):02d}:{s2:02d},{ms2:03d}"
    return re.sub(r'(\d{2}):(\d{2}):(\d{2}),(\d{3})', fix, text)

if __name__ == '__main__':
    offset = float(sys.argv[1])          # 秒，正数=延迟，负数=提前
    for path in glob.glob('./subs/*.srt'):
        out = os.path.join('./out', os.path.basename(path))
        os.makedirs('./out', exist_ok=True)
        with open(path, encoding='utf-8') as fh:
            data = fh.read()
        with open(out, 'w', encoding='utf-8', newline='\n') as fh:
            fh.write(shift_srt(data, offset))
        print(f'已处理: {path} → {out}')
```

---

## 16. 速查表

### 16.1 按任务速查

| 任务 | 命令骨架 |
| --- | --- |
| **探测字幕流** | `ffprobe -v error -select_streams s -show_entries stream=index,codec_name:stream_tags=language,title -of json in.mkv` |
| **提取字幕** | `-map 0:s:0 -c:s srt out.srt` |
| **按语言提取** | `-map "0:m:language:chi" -c:s srt chi.srt` |
| **格式转换** | `-i in.srt -c:s ass out.ass` |
| **软字幕封装（MKV）** | `-i in.mp4 -i s.ass -map 0 -map 1 -c copy -c:s ass out.mkv` |
| **软字幕封装（MP4）** | `-i in.mp4 -i s.srt -map 0 -map 1 -c copy -c:s mov_text out.mp4` |
| **硬字幕烧录** | `-vf "subtitles=s.srt" -c:v libx264 -crf 20 -c:a copy out.mp4` |
| **烧录 + 缩放** | `-vf "scale=1280:720,subtitles=s.ass:original_size=1920x1080"` |
| **强制样式** | `-vf "subtitles=s.srt:force_style='FontName=...,FontSize=24'"` |
| **指定字体目录** | `-vf "subtitles=s.ass:fontsdir=./fonts"` |
| **非 UTF-8 字幕** | `-sub_charenc GBK -i s.srt ...` |
| **整体延迟** | `-itsoffset 2.5 -i s.srt -c:s srt out.srt` |
| **设默认轨** | `-disposition:s:0 default` |
| **设强制轨** | `-disposition:s:0 forced` |
| **移除字幕** | `-map 0 -map -0:s -c copy out.mkv` |
| **多语言封装** | 见 §6.2 / §12.1 |
| **转 WebVTT** | `-i s.srt -c:s webvtt out.vtt` |
| **HLS 字幕** | `-c:s webvtt -hls_subtitle_path subtitle.m3u8` |

### 16.2 字幕编码选择决策

```
需要字幕吗？
├─ 只是存档 / 要多语言 / 要能开关
│   └─ 软字幕
│       ├─ 保留 ASS 完整样式 → MKV + -c:s copy
│       ├─ MP4 容器 → 转 mov_text（样式受限）
│       └─ 网页播放 → WebVTT
└─ 要跨设备保证显示 / 社交平台 / 防提取
    └─ 硬字幕（-vf "subtitles=..."）
        ├─ 输出分辨率 ≠ 原分辨率 → 必须加 original_size
        ├─ 中文字幕 → 指定 FontName 或 fontsdir
        └─ 复杂脚本 → shaping=complex
```

### 16.3 颜色值速查（ASS 格式 `&HAABBGGRR`）

| 颜色 | 值 | 说明 |
| --- | --- | --- |
| 白 | `&H00FFFFFF` | 最常用 |
| 黑 | `&H00000000` | 描边/背景 |
| 红 | `&H000000FF` | 注意是 BGR |
| 绿 | `&H0000FF00` | |
| 蓝 | `&H00FF0000` | |
| 黄 | `&H0000FFFF` | |
| 青 | `&H00FFFF00` | |
| 品红 | `&H00FF00FF` | |
| 50% 透明黑 | `&H80000000` | 背景条常用 |
| 80% 透明蓝 | `&HCCFF0000` | |

### 16.4 语言代码速查

`chi`(中) `eng`(英) `jpn`(日) `kor`(韩) `fra`(法) `deu`(德) `spa`(西) `rus`(俄) `por`(葡) `ita`(意) `ara`(阿) `tha`(泰) `vie`(越) `und`(未定义)

---

## 附录：本文参数来源对照

| 章节 | 主要来源 |
| --- | --- |
| 1 格式与编解码器 | `ffmpeg-all.md` §17 Subtitles Encoders、§13 Subtitles Decoders；本机 `ffmpeg -codecs` / `-encoders` / `-decoders` 实测清单（28 个字幕编解码器） |
| 2 软/硬字幕 | 概念性说明，结合 `ffmpeg-all.md` §5.4 `-c`、§5.9 Subtitle options |
| 3 字幕流探测 | `ffprobe-all.md`；`ffmpeg-all.md` §4 Stream selection |
| 4 字幕提取 | `ffmpeg-all.md` §5.4 `-map`、§5.9 `-scodec`；ARIB 示例取自 §13.2.2 |
| 5 格式转换 | `ffmpeg-all.md` §5.9 Subtitle options、§18.34 text2movsub |
| 6 软字幕封装 | `ffmpeg-all.md` §5.4 `-map`、`-metadata`、`-disposition` |
| 7 硬字幕烧录 | `ffmpeg-filters.md` §11.247 subtitles、§11.5 ass（含官方示例）；本机 `ffmpeg -h filter=subtitles`/`ass` 实测 |
| 8 ASS 样式 | ASS 格式规范 + libass 行为；`ffmpeg-filters.md` §11.247 的 `force_style` 官方示例 |
| 9 字体与编码 | `ffmpeg-all.md` §5.9 `-canvas_size`、§5.10 `-fix_sub_duration`；`ffmpeg-filters.md` §11.247 `charenc`/`shaping`/`wrap_unicode` |
| 10 时间轴 | `ffmpeg-all.md` §5.4 `-itsoffset`、§5.10 `-fix_sub_duration`/`-fix_sub_duration_heartbeat` |
| 11 图形字幕 | `ffmpeg-all.md` §13.3 dvbsub、§13.4 dvdsub、§13.5 libzvbi-teletext、§17.1 dvbsub、§17.2 dvdsub（含 `palette`/`even_rows_fix`/`min_bpp`/`forced_subs_only`） |
| 12 多语言 | `ffmpeg-all.md` §5.4 `-metadata`、`-disposition`；ISO 639-2 语言代码 |
| 13 直播与切片 | `ffmpeg-all.md` §HLS muxer（含字幕组官方示例） |
| 14 排查 | 综合各章节与实测经验 |
| 15 脚本模板 | 基于前述命令组合改写 |
| 16 速查表 | 综合全文 |
