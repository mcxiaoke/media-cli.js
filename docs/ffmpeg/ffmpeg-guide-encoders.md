# FFmpeg 编码器参数与质量控制调优指南

> 版本基准：本文参数以 FFmpeg 官方文档（`temp/ffmpeg-docs` 离线副本：`ffmpeg-all.md`、`ffmpeg-codecs.md`）为准，并用本机 `F:\Temp\ffmpeg\ffmpeg-9-nonfree`（`N-126689-gb894a6f7c-2026-09-19`，libavcodec 63.14.100）的 `ffmpeg -h encoder=xxx` 输出交叉核对。
> 阅读约定：`E..V.....` 表示该选项属于编码器私有选项（encoder AVOption）；参数名以本机二进制实测为准，不同构建/版本可能增减。

---

> 📖 硬件编码器的**兼容性矩阵**（平台×codec、profile/level/pix_fmt、容器限制、硬解硬编配对）
> 见《FFmpeg 硬件加速兼容性与全硬件工作流指南》（`ffmpeg-guide-hwaccel-compat.md`）。

## 目录

1. [核心概念：码率控制三种模式](#1-核心概念码率控制三种模式)
2. [通用编码控制参数](#2-通用编码控制参数)
3. [两遍编码（2-pass）与质量评估](#3-两遍编码2-pass与质量评估)
4. [libx264（H.264 软件编码）](#4-libx264h264-软件编码)
5. [libx265（HEVC 软件编码）](#5-libx265hevc-软件编码)
6. [libsvtav1 / libaom-av1 / librav1e（AV1 软件编码）](#6-libsvtav1--libaom-av1--librav1eav1-软件编码)
7. [libvpx（VP8/VP9 软件编码）](#7-libvpxvp8vp9-软件编码)
8. [音频编码器](#8-音频编码器)
9. [硬件编码器参数](#9-硬件编码器参数)
10. [质量与体积调优方法论](#10-质量与体积调优方法论)
11. [常见问题与参数速查表](#11-常见问题与参数速查表)

---

## 1. 核心概念：码率控制三种模式

选择编码器参数的第一步，是先确定**码率控制模式**。它决定「质量—体积—码率稳定性」三者的取舍。

| 模式 | 关键参数 | 特点 | 适用场景 |
| --- | --- | --- | --- |
| **CQP / QP**（固定量化） | `-qp N` | 每帧 QP 恒定，码率完全浮动 | 快速测试、素材对比、无损级调试 |
| **CQ / CRF**（恒定质量） | `-crf N` | 按复杂度分配码率，感知质量恒定 | **归档、点播、绝大多数离线转码（首选）** |
| **ABR**（平均码率） | `-b:v` | 目标平均码率，质量随内容波动 | 有明确体积/带宽预算 |
| **CBR**（恒定码率） | `-b:v` + `-maxrate` + `-bufsize` | 码率恒定，缓冲受限 | 直播、推流、硬件/广播链路 |
| **VBR 受限** | `-b:v` + `-maxrate` + `-bufsize` | 平均码率 + 峰值上限 | 流媒体（HLS/DASH）分段 |

**关键理解：**

- `-crf` 与 `-qp` 的数值**不是同一把尺子**。CRF 是「目标质量」的抽象，QP 是「量化步长」本身；同数值下 CRF 通常比 QP 质量更好、体积更小。
- `-maxrate`/`-bufsize` 是 **VBV 约束**，与 CRF 可叠加使用（`-crf 20 -maxrate 6M -bufsize 12M`），实现「恒定质量 + 峰值封顶」，是流媒体场景的推荐组合。
- `bufsize` 常规取 `maxrate` 的 1~2 倍。太小会导致质量剧烈抖动，太大则失去峰值约束意义。

```bash
# CRF 归档（质量优先）
ffmpeg -i in.mp4 -c:v libx265 -crf 22 -preset slow -c:a copy out.mp4

# CBR 推流（稳定优先）
ffmpeg -i in.mp4 -c:v libx264 -b:v 4M -maxrate 4M -bufsize 8M -g 50 -c:a aac -b:a 128k out.mp4

# CRF + VBV 封顶（点播分段）
ffmpeg -i in.mp4 -c:v libx264 -crf 20 -maxrate 6M -bufsize 12M -c:a aac out.mp4
```

---

## 2. 通用编码控制参数

以下参数对所有编码器通用（软件与硬件），来自 `ffmpeg-all.md` 第 5 章「Main options / Video Options / Advanced Video options」。

### 2.1 流与编码器选择

| 参数 | 说明 |
| --- | --- |
| `-c[:specifier] codec` / `-codec` | 选择编码器（输出侧）或解码器（输入侧）；`-c copy` 表示流拷贝不重编码 |
| `-c:v` / `-vcodec` | 视频编码器 |
| `-c:a` / `-acodec` | 音频编码器 |
| `-c:s` / `-scodec` | 字幕编码器 |
| `-map` | 手工指定流映射，`-map 0:v:0 -map 0:a:1`；`-map 0` 表示全部流 |
| `-vn` / `-an` / `-sn` | 禁用视频/音频/字幕 |
| `-stream_loop N` | 输入循环 N 次（`-1` 为无限） |

### 2.2 帧与像素格式

| 参数 | 说明 |
| --- | --- |
| `-pix_fmt fmt` | 输出像素格式，如 `yuv420p`、`yuv420p10le`、`p010le`、`yuv444p`。前缀 `+` 表示强制（失败即报错，并禁用滤镜图内自动转换） |
| `-r fps` | 输出帧率（重编码时丢/复制帧）；输入侧使用表示忽略时间戳 |
| `-fpsmax fps` | 输出帧率上限（与 `-r` 互斥） |
| `-s WxH` | 输出尺寸，等价于在滤镜图**末尾**追加 `scale` |
| `-aspect 16:9` | 设置显示宽高比 |
| `-g N` | GOP 大小（关键帧间隔，通用别名 `-g`） |
| `-bf N` | B 帧数量 |
| `-refs N` | 参考帧数量 |
| `-level` / `-profile` | 级别与档次约束（如 `-profile:v high -level 4.1`） |
| `-force_key_frames` | 强制关键帧，支持时间点列表、`expr:` 表达式、`source`、`scd_metadata` |
| `-frames:v N` | 限制输出视频帧数 |

**`-force_key_frames` 常用写法：**

```bash
# 每 5 秒一个关键帧（流媒体切片常用）
-force_key_frames "expr:gte(t,n_forced*5)"

# 指定时间点 + 每个章节前 0.1 秒
-force_key_frames "0:05:00,chapters-0.1"

# 与源关键帧对齐
-force_key_frames source
```

### 2.3 时间与裁剪

| 参数 | 说明 |
| --- | --- |
| `-ss pos` | 输入侧：定位（快速但可能非精确，配合 `-accurate_seek` 默认开启）；输出侧：解码后丢弃直到该时间 |
| `-t dur` | 输入侧限制读取时长；输出侧限制写入时长（与 `-to` 互斥，`-t` 优先） |
| `-to pos` | 读到/写到指定时间点 |
| `-sseof pos` | 相对文件末尾定位 |
| `-itsoffset off` | 输入时间戳偏移（音视频对齐常用） |
| `-copyts` | 保留原始时间戳 |
| `-fs bytes` | 输出文件大小上限 |

> 实践建议：`-ss` 放在 `-i` **之前**速度最快；需要精确到帧时放在 `-i` 之后。

### 2.4 元数据与容器

| 参数 | 说明 |
| --- | --- |
| `-metadata k=v` | 写入元数据，如 `-metadata title="..."`、`-metadata:s:a:0 language=eng` |
| `-map_metadata` | 从输入复制元数据（`-map_metadata -1` 清除） |
| `-movflags +faststart` | MP4 将 moov 前置，利于网络播放 |
| `-tag:v hvc1` | 强制视频 tag/fourcc（Apple 生态 HEVC 兼容常用） |
| `-disposition` | 设置流属性，如 `-disposition:a:0 default` |
| `-shortest` | 输出时长取最短流 |
| `-y` / `-n` | 覆盖 / 不覆盖已存在文件 |

### 2.5 硬件与性能

| 参数 | 说明 |
| --- | --- |
| `-threads N` | 线程数（`0` 为自动） |
| `-thread_type` | 线程类型：`frame` / `slice` |
| `-benchmark` | 输出耗时统计 |
| `-hwaccel` / `-hwaccel_output_format` | 硬件解码（详见《硬件加速与质量对比》文档） |

---

## 3. 两遍编码（2-pass）与质量评估

### 3.1 两遍编码

第一遍收集统计信息写入日志，第二遍依据日志精确分配码率。**只有 ABR/VBR 目标码率模式才需要 2-pass**；CRF 模式不需要。

```bash
# 第一遍：丢弃输出，仅生成统计
ffmpeg -y -i in.mp4 -c:v libx264 -b:v 4M -pass 1 -passlogfile ffmpeg2pass -an -f mp4 NUL

# 第二遍：读取统计并正式编码
ffmpeg -i in.mp4 -c:v libx264 -b:v 4M -pass 2 -passlogfile ffmpeg2pass -c:a copy out.mp4
```

| 参数 | 说明 |
| --- | --- |
| `-pass 1` / `-pass 2` | 指定遍数 |
| `-passlogfile prefix` | 统计文件名前缀，默认 `ffmpeg2pass`，实际文件为 `PREFIX-N.log` |
| `-fastfirstpass 0` | 关闭第一遍的快速预设（x264/x265，等价 `--slow-firstpass`，更准确但更慢） |

> Windows 下第一遍输出到 `NUL`，Linux/macOS 用 `/dev/null`。

### 3.2 质量评估（客观指标）

FFmpeg 内置滤镜可直接对比「失真视频」与「参考视频」：

```bash
# PSNR（第一输入为待测，第二输入为参考）
ffmpeg -i distorted.mp4 -i reference.mp4 -lavfi psnr=stats_file=psnr.log -f null -

# SSIM
ffmpeg -i distorted.mp4 -i reference.mp4 -lavfi ssim=stats_file=ssim.log -f null -

# VMAF（需 libvmaf，本机构建已启用）
ffmpeg -i distorted.mp4 -i reference.mp4 -lavfi libvmaf="log_path=vmaf.json:log_fmt=json" -f null -
```

| 指标 | 含义 | 经验区间 |
| --- | --- | --- |
| **PSNR** | 峰值信噪比，越高越好 | < 30 差；35~40 可接受；> 42 好 |
| **SSIM** | 结构相似度，0~1 | < 0.95 可见劣化；> 0.98 好 |
| **VMAF** | Netflix 感知质量融合指标，0~100 | < 70 明显劣化；80~90 好；> 93 优秀 |
| **XPSNR** | 加权 PSNR（`xpsnr` 滤镜） | 与 PSNR 同向，更贴近感知 |

> 两段输入必须**分辨率、像素格式、帧数一致**，否则指标无意义。先用 `scale`/`fps`/`setpts` 对齐再测。

---

## 4. libx264（H.264 软件编码）

x264 是 H.264 的黄金标准软件编码器，参数体系后来被 x265、SVT-AV1 广泛借鉴。

### 4.1 预设与调优

| 参数 | 取值范围 | 说明 |
| --- | --- | --- |
| `-preset` | `ultrafast` `superfast` `veryfast` `faster` `fast` `medium`(默认) `slow` `slower` `veryslow` `placebo` | 速度/压缩率权衡，越慢压缩率越高 |
| `-tune` | `film` `animation` `grain` `stillimage` `fastdecode` `zerolatency` `psnr` `ssim` | 针对内容类型微调心理视觉参数 |
| `-profile` | `baseline` `main` `high` `high10` `high422` `high444` | 档次限制 |
| `-level` | `3.1` `4.0` `4.1` `5.1` … | 级别限制（Annex A 标识符） |

### 4.2 码率控制与质量

| 参数 | 说明 |
| --- | --- |
| `-crf N` | 恒定质量，范围 0~51。**18~28** 常用；18 接近视觉无损，23 为默认级，28 明显有损 |
| `-crf_max N` | CRF 模式下 VBV 降质的下限保护 |
| `-qp N` | 固定量化步长（CQP） |
| `-b:v` | 目标码率（比特/秒） |
| `-qmin` / `-qmax` | 最小/最大量化步长 |
| `-qdiff` | 量化步长最大变化量（`qpstep`） |
| `-qcomp` | 量化曲线压缩因子（`qcomp`），越大码率波动越大 |
| `-qblur` | 量化曲线模糊 |
| `-rc-lookahead N` | 前瞻帧数，影响帧类型决策与码率控制 |
| `-rc_init_occupancy` | VBV 初始占用（`vbv-init`） |

### 4.3 心理视觉与自适应量化（画质调优核心）

| 参数 | 说明 |
| --- | --- |
| `-aq-mode` | `none(0)` / `variance(1)` / `autovariance(2)` / `autovariance-biased(3)`。默认 1；暗场细节多的素材用 3 |
| `-aq-strength` | AQ 强度，默认 1.0；0.8~1.2 常用，过高会造成平坦区失真 |
| `-psy` | 心理视觉优化开关（`--no-psy` 等价于 `-psy 0`） |
| `-psy-rd` | `psy-rd:psy-trellis` 格式，如 `1.0:0.0`（animation 常用） |
| `-trellis` | 网格量化，默认开启，0/1/2 三档 |
| `-deblock` | 去块滤波强度 `alpha:beta`，如 `-1:-1` 自动；`-2:-2` 更强 |
| `-weightb` / `-weightp` | B/P 帧加权预测（`weightp`: `none`/`simple`/`smart`） |
| `-mixed-refs` | 每个分区使用一个参考（而非每宏块） |
| `-b-pyramid` | B 帧金字塔：`none` / `strict` / `normal` |
| `-b-bias` | B 帧使用倾向 |
| `-b_strategy` | 自适应 B 帧决策（`b-adapt`），第一遍使用 |

### 4.4 运动估计与熵编码

| 参数 | 说明 |
| --- | --- |
| `-me_method` | `dia`(最快) `hex` `umh` `esa` `tesa`(最慢)，默认随预设 |
| `-me_range` | 运动搜索范围（像素），默认 16 |
| `-subq` | 亚像素运动估计精度（`subme`）1~11 |
| `-cmp` | `chroma`（含色度）/ `sad`（忽略色度，`--no-chroma-me`） |
| `-coder` | `ac`（CABAC，默认）/ `vlc`（CAVLC，`--no-cabac`） |
| `-refs` | 参考帧数 0~16 |
| `-sc_threshold` | 场景切换检测阈值（`scenecut`） |

### 4.5 其他重要选项

| 参数 | 说明 |
| --- | --- |
| `-g N` | 最大 GOP（`keyint`），默认 250 |
| `-keyint_min N` | 最小 GOP |
| `-bf N` | B 帧数（`bframes`） |
| `-forced-idr` | 强制关键帧为 IDR |
| `-intra-refresh` | 周期内刷新替代 IDR（抗丢包/低延迟） |
| `-x264opts` | 透传任意 x264 参数，如 `-x264opts keyint=48:min-keyint=48:no-scenecut` |
| `-x264-params` | 同上（`key=value:key=value` 形式） |
| `-ssim` | 编码后打印 SSIM 统计 |
| `-flags -cgop` | 开启 open GOP |

```bash
# 通用高压缩归档
ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 20 -aq-mode 3 -aq-strength 1.0 -psy-rd 1.0:0.15 -c:a copy out.mp4

# 动画素材
ffmpeg -i in.mkv -c:v libx264 -preset slower -crf 18 -tune animation -x264-params "keyint=240:min-keyint=24:deblock=-1,-1" -c:a copy out.mp4

# 低延迟（直播/串流）
ffmpeg -i in.mp4 -c:v libx264 -preset veryfast -tune zerolatency -crf 23 -g 50 -bf 0 -c:a aac out.flv

# 10bit 输出（需 10bit 构建）
ffmpeg -i in.mp4 -c:v libx264 -pix_fmt yuv420p10le -crf 20 -preset slow out.mp4
```

---

## 5. libx265（HEVC 软件编码）

libx265 在 FFmpeg 中暴露的私有选项较少，**绝大多数高级参数通过 `-x265-params` 透传**。

### 5.1 FFmpeg 层直接可用的选项

| 参数 | 说明 |
| --- | --- |
| `-crf N` | 恒定质量，范围 0~51；**同主观质量下约比 x264 的 CRF 高 3~6**（如 x264 CRF 20 ≈ x265 CRF 23~26） |
| `-qp N` | 固定 QP |
| `-preset` | `ultrafast` … `placebo`，默认 `medium` |
| `-tune` | `psnr` `ssim` `grain` `zerolatency` `fastdecode` `animation` |
| `-profile` | `main` `main10` `mainstillpicture` `rext` |
| `-g` / `-keyint_min` / `-bf` / `-refs` | GOP / 最小 GOP / B 帧 / 参考帧 |
| `-qmin` `-qmax` `-qdiff` `-qcomp` `-qblur` | 量化控制 |
| `-i_qfactor` / `-b_qfactor` | I/B 帧量化因子 |
| `-forced-idr` | 强制 IDR |
| `-x265-params` | 透传 x265 原生参数（`:` 分隔） |
| `-x265-stats` | 2-pass 统计文件（`-passlogfile` 时自动设置） |
| `-dolbyvision` | 启用 Dolby Vision RPU 编码 |

### 5.2 常用 `-x265-params` 透传参数

| x265 参数 | 说明 |
| --- | --- |
| `psy-rd` / `psy-rdoq` | 心理视觉强度，默认 `2.0` / `0.0`；动画可 `1.0` / `0.0` |
| `aq-mode` | `0` none / `1` variance / `2` autovariance / `3` autovariance+dark bias（默认）/ `4` 全帧 AQ |
| `aq-strength` | AQ 强度，默认 1.0 |
| `rd` | 率失真优化等级 1~6（越高越好越慢） |
| `rdoq-level` | 0/1/2 |
| `tu-intra-depth` / `tu-inter-depth` | 变换单元深度 1~4 |
| `max-tu-size` | 最大变换单元 16/32 |
| `me` | 运动估计 `dia` `hex` `umh` `star` `sea` `full` |
| `subme` | 亚像素 0~5 |
| `merange` | 搜索范围 |
| `rect` / `amp` | 矩形/非对称分区 |
| `sao` | 样点自适应偏移 `-1`/`0`/`1`/`2`，可关（`sao=0`）提速 |
| `deblock` | 去块 `alpha:beta`，如 `-1:-1` 或 `0:0` |
| `strong-intra-smoothing` | 0/1 |
| `hdr10` / `hdr10-opt` / `master-display` / `max-cll` | HDR10 元数据 |
| `bframes` / `b-adapt` / `b-pyramid` | B 帧控制 |
| `rc-lookahead` | 前瞻帧数 |
| `vbv-maxrate` / `vbv-bufsize` | VBV 约束 |
| `info` / `log-level` | 日志 |

```bash
# 通用归档（推荐起点）
ffmpeg -i in.mp4 -c:v libx265 -preset slow -crf 24 -x265-params "aq-mode=3:psy-rd=2.0:psy-rdoq=1.0" -c:a copy out.mkv

# 电影/胶片颗粒感素材（保留颗粒）
ffmpeg -i in.mkv -c:v libx265 -preset slower -crf 21 -tune grain -x265-params "aq-mode=4:psy-rd=2.5:psy-rdoq=1.5:deblock=-2,-2" -c:a copy out.mkv

# 动画
ffmpeg -i in.mkv -c:v libx265 -preset slow -crf 20 -x265-params "psy-rd=1.0:psy-rdoq=0.0:aq-mode=3:deblock=0,0" -c:a copy out.mkv

# 10bit HDR10
ffmpeg -i in.mkv -c:v libx265 -preset slow -crf 22 -pix_fmt yuv420p10le \
  -x265-params "hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400" \
  -c:a copy out.mkv

# 目标码率 2-pass
ffmpeg -y -i in.mp4 -c:v libx265 -b:v 3M -x265-params pass=1:stats=x265_2pass.log -an -f mp4 NUL
ffmpeg -i in.mp4 -c:v libx265 -b:v 3M -x265-params pass=2:stats=x265_2pass.log -c:a copy out.mp4
```

---

## 6. libsvtav1 / libaom-av1 / librav1e（AV1 软件编码）

### 6.1 libsvtav1（速度/质量平衡最佳，推荐）

> **重要版本差异**：官方文档 §16.10.1 列出了 `profile`、`level`、`tier`、`qmin`、`qmax`、`sc_detection`、`la_depth`、`tile_rows`、`tile_columns`、`hielevel` 等**顶层选项**，但**本机 2026-09-19 构建实测**（`ffmpeg -h encoder=libsvtav1`）只直接暴露 4 个选项。其余参数需通过 `-svtav1-params` 透传。使用前请先执行 `ffmpeg -h encoder=libsvtav1` 确认你的构建暴露了哪些选项。

**FFmpeg 层直接可用的选项（本机实测）：**

| 参数 | 范围 | 说明 |
| --- | --- | --- |
| `-crf N` | 0~63（默认 0） | 恒定质量，**越低越好**；常用 20~35（30 左右为常见归档点） |
| `-qp N` | 0~63（默认 0） | 初始量化值（CQP 模式） |
| `-preset N` | **-2~13**（默认 -2 = 自动） | 质量/速度权衡，**数值越大越快、质量越低**；常用 4~8 |
| `-svtav1-params` | — | 透传 SVT-AV1 原生参数（`:` 分隔） |
| `-dolbyvision` | `auto`/`0`/`1` | Dolby Vision RPU 编码 |

**通过 `-svtav1-params` 透传的常用参数：**

| 参数 | 范围 | 说明 |
| --- | --- | --- |
| `keyint` / `g` | — | GOP 大小（关键帧间隔） |
| `profile` | `main` `high` `professional` | 编码档次 |
| `level` | 如 `4.0` | 操作点级别 |
| `tier` | `main` `high` | 层 |
| `qmin` / `qmax` | 0~63 | 码率模式下的量化上下限 |
| `scd` / `enable-scd` | — | 场景切换检测 |
| `lookahead` / `la_depth` | 0~120 | 前瞻深度 |
| `tile-rows` / `tile-columns` | 0~6 / 0~4 | tile 行列数（log2），提升并行度 |
| `hierarchical-level` | 2~4 | 分层预测层级 |
| `film-grain` | 0~50 | 颗粒合成（保留胶片感） |
| `tune` | 0(质量)/1(PSNR)/2(SSIM) | 调优目标 |
| `aq-mode` | 0/1/2 | 自适应量化 |
| `enable-overlays` | 0/1 | 叠加帧

```bash
# 通用 AV1 归档
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 6 -crf 30 -g 240 -svtav1-params "tune=0:film-grain=8" -c:a copy out.mkv

# 快速转码（速度优先）
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 10 -crf 34 -c:a copy out.mkv

# 高质量（慢）
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 2 -crf 26 -svtav1-params "enable-overlays=1:aq-mode=2" -c:a copy out.mkv

# 10bit
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 6 -crf 30 -pix_fmt yuv420p10le -c:a copy out.mkv
```

### 6.2 libaom-av1（质量标杆，极慢）

| 参数 | 范围 | 说明 |
| --- | --- | --- |
| `-crf N` | 0~63 | 恒定质量（越小越好） |
| `-b:v` | — | 目标码率；与 `minrate=maxrate` 同时设置则为 CBR |
| `-cpu-used N` | 0~8 | **越大越快质量越低**，默认 1（很慢） |
| `-usage` | `good` `realtime` `allintra` | 使用场景 |
| `-row-mt 1` | — | 行级多线程（建议开启） |
| `-tiles` | `列x行` | tile 划分 |
| `-tile-columns` / `-tile-rows` | — | log2 形式 |
| `-aq-mode` | `none` `variance` `complexity` `cyclic` | 自适应量化 |
| `-tune` | `psnr`(0) `ssim`(1) | 调优目标 |
| `-arnr-maxframes` / `-arnr-strength` | — | 交替参考帧降噪 |
| `-enable-cdef` / `-enable-restoration` | 0/1 | 环路滤波开关（关掉提速） |
| `-denoise-noise-level` | — | 去噪 + 颗粒合成 |
| `-lag-in-frames` | — | 前瞻帧数 |
| `-g N` | — | 关键帧间隔（0 = 全帧内） |

```bash
# 质量优先（极慢）
ffmpeg -i in.mp4 -c:v libaom-av1 -crf 30 -b:v 0 -cpu-used 2 -row-mt 1 -tiles 2x2 -c:a copy out.mkv

# 全帧内（用于编辑/切片）
ffmpeg -i in.mp4 -c:v libaom-av1 -crf 28 -b:v 0 -cpu-used 6 -usage allintra -c:a copy out.mkv
```

> `-b:v 0` 是 libaom-av1 使用纯 CRF 模式的标准写法（不设目标码率）。

### 6.3 librav1e

| 参数 | 说明 |
| --- | --- |
| `-qp N` | 量化参数（对应 rav1e 的 `--quantizer`） |
| `-speed N` | 0~10，越大越快质量越低 |
| `-tiles N` | tile 数 |
| `-tile_rows` / `-tile_cols` | tile 行列 |
| `-rav1e-params` | 透传 rav1e 参数 |

```bash
ffmpeg -i in.mp4 -c:v librav1e -qp 80 -speed 6 -tiles 4 -c:a copy out.mkv
```

> AV1 编码器选择建议：**SVT-AV1 是绝大多数场景的首选**（速度/质量比最优）；libaom 仅在追求极致压缩率时使用；rav1e 适合 Rust 生态与特定集成。

---

## 7. libvpx（VP8/VP9 软件编码）

### 7.1 VP9（`libvpx-vp9`）推荐参数

| 参数 | 说明 |
| --- | --- |
| `-crf N` | 0~63，恒定质量；**VP9 常用 15~35**（30~33 为常见归档点） |
| `-b:v` | 目标码率；纯 CRF 模式需 `-b:v 0` |
| `-deadline` | `best`（极慢，不推荐）/ `good`（推荐）/ `realtime` |
| `-cpu-used N` | 0~8，配合 `good` 使用；数值越大越快质量越低 |
| `-row-mt 1` | 行级多线程，**强烈建议开启**（VP9 提速关键） |
| `-tile-columns N` | log2 tile 列数，-1(默认)~6 |
| `-tile-rows N` | log2 tile 行数，-1(默认)~2 |
| `-frame-parallel 1` | 帧并行 |
| `-auto-alt-ref N` | 交替参考帧（仅 2-pass），`>1` 启用多层（VP9） |
| `-arnr-maxframes` / `-arnr-strength` / `-arnr-type` | 交替参考帧降噪 |
| `-lag-in-frames N` | 前瞻帧数（`rc-lookahead`） |
| `-aq-mode` | 自适应量化 0~3（VP9） |
| `-undershoot-pct` / `-overshoot-pct` | 码率下溢/上溢百分比 |
| `-minrate` / `-maxrate` | GOP 码率下限/上限 |
| `-qmin` / `-qmax` | 量化上下限 |
| `-g N` | 关键帧最大间隔（`kf-max-dist`） |
| `-keyint_min N` | 关键帧最小间隔 |
| `-tune` | `psnr` / `ssim` |
| `-sharpness N` | 0~7，提高锐度但降低 PSNR |
| `-static-thresh N` | 块跳过阈值 |
| `-error-resilient 1` | 抗错能力 |
| `-ts-parameters` | 时间可分层配置（`key=value:...`） |

```bash
# VP9 高质量归档（good + CRF，2-pass 可提升质量）
ffmpeg -y -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 31 -row-mt 1 -tile-columns 2 -tile-rows 1 -pass 1 -an -f mp4 NUL
ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 31 -row-mt 1 -tile-columns 2 -tile-rows 1 -pass 2 -c:a copy out.webm

# VP9 实时（低延迟）
ffmpeg -i in.mp4 -c:v libvpx-vp9 -deadline realtime -cpu-used 5 -b:v 2M -row-mt 1 -c:a libopus out.webm

# VP8（兼容性优先）
ffmpeg -i in.mp4 -c:v libvpx -crf 10 -b:v 2M -deadline good -cpu-used 2 -c:a libvorbis out.webm
```

> **VP9 要点**：`-deadline best` 又慢又不一定更好，请用 `good`；`-row-mt 1` 在现代多核 CPU 上提速显著；2-pass 对 VP9 的质量提升比 x264 更明显。

---

## 8. 音频编码器

### 8.1 AAC

| 编码器 | 说明 |
| --- | --- |
| `aac`（内置） | 无需外部库，VBR 模式可用 `-q:a 1~5`；质量一般 |
| `libfdk_aac` | 质量最佳，支持 VBR 与 HE-AAC；`-vbr 1~5`，或 `-b:a` CBR |

```bash
# 内置 AAC，恒定质量（-q:a 1~5，越大质量越高）
ffmpeg -i in.mp4 -c:v copy -c:a aac -q:a 3 out.mp4

# libfdk_aac VBR（推荐 4~5 档）
ffmpeg -i in.mp4 -c:v copy -c:a libfdk_aac -vbr 4 out.mp4

# AAC-LC CBR 128k
ffmpeg -i in.mp4 -c:v copy -c:a aac -b:a 128k out.mp4
```

### 8.2 其他常用音频编码器

| 编码器 | 常用参数 | 适用 |
| --- | --- | --- |
| `libmp3lame` | `-q:a 0~9`（0 最好）/ `-b:a` | MP3 兼容 |
| `libopus` | `-b:a 64k~192k`，`-vbr on`，`-application voip/audio/lowdelay` | WebM/低码率最佳 |
| `libvorbis` | `-q:a 0~10` | Ogg 容器 |
| `flac` | `-compression_level 0~12` | 无损 |
| `alac` | 无主要私有参数 | Apple 无损 |
| `pcm_s16le` / `pcm_s24le` | — | WAV 未压缩 |
| `ac3` / `eac3` | `-b:a`，AC-3 元数据参数丰富 | 家庭影院 |
| `libtwolame` | `-b:a`，`-mode` | MP2 |
| `liblc3` | 低复杂度蓝牙音频 | LE Audio |

### 8.3 音频通用控制

| 参数 | 说明 |
| --- | --- |
| `-ar N` | 采样率，如 `-ar 48000` |
| `-ac N` | 声道数，如 `-ac 2`（立体声） |
| `-channel_layout` | 声道布局，如 `stereo`、`5.1` |
| `-sample_fmt` | 采样格式，如 `fltp`、`s16` |
| `-aq` / `-q:a` | 音频质量（VBR，编码器相关） |
| `-b:a` | 音频目标码率 |
| `-af` | 音频滤镜图（详见滤镜文档） |

```bash
# 无损提取音频到 FLAC
ffmpeg -i in.mkv -vn -c:a flac -compression_level 8 out.flac

# 转 Opus 96k 立体声
ffmpeg -i in.mp4 -vn -c:a libopus -b:a 96k -ac 2 out.opus

# 重采样到 48kHz 立体声 AAC
ffmpeg -i in.mp4 -c:v copy -c:a aac -ar 48000 -ac 2 -b:a 160k out.mp4
```

---

> 📖 字幕编码器（subrip/ass/webvtt/mov_text/dvdsub/dvbsub 等）与容器兼容性，
> 见《FFmpeg 字幕处理完全指南》（`ffmpeg-guide-subtitles.md`）§1。

## 9. 硬件编码器参数

> 完整硬件加速用法（解码/滤镜/全 GPU 管线）见《FFmpeg 硬件加速与质量对比指南》。本节仅列编码器参数。

### 9.1 NVENC（NVIDIA）

**预设与调优（实测本机 `h264_nvenc` 输出）：**

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `-preset` | `p1`~`p7`（新）/ `fast` `medium` `slow`（旧别名） | `p1` 最快质量最低，`p7` 最慢质量最好，默认 `p4` |
| `-tune` | `hq`(默认) `ll` `ull` `lossless` | 高质量 / 低延迟 / 超低延迟 / 无损 |
| `-rc` | `constqp` `vbr` `cbr` | 码率控制模式 |
| `-cq` | 0~51 | **VBR 模式下的目标质量**（对应软件编码的 CRF），0 表示自动；常用 19~28 |
| `-qp` | 0~51 | `constqp` 模式常量 QP |
| `-b:v` | — | 目标码率（VBR/CBR） |
| `-maxrate` / `-bufsize` | — | 峰值与缓冲约束 |
| `-profile` | `baseline` `main` `high` `high10` `high422` `high444p` | 档次 |
| `-level` | `auto` `4.1` `5.1` … | 级别 |
| `-rc-lookahead N` | 0~ | 前瞻帧数 |
| `-spatial-aq 1` / `-temporal-aq 1` | — | 空间/时间自适应量化 |
| `-aq-strength N` | 1~15（默认 8） | AQ 强度 |
| `-b_adapt 0` | — | 关闭自适应 B 帧 |
| `-no-scenecut 1` | — | 关闭场景切换插入 I 帧 |
| `-zerolatency 1` | — | 零延迟（无重排） |
| `-nonref_p 1` | — | 自动插入非参考 P 帧 |
| `-strict_gop 1` | — | 最小化 GOP 间码率波动 |
| `-b_ref_mode` | `disabled` `each` `middle` | B 帧作为参考 |
| `-multipass` | `disabled` `qres` `fullres` | 两遍编码（1/4 分辨率或全分辨率） |
| `-init_qpI/P/B` | -1~51 | 各帧类型初始 QP |
| `-qmin` / `-qmax` | -1~51 | QP 上下限 |
| `-coder` | `default` `auto` `cabac` `cavlc` | 熵编码 |
| `-weighted_pred 1` | — | 加权预测 |
| `-intra-refresh 1` | — | 周期内刷新 |
| `-forced-idr 1` | — | 强制 IDR |
| `-gpu N` | — | 指定 GPU 序号（`-2` 列出可用设备） |
| `-surfaces N` | 0~64 | 并发 surface 数 |
| `-highbitdepth 1` | — | 8bit 输入启用 10bit 编码 |
| `-dpb_size N` | — | DPB 大小 |
| `-cbr_padding 1` | — | CBR 模式补齐码率 |
| `-tf_level N` | — | 时间滤波强度 |
| `-lookahead_level N` | 0~15 | 前瞻等级 |
| `-a53cc` / `-udu_sei` / `-extra_sei` | — | 字幕/SEI 透传 |

```bash
# NVENC 恒定质量归档（推荐）
ffmpeg -i in.mp4 -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 26 -b:v 0 -spatial-aq 1 -temporal-aq 1 -c:a copy out.mp4

# NVENC 直播低延迟
ffmpeg -i in.mp4 -c:v h264_nvenc -preset p4 -tune ll -rc cbr -b:v 6M -maxrate 6M -bufsize 12M -zerolatency 1 -g 50 -bf 0 -c:a aac -b:a 160k out.flv

# 无损
ffmpeg -i in.mp4 -c:v h264_nvenc -tune lossless -rc constqp -qp 0 out.mp4

# 指定第二块 GPU
ffmpeg -i in.mp4 -c:v h264_nvenc -gpu 1 -cq 24 out.mp4
```

> NVENC 的 `-cq` **必须配合 `-rc vbr`** 才生效；只写 `-cq` 而不指定 `-rc` 时行为随驱动/版本可能不一致。

### 9.2 Intel QSV（`*_qsv`）

**码率控制选择规则（官方文档）：**

- 指定 `-global_quality` → 质量模式：同时设 `-qscale` 为 CQP；设 `-look_ahead` 为 LA_ICQ；否则 ICQ（**质量范围 1~51，1 最好**）
- 指定 `-b:v` → 码率模式：设 `-look_ahead` 为 LA；设 `-vcm` 为 VCM；`maxrate == b:v` 为 CBR；`maxrate > b:v` 为 VBR；设 `avbr_accuracy` 与 `avbr_convergence` 为 AVBR
- 都不指定 → 默认 CQP

| 参数 | 说明 |
| --- | --- |
| `-preset` | `veryfast` `faster` `fast` `medium` `slow` `slower` `veryslow` |
| `-global_quality N` | 质量模式数值（1~51，1 最好） |
| `-qscale` | 配合 `global_quality` 使用 CQP |
| `-look_ahead` / `-look_ahead_depth` | 前瞻（LA / LA_ICQ 模式） |
| `-look_ahead_downsampling` | 前瞻降采样：`auto` `off` `2x` `4x` |
| `-vcm` | 视频会议模式 |
| `-avbr_accuracy` / `-avbr_convergence` | AVBR 精度（1/10 %）与收敛（100 帧） |
| `-async_depth N` | 异步深度，提升吞吐 |
| `-low_power` | 低功耗模式（可能功能受限） |
| `-extbrc` | 扩展码率控制 |
| `-mbbrc` | 宏块级码率控制（提升主观质量，降低客观指标） |
| `-bitrate_limit` | 码率限制开关（关闭可能违反 HRD） |
| `-max_frame_size` / `_i` / `_p` | 帧/ I 帧/ P 帧最大字节数 |
| `-max_slice_size` | 最大 slice 字节数 |
| `-rdo` | 率失真优化 |
| `-adaptive_i` / `-adaptive_b` | 自适应 I/B 帧 |
| `-p_strategy` | P 金字塔：0 默认 / 1 simple / 2 pyramid（需 `bf=0`） |
| `-b_strategy` | B 帧作为参考 |
| `-dblk_idc` | 去块滤波 0~2 |
| `-cavlc` | 使用 CAVLC（默认 CABAC） |
| `-idr_interval` | IDR 间隔 |
| `-int_ref_type` | 内刷新类型：`none` `vertical` `horizontal` `slice`（需 `bf=0`） |
| `-int_ref_cycle_size` / `-int_ref_qp_delta` / `-int_ref_cycle_dist` | 内刷新周期/QP 增量/距离 |
| `-max_qp_i` / `-min_qp_i` / `_p` / `_b` | 各帧类型 QP 上下限 |
| `-scenario` | 场景提示：`unknown` `displayremoting` `videoconference` `archive` `livestreaming` `cameracapture` `videosurveillance` `gamestreaming` `remotegaming` |
| `-low_delay_brc` | 严格遵循平均帧大小 |
| `-dual_gfx` | HyperEncode（iGPU + dGPU 同时编码）：`off` `on` `adaptive` |
| `-pic_timing_sei` / `-single_sei_nal_unit` / `-repeat_pps` / `-aud` | SEI/NAL 控制 |
| `-max_dec_frame_buffering` | DPB 帧数 |
| `-skip_frame` | `no_skip` `insert_dummy` `insert_nothing` `brc_only` |
| `-qsv_params` | 透传 MSDK/QSV 参数 |

```bash
# QSV 质量模式（ICQ）
ffmpeg -i in.mp4 -c:v hevc_qsv -preset slow -global_quality 24 -c:a copy out.mp4

# QSV 归档场景 + 前瞻
ffmpeg -i in.mp4 -c:v h264_qsv -preset slower -global_quality 23 -look_ahead 1 -look_ahead_depth 40 -scenario archive -c:a copy out.mp4

# QSV CBR 直播
ffmpeg -i in.mp4 -c:v h264_qsv -preset medium -b:v 6M -maxrate 6M -bufsize 12M -low_delay_brc 1 -c:a aac out.flv
```

### 9.3 AMD AMF（`*_amf`）

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `-usage` | `transcoding`(默认) `ultralowlatency` `lowlatency` `webcam` `high_quality` `lowlatency_high_quality` | 使用场景 |
| `-quality` | `balanced` `speed` `quality` `high_quality` | 编码质量预设 |
| `-rc` | `cqp` `cbr` `vbr_peak` `vbr_latency` | 码率控制模式 |
| `-qp_i` / `-qp_p` / `-qp_b` | — | 各帧类型 QP（CQP 模式） |
| `-b:v` / `-maxrate` / `-bufsize` | — | 码率与 VBV |
| `-profile` / `-level` | — | 档次/级别 |
| `-g` / `-bf` / `-refs` | — | GOP / B 帧 / 参考帧 |
| `-latency` | `auto`/`true`/`false` | 低延迟模式 |
| `-preanalysis` | — | 预分析（提升质量） |
| `-vbaq` | — | 自适应量化 |
| `-enforce_hrd` | — | 强制 HRD |
| `-filler_data` | — | CBR 填充数据 |
| `-header_insertion_mode` | — | 头插入模式 |
| `-me_half_pel` / `-me_quarter_pel` | — | 运动估计精度 |

```bash
# AMF 高质量转码
ffmpeg -i in.mp4 -c:v hevc_amf -usage transcoding -quality quality -rc vbr_peak -b:v 6M -maxrate 9M -bufsize 12M -c:a copy out.mp4

# AMF 低延迟直播
ffmpeg -i in.mp4 -c:v h264_amf -usage lowlatency -rc cbr -b:v 6M -maxrate 6M -bufsize 6M -latency true -c:a aac out.flv
```

### 9.4 VAAPI（`*_vaapi`，Linux 为主）

| 参数 | 说明 |
| --- | --- |
| `-rc_mode` | `auto`(默认) `CQP` `CBR` `VBR` `ICQ` `QVBR` `AVBR` |
| `-qp N` | CQP 模式的 P 帧 QP（I/B 由 qfactor/qoffset 缩放），0~52 |
| `-q / -global_quality` | 尺寸/质量权衡（越大越小越差） |
| `-compression_level N` | 速度/质量权衡（越大越快越差） |
| `-quality N` | 编码质量（越高越快） |
| `-low_power` | 低功耗模式 |
| `-idr_interval N` | IDR 间隔 |
| `-b_depth N` | B 帧参考深度 |
| `-async_depth N` | 并行度 |
| `-max_frame_size N` | 帧最大字节数（CQP 模式无效） |
| `-blbrc` | 块级码率控制（CQP 无效） |
| `-coder` | `cabac`(默认) / `cavlc` |
| `-aud` / `-sei` | AUD / SEI 控制 |
| `-profile` / `-level` | 档次/级别 |
| `-slices` | slice 数 |
| `-tiles` | tile 数（HEVC/AV1） |
| `-tier` | HEVC tier |

```bash
# VAAPI CQP
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 -c:v h264_vaapi -rc_mode CQP -qp 24 -c:a copy out.mp4

# VAAPI ICQ（恒定质量）
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 -c:v hevc_vaapi -rc_mode ICQ -global_quality 25 -c:a copy out.mp4
```

### 9.5 MediaFoundation（`*_mf`，Windows）

| 参数 | 说明 |
| --- | --- |
| `-rate_control` | `default` `cbr` `pc_vbr` `u_vbr` `quality` `ld_vbr` `g_vbr` `gld_vbr` |
| `-scenario` | `default` `display_remoting` `video_conference` `archive` `live_streaming` `camera_record` `display_remoting_with_feature_map` |
| `-quality N` | 编码质量 0~100（-1 为默认） |
| `-hw_encoding 1` | 强制硬件编码（默认 0） |

```bash
ffmpeg -i in.mp4 -c:v h264_mf -hw_encoding 1 -rate_control quality -quality 80 -c:a copy out.mp4
```

---

## 10. 质量与体积调优方法论

### 10.1 调优流程（推荐）

1. **明确约束**：目标体积？目标码率？播放兼容性？——这决定模式选择。
2. **选定 CRF 基准**：用 `-preset` 中等档跑一次 CRF，测体积与主观质量。
3. **扫描 CRF**：以 2 为步长试 `CRF-2 / CRF / CRF+2`，找到质量拐点。
4. **优化预设**：在可接受耗时内选最慢预设（压缩率收益显著）。
5. **内容定向微调**：AQ / psy / deblock 按素材类型调整。
6. **客观验证**：用 PSNR/SSIM/VMAF 与源对比，确认没有异常劣化。
7. **必要时加 VBV**：若需流式播放，补 `-maxrate`/`-bufsize`。

### 10.2 各编码器 CRF/QP 参考区间

| 编码器 | 参数 | 视觉无损 | 高质量 | 平衡 | 小体积 |
| --- | --- | --- | --- | --- | --- |
| libx264 | `-crf` | 16~18 | 18~20 | 21~23 | 24~28 |
| libx265 | `-crf` | 18~20 | 21~23 | 24~26 | 27~30 |
| libsvtav1 | `-crf` | 18~22 | 23~27 | 28~32 | 33~40 |
| libaom-av1 | `-crf` | 18~22 | 23~28 | 29~34 | 35~42 |
| libvpx-vp9 | `-crf` | 15~20 | 21~27 | 28~33 | 34~40 |
| NVENC | `-cq` | 17~19 | 20~23 | 24~27 | 28~33 |
| QSV | `-global_quality` | 18~21 | 22~25 | 26~30 | 31~36 |
| AMF | `-qp_i/-qp_p` | 18~21 | 22~25 | 26~30 | 31~36 |

> 区间为经验起点，必须结合素材与主观测试校准。

### 10.3 内容类型调优建议

| 内容类型 | 建议 |
| --- | --- |
| **实拍电影/剧集** | 中等 AQ，保留颗粒（`-tune grain` / x265 `psy-rd=2.5`），deblock 适度 |
| **动画/卡通** | 关闭或降低 psy-trellis（`psy-rd=1.0:0.0`），deblock 减弱，可用较高 AQ |
| **屏幕录制/演示** | 关注文字锐度：deblock 减弱（`0:0` 或 `-1,-1`），可考虑 `-tune stillimage` |
| **体育/高运动** | 提高 `-rc-lookahead`，更多参考帧，避免过强 deblock |
| **暗场/夜景** | `aq-mode 3/4`（暗场加权），`aq-strength` 略提高 |
| **噪点/胶片颗粒** | 不要预先降噪；`-tune grain`，提高码率或 CRF 放宽 |

### 10.4 速度与质量取舍

| 手段 | 收益 | 代价 |
| --- | --- | --- |
| `-preset` 更慢档 | 压缩率提升 5~15% | 编码时间成倍增加 |
| 2-pass | 目标码率下质量更稳定 | 编码时间 ×2 |
| 更高 `-rc-lookahead` | 帧类型决策更优 | 内存与延迟 |
| 关闭 `sao` / `enable-restoration` | 明显提速 | 压缩率略降 |
| 硬件编码 | 速度 5~20× | 同码率质量低于软件编码 |

---

## 11. 常见问题与参数速查表

### 11.1 常见错误与解决

| 现象 | 原因与解决 |
| --- | --- |
| `Unknown encoder 'libx264'` | 构建未启用；用 `ffmpeg -encoders \| grep x264` 确认 |
| `height not divisible by 2` | 像素格式要求偶数尺寸；用 `scale=trunc(iw/2)*2:trunc(ih/2)*2` |
| `No NVENC capable devices found` | 像素格式不受支持或驱动/GPU 不支持该 codec；查 `ffmpeg -h encoder=h264_nvenc` 的像素格式列表 |
| `Could not open codec` (QSV) | 需要 `-init_hw_device qsv` 或 `-hwaccel qsv`；确认驱动与 `libvpl` |
| 输出体积远超预期 | 未设 CRF/码率，落到了默认码率；检查是否被 `-b:v` 覆盖 |
| `-crf` 无效 | 部分编码器需 `-b:v 0` 才走纯 CRF（libvpx-vp9、libaom-av1） |
| 2-pass 报错 | 两遍参数必须完全一致；`-passlogfile` 前缀要相同 |

### 11.2 按场景速查

| 场景 | 推荐命令骨架 |
| --- | --- |
| **H.264 兼容归档** | `-c:v libx264 -preset slow -crf 20 -c:a copy` |
| **HEVC 高压缩归档** | `-c:v libx265 -preset slow -crf 24 -x265-params aq-mode=3 -c:a copy` |
| **AV1 归档** | `-c:v libsvtav1 -preset 6 -crf 30 -g 240 -c:a copy` |
| **WebM 网页播放** | `-c:v libvpx-vp9 -b:v 0 -crf 31 -row-mt 1 -c:a libopus -b:a 96k` |
| **直播推流** | `-c:v libx264 -preset veryfast -tune zerolatency -b:v 4M -maxrate 4M -bufsize 8M -g 50 -c:a aac -b:a 128k` |
| **快速硬件转码** | `-c:v hevc_nvenc -preset p6 -rc vbr -cq 26 -c:a copy` |
| **无损归档** | `-c:v libx264 -qp 0 -preset ultrafast` / `-c:v ffv1` |
| **代理剪辑素材** | `-c:v libx264 -preset ultrafast -crf 28 -vf scale=1280:-2 -an` |
| **提取音频** | `-vn -c:a copy`（不重编码）或 `-vn -c:a flac` |
| **统一封装不重编码** | `-c copy -movflags +faststart` |

### 11.3 参数自检命令

```bash
ffmpeg -encoders                    # 列出所有编码器
ffmpeg -h encoder=libx264           # 查看某编码器全部选项与默认值
ffmpeg -h encoder=hevc_nvenc
ffmpeg -h full                      # 全部选项（很长）
ffmpeg -pix_fmts                    # 支持的像素格式
ffmpeg -buildconf                   # 构建配置（确认启用了哪些库）
ffmpeg -hwaccels                    # 支持的硬件加速方法
```

---

## 附录：本文参数来源对照

| 章节 | 主要来源 |
| --- | --- |
| 2 通用参数 | `ffmpeg-all.md` §5.4 Main options、§5.5 Video Options、§5.6 Advanced Video options |
| 3 2-pass 与质量评估 | `ffmpeg-all.md` §5.5 `-pass`/`-passlogfile`；`ffmpeg-filters.md` §11.204 psnr、§11.244 ssim、§11.148 libvmaf |
| 4 libx264 | `ffmpeg-all.md` §16.20；`ffmpeg -h encoder=libx264` |
| 5 libx265 | `ffmpeg-all.md` §16.21；`ffmpeg -h encoder=libx265` |
| 6 AV1 | `ffmpeg-all.md` §16.8 libaom-av1、§16.10 libsvtav1、§16.7 librav1e |
| 7 libvpx | `ffmpeg-all.md` §16.16 |
| 8 音频 | `ffmpeg-all.md` §15 音频编码器、§5.7 Audio Options |
| 9 硬件编码器 | `ffmpeg-all.md` §16.31 QSV、§16.33 VAAPI、§16.26 MediaFoundation；`ffmpeg -h encoder=h264_nvenc`、`h264_amf`、`h264_qsv`、`h264_vaapi` |
