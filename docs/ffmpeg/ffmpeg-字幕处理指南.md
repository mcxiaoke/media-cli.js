# FFmpeg 字幕处理指南（简体中文）

> 适用范围与依据：本指南基于 `temp/ffmpeg-docs` 官方文档（对应 FFmpeg
> N-126689-gb894a6f7c-2026-09-19）与 **FFmpeg 9.0.1 本机实测**（gyan
> full-build，`F:/Temp/ffmpeg/ffmpeg-9.0.1-shared/bin/ffmpeg.exe`）。文中标注"实测"的命令均在本机实际运行通过；未标注的命令按官方文档语义给出。测试素材：H.264+AAC 的 mp4，测试字幕为 UTF-8 编码 srt/ass/vtt。

---

## 1. 字幕的两种存在形态：先分清概念

FFmpeg 里"处理字幕"在两条完全不同的路径上进行，**必须先想清楚要哪种结果**：

| 形态               | 本质                                             | 产物                             | 能否保留样式/特效  | 播放器要求         |
| ------------------ | ------------------------------------------------ | -------------------------------- | ------------------ | ------------------ |
| **内嵌字幕流**     | 字幕作为单独轨道写进容器（mp4/mkv/mov）          | 文件体积小，可切换/关闭          | 取决于格式         | 现代播放器普遍支持 |
| **烧录（硬字幕）** | 用 libass 把字幕画进每一帧画面，成为图像的一部分 | 字幕无法关闭，任何播放器都能显示 | 100% 保留 ASS 特效 | 无要求             |

- **内嵌**：`-c:s mov_text` / `-c:s srt` / `-c:s copy`，秒级完成，不重编码视频。
- **烧录**：`-vf "subtitles=xx.srt"`，必须重编码视频，画面中永久带字幕。
- 内嵌的字幕**播放时仍由播放器渲染**（字体、样式依赖播放器端），烧录的字幕则"所见即所得"。

> 一句话判断：要字幕后**可关** → 内嵌；要**所有人都看到一样的效果**（发布平台、转码后分发）→ 烧录。

---

## 2. 字幕格式与编码器速查

### 2.1 常见字幕格式

| 格式     | codec 名              | 说明                                                          | 典型容器        |
| -------- | --------------------- | ------------------------------------------------------------- | --------------- |
| SRT      | `srt`（codec subrip） | 纯文本 + 时间码，最通用，几乎无样式                           | mkv/srt 文件    |
| ASS/SSA  | `ass` / `ssa`         | 富样式（字体/颜色/定位/Karaoke 特效等），压制组常用           | mkv/ass 文件    |
| WebVTT   | `webvtt`              | 网页字幕标准（HTML5 `<track>`），支持少量样式（`<b>` 等标签） | vtt 文件/web    |
| mov_text | `mov_text`            | 3GPP Timed Text，**MP4/MOV 容器唯一官方字幕格式**             | mp4/mov         |
| text     | `text`                | 纯文本字幕（无时间码），极少用                                | 裸文本          |
| TTML     | `ttml`                | 电信业字幕标准                                                | 少见            |
| DVB 字幕 | `dvbsub`              | 数字电视广播位图字幕                                          | ts/mpeg 等      |
| DVD 字幕 | `dvdsub`              | DVD 位图字幕（VobSub）                                        | vobsub/ifo      |
| PGS      | `hdmv_pgs_subtitle`   | 蓝光位图字幕                                                  | mkv（蓝光提取） |

> **位图字幕**（dvbsub/dvdsub/pgs）不是文本，无法转成 srt/ass，只能提取为图片或烧录；文本字幕（srt/ass/vtt/mov_text）之间可以互相转换。

### 2.2 本机 FFmpeg 9.0.1 实测支持的字幕能力

```
# 字幕编码器（本机实测输出）
ffmpeg -hide_banner -encoders | grep " S....."
# ssa, ass, dvbsub, dvdsub, mov_text, srt(subrip), text, ttml, webvtt ...

# 字幕解码器（本机实测输出）
ffmpeg -hide_banner -decoders | grep " S....."
# ssa, ass, dvbsub, dvdsub, pgssub, jacosub, microdvd, mov_text, mpl2,
# sami, srt, subrip, text, webvtt 等大量文本字幕格式
```

### 2.3 容器 × 字幕格式兼容性（重点，容易踩坑）

| 容器 | 支持内嵌的字幕格式                               | 实测结论                        |
| ---- | ------------------------------------------------ | ------------------------------- |
| mp4  | `mov_text`（唯一常规选择）                       | ✅ srt 需先转 mov_text 才能嵌入 |
| mkv  | `srt`/`ass`/`ssa`/`webvtt`/`pgs`/`dvdsub` 等任选 | ✅ srt/ass 直接嵌入             |
| mov  | `mov_text`（同 mp4）                             | 同上                            |
| ts   | `dvbsub` 等位图字幕为主                          | 文本字幕嵌入受限                |

实测踩坑实例：**webvtt 不能直接嵌入 mp4**（报
`Could not find tag for codec webvtt in stream`）。先转 mov_text 再嵌入，或改用 mkv。

---

## 3. 查看字幕流信息

```
# 查看文件里有多少字幕流、什么格式（实测：显示 "Stream #0:2: Subtitle: mov_text"）
ffprobe -v error -show_entries stream=index:stream=codec_name:stream=codec_type -of csv=p=0 in.mp4

# 只看字幕流
ffprobe -v error -select_streams s -show_entries stream=index,codec_name,language in.mp4

# 快速人肉查看（ffmpeg -i 也会列出字幕流）
ffmpeg -i in.mp4
```

`-select_streams s` 表示"字幕流"（v=视频、a=音频、s=字幕、d=数据）。

---

## 4. 字幕格式互相转换

文本字幕直接在文件之间转，不需要视频输入。本质是"解码字幕流 + 用新编码器写文件"。

```
# srt → ass（实测：生成 v4.00+ 的 ASS 头）
ffmpeg -i sub.srt sub.ass

# srt → vtt（实测：输出以 WEBVTT 开头）
ffmpeg -i sub.srt sub.vtt

# vtt → srt（实测：时间轴格式自动转回 00:00:00,000）
ffmpeg -i sub.vtt sub.srt

# ass → srt（样式会丢失，只保留文本与时间）
ffmpeg -i sub.ass sub.srt

# 显式指定字幕编码器（等价写法，map 到新的 srt 流）
ffmpeg -i sub.ass -c:s srt sub.srt
```

> - 转换按**解码器 → 编码器**走：`-i in.srt` 自动识别，输出扩展名决定目标格式。
> - ASS 转 SRT 时定位、颜色、字体等样式信息会丢失，这是格式能力所限。
> - 位图字幕（pgs/dvdsub）**无法转成文本字幕**，只能转图片或烧录。

---

## 5. 提取字幕（从视频里抠出来）

### 5.1 由 mp4/mov 提取（mov_text）

```
# 提取全部字幕轨（实测：从嵌入 mov_text 的 mp4 完整还原为 srt，含时间和文字内容）
ffmpeg -i in.mp4 -map 0:s:0 sub.srt

# 一次提取所有字幕轨（编号递增）
ffmpeg -i in.mp4 -map 0:s -c:s srt sub_%02d.srt

# 只提取音频/视频之外的字幕
ffmpeg -i in.mp4 -vn -an -c:s srt sub.srt
```

### 5.2 由 mkv 提取（srt/ass 原样取出）

```
# 无损取出（原格式原样拷贝，假定 mkv 里是 srt 字幕）
ffmpeg -i in.mkv -map 0:s:0 -c:s copy sub.srt

# mkv 里是 ass，取出来还是 ass
ffmpeg -i in.mkv -map 0:s:0 -c:s copy sub.ass

# 指定流的目的是精确选择（第二字幕轨）
ffmpeg -i in.mkv -map 0:s:1 -c:s copy sub2.srt
```

### 5.3 常用流说明符速查

| 写法    | 含义                             |
| ------- | -------------------------------- |
| `0:s:0` | 输入 0 的第 1 条字幕流（0 起始） |
| `0:s:1` | 输入 0 的第 2 条字幕流           |
| `0:s`   | 输入 0 的全部字幕流              |
| `s`     | 第一条字幕流                     |

---

## 6. 嵌入字幕到视频（内嵌流，不重编码）

**视频/音频用 `-c copy`
直接拷贝，只有字幕流转码**，所以通常是秒级完成。要点：**mp4 只能嵌 mov_text**。

```
# srt → mov_text 嵌入 mp4（实测通过，ffprobe 确认 Stream #0:2 Subtitle: mov_text）
ffmpeg -i video.mp4 -i sub.srt -map 0 -map 1 -c:v copy -c:a copy -c:s mov_text out.mp4

# 带语言标记（实测：流显示 (chi)）
ffmpeg -i video.mp4 -i sub.srt -map 0 -map 1 -c copy -c:s mov_text \
  -metadata:s:s:0 language=chi out.mp4

# srt 直接嵌入 mkv（实测：mkv 原生支持 subrip，无需转换）
ffmpeg -i video.mkv -i sub.srt -map 0 -map 1 -c copy -c:s srt out.mkv

# ass 直接嵌入 mkv（保留全部样式）
ffmpeg -i video.mkv -i sub.ass -map 0 -map 1 -c copy -c:s ass out.mkv

# 不重编码、不改字幕，纯封装时直接 copy 字幕流
ffmpeg -i in.mp4 -c copy -c:s copy out.mkv
```

常见整合命令（多字幕 + 多音频）：

```
# 视频 + 中文/英文字幕双轨嵌入 mp4（两条字幕都要先转 mov_text）
ffmpeg -i video.mp4 -i zh.srt -i en.srt -map 0 -map 1 -map 2 \
  -c:v copy -c:a copy -c:s mov_text \
  -metadata:s:s:0 language=chi -metadata:s:s:1 language=eng out.mp4

# mkv 加附件字体（配合 ass 样式使用，可选）
ffmpeg -i in.mkv -attach NotoSansSC.ttf \
  -metadata:s:t:0 mimetype=application/x-truetype-font out.mkv
```

> - `-map 0 -map 1`：先带原文件所有流，再加字幕文件流；不加 `-map`
>   时 ffmpeg 的自动选流规则可能丢掉原字幕轨。
> - webvtt 嵌入 mp4 会失败（见 2.3）；swf 嵌入 mov_text 同样受限。
> - `-sn` 可排除所有字幕（输入侧 `-sn` 阻止读入，输出侧 `-sn` 不输出字幕）。

---

## 7. 字幕烧录到画面（硬字幕，软字幕画面不可见时用）

**原理**：libass 把字幕渲染成透明图像，叠加/绘制到每一帧视频上，然后重编码。核心滤镜有两个：

| 滤镜        | 官方差异（ffmpeg-filters 文档原文）                                                                                     | 输入格式支持 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | ------------ |
| `subtitles` | 需 libavcodec/libavformat 把字幕文件转成 ASS；**支持 srt/ass/vtt 及外部文件、内嵌流**，有 `charenc`/`stream_index` 参数 |
| `ass`       | 与 subtitles 相同，但**不需要 libavcodec/libavformat**；只接受 ASS 文件                                                 | 仅 .ass      |

### 7.1 subtitles 滤镜完整参数（官方 ffmpeg-filters 11.247 节）

| 参数                  | 说明                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `filename` / `f`      | 字幕文件路径（必填；第一个位置参数默认就是文件名）                                                                                    |
| `original_size`       | 字幕设计时的原始分辨率（`640x360`）。**ASS 字体缩放依赖它**，画面被 scale 后不传会字体比例失调（实测 scale + original_size 正确缩放） |
| `fontsdir`            | 字体目录；滤镜会用该目录字体（配合系统字体一起用），**中文烧录缺字体时的首选解法**                                                    |
| `alpha`               | 是否处理 alpha 通道（默认不处理）                                                                                                     |
| `charenc`             | 字幕文件字符编码（仅 subtitles；非 UTF-8 时用，如 `charenc=GB18030` 读 GBK 字幕）                                                     |
| `stream_index` / `si` | 从视频文件内嵌字幕流烧录时选择第几条（默认 0）                                                                                        |
| `force_style`         | 覆盖 ASS 样式：`KEY=VALUE` 用逗号分隔的字符串（字体/字号/颜色等）                                                                     |
| `wrap_unicode`        | 按 Unicode 换行算法断行（默认开，需 libass ≥ 0.17）                                                                                   |
| `shaping`             | 字形整形引擎：`auto`（默认）/`simple`/`complex`（阿拉伯/希伯来等复杂文字用 complex，需 HarfBuzz）                                     |

### 7.2 基础烧录示例

```
# 最简单的 srt 烧录（实测：8 秒素材输出 8 秒带字幕视频）
ffmpeg -i in.mp4 -vf "subtitles=sub.srt" out.mp4

# 等价写法（filename= 显式）
ffmpeg -i in.mp4 -vf "subtitles=filename=sub.srt" out.mp4

# ass 文件用 ass 滤镜烧录（实测通过）
ffmpeg -i in.mp4 -vf "ass=sub.ass" out.mp4

# 从 mkv 的内嵌字幕流直接烧录（第 1 条字幕流，实测通过）
ffmpeg -i in.mkv -vf "subtitles=in.mkv:si=0" out.mp4

# 缩放画面的同时烧录：必须带 original_size 保持字幕比例（实测：scale=480:270 + original_size=640x360 OK）
ffmpeg -i in.mp4 -vf "scale=480:270,subtitles=sub.ass:original_size=640x360" out.mp4
```

### 7.3 Windows 路径写法（重点坑）

```
# Windows 绝对路径：冒号前加反斜杠转义（实测通过），路径用单引号包裹
ffmpeg -i in.mp4 -vf "subtitles='C\:/Users/me/sub.srt'" out.mp4

# fontsdir 指向中文字体目录（Windows 系统字体目录）
ffmpeg -i in.mp4 -vf "subtitles='C\:/sub/中.srt':fontsdir='C\:/Windows/Fonts'" out.mp4

# 路径含空格时，整个 force_style 都要单引号包住（外层再引）
ffmpeg -i in.mp4 -vf "subtitles='C\:/sub dir/我的字幕.srt':force_style='Fontname=SimHei'" out.mp4
```

> 冒号 `:` 是滤镜参数分隔符，路径里的盘符冒号必须写成
> `\:`（过滤器配置文件内转义）；中文文件名/含空格路径用单引号包住即可（实测可靠）。

### 7.4 force_style：临时改字幕样式（不重做 ass）

`force_style` 直接覆盖字幕样式参数，适合批量统一风格。**颜色值是 ASS 格式 `&HAABBGGRR&`**
（注意：A=alpha **不透明度**、B=蓝、G=绿、R=红，与十六进制直觉相反；`&H00FFFFFF&` 是不透明白色）。

```
# 全黑描边 + 白字 + 24 号（实测通过）
ffmpeg -i in.mp4 -vf "subtitles=sub.srt:force_style='Fontname=SimHei,Fontsize=24,PrimaryColour=&H00FFFFFF&,OutlineColour=&H00000000&,Outline=1'" out.mp4

# 黄字 + 底部边距
ffmpeg -i in.mp4 -vf "subtitles=sub.srt:force_style='Fontname=Arial,Fontsize=28,PrimaryColour=&H0000FFFF&,MarginV=30'" out.mp4

# 半透明背景（Alpha 在后两字节：&H80 开头 ≈ 50% 不透明）
ffmpeg -i in.mp4 -vf "subtitles=sub.srt:force_style='BackColour=&H80000000&,BorderStyle=3,Outline=0'" out.mp4
```

常用 ASS 样式键：`Fontname`、`Fontsize`、`PrimaryColour`、`SecondaryColour`、`OutlineColour`、
`BackColour`、`Bold`（-1/0）、`Italic`、`Outline`、`Shadow`、`Alignment`（1-9）、`MarginL/R/V`。

### 7.5 中文乱码问题三板斧

烧录中文显示方框/乱码，按顺序排查：

1. **字体缺失**：Libass 找不到中文字体 → 用 `fontsdir` 指定含中文字体的目录，或 `force_style`
   指定系统中文字体名（SimHei/SimSun/Microsoft YaHei 等，实测 `Fontname=SimHei` 有效）。
2. **字幕文件不是 UTF-8**：GBK 编码的 srt 用 `charenc=GB18030`
   指定源编码（subtitles 滤镜专属参数）。
    ```
    ffmpeg -i in.mp4 -vf "subtitles=gbk.srt:charenc=GB18030" out.mp4
    ```
3. **先转码再烧录兜底**：先把字幕统一转成 UTF-8 的 ass（见第 4 节），再烧 ass。

---

## 8. 字幕时间轴调整

### 8.1 整体偏移（-itsoffset，实测通过）

`-itsoffset 秒` 是**输入选项**，用于把字幕流的起点整体平移：

```
# 字幕整体延后 0.5 秒（实测：00:00:00,000→00:00:00,500，所有时间戳同步 +0.5）
ffmpeg -itsoffset 0.5 -i sub.srt shifted.srt

# 提前 0.5 秒（负偏移）
ffmpeg -itsoffset -0.5 -i sub.srt shifted.srt

# 边提取边偏移（从视频里取字幕并平移 2 秒，拷出后已是修正时间）
ffmpeg -itsoffset 2 -i in.mp4 -map 0:s:0 shifted.srt
```

### 8.2 截取/丢弃时间段（注意：-ss 不是"删首"）

对字幕文件用时间裁剪时，实测发现与视频 seek 语义不同，必须小心：

```
# -t 截取：保留"起始时间落在范围内"的字幕，事件本身时长不裁剪（实测：-t 3 保留了 0-2s 与 2.5-5s 两条）
ffmpeg -i sub.srt -t 60 sub_first60.srt

# ⚠️ 实测警示：-ss 对 srt 是"时间戳整体平移"而非"删掉前面"
#   对 t.srt 执行 -ss 3 后，输出两条（2.5s 与 5.5s 起的字幕），时间戳被整体前移约 2.5s，
#   seek 3 与 seek 5 结果完全一致——它按字幕包边界对齐，不是精确丢前 N 秒
ffmpeg -ss 3 -i sub.srt out.srt
```

> 结论：**"删掉开头 N 秒的字幕"不要用 -ss**，用文本工具（sed/perl/python）按时间码处理更可控；FFmpeg 只适合做整体平移（-itsoffset，见 8.1）或整体截取范围（-t）。

---

## 9. 位图字幕（PGS/DVDSUB）处理

位图字幕是图片帧序列，无法转为文本。注意：**本机制作版 FFmpeg 9.0.1 没有 pgs_subtitle 编码器**
（`ffmpeg -encoders` 实测无 pgs），所以 PGS 只能"拷贝提取"或"烧录"，不能转码：

```
# PGS/DVDSUB 从 mkv 无损提取（-c:s copy 实测可用；不要试图 -c:s pgs_subtitle，本机无此编码器）
ffmpeg -i in.mkv -map 0:s:0 -c:s copy pgs.sup

# 位图字幕烧录到画面（subtitles 滤镜引用 mkv 内嵌流，si=0 第一条字幕流）
ffmpeg -i in.mkv -vf "subtitles=in.mkv:si=0" out.mp4
```

> 文本字幕转位图（做硬字幕的另一种思路）在部分构建里可用 `blend`+`drawtext`
> 手工实现，但日常极少用；绝大多数场景是文本字幕，用第 4-8 节即可。

---

## 10. 常见问题速查

| 问题                                                     | 解法                                                                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| webvtt 嵌入 mp4 报 "Could not find tag for codec webvtt" | mp4 只支持 mov_text：先 `ffmpeg -i sub.vtt -c:s mov_text sub.mp4` 中间转换，或改嵌 mkv                               |
| 烧录的中文显示方框/乱码                                  | ① `fontsdir` 指定字体目录 ② `force_style='Fontname=SimHei'` ③ 字幕先转 UTF-8（见 7.5）                               |
| 缩放画面后字幕字体大小比例不对                           | subtitles 滤镜加 `original_size=原始宽x高`（见 7.2）                                                                 |
| 内嵌字幕播放器不显示                                     | ① 确认容器兼容（mp4 用 mov_text） ② 加 `-metadata:s:s:0 language=chi` ③ 部分播放器需字幕轨设 default                 |
| 提取出的 srt 乱码                                        | 源字幕是 GBK/GB18030：`-sub_charenc GB18030`（实测：GBK 文件转出正确 UTF-8，不带则报 "missing -sub_charenc option"） |
| 字幕文件本身是 GBK，转换/烧录乱码                        | 转换时加 `-sub_charenc GB18030 -i in.srt -c:s srt out.srt`；烧录用 `-vf subtitles=...:charenc=GB18030`               |
| 嵌入时丢掉了原来的字幕轨                                 | 缺 `-map 0`：`-i a.mp4 -i b.srt -map 0 -map 1 ...`（见第 6 节）                                                      |
| 只想要字幕不要声音/画面                                  | `-vn -an -map 0:s:0`（见 5.1）                                                                                       |
| 多个字幕想一起烧录                                       | 滤镜链拼接两次：`-vf "subtitles=a.srt,subtitles=b.srt"`（注意会叠加渲染，通常用于双语言对照）                        |
| -vf 的 subtitles 路径含冒号报错                          | 盘符冒号写成 `\:`（`'C\:/sub/x.srt'`），见 7.3                                                                       |
| 字幕时间整体偏早/偏晚                                    | `-itsoffset ±秒`（见 8.1）                                                                                           |
| 想让视频"能关字幕"（软字幕）                             | 忘记烧录：用第 6 节内嵌 mov_text/srt，不要用 -vf subtitles                                                           |

---

## 11. 完整实战案例（一条命令整合多个能力）

```
# 场景 A：为已有视频加中文硬字幕并转成 1080p（字幕比例自适应）
ffmpeg -i source_4k.mkv -vf \
  "scale=1920:1080,subtitles='C\:/works/zh.srt':original_size=3840x2160:fontsdir='C\:/Windows/Fonts'" \
  -c:v libx264 -preset medium -crf 20 -c:a aac -b:a 192k final.mp4

# 场景 B：内嵌中英双字幕 + 双音轨，统一输出移动端 mp4
ffmpeg -i bluray.mkv -i zh.srt -i en.srt \
  -map 0:v -map 0:a:0 -map 1 -map 2 \
  -c:v libx264 -preset slow -crf 22 -c:a aac -ac 2 \
  -c:s mov_text \
  -metadata:s:s:0 language=chi -metadata:s:s:1 language=eng \
  -movflags +faststart mobile.mp4

# 场景 C：把整季字幕统一转 ass 并批量平移 0.5 秒
for f in ep*.srt; do
  ffmpeg -itsoffset 0.5 -i "$f" "shifted_$f" && ffmpeg -i "shifted_$f" "${f%.srt}.ass"
done
```

---

## 附：官方文档对照

- subtitles 滤镜：`ffmpeg-filters(1)`
  11.247 节（`filename/f, original_size, fontsdir, alpha, charenc, stream_index/si, force_style, wrap_unicode, shaping`，均为本文 7.1 表格依据）
- ass 滤镜：`ffmpeg-filters(1)` 11.5 节（"Same as subtitles... doesn't require libavcodec and
  libavformat... limited to ASS"）
- mov_text 说明：`ffmpeg-all(1)` / `ffprobe-all(1)`（"Convert text subtitles to MOV subtitles ...
  with metadata headers"）
- 字幕编码器清单：`ffmpeg -encoders`（本机实测，见 2.2）
- 本文所有"实测"标注的命令均已在本机 FFmpeg 9.0.1 上实际运行验证
