# FFmpeg 硬件加速与格式兼容性指南

> 适用版本：FFmpeg 9.0.1（gyan 完整构建，N-126689-gb894a6f7c）实测环境：Windows 10，NVIDIA GeForce
> RTX 4070（Ada Lovelace）+ Intel UHD 750（Rocket Lake
> 11 代核显）素材：`F:/Temp/testvideos/videos/13295733_3840_2160_24fps.mp4`（3840×2160、24
> fps、H.264）输出目录：`temp/ffmpeg_test`；官方依据：`temp/ffmpeg-docs`（ffmpeg-cmd / ffmpeg-codecs
> / ffmpeg-filters / ffmpeg-formats / HWAccelIntro Wiki / NVIDIA 官方支持矩阵）

本文是 FFmpeg 中文文档系列的硬件加速专篇，与《ffmpeg-编解码器参数指南》《ffmpeg-滤镜指南》《ffmpeg-其它常用命令行参数指南》配套。第 5 章硬件编解码器私有参数详解与《ffmpeg-编解码器参数指南》第 5.11–5.17 节互补：本篇侧重**平台总览、格式/容器/profile/level/码率/尺寸的兼容性**与**全硬件工作流**。

文中标注「实测」的示例命令均在上述机器上运行通过；标注「未实测」的内容（VAAPI、AMF、VideoToolbox 等本机无对应设备）以官方文档与厂商资料为依据，使用前请按所在平台自行验证。

## 目录

1. [硬件加速总览](#1-硬件加速总览)
2. [平台与 API 可用性矩阵](#2-平台与-api-可用性矩阵)
3. [硬件加速解码](#3-硬件加速解码)
4. [硬件加速编码](#4-硬件加速编码)
5. [硬件滤镜](#5-硬件滤镜)
6. [文件格式与编码格式兼容性](#6-文件格式与编码格式兼容性)
7. [全硬件加速工作流](#7-全硬件加速工作流)
8. [常见问题与避坑](#8-常见问题与避坑)
9. [附录](#9-附录)

## 1 硬件加速总览

### 1.1 三类硬件能力

FFmpeg 的硬件加速不是单个开关，而是三类相互独立、可以任意组合的能力：

| 能力     | 对应机制                                      | 作用                                                                      |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| 硬件解码 | `-hwaccel` 通用选项 + 各厂商解码器            | 用 GPU 的解码单元把压缩码流解成 YUV 帧，替代 CPU 软解                     |
| 硬件滤镜 | `scale_cuda`、`scale_qsv`、`vpp_qsv` 等滤镜   | 用 GPU 上的视频处理单元（VPP/GPU 核）做缩放、去隔行、叠加等，帧不离开显存 |
| 硬件编码 | `h264_nvenc`、`hevc_qsv`、`h264_amf` 等编码器 | 用 GPU 的编码单元编码，替代 x264/x265 等软件编码器                        |

官方对三类能力的定位（HWAccelIntro）：

- **硬件解码**：输出与软解等效，但更省电、省 CPU；对实现复杂的 profile（如超出 4:2:0
  8-bit 的）硬件解码器往往不实现全部。
- **硬件编码**：速度与 CPU 占用优势明显，但**同等质量下码率通常高于 x264/x265 这类优秀软件编码器**（实测数据见 7.6 节）。
- **硬件滤镜**：多数平台提供缩放、去隔行、画质增强等 VPP 能力；当帧以硬件表面形式存在时，滤镜直接作用于显存上的帧，避免来回拷贝。

### 1.2 三条通用链路模型

用 `-hwaccel` + `-hwaccel_output_format` 控制解码帧的去向，组合出三种转码形态：

| 形态             | 解码帧去向                          | 滤镜                 | 编码器输入          | 典型场景                      |
| ---------------- | ----------------------------------- | -------------------- | ------------------- | ----------------------------- |
| 纯 GPU 全硬件    | 留在显存（`cuda`/`qsv`/`d3d11` 等） | 必须用同平台硬件滤镜 | 同平台硬件编码器    | 高性能批量转码                |
| 硬解回拷         | 拷回系统内存（默认 `auto`）         | 任意软件滤镜         | 任意编码器（软/硬） | 需要复杂软滤镜、字幕烧录      |
| 混合（软滤硬编） | 系统内存                            | 软件滤镜             | 硬件编码器          | 常见于 AMF/一致性要求不高场景 |

### 1.3 本机硬件能力速查（实测）

```bash
# 查看构建里启用的硬件加速方式
ffmpeg -hwaccels
# 本机输出：cuda  vaapi  dxva2  qsv  d3d11va  opencl  vulkan  d3d12va  amf
```

本机实际可用的硬件编解码器与滤镜清单（`ffmpeg -encoders` / `-decoders` / `-filters` 过滤）：

**硬件编码器**：`h264_nvenc` `hevc_nvenc` `av1_nvenc`（NVIDIA）；`h264_qsv` `hevc_qsv` `av1_qsv`
`mjpeg_qsv` `mpeg2_qsv` `vp9_qsv`（Intel）；`h264_amf` `hevc_amf` `av1_amf`（AMD）；`h264_vaapi`
`hevc_vaapi` `av1_vaapi` `mjpeg_vaapi` `mpeg2_vaapi` `vp8_vaapi` `vp9_vaapi`（VAAPI）。

**硬件解码器**（NVIDIA CUVID 族）：`h264_cuvid` `hevc_cuvid` `av1_cuvid` `mpeg1_cuvid` `mpeg2_cuvid`
`mpeg4_cuvid` `vc1_cuvid` `vp8_cuvid` `vp9_cuvid` `mjpeg_cuvid`；Intel QSV 族：`h264_qsv` `hevc_qsv`
`av1_qsv` `mjpeg_qsv` `mpeg2_qsv` `vc1_qsv` `vp8_qsv` `vp9_qsv` `vvc_qsv`；AMD AMF 族：`h264_amf`
`hevc_amf` `av1_amf` `vp9_amf`。

**硬件滤镜**（按平台）：

- CUDA：`scale_cuda` `overlay_cuda` `transpose_cuda` `pad_cuda` `colorspace_cuda` `yadif_cuda`
  `bwdif_cuda` `thumbnail_cuda` `chromakey_cuda` `bilateral_cuda` `hwupload_cuda`
- QSV：`scale_qsv` `vpp_qsv` `overlay_qsv` `deinterlace_qsv` `hstack_qsv` `vstack_qsv` `xstack_qsv`
- VAAPI：`scale_vaapi` `deinterlace_vaapi` `denoise_vaapi` `procamp_vaapi` `sharpness_vaapi`
  `tonemap_vaapi` `transpose_vaapi` `overlay_vaapi` `pad_vaapi` `drawbox_vaapi` `hstack_vaapi`
  `vstack_vaapi` `xstack_vaapi`
- 通用帧搬运：`hwupload` `hwmap` `hwdownload`

## 2 平台与 API 可用性矩阵

官方 HWAccelIntro 给出的平台可用性（`Y`=完整可用，`P`=部分支持，`N`=不可用）：

| API                    | Linux AMD | Linux Intel | Linux NVIDIA | Windows AMD | Windows Intel | Windows NVIDIA | Android | macOS | iOS   | 树莓派 |
| ---------------------- | --------- | ----------- | ------------ | ----------- | ------------- | -------------- | ------- | ----- | ----- | ------ |
| AMF                    | N         | N           | N            | **Y**       | N             | N              | N       | N     | N     | N      |
| NVENC/NVDEC/CUVID      | N         | N           | **Y**        | N           | N             | **Y**          | N       | N     | N     | N      |
| Direct3D 11（d3d11va） | N         | N           | N            | **Y**       | **Y**         | **Y**          | N       | N     | N     | N      |
| Direct3D 9（DXVA2）    | N         | N           | N            | **Y**       | **Y**         | **Y**          | N       | N     | N     | N      |
| libmfx / QSV           | N         | **Y**       | N            | N           | **Y**         | N              | N       | N     | N     | N      |
| MediaCodec             | N         | N           | N            | N           | N             | N              | **Y**   | N     | N     | N      |
| Media Foundation       | N         | N           | N            | **Y**       | **Y**         | **Y**          | N       | N     | N     | N      |
| OpenCL                 | **Y**     | **Y**       | **Y**        | **Y**       | **Y**         | **Y**          | P       | **Y** | N     | N      |
| VAAPI                  | P         | **Y**       | P            | N           | N             | N              | N       | N     | N     | N      |
| VDPAU                  | P         | N           | **Y**        | N           | N             | N              | N       | N     | N     | N      |
| VideoToolbox           | N         | N           | N            | N           | N             | N              | N       | **Y** | **Y** | N      |
| Vulkan                 | **Y**     | **Y**       | **Y**        | **Y**       | **Y**         | **Y**          | N       | N     | N     | N      |

要点：

- **Windows 上三家 GPU 共同的 API 只有 Direct3D（d3d11va/dxva2 硬解）**；编码则各走各家（NVIDIA→NVENC、Intel→QSV、AMD→AMF）。
- **NVIDIA 在 Windows 与 Linux 都通过 NVENC/NVDEC（CUDA 体系）**，Linux 上还可经 VDPAU 硬解。
- **Intel 在 Linux 上走 VAAPI**（libva），Windows 上走 QSV（libmfx 或 oneVPL）。UHD
  750 这类核显在两平台的硬编能力基本一致，但 API 完全不通。
- **AMD 在 Windows 上编码走 AMF，解码走 DXVA2/D3D11VA**；Linux 上经 VAAPI。
- **VideoToolbox 只服务 macOS/iOS**，H.264/HEVC/ProRes 编解码。

FFmpeg 侧的实现状态（官方表摘录，`-`=不适用、`Y`=可用、`N`=未实现）：

| API               | 内部硬解 | 外部解码器 | 硬件帧输出 | 外部编码器 | 硬件帧输入 | 滤镜        | 可在 CLI 使用 |
| ----------------- | -------- | ---------- | ---------- | ---------- | ---------- | ----------- | ------------- |
| AMF               | N        | N          | N          | Y          | Y          | N           | Y             |
| NVENC/NVDEC/CUVID | N        | Y          | Y          | Y          | Y          | Y           | Y             |
| D3D11             | Y        | -          | Y          | -          | -          | F（未集成） | Y             |
| DXVA2             | Y        | -          | Y          | -          | -          | N           | Y             |
| libmfx / QSV      | -        | Y          | Y          | Y          | Y          | Y           | Y             |
| Media Foundation  | -        | N          | N          | N          | N          | N           | N             |
| VAAPI             | Y        | -          | Y          | Y          | Y          | Y           | Y             |
| VDPAU             | Y        | -          | Y          | -          | -          | N           | Y             |
| VideoToolbox      | Y        | N          | Y          | Y          | Y          | -           | Y             |
| Vulkan            | Y        | -          | Y          | N          | N          | Y           | Y             |

## 3 硬件加速解码

### 3.1 通用选项：`-hwaccel` / `-hwaccel_output_format` / `-hwaccel_device`

官方定义（ffmpeg-cmd 文档）：

```text
-hwaccel[:stream_specifier] hwaccel    输入选项、按流指定
```

取值：`none`（默认）、`auto`、`vdpau`、`dxva2`、`d3d11va`、`vaapi`、`qsv`、`videotoolbox`、`cuda`、`d3d12va`、`amf`。

```text
-hwaccel_output_format[:stream_specifier] format  输入选项
```

- `auto`（默认）：解码帧拷回**系统内存**，后续可用任意软件滤镜、任意编码器。
- 显式设成硬件帧格式（`cuda`/`qsv`/`d3d11`/`d3d11va`/`vaapi`/`vulkan`/`opencl`/`dxva2`）：解码帧**留在显存**，要求后续滤镜与编码器都能消费该硬件帧（见 5、7 章）。

```text
-hwaccel_device[:stream_specifier] device  配合 -hwaccel 选择设备
```

官方特别提示（重要，实测也印证）：

- 多数加速方法面向**播放**场景，现代 CPU 软解并不慢；ffmpeg 通常还需把解码帧从显存拷回系统内存，进一步损失性能。
- **`qsv`
  是例外**：它不做回拷，而是直接做"硬件转码"，但要求**编解码器都支持 QSV 且不使用任何滤镜**。
- 若所选 hwaccel 不可用或解码器不支持，`-hwaccel` 无效果（不报错）。本机实测 `-hwaccel vaapi`
  在 Windows 上静默无效。

### 3.2 `-hwaccel` 内部硬解 vs 外部解码器

| 方式                     | 写法                        | 特点                                                             |
| ------------------------ | --------------------------- | ---------------------------------------------------------------- |
| 内部硬解（hwaccel 模式） | `-hwaccel cuda -i in.mp4`   | 软解器发现可硬解则委托给硬件；**不支持时自动回退软解**           |
| 外部解码器               | `-c:v h264_cuvid -i in.mp4` | 显式指定硬件解码器；**不支持就报错，无回退**；码流类型需事先已知 |

CUDA 体系两种方式都可用（`-hwaccel cuda` 与 `-c:v h264_cuvid`）；QSV 体系则对应"`-hwaccel qsv`
全链路"与"`-c:v h264_qsv` 外部解码器"两种模式（见下）。

### 3.3 NVIDIA：cuda / cuvid 解码族

**内部硬解（实测通过）**：

```bash
# 硬解 + 回拷系统内存（默认 hwaccel_output_format=auto）：
# 实测：解码 4K H.264 源，1672 帧全部 cuda 硬解，输出与软解一致
ffmpeg -hwaccel cuda -i in.mp4 -c:v libx264 out.mp4

# 硬解 + 帧留显存（配合硬件滤镜与硬件编码器，见 7.2 节）：
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
       -vf scale_cuda=1280:720 -c:v h264_nvenc out.mp4
```

**外部解码器（CUVID，实测通过）**：`h264_cuvid`、`hevc_cuvid`、`av1_cuvid`、`mpeg1/2/4_cuvid`、`vc1_cuvid`、`vp8/9_cuvid`、`mjpeg_cuvid`。它们把帧解码到系统内存（NV12 等），可直接交给任意编码器：

```bash
# 实测：h264_cuvid 硬解 + h264_nvenc 硬编直转（无滤镜）
ffmpeg -c:v h264_cuvid -i in.mp4 -c:v h264_nvenc -preset p5 -b:v 2M out.mp4
```

### 3.4 Intel QSV：两种模式（本机实测关键）

QSV 的 `-hwaccel qsv`
是**特例**：不打开"硬解回拷"，而是自动选择 qsv 解码器并直接以 qsv 硬件帧进入转码。官方原文：**"编解码器都必须支持 QSV 且不能使用任何滤镜"**。

- **全链路模式（实测通过）**：解码与编码都用 QSV、无滤镜或仅 QSV 硬件滤镜。

```bash
# 实测：QSV 全链路，4K H.264 源 → HEVC，软滤镜不可用，需 scale_qsv
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i 4k.mp4 \
       -vf scale_qsv=1280:720 -c:v hevc_qsv -preset medium -b:v 2M out.mp4

# 实测：无滤镜的 QSV 硬解直转（最简形式）
ffmpeg -c:v h264_qsv -i 4k.mp4 -c:v hevc_qsv -preset medium -b:v 2M out.mp4
```

- **硬解 + 软滤镜模式（实测通过）**：必须改用**外部解码器**写法，帧自然回拷到系统内存：

```bash
# 实测：h264_qsv 硬解 + 软件滤镜 scale + 软件编码 libx264
ffmpeg -c:v h264_qsv -i 4k.mp4 -vf scale=1280:720 -c:v libx264 -preset veryfast -b:v 2M out.mp4
```

- **容易踩的坑（实测失败）**：`-hwaccel qsv` 后接软件滤镜（`scale`、`crop`）或回拷 +
  QSV 编码器（`h264_qsv`）均报 `-22 Invalid argument`；`-hwaccel qsv`（未设
  `hwaccel_output_format`）再接 `libx264`
  同样失败——因为该模式下帧从未离开 QSV 表面。**要软滤镜，一定用 `-c:v h264_qsv` 外部解码器写法**。

QSV 解码器公共选项（官方 ffmpeg-codecs 4.9 节）：

| 选项          | 类型           | 说明                            |
| ------------- | -------------- | ------------------------------- |
| `async_depth` | int            | 内部并行深度，越大延迟越高      |
| `gpu_copy`    | default/on/off | 显存与系统内存间是否用 GPU 拷贝 |

`hevc_qsv` 解码器额外支持 `load_plugin`（`none`/`hevc_sw`/`hevc_hw`，加载用户插件）与
`load_plugins`（十六进制 UID 列表）。

### 3.5 Windows 通用：dxva2 / d3d11va / d3d12va

三家 GPU 在 Windows 都能用的硬解 API。它们**只负责解码；帧默认回拷系统内存**（官方实现状态表：无独立编码器、无滤镜支持；D3D11 的硬件帧输出可供 NVENC 直接消费）。

```bash
# d3d11va 硬解 + 回拷 + 软件滤镜 + NVENC 硬编（实测通过）
ffmpeg -hwaccel d3d11va -i 4k.mp4 -vf scale=1280:720 -c:v h264_nvenc -preset p5 -b:v 2M out.mp4

# 帧留在 d3d11 纹理中直接给 NVENC（官方 HWAccelIntro 示例，NVENC 可接受 d3d11 帧上下文）
ffmpeg -hwaccel_output_format d3d11 -hwaccel d3d11va -i in.mp4 -c:v hevc_nvenc out.mp4

# DXVA2 硬解回拷（官方示例）
ffmpeg -hwaccel dxva2 -threads 1 -i INPUT -f null - -benchmark
```

AV1 注意：AMD 的 DXVA2（DX9）链路官方注明**不支持 AV1**，AV1 输入要用 d3d11va。

### 3.6 其它平台（未实测，官方资料）

- **VAAPI**（Linux）：`-hwaccel vaapi -hwaccel_output_format vaapi`；设备初始化
  `-init_hw_device vaapi=/dev/dri/renderD129`。解码器为内部实现（H.264/HEVC/MPEG-2/VC-1/AV1/VP8/VP9 等）。
- **VDPAU**（Linux/NVIDIA）：仅解码，且**解出的帧不能拷回系统内存**（无法用于转码链路；只能
  `-f null` 测速或播放）。
- **VideoToolbox**（macOS）：`-hwaccel videotoolbox`；支持 H.263/H.264/HEVC/MPEG-1/2/4/ProRes 解码。
- **Vulkan**（跨平台视频解码，实验性）：H.264/HEVC/AV1；`ffmpeg -init_hw_device "vulkan=vk:0" -hwaccel vulkan -hwaccel_output_format vulkan -i INPUT -f null - -benchmark`。
- **MediaCodec**（Android）：`-c:v h264_mediacodec`
  等外部解码器（CLI 状态官方标为 N，主要在 API 层使用）。
- **AMF 解码**（Windows AMD）：`h264_amf` `hevc_amf` `av1_amf` `vp9_amf`
  外部解码器；AMD 官方推荐的硬解硬编全链路是 **d3d11va 硬解 + `-hwaccel_output_format d3d11` +
  AMF 硬编**（见 7.5 节，未实测）。

## 4 硬件加速编码

### 4.1 编码器家族总览（本机 FFmpeg 9.0.1 实测列表）

| 厂商         | 编码器                                                                                                | 支持的视频编码格式                              |
| ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| NVIDIA       | `h264_nvenc` / `hevc_nvenc` / `av1_nvenc`                                                             | H.264（AVC）/ H.265（HEVC）/ AV1                |
| Intel（QSV） | `h264_qsv` / `hevc_qsv` / `av1_qsv` / `mjpeg_qsv` / `mpeg2_qsv` / `vp9_qsv`                           | H.264 / HEVC / AV1 / MJPEG / MPEG-2 / VP9       |
| AMD（AMF）   | `h264_amf` / `hevc_amf` / `av1_amf`                                                                   | H.264 / HEVC / AV1                              |
| VAAPI        | `h264_vaapi` / `hevc_vaapi` / `av1_vaapi` / `mjpeg_vaapi` / `mpeg2_vaapi` / `vp8_vaapi` / `vp9_vaapi` | H.264 / HEVC / AV1 / MJPEG / MPEG-2 / VP8 / VP9 |
| Apple        | `h264_videotoolbox` / `hevc_videotoolbox` / `prores_videotoolbox`                                     | H.264 / HEVC / ProRes（macOS）                  |

平台可用性与硬件世代直接相关：编解码器**在构建里存在 ≠ 当前 GPU 支持**。本机 Intel UHD 750 就存在
`av1_qsv` 编码器但实测编码失败（Rocket
Lake 只有 AV1 解码单元，AV1 编码需 12 代及以后的核显，见 8.1 节）。

### 4.2 NVENC（实测参数）

打开编码器帮助：`ffmpeg -h encoder=h264_nvenc`（`hevc_nvenc`/`av1_nvenc`
同结构）。三家 NVENC 参数体系一致，差异点：`hevc_nvenc` 的 `-tune` 多一个 `uhq`、profile 为
`main/main10/rext/mv`；`av1_nvenc` **无 `-profile` 且无 `-bf`**（AV1 不支持 B 帧）。

#### 4.2.1 通用参数（实测输出）

| 参数                           | 说明                    | h264_nvenc 实测取值                                                         |
| ------------------------------ | ----------------------- | --------------------------------------------------------------------------- |
| `-preset`                      | 速度/质量档             | `p1`~`p7`（`slow`/`medium`/`fast` 为旧别名，`p4` 默认）；p7 最慢最优        |
| `-tune`                        | 用途调优                | `hq`（默认）、`ll` 低延迟、`ull` 超低延迟、`lossless` 无损；hevc 另有 `uhq` |
| `-profile`                     | 编码档次                | `baseline`/`main`/`high`/`high10`/`high422`/`high444p`（默认 `high`）       |
| `-level`                       | 级别限制                | `auto`（默认，自动对齐分辨率）或 1.0~6.2                                    |
| `-rc`                          | 码率控制                | `constqp`/`vbr`/`cbr`（第 3 篇 5.15 详述）                                  |
| `-cq`                          | 恒定质量值              | 0~51，越小越好；配合 `-rc constqp` 或 `-rc vbr`                             |
| `-b:v/-maxrate/-bufsize`       | 平均/峰值码率、VBV 缓冲 | VBR 时配合 `-rc-lookahead` 使用                                             |
| `-multipass`                   | 多遍                    | `disabled`/`qres`/`fullres`（配合 vbr）                                     |
| `-rc-lookahead`                | 前置分析帧数            | 0~32                                                                        |
| `-spatial-aq` / `-temporal-aq` | 空间/时间自适应量化     | 1 开启，画质改善                                                            |
| `-g`                           | GOP 大小（关键帧间隔）  | 建议 2 倍帧率                                                               |
| `-bf`                          | B 帧数量                | h264/hevc 可用（0~4），**av1 无效**                                         |
| `-refs`                        | 参考帧数                | 1~16                                                                        |
| `-tier`                        | HEVC 层级               | `main`/`high`（仅 hevc，高码率用 high）                                     |

**支持的像素格式（实测 `-h encoder`
输出）**：三家 NVENC 相同，含 4:2:0（`yuv420p`/`nv12`）、8/10/12-bit（`p010le`/`p012le`/`p016le`）、4:2:2（`nv16`/`p210le`/`p212le`/`p216le`）、4:4:4（`yuv444p`
系）、RGB（`bgr0`…`gbrp`）以及硬件帧
`cuda`、`d3d11`。**注意**：像素格式"支持"只是编码器接口层面；实际 4:2:2 编码受 GPU 世代限制（RTX
4070 不支持 4:2:2，见 6.3 节，编码时会报错）。

#### 4.2.2 实测最小示例

```bash
# H.264：cuda 全链路 + VBR 码控 + GOP 96（实测通过，输出 High@3.1）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v h264_nvenc -preset p5 -rc vbr -cq 24 \
       -b:v 2M -maxrate 2M -bufsize 4M -g 96 out.mp4

# HEVC 10-bit：直接 -profile main10，8-bit 输入自动升位深（实测通过，输出 Main10@3.1）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v hevc_nvenc -profile main10 \
       -rc vbr -cq 24 -b:v 2M out.mp4

# AV1：无 B 帧、无 profile 选项（实测通过，输出 Main@5.0）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v av1_nvenc -preset p5 -cq 30 -b:v 2M out.mp4
```

### 4.3 QSV（实测 + 官方参数）

#### 4.3.1 码控方法（官方 9.31.1 节）

按设置方式自动选择，优先级固定：

| 触发条件                                                            | 模式   | 说明                              |
| ------------------------------------------------------------------- | ------ | --------------------------------- |
| 设 `-global_quality` 且设 `-qscale`                                 | CQP    | 固定量化步长                      |
| 设 `-global_quality` + `-look_ahead`                                | LA_ICQ | 智能恒定质量 + lookahead          |
| 只设 `-global_quality`                                              | ICQ    | 智能恒定质量；质量值 1~51，1 最佳 |
| 设 `-b:v` + `-look_ahead`                                           | LA     | lookahead VBR                     |
| 设 `-b:v` + `-vcm`                                                  | VCM    | 视频会议模式                      |
| 设 `-b:v` 且 `-maxrate` 等于 `-b:v`                                 | CBR    | 恒定码率                          |
| 设 `-b:v` 且 `-maxrate` 高于 `-b:v`                                 | VBR    | 可变码率                          |
| 设 `-b:v` 且未设 maxrate、`-avbr_accuracy`/`-avbr_convergence` 非零 | AVBR   | 平均 VBR（Windows H.264/HEVC）    |
| 以上皆未设置                                                        | CQP    | 默认回退 CQP                      |

**GBDT 全局选项到 MSDK 的映射**（官方 9.31.2 节，写参数前先看这张表）：

| FFmpeg 选项                | MSDK 选项                    |
| -------------------------- | ---------------------------- |
| `-g`（gop_size）           | GopPicSize                   |
| `-bf`+1（max_b_frames）    | GopRefDist                   |
| `-rc_init_occupancy`       | InitialDelayInKB             |
| `-slices`                  | NumSlice                     |
| `-refs`                    | NumRefFrame                  |
| `-b_strategy`              | BRefType                     |
| `-cgop`（CLOSED_GOP 标志） | GopOptFlag                   |
| `-coder vlc`               | 用 CAVLC 替代 CABAC（H.264） |

#### 4.3.2 公共选项（官方 9.31.3 + 本机 `-h` 实测）

| 选项                                                                                  | 实测取值                                             | 说明                                                                                                                        |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `-preset`                                                                             | `veryfast`~`veryslow`（实测数值 7~1，默认 0=medium） | 速度/质量档                                                                                                                 |
| `-async_depth`                                                                        | int（默认 4）                                        | 异步并行深度                                                                                                                |
| `-forced_idr`                                                                         | boolean                                              | 强制 I 帧为 IDR                                                                                                             |
| `-low_power`                                                                          | boolean（默认 auto）                                 | 低功耗模式（实验性，受 mfx 版本/码控模式限制多）                                                                            |
| `-qsv_params`                                                                         | key1=value1:key2=value2…                             | 直接传原生 MSDK 参数                                                                                                        |
| `-rdo`                                                                                | -1/0/1                                               | 率失真优化                                                                                                                  |
| `-max_frame_size[_i/_p]`                                                              | 字节                                                 | I/P 帧最大字节数                                                                                                            |
| `-max_slice_size`                                                                     | 字节                                                 | slice 最大字节                                                                                                              |
| `-bitrate_limit`                                                                      | -1/0/1                                               | 是否限制码率到 QSV 范围（关掉可能违反 HRD）                                                                                 |
| `-mbbrc`                                                                              | -1/0/1                                               | 宏块级码控，改善观感但降性能                                                                                                |
| `-extbrc`                                                                             | -1/0/1                                               | 扩展码控（配合 lookahead）                                                                                                  |
| `-low_delay_brc`                                                                      | boolean                                              | 逐帧码率方差最小化（直播推荐）                                                                                              |
| `-adaptive_i` / `-adaptive_b`                                                         | -1/0/1                                               | 允许编码器把 B/P 帧改成 I 帧、B 改 P                                                                                        |
| `-p_strategy`                                                                         | 0/1/2                                                | P 金字塔（2 需 `-bf 0`）                                                                                                    |
| `-b_strategy`                                                                         | -1/0/1                                               | B 帧作为参考                                                                                                                |
| `-dblk_idc`                                                                           | 0~2                                                  | 去块滤波控制                                                                                                                |
| `-max_qp_i/p/b` / `-min_qp_i/p/b`                                                     | -1~51                                                | 各帧型 QP 上下限                                                                                                            |
| `-scenario`                                                                           | 0~8                                                  | 场景提示：unknown/displayremoting/videoconference/archive/livestreaming/cameracapture/videosurveillance 等（实测值见 `-h`） |
| `-low_delay_brc`                                                                      | boolean                                              | 严格遵循平均帧大小                                                                                                          |
| `-int_ref_type` / `-int_ref_cycle_size` / `-int_ref_qp_delta` / `-int_ref_cycle_dist` | int                                                  | 帧内刷新（错误恢复）；开启需 `-bf 0`                                                                                        |
| `-idr_interval`                                                                       | int                                                  | IDR 帧间隔                                                                                                                  |
| `-repeat_pps`                                                                         | boolean                                              | 每帧重复 PPS（流兼容性）                                                                                                    |
| `-aud`                                                                                | boolean                                              | 插入 Access Unit Delimiter NAL（默认 false）                                                                                |
| `-a53cc`                                                                              | boolean                                              | A53 隐藏字幕（默认 true）                                                                                                   |
| `-avbr_accuracy` / `-avbr_convergence`                                                | int                                                  | AVBR 精度/收敛（单位：0.1%、100 帧）                                                                                        |

#### 4.3.3 profile 与像素格式（实测 `-h`）

| 编码器     | profile 取值                                                   | 像素格式（实测）                                                                                                 |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `h264_qsv` | `baseline`（66）/`main`（77）/`high`（100）                    | `nv12`、`qsv`                                                                                                    |
| `hevc_qsv` | `main`（1）/`main10`（2）/`mainsp`（3）/`rext`（4）/`scc`（9） | `nv12`、`p010le`、`p012le`、`yuyv422`、`y210le`、`bgra`、`x2rgb10le`、`vuyx`、`xv30le`（4:2:2/10/12-bit 均支持） |
| `av1_qsv`  | `main`（1）                                                    | `nv12`、`p010le`；另有 `-tile_cols`/`-tile_rows`/`-look_ahead_depth`                                             |

10-bit HEVC 示例（QSV）：

```bash
# 实测思路：hevc_qsv 直接 -profile main10（10-bit 输入需先转 p010le；可用硬件链）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i 10bit.mp4 \
       -vf scale_qsv=format=p010le -c:v hevc_qsv -profile main10 -b:v 2M out.mp4
```

### 4.4 VAAPI（未实测，参数以官方与本机 `-h` 定义为据）

| 编码器       | profile 取值（实测 `-h`）                                                | level   |
| ------------ | ------------------------------------------------------------------------ | ------- |
| `h264_vaapi` | `constrained_baseline`（578）/`main`（77）/`high`（100）/`high10`（110） | 1~5.1+  |
| `hevc_vaapi` | `main`（1）/`main10`（2）/`rext`（4）；另有 `-tier main/high`            | 1~6     |
| `av1_vaapi`  | `main`（0）/`high`（1）/`professional`（2）；另有 `-tier`                | 2.0~7.x |

VAAPI 编码器官方还支持
`-rc_mode`（CQP/CBR/VBR/ICQ 等）、`-qp`、`-b:v`、`-maxrate`、`-g`、`-bf`、`-compression_level`
等公共参数（ffmpeg-codecs 9.33 节），因本机无 VAAPI 设备未逐项实测。Linux 上使用先
`-init_hw_device vaapi=/dev/dri/renderD129`。

### 4.5 AMF（未实测，参数以官方资料为据）

`h264_amf` / `hevc_amf` / `av1_amf` 的常用参数（AMD 官方 +
ffmpeg 社区惯例）：`-usage`（transcoding/ultralowlatency/lowlatency/webcam 等，默认 transcoding）、`-quality`（speed/balanced/quality，默认 balanced）、`-profile`（`h264_amf`
支持 baseline/main/high；`hevc_amf`
支持 main/main10）、`-rc`（CBR/VBR/CQP/ICQ/QVBR/LA_ICQ/LA_VBR/LA_LCU 等）、`-qp_i/p/b`、`-qvbr_quality_level`、`-enforce_hrd`、`-bf`、`-g`、`-header_insertion_mode`
等。Windows AMD 推荐全链路为 d3d11va 硬解 + AMF 硬编（示例见 7.5 节）。

### 4.6 其它平台编码器

- **VideoToolbox**（macOS）：`h264_videotoolbox`/`hevc_videotoolbox`。码控两种：`-b:v`
  比特率模式、`-q:v` 恒定质量（**范围 1~100，100 最高**；仅 Apple Silicon 且 FFmpeg ≥
  4.4 支持恒定质量）。
- **MediaFoundation**（Windows 通用，官方 ffmpeg-codecs 9.26 节）：`h264_mf`/`hevc_mf`，参数
  `-rate_control`、`-b:v`、`-profile`
  等。官方实现状态表标为"编码器无、CLI 不可用"，实际各构建差异大。
- **MediaCodec**（Android）：`h264_mediacodec`/`hevc_mediacodec`/`av1_mediacodec` 等。

## 5 硬件滤镜

### 5.1 帧流转：hwupload / hwmap / hwdownload

硬件滤镜的前提是**帧以硬件表面形式存在**。三个通用滤镜负责在"系统内存帧"与"硬件帧"之间搬运：

| 滤镜         | 作用                                                       | 配套 `-vaapi_device`/`-hwaccel_device` 等情况 |
| ------------ | ---------------------------------------------------------- | --------------------------------------------- |
| `hwupload`   | 把内存帧上传为硬件帧（前缀 hwupload_cuda/hwupload_qsv 等） | 参数可选 `extra_hw_frames`：申请额外硬件帧    |
| `hwmap`      | 生成对同一硬件帧的引用映射；`mode=read`/`write` 控制读写   | `-filter_hw_device` 配合使用                  |
| `hwdownload` | 把硬件帧下载回系统内存（需指定输出像素格式）               | `format=nv12` 等                              |

官方 HWAccelIntro 核心提示：

- **mix-frames**（混合帧）：`hwupload`
  后链式滤镜默认只做帧内存拷贝（CPU 搬运）；只有显式使用对应平台的硬件滤镜（`scale_cuda`
  等）才算真正 GPU 运算。中间过渡用 `hwmap` 避免重复拷贝。
- `hwdownload` 必须用 `format=` 指定目标格式（如 `hwdownload=format=nv12`），否则无法确定输出布局。

典型"软解 + 硬件滤镜 + 硬编"链路（官方示例）：用 `-init_hw_device vaapi` / `-hwaccel cuda`
初始化设备，然后把 `hwupload` 挂在滤镜链起点、`hwdownload`/硬件编码器挂在终点。以 CUDA 为例：

```bash
# 软解 + hwupload_cuda 上传 + scale_cuda 硬件缩放 + hwdownload 回拷（官方思路）
ffmpeg -init_hw_device cuda=cu:0 -filter_hw_device cu -i in.mp4 \
       -vf "hwupload_cuda,scale_cuda=1280:720,hwdownload,format=nv12" \
       -c:v libx264 out.mp4
```

注意：**上面的回拷写法画蛇添足**——若编码器是 nvenc，帧停在 `cuda`
格式直接喂即可（见 5.2 实测链路）。回拷只在编码端是纯软件（libx264）时才需要。

### 5.2 CUDA 滤镜族（实测）

本机实测通过并写入文档的 CUDA 滤镜：`scale_cuda`、`transpose_cuda`、`overlay_cuda`、`pad_cuda`、`colorspace_cuda`、`yadif_cuda`、`bwdif_cuda`、`thumbnail_cuda`、`chromakey_cuda`、`bilateral_cuda`、`hwupload_cuda`。

**scale_cuda 解析**：参数与软件 `scale` 相同（`w`/`h`、`force_original_aspect_ratio`、`interp_algo`
等），另外特有 `format`（默认
`nv12`）。注意**滤镜输出宽度按 32 对齐**（本机实测：两路 1280×720 + 小 logo 叠加后输出 1280×736，见下）。

实测全硬件滤镜链（纯 GPU：硬解 → 硬件滤镜 → 硬编，帧全程不离开显存）：

```bash
# 实测 1：scale_cuda + transpose_cuda（HEVC 硬编）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf "scale_cuda=1280:720,transpose_cuda=1" \
       -c:v hevc_nvenc -preset p5 -b:v 2M nv_transpose.mp4

# 实测 2：overlay_cuda 叠加 logo（1280x720 背景 + 64x64 logo，输出 1280x736——32 像素对齐行为）
# logo 必须先软解、scale 到目标尺寸、format=nv12，再 hwupload_cuda 上传
ffmpeg -init_hw_device cuda=cu:0 -filter_hw_device cu \
       -i bg.mp4 -i logo.png \
       -filter_complex "[0:v]hwupload_cuda[bg];[1:v]scale=64:64,format=nv12,hwupload_cuda[lg];\
                        [bg][lg]overlay_cuda=16:16" \
       -c:v h264_nvenc -preset p5 -b:v 2M nv_overlay.mp4
```

**overlay_cuda 实测关键**：

- 主视频若已是 `cuda` 帧可直接入链；logo（png/jpg 软解）必须 `format=nv12` 后再
  `hwupload_cuda`——直接上传 yuv420p 会报 `Can't overlay yuv420p on nv12`。
- 上传后 logo 的尺寸不受滤镜重算（先 `scale=64:64` 再传）。
- **输出尺寸按 32 对齐**：720→736；需要精确尺寸时用 `scale_cuda`
  显式收尾（`-vf "...,scale_cuda=1280:720"`）或后接 `pad_cuda`。
- 未实测的 CUDA 滤镜族：`avgblur_cuda`、`boxblur_cuda`、`flip_cuda`、`geq_cuda`、`hflip_cuda`、`msad_cuda`、`nlmeans_cuda`、`scale_npp`、`vflip_cuda`
  等（功能与对应软件滤镜一致，写法相同）。

### 5.3 QSV 滤镜族（实测）

**vpp_qsv**
是 Intel 的瑞士军刀，一滤镜多能力：缩放、crop、去隔行、降噪、锐化、色调、帧率转换均可拼到一条命令：

```bash
# 实测：scale_qsv 全硬件缩放（QSV 全链路必需，软件 scale 在 qsv 模式下报错）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i 4k.mp4 \
       -vf scale_qsv=1280:720 -c:v hevc_qsv -preset medium -b:v 2M out.mp4

# vpp_qsv 多能力写在一个滤镜里（官方 QSV 指南语法；本机参数以 -h 为准）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i 4k.mp4 \
       -vf "vpp_qsv=w=1280:h=720:deinterlace=1:denoise=5:detail=2" \
       -c:v h264_qsv -preset medium -b:v 2M out.mp4
```

vpp_qsv 本机实测参数（`ffmpeg -h filter=vpp_qsv`）：`w`/`h`（宽高表达式）、`format`（输出像素格式，如 p010le）、`framerate`（输出帧率，用于 FRC）、`deinterlace`（0=off、1=bob、2=advanced）、`denoise`（降噪 0~100）、`detail`（细节增强 0~100）、`procamp`
组（hue/saturation/contrast/brightness）、`transpose`（旋转/翻转）、`crop`
组（cw/ch/cx/cy）、`tonemap`（HDR 色调映射）、`async_depth`（默认 4）等。官方 QSV 指南示例：`vpp_qsv=framerate=60,scale_qsv=w=1920:h=1080`（60fps 帧率转换 + 缩放）。

QSV 滤镜族其它成员：`overlay_qsv`（叠加，注意快进帧时建议用 vpp_qsv 的 overlay）、`deinterlace_qsv`、`hstack_qsv`/`vstack_qsv`/`xstack_qsv`（并排/网格拼接）、`pad_qsv`。

### 5.4 VAAPI 滤镜族（未实测）

Linux
VAAPI 有极全的硬件滤镜族：`scale_vaapi`、`deinterlace_vaapi`、`denoise_vaapi`、`procamp_vaapi`（亮度/对比/饱和/色调）、`sharpness_vaapi`、`tonemap_vaapi`（HDR→SDR 色调映射）、`overlay_vaapi`、`transpose_vaapi`、`pad_vaapi`、`drawbox_vaapi`、`hstack_vaapi`/`vstack_vaapi`/`xstack_vaapi`。典型链路：

```bash
# Linux VAAPI：硬解 → 硬件缩放+色调映射 → VAAPI 硬编（官方语法，未实测）
ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD129 -filter_hw_device va \
       -hwaccel vaapi -hwaccel_output_format vaapi -i hdr10.mp4 \
       -vf "tonemap_vaapi=tonemap=bt2446a:format=p010,scale_vaapi=3840:2160" \
       -c:v hevc_vaapi -profile main10 -b:v 12M out.mp4
```

注意 tonemap_vaapi 输出用 `format=p010`（10-bit），否则 HDR10 源会降 8-bit 丢失亮度信息。

### 5.5 硬件滤镜链 vs 软件滤镜链的取舍

| 维度     | 纯硬件链（cuda/qsv/vaapi）                           | 回拷 + 软件滤镜链                             |
| -------- | ---------------------------------------------------- | --------------------------------------------- |
| 速度/CPU | GPU 全程处理，CPU 占用极低，最快                     | 多一次帧回拷，CPU 承担滤镜运算                |
| 能力     | 滤镜种类少（无 drawtext/ass 字幕等）                 | 任意软件滤镜：drawtext、subtitles、eq、lut 等 |
| 尺寸对齐 | 部分平台有对齐行为（实测 CUDA overlay 输出 32 对齐） | 完全按参数精确                                |
| 精度     | 硬件 VPP 运算精度实现相关                            | 软件滤镜精度可预测                            |
| 适用     | 大批量转码、直播低延迟                               | 字幕烧录、水印、复杂调色、需精确尺寸          |

实践结论（实测）：**字幕/大段文字/多滤镜调色走回拷；纯缩放/转场/拼接走全硬件；GIF/截图这类小工作负载用软件链省心**。

## 6 文件格式与编码格式兼容性

### 6.1 容器（muxer）与编码器兼容矩阵（实测）

以本机 FFmpeg 9.0.1 + NVENC/QSV 硬编实测为准（✅=实测通过，—=未测/依官方）：

| 容器 \\ 视频编码 | H.264（nvenc/qsv）                  | HEVC（nvenc/qsv）                               | AV1（nvenc）                | VP9（vp9_qsv） |
| ---------------- | ----------------------------------- | ----------------------------------------------- | --------------------------- | -------------- |
| MP4（.mp4）      | ✅                                  | ✅                                              | ✅                          | ✅（官方支持） |
| MKV（.mkv）      | ✅                                  | ✅                                              | ✅（官方支持）              | ✅             |
| TS（.mpegts）    | ✅                                  | ✅（实测通过）                                  | —（官方：Apple 设备不支持） | —              |
| WebM（.webm）    | ❌（WebM 只收 VP8/VP9/AV1）         | ❌                                              | ✅                          | ✅             |
| FLV（.flv）      | ✅（实测通过；直播推流常用于 RTMP） | ❌（已被 Adobe 废弃，仅部分播放器私有扩展支持） | ❌                          | ❌             |
| MOV（.mov）      | ✅                                  | ✅                                              | —                           | —              |
| AVI（.avi）      | ✅                                  | ❌（容器官方不支持 HEVC）                       | ❌                          | —              |

实测命令（均已通过）：

```bash
# H.264 → MKV / FLV / MP4
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v h264_nvenc -preset p5 -b:v 2M out.mkv
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v h264_nvenc -preset p5 -b:v 2M out.flv
# HEVC → MKV / TS（TS 流实测可封装 HEVC，但 Apple 生态对 TS 内 HEVC 兼容性差）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v hevc_nvenc -preset p5 -b:v 2M out.ts
# AV1 → WebM（webm 只支持 VP8/VP9/AV1 三种视频编码）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 -c:v av1_nvenc -b:v 2M out.webm
```

兼容性结论（对交付/发布场景重要的几对）：

- **MP4/MOV 可装 H.264 + AAC（最通用）**；MP4 内 HEVC 自 2015 年起普遍支持，AV1 依 ISO/IEC
  23000-22（MPEG-DASH 第 22 部分）也进了 MP4，但老设备/老浏览器仍不认 AV1-in-MP4。
- **TS 容器**：H.264/HEVC 均可（官方注明 Apple 设备不保证 HEVC-in-TS 播放）；直播/广电链路常用。
- **FLV**：只支持 H.264/AAC 组合（RTMP 推流默认）；HEVC-in-FLV 目前仅部分平台私有支持（抖音 B 站等有自家扩展），标准无效。
- **WebM**：只收 VP8/VP9/AV1，不收 H.264/HEVC——**投递给只认 WebM 的场景（部分 Web/WeChat 内嵌）要先用 NVENC
  AV1 或 VP9 编码**。
- MKV 是"万金油"：上述编码全部可装，但主流平台（微信、抖音、B 站上传）大多不认 MKV，发布前要转 MP4。

### 6.2 codec / format / profile / level / bitrate / size 维度

#### 6.2.1 profile（档次）

| 编码  | 常见 profile                                           | 说明                                                                                    |
| ----- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| H.264 | `baseline`/`main`/`high`/`high10`/`high422`/`high444p` | baseline 无 B 帧，兼容老设备；high 最常用；high444p 需 4:4:4 且对 NVENC 有 GPU 世代限制 |
| HEVC  | `main`/`main10`/`mainsp`/`rext`/`scc`                  | main10=10bit 广色域默认；rext=4:2:2/4:4:4；scc=屏幕内容编码（截图/录屏场景）            |
| AV1   | `main`/`high`/`professional`                           | main 覆盖 10bit 4:2:0；4:4:4 需 professional（AV1 无"profile444"独立命名）              |

#### 6.2.2 level（级别）——分辨率/帧率/码率的上限包络

Level 定义了该编码流的**分辨率×帧率×码率**上限，播放器按 level 判断能否解码。H.264/HEVC 的 level 与最大分辨率对照（H.264/HEVC 实际按宏块/采样率计算，下表为常见组合）：

| Level       | 最大分辨率                 | 备注                                    |
| ----------- | -------------------------- | --------------------------------------- |
| 1.0         | 128×96@30                  | 老手机彩信                              |
| 1.3         | 352×288@30                 | CIF                                     |
| 2.x         | 352×576~720×576            | 标清                                    |
| 3.0         | 720×576@25                 | PAL 标清                                |
| 3.1         | 1280×720@30                | **实测 NVENC 720p30 自动选 3.1**        |
| 3.2         | 1280×720@60 / 1920×1080@30 | **实测 QSV 720p60 选 3.2**              |
| 4.0         | 1920×1080@30               | 蓝光                                    |
| 4.1         | 1920×1080@60               | 绝大多数 1080p60 流                     |
| 4.2         | 2048×1080@60               | QFHD 部分                               |
| 5.0         | 3840×2160@30               | **实测 4K24 HEVC 自动选 5.0**           |
| 5.1         | 3840×2160@60               | 4K60                                    |
| 5.2         | 3840×2160@120              |                                         |
| 6.0/6.1/6.2 | 7680×4320@30/60/90         | 8K（HEVC）；AV1 level 另有 2.0~7.3 体系 |

要点：**不用手填 level**——`-level auto`
默认按输出分辨率/帧率自动对齐；手填过高会因播放器解码能力不足播不动（1080p 填 5.2 多数设备没问题，但 4K60 填 3.1 会直接被卡）。实测：720p30→`High@3.1`、720p60（QSV）→`High@3.2`、4K24
HEVC→`Main@5.0`、HEVC main10→`Main 10@3.1`。

#### 6.2.3 bitrate（码率）与 GOP

- 硬件编码器的码控参数（nvenc：`-rc`+`-b:v`/`-maxrate`/`-bufsize`/`-cq`；qsv：见 4.3.1 触发表；amf：`-rc`
  同族）。
- **同级画质**：NVENC/QSV 需要的码率通常比 x264/x265 高 20%–40%（本机实测：same 设置下 nvenc 码率约为 x264 的 1.9 倍，见 7.6 节对比），部署码率预算要相应上调。
- B 帧：AV1 无 B 帧（nvenc av1 无 `-bf`），HEVC/H.264 可 `-bf`
  0~4；B 帧增加编码延迟，直播/低延迟场景设 0。
- GOP：`-g`
  建议约 2×帧率（如 24fps→48、30fps→60）；**输出文件 seek 定位与流式切片粒度由 IDR 间隔决定**，直播统一用
  `-g 60`（2 秒 @30fps）+ `-sc_threshold 0` 便于切片。

#### 6.2.4 size（分辨率/尺寸/对齐）

- 硬件滤镜/编码器的尺寸约束：
    - **NVENC**：宽/高至少 145 px（编码器要求）；HEVC/AV1 建议偶数尺寸；NVENC
      7 代+ 支持任意尺寸（自动内部对齐），但协商输出时尽量用偶数。
    - **QSV**：h264_qsv/hevc_qsv 要求**宽高均为偶数**（4:2:0 采样的基本要求），奇数直接报错；推荐 16 对齐。
    - **CUDA
      overlay 链路实测输出宽度按 32 对齐**（1280→1280 不变，高度 720→736）——需要精确尺寸时在链尾补
      `scale_cuda=w:h`。
    - VAAPI：要求宽高 16 对齐（部分实现 32）。
- 帧率建议：输出帧率与源不一致时 GPU 链路用 `fps`（软）或 `vpp_qsv=framerate=`（硬），编码端 `-r`
  只影响时间戳打包不改帧率语义（详见第 3 篇 8.3 节）。

### 6.3 GPU 世代编解码支持矩阵（NVIDIA 官方数据）

「构建里有编码器」不等于「这张卡能用」。显卡支持什么编码格式取决于 **NVENC/NVDEC 世代**，官方《Video
Encode and Decode Support Matrix》按显卡逐行给出能力。下表摘录本机 RTX 4070 所在 **Ada Lovelace（RTX
40 系）** 世代与对照的 **Blackwell（RTX 50 系）**、Ampere（RTX 30 系）能力（✅=支持，❌=不支持）：

**NVENC 编码能力（取自官方矩阵）**

| 能力                   | RTX 30 系（Ampere，7 代） | RTX 40 系（Ada，8 代） | RTX 50 系（Blackwell，9 代） |
| ---------------------- | ------------------------- | ---------------------- | ---------------------------- |
| H.264 4:2:0            | ✅                        | ✅                     | ✅                           |
| H.264 4:2:2            | ❌                        | ❌                     | ✅（9 代新增）               |
| H.264 4:4:4 / Lossless | ✅                        | ✅                     | ✅                           |
| H.265 4K 4:2:0         | ✅                        | ✅                     | ✅                           |
| H.265 4:2:2            | ❌                        | ❌                     | ✅（9 代新增）               |
| H.265 4:4:4 / Lossless | ✅                        | ✅                     | ✅                           |
| H.265 8K               | ❌（30 系不支持标称 8K）  | ✅                     | ✅                           |
| HEVC 10-bit            | ✅                        | ✅                     | ✅                           |
| HEVC B 帧              | ✅                        | ✅                     | ✅                           |
| AV1 4:2:0              | ✅                        | ✅                     | ✅                           |
| 最大并发编码会话       | 12                        | 12                     | 12                           |

**NVDEC 解码能力（取自官方矩阵）**

| 能力                    | RTX 40 系（Ada，5 代） | RTX 50 系（Blackwell，6 代） |
| ----------------------- | ---------------------- | ---------------------------- |
| MPEG-1/2/4、VC-1、VP8   | ✅                     | ✅                           |
| VP9 8/10/12-bit         | ✅                     | ✅                           |
| H.264 4:2:0 8/10-bit    | ✅                     | ✅                           |
| H.264 4:2:2 8/10-bit    | ❌                     | ✅（6 代新增）               |
| H.265 4:2:0 8/10/12-bit | ✅                     | ✅                           |
| H.265 4:2:2 8/10/12-bit | ❌                     | ✅（6 代新增）               |
| H.265 4:4:4 8/10/12-bit | ✅                     | ✅                           |
| AV1 8/10-bit            | ✅                     | ✅                           |

对本机 RTX 4070 的实操结论：

- **4:2:2 编解码全部不支持**（编码端报
  `Invalid argument`，解码端静默回退软解或报错）——遇到了 4:2:2 的录制素材（Sony/佳能 10-bit
  422 常见），转码请走软件编码器，或先转 4:2:0 再硬编。
- 4:4:4（含 Lossless）、8K（编码）、10-bit、B 帧、AV1 均可用，且 nvenc 原生支持贪心 B 帧（-bf
  4 实测可编码）。
- NVENC 每卡 **12 路并发**上限：同一时刻超过 12 个编码会话会报
  `NVENC_ERROR_DEVICE_BUSY`（会话包括播放器调用 NVENC 的解码后处理），多路直播/批量转码要排队或分流到多卡（8.10 节）。
- 服务器（A 系列/RTX 6000）、Jetson 的能力与 GeForce 不同，矩阵需按具体型号查官方页面。

## 7 全硬件加速工作流

### 7.1 链路总览

全硬件加速的完整链路 =
**硬件解码 →（可选）硬件滤镜 → 硬件编码**，帧全程留在显存。按平台可落地为三套：

| 平台                     | 硬解                                                             | 硬件滤镜                                            | 硬编             | 本机状态                    |
| ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------- | ---------------- | --------------------------- |
| NVIDIA（Windows/Linux）  | `-hwaccel cuda -hwaccel_output_format cuda`（或 `-c:v *_cuvid`） | `*_cuda` 滤镜族                                     | `*_nvenc`        | ✅ 实测                     |
| Intel（Windows QSV）     | `-hwaccel qsv -hwaccel_output_format qsv`                        | `scale_qsv`/`vpp_qsv`                               | `*_qsv`          | ✅ 实测                     |
| Intel/AMD（Linux VAAPI） | `-hwaccel vaapi -hwaccel_output_format vaapi`                    | `*_vaapi` 滤镜族                                    | `*_vaapi`        | ❌ 未实测（Windows 无设备） |
| AMD（Windows）           | `-hwaccel d3d11va -hwaccel_output_format d3d11`                  | 无硬件滤镜（可用 cuda 需 AMD 显卡支持 ROCm/opengl） | `*_amf`          | ❌ 未实测（无 AMD GPU）     |
| Apple（macOS）           | `-hwaccel videotoolbox -hwaccel_output_format videotoolbox`      | 无                                                  | `*_videotoolbox` | ❌ 未实测                   |

### 7.2 NVIDIA 全硬件链路（实测）

```bash
# ① H.264 全硬件：cuda 硬解 → scale_cuda → h264_nvenc（720p 输出）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 \
       -c:v h264_nvenc -preset p5 -rc vbr -cq 24 -b:v 2M -maxrate 2M -bufsize 4M -g 96 \
       nv_h264.mp4
#   probe：H.264 High@L3.1、yuv420p、1280x720、约 1.86 Mbps —— 全链无 CPU 滤镜

# ② HEVC 10-bit 全硬件（8-bit 源自动升位深，实测 -profile main10 即可）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -vf scale_cuda=1280:720 \
       -c:v hevc_nvenc -profile main10 -rc vbr -cq 24 -b:v 2M \
       nv_hevc10.mp4
#   probe：HEVC Main 10@L3.1

# ③ 4K 直编（不缩放，8 Mbps 目标 / 12 Mbps 峰值）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i 4k.mp4 \
       -c:v hevc_nvenc -preset p5 -rc vbr -cq 26 -b:v 8M -maxrate 12M -bufsize 16M \
       nv_4k.mp4
#   probe：HEVC Main@L5.0，实测文件大小约 4.4 MB（-t 4 秒）

# ④ 外部解码器写法（cuvid）全硬件直转：H.264 → H.264
ffmpeg -c:v h264_cuvid -i 4k.mp4 -c:v h264_nvenc -preset p5 -b:v 2M \
       cuvid_nvenc.mp4
```

**三件套铁律（实测）**：`-hwaccel cuda` +
`-hwaccel_output_format cuda` + 硬件滤镜/硬件编码器必须成套出现；缺 `-hwaccel_output_format cuda`
时帧会回拷，此时 `scale_cuda` 读不到 cuda 帧报
`Impossible to convert between the formats`。见 8.3 节。

### 7.3 Intel QSV 全硬件链路（实测）

```bash
# ① 最简：QSV 硬解直转 HEVC（无滤镜；官方规定 qsv 模式禁滤镜，这正是"无滤镜"形态）
ffmpeg -c:v h264_qsv -i 4k.mp4 -c:v hevc_qsv -preset medium -b:v 2M \
       qsvtranscode.mp4

# ② 带硬件缩放（scale_qsv 是 qsv 模式唯一合法的滤镜形态）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i 4k.mp4 \
       -vf scale_qsv=1280:720 -c:v hevc_qsv -preset medium -b:v 2M \
       qsv_hevc.mp4
#   probe：HEVC Main@L3.1；同链路换 -c:v h264_qsv 得 H.264 High@3.2

# ③ QSV 硬解 + 软件滤镜 + 软编（注意切换成外部解码器写法）
ffmpeg -c:v h264_qsv -i 4k.mp4 \
       -vf "scale=1280:720,subtitles=sub.ass" -c:v libx264 -preset veryfast -b:v 2M \
       qsvdec_x264.mp4
```

### 7.4 混合（回拷）策略：何时选择

| 场景                      | 推荐链路                                                  | 原因                                |
| ------------------------- | --------------------------------------------------------- | ----------------------------------- |
| 4K→1080p 批量转码         | cuda 全链 + nvenc（7.2①）                                 | 最快、CPU 占用最低                  |
| 需要烧录字幕/水印文字     | d3d11va 硬解回拷 + 软滤镜（drawtext/ass）+ nvenc          | 硬件滤镜无文字能力                  |
| 帧率转换（25→50fps 插帧） | cuda 全链 + vpp_qsv 或软件 fps/minterpolate               | 硬链 FRC 仅 QSV/部分平台支持        |
| GIF/短视频截图            | 全程软件（`-i in.mp4 -vf fps=10,scale=480:-1 out.gif`）   | 小负载不值得初始化硬件              |
| 直播低延迟（RTMP）        | nvenc `-tune ull -preset p5 -rc cbr`（见编解码指南 5.15） | CBR+低延迟参数由 nvenc 码控原生支持 |

实测已验证的回拷链路：

```bash
# d3d11va 硬解 + 软件 scale + nvenc 硬编（回拷开销可接受，滤镜任选）
ffmpeg -hwaccel d3d11va -i 4k.mp4 -vf scale=1280:720 \
       -c:v hevc_nvenc -preset p5 -b:v 2M d3d_nv.mp4
```

### 7.5 VAAPI / AMF / VideoToolbox 全链路示例（未实测，官方语法）

```bash
# Linux VAAPI 全链（Intel）：硬解 → tonemap+scale（硬件）→ HEVC main10
ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD129 -filter_hw_device va \
       -hwaccel vaapi -hwaccel_output_format vaapi -i hdr.mp4 \
       -vf "tonemap_vaapi=format=p010,scale_vaapi=3840:2160" \
       -c:v hevc_vaapi -profile main10 -rc_mode CBR -b:v 12M out.mp4

# Windows AMD AMF 全链：d3d11va 硬解 → 保持 d3d11 纹理 → amf 硬编
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
       -c:v h264_amf -usage transcoding -quality balanced -rc CBR -b:v 2M out.mp4

# macOS VideoToolbox：硬解 → 软滤镜（无滤镜族） → HEVC 硬编
ffmpeg -hwaccel videotoolbox -i in.mp4 -vf scale=1280:720 \
       -c:v hevc_videotoolbox -b:v 2M out.mp4
```

### 7.6 软硬编码对比实测（本机数据）

同素材 4K 源、`-t 4` 秒、输出 720p 级：

| 编码器                                         | 耗时       | 输出文件大小 | 备注     |
| ---------------------------------------------- | ---------- | ------------ | -------- |
| libx264 `-preset veryfast -b:v 8M`             | 约 3008 ms | 3.64 MB      | CPU 软件 |
| h264_nvenc `-preset p5 -rc vbr -cq 24 -b:v 8M` | 约 1906 ms | 7.05 MB      | GPU 硬件 |

结论（与官方 HWAccelIntro 的结论一致）：

- 速度：硬件编码快约 **37%**（同 -t 时长下整体转码耗时显著降低，CPU 占用大幅下降）。
- 码率：**同码控设置下 nvenc 输出码率/文件更大约 1.9 倍**——这不是 bug，硬件编码器用等效画质需要更高码率预算（差 20%–40% 是常态；本机此组对比还叠加了 veryfast 档 x264 的码控差异）。
- 实用建议：**画质优先用 x265（软件），时间/功耗优先用硬编并上调 30% 码率预算；直播/实时转码是硬编的主场**。

## 8 常见问题与避坑

### 8.1 `av1_qsv` 编码报 `-22`：硬件不支持

本机 Intel UHD 750（Rocket Lake，11 代）**只有 AV1 解码单元，没有 AV1 编码单元**；`-c:v av1_qsv`
任何参数组合都报 `-22 Invalid argument`。**AV1 QSV 编码需 12 代（Alder
Lake）及以后的核显**（「是否支持」与「构建里有没有编码器」是两回事）。排查方法：

```bash
ffmpeg -encoders | grep qsv        # 构建里有
ffmpeg -h encoder=av1_qsv          # 参数存在
ffmpeg -c:v av1_qsv -i 1s.mp4 -f null -   # 真正跑一次：-22 = 硬件不支持
```

### 8.2 `-hwaccel qsv` 之后接软件滤镜/软编报错

官方明示：**qsv 硬件帧不拷回系统内存，帧在各滤镜间以 QSV 表面传递；任何软件滤镜（scale/crop/drawtext 等）或软件编码器（libx264）都解不出这种帧 →
`-22`**。解法：要么全链 QSV 硬件滤镜（`scale_qsv`），要么改用外部解码器写法
`-c:v h264_qsv -i …`（帧自然回拷，软滤镜随便用）。

### 8.3 `-hwaccel_output_format` 缺失导致 `Impossible to convert between the formats`

只想用 nvenc 硬编、却用
`-hwaccel cuda -i … -c:v h264_nvenc`（忘了第二件套）→ 帧已被拷回内存，nvenc 要求 cuda 帧 → 转换失败。**加
`-hwaccel_output_format cuda` 或干脆 `-vf hwupload_cuda`
手动上传**。同理 d3d11va 链路给 nvenc 喂材时要用 `-hwaccel_output_format d3d11`。

### 8.4 overlay_cuda 格式不匹配：`Can't overlay yuv420p on nv12`

**一路 cuda 帧 + 一路 yuv420p 内存帧直接 overlay_cuda 必失败**。先软解 →
`scale → format=nv12 → hwupload_cuda` → 再 overlay。另外 `hwupload_cuda`
只认 nv12，png 的 alpha 通道会丢（透明区域变黑），需要保留透明度用
`format=yuva420p` + 支持 alpha 的 CUDA 滤镜（大部分 CUDA 滤镜不支持 alpha，实测 overlay 需要 nv12 即丢 alpha）。

### 8.5 CUDA overlay/拼贴链路的 32 像素对齐

实测 1280×720 主视频 + 16:16 logo overlay_cuda 后输出为
**1280×736**（宽度 1280 恰好也是 32 的倍数；高度 720 被抬到 736）。要求精确尺寸的交付（如平台上传规格 1920×1080）**务必在链尾
`scale_cuda=w:h` 或 `pad_cuda=w:h` 收口一次**。

### 8.6 WebM 装不进 H.264/HEVC

`-c:v h264_nvenc out.webm` 报
`Error initializing output stream`。**WebM 只收 VP8/VP9/AV1**。要 WebM 用途的输出，编码器换
`av1_nvenc`（或 vp9_qsv）；反之，MP4/MOV 是 AV1/H.264/HEVC 通用的发布容器，优先 MP4。

### 8.7 硬件解码器不支持某 profile 时静默

- `-hwaccel` 内部硬解：解码器不支持会自动回退软件解（不报错）——排查性能问题时留意。
- 外部解码器（`h264_cuvid`
  等）：**不支持就报错**；码流是高 4:2:2/4:4:4/高码率变体时，先看 6.3 节的世代支持矩阵再决定链路。
- 4:2:2/4:4:4 素材常见于专业录制（如 Sony/佳能以 4:2:2
  10bit 录制）；GeForce 消费级不支持 4:2:2 编解码，可用 4:4:4（NVENC）或回退软件。

### 8.8 硬件编码器的码率/质量怪癖

- **CBR 偏低时文件卡顿**：`-rc cbr -b:v 1M` 但没配
  `-maxrate`/`-bufsize`，nvenc 的 VBV 可能设得过紧，先给 `-bufsize 2M`。
- **QSV 默认回退 CQP**：只写 `-global_quality 30` 没设 `-look_ahead`
  → 是 ICQ 算法而非 CQP，码率可变；要严格 CBR 按 4.3.1 表成套给参数。
- **码率数字是每秒比特**：`-b:v 2M`=2 兆比特/秒（约 250 KB/s），不是 2 MB/s；换算文件大小别拿反。

### 8.9 验证输出硬编码真的用了 GPU

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,profile,level,width,height,bit_rate,pix_fmt -of default=noprint_wrappers=1 out.mp4
# 关注 codec_name=h264/hevc/av1（硬编编码器名不会暴露），真正的验证是转码日志：
ffmpeg -v verbose -hwaccel cuda ... 2>&1 | grep -i "hwaccel\|hardware"
# 以及 -c:v h264_nvenc 报错时一定没走硬编
```

### 8.10 多显卡/多路 GPU 选择

`-init_hw_device cuda=cu:1` 用第二块 NVIDIA；`-hwaccel_device 1` 指定 `-hwaccel cuda`
使用的设备索引。直播/批量转码时把任务分布到多卡，注意 NVENC 并发会话上限（RTX
4070 单卡 12 路并发，见 6.3 节）。

## 9 附录

### 9.1 本机实测数据速查

| 项目                      | 实测结果                                                                     |
| ------------------------- | ---------------------------------------------------------------------------- |
| FFmpeg                    | 9.0.1（gyan full-build，N-126689-gb894a6f7c）                                |
| GPU                       | NVIDIA RTX 4070（Ada，NVENC 8 代、NVDEC 5 代）+ Intel UHD 750（Rocket Lake） |
| `-hwaccels`               | cuda、vaapi、dxva2、qsv、d3d11va、opencl、vulkan、d3d12va、amf               |
| cuda 全链（720p，H.264）  | High@3.1、1280×720、~1.86 Mbps、耗时约 1.9 s/4 s 素材                        |
| hevc_nvenc main10         | Main 10@3.1（8-bit 源自动升位深）                                            |
| 4K 直编 hevc_nvenc        | Main@5.0、8.9 Mbps 目标                                                      |
| QSV 全链（hevc_qsv 720p） | Main@3.1；h264_qsv 同链 High@3.2                                             |
| QSV 硬解软滤              | `-c:v h264_qsv` + scale + libx264 ✅                                         |
| CUDA overlay 输出         | 1280×736（32 对齐），需 chain 尾收口                                         |
| 软硬对比（-t 4 s）        | x264 veryfast 3008 ms/3.64 MB vs nvenc p5 1906 ms/7.05 MB                    |

### 9.2 参考来源

- FFmpeg 文档
  `temp/ffmpeg-docs`：`ffmpeg-cmd.md`（`-hwaccel`/`-hwaccel_output_format`/`-hwaccel_device`/`-init_hw_device`）、`ffmpeg-codecs.md`（4.9
  QSV Decoders、9.31 QSV Encoders、9.33 VAAPI Encoders、9.26
  MediaFoundation）、`ffmpeg-filters.md`（各滤镜条目；本节硬件滤镜参数按本机 `ffmpeg -h filter=`
  输出为准）、`hardware-quicksync-ffmpeg.md`（QSV 官方指南：vpp_qsv/scale_qsv 组合与 dxva2
  hwmap 链路）、`HWAccelIntro-ffmpeg.md`（平台可用性矩阵、帧流转）。
- NVIDIA Video Codec SDK 官方支持矩阵 `support-matrix-nvidia.md`（GeForce/Ada 世代 NVENC
  9 代能力、NVDEC 解码能力、并发会话上限）。
- 实测：本机 FFmpeg 9.0.1 命令 + ffprobe 输出（章节内标注「实测」的命令与数据）。

### 9.3 与系列其它文档的关系

- 码控参数详解（`-rc`/`-cq`/`-multipass`/低延迟）：见《ffmpeg-编解码器参数指南》5.15（NVENC）、5.12（QSV）、5.16（AMF）。
- 硬件滤镜参数全表（scale_cuda/scale_qsv/overlay 等）：见《ffmpeg-滤镜指南》对应滤镜条目。
- `-hwaccel` 必须放在 `-i` 之前等命令行布局细节：见《ffmpeg-其它常用命令行参数指南》5.1。
- 本篇文章为硬件加速与兼容性的专篇，与上述三篇交叉引用、互不冲突。
