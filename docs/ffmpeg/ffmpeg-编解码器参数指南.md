# FFmpeg 编解码器（Decoder / Encoder）参数使用指南

> 本文档依据 FFmpeg 官方《ffmpeg-codecs》文档（对应 FFmpeg
> 7.1）整理编写，部分参数默认值以本机 FFmpeg
> 9 开发版（N-126689，2026-09-19）实测校准。覆盖通用 Codec 选项与常用/重要编解码器的私有参数，逐一给出含义、取值范围与默认值。

## 1. Codec 通用选项（所有编解码器可用）

libavcodec 提供一组全局通用选项，可作用于所有编码器和解码器。使用方式为命令行
`-选项 值`，每个编解码器还有自己的私有选项（见后文各节）。注意：部分通用选项只对特定类型（音频/视频、编码/解码）有意义，其它类型会忽略。

| 选项                                                          | 适用范围       | 含义与补充                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b`                                                           | 编码·音视频    | 目标码率，单位 bits/s，默认 **200K**（视频默认由编码器决定）                                                                                                                                                                                                                                                   |
| `ab`                                                          | 编码·音频      | 音频码率（bits/s），默认 **128K**，可用 `-b:a 192k` 形式                                                                                                                                                                                                                                                       |
| `bt`                                                          | 编码·视频      | 码率容差（bits/s）。单次编码中说明码率控制偏离目标平均码率的程度，与 min/maxrate 无关；调太低会损害质量                                                                                                                                                                                                        |
| `flags`                                                       | 通用           | 通用标志位，常用取值：`qscale`（固定 qscale 编码）、`pass1`/`pass2`（两遍码控）、`gray`（仅编解码灰度）、`global_header`（全局头放 extradata）、`bitexact`（平台无关可复现）、`cgop`（封闭 GOP）、`output_corrupt`（即使损坏帧也输出）、`drop_changed`（丢弃参数变化的帧）、`low_delay`、`mv4`、`qpel`、`loop` |
| `time_base`                                                   | 通用           | 编解码器时间基（有理数），固定帧率内容应设为 `1/帧率`                                                                                                                                                                                                                                                          |
| `g`                                                           | 编码·视频      | GOP（关键帧组）大小，默认 **12**                                                                                                                                                                                                                                                                               |
| `ar`                                                          | 解码/编码·音频 | 音频采样率（Hz），如 `-ar 48000`                                                                                                                                                                                                                                                                               |
| `ac`                                                          | 解码/编码·音频 | 声道数，如 `-ac 2`                                                                                                                                                                                                                                                                                             |
| `cutoff`                                                      | 编码·音频      | 截止带宽（Hz），仅部分编码器支持                                                                                                                                                                                                                                                                               |
| `frame_size`                                                  | 编码·音频      | 音频帧样本数；设为 0 表示允许可变帧大小                                                                                                                                                                                                                                                                        |
| `qcomp`                                                       | 编码·视频      | 视频量化尺度压缩系数（VBR 码控方程常量），推荐范围 0.0–1.0                                                                                                                                                                                                                                                     |
| `qblur`                                                       | 编码·视频      | 量化尺度模糊（VBR）                                                                                                                                                                                                                                                                                            |
| `qmin`                                                        | 编码·视频      | 最小量化尺度（VBR），范围 -1~69，默认 **2**                                                                                                                                                                                                                                                                    |
| `qmax`                                                        | 编码·视频      | 最大量化尺度（VBR），范围 -1~1024，默认 **31**                                                                                                                                                                                                                                                                 |
| `qdiff`                                                       | 编码·视频      | 相邻量化尺度最大差值（VBR）                                                                                                                                                                                                                                                                                    |
| `bf`                                                          | 编码·视频      | 非 B 帧间最大 B 帧数，范围 -1~16；0 禁用 B 帧，-1 由编码器自动选择，默认 **0**                                                                                                                                                                                                                                 |
| `b_qfactor` / `b_qoffset`                                     | 编码·视频      | P 帧与 B 帧之间的 QP 系数 / 偏移                                                                                                                                                                                                                                                                               |
| `i_qfactor` / `i_qoffset`                                     | 编码·视频      | P 帧与 I 帧之间的 QP 系数 / 偏移                                                                                                                                                                                                                                                                               |
| `strict`                                                      | 解码/编码      | 标准遵循程度：`very`（老标准）、`strict`、`normal`、`unofficial`（允许非官方扩展）、`experimental`（实验性，注意安全）                                                                                                                                                                                         |
| `err_detect`                                                  | 解码           | 错误检测标志，可组合：`crccheck`（校验内嵌 CRC）、`bitstream`（检测码流偏差）、`buffer`（检测非法码流长度）、`explode`（发现小错误即中止）、`ignore_err`（忽略错误继续解码）、`careful`、`compliant`、`aggressive`                                                                                             |
| `maxrate`                                                     | 编码·音视频    | 最大码率容差（bits/s），需与 `bufsize` 搭配                                                                                                                                                                                                                                                                    |
| `minrate`                                                     | 编码·音视频    | 最小码率容差（bits/s），主要用于 CBR 编码                                                                                                                                                                                                                                                                      |
| `bufsize`                                                     | 编码·音视频    | 码控缓冲大小（bits）                                                                                                                                                                                                                                                                                           |
| `aspect` / `sar`                                              | 编码·视频      | 样本宽高比（SAR），有理性数如 `16:9`                                                                                                                                                                                                                                                                           |
| `debug`                                                       | 解码/编码      | 调试信息：`pict`、`rc`、`bitstream`、`mb_type`、`qp`、`dct_coeff`、`skip`、`startcode`、`bugs`、`buffers` 等                                                                                                                                                                                                   |
| `cmp` / `subcmp` / `mbcmp` / `ildctcmp` / `precmp`            | 编码·视频      | 整像素/亚像素/宏块/隔行 DCT/预扫描运动估计比较函数：`sad`（默认，快）、`sse`、`satd`、`dct`、`psnr`、`bit`、`rd`（率失真最优，慢）、`zero`、`vsad`、`vsse`、`nsse`、`w53`、`w97`、`dctmax`、`chroma`                                                                                                           |
| `dia_size`                                                    | 编码·视频      | 菱形搜索类型与尺寸：`>1024` 全搜索（最慢）、`768~1024` umh、`512~768` hex、`256~512` l2s、`2~256` var、`-1~2` small、`-1` funny、`< -1` sab                                                                                                                                                                    |
| `last_pred`                                                   | 编码·视频      | 使用上一帧运动预测器数量                                                                                                                                                                                                                                                                                       |
| `pre_dia_size`                                                | 编码·视频      | 预扫描菱形尺寸                                                                                                                                                                                                                                                                                                 |
| `subq`                                                        | 编码·视频      | 亚像素运动估计质量                                                                                                                                                                                                                                                                                             |
| `me_range`                                                    | 编码·视频      | 运动向量搜索范围（DivX 播放器兼容用 1023）                                                                                                                                                                                                                                                                     |
| `mbd`                                                         | 编码·视频      | 宏块决策算法：`simple`（用 mbcmp，默认）、`bits`（最少比特）、`rd`（最佳率失真）                                                                                                                                                                                                                               |
| `flags2`                                                      | 通用           | 第二组标志：`fast`、`noout`、`ignorecrop`、`local_header`（全局头放每个关键帧）、`chunks`、`showall`（关键帧前帧也输出）、`export_mvs`（导出运动向量）、`skip_manual`、`icc_profiles`、`fixed_frame_size`                                                                                                      |
| `export_side_data`                                            | 通用           | 导出边数据：`mvs`（运动向量）、`prft`（编码器生产参考时间）、`venc_params`（视频编码参数，H.264/VP9）、`film_grain`（胶片颗粒，AV1）、`enhancements`（增强元数据如 LCEVC）                                                                                                                                     |
| `threads`                                                     | 解码/编码·视频 | 线程数，`auto`/`0` 自动选择，默认 **auto**                                                                                                                                                                                                                                                                     |
| `thread_type`                                                 | 解码/编码·视频 | 多线程方式：`slice`（切片并行，需编码时用了 slices）、`frame`（帧并行），默认 **slice+frame**                                                                                                                                                                                                                  |
| `profile`                                                     | 编码           | 编码器 profile，默认 `unknown`（具体取值见各编码器）                                                                                                                                                                                                                                                           |
| `level`                                                       | 编码           | 编码层级，默认 `unknown`                                                                                                                                                                                                                                                                                       |
| `lowres`                                                      | 解码           | 降低解码分辨率：1=1/2、2=1/4、3=1/8                                                                                                                                                                                                                                                                            |
| `skip_loop_filter` / `skip_idct` / `skip_pred` / `skip_frame` | 解码·视频      | 解码丢弃策略：`none`、`default`（丢弃无用的 0 尺寸帧）、`noref`（丢弃非参考帧）、`bidir`（丢弃双向帧）、`nokey`（只留关键帧）、`nointra`（只留 I 帧）、`all`；`skip_pred` 与 `skip_idct` 都为 `all` 时解码器只输出带时间戳的元数据帧；默认 **default**                                                         |
| `bidir_refine`                                                | 编码·视频      | 细化双向宏块的两个运动向量                                                                                                                                                                                                                                                                                     |
| `keyint_min`                                                  | 编码·视频      | IDR 帧最小间隔                                                                                                                                                                                                                                                                                                 |
| `refs`                                                        | 编码·视频      | 运动补偿参考帧数                                                                                                                                                                                                                                                                                               |
| `trellis`                                                     | 编码·音视频    | 率失真最优量化（Trellis）                                                                                                                                                                                                                                                                                      |
| `compression_level`                                           | 编码·音视频    | 压缩级别（对 flac/png 等无级别编码器生效）                                                                                                                                                                                                                                                                     |
| `channel_layout`                                              | 解码/编码·音频 | 声道布局，如 `stereo`、`5.1`、`7.1`                                                                                                                                                                                                                                                                            |
| `color_primaries`                                             | 解码/编码·视频 | 色彩原色：`bt709`、`bt470m`、`bt470bg`、`smpte170m`、`smpte240m`、`film`、`bt2020`、`smpte428`、`smpte431`、`smpte432`、`jedec-p22`                                                                                                                                                                            |
| `color_trc`                                                   | 解码/编码·视频 | 色彩传输曲线：`bt709`、`gamma22`、`gamma28`、`smpte170m`、`smpte240m`、`linear`、`log100`、`log316`、`iec61966-2-4`、`bt1361`、`iec61966-2-1`、`bt2020_10`、`bt2020_12`、`smpte2084`（HDR PQ）、`smpte428`、`arib-std-b67`（HLG）                                                                              |
| `colorspace`                                                  | 解码/编码·视频 | 色彩空间：`rgb`、`bt709`、`fcc`、`bt470bg`、`smpte170m`、`smpte240m`、`ycocg`、`bt2020_ncl`、`bt2020_cl`、`smpte2085`、`chroma-derived-nc`、`chroma-derived-c`、`ictcp`                                                                                                                                        |
| `color_range`                                                 | 解码/编码·视频 | 色彩范围：`tv`/`mpeg`/`limited`（有限范围 219）、`pc`/`jpeg`/`full`（全范围 255）                                                                                                                                                                                                                              |
| `chroma_sample_location`                                      | 解码/编码·视频 | 色度采样位置：`left`、`center`、`topleft`、`top`、`bottomleft`、`bottom`                                                                                                                                                                                                                                       |
| `slices`                                                      | 编码·视频      | 切片数（并行编码用）                                                                                                                                                                                                                                                                                           |
| `audio_service_type`                                          | 编码·音频      | 音频服务类型：`ma`（主服务）、`ef`（效果）、`vi`（视障）、`hi`（听障）、`di`（对白）、`co`（评论）、`em`（紧急）、`vo`（画外音）、`ka`（卡拉OK）                                                                                                                                                               |
| `request_sample_fmt`                                          | 解码·音频      | 解码器期望输出的采样格式，默认 `none`                                                                                                                                                                                                                                                                          |
| `sub_charenc`                                                 | 解码·字幕      | 输入字幕字符编码                                                                                                                                                                                                                                                                                               |
| `field_order`                                                 | 视频           | 设置/覆盖场序：`progressive`、`tt`、`bb`、`tb`、`bt`                                                                                                                                                                                                                                                           |
| `skip_alpha`                                                  | 解码·视频      | 设为 1 跳过 alpha（透明）通道处理，类似 `gray` 标志跳过色度                                                                                                                                                                                                                                                    |
| `codec_whitelist`                                             | 输入           | 允许使用的解码器列表（逗号分隔），默认全部允许                                                                                                                                                                                                                                                                 |
| `max_pixels`                                                  | 解码/编码·视频 | 单帧最大像素数，防止超大图像 OOM                                                                                                                                                                                                                                                                               |
| `apply_cropping`                                              | 解码·视频      | 启用裁剪（默认 1 启用）                                                                                                                                                                                                                                                                                        |

## 2. 视频解码器

### 2.1 av1（内置 AV1 解码器）

- `operating_point`：选择可分级（scalable）AV1 码流的操作点（0–31），默认 **0**。

### 2.2 libdav1d（dav1d AV1 解码器）

- `max_frame_delay`：解码器内部缓冲的最大帧数，默认 0（自动检测）。
- `filmgrain`：码流含胶片颗粒时是否应用（已弃用，建议用 `export_side_data` 导出）。
- `oppoint`：可分级 AV1 码流操作点（0–31）。
- `alllayers`：是否输出可分级 AV1 码流的所有空间层，默认 false。

### 2.3 hevc（H.265/HEVC 解码器）

- 默认只解码基础层。MV-HEVC 多视点流支持最多两个视图：
- `view_ids`：指定要输出的视图 ID 列表；设为单个 `-1` 则输出 VPS 中定义的所有视图。
- `view_ids_available` / `view_pos_available`：只读，获取 VPS 中可用视图 ID
  / 视图位置（左、右或不指定）。

### 2.4 rawvideo（原始视频解码器）

- `top` / `top_field_first`：假定输入场型，-1 逐行（默认）、0 bottom 优先、1 top 优先。

### 2.5 QSV 解码器（Intel Quick Sync）

h264_qsv、hevc_qsv、av1_qsv、mpeg2_qsv、vc1_qsv 等。通过 `-hwaccel qsv -hwaccel_output_format qsv`
配合使用，解码器本身无特殊私有参数，主要使用通用选项与 `-hwaccel` 硬件加速参数。

### 2.6 其它常用解码器

- `libaom-av1` 无额外解码选项；`mpeg2video`、`vp8`、`vp9`、`msmpeg4` 等使用通用选项即可。
- 字幕解码器：`dvdsub`（DVD 字幕）、`dvbsub`（DVB 字幕）无特殊参数；`libaribb24`（ARIB 字幕）可用
  `arib_std`/`force_style` 等少量选项。

## 3. 音频解码器

### 3.1 ac3（AC-3 / E-AC-3 解码器）

- `drc_scale`：动态范围压缩（DRC）缩放因子，指数级应用，默认 **1**。
    - `0`：禁用 DRC，输出全动态范围；
    - `0 < x <= 1`：应用码流 DRC 值的一部分；
    - `> 1`：不对称应用，响音全压缩、弱音增强。

### 3.2 flac（FLAC 解码器）

- `use_buggy_lpc`：解码早期 lavc FLAC 编码器产生的高 LPC 值问题流时使用旧的 buggy 逻辑。

### 3.3 其它音频解码器

- `libopus`、`libgsm`、`libilbc`（`enhance`
  选项，0 禁用增强）、`libopencore-amrnb/amrwb`、`pcm_dvda` 等大多无特殊参数，直接使用通用选项即可。

## 4. 音频编码器

### 4.1 aac（FFmpeg 内置 AAC 编码器，默认 AAC 编码器）

- `b`：码率（bits/s），设置后自动进入 CBR 模式；不设置默认 **128kbps**。
- `q`：VBR 质量（仅命令行可用，库接口用 `global_quality`）。
- `cutoff`：截止频率，不设置则编码器按低码率动态调整以提升清晰度。
- `aac_coder`：编码方法：`twoloop`（双循环搜索 TLS，默认）、`anmr`（实验性，质量差且慢，不推荐）、`fast`（常量量化器，低码率 <64kbps 效果差，高码率快而好）。
- `aac_ms`：中/侧（M/S）立体声编码：`auto`（默认，自动）、`enable`（强制）、`disable`。
- `aac_is`：强度立体声（IS）工具，默认启用（auto 切换）；可 `disable` 禁用调试。
- `aac_pns`：感知噪声替换（PNS），默认启用，低熵高频带用白噪声替换。
- `aac_tns`：时域噪声整形（TNS），默认启用；多抽头 FIR 滤波隐藏高频量化噪声。
- `aac_ltp`：长时预测扩展，极低带宽（语音、钢琴独奏）提升效率；由 `profile:a aac_ltp` 隐含启用。
- `profile`：`aac_low`（LC，默认，兼容性最好）、`mpeg2_aac_low`（等效
  `aac_low` + 关 PNS）、`aac_ltp`（MPEG-4 长时预测）。

命令行示例：

```
ffmpeg -i in.wav -c:a aac -b:a 192k -profile:a aac_low out.m4a
ffmpeg -i in.wav -c:a aac -q:a 2 out.m4a          # VBR 质量
```

### 4.2 libfdk_aac（Fraunhofer FDK-AAC，质量最佳，需 --enable-libfdk-aac）

- 共享选项：`b`（码率 bits/s，不设置按 profile 自动）、`ar`、`channels`、`flags +qscale`（启用 VBR）、`cutoff`、`profile`。
- `profile`：`aac_low`（LC，默认）、`aac_he`（HE-AAC）、`aac_he_v2`（HE-AACv2）、`aac_ld`（低延迟）、`aac_eld`（增强低延迟）。
- 私有选项：
    - `afterburner`：质量增强，默认 **1**。
    - `eld_sbr`：ELD 的 SBR（频谱复制），默认 0。
    - `eld_v2`：ELDv2（LD-MPS 扩展），默认 0。
    - `signaling`：SBR/PS 信令方式：`default`（默认，显式分级）、`implicit`、`explicit_sbr`、`explicit_hierarchical`。
    - `latm`：输出 LATM/LOAS 封装，默认 0。
    - `header_period`：LATM 内带配置周期（帧数），默认 0。
    - `vbr`：VBR 模式 1–5（1 最低质量 32kbps/声道，5 最高质量约 80–96kbps/声道）；0 禁用 VBR 走 CBR，默认
      **0**。仅 aac_low profile 支持 VBR。

```
ffmpeg -i in.wav -c:a libfdk_aac -vbr 3 out.m4a
ffmpeg -i in.wav -c:a libfdk_aac -profile:a aac_he -b:a 64k out.m4a
```

### 4.3 ac3 / ac3_fixed（AC-3 编码器）

ac3 用浮点运算，ac3_fixed 用定点整数运算（需显式
`-acodec ac3_fixed`）。音频元数据选项（多数只影响播放端）：

- `per_frame_metadata`：每帧检查变化元数据，0=初始化值作用于所有帧（默认），1=逐帧可变。
- `center_mixlev`：中心声道下混增益：`0.707`（-3dB）、`0.595`（-4.5dB，默认）、`0.500`（-6dB）。
- `surround_mixlev`：环绕声道下混增益：`0.707`（-3dB）、`0.500`（-6dB，默认）、`0.000`（静音环绕）。
- `mixing_level`：混音峰值声压级 80–111，-1 表示未知。
- `room_type`：制作房间类型：0 notindicated（默认）、1 large（大型配音棚 X 曲线）、2
  small（平直均衡）。
- `copyright`、`original`、`dialnorm` 等标志类选项。

```
ffmpeg -i in.wav -c:a ac3 -b:a 384k out.ac3
```

### 4.4 flac（FLAC 无损编码器）

- `compression_level`：压缩级别 **0–12**，默认 **5**，设定 12 级内多数子选项的默认值。
- `frame_size`：每声道每帧样本数。
- `lpc_coeff_precision`：LPC 系数精度 1–15，默认 **15**。
- `lpc_type`：第一阶段 LPC 算法：`none`、`fixed`、`levinson`、`cholesky`。
- `lpc_passes`：Cholesky 分解次数。
- `min_partition_order` / `max_partition_order`：最小/最大分区阶数。
- `prediction_order_method`：`estimation`、`2level`、`4level`、`8level`、`search`（暴力搜索）、`log`。
- `ch_mode`：声道模式：`auto`（默认）、`indep`（独立编码）、`left_side`、`right_side`、`mid_side`。
- `exact_rice_parameters`：精确计算 Rice 参数（1 更慢略增压缩）。
- `multi_dim_quant`：多维量化，第二阶段 LPC 细化系数（慢、略增压缩）。

### 4.5 opus（FFmpeg 内置 Opus 编码器，开发中，仅实现 CELT 部分）

- `b`：码率 bits/s，不设置按声道数与布局估算。
- `opus_delay`：最大延迟（毫秒）；低于 20ms 会快速降低质量。

### 4.6 libopus（libopus 编码器，推荐）

- `b`：码率 bits/s（`opusenc` 的 bitrate 以 kbps 表示，注意单位差异）。
- `vbr`：`off`（CBR）、`on`（VBR，默认）、`constrained`（受限 VBR）。
- `compression_level`：编码复杂度 **0–10**，默认 **10**（最高质量最慢）。
- `frame_duration`：帧时长（毫秒），必须为 `2.5, 5, 10, 20, 40, 60` 之一，默认
  **20**；越小延迟越低但同码率质量越低。
- `packet_loss`：预期丢包率百分比，默认 0。
- `fec`：带内前向纠错，需非零丢包率才有效，默认禁用。
- `application`：`voip`（语音可懂度优先）、`audio`（忠实输入，默认）、`lowdelay`（最低延迟模式）。
- `cutoff`：带宽截止（Hz）：4000（窄带）、6000（中带）、8000（宽带）、12000（超宽带）、20000（全带）；默认 0 禁用。注意 <15kbps 时 libopus 强制宽带截止。
- `mapping_family`：声道映射族：默认 -1（单/双声道用 0，环绕用 1）、0（单/双声道）、1（环绕带掩蔽与 LFE 优化）、255（独立流）。
- `dtx`：断续传输（舒适噪声），默认 0。
- `apply_phase_inv`：强度立体声相位反转（需 libopus≥1.2），默认 1；设 0 改善单声道下混质量。

### 4.7 libmp3lame（LAME MP3 编码器）

- `b`：CBR/ABR 码率 bits/s（LAME 的 bitrate 为 kbps）。
- `q`：VBR 常量质量（命令行），库接口用 `global_quality`。
- `compression_level`：算法质量 0–9，0 最高质量最慢，9 最快最差。
- `cutoff`：低通截止频率，不设置则动态调整。
- `reservoir`：比特蓄水池，默认 **1**（对应 LAME --nores 的默认开启）。
- `joint_stereo`：允许逐帧选择 L/R 或 M/S 立体声，默认 **1**。
- `abr`：启用 ABR（需配合 `b` 设目标码率），默认 0。
- `copyright` / `original`：MPEG 音频标志，默认 0 / 1。

```
ffmpeg -i in.wav -c:a libmp3lame -b:a 192k out.mp3
ffmpeg -i in.wav -c:a libmp3lame -q:a 2 out.mp3     # VBR V2
```

### 4.8 libvorbis（Vorbis 编码器）

- `b`：ABR 码率 bits/s。
- `q`：VBR 常量质量 -1.0~10.0，默认 **3.0**。
- `cutoff`：截止带宽 Hz，0 禁用（默认）。
- `minrate` / `maxrate`：最小/最大码率 bits/s（maxrate 仅 ABR 生效）。
- `iblock`：脉冲块噪声底偏置 -15.0~0.0，负值提升瞬态清晰度（码率提高）。

### 4.9 其它音频编码器

- `libtwolame`（MP2）：`b`、`q`（-50~50 实验性 VBR）、`mode`（auto/stereo/joint_stereo/dual_channel/mono）、`psymodel`（-1~4，默认 3）、`error_protection`、`copyright`。
- `libshine`（定点 MP3）：仅 CBR，支持 `b`。
- `liblc3`（蓝牙 LE
  Audio）：`b`、`ar`、`channels`、`frame_duration`（2.5/5/7.5/10ms，默认 10）、`high_resolution`（48/96kHz 高分辨模式）。
- `libopencore-amrnb`：仅支持 4750–12200 的固定码率集，`dtx` 选项；仅单声道、8000Hz。

## 5. 视频编码器

### 5.1 libx264 / libx264rgb（H.264 编码器）

libx264rgb 接收 packed
RGB 输入。多数 x264 选项映射到 FFmpeg 通用选项，以下为完整的常用映射（括号内为 x264 原名）：

**码率与码控**

- `b`（bitrate）：码率 bits/s（x264 为 kbps）。
- `crf`：恒定质量模式质量值（对应 x264 crf，常用 18–28，越小质量越高）。
- `crf_max`：CRF 模式下 VBV 允许的最低质量底线。
- `qp`：恒定量化参数模式。
- `qmin`（qpmin）默认 2、`qmax`（qpmax）默认 31、`qdiff`（qpstep）、`qblur`、`qcomp`。
- `rc-lookahead`：帧类型与码控前瞻帧数。
- `stats`：多遍编码统计文件名（也可用 `-passlogfile`）。
- `nal-hrd`：HRD 信息信令：`none`、`vbr`、`cbr`（CBR 不允许用于 MP4 容器），需设 vbv-bufsize。

**GOP 与帧结构**

- `g`（keyint）：最大 GOP 大小（x264 默认 250）。
- `keyint_min`（min-keyint）：最小 GOP 大小。
- `bf`（bframes）：I/P 帧间 B 帧数。
- `b_strategy`（b-adapt）：B 帧自适应放置算法，仅第一遍生效。
- `b-bias`：B 帧使用频率影响。
- `b-pyramid`：B 帧作参考：`none`、`strict`（严格层次，默认）、`normal`（非严格，不兼容蓝光）。
- `forced-idr`：强制 I 帧为 IDR 帧。
- `sc_threshold`（scenecut）：场景切换检测阈值。
- `intra-refresh`：用周期性帧内刷新替代 IDR 帧。
- `bluray-compat`：蓝光兼容（等效 `bluray-compat=1 force-cfr=1`）。
- `avcintra-class`：生成 AVC-Intra，取值 50/100/200。

**运动估计与质量**

- `refs`（ref）：P 帧参考帧数 0–16。
- `me_method`（me）：`dia`/`epzs`（最快）、`hex`、`umh`、`esa`、`tesa`（最慢）。
- `me_range`（merange）：运动搜索最大范围（像素）。
- `subq`（subme）：亚像素运动估计方法。
- `mixed-refs`：每分区一个参考（默认关）。
- `8x8dct`：自适应空间变换（High profile 8x8）。
- `fast-pskip`：P 帧早期 SKIP 检测。
- `mbtree`：宏块树码控。
- `deblock`（deblock）：环路滤波 alpha:beta 参数（如 `-deblock 0:0` 关闭）。
- `trellis`：Trellis 量化（默认开启）。
- `nr`：降噪。
- `cmp`：`chroma`（运动估计含色度）/ `sad`（忽略色度，等效 --no-chroma-me）。

**psy 与主观优化**

- `psy`：心理视觉优化（等效 x264 --no-psy 反向）。
- `psy-rd`：`psy-rd:psy-trellis` 格式强度。
- `aq-mode`：自适应量化：`none`(0)、`variance`(1)、`autovariance`(2)、`autovariance-biased`(3)。
- `aq-strength`：AQ 强度，减少平坦/纹理区块效应与模糊。
- `weightb`：B 帧加权预测。
- `weightp`：P 帧加权预测：`none`(0)、`simple`(1)、`smart`(2)。
- `ssim`：编码后计算并打印 SSIM。

**熵编码与兼容**

- `coder`：`ac`（CABAC）/ `vlc`（CAVLC）。
- `aud`：接入单元定界符。
- `level`：H.264 level（如 "4.1"）。
- `profile`：`baseline`、`main`、`high`、`high10`、`high422`、`high444` 等。
- `preset`：`ultrafast`、`superfast`、`veryfast`、`faster`、`fast`、`medium`（默认）、`slow`、`slower`、`veryslow`、`placebo`。
- `tune`：`film`、`animation`、`grain`、`stillimage`、`fastdecode`、`zerolatency`、`psnr`、`ssim`。
- `fastfirstpass`：第一遍快速设置，设 0 等效 --slow-firstpass。
- `partitions`：`p8x8`、`p4x4`、`b8x8`、`i8x8`、`i4x4`、`none`、`all`。
- `direct-pred`：`none`、`spatial`、`temporal`、`auto`。
- `slice-max-size`：每切片最大字节数。
- `x264opts` / `x264-params`：直接透传 x264 参数（`:` 分隔 key=value，值含 `:` 时改用 `,`）。
- `a53cc`：导入 ATSC 兼容隐藏字幕到输出，默认 1。
- `udu_sei`：导入未注册用户数据 SEI，默认 0。

```
ffmpeg -i in.mp4 -c:v libx264 -preset slow -crf 19 -profile:v high -pix_fmt yuv420p out.mp4
ffmpeg -i in.mp4 -c:v libx264 -x264opts keyint=123:min-keyint=20 -an out.mkv
ffmpeg -i in.mp4 -c:v libx264 -b:v 5M -pass 1 -an -f mp4 /dev/null
ffmpeg -i in.mp4 -c:v libx264 -b:v 5M -pass 2 out.mp4
```

### 5.2 libx265（H.265/HEVC 编码器）

- `b`：目标视频码率。
- `bf` / `g` / `keyint_min` / `refs`（1–16，默认由 preset 决定）。
- `preset`：`ultrafast` ~ `placebo`。
- `tune`：`psnr`、`ssim`、`grain`、`zerolatency`、`fastdecode` 等。
- `profile`：`main`、`main10`、`main12`、`main444` 等（对应输入位深）。
- `crf`：恒定质量（x265 常用 20–30）。
- `qp` / `qmin` / `qmax` / `qdiff` / `qblur` / `qcomp`
- `i_qfactor` / `b_qfactor`：I/B 帧 QP 因子。
- `forced-idr`：强制 IDR。
- `x265-stats`：两遍统计文件（`-passlogfile` 自动设置）。
- `x265-params`：透传 x265 参数（`:` 分隔 key=value）。

```
ffmpeg -i in.mp4 -c:v libx265 -preset slow -crf 24 -pix_fmt yuv420p10le out.mp4
ffmpeg -i input -c:v libx265 -x265-params crf=26:psy-rd=1 output.mp4
```

### 5.3 libvpx（VP8，编码器名 libvpx-vp9 供 VP9）

- 码控：`b`（bits/s）、`crf`（CQ 模式，0–63）、`qmin`/`qmax`、`bufsize`、`rc_init_occupancy`、`undershoot-pct`/`overshoot-pct`（码控下冲/过冲百分比）、`minrate`/`maxrate`（设
  `minrate==maxrate==b`
  即 CBR）、`qcomp`、`static-thresh`、`max-intra-rate`（I 帧码率上限百分比，0 不限）。
- 速度/质量：`quality`/`deadline`：`best`（极慢，可能不如 good）、`good`（推荐，配合 cpu-used）、`realtime`；`speed`/`cpu-used`（-8~8，越高越快质量越低）。
- 参考帧：`auto-alt-ref`（双遍 altref，VP9 支持多层）、`arnr-maxframes`、`arnr-type`（backward/forward/centered）、`arnr-strength`、`rc-lookahead`/`lag-in-frames`、`min-gf-interval`（VP9）、`error-resilient`、`sharpness`（0–7，提升锐度牺牲 PSNR）。
- VP9 专用：`lossless`（无损）、`tile-columns`/`tile-rows`（log2 值）、`frame-parallel`、`aq-mode`（0
  off/1 variance/2 complexity/3 cyclic refresh/4
  equator360）、`colorspace`（rgb/bt709/bt470bg/smpte170m/smpte240m/bt2020_ncl）、`row-mt`、`tune-content`（default/screen/film）、`corpus-complexity`（corpus
  VBR 复杂度中点 0–10000）、`enable-tpl`、`ref-frame-config`（每帧元数据精细控制参考）。
- VP8 专用：`screen-content-mode`（0 off/1 screen/2 激进码控）。
- 时间可分级：`ts-parameters`（ts_number_layers、ts_target_bitrate、ts_rate_decimator、ts_periodicity、ts_layer_id、ts_layering_mode）。

```
ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 out.webm
ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 2M -minrate 2M -maxrate 2M out.webm   # CBR
```

### 5.4 libaom-av1（libaom AV1 编码器）

- 码控：`b`（默认 VBR；maxrate==minrate==b 时 CBR；设 crf 为受约束质量）、`crf`（0–63）、`qmin`/`qmax`（0–63，注意与 AV1 实际量化值差 4 倍，除以 4 映射）、`minrate`/`maxrate`/`bufsize`/`rc_init_occupancy`、`undershoot-pct`/`overshoot-pct`、`minsection-pct`/`maxsection-pct`、`static-thresh`、`drop-threshold`。
- GOP：`g`（0 表示全 I 帧流）、`keyint_min`（与 g 相同则固定间隔关键帧）。
- 速度：`cpu-used`
  **0–8**（默认 1，慢而高质量）、`threads`、`lag-in-frames`（前瞻帧数）、`tiles`（列x行，4K 内默认 1x1）、`tile-columns`/`tile-rows`（log2，兼容 VP9）、`row-mt`（行多线程，默认关）、`frame-parallel`。
- 质量工具：`profile`（按输入位深/色度自动）、`tune`（`psnr` 默认 /
  `ssim`）、`aq-mode`（none/variance/complexity/cyclic）、`auto-alt-ref`、`arnr-max-frames`、`arnr-strength`（-1~6）、`error-resilience`、`denoise-noise-level`（胶片颗粒合成去噪量）、`denoise-block-size`（默认 32）。
- 滤波/预测开关（默认多开启）：`enable-cdef`、`enable-restoration`、`enable-global-motion`、`enable-intrabc`（屏显内容）、`enable-rect-partitions`、`enable-obmc`、`enable-dual-filter`、`enable-ref-frame-mvs`
  等大量 enable-\* 开关。
- `aom-params`：透传 libaom 参数。

```
ffmpeg -i in.mp4 -c:v libaom-av1 -crf 30 -cpu-used 4 -row-mt 1 out.mkv
ffmpeg -i input -c:v libaom-av1 -b:v 500K -aom-params tune=psnr:enable-tpl-model=1 out.mp4
```

### 5.5 libsvtav1（SVT-AV1 编码器，速度快，推荐日常 AV1）

- `preset`：质量-速度权衡 **0–13**（实际本机 -2~13），越高越快质量越低；常用 8–10 快速、4–6 高质量。
- `crf`：恒定质量因子 **0–63**（默认 0，常用 30–40）。
- `qp`：CQP 模式量化参数 0–63。
- `profile`：`main`、`high`、`professional`；`level`：操作点层级（如 4.0）；`tier`：`main`（默认）/`high`；`hielevel`：层次预测级别（3level/4level 默认）。
- `qmin`/`qmax`：码率模式下的量化范围。
- `sc_detection`：场景切换检测。
- `la_depth`：前瞻帧数 0–120。
- `tile_rows`（log2 0–6）/ `tile_columns`（log2 0–4）。
- `svtav1-params`：透传 SVT-AV1 参数。

```
ffmpeg -i in.mp4 -c:v libsvtav1 -preset 8 -crf 32 out.mkv
```

### 5.6 mpeg2video（MPEG-2 编码器）

- `profile`：`422`、`high`、`ss`、`snr`、`main`、`simple`。
- `level`：`high`、`high1440`、`main`、`low`。
- `seq_disp_ext`：是否写 sequence_display_extension：-1 auto（默认）、0 never、1 always。
- `video_format`：`unspecified`（默认）、`component`、`pal`、`ntsc`、`secam`、`mac`。
- `a53cc`：导入隐藏字幕，默认 1。

### 5.7 ffv1（FFV1 无损编码器）

- `context`：上下文大小，0（默认）小、1 大。
- `coder`：`rice`（Golomb Rice）、`range_def`（默认表范围编码器）、`range_tab`（自定义表）。
- `slicecrc`：-1 默认自动、1 零初终态 CRC、2 非零初终态 CRC。
- `qtable`：`default`、`8bit`、`greater8bit`。
- `remap_optimizer`：重映射表优化程度 0–5，默认 3。

### 5.8 GIF（GIF 动画编码器）

- `gifflags`：`offsetting`（画面偏移，默认开）、`transdiff`（帧间透明检测，默认开）。
- `gifimage`：每帧输出完整 GIF 图而非动画，默认 0。
- `global_palette`：全局调色板写头部，默认 1。

### 5.9 png（PNG 编码器）

- `compression_level`：压缩级别 0–9，默认 9。
- 私有：`dpi`/`dpm`（物理像素密度）、`pred`（预测方法：none/sub/up/avg/paeth/mixed，默认 paeth）。

### 5.10 prores / prores_ks / prores_aw（Apple ProRes）

FFmpeg 内置两个 ProRes 编码器：prores_aw 与 prores_ks（prores 为别名）。prores_ks 私有选项：

- `profile`：`proxy`、`lt`、`standard`、`hq`、`4444`、`4444xq`。
- `quant_mat`：量化矩阵：`auto`（按 profile 匹配，默认）、`default`（最高质量）。
- `bits_per_mb`：每宏块分配比特数（200–2400，最大 8000）；调高可提速。
- `mbs_per_slice`：每切片宏块数 1–8，默认 8。
- `vendor`：4 字节厂商 ID（如 apl0 冒充 Apple 编码）。
- `alpha_bits`：alpha 位数 0/8/16，0 禁用 alpha 平面。
- 提速建议：用 `-qscale 4` 且不设尺寸约束最快。

```
ffmpeg -i in.mov -c:v prores_ks -profile:v hq -vendor apl0 out.mov
```

### 5.11 硬件加速基础：`-hwaccel` / `-init_hw_device` / 硬件滤镜链（全平台）

硬件加速不是单个参数，而是一条**解码 → 帧传递 → 滤镜 → 编码**的完整链路，下面按执行顺序逐个说明。官方表述见
`ffmpeg -h full` 与 ffmpeg-cmd 文档的 "Main options" / "Advanced options" 章节。

**总览：硬件转码链路（以 NVENC 为例）**

```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
       -vf scale_cuda=1280:720 \       # 硬解后帧留在 GPU，用硬件滤镜缩放
       -c:v h264_nvenc -b:v 2M out.mp4
```

#### 5.11.1 `-hwaccel`（硬件解码，输入侧）

- 语法：`-hwaccel[:stream_specifier] hwaccel`（输入、按流指定）。本机 `ffmpeg -hwaccels`
  实测支持：`cuda、vaapi、dxva2、qsv、d3d11va、opencl、vulkan、d3d12va、amf`。
- 取值官方定义：`none`（默认，不用硬件）、`auto`（自动选择）、`vdpau`（Unix/VDPAU）、`dxva2`、`d3d11va`、`vaapi`、`qsv`、`videotoolbox`（macOS）、`cuda`、`d3d12va`、`amf`（AMD）。已定义但本机未启用也在 -h 中列出，以
  `-hwaccels` 实际输出为准。
- 官方特别提示：**多数加速方法面向播放场景，在转码时通常不比现代 CPU 软解更快**；而且 ffmpeg 通常需要把解码帧从显存复制回内存，进一步损失性能。**例外是
  `qsv`**：它直接做"硬件转码"而不把帧复制回系统内存，但要求解码器与编码器都支持 QSV 且**不能使用任何滤镜**。
- 若所选 hwaccel 不可用或解码器不支持，该选项无效果（不会报错）。

#### 5.11.2 `-hwaccel_device`（选设备）

- 语法：`-hwaccel_device[:stream_specifier] device`。仅配合 `-hwaccel` 使用；可以引用
  `-init_hw_device` 创建的设备名，也可以直接写设备号（形如 `-init_hw_device type:device`
  被立即调用）。

#### 5.11.3 `-hwaccel_output_format`（控制解码帧去向，关键）

- 语法：`-hwaccel_output_format[:stream_specifier] format`（输入）。
- 取值：`auto`（默认）、`cuda`、`d3d11`、`d3d11va`、`qsv`、`vaapi`、`vulkan`、`opencl`、`dxva2`
  等硬件帧格式；`auto` 时默认输出到**系统内存**（软帧）。
- **这是最容易踩坑的参数**：
    - 默认 `auto` 时，硬解后的帧被拷回 CPU 内存，后面的缩放滤镜用普通的 `scale`
      即可，编码器也无需在意帧格式。
    - 只有设成 `cuda`/`qsv`/`d3d11`
      等，帧才留在 GPU 上，此时**必须搭配对应硬件滤镜**（`scale_cuda`/`scale_qsv`/`scale_d3d11`/`hwupload`
      等）和硬件编码器，否则会报 "frames on a non software pixel format" 之类的错误。
    - 本机实测：`-hwaccel cuda -hwaccel_output_format cuda -vf scale_cuda=... -c:v h264_nvenc`
      全链路成功；而 `-hwaccel cuda` 不写 output_format 时，`-c:v h264_nvenc`
      也能工作（帧在内存，编码器自动上传），但少了 GPU 内零拷贝优势。

#### 5.11.4 `-init_hw_device`（预创建设备）

- 语法：`-init_hw_device type[=name][:device[,key=value...]]`；`-init_hw_device type[=name]@source`（从已有设备派生）；`-init_hw_device list`（列出本构建支持的设备类型）。本机实测
  `list` 输出：`cuda、vaapi、dxva2、qsv、d3d11va、opencl、vulkan、d3d12va、amf`。
- 不给名字时自动命名 `type%d`。常见写法（官方示例）：
    - cuda：`-init_hw_device cuda:1`（选第 2 块卡）；`-init_hw_device cuda:0,primary_ctx=1`（用主上下文）
    - d3d11va：`-init_hw_device d3d11va`（默认适配器）；`-init_hw_device d3d11va:1`；`-init_hw_device d3d11va:,vendor_id=0x8086`（按厂商 ID 选卡）
    - vaapi（Linux）：`-init_hw_device vaapi:/dev/dri/renderD128`（指定 DRM 设备）
    - vulkan：`-init_hw_device vulkan:1`、`-init_hw_device vulkan:RADV`（按名称子串匹配）
    - opencl：`-init_hw_device opencl:0.1`（第 1 平台第 2 设备）
- 有了命名设备后可以用 `-hwaccel_device` 引用，或 `-filter_hw_device name`
  把设备交给所有滤镜（`hwupload`/`hwmap` 需要）。

#### 5.11.5 硬件滤镜与帧格式转换

- `hwupload`：把软件帧上传到硬件表面；`hwmap`：映射/复用硬件帧；`hwdownload`：把硬件帧取回软件内存（配合
  `format=yuv420p` 等指定输出格式）。
- 各后端自带缩放滤镜：`scale_cuda`（NVIDIA）、`scale_qsv`（Intel）、`scale_vaapi`（Linux）、`scale_d3d11`/`scale_d3d11va`（Windows）、`scale_vulkan`。硬件滤镜的参数集与
  `scale` 基本一致（w/h/flags/interl 等），见《ffmpeg-滤镜指南》"scale 滤镜"小节。
- 硬解 + 硬编但**不做滤镜**时，直接 `-hwaccel cuda -i in.mp4 -c:v hevc_nvenc out.mp4`
  即可，帧留在显存内全程零拷贝（本机实测通过）。

#### 5.11.6 四条典型硬件链路（本机实测通过）

```bash
# A. NVIDIA 全链路（硬解 → 显存缩放 → 硬编）：cuda 后端
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
       -vf scale_cuda=1280:720 -c:v h264_nvenc -preset p5 -b:v 2M out.mp4

# B. Intel QSV 全链路（异机种实测通过）：qsv 后端 + scale_qsv
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
       -vf scale_qsv=1280:720 -c:v h264_qsv -preset medium -b:v 2M out.mp4

# C. NVIDIA 无滤镜全链路（零拷贝最短写法）
ffmpeg -hwaccel cuda -i in.mp4 -c:v hevc_nvenc -b:v 6M out.mp4

# D. Linux VAAPI 屏幕录制式链路（软帧上传后硬编，无需 -hwaccel）
ffmpeg -init_hw_device vaapi=hw:/dev/dri/renderD128 -i in.mp4 \
       -vf 'format=nv12,hwupload' -c:v h264_vaapi -b:v 4M out.mp4
```

> 注意：B 链路中 `-hwaccel qsv`
> 官方定义为"硬件转码、不复制回内存"，此时**不能加普通软件滤镜**，只能用 `scale_qsv`
> 等硬件滤镜，或者完全不用滤镜。若必须用 `scale`/`crop` 等软件滤镜，就别写
> `-hwaccel_output_format qsv`，让帧回内存。

### 5.12 QSV 编码器（Intel QuickSync：h264_qsv / hevc_qsv / av1_qsv / mpeg2_qsv 等）

**码控模式选择**（按优先级）：

1. 指定 `global_quality` → 质量模式：`-qscale`（CQP 常量量化），加 `look_ahead`
   为 LA_ICQ，否则 ICQ（global_quality 1–51，1 最佳）。
2. 指定 `b`（平均码率）→ 码率模式：加 `look_ahead` 为 LA-VBR；设 `vcm` 为会议模式；`maxrate==b`
   为 CBR；`maxrate>b` 为 VBR；maxrate 未设而 avbr_accuracy/avbr_convergence 非零为 AVBR。
3. 未指定则默认 CQP。

- 系统可能选择与预期不同的模式，用 `-v verbose` 查看实际设置。

**全局选项映射 MSDK**：`g`→GopPicSize、`bf+1`→GopRefDist、`rc_init_occupancy`→InitialDelayInKB、`slices`→NumSlice、`refs`→NumRefFrame、`b_strategy`→BRefType、`cgop`→GopOptFlag；`coder vlc`
使 H.264 用 CAVLC 而非 CABAC。

**公共选项**：

- `async_depth`：提交后同步前的异步操作数（0 表示不指定）。
- `preset`：`veryfast` ~ `veryslow`（从快到慢）。
- `forced_idr`：强制 I 帧为 IDR。
- `low_power`：降低功耗与 GPU 占用。

**运行时可改选项**：`global_quality`、`i/b_quant_factor`/`offset`、`max_frame_size`、`gop_size`、`int_ref_type`、`int_ref_cycle_size`、`int_ref_qp_delta`、`int_ref_cycle_dist`、`qmax`/`qmin`/`max_qp_i`/`min_qp_i`/`max_qp_p`/`min_qp_p`/`max_qp_b`/`min_qp_b`、`low_delay_brc`、`framerate`、`bit_rate`、`rc_buffer_size`、`rc_initial_buffer_occupancy`、`rc_max_rate`、`pic_timing_sei`。

**h264_qsv 专用**：`extbrc`（扩展码控）、`recovery_point_sei`、`rdo`（率失真优化）、`max_frame_size`/`max_frame_size_i`/`max_frame_size_p`/`max_slice_size`、`bitrate_limit`、`mbbrc`（宏块级码控）、`low_delay_brc`（-1 默认/0 关/1 开）、`adaptive_i`/`adaptive_b`（允许帧类型转换）、`p_strategy`（P 金字塔：0 默认/1
simple/2
pyramid）、`b_strategy`（B 帧参考）、`dblk_idc`（0–2 去块控制）、`cavlc`（用 CAVLC）、`vcm`（会议模式）、`idr_interval`、`pic_timing_sei`、`single_sei_nal_unit`、`max_dec_frame_buffering`、`look_ahead`/`look_ahead_depth`/`look_ahead_downsampling`（unknown/auto/off/2x/4x）等。

- `qsv_params`：以 `key=value:key=value` 形式直接透传 MSDK 编码器参数（MFXSetParameter）。

```
ffmpeg -hwaccel qsv -i in.mp4 -c:v h264_qsv -preset veryslow -global_quality 22 out.mp4
ffmpeg -i input.mp4 -c:v h264_qsv -qsv_params "CodingOption1=1:CodingOption2=2" output.mp4
```

**h264_qsv 其它常用参数**（本机 `-h encoder=h264_qsv` 实测）：

- `async_depth`：最大处理并行度（默认 4，越大延迟越高、吞吐越大）。
- `forced_idr`：强制 I 帧为 IDR（SDR 无时基场景常用）。
- `low_power`：启用低功耗模式（实验性，BRC 模式等受限，慎用）。
- `scenario`：给编码器场景提示：`unknown`（默认）、`display_remoting`、`video_conference`、`archive`、`live_streaming`、`camera_record`、`game_streaming`、`remote_gaming`、`transcoding`——直播场景用
  `live_streaming` 会优化延迟与 B 帧结构。
- `max_frame_size` / `max_frame_size_i` / `max_frame_size_p` /
  `max_slice_size`：帧/片最大字节数（限制延迟场景）。
- `mbbrc`（宏块级码控）、`extbrc`（扩展码控）、`low_delay_brc`（低延迟码控，-1 自动/0 关/1 开）。
- `adaptive_i` / `adaptive_b`：允许 I/B 帧类型自适应转换。
- `p_strategy`：P 帧金字塔（0 默认 / 1 simple / 2 pyramid）；`b_strategy`：B 帧参考策略。
- `dblk_idc`：去块滤波强度（0 关闭 / 1 弱 / 2 强）。
- `max_qp_i` / `min_qp_i` / `max_qp_p` / `min_qp_p` / `max_qp_b` / `min_qp_b`：各帧型 QP 上下限。
- `avbr_accuracy` / `avbr_convergence`：AVBR 模式的精度与收敛速度。
- `cavlc`：H.264 用 CAVLC 而非 CABAC（兼容性优先）。
- `rdo`：率失真优化（质量优先）。
- `qsv_params`：直接透传 MSDK 私有参数。

**本机实测 QSV 转码链路（Intel UHD Graphics 750）**：

```bash
# 4K H.264 → 1080p H.265，QSV 硬解开 + 显存缩放 + QSV 硬编（实测输出 1920x1080 HEVC Main）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i input_4k.mp4 -map 0:v \
       -vf scale_qsv=1920:1080 -c:v hevc_qsv -preset medium -b:v 6M \
       -maxrate 8M -bufsize 12M -g 96 -bf 3 output_1080p.mp4

# 直播间转码：低延迟场景提示 + 限制帧大小
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
       -c:v h264_qsv -scenario live_streaming -low_delay_brc 1 -b:v 2M -bufsize 4M out.mp4
```

> 注意：`-hwaccel qsv` 是"硬件转码不走内存"模式，此模式**禁止使用任何软件滤镜**；需要 `scale`/`crop`
> 时用 `scale_qsv` 等硬件滤镜，或省略 `-hwaccel_output_format qsv` 让帧回内存。

### 5.13 VAAPI 编码器（Linux/Intel GPU 等硬件编码器）

> VAAPI 是 Linux 平台的硬件视频加速接口（Intel/AMD 均支持）。驱动通常由 Mesa 提供；转码前用 `vainfo`
> 查看设备支持的编解码器。以下参数全部来自官方 ffmpeg-codecs 文档；示例按官方链路书写，本机（Windows）无 VAAPI 设备，未能实测。

只接收 VAAPI 硬件表面输入，软件帧需先 `hwupload`。

- 使用的标准选项：`g/gop_size`、`bf/max_b_frames`、`profile`、`level`、`b/bit_rate`、`maxrate`、`bufsize`、`rc_init_occupancy`、`compression_level`（速度）、`q/global_quality`、`qmin`/`qmax`、`i/b_qfactor`/`i/b_qoffset`、`slices`。
- 公共选项：
    - `low_power`：尝试低功耗编码器（功能集可能缩减）。
    - `idr_interval`：开放 GOP 中两个全刷新 IDR 帧之间的普通帧内帧数。
    - `b_depth`：B 帧参考深度（默认 1，全 B 帧只参考 P/I；更大值允许多层 B 帧）。
    - `async_depth`：最大处理并行度。
    - `max_frame_size`：每帧最大字节数（CQP 模式无效）。
    - `rc_mode`：`auto`（默认）、`CQP`、`CBR`、`VBR`、`ICQ`、`QVBR`、`AVBR`。
    - `blbrc`：块级码控（CQP 无效）。
- 各编码器专用：`av1_vaapi`（profile/tier/level、tiles、tile_groups）；`h264_vaapi`（`coder`
  ac/cabac 或 vlc/cavlc、`aud`、`sei`
  identifier/timing/recovery_point）；`hevc_vaapi`（`aud`、`tier`、`sei`
  hdr、`tiles`）；`mjpeg_vaapi`（jfif、huffman 表）；`mpeg2_vaapi`；`vp8_vaapi`（不支持 B 帧，global_quality
  0–127）；`vp9_vaapi`（global_quality
  0–255、loop_filter_level/sharpness、B 帧需 vp9_raw_reorder/超帧滤波）。

**常用链路示例（Linux）**：

```bash
# 1) 硬解 + 硬编（无滤镜），QSV→VAAPI 等价链路的 VAAPI 版
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
       -c:v h264_vaapi -b:v 4M out.mp4

# 2) 软帧（含滤镜处理）后再上传硬编：最常用的写法
ffmpeg -i in.mp4 -vf "scale=1280:720,format=nv12,hwupload" \
       -c:v hevc_vaapi -global_quality 25 -c:a copy out.mp4

# 3) 全硬件链路：解码帧留在显存，用 scale_vaapi 缩放
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
       -vf "scale_vaapi=1920:1080" -c:v h264_vaapi -rc_mode VBR -b:v 5M out.mp4

# 4) 屏幕录制/抓屏（x11grab 输入）+ VAAPI 硬编
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :0.0 \
       -vf "format=nv12,hwupload" -c:v h264_vaapi -rc_mode CBR -b:v 6M out.mp4
```

### 5.14 MediaFoundation 编码器（Windows：h264_mf / hevc_mf / av1_mf）

- 支持软/硬编码；硬件编码要求 D3D11（可用 `scale_d3d11` 滤镜硬件缩放）。
- `rate_control`：`default`、`cbr`、`pc_vbr`（峰值受限 VBR）、`u_vbr`、`quality`、`ld_vbr`、`g_vbr`、`gld_vbr`（后三个需 Win8+）。
- `scenario`：`default`、`display_remoting`、`video_conference`、`archive`、`live_streaming`、`camera_record`、`display_remoting_with_feature_map`。
- `quality`：编码质量 0–100，-1 默认。
- `hw_encoding`：强制硬件编码（0–1，默认 0）。

```
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i input.mp4 \
  -vf scale_d3d11=1920:1080 -c:v hevc_mf -hw_encoding 1 -quality 80 output.mp4
```

### 5.15 NVENC 编码器（NVIDIA GPU：h264_nvenc / hevc_nvenc / av1_nvenc）

> 官方 ffmpeg-codecs 文档不列 NVENC 私有参数，以下全部来自本机 `ffmpeg -h encoder=h264_nvenc`
> 实测输出（FFmpeg 9 / N-126689，RTX 4070）。h264_nvenc / hevc_nvenc /
> av1_nvenc 参数体系一致（hevc 少 baseline 类 profile，av1 无 B 帧/`-bf` 无效）。使用前先
> `ffmpeg -encoders | grep nvenc` 与 `-h encoder=...` 确认。

**可用编码格式**：支持 `yuv420p nv12 p010le yuv444p bgr0 bgra rgb0 rgba` 等像素格式及 `cuda d3d11`
硬件帧输入；10-bit 内容用 `p010le`（HEVC Main10 / H.264 high10）。

#### 5.15.1 基础参数

- `-preset <int>`：`slow(0)`<=>p4 默认、`medium(1)`、`fast(2)`、`p1(3)~p7(9)`（p1 最快最省电、p7 最慢质量最好）。**推荐日常 p4~p5**。
- `-tune <int>`：`hq(1)` 高质量（默认）、`ll(2)` 低延迟、`ull(3)` 超低延迟、`lossless(4)` 无损。
- `-profile`：h264 为 `baseline/main/high/high10/high422/high444p`（默认 high）；hevc 为
  `main/main10/rext`；av1 为 `main`。
- `-level`：`auto`（默认）或 1~6.2 各档（按分辨率/帧率约束，见 H.264 level 表）。
- `-gpu <int>`：多卡选卡（0 第一块、1 第二块、`list` 列出、`any` 默认任意）。
- `-surfaces`：并发表面数（0 自动，按帧尺寸建议 4~8 的倍数）。
- `-delay`：延迟输出帧数（默认 INT_MAX 即全缓冲，实时场景设小值）。

#### 5.15.2 码率控制（-rc，最关键）

- `-rc constqp`：恒定 QP，配 `-qp <0~51>`（默认 -1 自动）。画质恒定但文件大小不可控。
- `-rc vbr`：可变码率，配 `-b:v`（目标码率）+`-maxrate`+`-bufsize`；或 **`-cq <0~51>`
  恒定质量**（0 自动，18~28 常用）。
- `-rc cbr`：恒定码率，配 `-b:v`+`-maxrate`（通常相同）+`-bufsize`；直播/会议用。
- `-qmin` / `-qmax`：码控 QP 上下限。
- `-multipass`：`disabled(0)`（默认单遍）/ `qres(1)`（四分之一分辨率两遍）/
  `fullres(2)`（全分辨率两遍）；质量优先选 fullres。
- `-rc-lookahead <n>`：码控前瞻帧数（默认 0，建议 10~20；开空间/时域 AQ 前应开启 lookahead）。
- `-spatial-aq` / `-temporal-aq`：空间/时域自适应量化（改善细节与运动区域，通常建议开）；配
  `-aq-strength <1~15>`（默认 8）。
- `-strict_gop`：严格 GOP（最小化 GOP 间码率波动）。
- `-cbr_padding`：CBR 模式填充到不低于目标码率（应用层需要恒定码率时用）。

#### 5.15.3 GOP 与帧结构

- `-g <n>`：GOP 大小（关键帧间隔）。直播约 `2×fps`，VOD 常用 `fps×2~10`。
- `-bf <n>`：B 帧数量（1~3，max 3）。B 帧越多压缩率越高、延迟越高。
- `-refs <n>`：参考帧数。
- `-b_ref_mode`：B 帧作参考：`disabled(0)`/`each(1)`/`middle(2)`。
- `-no-scenecut 1`：关闭场景切换自适应 I 帧（配合 lookahead 使用才有意义）。
- `-forced-idr`：强制关键帧为 IDR。
- `-intra-refresh`：周期内刷新（替代 IDR，低延迟流媒体用）。
- `-weighted_pred`：加权预测（运动剧烈场景可提质量）。

#### 5.15.4 低延迟相关

- `-zerolatency`：零延迟（无重排延迟）。
- `-tune ll` / `-tune ull` + `-rc cbr` + `-delay 0` + `-b:v` 是经典直播配置。
- `-nonref_p`：自动插入非参考 P 帧（削延迟）。
- `-max_slice_size`：单 slice 最大字节数。

#### 5.15.5 NVENC 实测示例（本机全部通过）

```bash
# 1) 4K H.264 → 1080p HEVC（硬解 → scale_cuda → hevc_nvenc）实测输出 1920x1080 HEVC Main 约 4M
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input_4k.mp4 \
       -vf scale_cuda=1920:1080 -c:v hevc_nvenc -preset p5 -rc vbr \
       -cq 24 -b:v 6M -maxrate 8M -bufsize 12M -g 96 -bf 3 -c:a copy out.mp4

# 2) H.264 高画质 VOD 压制：双遍 + 双 AQ
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
       -vf scale_cuda=1920:1080 -c:v h264_nvenc -preset p7 -rc vbr -cq 21 \
       -rc-lookahead 20 -spatial-aq 1 -temporal-aq 1 -multipass fullres \
       -c:a copy out.mp4

# 3) 直播推流：CBR + 低延迟
ffmpeg -hwaccel cuda -i in.mp4 -vf scale_cuda=1280:720 -c:v h264_nvenc \
       -tune ull -rc cbr -b:v 2500k -maxrate 2500k -bufsize 5000k \
       -g 60 -bf 0 -zerolatency 1 -c:a aac -b:a 128k -f flv rtmp://server/live/stream

# 4) AV1 硬件编码（RTX 40 系起）：-bf 无效、无 B 帧
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
       -vf scale_cuda=1280:720 -c:v av1_nvenc -preset p5 -rc vbr -cq 30 \
       -b:v 2M -maxrate 2.5M out.mp4

# 5) 无损/近无损（tune lossless，超大文件）
ffmpeg -hwaccel cuda -i in.mp4 -c:v h264_nvenc -tune lossless out.mkv
```

### 5.16 AMF 编码器（AMD GPU：h264_amf / hevc_amf / av1_amf）

> AMF（Advanced Media
> Framework）为 AMD 的硬件加速框架，Windows 上通过 D3D11 或 OpenCL 访问。以下参数来自本机
> `-h encoder=h264_amf` 实测输出；本机无 AMD
> GPU，示例未经实测。使用前确认显卡支持：`ffmpeg -encoders | grep amf`，不支持时改用
> `h264_mf`（Windows Media Foundation 后端）。

- `-usage`：编码用途：`transcoding`（转码，默认）、`ultralowlatency`、`lowlatency`、`webcam`、`highquality`
  等（-1 自动）。
- `-profile` / `-level`：与 H.264 一致（baseline/main/high 等）。
- `-quality` / `-preset`（同义）：编码质量预设：`speed`、`balanced`、`quality`（0~3）。
- `-rc`：码控：`cqp`、`cbr`、`vbr`、`vbr_peak`、`qvbr`（质量受限 VBR）、`hqvbr`、`icq`、`hq_cbr`
  等（-1 自动）。
- `-qvbr_quality_level <0~51>`：QVBR 质量等级。
- `-enforce_hrd`：强制 HRD（CBR 合规）。
- `-vbaq`：VBAQ 自适应量化。
- `-qp_i` / `-qp_p` / `-qp_b`：各帧型恒定 QP（CQP 模式）。
- `-preencode`：预编码辅助码控。
- `-async_depth`：最大并行度（默认 16；调小降延迟）。
- `-bf` / `-max_b_frames`：B 帧数（0~3）。
- `-bf_ref`：B 帧作参考帧；`-bf_delta_qp` / `-bf_ref_delta_qp`：B 帧 Delta QP。
- `-header_spacing`：SPS/PPS 插入间隔。
- `-intra_refresh_mb`：周期内刷新宏块数。
- `-forced_idr`：强制 IDR。
- `-preanalysis`：预分析（含场景检测等）；配套
  `-pa_activity_type`、`-pa_scene_change_detection_enable`、`-pa_static_scene_detection_enable` 等。
- `-smart_access_video`：APU 与独显协同访问（仅 APU 双 GPU 平台有效）。

**AMF 常用示例（AMD 显卡 + Windows，链路未经实测）**：

```bash
# 转码：CBR 直播
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
       -vf scale_d3d11=1280:720 -c:v h264_amf -usage lowlatency -rc cbr \
       -b:v 2M -maxrate 2M -bufsize 4M -bf 0 -g 60 out.flv

# 高质量 VOD：QVBR
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
       -vf scale_d3d11=1920:1080 -c:v hevc_amf -usage transcoding \
       -rc qvbr -qvbr_quality_level 28 -preset quality [-c:a copy] out.mp4
```

### 5.17 硬件 vs 软件编码对比（选型参考）

本机（RTX 4070 + Intel UHD 750）实测对比（同一 4K 24fps 源 → 1080p）：

| 编码器                                          | 质量取向                   | 速度                    | 用途建议             |
| ----------------------------------------------- | -------------------------- | ----------------------- | -------------------- |
| libx264 `-preset slow -crf 19`                  | 最佳画质                   | 慢（CPU 软编）          | 存档、高质量 VOD     |
| libx265 `-preset slow -crf 24`                  | 最佳压缩比                 | 最慢                    | 高压缩存档           |
| h264_nvenc `p5 + vbr + cq 21` + 双 AQ + fullres | 接近 x264 medium           | 极快（数倍~数十倍实时） | 批量转码、直播、预览 |
| hevc_nvenc `p5 + cq 24`                         | 接近 x265 中档 60~70% 效率 | 快                      | 体积敏感但需要速度   |
| av1_nvenc `p5 + cq 30`                          | 高于 hevc_nvenc 压缩率     | 快（RTX 40 起）         | 新格式分发           |
| h264_qsv `medium`                               | 与 nvenc 相近              | 快（Intel 核显）        | Intel 平台批量转码   |

要点：

- 硬件编码速度优势巨大（软编 1~2 fps 的 4K 源，nvenc 可做到 30+
  fps 实时），但同码率下画质略低于 x264/x265。
- 若追求"体积/画质最优"，用 CRF 软编；若追求"速度/吞吐"，用硬件编码。
- 硬件编码**不要盲目加太高码率**：`-b:v` 与 `-cq` 共同决定质量，VBR 模式下 `-cq` 优先于 `-b:v`
  的实际质量效果。

## 6. 常用综合示例

```bash
# H.264 CRF 高质量压制（8-bit）
ffmpeg -i input.mkv -c:v libx264 -preset slow -crf 19 -c:a copy -pix_fmt yuv420p output.mp4

# H.265 10-bit 压制
ffmpeg -i input.mkv -c:v libx265 -preset slow -crf 24 -pix_fmt yuv420p10le -c:a copy output.mp4

# 两遍 H.264 定码率
ffmpeg -y -i input.mkv -c:v libx264 -b:v 5M -pass 1 -an -f mp4 /dev/null
ffmpeg -y -i input.mkv -c:v libx264 -b:v 5M -pass 2 -c:a copy output.mp4

# VP9 无损/高质量 WebM
ffmpeg -i input.mkv -c:v libvpx-vp9 -b:v 0 -crf 32 -row-mt 1 -c:a libopus output.webm

# AV1（SVT-AV1）
ffmpeg -i input.mkv -c:v libsvtav1 -preset 8 -crf 32 -c:a copy output.mkv

# AAC 音频 192k
ffmpeg -i input.mkv -map 0:a -c:a aac -b:a 192k output.m4a

# 看图工具：列出某编码器全部选项
ffmpeg -h encoder=libx264
ffmpeg -h encoder=hevc_nvenc
ffmpeg -h decoder=hevc
```

## 7. 备注

- 本文所有 `-h encoder=xxx` / `-h decoder=xxx` 输出以本机 FFmpeg
  9 开发版（N-126689）为基准；不同版本/编译配置下可用编码器与选项可能有差异（如是否启用 libfdk_aac、QSV、NVENC）。
- 通用 Codec 选项与私有选项可在 `-c:v`/`-c:a` 之后直接使用，如
  `-c:v libx264 -crf 19`；带流修饰符写法 `-c:v:0`、`-b:a` 等见《ffmpeg 其它常用参数指南》。
