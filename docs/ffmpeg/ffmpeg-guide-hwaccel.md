# FFmpeg 硬件加速与质量对比指南

> 版本基准：本文参数以 FFmpeg 官方文档（`temp/ffmpeg-docs` 离线副本：`ffmpeg-all.md`、`hwaccelintro-ffmpeg.md`、`hardware-quicksync-ffmpeg.md`、`hardware-amf-ffmpeg.md`、`support-matrix-nvidia.md`、`SME-2019-FFmpeg-Hardware.pdf`）为准，并用本机 `F:\Temp\ffmpeg\ffmpeg-9-nonfree`（libavcodec 63.14.100）的 `-hwaccels`、`-encoders`、`-filters`、`-h encoder=xxx` 实测核对。
> **重要提示**：硬件加速的**可用性取决于具体 GPU、驱动版本与操作系统**。本文标注了「文档依据」与「本机实测」的区别；本机为 Windows 环境，Linux/macOS 专有部分仅作参数说明，未经本机验证。

---

> 📖 **配套阅读**：《FFmpeg 硬件加速兼容性与全硬件工作流指南》（`ffmpeg-guide-hwaccel-compat.md`）
> —— 涵盖硬件编解码器全清单、平台×codec 支持矩阵、profile/level/pix_fmt 矩阵、码率—体积换算、
> 容器兼容性与 tag 开关、硬解×硬编配对表、兼容性陷阱排查。
> 本文侧重参数与用法，那篇侧重兼容性与选型。

## 目录

1. [硬件加速的分层模型](#1-硬件加速的分层模型)
2. [核心命令行参数](#2-核心命令行参数)
3. [各平台 API 与设备初始化](#3-各平台-api-与设备初始化)
4. [硬件解码](#4-硬件解码)
5. [硬件编码](#5-硬件编码)
6. [硬件滤镜与全 GPU 管线](#6-硬件滤镜与全-gpu-管线)
7. [硬件缩放与画面处理详解](#7-硬件缩放与画面处理详解) ★扩充
8. [硬件帧率变换与变速](#8-硬件帧率变换与变速) ★扩充
9. [质量与性能对比](#9-质量与性能对比)
10. [实测与基准方法](#10-实测与基准方法)
11. [选型建议与常见坑](#11-选型建议与常见坑)
12. [速查表](#12-速查表)
13. [附录 A：硬件加速实战配方集](#附录-a硬件加速实战配方集) ★新增

---

## 1. 硬件加速的分层模型

FFmpeg 的硬件加速不是一个开关，而是**三个可独立启用的层次**：

```
┌─────────────────────────────────────────────────────────┐
│  ① 硬件解码（Decode）                                     │
│     -hwaccel <api>  或  -c:v <codec>_<api>                │
│     把解码从 CPU 移到 GPU                                  │
├─────────────────────────────────────────────────────────┤
│  ② 硬件滤镜（Filtering）                                  │
│     scale_cuda / scale_qsv / scale_vaapi / vpp_qsv ...    │
│     让缩放、去隔行、叠加等也在 GPU 上完成                    │
├─────────────────────────────────────────────────────────┤
│  ③ 硬件编码（Encode）                                     │
│     -c:v h264_nvenc / hevc_qsv / h264_amf / h264_vaapi ...│
│     把编码从 CPU 移到 GPU                                  │
└─────────────────────────────────────────────────────────┘
```

**关键收益与代价：**

| 层次 | 收益 | 代价 |
| --- | --- | --- |
| 硬件解码 | 降低 CPU 占用、省电 | 支持的 profile/位深有限（H.264 通常仅 8bit 4:2:0） |
| 硬件滤镜 | 避免 GPU↔CPU 反复拷贝 | 滤镜种类少、参数少、质量算法较简单 |
| 硬件编码 | 速度提升 5~20×，CPU 几乎空闲 | **同码率下质量低于优秀软件编码器** |

> 官方原话（`hwaccelintro-ffmpeg.md`）：
> 「Hardware encoders typically generate output of significantly lower quality than good software encoders like x264, but are generally faster and do not use much CPU resource.」
> 即：**硬件编码需要更高码率才能达到同等感知质量**。

**三种典型管线：**

```bash
# A. 纯软件（质量最优，速度最慢）
ffmpeg -i in.mp4 -c:v libx264 -crf 20 -c:a copy out.mp4

# B. 硬解 + 软编（折中：省 CPU 解码开销，保留软件编码质量）
ffmpeg -hwaccel cuda -i in.mp4 -c:v libx264 -crf 20 -c:a copy out.mp4

# C. 硬解 + 硬滤镜 + 硬编（最快，质量最低）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=1280:720" -c:v h264_nvenc -preset p5 -cq 23 -c:a copy out.mp4
```

---

## 2. 核心命令行参数

### 2.1 解码相关

| 参数 | 作用域 | 说明 |
| --- | --- | --- |
| `-hwaccel <api>` | 输入，按流 | 启用硬件解码。取值见 §2.4 |
| `-hwaccel_device <dev>` | 输入，按流 | 选择设备；可引用 `-init_hw_device` 创建的名字，或直接写 `type:index` |
| `-hwaccel_output_format <fmt>` | 输入，按流 | **关键**：指定解码后帧的像素格式。设为硬件格式（如 `cuda`）可避免下载到内存 |
| `-hwaccels` | 全局 | 列出本构建支持的硬件加速方法 |
| `-extra_hw_frames N` | 输入 | 额外分配的硬件帧数（AV1 转码等场景必需） |
| `-noauto_conversion_filters` | 全局 | 禁用自动插入格式转换滤镜（强制手工处理 hwupload/hwdownload） |

### 2.2 设备与滤镜绑定

| 参数 | 说明 |
| --- | --- |
| `-init_hw_device type[=name][:device[,key=value...]]` | 初始化硬件设备，可命名后复用 |
| `-init_hw_device type[=name]@source` | 从已有设备派生新设备（如从 vaapi 派生 qsv） |
| `-init_hw_device list` | 列出本构建支持的设备类型 |
| `-filter_hw_device <name>` | 全局指定滤镜图使用的硬件设备（供 `hwupload`/`hwmap` 使用） |

### 2.3 常用硬件格式对应关系

| API | `-hwaccel_output_format` | 编码器后缀 | 典型滤镜后缀 |
| --- | --- | --- | --- |
| CUDA (NVIDIA) | `cuda`（也支持 `d3d11`） | `_nvenc` | `_cuda` |
| QSV (Intel) | `qsv` | `_qsv` | `_qsv` |
| VAAPI (Intel/AMD, Linux) | `vaapi` | `_vaapi` | `_vaapi` |
| AMF (AMD, Windows) | `d3d11` / `dxva2_vld` / `amf` | `_amf` | `_amf` |
| D3D11VA (Windows) | `d3d11` | —（用 `_mf`/`_nvenc`/`_amf`） | `_d3d11` |
| DXVA2 (Windows) | `dxva2_vld` | — | — |
| D3D12VA (Windows) | `d3d12` | — | `_d3d12` |
| VideoToolbox (Apple) | `videotoolbox` | `_videotoolbox` | — |
| Vulkan | `vulkan` | `_vulkan` | `_vulkan` |
| OpenCL | — | — | `_opencl` |
| VDPAU (Linux/NVIDIA) | `vdpau` | — | — |

### 2.4 `-hwaccel` 取值（官方定义）

| 值 | 说明 |
| --- | --- |
| `none` | 不启用（默认） |
| `auto` | 自动选择 |
| `cuda` | NVIDIA CUDA / NVDEC |
| `dxva2` | Windows DirectX Video Acceleration 9 |
| `d3d11va` | Windows Direct3D 11 Video Acceleration |
| `d3d12va` | Windows Direct3D 12 Video Acceleration |
| `qsv` | Intel Quick Sync Video |
| `vaapi` | Linux VA-API |
| `vdpau` | Linux/Unix VDPAU（NVIDIA） |
| `videotoolbox` | Apple Video Toolbox |
| `vulkan` | Vulkan Video |
| `opencl` | OpenCL |
| `amf` | AMD AMF |

> **重要说明（官方原文）**：`-hwaccel qsv` 与其它值不同——它**不启用加速解码**（QSV 解码器被选中时会自动加速），而是启用**加速转码**（帧不拷贝回系统内存）。它要求解码器与编码器都支持 QSV，且**不能使用任何滤镜**。

> **另一条官方警告**：大多数加速方法是为播放设计的，在现代 CPU 上**不会比软件解码更快**；且 ffmpeg 通常仍需把帧从 GPU 内存拷回系统内存，造成额外开销。因此单纯用 `-hwaccel` 而不配合 `-hwaccel_output_format`，收益有限。

```bash
# 查看本机支持
ffmpeg -hwaccels
ffmpeg -init_hw_device list
ffmpeg -encoders | grep -E "nvenc|qsv|vaapi|amf|videotoolbox|vulkan"
ffmpeg -filters  | grep -E "_cuda|_qsv|_vaapi|_amf|_d3d1[12]|_vulkan|_opencl"
```

---

## 3. 各平台 API 与设备初始化

### 3.1 CUDA / NVENC / NVDEC（NVIDIA）

**平台可用性**（`hwaccelintro-ffmpeg.md` 表格）：Linux + Windows 上的 NVIDIA 硬件完全可用。

```bash
# 基本：使用第一块 GPU
ffmpeg -hwaccel cuda -i in.mp4 -c:v h264_nvenc -cq 23 out.mp4

# 指定 GPU 序号
ffmpeg -hwaccel_device 1 -hwaccel cuda -i in.mp4 -c:v h264_nvenc out.mp4

# 用命名设备（多 GPU 场景更清晰）
ffmpeg -init_hw_device cuda:1 -filter_hw_device cuda1 -i in.mp4 ...

# 使用主设备上下文（多进程共享时有用）
ffmpeg -init_hw_device cuda:0,primary_ctx=1 -i in.mp4 ...
```

| 选项 | 说明 |
| --- | --- |
| `-init_hw_device cuda:N` | 选第 N 块 CUDA 设备（从 0 开始） |
| `-init_hw_device cuda:0,primary_ctx=1` | 使用主设备上下文而非新建 |
| `-hwaccel_device N` | 指定解码用的 GPU 序号 |
| NVENC 的 `-gpu N` | 指定编码用的 GPU 序号（`-2` 可列出设备） |

> **CUVID 与 NVDEC 的区别**：`-hwaccel cuda` 走内部 NVDEC 路径（支持软件回退）；`-c:v h264_cuvid` 走独立 CUVID 解码器（**不支持回退**，流不支持会直接失败）。
> ```bash
> ffmpeg -hwaccel cuda -i in.mp4 out.mp4          # NVDEC（可回退）
> ffmpeg -c:v h264_cuvid -i in.mp4 out.mp4        # CUVID（不回退）
> ffmpeg -c:v av1_cuvid -i in_av1.mp4 out.ts      # AV1 解码
> ```

**NVENC 可直接接受 d3d11 帧上下文**：

```bash
ffmpeg -y -hwaccel_output_format d3d11 -hwaccel d3d11va -i in.mp4 -c:v hevc_nvenc out.mp4
```

### 3.2 Intel QSV

**硬件支持演进**（`hardware-quicksync-ffmpeg.md`）：

| 平台 | 代际 | 新增支持 |
| --- | --- | --- |
| Sandy Bridge | gen6 | H.264 编码 |
| Ivy Bridge | gen7 | JPEG 解码、MPEG-2 编码 |
| Broadwell | gen8 | VP8 解码 |
| Braswell | gen8 | H.265 解码、JPEG/VP8 编码 |
| Skylake | gen9 | H.265 编码 |
| Apollo Lake | gen9 | VP9、H.265 Main10 解码 |
| Kaby Lake | gen9.5 | VP9 profile2 解码、VP9/H.265 Main10 编码 |
| Ice Lake | gen11 | H.265 8bit 4:2:2/4:4:4 编解码、VP9 8/10bit 4:4:4 |
| Tiger Lake | gen12 | AV1 8/10bit、H.265 12bit 解码 |
| DG2 (Arc) | gen12 | **AV1 编码** |

**API 选择：** `libvpl`（OneVPL，MSDK 后继者）、`libmfx`（旧 Intel Media SDK）、VAAPI with iHD driver、DXVA2/D3D11VA（仅解码）。

```bash
# 方式一：直接使用 qsv 解码（推荐，自动选择子设备）
ffmpeg -hwaccel qsv -i in.mp4 -c:v h264_qsv -global_quality 25 out.mp4

# 方式二：显式创建 QSV 设备（Windows 用 d3d11va 子设备）
ffmpeg -init_hw_device qsv=hw,child_device_type=d3d11va -filter_hw_device hw \
       -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 -c:v hevc_qsv out.mp4

# 方式三：从 VAAPI 设备派生（Linux）
ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD129 -init_hw_device qsv=hw1@va ...

# 指定硬件实现模式（MFX_IMPL_*）
ffmpeg -init_hw_device qsv:hw,child_device=1 -i in.mp4 ...
```

**`-init_hw_device qsv:` 的 device 取值：** `auto` `sw` `hw` `auto_any`(默认) `hw_any` `hw2` `hw3` `hw4`

**QSV 设备选项：** `child_device`（Linux DRM 节点 / Windows DX 适配器索引）、`child_device_type`（Windows 默认 `d3d11va`（libvpl）或 `dxva2`（libmfx）；Linux 仅 `vaapi`）

### 3.3 AMD AMF（Windows）

```bash
# DX9 硬件解码（不支持 AV1 基本流）
ffmpeg -hwaccel dxva2 -i in.mkv out.yuv

# DX11 硬件解码（推荐）
ffmpeg -hwaccel d3d11va -i in.mkv out.yuv

# AMF 原生解码
ffmpeg -hwaccel amf -i in.mp4 -c:v h264 out.yuv

# AMF 编码
ffmpeg -i in.yuv -c:v h264_amf out.mp4
ffmpeg -i in.yuv -c:v hevc_amf out.mp4
ffmpeg -i in.yuv -c:v av1_amf out.mp4

# 推荐转码配置：避免 GPU↔CPU 拷贝
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mkv -c:v hevc_amf out.mp4
ffmpeg -hwaccel dxva2 -hwaccel_output_format dxva2_vld -i in.mkv -c:v av1_amf out.mp4
```

> **官方明确推荐**：转码时用 `-hwaccel_output_format dxva2_vld`（DX9）或 `-hwaccel_output_format d3d11`（DX11），可大幅提升速度——这是官方推荐的**最佳设置**。

> **AV1 源转码需加 `-extra_hw_frames`**：
> ```bash
> ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -extra_hw_frames 10 -i in_av1.mkv -c:v hevc_amf out.mp4
> ```

**AMF 支持的容器**（官方表格）：MKV/MP4 全支持 H.264/HEVC/AV1；AVI 不支持 HEVC；TS 不支持 AV1 解码；WebM 仅 AV1。

### 3.4 VAAPI（Linux 为主，Windows 也可）

```bash
# 基本用法（指定 DRM 渲染节点）
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
       -hwaccel_output_format vaapi -i in.mp4 -c:v h264_vaapi out.mp4

# 按内核驱动选择设备
ffmpeg -init_hw_device vaapi:,kernel_driver=i915 -filter_hw_device vaapi0 ...

# 按厂商 ID 选择设备（0x8086 = Intel，0x1002 = AMD）
ffmpeg -init_hw_device vaapi:,vendor_id=0x8086 ...
```

**可用渲染节点查看**：`ls /dev/dri/`

### 3.5 VideoToolbox（macOS）

```bash
ffmpeg -i in.mp4 -c:v h264_videotoolbox -b:v 4M -c:a copy out.mp4
ffmpeg -i in.mp4 -c:v hevc_videotoolbox -b:v 2M -tag:v hvc1 -c:a copy out.mp4
```

### 3.6 Vulkan（跨厂商）

```bash
# 按索引或名称子串选择设备
ffmpeg -init_hw_device vulkan:1 ...
ffmpeg -init_hw_device vulkan:RADV ...

# 设备选项
ffmpeg -init_hw_device vulkan:0,debug=1,linear_images=1,device_extensions=VK_KHR_...
```

| 选项 | 说明 |
| --- | --- |
| `debug=1` | 启用校验层（若已安装） |
| `linear_images=1` | 分配线性、可本地映射的图像 |
| `instance_extensions` | `+` 分隔的额外实例扩展 |
| `device_extensions` | `+` 分隔的额外设备扩展 |

### 3.7 OpenCL

```bash
ffmpeg -init_hw_device opencl:0.1 ...                    # 平台 0、设备 1
ffmpeg -init_hw_device opencl:,device_name=Foo9000 ...   # 按名称匹配
ffmpeg -init_hw_device opencl:1,device_type=gpu,device_extensions=cl_khr_fp16 ...
```

---

## 4. 硬件解码

### 4.1 内部 hwaccel 解码 vs 独立解码器

| 方式 | 写法 | 特点 |
| --- | --- | --- |
| **内部 hwaccel** | `-hwaccel cuda` | 软件解码器正常启动；检测到可硬解时委托给硬件；**不支持时自动回退软件** |
| **独立包装解码器** | `-c:v h264_cuvid` | 命名规则 `codec_api`；**要求预先知道编码格式，不支持任何回退** |

```bash
# 内部（推荐，安全）
ffmpeg -hwaccel cuda -i in.mp4 -c:v h264 -f null -

# 独立（性能可能更好，但无回退）
ffmpeg -c:v h264_cuvid -i in.mp4 -c:v h264 -f null -
```

### 4.2 避免 GPU↔CPU 拷贝（关键优化）

**只写 `-hwaccel` 而不写 `-hwaccel_output_format`，帧会被下载到系统内存**，这是最常见的性能陷阱。

```bash
# ✗ 慢：解码在 GPU，但帧被拷回 CPU，再传给 CPU 编码器
ffmpeg -hwaccel cuda -i in.mp4 -c:v libx264 -crf 20 out.mp4

# ✓ 快：帧保持在 GPU 内存，直接进硬件编码器
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 -c:v h264_nvenc -cq 23 out.mp4
```

### 4.3 各 API 的硬件解码支持

| API | 支持的解码格式 |
| --- | --- |
| NVDEC/CUVID | H.264、HEVC、MJPEG、MPEG-1/2/4、VP8/VP9、VC-1、AV1（随硬件代际变化；Pascal 起支持 VP9 与 10bit） |
| QSV | MPEG-2、H.264、HEVC、VP8/VP9、AV1、JPEG（随代际变化，见 §3.2） |
| AMF | H.264、HEVC、AV1（容器支持见 §3.3 表） |
| VAAPI | H.264、HEVC、VP8/VP9、MPEG-2、AV1（随驱动与硬件） |
| D3D11VA / DXVA2 | H.264、HEVC、VP9、AV1、MPEG-2、VC-1 |
| VideoToolbox | H.264、HEVC、ProRes、VP9（部分） |
| VDPAU | H.264、MPEG-1/2/4、VC-1、AV1 |

---

## 5. 硬件编码

> 各编码器完整参数详见《FFmpeg 编码器参数与质量控制调优指南》§9。本节聚焦硬件特有的用法要点。

### 5.1 NVENC 要点

| 关键点 | 说明 |
| --- | --- |
| `-cq` 需配 `-rc vbr` | `-cq` 是 VBR 模式下的目标质量；单独使用行为可能不一致 |
| 预设改名 | 新版用 `p1`~`p7`（`p1` 最快，`p7` 最好）；旧名 `fast`/`medium`/`slow` 仍兼容 |
| `-tune lossless` | H.264/HEVC 均支持无损 |
| 像素格式限制 | 报 `No NVENC capable devices found` 时通常是像素格式不受支持 |
| 10bit | `-highbitdepth 1` 可用 8bit 输入产出 10bit；或直接 `-pix_fmt p010le` |
| 并发会话数 | 消费级显卡有并发限制（近期驱动为 8 路以上，专业卡不限制） |

```bash
# HEVC 归档（推荐）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 26 -b:v 0 \
  -spatial-aq 1 -temporal-aq 1 -c:a copy out.mp4

# H.264 兼容输出（Apple 生态加 hvc1 标签）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -c:v hevc_nvenc -preset p5 -cq 28 -tag:v hvc1 -c:a copy out.mp4

# 低延迟直播
ffmpeg -i in.mp4 -c:v h264_nvenc -preset p4 -tune ll -rc cbr \
  -b:v 6M -maxrate 6M -bufsize 12M -zerolatency 1 -g 50 -bf 0 \
  -c:a aac -b:a 160k -f flv rtmp://...
```

### 5.2 QSV 要点

| 关键点 | 说明 |
| --- | --- |
| 码率控制选择 | `-global_quality` → ICQ/LA_ICQ/CQP；`-b:v` → VBR/CBR/AVBR/LA；都不写 → CQP |
| 质量范围 | ICQ 模式 `global_quality` 为 **1~51，1 最好**（与 x264 CRF 方向一致） |
| 实际模式可能不同 | 官方提示：编码器可能选择与指定不同的模式，用 `-v verbose` 查看实际设置 |
| `-look_ahead` | 启用 LA/LA_ICQ，提升质量但增加延迟 |
| `-scenario` | 场景提示可显著影响码率分配策略 |
| HyperEncode | `-dual_gfx on/adaptive` 可同时用 iGPU + dGPU 编码 |

```bash
# ICQ 质量模式
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -c:v hevc_qsv -preset slow -global_quality 24 -c:a copy out.mp4

# 归档场景 + 前瞻
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -c:v h264_qsv -preset slower -global_quality 23 \
  -look_ahead 1 -look_ahead_depth 40 -scenario archive -c:a copy out.mp4
```

### 5.3 AMF 要点

| 关键点 | 说明 |
| --- | --- |
| `-usage` | 场景选择：`transcoding` / `ultralowlatency` / `lowlatency` / `webcam` / `high_quality` / `lowlatency_high_quality` |
| `-quality` | `speed` / `balanced` / `quality` / `high_quality` |
| `-rc` | `cqp` / `cbr` / `vbr_peak` / `vbr_latency` |
| `-preanalysis` | 预分析可提升质量 |
| `-vbaq` | 自适应量化 |

```bash
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -c:v hevc_amf -usage transcoding -quality quality -rc vbr_peak \
  -b:v 6M -maxrate 9M -bufsize 12M -c:a copy out.mp4
```

### 5.4 VAAPI 要点

| 关键点 | 说明 |
| --- | --- |
| 只接受 VAAPI 硬件表面 | 软件帧需先 `hwupload` |
| `-rc_mode` | `auto` / `CQP` / `CBR` / `VBR` / `ICQ` / `QVBR` / `AVBR` |
| `-qp` | CQP 模式的 P 帧 QP（I/B 由 qfactor/qoffset 缩放） |
| `-compression_level` | 越大越快越差 |
| `-quality` | 越大越快 |
| `-low_power` | 部分平台有低功耗编码器，但功能集可能减少 |

```bash
# CQP
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
  -c:v h264_vaapi -rc_mode CQP -qp 24 -c:a copy out.mp4

# ICQ
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
  -c:v hevc_vaapi -rc_mode ICQ -global_quality 25 -c:a copy out.mp4
```

### 5.5 MediaFoundation（Windows）

```bash
ffmpeg -i in.mp4 -c:v h264_mf -hw_encoding 1 -rate_control quality -quality 80 out.mp4

# 硬解 + 硬缩放 + 硬编
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -vf scale_d3d11=1920:1080 -c:v hevc_mf -hw_encoding 1 -quality 80 out.mp4
```

---

## 6. 硬件滤镜与全 GPU 管线

### 6.1 帧在内存与显存之间的搬运

| 滤镜 | 作用 |
| --- | --- |
| `hwupload` | 系统内存帧 → 硬件表面（需 `-filter_hw_device` 或 `derive_device`） |
| `hwdownload` | 硬件帧 → 系统内存帧 |
| `hwmap` | 硬件帧 ↔ 系统内存或另一设备之间映射 |
| `hwupload_cuda` | 系统帧 → CUDA 设备（可带 `device=N`） |

**`hwmap` 的 `mode` 选项：** `read`、`write`、`overwrite`（不读原内容，可能更快）、`direct`（不允许拷贝）。默认 `read+write`。
另有两个选项：`derive_device type`（从输入设备派生新设备）、`reverse`（反向映射，**危险，慎用**）。

> **要点**：如果输入已经是硬件帧（用了 `-hwaccel` 或 `-hwaccel_output_format`），**不需要**再 `hwupload`——数据已在合适的显存空间。

### 6.2 各平台硬件滤镜清单（本机实测 `ffmpeg -filters`）

**CUDA：**

| 滤镜 | 用途 |
| --- | --- |
| `scale_cuda` | 缩放 + 像素格式转换 |
| `overlay_cuda` | 叠加（支持 timeline） |
| `yadif_cuda` / `bwdif_cuda` | 去隔行（支持 timeline） |
| `thumbnail_cuda` | 选代表帧 |
| `transpose_cuda` | 转置/旋转 |
| `pad_cuda` | 加边 |
| `bilateral_cuda` | 双边滤波 |
| `chromakey_cuda` | 色键抠像 |
| `colorspace_cuda` | 色彩空间转换 |
| `hwupload_cuda` | 上传到 CUDA |

**QSV：**

| 滤镜 | 用途 |
| --- | --- |
| `scale_qsv` | 缩放与格式转换 |
| `vpp_qsv` | 视频后处理（VPP） |
| `overlay_qsv` | 叠加 |
| `deinterlace_qsv` | 去隔行 |
| `hstack_qsv` / `vstack_qsv` / `xstack_qsv` | 多画面 |

**VAAPI：**

| 滤镜 | 用途 |
| --- | --- |
| `scale_vaapi` | 缩放 |
| `overlay_vaapi` | 叠加 |
| `tonemap_vaapi` | HDR→SDR 色调映射 |
| `deinterlace_vaapi` | 去隔行 |
| `denoise_vaapi` | 降噪 |
| `sharpness_vaapi` / `procamp_vaapi` | 锐化 / 色度亮度对比度调整 |
| `transpose_vaapi` | 转置 |
| `pad_vaapi` / `drawbox_vaapi` | 加边 / 画框 |
| `hstack_vaapi` / `vstack_vaapi` / `xstack_vaapi` | 多画面 |

**AMF：**

| 滤镜 | 用途 |
| --- | --- |
| `vpp_amf` | 缩放与格式转换 |
| `sr_amf` | 超分辨率放大 |
| `frc_amf` | 帧率转换 |
| `vqe_amf` | 画质增强 |
| `vsrc_amf` | 屏幕采集源 |

**D3D11 / D3D12：**

| 滤镜 | 用途 |
| --- | --- |
| `scale_d3d11` / `scale_d3d12` | 缩放 |
| `deinterlace_d3d12` | 去隔行 |
| `mestimate_d3d12` | 运动估计 |

**Vulkan（跨厂商，本机构建已启用）：**

| 滤镜 | 用途 |
| --- | --- |
| `scale_vulkan` | 缩放 |
| `overlay_vulkan` / `blend_vulkan` | 叠加 / 混合 |
| `gblur_vulkan` / `avgblur_vulkan` | 模糊 |
| `bwdif_vulkan` / `interlace_vulkan` | 去隔行 / 隔行 |
| `nlmeans_vulkan` | 降噪 |
| `xfade_vulkan` | 交叉转场 |
| `transpose_vulkan` / `flip_vulkan` / `hflip_vulkan` / `vflip_vulkan` | 几何变换 |
| `fruc_vulkan` | 光流帧率上变换 |
| `scdet_vulkan` / `blackdetect_vulkan` | 场景/黑场检测 |
| `v360_vulkan` | 360 度投影 |
| `color_vulkan` | 纯色源 |

**OpenCL：**

| 滤镜 | 用途 |
| --- | --- |
| `tonemap_opencl` | HDR→SDR |
| `nlmeans_opencl` | 降噪 |
| `unsharp_opencl` / `convolution_opencl` | 锐化 / 卷积 |
| `overlay_opencl` / `pad_opencl` / `transpose_opencl` | 叠加 / 加边 / 转置 |
| `deshake_opencl` / `xfade_opencl` | 去抖 / 转场 |
| `avgblur_opencl` / `boxblur_opencl` | 模糊 |
| `program_opencl` | 自定义 OpenCL 程序 |

**libplacebo（GPU 通用）：** `libplacebo` 提供高质量色调映射、色彩管理、去隔行、缩放等。

### 6.3 `scale_cuda` 参数详解

| 选项 | 说明 |
| --- | --- |
| `w`, `h` | 输出尺寸表达式（同 `scale`） |
| `interp_algo` | `nearest` / `bilinear` / `bicubic`(默认) / `lanczos` |
| `format` | 输出像素格式（**不支持 YUV↔RGB 互转**） |
| `passthrough` | 0 = 每帧都处理（可作解码器帧池缓冲）；1 = 匹配则直通（默认） |
| `use_filters` | 1 = 用通用权重 LUT（抗锯齿更好）；`auto`(默认) / 0 = 传统 4-tap Lanczos |
| `param` | bicubic 影响滤波曲线；lanczos 设置半径 1~10（默认 3） |
| `force_original_aspect_ratio` / `force_divisible_by` | 同 `scale` |
| `reset_sar` | 同 `scale` |

```bash
# 缩到 720p 并转 yuv420p
-vf "scale_cuda=-2:720:format=yuv420p"

# 4K 放大用最近邻
-vf "scale_cuda=4096:2160:interp_algo=nearest"

# 不转换只拷贝（解决解码器帧池耗尽）
-vf "scale_cuda=passthrough=0"
```

### 6.4 全 GPU 管线示例

```bash
# NVIDIA：硬解 → 硬缩放 → 硬编（数据全程留在显存）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mkv \
  -noautoscale -filter_complex "[0:0]scale_cuda=1280:-2[out]" -map "[out]" \
  -c:v hevc_nvenc -cq 28 -c:a copy out.mp4

# NVIDIA：按高度缩放
ffmpeg -hwaccel_device 0 -hwaccel cuda -hwaccel_output_format cuda -i in.mkv \
  -vf "scale_cuda=-1:720" -c:v h264_nvenc -preset slow out.mkv

# NVIDIA：硬解 → 硬去隔行 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.ts \
  -vf "yadif_cuda" -c:v h264_nvenc -cq 22 out.mp4

# QSV：全硬管线
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "vpp_qsv=w=1280:h=720" -c:v hevc_qsv -global_quality 25 out.mp4

# VAAPI：全硬管线
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi -i in.mp4 \
  -vf "scale_vaapi=w=1280:h=720" -c:v h264_vaapi -qp 23 out.mp4

# VAAPI：HDR→SDR 硬色调映射
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i hdr.mp4 \
  -vf "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,hwdownload,format=nv12" \
  -c:v h264_vaapi -qp 23 out.mp4

# AMF：全硬管线（官方推荐配置）
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mkv \
  -c:v hevc_amf -quality quality -rc vbr_peak -b:v 6M out.mp4
```

### 6.5 混合管线：GPU 解码 + CPU 滤镜 + GPU 编码

> 📖 字幕烧录属于 CPU 侧（libass 渲染），无法在纯 GPU 管线内完成。
> 字幕的完整处理（提取/转换/封装/样式/时间轴）见《FFmpeg 字幕处理完全指南》
> （`ffmpeg-guide-subtitles.md`）。

当需要的滤镜没有硬件版本时，必须把帧下载到内存，处理后再上传：

```bash
# 水印叠加（overlay 无 CUDA 硬件版时）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 -i logo.png \
  -filter_complex "[0:v]hwdownload,format=nv12[base];[base][1:v]overlay=10:10[out];[out]hwupload_cuda" \
  -map "[out]" -map 0:a -c:v h264_nvenc -preset p4 -cq 23 -c:a copy out_watermarked.mp4
```

> 这种「下载—处理—上传」的往返会抵消部分硬件加速收益。若该类滤镜用量大，建议评估是否直接用软件编码路径。

### 6.6 多路输出（HLS ABR）硬件编码

```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -map 0:v -map 0:a -map 0:v -map 0:a -map 0:v -map 0:a \
  -c:v:0 h264_nvenc -preset p4 -b:v:0 5M \
  -c:v:1 h264_nvenc -preset p4 -b:v:1 2M \
  -c:v:2 h264_nvenc -preset p4 -b:v:2 800k \
  -c:a aac -b:a 128k \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  -master_pl_name master.m3u8 \
  -f hls -hls_time 6 -hls_list_size 0 \
  -hls_segment_filename "stream_%v/seg_%03d.ts" \
  stream_%v/index.m3u8
```

---

## 7. 硬件缩放与画面处理详解

> 本章所有参数来自本机 `ffmpeg -h filter=<name>` 实测输出，可直接复制使用。

### 7.1 软件 `scale` 完整参数（含色彩管理）

`scale` 不只是缩放，它同时是**色彩空间转换器**。完整参数（本机实测）：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `w` / `width` | 输入宽 | 输出宽表达式（支持 timeline 命令） |
| `h` / `height` | 输入高 | 输出高表达式 |
| `size` / `s` | — | 尺寸简写，如 `size=1280x720` |
| `flags` | `""` | libswscale 算法标志（见 §7.2） |
| `interl` | false | 输入是隔行 |
| `in_color_matrix` | auto | 输入 YCbCr 类型：`auto` `bt601` `bt709` `bt2020` `bt2020nc` `smpte240m` `fcc` `bt470bg` |
| `out_color_matrix` | auto | 输出 YCbCr 类型 |
| `in_range` / `out_range` | auto | 色域范围：`auto` `limited`(`tv`/`mpeg`) `full`(`pc`/`jpeg`) |
| `in_chroma_loc` / `out_chroma_loc` | auto | 色度采样位置：`left` `center` `topleft` `top` `bottomleft` `bottom` |
| `in_primaries` / `out_primaries` | auto | 基色：`bt709` `bt470m` `bt470bg` `smpte170m` `smpte240m` `film` `bt2020` `smpte428` `smpte431` `smpte432` `jedec-p22` |
| `in_trc` / `out_trc` | auto | 传输特性（gamma 曲线） |

**色域范围转换（最常见的画质问题来源）：**

```bash
# TV 范围 (16-235) → PC 范围 (0-255)，修复「发灰」
ffmpeg -i in.mp4 -vf "scale=in_range=limited:out_range=full" -c:v libx264 -crf 20 out.mp4

# PC 范围 → TV 范围，修复「死黑/过曝」
ffmpeg -i in.mp4 -vf "scale=in_range=full:out_range=limited" -c:v libx264 -crf 20 out.mp4

# 明确标记色彩矩阵（避免播放器猜错导致偏色）
ffmpeg -i in.mp4 -vf "scale=in_color_matrix=bt709:out_color_matrix=bt709" -c:v libx264 -crf 20 out.mp4
```

### 7.2 缩放算法（scaler）完整对比与选型

新版用 `scaler=` 指定算法（`sws_flags` 已标记 deprecated 但兼容）。来自 `ffmpeg-scaler.md`：

| 算法 | 说明 | 可调参数 |
| --- | --- | --- |
| `auto` | 自动（默认，等同 `sws_flags` 所选） | — |
| `bilinear` | 双线性（三角滤波） | — |
| `bicubic` | 2-tap 三次 B 样条（Mitchell-Netravali） | `param0`(B, 默认 0.0)、`param1`(C, 默认 0.6) |
| `point` / `neighbor` | 最近邻 | — |
| `area` | 区域平均（放大时等同 bilinear） | — |
| `gaussian` | 2-tap 高斯近似 | `param0`（锐度，默认 3.0） |
| `sinc` | 无窗 sinc | — |
| `lanczos` | Lanczos（加窗 sinc） | `param0`（tap 数，默认 3） |
| `spline` | 无窗自然三次样条 | — |

**选型决策：**

| 场景 | 推荐算法 | 理由 |
| --- | --- | --- |
| **大幅缩小**（如 4K→1080p） | `area` 或 `lanczos` | `area` 抗锯齿最好；`lanczos` 更锐 |
| **小幅缩小** | `lanczos` | 保留细节 |
| **放大**（如 720p→1080p） | `lanczos` 或 `bicubic` | `lanczos` 锐但有振铃 |
| **像素画/游戏素材** | `neighbor` | 保持硬边缘 |
| **快速预览** | `bilinear` | 最快 |
| **通用默认** | `bicubic` | 平衡 |
| **需要最锐利** | `lanczos` + `param0=4` 或更高 | tap 越多越锐（也越慢） |

**`flags` 中的附加开关（可与算法组合，用 `+` 连接）：**

| 标志 | 作用 |
| --- | --- |
| `accurate_rnd` | 精确舍入（提高精度，稍慢） |
| `full_chroma_int` | 完整色度插值 |
| `full_chroma_inp` | 完整色度输入 |
| `bitexact` | 输出可复现（测试用） |
| `print_info` | 打印调试信息 |

```bash
# 高质量缩小（推荐：lanczos + 精确舍入 + 完整色度）
ffmpeg -i in.mp4 -vf "scale=1920:1080:flags=lanczos+accurate_rnd+full_chroma_int" \
  -c:v libx264 -crf 20 -c:a copy out.mp4

# 大幅缩小用 area
ffmpeg -i 4k.mp4 -vf "scale=1280:720:flags=area" -c:v libx264 -crf 22 out.mp4

# 新版 scaler= 写法
ffmpeg -i in.mp4 -vf "scale=1280:720:scaler=lanczos" -c:v libx264 -crf 22 out.mp4

# lanczos 提高 tap 数（更锐）
ffmpeg -i in.mp4 -vf "scale=1920:1080:scaler=lanczos:param0=4" -c:v libx264 -crf 20 out.mp4

# 全图 sws_flags 写法（影响所有自动插入的 scale）
ffmpeg -i in.mp4 -vf "sws_flags=lanczos;scale=1280:720" -c:v libx264 -crf 22 out.mp4
```

**抖动（dithering）**——缩放到低位深时使用：

| 取值 | 说明 |
| --- | --- |
| `auto` | 自动（默认） |
| `none` | 不抖动 |
| `bayer` | 有序抖动，快，有图案感 |
| `ed` | 误差扩散，质量好 |
| `a_dither` | 算术抖动（加法） |
| `x_dither` | 算术抖动（异或），图案感更弱 |

```bash
# 10bit → 8bit 缩放并加误差扩散抖动，减少色带
ffmpeg -i in10bit.mkv -vf "scale=1920:1080:sws_dither=ed" -pix_fmt yuv420p -c:v libx264 -crf 20 out.mp4
```

**alpha 混合**（输入有 alpha 而输出没有时）：`none`（默认）/ `uniform_color`（混合到纯色）/ `checkerboard`（棋盘格）

### 7.3 缩放尺寸表达式系统（完整）

`scale`/`crop`/`pad` 等共享一套表达式常量与函数：

| 常量 | 含义 |
| --- | --- |
| `in_w` / `iw` | 输入宽 |
| `in_h` / `ih` | 输入高 |
| `out_w` / `ow` | 输出宽 |
| `out_h` / `oh` | 输出高 |
| `a` | 输入宽高比（`iw/ih`） |
| `sar` | 样本宽高比 |
| `dar` | 显示宽高比（`iw/ih*sar`） |
| `hsub` / `vsub` | 水平/垂直色度抽样（yuv422p 为 2/1） |
| `n` | 帧序号 |
| `t` | 时间戳（秒） |

| 函数 | 用途 |
| --- | --- |
| `trunc(x)` | 向零取整 |
| `ceil(x)` / `floor(x)` | 上/下取整 |
| `round(x)` | 四舍五入 |
| `min(x,y)` / `max(x,y)` | 最小/最大 |
| `sqrt(x)` / `hypot(x,y)` / `abs(x)` | 平方根 / 斜边 / 绝对值 |
| `if(c,a,b)` | 条件 |
| `lt/gt/eq/...` | 比较 |
| `mod(x,y)` | 取模 |

```bash
# 常用尺寸写法速查
-vf "scale=1280:-2"                                    # 定宽，高按比例且为偶数
-vf "scale=-2:720"                                     # 定高
-vf "scale=iw/2:ih/2"                                  # 缩到一半
-vf "scale=iw*1.5:ih*1.5"                              # 放大 1.5 倍
-vf "scale=trunc(iw/2)*2:trunc(ih/2)*2"                # 只保证偶数（不改尺寸）
-vf "scale=1920:1080:force_original_aspect_ratio=decrease"      # 等比装进画布
-vf "scale=1920:1080:force_original_aspect_ratio=increase"      # 等比填满画布
-vf "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2"
-vf "scale=w='min(1920,iw)':h=-2"                            # 不超过 1920 宽
-vf "scale=w='if(gt(a,1),1920,-2)':h='if(gt(a,1),-2,1080)'"     # 按横竖屏分别处理
```

**横竖屏自适应（短视频场景必备）：**

```bash
# 横屏缩到 1920x1080、竖屏缩到 1080x1920，统一装进 1920x1920 画布居中
ffmpeg -i in.mp4 -vf "\
scale=w='if(gt(a,1),1920,1080)':h='if(gt(a,1),1080,1920)':force_original_aspect_ratio=decrease,\
pad=1920:1920:(ow-iw)/2:(oh-ih)/2:black,\
setsar=1" -c:v libx264 -crf 22 out.mp4
```

### 7.4 色度采样与位深处理

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

# 10bit → 8bit（带抖动）
ffmpeg -i in10bit.mkv -vf "scale=1920:1080:sws_dither=ed,format=yuv420p" -c:v libx264 -crf 20 out8bit.mp4

# 4:2:0 → 4:4:4（色彩精度提升，注意体积）
ffmpeg -i in.mp4 -vf "scale=1920:1080,format=yuv444p" -c:v libx264 -crf 18 -profile:v high444 out.mp4

# 色度位置修正（某些采集卡需要）
ffmpeg -i in.mp4 -vf "scale=1920:1080:in_chroma_loc=left:out_chroma_loc=left" -c:v libx264 -crf 20 out.mp4
```

### 7.5 硬件缩放滤镜逐参数对照

**各平台 `scale_*` 滤镜参数（本机实测）：**

| 参数 | `scale_cuda` | `scale_qsv` | `scale_vaapi` | `scale_d3d11` | `scale_vulkan` | `vpp_amf` |
| --- | --- | --- | --- | --- | --- | --- |
| 宽 | `w` | `w` | `w` | `width` | `w` | `w` |
| 高 | `h` | `h` | `h` | `height` | `h` | `h` |
| 格式 | `format` | `format` | `format` | `format` | `format` | `format` |
| 算法 | `interp_algo` | `mode` | `mode` | — | `scaler` | `scale_type` |
| 保比 | `force_original_aspect_ratio` | — | `force_original_aspect_ratio` | — | — | — |
| SAR | `reset_sar` | — | `reset_sar` | — | — | — |

**算法取值对照：**

| 滤镜 | 参数 | 可选值 |
| --- | --- | --- |
| `scale_cuda` | `interp_algo` | `nearest`(1) `bilinear`(2) `bicubic`(3，默认) `lanczos`(4) |
| `scale_qsv` | `mode` | `auto`(0，默认) `low_power`(1) `hq`(2) `compute`(3) `vd`(4) `ve`(5) |
| `scale_vaapi` | `mode` | `default`(0) `fast`(256) `hq`(512，默认) `nl_anamorphic`(768) |
| `scale_vulkan` | `scaler` | 0~2（`bilinear` 为默认 0） |
| `vpp_amf` | `scale_type` | `bilinear`(0，默认) / 1 |

**`scale_cuda` 专属参数：**

| 参数 | 说明 |
| --- | --- |
| `passthrough` | 1（默认）= 参数匹配时直通不处理；0 = 每帧都处理（可解决解码器帧池耗尽） |
| `use_filters` | `auto`(-1，默认) / 1 = 通用权重 LUT（下采样抗锯齿、高质量 Lanczos 需要）；0 = 传统 4-tap Lanczos |
| `param` | bicubic 影响滤波曲线；lanczos 设半径 1~10（默认 3），仅 `use_filters` 非 0 时生效 |

**`scale_vaapi` 专属参数：**

| 参数 | 说明 |
| --- | --- |
| `out_color_matrix` | 输出色彩矩阵 |
| `out_range` | 输出色域范围：`full`(2) / `limited`(1) |
| `out_color_primaries` / `out_color_transfer` | 输出基色 / 传输特性 |
| `out_chroma_location` | 输出色度采样位置 |
| `force_divisible_by` | 保证输出尺寸被 N 整除（1~256） |

```bash
# CUDA：Lanczos 高质量缩放 + 10bit 输出
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=1920:1080:interp_algo=lanczos:format=p010le:use_filters=1:param=4" \
  -c:v hevc_nvenc -preset p6 -cq 24 -c:a copy out.mp4

# CUDA：解决「解码器帧池耗尽」（大量滤镜链后接编码器时）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=passthrough=0" -c:v h264_nvenc -cq 23 out.mp4

# QSV：高质量缩放
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "scale_qsv=1920:1080:mode=hq" -c:v hevc_qsv -global_quality 24 out.mp4

# VAAPI：高质量缩放 + 色域标记
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi -i in.mp4 \
  -vf "scale_vaapi=w=1920:h=1080:mode=hq:out_range=limited:out_color_matrix=bt709" \
  -c:v h264_vaapi -rc_mode ICQ -global_quality 24 out.mp4

# D3D11：硬解 + 硬缩放 + 硬编
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -vf "scale_d3d11=1920:1080" -c:v h264_mf -hw_encoding 1 out.mp4

# Vulkan：跨厂商
ffmpeg -init_hw_device vulkan -i in.mp4 \
  -vf "hwupload,scale_vulkan=1920:1080:scaler=bicubic,hwdownload,format=nv12" \
  -c:v libx264 -crf 20 out.mp4
```

### 7.6 QSV `vpp_qsv` —— 一体化硬件图像处理

`vpp_qsv` 是 QSV 平台最强大的滤镜，**一次调用可完成缩放 + 裁剪 + 去隔行 + 降噪 + 细节增强 + 色彩调整 + 转置 + 色调映射 + 帧率变换**（本机实测参数）：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `w` / `width` | `cw`（裁剪后宽） | 输出宽（`0`=输入宽，`-1`=保持比例） |
| `h` / `height` | `w*ch/cw` | 输出高 |
| `format` | `same` | 输出像素格式 |
| `cw` / `ch` | `iw` / `ih` | **裁剪**区域宽高 |
| `cx` / `cy` | 居中 | **裁剪**起始位置 |
| `deinterlace` | 0 | 去隔行：`off`(0) `bob`(1) `advanced`(2) |
| `rate` | `frame` | 去隔行输出速率：`frame`(帧率) / `field`(场率) |
| `denoise` | 0 | 降噪强度 0~100 |
| `detail` | 0 | 细节增强 0~100 |
| `framerate` | 0/1 | **输出帧率**（有理数，如 `30/1`） |
| `procamp` | 0 | 启用 ProcAmp 色彩调整 |
| `hue` | 0 | 色相 -180~180 |
| `saturation` | 1 | 饱和度 0~10 |
| `contrast` | 1 | 对比度 0~10 |
| `brightness` | 0 | 亮度 -100~100 |
| `transpose` | -1 | 转置：`cclock_hflip`(0) `clock`(1) `cclock`(2) `clock_hflip`(3) `reversal`(4) `hflip`(5) `vflip`(6) |
| `scale_mode` | `auto` | 缩放模式：`auto` `low_power` `hq` `compute` `vd` `ve` |
| `async_depth` | 4 | 并行深度（越大延迟越高） |
| `out_range` | 0 | 输出色域：`limited`(1) / `full`(2) |
| `out_color_matrix` / `out_color_primaries` / `out_color_transfer` | — | 输出色彩属性 |
| `tonemap` | 0 | **HDR 色调映射**：1 = 输入有 HDR 元数据时执行 |

```bash
# QSV 一体化：去隔行 + 降噪 + 细节增强 + 缩放（单次调用）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.ts \
  -vf "vpp_qsv=deinterlace=advanced:denoise=20:detail=30:w=1920:h=1080:scale_mode=hq" \
  -c:v hevc_qsv -global_quality 24 -c:a copy out.mp4

# QSV 裁剪 + 缩放
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "vpp_qsv=cw=1440:ch=1080:cx=240:cy=0:w=1280:h=720" \
  -c:v h264_qsv -global_quality 25 out.mp4

# QSV 色彩调整（ProcAmp）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "vpp_qsv=procamp=1:saturation=1.2:contrast=1.1:brightness=3" \
  -c:v h264_qsv -global_quality 25 out.mp4

# QSV HDR→SDR 硬件色调映射
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i hdr.mp4 \
  -vf "vpp_qsv=tonemap=1:format=nv12,hwdownload,format=nv12" \
  -c:v h264_qsv -global_quality 24 out.mp4

# QSV 转置（旋转 90°）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "vpp_qsv=transpose=clock" -c:v h264_qsv out.mp4
```

### 7.7 硬件去隔行

| 滤镜 | 平台 | 参数 |
| --- | --- | --- |
| `yadif_cuda` | CUDA | `mode`(0/1)、`parity`(-1/0/1)、`deint`(0/1) |
| `bwdif_cuda` | CUDA | 同 `bwdif`，质量更好 |
| `deinterlace_qsv` | QSV | `mode`：`bob` / `advanced` |
| `deinterlace_vaapi` | VAAPI | `mode`：`default` / `bob` / `weave` / `motion_adaptive` / `motion_compensated`；`rate`：`frame` / `field` |
| `deinterlace_d3d12` | D3D12 | `mode`、`rate` |
| `bwdif_vulkan` | Vulkan | 同 `bwdif` |

```bash
# CUDA 硬解 + 硬件去隔行 + 硬编（全 GPU，无 CPU 拷贝）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.ts \
  -vf "yadif_cuda=mode=1:parity=-1:deint=0" \
  -c:v h264_nvenc -preset p6 -cq 23 -c:a copy out.mp4

# CUDA bwdif（质量更好）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.ts \
  -vf "bwdif_cuda=mode=0:parity=-1:deint=1" -c:v hevc_nvenc -cq 24 out.mp4

# QSV 硬件去隔行（场率输出，得到更流畅画面）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.ts \
  -vf "deinterlace_qsv=mode=advanced:rate=field" -c:v h264_qsv out.mp4

# VAAPI 运动补偿去隔行
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.ts \
  -vf "deinterlace_vaapi=mode=motion_compensated:rate=field" \
  -c:v h264_vaapi -qp 23 out.mp4
```

### 7.8 硬件降噪、锐化与色彩处理

| 滤镜 | 平台 | 用途与关键参数 |
| --- | --- | --- |
| `denoise_vaapi` | VAAPI | 降噪，`denoise`(0~100) |
| `sharpness_vaapi` | VAAPI | 锐化，`sharpness`(0~64，默认 44) |
| `procamp_vaapi` | VAAPI | 色彩调整：`brightness`(`b`) `contrast`(`c`) `saturatio`(`s`) `hue`(`h`)。**注意饱和度参数名在本机构建中为 `saturatio`，建议用短名 `s`** |
| `vpp_qsv` | QSV | `denoise`(0~100)、`detail`(0~100)、ProcAmp |
| `vqe_amf` | AMF | AMD 画质增强 |
| `nlmeans_opencl` / `nlmeans_vulkan` | OpenCL/Vulkan | 高质量非局部均值降噪 |
| `unsharp_opencl` | OpenCL | 锐化 |
| `bilateral_cuda` | CUDA | 双边滤波（保边降噪） |
| `tonemap_vaapi` / `tonemap_opencl` | VAAPI/OpenCL | HDR→SDR |
| `libplacebo` | GPU 通用 | 高质量色调映射与色彩管理 |

```bash
# VAAPI 降噪 + 锐化 + 硬编
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
  -vf "denoise_vaapi=denoise=15,sharpness_vaapi=sharpness=20" \
  -c:v h264_vaapi -qp 23 out.mp4

# VAAPI 色彩调整（ProcAmp）
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
  -vf "procamp_vaapi=brightness=5:contrast=1.1:s=1.15" \
  -c:v h264_vaapi -qp 23 out.mp4

# CUDA 双边滤波（保边降噪）+ 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "bilateral_cuda=window_size=9:sigmaS=3.0:sigmaR=50.0" \
  -c:v hevc_nvenc -preset p6 -cq 24 out.mp4

# VAAPI HDR→SDR 色调映射
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i hdr.mp4 \
  -vf "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,scale_vaapi=1920:1080,hwdownload,format=nv12" \
  -c:v h264_vaapi -qp 23 out.mp4

# OpenCL HDR→SDR（跨厂商）
ffmpeg -i hdr.mp4 -vf "format=p010,hwupload,tonemap_opencl=t=bt2020:tonemap=linear:format=p010,hwdownload,format=p010" \
  -c:v libx264 -crf 20 out.mp4

# libplacebo 高质量 HDR→SDR（GPU 通用，质量最佳）
ffmpeg -hwaccel vulkan -hwaccel_output_format vulkan -i hdr.mp4 \
  -vf "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p" \
  -c:v h264_nvenc -cq 23 out.mp4
```

### 7.9 硬件叠加与合成

| 滤镜 | 平台 | 用途 |
| --- | --- | --- |
| `overlay_cuda` | CUDA | 叠加（支持 timeline） |
| `overlay_qsv` | QSV | 叠加 |
| `overlay_vaapi` | VAAPI | 叠加，支持 `x`/`y`/`w`/`h`/`alpha` |
| `overlay_vulkan` | Vulkan | 叠加 |
| `overlay_opencl` | OpenCL | 叠加 |
| `hstack_qsv` / `vstack_qsv` / `xstack_qsv` | QSV | 多画面 |
| `hstack_vaapi` / `vstack_vaapi` / `xstack_vaapi` | VAAPI | 多画面 |

```bash
# CUDA 硬件叠加（全 GPU 管线，无 CPU 往返）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i base.mp4 \
       -hwaccel cuda -hwaccel_output_format cuda -i logo.mp4 \
  -filter_complex "[0:v][1:v]overlay_cuda=x=W-w-20:y=H-h-20[out]" \
  -map "[out]" -map 0:a? -c:v h264_nvenc -preset p5 -cq 23 -c:a copy out.mp4

# VAAPI 叠加（官方示例写法）
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i input.mp4 -i logo.png \
  -filter_complex "[0:v]hwupload[a];[1:v]format=yuva420p,hwupload[b];[a][b]overlay_vaapi=x=200:y=100:w=400:h=300:alpha=0.8,hwdownload,format=nv12[out]" \
  -map "[out]" -map 0:a? -c:v h264_vaapi -qp 23 out.mp4

# QSV 多画面（2x2）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i a.mp4 -i b.mp4 -i c.mp4 -i d.mp4 \
  -filter_complex "[0:v]scale_qsv=960:540[a];[1:v]scale_qsv=960:540[b];[2:v]scale_qsv=960:540[c];[3:v]scale_qsv=960:540[d];[a][b][c][d]xstack_qsv=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[out]" \
  -map "[out]" -c:v h264_qsv -global_quality 25 out.mp4
```

### 7.10 `hwupload` / `hwdownload` / `hwmap` 实战

**核心规则：**

- 输入已是硬件帧（用了 `-hwaccel_output_format`）→ **不需要** `hwupload`
- 软件帧要进硬件滤镜/编码器 → 必须 `hwupload`，且需要设备（`-filter_hw_device` 或 `derive_device`）
- 硬件帧要用软件滤镜 → 必须 `hwdownload` + `format=`
- `hwmap` 用于硬件帧 ↔ 系统内存或跨设备映射

**`hwmap` 的 `mode`：** `read`、`write`、`overwrite`（不读原内容，更快）、`direct`（禁止拷贝）。默认 `read+write`。
**`derive_device type`**：从输入设备派生新设备。**`reverse`**：反向映射（**危险，慎用**）。

```bash
# 场景 1：软解 + 硬滤镜 + 硬编（需显式上传）
ffmpeg -init_hw_device cuda=cu -filter_hw_device cu -i in.mp4 \
  -vf "hwupload_cuda,scale_cuda=1280:720,hwdownload,format=nv12" \
  -c:v libx264 -crf 20 out.mp4

# 场景 2：硬解 + 软件滤镜 + 硬编（需下载再上传）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 -i logo.png \
  -filter_complex "[0:v]hwdownload,format=nv12[base];[base][1:v]overlay=10:10[ov];[ov]hwupload_cuda[out]" \
  -map "[out]" -map 0:a? -c:v h264_nvenc -cq 23 -c:a copy out.mp4

# 场景 3：QSV 从软解帧上传
ffmpeg -init_hw_device qsv=hw -filter_hw_device hw -i in.mp4 \
  -vf "hwupload,format=qsv,scale_qsv=1280:720,hwdownload,format=nv12" \
  -c:v libx264 -crf 20 out.mp4

# 场景 4：hwmap 跨设备映射（避免拷贝，性能最好）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "hwmap=derive_device=opencl,tonemap_opencl=format=nv12,hwmap=derive_device=cuda:reverse=1" \
  -c:v h264_nvenc -cq 23 out.mp4

# 场景 5：设备间派生（VAAPI → QSV，Linux）
ffmpeg -init_hw_device vaapi=va:/dev/dri/renderD129 -init_hw_device qsv=hw1@va \
  -filter_hw_device hw1 -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -c:v hevc_qsv out.mp4
```

**常见报错与解决：**

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `A hardware device reference is required to upload frames to` | `hwupload` 没拿到设备 | 加 `-init_hw_device X` + `-filter_hw_device X`，或用 `hwupload=derive_device=...` |
| `Impossible to convert between the formats` | 硬件/软件滤镜格式不兼容 | 中间插 `hwdownload,format=nv12` 或 `hwupload` |
| `Failed to upload frame` | 设备类型与滤镜不匹配 | 确认 `-filter_hw_device` 指向正确类型的设备 |

### 7.11 多 GPU 与设备选择

```bash
# 方式 1：解码用第 1 块，编码用第 0 块
ffmpeg -hwaccel_device 1 -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -c:v h264_nvenc -gpu 0 -cq 23 out.mp4

# 方式 2：命名设备，全链路一致（推荐，最清晰）
ffmpeg -init_hw_device cuda=enc:0 -filter_hw_device enc -i in.mp4 \
  -vf "hwupload_cuda,scale_cuda=1280:720" -c:v h264_nvenc -cq 23 out.mp4

# 方式 3：使用主设备上下文（多进程共享 GPU 时避免冲突）
ffmpeg -init_hw_device cuda:0,primary_ctx=1 -i in.mp4 -c:v h264_nvenc out.mp4

# 列出可用 NVENC 设备
ffmpeg -i in.mp4 -c:v h264_nvenc -gpu list -f null - 2>&1 | head -20

# QSV 双 GPU 同时编码（Intel HyperEncode）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -c:v hevc_qsv -dual_gfx adaptive -global_quality 24 out.mp4

# VAAPI 指定渲染节点
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD129 \
  -hwaccel_output_format vaapi -i in.mp4 -c:v h264_vaapi -qp 23 out.mp4
```

### 7.12 硬件加速的滤镜可用性矩阵（本机实测）

| 功能 | CUDA | QSV | VAAPI | AMF | D3D11/12 | Vulkan | OpenCL |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 缩放 | `scale_cuda` | `scale_qsv`/`vpp_qsv` | `scale_vaapi` | `vpp_amf` | `scale_d3d11/12` | `scale_vulkan` | — |
| 去隔行 | `yadif_cuda`/`bwdif_cuda` | `deinterlace_qsv` | `deinterlace_vaapi` | — | `deinterlace_d3d12` | `bwdif_vulkan` | — |
| 降噪 | `bilateral_cuda` | `vpp_qsv`(denoise) | `denoise_vaapi` | `vqe_amf` | — | `nlmeans_vulkan` | `nlmeans_opencl` |
| 锐化 | — | `vpp_qsv`(detail) | `sharpness_vaapi` | `vqe_amf` | — | — | `unsharp_opencl` |
| 色彩调整 | `colorspace_cuda` | `vpp_qsv`(ProcAmp) | `procamp_vaapi` | `vpp_amf` | — | — | — |
| 色调映射 | — | `vpp_qsv`(tonemap) | `tonemap_vaapi` | — | — | `libplacebo` | `tonemap_opencl` |
| 叠加 | `overlay_cuda` | `overlay_qsv` | `overlay_vaapi` | — | — | `overlay_vulkan` | `overlay_opencl` |
| 加边 | `pad_cuda` | — | `pad_vaapi` | — | — | — | `pad_opencl` |
| 转置 | `transpose_cuda` | `vpp_qsv` | `transpose_vaapi` | — | — | `transpose_vulkan` | `transpose_opencl` |
| 多画面 | — | `hstack_qsv` 等 | `hstack_vaapi` 等 | — | — | — | — |
| 转场 | — | — | — | — | — | `xfade_vulkan` | `xfade_opencl` |
| 选帧 | `thumbnail_cuda` | — | — | — | — | — | — |
| 超分 | — | — | — | `sr_amf` | — | — | — |
| 帧率变换 | — | `vpp_qsv`(framerate) | — | `frc_amf` | — | `fruc_vulkan` | — |
| 屏幕采集 | — | — | — | `vsrc_amf` | — | — | — |

> 空白处表示该平台没有对应的硬件滤镜实现，需走 `hwdownload` → 软件滤镜 → `hwupload` 的混合路径。

---

## 8. 硬件帧率变换与变速

### 8.1 硬件帧率变换能力概览

| 方式 | 平台 | 说明 |
| --- | --- | --- |
| `vpp_qsv=framerate=N/D` | QSV | VPP 内直接输出指定帧率（简单丢/复制帧） |
| `frc_amf` | AMF | AMF 帧率转换（含插帧）。参数：`engine_type`(dx11/dx12) `profile`(low/high/super) `mv_search_mode` `fallback_mode` `indicator`；**无 `fps` 选项，用 `-r` 指定输出帧率** |
| `fruc_vulkan` | Vulkan | 基于 Vulkan 光流扩展的帧率上变换（真插帧） |
| 硬件解码 + `fps` 滤镜 | 全部 | 硬解后下载，用软件 `fps` 处理（最通用） |

```bash
# QSV：VPP 直接改帧率（60 → 30）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in60fps.mp4 \
  -vf "vpp_qsv=framerate=30/1" -c:v h264_qsv -global_quality 25 out.mp4

# QSV：VPP 改帧率 + 缩放 + 去隔行（一次完成）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.ts \
  -vf "vpp_qsv=deinterlace=advanced:framerate=30/1:w=1920:h=1080" \
  -c:v hevc_qsv -global_quality 24 out.mp4

# AMF：帧率转换（frc_amf 无 fps 选项，用 -r 指定输出帧率）
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -vf "frc_amf=engine_type=dx11:profile=high" -r 60 \
  -c:v h264_amf -quality quality out.mp4

# Vulkan：光流插帧到 60fps
ffmpeg -init_hw_device vulkan -i in30fps.mp4 \
  -vf "hwupload,fruc_vulkan=fps=60,hwdownload,format=nv12" \
  -c:v h264_nvenc -cq 23 out.mp4

# 通用：硬解 + 软件 fps + 硬编（最稳，质量可控）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "hwdownload,format=nv12,fps=30,hwupload_cuda" \
  -c:v h264_nvenc -cq 23 out.mp4
```

### 8.2 硬件变速（速度改变）

**变速 = 视频改时间戳 + 音频改速度**。硬件加速本身**不改变时间戳**，所以变速仍需 `setpts` / `atempo`：

```bash
# 2 倍速（硬解 + 硬编，仅视频）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "setpts=0.5*PTS" -c:v h264_nvenc -cq 23 -an out_2x.mp4

# 2 倍速（音视频同步变速，音频用 atempo）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -filter_complex "[0:v]setpts=0.5*PTS[v];[0:a]atempo=2.0[a]" \
  -map "[v]" -map "[a]" -c:v h264_nvenc -cq 23 -c:a aac -b:a 128k out_2x.mp4

# 0.5 倍慢动作（音视频同步）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -filter_complex "[0:v]setpts=2.0*PTS[v];[0:a]atempo=0.5[a]" \
  -map "[v]" -map "[a]" -c:v hevc_nvenc -cq 23 -c:a aac out_slow.mp4

# 4 倍速（atempo 上限 2，需串联）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=0.25*PTS[v];[0:a]atempo=2.0,atempo=2.0[a]" \
  -map "[v]" -map "[a]" -c:v h264_nvenc -cq 23 -c:a aac out_4x.mp4

# 高质量变速保持音调（rubberband）
ffmpeg -i in.mp4 -filter_complex "[0:v]setpts=PTS/1.25[v];[0:a]rubberband=tempo=1.25[a]" \
  -map "[v]" -map "[a]" -c:v h264_nvenc -cq 23 -c:a aac out.mp4
```

> **注意**：`setpts` 是软件滤镜。若硬解帧进 `setpts` 报格式错误，改为显式往返：
> `-vf "hwdownload,format=nv12,setpts=0.5*PTS,hwupload_cuda"`。

---

## 9. 质量与性能对比

### 9.1 质量对比的结论性认识

**核心结论（有充分共识）：**

1. **软件编码（x264/x265/SVT-AV1）在同码率下质量优于所有硬件编码器。**
   官方文档明确说明硬件编码器输出质量「显著低于优秀的软件编码器如 x264」。
2. **硬件编码需要更高码率才能达到同等感知质量。**
   经验值：同感知质量下，硬件编码需比 x264 高 **20%~50%** 码率；比 x265 高 **30%~70%**。
3. **硬件编码代际差异明显。**
   新一代 GPU（Ada/Blackwell、Arc、RDNA3）的编码质量已明显改善，尤其 HEVC/AV1；老一代（Turing 之前、Vega 之前）差距较大。
4. **AV1 硬件编码（RTX 40 系、Arc、RDNA3）质量已接近甚至部分场景超过 HEVC 硬件编码**，但普及度受限。
5. **软件编码的质量优势在低码率下更明显**；高码率（接近视觉无损）时差距缩小。

### 9.2 速度对比（量级参考）

| 场景 | 相对速度（软件 x264 medium = 1×） |
| --- | --- |
| x264 ultrafast | 8~15× |
| x264 medium | 1×（基准） |
| x265 medium | 0.2~0.4× |
| SVT-AV1 preset 6 | 0.5~1.5× |
| NVENC p4 (H.264) | 20~50× |
| NVENC p7 (HEVC) | 8~20× |
| QSV medium | 10~30× |
| AMF balanced | 10~25× |

> 实际倍率强依赖分辨率、GPU 型号、CPU 型号。4K 下硬件优势更明显（软件编码几乎不可行）。

### 9.3 质量—速度—体积三维权衡

| 方案 | 质量 | 速度 | CPU 占用 | 体积 | 适用 |
| --- | --- | --- | --- | --- | --- |
| x265 slow + CRF | ★★★★★ | ★ | 高 | 小 | 归档、母版 |
| SVT-AV1 preset 4~6 | ★★★★★ | ★★ | 高 | 最小 | 现代归档 |
| x264 slow + CRF | ★★★★ | ★★ | 高 | 中 | 兼容性优先归档 |
| NVENC p7 HEVC + cq | ★★★☆ | ★★★★ | 极低 | 中 | 大批量转码 |
| QSV slower HEVC + ICQ | ★★★☆ | ★★★★ | 极低 | 中 | Intel 服务器 |
| NVENC p4 HEVC + cq | ★★★ | ★★★★★ | 极低 | 中偏大 | 实时/直播 |
| NVENC p1 + cbr | ★★ | ★★★★★ | 极低 | 大 | 极低延迟直播 |

### 9.4 编码器质量横向对比（文献共识）

> 以下为业界普遍结论与公开基准（如 `SME-2019-FFmpeg-Hardware.pdf`、Intel/NVIDIA/AMD 官方基准）的综合判断，**具体数值随硬件代际与内容差异较大，仅供选型参考**。

| 编码器 | 同质量码率（相对 x265 slow） | 备注 |
| --- | --- | --- |
| SVT-AV1 preset 4 | 约 0.6~0.75× | 压缩率最佳 |
| libaom-av1 cpu-used 2 | 约 0.6~0.8× | 极慢 |
| x265 slow | 1.0×（基准） | HEVC 标杆 |
| NVENC HEVC (Ada, p7) | 约 1.4~1.8× | 新一代明显改善 |
| QSV HEVC (gen12) | 约 1.5~2.0× | |
| AMF HEVC (RDNA2/3) | 约 1.5~2.2× | |
| VAAPI HEVC (iHD) | 约 1.5~2.0× | 依驱动 |
| NVENC H.264 (p7) | 约 1.5~2.0×（相对 x264 slow） | |
| x264 slow | 约 1.2~1.4×（相对 x265） | H.264 标杆 |

> **重要提醒**：上述倍率是「达到同等 VMAF/主观质量所需码率」的粗略比例。实际项目中必须针对**自己的内容**做 A/B 测试。

### 9.5 硬件编码的质量调优手段

硬件编码器虽然参数少，但仍可通过以下方式显著改善质量：

| 手段 | 效果 | 参数 |
| --- | --- | --- |
| 用更慢预设 | 明显提升 | NVENC `p6`/`p7`、QSV `slower`/`veryslow` |
| 开启 AQ | 改善平坦区与暗场 | NVENC `-spatial-aq 1 -temporal-aq 1`；AMF `-vbaq` |
| 双遍编码 | 提升码率分配精度 | NVENC `-multipass fullres` |
| 场景提示 | 改善码率策略 | QSV `-scenario archive` |
| 提高前瞻 | 改善帧类型决策 | NVENC `-rc-lookahead`、QSV `-look_ahead_depth` |
| 预分析 | 提升质量 | AMF `-preanalysis` |
| 用 HEVC/AV1 而非 H.264 | 同质量省 30~50% 码率 | `hevc_nvenc` / `av1_nvenc` |
| 放宽码率 | 直接有效 | 提高 `-cq` 对应的质量（降低 cq 数值） |

```bash
# 质量优先的 NVENC 配置（牺牲速度）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -c:v hevc_nvenc -preset p7 -tune hq -rc vbr -cq 24 -b:v 0 \
  -multipass fullres -rc-lookahead 32 -spatial-aq 1 -temporal-aq 1 -aq-strength 10 \
  -c:a copy out.mp4
```

### 9.6 HDR 与高级特性支持

| 特性 | 软件编码 | NVENC | QSV | AMF | VAAPI |
| --- | --- | --- | --- | --- | --- |
| 10bit 编码 | ✓ (x265/x264-10bit) | ✓ (HEVC) | ✓ (HEVC gen9.5+) | ✓ | ✓ |
| HDR10 静态元数据 | ✓ | 需 `-x265-params` 或 SEI 透传 | 部分 | 部分 | 部分 |
| HDR10+ 动态元数据 | x265 ✓ | ✗（需 NVEncC 等外部工具） | ✗（需 QSVEncC） | ✗（需 VCEEncC） | ✗ |
| Dolby Vision | x265 ✓ (`-dolbyvision`) | ✗ | ✗ | ✗ | ✗ |
| 4:4:4 色度 | ✓ | ✓ (部分代际) | ✓ (gen11+) | ✓ | 部分 |
| 无损 | ✓ | ✓ (`-tune lossless`) | ✗ | ✗ | ✗ |
| B 帧 | ✓ | ✓ | ✓ | ✓ | ✓ |

> **HDR10+ 与 Dolby Vision 是硬件编码的主要短板**——如需这些特性，通常需借助 rigaya 系列工具（NVEncC / QSVEncC / VCEEncC）而非 ffmpeg 内置编码器。

---

## 10. 实测与基准方法

### 10.1 性能基准

```bash
# 输出耗时统计（benchmark 会打印 utime/stime/rtime）
ffmpeg -benchmark -i in.mp4 -c:v libx264 -crf 20 -f null -

# 只看解码速度（不做编码）
ffmpeg -benchmark -i in.mp4 -f null -

# 对比不同方案（固定时长，记录 rtime 与 fps）
ffmpeg -benchmark -i in.mp4 -t 60 -c:v h264_nvenc -cq 23 -f null -
ffmpeg -benchmark -i in.mp4 -t 60 -c:v libx264 -crf 20 -f null -
```

**关键指标：**
- `rtime`：实际耗时（秒）
- `speed`：处理速度（`Nx`，相对实时的倍数）
- `fps`：每秒处理帧数
- CPU 占用：Windows 用任务管理器，Linux 用 `top`/`htop`
- GPU 占用：NVIDIA 用 `nvidia-smi dmon -s u`，Intel 用 `intel_gpu_top`，AMD 用 `radeontop`

### 10.2 质量基准（同码率对比）

标准做法是**固定码率**或**固定质量指标**，对比体积/主观质量：

```bash
# 1) 用软件编码生成参考（高质量源）
ffmpeg -i source.mp4 -c:v libx264 -crf 12 -preset veryslow -an ref.mp4

# 2) 各方案编到相同码率
ffmpeg -i source.mp4 -c:v libx264 -b:v 4M -preset medium -an sw_x264.mp4
ffmpeg -i source.mp4 -c:v h264_nvenc -b:v 4M -preset p7 -an hw_nvenc.mp4
ffmpeg -i source.mp4 -c:v hevc_qsv  -b:v 4M -preset slower -an hw_qsv.mp4

# 3) 分别测 VMAF（对参考）
for f in sw_x264 hw_nvenc hw_qsv; do
  echo "=== $f ==="
  ffmpeg -i $f.mp4 -i ref.mp4 -lavfi "libvmaf=log_fmt=json:log_path=$f-vmaf.json" -f null - 2>&1 | tail -3
done
```

**对齐要求（必做）**：两路输入必须分辨率、像素格式、帧数、时间戳一致，否则指标无效：

```bash
-lavfi "[0:v]settb=AVTB,setpts=PTS-STARTPTS[main];[1:v]settb=AVTB,setpts=PTS-STARTPTS[ref];[main][ref]libvmaf=..."
```

### 10.3 同质量下的码率对比（BD-Rate 思路）

更严谨的对比是**扫描码率曲线**，找出达到同一 VMAF（如 93）所需码率：

```bash
# 对每个编码器扫 3~5 个码率点，记录 (码率, VMAF) 对，画曲线
for br in 2M 4M 6M 8M; do
  ffmpeg -i source.mp4 -c:v h264_nvenc -b:v $br -preset p7 -an test_$br.mp4
  ffmpeg -i test_$br.mp4 -i ref.mp4 -lavfi libvmaf -f null - 2>&1 | grep "VMAF score"
done
```

### 10.4 可复现的对比实验模板

```bash
#!/usr/bin/env bash
# 固定输入、时长、音频（-an 排除音频干扰），只比视频编码
SRC="source.mp4"
DUR=60
REF_CRF=12

# 参考
ffmpeg -y -i "$SRC" -t $DUR -c:v libx264 -crf $REF_CRF -preset veryslow -an ref.mp4

run() {
  local name=$1; shift
  local t0=$(date +%s.%N)
  ffmpeg -y -i "$SRC" -t $DUR -an "$@" "$name.mp4" 2>/dev/null
  local t1=$(date +%s.%N)
  local size=$(stat -c%s "$name.mp4" 2>/dev/null || stat -f%z "$name.mp4")
  local vmaf=$(ffmpeg -i "$name.mp4" -i ref.mp4 -lavfi libvmaf -f null - 2>&1 | grep -oP 'VMAF score: \K[0-9.]+')
  printf "%-14s 耗时 %6.1fs  体积 %8d   VMAF %s\n" "$name" "$(echo "$t1-$t0"|bc)" "$size" "$vmaf"
}

run sw_x264_crf20  -c:v libx264 -crf 20 -preset slow
run hw_nvenc_cq24  -c:v hevc_nvenc -preset p7 -rc vbr -cq 24 -b:v 0
run hw_qsv_gq24    -c:v hevc_qsv -preset slower -global_quality 24
```

---

## 11. 选型建议与常见坑

### 11.1 选型决策树

```
需要硬件加速吗？
├─ 实时/直播（延迟敏感） → 是，硬件编码是唯一选择
│    └─ NVENC p4 + ll / QSV medium + look_ahead
├─ 大批量转码（吞吐优先，质量可接受）
│    └─ NVENC p6/p7 HEVC + cq，或 QSV slower + ICQ
├─ 归档/母版（质量优先）
│    └─ 软件编码：x265 slow / SVT-AV1 preset 4~6
└─ 移动端/低功耗设备
     └─ VideoToolbox（Apple）/ QSV（Intel 笔记本）
```

### 11.2 按场景的推荐配置

| 场景 | 推荐 |
| --- | --- |
| **直播推流** | `h264_nvenc -preset p4 -tune ll -rc cbr -zerolatency 1` |
| **批量 4K 转 1080p** | `-hwaccel cuda -hwaccel_output_format cuda -vf scale_cuda=1920:1080 -c:v hevc_nvenc -preset p6 -cq 26` |
| **监控视频归档** | `hevc_qsv -preset slower -global_quality 26 -scenario videosurveillance` |
| **用户上传转码（质量优先）** | `libx265 -preset slow -crf 23` |
| **用户上传转码（速度优先）** | `hevc_nvenc -preset p7 -cq 25 -multipass fullres` |
| **屏幕录制** | `h264_nvenc -preset p5 -cq 24 -rc-lookahead 20` |
| **视频会议录制** | `h264_qsv -preset veryfast -vcm 1 -b:v 2M` |
| **Apple 生态播放** | `hevc_nvenc -tag:v hvc1 -cq 26` |

### 11.3 常见坑与解决

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `No NVENC capable devices found` | 像素格式不受支持 / GPU 不支持该 codec | 查 `ffmpeg -h encoder=h264_nvenc` 的像素格式；加 `-pix_fmt yuv420p` |
| 硬解比软解还慢 | 帧被下载到系统内存 | 加 `-hwaccel_output_format cuda`（等对应格式） |
| `Failed to create processing device`（QSV） | 未正确创建子设备 | 用 `-init_hw_device qsv=hw,child_device_type=d3d11va` |
| `Impossible to convert between the formats` | 硬件滤镜与软件滤镜格式不兼容 | 插入 `hwdownload,format=nv12` 或 `hwupload` |
| 用了滤镜后硬件编码报错 | 部分 API（如 `-hwaccel qsv` 加速转码）不允许滤镜 | 改用 `-hwaccel qsv -hwaccel_output_format qsv` + `_qsv` 滤镜 |
| VAAPI 报找不到设备 | 渲染节点错误 | `ls /dev/dri/` 确认；用 `-hwaccel_device /dev/dri/renderD128` |
| 输出帧数不对 | `-noautoscale` 与滤镜图冲突 | 移除 `-noautoscale` 或显式设置 `scale` 输出尺寸 |
| 硬解 10bit HEVC 失败 | 硬件代际不支持 | 查硬件解码矩阵；降级到软件解码该流 |
| 多 GPU 用错卡 | 默认选第一块 | 用 `-hwaccel_device N` 与 NVENC `-gpu N` |
| AV1 转码失败 | 缺少额外硬件帧 | 加 `-extra_hw_frames 10` |
| 输出体积异常大 | 硬件编码默认码率模式 | 显式指定 `-cq`/`-global_quality`/`-qp` |

### 11.4 质量验证清单

在生产环境切换硬件编码前，务必完成：

- [ ] 用**自己的代表性素材**做 A/B 对比（不同内容类型各 1~2 段）
- [ ] 用 VMAF/SSIM 客观对比同码率下的质量差距
- [ ] 主观对比暗场、快速运动、平坦渐变（硬件编码最易暴露问题的场景）
- [ ] 确认目标播放设备的兼容性（profile/level/tag）
- [ ] 确认硬件编码的码率提升在存储/带宽预算内
- [ ] 确认多路并发时的 GPU 会话数限制

---

## 12. 速查表

### 12.1 各平台最小可用命令

```bash
# NVIDIA
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 -c:v h264_nvenc -cq 23 out.mp4

# Intel QSV
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 -c:v h264_qsv -global_quality 25 out.mp4

# AMD AMF (Windows)
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 -c:v h264_amf -quality balanced out.mp4

# VAAPI (Linux)
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 -hwaccel_output_format vaapi \
       -i in.mp4 -c:v h264_vaapi -qp 23 out.mp4

# VideoToolbox (macOS)
ffmpeg -i in.mp4 -c:v h264_videotoolbox -b:v 4M out.mp4

# Vulkan（跨厂商）
ffmpeg -init_hw_device vulkan -i in.mp4 -c:v h264_vulkan out.mp4
```

### 12.2 诊断命令

```bash
ffmpeg -hwaccels                                   # 支持的加速方法
ffmpeg -init_hw_device list                        # 支持的设备类型
ffmpeg -encoders | grep -E "nvenc|qsv|vaapi|amf|videotoolbox|vulkan"
ffmpeg -filters  | grep -E "_cuda|_qsv|_vaapi|_amf|_vulkan|_opencl|_d3d1[12]"
ffmpeg -h encoder=hevc_nvenc                       # 编码器全部参数
ffmpeg -h encoder=hevc_qsv
ffmpeg -v verbose -i in.mp4 -f null - 2>&1 | grep -i hwaccel   # 查看实际使用的 hwaccel
nvidia-smi dmon -s u                               # NVIDIA GPU 利用率
intel_gpu_top                                      # Intel GPU 利用率
radeontop                                          # AMD GPU 利用率
```

### 12.3 参数对照表

| 通用概念 | NVENC | QSV | AMF | VAAPI | VideoToolbox |
| --- | --- | --- | --- | --- | --- |
| 恒定质量 | `-rc vbr -cq N` | `-global_quality N` | `-rc vbr_peak -qp_*` | `-rc_mode ICQ -global_quality N` | `-q:v N` |
| 恒定 QP | `-rc constqp -qp N` | `-qscale -global_quality N` | `-rc cqp -qp_i/-qp_p/-qp_b` | `-rc_mode CQP -qp N` | — |
| 目标码率 | `-b:v` | `-b:v` | `-b:v` | `-b:v` | `-b:v` |
| CBR | `-rc cbr -b:v -maxrate -bufsize` | `-b:v -maxrate（相等）` | `-rc cbr` | `-rc_mode CBR` | — |
| 速度预设 | `-preset p1..p7` | `-preset veryfast..veryslow` | `-quality speed..high_quality` | `-quality` / `-compression_level` | — |
| 低延迟 | `-tune ll/ull`、`-zerolatency 1` | `-low_delay_brc 1` | `-usage lowlatency`、`-latency true` | — | — |
| 自适应量化 | `-spatial-aq`/`-temporal-aq` | `-mbbrc` | `-vbaq` | — | — |
| 两遍 | `-multipass fullres` | `-extbrc` | `-preanalysis` | — | — |

### 12.4 质量与速度速查

| 需求 | 首选 | 备选 |
| --- | --- | --- |
| 最高质量（不赶时间） | `libx265 -preset slow -crf 23` | `libsvtav1 -preset 4 -crf 28` |
| 最高压缩率 | `libsvtav1 -preset 4 -crf 28` | `libaom-av1 -cpu-used 2 -crf 30` |
| 平衡（推荐默认） | `libx265 -preset medium -crf 24` | `libsvtav1 -preset 6 -crf 30` |
| 快速（质量可接受） | `hevc_nvenc -preset p7 -cq 25` | `hevc_qsv -preset slower -global_quality 25` |
| 最快 | `h264_nvenc -preset p1 -cq 30` | `h264_qsv -preset veryfast` |
| 最低延迟 | `h264_nvenc -tune ull -zerolatency 1` | `h264_qsv -vcm 1` |
| 低 CPU 占用 | 任意硬件编码器 | — |
| HDR10+ / DV | `libx265`（DV 用 `-dolbyvision`） | NVEncC / QSVEncC（外部工具） |

---

## 附录 A：硬件加速实战配方集

> 以下配方按「能直接跑」的标准编写。`in.mp4` / `out.mp4` 请替换为实际路径。硬件不可用时把编码器换成软件等价物（`hevc_nvenc`→`libx265`，`-cq N`→`-crf N`）。

### A.1 批量转码（最高吞吐）

```bash
# Windows PowerShell：整目录批量转 1080p HEVC（NVENC）
Get-ChildItem *.mp4 | ForEach-Object {
  ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i $_.FullName \
    -vf "scale_cuda=1920:1080:interp_algo=lanczos" \
    -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 26 -b:v 0 \
    -spatial-aq 1 -temporal-aq 1 \
    -c:a copy ".\out\$($_.Name)"
}

# bash：批量转码并保持目录结构
find ./src -name "*.mp4" | while read f; do
  out="./dst/${f#./src/}"
  mkdir -p "$(dirname "$out")"
  ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i "$f" \
    -vf "scale_cuda=-2:720" -c:v h264_nvenc -preset p5 -cq 25 -c:a copy "$out"
done
```

### A.2 直播推流（低延迟）

```bash
# RTMP 推流（NVENC，CBR + 零延迟）
ffmpeg -re -i in.mp4 \
  -c:v h264_nvenc -preset p4 -tune ll -rc cbr -b:v 6M -maxrate 6M -bufsize 12M \
  -zerolatency 1 -g 50 -bf 0 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 \
  -f flv rtmp://live.example.com/app/streamkey

# SRT 推流（抗丢包，适合公网）
ffmpeg -re -i in.mp4 \
  -c:v h264_nvenc -preset p4 -tune ll -rc cbr -b:v 8M -maxrate 8M -bufsize 16M \
  -c:a aac -b:a 128k \
  -f mpegts "srt://host:9000?mode=caller&latency=200000"

# 采集设备 + 硬件编码（Windows dshow）
ffmpeg -f dshow -i video="HD Webcam":audio="Microphone" \
  -c:v h264_nvenc -preset p4 -tune ll -rc cbr -b:v 4M -maxrate 4M -bufsize 8M \
  -c:a aac -b:a 128k -f flv rtmp://live.example.com/app/key

# 屏幕录制 + 硬件编码（Windows ddagrab）
ffmpeg -f lavfi -i ddagrab=0:framerate=30 -c:v h264_nvenc -cq 24 \
  -f mp4 screen.mp4
```

### A.3 HLS / DASH 多码率切片

```bash
# HLS 三档码率（NVENC 并行编码）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -filter_complex "\
    [0:v]split=3[v1][v2][v3];\
    [v1]scale_cuda=1920:1080[v1out];\
    [v2]scale_cuda=1280:720[v2out];\
    [v3]scale_cuda=854:480[v3out]" \
  -map "[v1out]" -map 0:a -map "[v2out]" -map 0:a -map "[v3out]" -map 0:a \
  -c:v:0 h264_nvenc -b:v:0 5M -preset p4 \
  -c:v:1 h264_nvenc -b:v:1 2M -preset p4 \
  -c:v:2 h264_nvenc -b:v:2 800k -preset p4 \
  -c:a aac -b:a 128k -ac 2 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  -master_pl_name master.m3u8 \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 \
  -hls_segment_filename "hls/stream_%v/seg_%03d.ts" \
  "hls/stream_%v/index.m3u8"

# DASH 切片（单文件）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -c:v h264_nvenc -preset p5 -b:v 4M -c:a aac -b:a 128k \
  -f dash -seg_duration 4 -use_template 1 -use_timeline 1 \
  -init_seg_name "init-\$RepresentationID\$.m4s" \
  -media_seg_name "chunk-\$RepresentationID\$-\$Number\$.m4s" \
  manifest.mpd
```

### A.4 硬解 + 硬滤镜 + 硬编全链路

```bash
# 完整链路：硬解 → 硬去隔行 → 硬缩放 → 硬降噪 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.ts \
  -vf "yadif_cuda=mode=1,scale_cuda=1920:1080:interp_algo=lanczos,bilateral_cuda=window_size=9:sigmaS=3.0:sigmaR=50.0" \
  -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 25 -b:v 0 \
  -c:a copy out.mp4

# QSV 全链路（vpp_qsv 一体化）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.ts \
  -vf "vpp_qsv=deinterlace=advanced:denoise=15:detail=20:w=1920:h=1080:scale_mode=hq" \
  -c:v hevc_qsv -preset slower -global_quality 25 -c:a copy out.mp4

# VAAPI 全链路
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi -i in.mp4 \
  -vf "deinterlace_vaapi=mode=motion_adaptive,scale_vaapi=w=1920:h=1080:mode=hq,denoise_vaapi=denoise=10" \
  -c:v h264_vaapi -rc_mode ICQ -global_quality 24 -c:a copy out.mp4
```

### A.5 硬件 HDR 处理

> 硬件路径的色调映射（`vpp_qsv=tonemap` / `tonemap_vaapi` / `libplacebo`）**不依赖 `zscale=t=linear`**，
> 因此不受软件链路那个 libzimg 限制影响，是 HDR 转码最省心的方案。

```bash
# HDR10 → SDR（NVENC 路径，用 libplacebo 做高质量色调映射）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i hdr.mkv \
  -vf "hwdownload,format=p010le,libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwupload_cuda" \
  -c:v hevc_nvenc -preset p6 -cq 24 -c:a copy sdr.mp4

# HDR10 → SDR（QSV 路径，硬件色调映射）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i hdr.mkv \
  -vf "vpp_qsv=tonemap=1:format=nv12,hwdownload,format=nv12" \
  -c:v hevc_qsv -global_quality 24 -c:a copy sdr.mp4

# HDR10 → SDR（VAAPI 路径）
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i hdr.mkv \
  -vf "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,hwdownload,format=nv12" \
  -c:v h264_vaapi -rc_mode ICQ -global_quality 24 -c:a copy sdr.mp4

# SDR → HDR10（软件 x265，硬件编码器不支持完整 HDR10 元数据）
ffmpeg -i sdr.mp4 -c:v libx265 -preset slow -crf 20 -pix_fmt yuv420p10le \
  -x265-params "hdr10=1:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1):max-cll=1000,400" \
  -c:a copy hdr.mkv
```

### A.6 多路并行处理（充分利用 GPU）

```bash
# 用 2 个 ffmpeg 进程分别用不同 GPU（Linux 多卡服务器）
ffmpeg -hwaccel_device 0 -hwaccel cuda -hwaccel_output_format cuda -i a.mp4 \
  -vf "scale_cuda=1920:1080" -c:v hevc_nvenc -preset p6 -cq 26 a_out.mp4 &
ffmpeg -hwaccel_device 1 -hwaccel cuda -hwaccel_output_format cuda -i b.mp4 \
  -vf "scale_cuda=1920:1080" -c:v hevc_nvenc -preset p6 -cq 26 b_out.mp4 &
wait

# 单卡多进程（注意消费级卡有并发会话数限制）
for f in a.mp4 b.mp4 c.mp4; do
  ffmpeg -y -hwaccel cuda -hwaccel_output_format cuda -i "$f" \
    -c:v h264_nvenc -preset p4 -cq 25 "out_$f" &
done
wait

# 监控 GPU 利用率
nvidia-smi dmon -s u -d 1
```

### A.7 硬件转码服务化（错误处理）

```bash
#!/usr/bin/env bash
# 带硬件回退的转码脚本：硬件失败自动切软件
transcode() {
  local input="$1" output="$2"
  if ffmpeg -y -hide_banner -loglevel error \
       -hwaccel cuda -hwaccel_output_format cuda -i "$input" \
       -vf "scale_cuda=-2:720" \
       -c:v hevc_nvenc -preset p6 -cq 26 -c:a copy "$output" 2>/tmp/ff.err; then
    echo "OK (NVENC): $output"
  else
    echo "NVENC failed, falling back to software: $(head -1 /tmp/ff.err)" >&2
    ffmpeg -y -hide_banner -loglevel error -i "$input" \
      -vf "scale=-2:720" -c:v libx265 -preset medium -crf 25 -c:a copy "$output"
    echo "OK (x265): $output"
  fi
}

transcode in.mp4 out.mp4
```

---

## 附录 B：本文参数来源对照

| 章节 | 主要来源 |
| --- | --- |
| 1–2 分层模型与核心参数 | `ffmpeg-all.md` §5.6 Advanced Video options（`-hwaccel`、`-hwaccel_device`、`-init_hw_device`、`-filter_hw_device`） |
| 3 各平台 API | `hwaccelintro-ffmpeg.md`、`hardware-quicksync-ffmpeg.md`、`hardware-amf-ffmpeg.md`、`support-matrix-nvidia.md`；`ffmpeg-all.md` §5.6 `-init_hw_device` 各设备类型详解 |
| 4 硬件解码 | `hwaccelintro-ffmpeg.md` §Use with the ffmpeg command-line tool、§CUDA、§NVDEC/CUVID；`ffmpeg-all.md` §5.6 `-hwaccel` |
| 5 硬件编码 | `ffmpeg-all.md` §16.31 QSV、§16.33 VAAPI、§16.26 MediaFoundation；`ffmpeg -h encoder=h264_nvenc`/`hevc_nvenc`/`h264_amf`/`h264_qsv`/`h264_vaapi` |
| 6 硬件滤镜与全 GPU 管线 | `ffmpeg-filters.md` §11.122 hwdownload、§11.123 hwmap、§11.124 hwupload、§12.7 scale_cuda、§14.1 overlay_vaapi、§14.2 tonemap_vaapi、§13.16 tonemap_opencl；本机 `ffmpeg -filters` 实测清单 |
| 7 硬件缩放与画面处理 | `ffmpeg-scaler.md`（scaler/sws_flags/dither/alpha 全部选项）、`ffmpeg-filters.md` §11.221 scale、§11.296 zscale；本机 `ffmpeg -h filter=scale`/`scale_cuda`/`scale_qsv`/`scale_vaapi`/`scale_d3d11`/`scale_vulkan`/`vpp_amf`/`vpp_qsv`/`deinterlace_*`/`denoise_vaapi`/`sharpness_vaapi`/`procamp_vaapi`/`bilateral_cuda`/`overlay_cuda`/`overlay_vaapi` 实测输出 |
| 8 硬件帧率与变速 | 本机 `ffmpeg -h filter=vpp_qsv`/`frc_amf`/`fruc_vulkan`/`fps`/`setpts`/`atempo`/`rubberband` 实测；`ffmpeg-all.md` §5.5 Video Options |
| 9 质量对比 | `hwaccelintro-ffmpeg.md`（硬件编码质量论述）、`SME-2019-FFmpeg-Hardware.pdf`、`fastflix-hardware-and-software-encoding.md`、`amd-intel-nvidia-video-encoding-performance-quality-tested.png`、`support-matrix-nvidia.md`；结论性判断基于业界公开基准共识 |
| 10 基准方法 | `ffmpeg-all.md` §5.5 `-benchmark`、`-vstats`；`ffmpeg-filters.md` §11.204 psnr、§11.244 ssim、§11.148 libvmaf |
| 11–12 选型与速查 | 综合上述来源 |
| 附录 A 实战配方 | 综合上述来源改写，并按官方示例调整 |
