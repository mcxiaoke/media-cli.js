# FFmpeg 硬件加速兼容性与全硬件工作流指南

> 版本基准：硬件编解码器清单、profile/level/pix_fmt 矩阵均来自本机 `F:\Temp\ffmpeg\ffmpeg-9-nonfree`（`N-126689-gb894a6f7c-2026-09-19`，libavcodec 63.14.100）的 `-encoders`、`-decoders`、`-h encoder=xxx`、`-h muxer=xxx` 实测枚举；能力演进与限制说明来自官方文档（`hwaccelintro-ffmpeg.md`、`hardware-quicksync-ffmpeg.md`、`hardware-amf-ffmpeg.md`、`support-matrix-nvidia.md`、`ffmpeg-formats.md`）。
> **重要提示**：**硬件能力取决于具体 GPU 代际与驱动版本**。本文矩阵标注了「FFmpeg 构建支持」（本机可枚举）与「硬件实际可用」（需对应 GPU）的区别——前者是命令能否被解析，后者是能否真正编码。
> 本文与《FFmpeg 硬件加速与质量对比指南》（`ffmpeg-guide-hwaccel.md`）互补：**那篇讲参数与流程，这篇讲兼容性与选型**。
>
> 📌 **本机实测数据（2026-09-21，RTX 4070 + UHD 750，master/8.1.2/7.1.1 三版本）**见
> [FFmpeg 硬解支持矩阵与混合链实测报告](./ffmpeg-hwaccel-support-matrix-20260921.md)，要点：
> 1. **`-hwaccel` 硬解失败会静默软解且退出码 0** → 判定不能看退出码（§8.1 有专项陷阱）；
> 2. **位置一致性**：硬解可用就走全 GPU（0 拷贝，实测 39.1x vs 17.4x）；硬解不可用就整链留在内存 + 硬编（27.7x vs libx264 10.9x），**不要半吊子指定 `-hwaccel` 却做 CPU filter**；
> 3. **cuda 不行 ≠ 别的也不行**：cuda 覆盖面最宽（VP8/MPEG-1/MPEG-4/MJPEG 仅 cuda 支持），替代通道补位增量≈0；反过来 cuda 失败时有 78% 概率其它通道也失败，只有 VP9（4:4:4、奇数分辨率）QSV 能救；
> 4. **`scale_d3d11` 本机不可用**（对照文件也失败，工具链级）；d3d 层必须用 CPU `scale=`；
> 5. **7.x 的 QSV 完全不可用**（`Error initializing an MFX session: -3`），主力应用 8.x/master。

---

## 目录

> 📖 **相关文档**：参数与用法细节见《FFmpeg 硬件加速与质量对比指南》（`ffmpeg-guide-hwaccel.md`）；
> 编码器通用参数见《FFmpeg 编码器参数与质量控制调优指南》（`ffmpeg-guide-encoders.md`）；
> 硬件滤镜完整参数见《FFmpeg 滤镜使用与详解指南》（`ffmpeg-guide-filters.md`）。

1. [硬件编解码器全清单](#1-硬件编解码器全清单)
2. [平台 × codec 支持矩阵](#2-平台--codec-支持矩阵)
3. [codec / profile / level / 像素格式矩阵](#3-codec--profile--level--像素格式矩阵)
4. [码率控制模式与码率—体积—质量](#4-码率控制模式与码率体积质量)
5. [容器与封装兼容性](#5-容器与封装兼容性)
6. [全硬件工作流程](#6-全硬件工作流程)
7. [硬解 × 硬编配对表](#7-硬解--硬编配对表)
8. [兼容性陷阱与验证方法](#8-兼容性陷阱与验证方法)
9. [选型速查](#9-选型速查)

---

## 1. 硬件编解码器全清单

### 1.1 硬件编码器（本机实测 28 个）

**NVIDIA NVENC：**

| 编码器 | codec | 说明 |
| --- | --- | --- |
| `h264_nvenc` | H.264 | 支持 4:2:0/4:2:2/4:4:4、10bit、无损 |
| `hevc_nvenc` | HEVC | 支持 main/main10/rext、B 帧参考 |
| `av1_nvenc` | AV1 | **需 RTX 40 系（Ada）及以上** |

**Intel QSV：**

| 编码器 | codec | 说明 |
| --- | --- | --- |
| `h264_qsv` | H.264 | baseline/main/high |
| `hevc_qsv` | HEVC | main/main10/mainsp/rext/scc |
| `av1_qsv` | AV1 | **需 gen12 DG2（Arc）及以上** |
| `vp9_qsv` | VP9 | Kaby Lake 起 |
| `mpeg2_qsv` | MPEG-2 | Ivy Bridge 起 |
| `mjpeg_qsv` | MJPEG | Braswell 起 |

**AMD AMF：**

| 编码器 | codec | 说明 |
| --- | --- | --- |
| `h264_amf` | H.264 | constrained_baseline/main/high |
| `hevc_amf` | HEVC | main/main10 |
| `av1_amf` | AV1 | **需 RDNA3（RX 7000）及以上** |

**VAAPI（Linux 为主）：**

| 编码器 | codec | 说明 |
| --- | --- | --- |
| `h264_vaapi` | H.264 | constrained_baseline/main/high/high10 |
| `hevc_vaapi` | HEVC | main/main10 |
| `av1_vaapi` | AV1 | 需新驱动 + 新硬件 |
| `vp9_vaapi` / `vp8_vaapi` | VP9 / VP8 | |
| `mpeg2_vaapi` | MPEG-2 | |
| `mjpeg_vaapi` | MJPEG | |

**MediaFoundation（Windows）：**

| 编码器 | codec | 说明 |
| --- | --- | --- |
| `h264_mf` / `hevc_mf` / `av1_mf` | H.264 / HEVC / AV1 | 支持软件与硬件两种模式（`-hw_encoding 1` 强制硬件） |
| `aac_mf` / `ac3_mf` / `mp3_mf` | 音频 | 硬件/系统音频编码器 |

**Vulkan（跨厂商）：**

| 编码器 | codec | 说明 |
| --- | --- | --- |
| `h264_vulkan` / `hevc_vulkan` / `av1_vulkan` | H.264 / HEVC / AV1 | 需驱动支持 Vulkan Video |
| `ffv1_vulkan` / `prores_ks_vulkan` / `apv_vulkan` | FFV1 / ProRes / APV | 中间格式与专业编码 |

> 实测命令：
> ```bash
> ffmpeg -encoders | grep -E "nvenc|qsv|vaapi|amf|_mf |vulkan"
> ```

### 1.2 硬件解码器（本机实测 22 个）

**NVIDIA CUVID/NVDEC（独立解码器，命名 `codec_cuvid`）：**

| 解码器 | codec | 备注 |
| --- | --- | --- |
| `h264_cuvid` | H.264 | |
| `hevc_cuvid` | HEVC | |
| `av1_cuvid` | AV1 | 需 Ada 及以上 |
| `mjpeg_cuvid` | MJPEG | |
| `mpeg1_cuvid` / `mpeg2_cuvid` / `mpeg4_cuvid` | MPEG-1/2/4 | |
| `vc1_cuvid` | VC-1 | |
| `vp8_cuvid` / `vp9_cuvid` | VP8/VP9 | Pascal 起支持 VP9 与 10bit |

**Intel QSV（内部解码器，命名 `codec_qsv`）：**

| 解码器 | codec |
| --- | --- |
| `h264_qsv` / `hevc_qsv` / `av1_qsv` | H.264 / HEVC / AV1 |
| `vp8_qsv` / `vp9_qsv` | VP8 / VP9 |
| `mpeg2_qsv` / `vc1_qsv` / `mjpeg_qsv` | MPEG-2 / VC-1 / MJPEG |
| `vvc_qsv` | VVC（H.266） |

**AMD AMF：**

| 解码器 | codec |
| --- | --- |
| `h264_amf` / `hevc_amf` / `av1_amf` | H.264 / HEVC / AV1 |
| `vp9_amf` | VP9 |

> **注意**：AMD 在 FFmpeg 中**没有独立的 DXVA2/D3D11VA 解码器包装**（用 `-hwaccel d3d11va` 走内部路径）；NVIDIA 的 CUVID 与 QSV 有独立包装解码器。

### 1.3 内部 hwaccel 与独立解码器

| 方式 | 写法 | 回退能力 | 说明 |
| --- | --- | --- | --- |
| **内部 hwaccel** | `-hwaccel cuda` / `d3d11va` / `qsv` / `vaapi` / `amf` | ✅ 不支持时自动回退软件 | **推荐**，安全 |
| **独立包装解码器** | `-c:v h264_cuvid` / `hevc_qsv` / `av1_amf` | ❌ 不回退，直接失败 | 需预先知道 codec，性能可能略好 |

---

## 2. 平台 × codec 支持矩阵

### 2.1 编码能力矩阵

| codec | NVENC | QSV | AMF | VAAPI | VideoToolbox | MF | Vulkan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **H.264** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **HEVC** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **AV1** | ✅ RTX40+ | ✅ Arc+ | ✅ RDNA3+ | ✅ 新硬件 | — | ✅ | ✅ |
| **VP9** | — | ✅ | — | ✅ | ⚠️ 部分 | — | — |
| **VP8** | — | ⚠️ 已移除 | — | ✅ | — | — | — |
| **MPEG-2** | — | ✅ | — | ✅ | — | — | — |
| **MJPEG** | — | ✅ | — | ✅ | — | — | — |
| **ProRes** | — | — | — | — | ✅ | — | ✅ |
| **VVC (H.266)** | — | ⚠️ 解码 | — | — | — | — | — |
| **FFV1** | — | — | — | — | — | — | ✅ |
| **APV** | — | — | — | — | — | — | ✅ |
| **无损** | ✅ H.264/HEVC | — | — | — | — | — | — |
| **4:4:4** | ✅ 部分代际 | ✅ gen11+ | ✅ | ⚠️ 部分 | — | — | — |

> **平台硬件的 codec 支持随代际变化**，详见 §2.3 / §2.4。

### 2.2 解码能力矩阵

| codec | NVDEC | QSV | AMF | VAAPI | D3D11VA | VideoToolbox | Vulkan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **H.264** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **HEVC** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **AV1** | ✅ Ada+ | ✅ gen12+ | ✅ RDNA3+ | ✅ | ✅ | ✅ | ✅ |
| **VP9** | ✅ Pascal+ | ✅ | ✅ | ✅ | ✅ | ⚠️ 部分 | ✅ |
| **VP8** | ✅ | ✅ | — | ✅ | ✅ | — | — |
| **MPEG-2** | ✅ | ✅ | — | ✅ | ✅ | — | — |
| **MPEG-4** | ✅ | — | — | ✅ | ✅ | — | — |
| **VC-1** | ✅ | ✅ | — | ✅ | ✅ | — | — |
| **MJPEG** | ✅ | ✅ | — | ✅ | ✅ | — | — |
| **VVC** | — | ✅ | — | ⚠️ | — | — | — |
| **10bit** | ✅ Pascal+ | ✅ gen9.5+ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **4:4:4** | ✅ 部分 | ✅ gen11+ | ⚠️ | ⚠️ | ⚠️ | — | — |

### 2.3 NVIDIA NVENC 代际能力（摘自官方支持矩阵）

| 代际 | 代表显卡 | H.264 | HEVC | AV1 | 4:2:2 | 4:4:4 | 10bit | 无损 | 最大并发 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Blackwell** | RTX 50 系 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 12 |
| **Ada Lovelace** | RTX 40 系 | ✅ | ✅ | ✅ | ⚠️ 桌面无 | ✅ | ✅ | ✅ | 12 |
| **Ampere** | RTX 30 系 | ✅ | ✅ | — | ⚠️ 部分 | ✅ | ✅ | ✅ | 12 |
| **Turing** | RTX 20 系 | ✅ | ✅ | — | — | ✅ | ✅ | ✅ | 12 |
| **Pascal** | GTX 10 系 | ✅ | ✅ | — | — | — | ⚠️ | — | 8 |

> 关键节点：
> - **AV1 编码需 Ada（RTX 40）及以上**
> - **HEVC 4:2:2 需专业卡或 Blackwell**（消费级 Ada 不支持）
> - **并发会话数**：消费级卡历史上限制 2~3 路，近期驱动放宽到 8~12 路；专业卡无限制

### 2.4 Intel QSV 代际能力（摘自官方文档）

| 平台 | 代际 | 新增支持 |
| --- | --- | --- |
| Ironlake | gen5 | MPEG-2、H.264 **解码** |
| Sandy Bridge | gen6 | VC-1 解码；**H.264 编码** |
| Ivy Bridge | gen7 | JPEG 解码；**MPEG-2 编码** |
| Broadwell | gen8 | VP8 解码 |
| Braswell | gen8 | H.265 解码；JPEG、VP8 编码 |
| Skylake | gen9 | **H.265 编码** |
| Apollo Lake | gen9 | VP9、H.265 Main10 解码 |
| Kaby Lake | gen9.5 | VP9 profile2 解码；**VP9、H.265 Main10 编码** |
| Ice Lake | gen11 | H.265 8bit 4:2:2/4:4:4 编解码；VP9 8/10bit 4:4:4 |
| Tiger Lake | gen12 | **AV1 8/10bit**、H.265 12bit 解码、VP9 12bit 解码 |
| **DG2 (Arc)** | gen12 | **AV1 编码** |

> 关键节点：**AV1 编码需 DG2（Arc 独显）及以上**；核显在 gen12 之前无 AV1。

---

## 3. codec / profile / level / 像素格式矩阵

### 3.1 各编码器支持的 profile（本机实测）

| 编码器 | 支持的 profile |
| --- | --- |
| `h264_nvenc` | `baseline` `main` `high` `high10` `high422` `high444p` |
| `hevc_nvenc` | `main` `main10` `rext` `mv` |
| `h264_qsv` | `unknown` `baseline` `main` `high` |
| `hevc_qsv` | `unknown` `main` `main10` `mainsp` `rext` `scc` |
| `h264_amf` | `main` `high` `constrained_baseline` `constrained_high` |
| `hevc_amf` | `main` `main10` |
| `h264_vaapi` | `constrained_baseline` `main` `high` `high10` |
| `hevc_vaapi` | `main` `main10`（`tier`: main/high） |
| `h264_vulkan` / `hevc_vulkan` | 由驱动决定 |

**profile 选择要点：**

| 场景 | H.264 | HEVC |
| --- | --- | --- |
| **最广兼容** | `baseline`（无 B 帧，老设备） | `main` |
| **常规推荐** | `high` | `main` |
| **10bit** | `high10` | `main10` |
| **4:2:2 / 4:4:4** | `high422` / `high444p` | `rext` |
| **屏幕内容** | — | `scc`（QSV） |

### 3.2 level 支持范围

| 编码器 | level 参数范围 | 说明 |
| --- | --- | --- |
| `h264_nvenc` | 0~62 | 0=auto；10→1.0、41→4.1、51→5.1 |
| `hevc_nvenc` | 0~186 | 30→1.0、120→4.0、150→5.0、186→6.2 |
| `h264_vaapi` / `hevc_vaapi` | -99~255 | level_idc / general_level_idc |
| `h264_qsv` / `hevc_qsv` | 通过 `qsv_params` 透传 | |

**H.264 level 与分辨率/帧率/码率上限对照（常用）：**

| level | 最大分辨率@帧率 | 最大码率（High profile） |
| --- | --- | --- |
| 3.1 | 1280×720 @30 | 14 Mbps |
| 4.0 | 1920×1080 @30 | 20 Mbps |
| 4.1 | 1920×1080 @30 | 50 Mbps |
| 4.2 | 1920×1080 @60 | 50 Mbps |
| 5.0 | 1920×1080 @60 | 135 Mbps |
| 5.1 | 2560×1440 @60 | 240 Mbps |
| 5.2 | 3840×2160 @60 | 240 Mbps |
| 6.0 | 3840×2160 @60 | 240 Mbps |
| 6.1 | 4096×2160 @60 | 480 Mbps |
| 6.2 | 4096×2160 @120 | 800 Mbps |

**HEVC level（general_level_idc = level×30）：**

| level | idc | 典型用途 |
| --- | --- | --- |
| 4.0 | 120 | 1080p30 |
| 4.1 | 123 | 1080p60 |
| 5.0 | 150 | 4K30 |
| 5.1 | 153 | 4K60 |
| 6.0 | 180 | 8K30 |
| 6.2 | 186 | 8K60 |

### 3.3 像素格式支持矩阵（本机实测）

| 编码器 | 支持的像素格式 |
| --- | --- |
| `h264_nvenc` / `hevc_nvenc` / `av1_nvenc` | `yuv420p` `nv12` `p010le` `yuv444p` `p012le` `nv24` `p016le` `nv16` `p210le` `p212le` `p216le` `yuv444p10msble` `yuv444p12msble` `yuv444p16le` `p410le` `p412le` `p416le` `bgr0` `bgra` `rgb0` `rgba` `x2rgb10le` `x2bgr10le` `gbrp` `gbrp10msble` `gbrp16le` **`cuda` `cuarray` `d3d11`** |
| `h264_qsv` | `nv12` **`qsv`** |
| `hevc_qsv` | `nv12` `p010le` `p012le` `yuyv422` `y210le` **`qsv`** `bgra` `x2rgb10le` `vuyx` `xv30le` |
| `av1_qsv` | `nv12` `p010le` **`qsv`** |
| `h264_vaapi` / `hevc_vaapi` / `av1_vaapi` | **`vaapi`**（仅硬件表面） |
| `h264_amf` / `hevc_amf` / `av1_amf` | `nv12` `yuv420p` **`d3d11` `dxva2_vld`** `p010le` **`amf`** `bgr0` `rgb0` `bgra` `argb` `rgba` `x2bgr10le` `rgbaf16le` |
| `h264_mf` / `hevc_mf` / `av1_mf` | `nv12` `yuv420p` **`d3d11`** |
| `h264_vulkan` / `hevc_vulkan` | **`vulkan`** |

**加粗**的是硬件表面格式（零拷贝路径）。**关键规律**：

- **NVENC**：像素格式最丰富，且**可直接接受 `cuda`/`d3d11` 硬件帧**（零拷贝）
- **QSV**：主用 `nv12`/`p010le`，硬件帧用 `qsv`
- **VAAPI**：**只接受 `vaapi` 表面**，软件帧必须先 `hwupload`
- **AMF**：可用 `d3d11`/`dxva2_vld` 硬件帧，也可用 `nv12` 软件帧
- **MF**：`nv12`/`yuv420p`/`d3d11`

### 3.4 位深与色度支持速查

| 组合 | NVENC | QSV | AMF | VAAPI | MF | Vulkan |
| --- | --- | --- | --- | --- | --- | --- |
| 8bit 4:2:0 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 10bit 4:2:0 | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| 12bit 4:2:0 | ✅ | ⚠️ | — | ⚠️ | — | ⚠️ |
| 8bit 4:2:2 | ⚠️ 专业卡 | ✅ gen11+ | — | ⚠️ | — | ⚠️ |
| 8bit 4:4:4 | ⚠️ | ✅ gen11+ | ⚠️ | ⚠️ | — | ⚠️ |
| 10bit 4:4:4 | ⚠️ | ✅ gen11+ | — | ⚠️ | — | — |
| RGB | ✅ | ✅ 部分 | ✅ | ⚠️ | — | ⚠️ |

```bash
# 10bit HEVC 硬件编码（推荐 p010le）
ffmpeg -i in.mp4 -c:v hevc_nvenc -preset p6 -cq 24 -pix_fmt p010le out.mp4

# 8bit 输入产出 10bit（NVENC 专用开关）
ffmpeg -i in.mp4 -c:v hevc_nvenc -cq 24 -highbitdepth 1 out.mp4

# 4:4:4 输出（需硬件与 profile 支持）
ffmpeg -i in.mp4 -c:v h264_nvenc -profile high444p -pix_fmt yuv444p -cq 20 out.mp4

# VAAPI 必须先上传到硬件表面
ffmpeg -init_hw_device vaapi=va -filter_hw_device va -i in.mp4 \
  -vf "format=nv12,hwupload" -c:v h264_vaapi -rc_mode CQP -qp 24 out.mp4
```

---

## 4. 码率控制模式与码率—体积—质量

### 4.1 各平台码控模式对照

| 概念 | NVENC | QSV | AMF | VAAPI | MF | Vulkan |
| --- | --- | --- | --- | --- | --- | --- |
| **恒定质量** | `-rc vbr -cq N` | `-global_quality N`(ICQ) | `-rc vbr_peak -qp_*` | `-rc_mode ICQ -global_quality N` | `-rate_control quality` | `-rc_mode` + `-qp` |
| **恒定 QP** | `-rc constqp -qp N` | `-qscale -global_quality N` | `-rc cqp -qp_i/-qp_p/-qp_b` | `-rc_mode CQP -qp N` | — | `-rc_mode` + `-qp` |
| **目标码率** | `-b:v` | `-b:v` | `-b:v` | `-b:v` | `-b:v` | `-b:v` |
| **CBR** | `-rc cbr -b:v -maxrate -bufsize` | `-b:v -maxrate`(相等) | `-rc cbr` | `-rc_mode CBR` | `-rate_control cbr` | `-rc_mode` |
| **受限 VBR** | `-rc vbr -b:v -maxrate -bufsize` | `-b:v -maxrate`(maxrate>b) | `-rc vbr_peak` | `-rc_mode VBR` | `-rate_control pc_vbr` | — |
| **AVBR** | — | `avbr_accuracy`+`avbr_convergence` | — | `-rc_mode AVBR` | — | — |
| **QVBR** | — | — | `-qvbr_quality_level` | `-rc_mode QVBR` | — | — |
| **两遍** | `-multipass fullres` | `-extbrc` | `-preanalysis` | — | — | — |

**NVENC `-rc` 取值：** `constqp`(0) `vbr`(1) `cbr`(2)
**AMF `-rc` 取值：** `cqp` / `cbr` / `vbr_peak` / `vbr_latency`
**VAAPI `-rc_mode` 取值：** `auto` `CQP` `CBR` `VBR` `ICQ` `QVBR` `AVBR`
**MF `-rate_control` 取值：** `default` `cbr` `pc_vbr` `u_vbr` `quality` `ld_vbr` `g_vbr` `gld_vbr`

### 4.2 质量参数刻度对照

| 平台 | 参数 | 范围 | 方向 | 常用值 |
| --- | --- | --- | --- | --- |
| NVENC | `-cq` | 0~51 | **越小越好** | 19~28 |
| QSV | `-global_quality` | 1~51 | **越小越好** | 20~30 |
| AMF | `-qp_i/-qp_p/-qp_b` | 0~51 | **越小越好** | 22~30 |
| VAAPI | `-global_quality` | 1~52 | **越小越好** | 22~30 |
| VAAPI | `-qp` | 0~52 | **越小越好** | 22~30 |
| MF | `-quality` | 0~100 | **越大越好** | 70~90 |
| Vulkan | `-qp` | — | **越小越好** | — |

> ⚠️ **方向差异**：MF 的 `-quality` 是**越大越好**，其他平台都是**越小越好**。混用极易出错。

### 4.3 推荐码率参考表

**H.264 硬件编码（NVENC/QSV/AMF，同质量下比软件高 20%~50%）：**

| 分辨率 | 帧率 | 低码率 | 推荐 | 高质量 |
| --- | --- | --- | --- | --- |
| 480p | 30 | 800k | 1.5M | 2.5M |
| 720p | 30 | 1.5M | 3M | 5M |
| 720p | 60 | 2.5M | 4.5M | 7M |
| 1080p | 30 | 3M | 6M | 10M |
| 1080p | 60 | 4.5M | 9M | 15M |
| 1440p | 30 | 5M | 10M | 16M |
| 2160p (4K) | 30 | 10M | 20M | 35M |
| 2160p (4K) | 60 | 15M | 30M | 50M |

**HEVC 硬件编码（同质量约省 30%~50% 码率）：**

| 分辨率 | 帧率 | 推荐 | 高质量 |
| --- | --- | --- | --- |
| 720p | 30 | 2M | 3.5M |
| 1080p | 30 | 4M | 7M |
| 1080p | 60 | 6M | 10M |
| 2160p (4K) | 30 | 12M | 22M |
| 2160p (4K) | 60 | 20M | 35M |

**AV1 硬件编码（比 HEVC 再省约 20%~30%）：**

| 分辨率 | 帧率 | 推荐 |
| --- | --- | --- |
| 1080p | 30 | 3M |
| 1080p | 60 | 5M |
| 2160p (4K) | 30 | 10M |
| 2160p (4K) | 60 | 16M |

> 这些是**起点值**。硬件编码的质量效率低于软件编码，追求同质量需再上调 20%~50%。

### 4.4 VBV 约束与体积控制

**VBV（Video Buffering Verifier）** 限制码率波动，是流媒体必需：

```bash
# CRF/CQ 恒定质量 + VBV 峰值封顶（点播推荐）
ffmpeg -i in.mp4 -c:v h264_nvenc -rc vbr -cq 23 -b:v 0 -maxrate 8M -bufsize 16M out.mp4

# 严格 CBR（直播必需）
ffmpeg -i in.mp4 -c:v h264_nvenc -rc cbr -b:v 6M -maxrate 6M -bufsize 12M -zerolatency 1 out.flv

# QSV CBR
ffmpeg -i in.mp4 -c:v h264_qsv -b:v 6M -maxrate 6M -bufsize 12M -low_delay_brc 1 out.flv

# AMF CBR + HRD 强制
ffmpeg -i in.mp4 -c:v h264_amf -rc cbr -b:v 6M -enforce_hrd 1 -filler_data 1 out.flv
```

**bufsize 经验法则：**

| 场景 | bufsize | 理由 |
| --- | --- | --- |
| 直播低延迟 | `1×maxrate` | 最小缓冲，最低延迟 |
| 常规直播 | `2×maxrate` | 平衡 |
| 点播/文件 | `2~4×maxrate` | 允许更大波动，质量更稳 |
| 蓝光/广播 | 按标准（如 H.264 的 `maxrate×1`） | 合规要求 |

**体积估算公式：**

```
文件大小(MB) ≈ 视频码率(Mbps) × 时长(秒) ÷ 8 + 音频码率(Mbps) × 时长(秒) ÷ 8
```

```bash
# 目标体积反推码率：1 小时视频控制在 2GB
# 2000MB × 8 ÷ 3600s ≈ 4.4 Mbps（含音频 128k，视频约 4.3M）
ffmpeg -i in.mp4 -c:v h264_nvenc -rc vbr -b:v 4300k -maxrate 6M -bufsize 12M \
  -c:a aac -b:a 128k -movflags +faststart out.mp4

# 用 -fs 硬限制文件大小（超出即停止写入）
ffmpeg -i in.mp4 -c:v h264_nvenc -cq 24 -fs 500M out.mp4

# 两遍编码精确命中目标码率（NVENC）
ffmpeg -y -i in.mp4 -c:v hevc_nvenc -b:v 4M -multipass fullres -an -f mp4 NUL
ffmpeg -i in.mp4 -c:v hevc_nvenc -b:v 4M -multipass fullres -c:a copy out.mp4
```

### 4.5 分辨率与码率的关系

```bash
# 同一内容不同分辨率的码率缩放（经验）
# 像素数减半 → 码率可减半（近似）
# 1080p 6M → 720p 约 3M → 480p 约 1.5M

# 批量生成阶梯码率（HLS 常用）
ffmpeg -i in.mp4 \
  -map 0:v -map 0:a -map 0:v -map 0:a -map 0:v -map 0:a \
  -c:v:0 h264_nvenc -b:v:0 6M -s:v:0 1920x1080 -preset p4 \
  -c:v:1 h264_nvenc -b:v:1 3M -s:v:1 1280x720  -preset p4 \
  -c:v:2 h264_nvenc -b:v:2 1.5M -s:v:2 854x480  -preset p4 \
  -c:a aac -b:a 128k -ac 2 out.mp4
```

---

## 5. 容器与封装兼容性

### 5.1 codec × 容器兼容矩阵

| 容器 | H.264 | HEVC | AV1 | VP9 | VP8 | MPEG-2 | ProRes | 音频 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **MP4** | ✅ | ✅ 需 `hvc1` | ✅ | ⚠️ 非标准 | — | ⚠️ | ⚠️ | AAC/AC3/MP3 |
| **MKV** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 几乎全部 |
| **MOV** | ✅ | ✅ | ⚠️ | — | — | ⚠️ | ✅ | AAC/PCM |
| **TS** | ✅ | ✅ | ✅ | — | — | ✅ | — | AAC/AC3/MP2 |
| **WebM** | — | — | ✅ | ✅ | ✅ | — | — | Vorbis/Opus |
| **FLV** | ✅ | ⚠️ | — | — | — | — | — | AAC/MP3 |
| **AVI** | ✅ | ⚠️ | ⚠️ | — | — | ✅ | — | 多数 |

**关键结论：**

| 需求 | 推荐容器 | 注意 |
| --- | --- | --- |
| **最大兼容性** | MP4 + H.264 | 加 `-movflags +faststart` |
| **高质量小体积** | MKV + HEVC | 或 MP4 + HEVC + `-tag:v hvc1` |
| **现代压缩** | MKV + AV1 | MP4 + AV1 也可（新播放器） |
| **网页内嵌** | WebM + VP9/AV1 | 或 MP4 + H.264 |
| **直播推流** | FLV/TS | RTMP 用 FLV，SRT/HLS 用 TS |
| **Apple 生态** | MP4 + HEVC + `hvc1` | **必须加 tag**，否则 QuickTime 不识别 |
| **专业中间格式** | MOV + ProRes | 剪辑工作流 |

### 5.2 HEVC 在 MP4 中的 tag（最关键的兼容性开关）

FFmpeg 默认给 HEVC 写 `hev1` tag，**Apple 生态（QuickTime/Safari/iOS）只认 `hvc1`**：

```bash
# ✅ Apple 兼容的 HEVC MP4（必须加 -tag:v hvc1）
ffmpeg -i in.mp4 -c:v hevc_nvenc -preset p5 -cq 24 -tag:v hvc1 -movflags +faststart out.mp4

# 从 MKV 转 MP4 时同样需要
ffmpeg -i in.mkv -c:v copy -c:a copy -tag:v hvc1 -movflags +faststart out.mp4
```

| tag | 含义 | 兼容性 |
| --- | --- | --- |
| `hev1` | HEVC，参数集可带内（默认） | Android/多数播放器 |
| `hvc1` | HEVC，参数集必须在带外 | **Apple 生态必需** |

> 实测报错参考：若源是 H.264 而强行加 `-tag:v hvc1`，会报
> `Tag hvc1 incompatible with output codec id '27' (avc1)`——tag 必须与 codec 匹配。

### 5.3 MP4 封装关键选项

| 选项 | 说明 |
| --- | --- |
| `-movflags +faststart` | **moov 前置**，网络播放必须先下载完元数据才能播 |
| `-movflags +frag_keyframe+empty_moov` | 分片 MP4（fMP4），适合流式传输 |
| `-movflags +faststart+use_metadata_tags` | 使用 mdta 存元数据 |
| `-brand <brand>` | 覆盖 major brand（如 `isom`/`mp42`/`avc1`） |
| `-video_track_timescale N` | 视频轨时间基（兼容性调优） |
| `-use_editlist 0` | 禁用 edit list（修复部分播放器音画不同步） |
| `-mov_gamma N` | 设置 gamma（老 QuickTime 兼容） |
| `-write_btrt 1` | 写入 bitrate box |

```bash
# Web 播放优化（最常用）
ffmpeg -i in.mp4 -c:v h264_nvenc -cq 23 -c:a aac -movflags +faststart web.mp4

# fMP4（DASH/HLS 用）
ffmpeg -i in.mp4 -c:v h264_nvenc -cq 23 -movflags +frag_keyframe+empty_moov dash.mp4

# 修复部分播放器音画不同步
ffmpeg -i in.mp4 -c copy -use_editlist 0 fixed.mp4
```

### 5.4 硬件编码到直播容器

```bash
# RTMP（FLV 容器，必须 H.264 + AAC）
ffmpeg -re -i in.mp4 \
  -c:v h264_nvenc -preset p4 -tune ll -rc cbr -b:v 6M -maxrate 6M -bufsize 12M \
  -zerolatency 1 -g 50 -bf 0 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 \
  -f flv rtmp://live.example.com/app/key

# SRT / UDP（TS 容器，可用 HEVC）
ffmpeg -re -i in.mp4 \
  -c:v hevc_nvenc -preset p4 -rc cbr -b:v 8M -maxrate 8M -bufsize 16M \
  -c:a aac -b:a 128k -f mpegts "srt://host:9000?mode=caller"

# HLS（TS 分片，H.264 最兼容）
ffmpeg -i in.mp4 \
  -c:v h264_nvenc -preset p4 -b:v 6M -maxrate 6M -bufsize 12M \
  -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 \
  -hls_segment_filename "seg_%03d.ts" index.m3u8

# HLS fMP4 分片（HEVC/AV1 更合适）
ffmpeg -i in.mp4 \
  -c:v hevc_nvenc -preset p5 -b:v 4M \
  -c:a aac -b:a 128k \
  -f hls -hls_time 6 -hls_segment_type fmp4 -hls_list_size 0 index.m3u8
```

### 5.5 容器选择决策树

```
输出用途？
├─ 网页/移动端播放（要最广兼容）
│   └─ MP4 + H.264 + AAC + faststart
├─ 本地归档（要小体积）
│   ├─ MP4 + HEVC + hvc1（Apple 也要播）
│   └─ MKV + HEVC/AV1（自家播放器）
├─ Apple 生态（QuickTime/iOS/Safari）
│   └─ MP4 + H.264 或 HEVC + **必须 -tag:v hvc1**
├─ 浏览器内嵌（现代浏览器）
│   └─ WebM + VP9/AV1 + Opus
├─ 直播推流
│   ├─ RTMP → FLV + H.264
│   └─ SRT/RIST → TS + H.264/HEVC
└─ 剪辑中间格式
    └─ MOV + ProRes（Vulkan 硬件可编）
```

---

## 6. 全硬件工作流程

> **核心目标**：让数据**全程留在显存**，避免 GPU↔CPU 往返拷贝。往返一次就要下载 + 上传两次全帧数据，1080p60 下是数 GB/s 的带宽消耗。

### 6.1 全硬件管线的三个层次

```
① 硬件解码  →  ② 硬件滤镜  →  ③ 硬件编码
-hwaccel X            _cuda/_qsv/       -c:v xxx_nvenc/
-hwaccel_output_format  _vaapi 滤镜       xxx_qsv/xxx_amf
   ↓                      ↓                    ↓
显存帧 ──────────────→ 显存帧 ──────────→ 显存帧
（全程零拷贝，CPU 仅做调度）
```

**关键要求：**

1. `-hwaccel_output_format` 必须设为硬件格式（否则帧会下载到内存）
2. 滤镜必须用对应平台的硬件滤镜（否则需要下载/上传）
3. 编码器必须能接受该硬件格式（见 §7 配对表）

### 6.2 NVIDIA 全硬件管线（CUDA）

```bash
# 最小全硬件管线：硬解 → 硬缩放 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=1920:1080" \
  -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 24 -b:v 0 \
  -c:a copy out.mp4

# 完整管线：硬解 → 去隔行 → 缩放 → 降噪 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.ts \
  -vf "yadif_cuda=mode=1,scale_cuda=1920:1080:interp_algo=lanczos,bilateral_cuda=window_size=9:sigmaS=3.0:sigmaR=50.0" \
  -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 25 -b:v 0 \
  -spatial-aq 1 -temporal-aq 1 -multipass fullres \
  -c:a copy out.mp4

# 指定 GPU（多卡服务器）
ffmpeg -hwaccel_device 1 -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=1280:720" -c:v h264_nvenc -gpu 1 -cq 24 out.mp4
```

**CUDA 硬件滤镜链（全部零拷贝）：**

```bash
# 硬解 → 转置 → 缩放 → 加边 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "transpose_cuda=dir=clock,scale_cuda=1080:1920,pad_cuda=w=1080:h=1920:x=0:y=0" \
  -c:v h264_nvenc -preset p5 -cq 24 out.mp4

# 硬解 → 色键抠像 → 叠加 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i bg.mp4 \
       -hwaccel cuda -hwaccel_output_format cuda -i fg.mp4 \
  -filter_complex "[1:v]chromakey_cuda=color=green:similarity=0.1[ck];[0:v][ck]overlay_cuda=x=0:y=0[out]" \
  -map "[out]" -map 0:a? -c:v h264_nvenc -preset p5 -cq 23 -c:a copy out.mp4

# 硬解 → 选代表帧 → 缩放 → 下载导出图片
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "thumbnail_cuda=150,scale_cuda=1920:1080,hwdownload,format=nv12" \
  -frames:v 10 "thumb_%03d.png"
```

### 6.3 Intel QSV 全硬件管线

QSV 的优势是 `vpp_qsv` 一个滤镜就能完成多项处理：

```bash
# 最小全硬件管线
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "scale_qsv=1920:1080:mode=hq" \
  -c:v hevc_qsv -preset slower -global_quality 24 -c:a copy out.mp4

# 一体化处理：去隔行 + 降噪 + 细节增强 + 缩放 + 帧率变换（单次调用）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.ts \
  -vf "vpp_qsv=deinterlace=advanced:denoise=15:detail=25:w=1920:h=1080:scale_mode=hq:framerate=30/1" \
  -c:v hevc_qsv -preset slower -global_quality 24 -scenario archive \
  -c:a copy out.mp4

# QSV 裁剪 + 缩放 + 色彩调整
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "vpp_qsv=cw=1440:ch=1080:cx=240:cy=0:w=1280:h=720:procamp=1:saturation=1.15" \
  -c:v h264_qsv -global_quality 24 out.mp4

# QSV HDR→SDR 全硬件（含色调映射）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i hdr.mkv \
  -vf "vpp_qsv=tonemap=1:format=nv12,w=1920:h=1080" \
  -c:v hevc_qsv -global_quality 24 -c:a copy sdr.mp4

# QSV 双 GPU 同时编码（HyperEncode）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -c:v hevc_qsv -dual_gfx adaptive -global_quality 24 out.mp4
```

### 6.4 AMD AMF 全硬件管线

```bash
# 官方推荐的转码配置（避免 GPU↔CPU 拷贝）
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mkv \
  -c:v hevc_amf -usage transcoding -quality quality -rc vbr_peak \
  -b:v 6M -maxrate 9M -bufsize 12M -c:a copy out.mp4

# DX9 路径（AV1 源不支持 DX9 解码）
ffmpeg -hwaccel dxva2 -hwaccel_output_format dxva2_vld -i in.mkv \
  -c:v h264_amf -quality quality -rc vbr_peak -b:v 4M out.mp4

# AV1 源转码（需额外硬件帧）
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -extra_hw_frames 10 \
  -i in_av1.mkv -c:v hevc_amf -quality quality -b:v 6M out.mp4

# AMF 缩放（vpp_amf）+ 硬编
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -vf "vpp_amf=w=1920:h=1080:scale_type=bicubic" \
  -c:v h264_amf -usage transcoding -quality quality -b:v 5M out.mp4

# AMF 帧率转换（frc_amf 无 fps 选项；用 -r 指定输出帧率）
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -vf "frc_amf=engine_type=dx11:profile=high" -r 60 \
  -c:v h264_amf -quality quality -b:v 6M out.mp4
```

### 6.5 VAAPI 全硬件管线（Linux）

```bash
# 最小全硬件管线
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi -i in.mp4 \
  -vf "scale_vaapi=w=1920:h=1080:mode=hq" \
  -c:v h264_vaapi -rc_mode ICQ -global_quality 24 -c:a copy out.mp4

# 完整管线：去隔行 + 降噪 + 锐化 + 缩放
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.ts \
  -vf "deinterlace_vaapi=mode=motion_adaptive,denoise_vaapi=denoise=10,sharpness_vaapi=sharpness=15,scale_vaapi=w=1920:h=1080" \
  -c:v h264_vaapi -rc_mode ICQ -global_quality 24 -c:a copy out.mp4

# VAAPI HDR→SDR 全硬件
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i hdr.mkv \
  -vf "tonemap_vaapi=format=nv12:t=bt709:m=bt709:p=bt709,scale_vaapi=w=1920:h=1080" \
  -c:v hevc_vaapi -rc_mode ICQ -global_quality 24 -c:a copy sdr.mp4

# VAAPI 叠加（官方示例写法）
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i input.mp4 -i logo.png \
  -filter_complex "[0:v]hwupload[a];[1:v]format=yuva420p,hwupload[b];[a][b]overlay_vaapi=x=200:y=100:w=400:h=300:alpha=0.8,hwdownload,format=nv12[out]" \
  -map "[out]" -map 0:a? -c:v h264_vaapi -qp 23 out.mp4
```

### 6.6 Vulkan 全硬件管线（跨厂商）

```bash
# 硬解 → 硬缩放 → 硬编
ffmpeg -init_hw_device vulkan -hwaccel vulkan -hwaccel_output_format vulkan -i in.mp4 \
  -vf "scale_vulkan=1920:1080" -c:v h264_vulkan -qp 24 out.mp4

# 跨设备映射（Vulkan 解 → OpenCL 处理 → 回 Vulkan 编码）
ffmpeg -init_hw_device vulkan=vk -init_hw_device opencl=cl@vk \
  -hwaccel vulkan -hwaccel_output_format vulkan -i hdr.mkv \
  -vf "hwmap=derive_device=opencl,tonemap_opencl=format=nv12,hwmap=derive_device=vulkan:reverse=1" \
  -c:v h264_vulkan -qp 24 out.mp4

# libplacebo 高质量色调映射（GPU 通用）
ffmpeg -init_hw_device vulkan -hwaccel vulkan -hwaccel_output_format vulkan -i hdr.mkv \
  -vf "libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwdownload,format=yuv420p" \
  -c:v h264_vulkan out.mp4
```

### 6.7 跨平台全硬件管线对照

| 环节 | NVIDIA | Intel QSV | AMD AMF | VAAPI | Vulkan |
| --- | --- | --- | --- | --- | --- |
| **硬解** | `-hwaccel cuda` | `-hwaccel qsv` | `-hwaccel d3d11va` | `-hwaccel vaapi` | `-hwaccel vulkan` |
| **输出格式** | `cuda` | `qsv` | `d3d11` | `vaapi` | `vulkan` |
| **缩放** | `scale_cuda` | `scale_qsv`/`vpp_qsv` | `vpp_amf` | `scale_vaapi` | `scale_vulkan` |
| **去隔行** | `yadif_cuda`/`bwdif_cuda` | `deinterlace_qsv`/`vpp_qsv` | — | `deinterlace_vaapi` | `bwdif_vulkan` |
| **降噪** | `bilateral_cuda` | `vpp_qsv`(denoise) | `vqe_amf` | `denoise_vaapi` | `nlmeans_vulkan` |
| **锐化** | — | `vpp_qsv`(detail) | `vqe_amf` | `sharpness_vaapi` | — |
| **色彩调整** | `colorspace_cuda` | `vpp_qsv`(ProcAmp) | `vpp_amf` | `procamp_vaapi` | — |
| **色调映射** | — | `vpp_qsv`(tonemap) | — | `tonemap_vaapi` | `libplacebo` |
| **叠加** | `overlay_cuda` | `overlay_qsv` | — | `overlay_vaapi` | `overlay_vulkan` |
| **加边** | `pad_cuda` | — | — | `pad_vaapi` | — |
| **转置** | `transpose_cuda` | `vpp_qsv` | — | `transpose_vaapi` | `transpose_vulkan` |
| **帧率** | — | `vpp_qsv`(framerate) | `frc_amf` | — | `fruc_vulkan` |
| **多画面** | — | `hstack_qsv` 等 | — | `hstack_vaapi` 等 | — |
| **编码** | `*_nvenc` | `*_qsv` | `*_amf` | `*_vaapi` | `*_vulkan` |

> **NVIDIA 的短板**：没有硬件锐化/色调映射/多画面滤镜，这些需 `hwdownload` 回 CPU 或用 `libplacebo`。
> **QSV 的优势**：`vpp_qsv` 单滤镜覆盖最多功能，全硬管线最简洁。
> **VAAPI 的限制**：只接受 `vaapi` 表面，软件帧必须先 `hwupload`。

### 6.8 混合管线（必须回 CPU 的场景）

当所需滤镜没有硬件实现时，只能「下载 → 软件处理 → 上传」：

```bash
# 硬解 → 下载 → 软件滤镜 → 上传 → 硬编
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "hwdownload,format=nv12,eq=contrast=1.1:saturation=1.15,unsharp=5:5:0.8,hwupload_cuda" \
  -c:v hevc_nvenc -preset p6 -cq 24 out.mp4

# 硬解 + 软件水印 + 硬编（最常见的混合场景）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 -i logo.png \
  -filter_complex "[0:v]hwdownload,format=nv12[base];[base][1:v]overlay=10:10[ov];[ov]hwupload_cuda[out]" \
  -map "[out]" -map 0:a? -c:v h264_nvenc -preset p5 -cq 23 -c:a copy out.mp4

# 硬解 + 字幕烧录 + 硬编（libass 只能 CPU）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mkv \
  -vf "hwdownload,format=nv12,subtitles=subs.srt,hwupload_cuda" \
  -c:v hevc_nvenc -preset p6 -cq 24 -c:a copy out.mp4
```

> **性能提示**：一次往返（下载+上传）在 1080p60 下约消耗 0.5~1 个 CPU 核心的等效带宽。
> 若往返不可避免，考虑直接用软件编码路径反而更简单。

### 6.9 典型工作流配方

**① 批量转码（最高吞吐）**

```bash
#!/usr/bin/env bash
# 全硬件管线批量转 1080p HEVC
for f in ./src/*.mp4; do
  out="./dst/$(basename "$f")"
  ffmpeg -y -hide_banner -loglevel error \
    -hwaccel cuda -hwaccel_output_format cuda -i "$f" \
    -vf "scale_cuda=1920:1080:interp_algo=lanczos" \
    -c:v hevc_nvenc -preset p6 -tune hq -rc vbr -cq 26 -b:v 0 \
    -spatial-aq 1 -temporal-aq 1 \
    -c:a copy -movflags +faststart "$out"
done
```

**② 直播推流（最低延迟）**

```bash
ffmpeg -re -i in.mp4 \
  -c:v h264_nvenc -preset p4 -tune ll -rc cbr -b:v 6M -maxrate 6M -bufsize 12M \
  -zerolatency 1 -g 50 -bf 0 -pix_fmt yuv420p \
  -c:a aac -b:a 160k -ar 48000 -ac 2 \
  -f flv rtmp://live.example.com/app/key
```

**③ HLS 多码率（全硬件）**

```bash
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i input.mp4 \
  -filter_complex "\
    [0:v]split=3[v1][v2][v3];\
    [v1]scale_cuda=1920:1080[a];\
    [v2]scale_cuda=1280:720[b];\
    [v3]scale_cuda=854:480[c]" \
  -map "[a]" -map 0:a -map "[b]" -map 0:a -map "[c]" -map 0:a \
  -c:v:0 h264_nvenc -b:v:0 6M -maxrate:v:0 6M -bufsize:v:0 12M -preset p4 \
  -c:v:1 h264_nvenc -b:v:1 3M -maxrate:v:1 3M -bufsize:v:1 6M  -preset p4 \
  -c:v:2 h264_nvenc -b:v:2 1.5M -maxrate:v:2 1.5M -bufsize:v:2 3M -preset p4 \
  -c:a aac -b:a 128k -ac 2 \
  -var_stream_map "v:0,a:0 v:1,a:1 v:2,a:2" \
  -master_pl_name master.m3u8 \
  -f hls -hls_time 6 -hls_playlist_type vod -hls_list_size 0 \
  -hls_segment_filename "hls/stream_%v/seg_%03d.ts" \
  "hls/stream_%v/index.m3u8"
```

**④ HDR → SDR（全硬件）**

```bash
# NVIDIA + libplacebo（质量最佳）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i hdr.mkv \
  -vf "hwdownload,format=p010le,libplacebo=tonemapping=bt.2390:colorspace=bt709:color_primaries=bt709:color_trc=bt709:format=yuv420p,hwupload_cuda" \
  -c:v hevc_nvenc -preset p6 -cq 24 -c:a copy sdr.mp4

# Intel QSV（纯硬件，最简洁）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i hdr.mkv \
  -vf "vpp_qsv=tonemap=1:format=nv12,hwdownload,format=nv12" \
  -c:v hevc_qsv -global_quality 24 -c:a copy sdr.mp4
```

**⑤ 多 GPU 并行（服务器）**

```bash
# 两块 GPU 分别处理不同文件
ffmpeg -hwaccel_device 0 -hwaccel cuda -hwaccel_output_format cuda -i a.mp4 \
  -vf "scale_cuda=1920:1080" -c:v hevc_nvenc -preset p6 -cq 26 a_out.mp4 &
ffmpeg -hwaccel_device 1 -hwaccel cuda -hwaccel_output_format cuda -i b.mp4 \
  -vf "scale_cuda=1920:1080" -c:v hevc_nvenc -preset p6 -cq 26 b_out.mp4 &
wait

# 监控利用率
nvidia-smi dmon -s u -d 1
```

**⑥ 带硬件回退的生产脚本**

```bash
#!/usr/bin/env bash
# 硬件失败自动回退软件
transcode() {
  local input="$1" output="$2"
  if ffmpeg -y -hide_banner -loglevel error \
       -hwaccel cuda -hwaccel_output_format cuda -i "$input" \
       -vf "scale_cuda=-2:1080" \
       -c:v hevc_nvenc -preset p6 -rc vbr -cq 26 -b:v 0 -c:a copy "$output" 2>/tmp/ff.err; then
    echo "OK (NVENC): $output"
  else
    echo "NVENC 失败，回退软件：$(head -1 /tmp/ff.err)" >&2
    ffmpeg -y -hide_banner -loglevel error -i "$input" \
      -vf "scale=-2:1080" -c:v libx265 -preset medium -crf 25 -c:a copy "$output"
    echo "OK (x265): $output"
  fi
}
transcode in.mp4 out.mp4
```

---

## 7. 硬解 × 硬编配对表

### 7.1 同平台配对（零拷贝，推荐）

| 解码 | 中间格式 | 编码 | 是否需要 upload | 说明 |
| --- | --- | --- | --- | --- |
| `-hwaccel cuda` | `cuda` | `*_nvenc` | ❌ 不需要 | **最佳**，全程显存 |
| `-hwaccel qsv` | `qsv` | `*_qsv` | ❌ 不需要 | **最佳** |
| `-hwaccel vaapi` | `vaapi` | `*_vaapi` | ❌ 不需要 | **最佳** |
| `-hwaccel d3d11va` | `d3d11` | `*_amf` | ❌ 不需要 | AMF 接受 d3d11 帧 |
| `-hwaccel d3d11va` | `d3d11` | `*_nvenc` | ❌ 不需要 | NVENC 接受 d3d11 |
| `-hwaccel d3d11va` | `d3d11` | `*_mf` | ❌ 不需要 | MF 接受 d3d11 |
| `-hwaccel vulkan` | `vulkan` | `*_vulkan` | ❌ 不需要 | |
| `-hwaccel dxva2` | `dxva2_vld` | `*_amf` | ❌ 不需要 | AMD DX9 路径 |

### 7.2 跨平台配对（需要转换或映射）

| 解码 | 目标编码 | 方案 |
| --- | --- | --- |
| CUDA | `*_qsv` | `hwmap=derive_device=qsv` 或 `hwdownload`+`hwupload` |
| QSV | `*_nvenc` | `hwdownload,format=nv12,hwupload_cuda` |
| VAAPI | `*_nvenc` | `hwmap=derive_device=cuda:reverse=1` |
| D3D11 | `*_vaapi` | 不直接支持，需下载上传 |
| 软件解码 | 任意硬件编码器 | **自动处理**（FFmpeg 自动插入 upload） |

```bash
# 软件解码 → 硬件编码（自动上传，无需显式 hwupload）
ffmpeg -i in.mp4 -c:v h264_nvenc -cq 24 out.mp4

# CUDA 解码 → QSV 编码（显式转换）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "hwdownload,format=nv12,hwupload=derive_device=qsv,format=qsv" \
  -c:v hevc_qsv -global_quality 24 out.mp4

# VAAPI 解码 → NVENC 编码（跨设备映射）
ffmpeg -hwaccel vaapi -hwaccel_output_format vaapi -i in.mp4 \
  -vf "hwmap=derive_device=cuda:reverse=1" \
  -c:v hevc_nvenc -cq 24 out.mp4
```

### 7.3 编码器接受哪些硬件帧（本机实测）

| 编码器 | 接受的硬件格式 |
| --- | --- |
| `h264_nvenc` / `hevc_nvenc` / `av1_nvenc` | `cuda`、`cuarray`、`d3d11` |
| `h264_qsv` / `hevc_qsv` / `av1_qsv` | `qsv` |
| `h264_vaapi` / `hevc_vaapi` / `av1_vaapi` | `vaapi` |
| `h264_amf` / `hevc_amf` / `av1_amf` | `d3d11`、`dxva2_vld`、`amf` |
| `h264_mf` / `hevc_mf` / `av1_mf` | `d3d11` |
| `h264_vulkan` / `hevc_vulkan` / `av1_vulkan` | `vulkan` |

> **NVENC 最灵活**：同时接受 CUDA、D3D11 两种硬件帧，可与 NVDEC 或 D3D11VA 解码配对。

---

## 8. 兼容性陷阱与验证方法

### 8.1 常见陷阱

| 陷阱 | 现象 | 原因与解决 |
| --- | --- | --- |
| **忘记设 `-hwaccel_output_format`** | 硬解比软解还慢 | 帧被下载到内存；加 `-hwaccel_output_format cuda` 等 |
| **硬件编码器不支持该 pix_fmt** | `No NVENC capable devices found` / `Function not implemented` | 查 §3.3；显式加 `-pix_fmt nv12` 或 `yuv420p` |
| **AV1 编码在老 GPU 上失败** | 编码器初始化失败 | AV1 需 RTX40+/Arc+/RDNA3+；降级用 HEVC |
| **`hvc1` tag 用错 codec** | `Tag hvc1 incompatible with output codec id` | tag 必须匹配 codec；H.264 用 `avc1` |
| **HEVC MP4 在 Apple 设备不播** | QuickTime 打不开 | 加 `-tag:v hvc1` |
| **MP4 不能封 ASS 字幕** | `Subtitle codec not supported` | MP4 只能 `mov_text`；或改用 MKV |
| **VAAPI 用软件帧** | `Impossible to convert between the formats` | 加 `format=nv12,hwupload` |
| **`-hwaccel qsv` 与滤镜冲突** | 滤镜报错 | `-hwaccel qsv` 加速转码模式**不允许滤镜**；改用 `-hwaccel_output_format qsv` + `_qsv` 滤镜 |
| **消费级卡并发超限** | 第 3+ 路编码失败 | 查并发会话数限制（§2.3）；专业卡无限制 |
| **`-cq` 单独用不生效** | 质量参数无效 | NVENC 需 `-rc vbr` 配合；QSV 用 `-global_quality` |
| **`-quality` 方向搞反** | MF 输出质量极差 | MF `-quality` **越大越好**；其他平台越小越好 |
| **AV1 转码缺硬件帧** | AMF 报错 | 加 `-extra_hw_frames 10` |
| **跨平台 hwmap 失败** | `Failed to map frame` | 设备必须同源（同一块卡）；否则用 hwdownload/hwupload |
| **`-hwaccel X` 遇不支持的 profile → 静默软解** | 退出码 0，看似成功，实际全程软解（例：`-hwaccel cuda` + h264 High 10） | 硬解初始化失败**不报错**（`Failed setup for format cuda` 只在 warning/verbose 可见）。判定必须靠能力预检，或显式 `-hwaccel_output_format <hwfmt>` 让硬件帧成为硬性要求 |
| **硬解却把帧下载回来做 CPU filter** | 比干脆软解还慢（720p→360p 实测 17.1x vs 25.1x） | 位置一致性：帧在哪解码，filter 就放哪。硬解不可用时**不要**指定 `-hwaccel`，整链留在内存 + 硬编 |
| **软解链路里指望 `scale_cuda` 自动上传** | `Impossible to convert between the formats supported by the filter` | **不会自动插入 hwupload**：必须显式 `hwupload_cuda,` 前缀（自带设备）或 `-init_hw_device cuda=cu -filter_hw_device cu` + `hwupload`；且软解路径下 GPU scale 实测不划算（多一次上传） |
| **`scale_cuda`/`scale_vulkan` 不给 `format=`** | 硬件编码器报 `Invalid argument` | 必须显式 `format=nv12`（8bit）/ `format=p010le`（10bit）；**不要**用 `-pix_fmt` 对接硬件帧（等价于强制下载 → 失败） |
| **`hwdownload` 不给 `format=`** | `Invalid output format monow for hwframe download` | 显式给，且同时匹配位深与色度：420→`nv12`/`p010`/`p012`；422→`yuv422p`/`p210`；444→`yuv444p`/`yuv444p10le` |
| **`scale_d3d11`** | `Could not create the texture (80070057)`，**对照文件同样失败** | 本机 D3D11 硬 scale 链路整体不可用（工具链级，与素材无关）→ d3d 层用 CPU `scale=`；`scale_d3d12` 可用 |
| **`h264_nvenc` 收 10bit 输入** | `Error while opening encoder` / `Nothing was written into output file` | `-h encoder=h264_nvenc` 虽列出 `p010le`，但**实测不支持**。硬件帧链路用 scale 的**选项** `scale_cuda=w=W:h=H:format=nv12`（**0 拷贝**，位深转换在 GPU 内）；软解链路用 `-pix_fmt yuv420p` / `format=yuv420p`。注意 `,format=nv12`（逗号）是独立滤镜 → 会要求出显存而失败；`:format=cuda` 则是非法选项值。10bit 输出用 `hevc_nvenc`（可直接吃 p010） |
| **ffmpeg 7.x 的 QSV** | `Error initializing an MFX session: -3`（连 8bit h264 也失败） | libmfx legacy 与本机 oneVPL 2.15 不兼容；7.x 上 QSV 完全不可用，主力用 8.x / master。另：7.x 无 `d3d12va`、无 `scale_d3d11/scale_d3d12/scale_vulkan`，vulkan 解 hevc 10bit 会挂死 |
| **指望 d3d/vulkan 兜住 cuda 解不了的 codec** | qsv/d3d11va/d3d12va/vulkan 全部无法硬解 | **VP8 / MPEG-1 / MPEG-4 / MJPEG 只有 cuda（NVDEC）支持**；cuda 覆盖面最宽，d3d/vulkan 是它的子集。唯一反向例外是 VP9（QSV 更宽：支持 4:4:4 与奇数分辨率） |

### 8.2 能力探测命令

```bash
# 1. 本构建支持哪些 hwaccel 方法
ffmpeg -hwaccels

# 2. 支持哪些硬件设备类型
ffmpeg -init_hw_device list

# 3. 有哪些硬件编码器 / 解码器
ffmpeg -encoders | grep -E "nvenc|qsv|vaapi|amf|_mf |vulkan"
ffmpeg -decoders | grep -E "cuvid|qsv|vaapi|amf|vulkan"

# 4. 某编码器的完整能力（profile / pix_fmt / 参数）
ffmpeg -h encoder=hevc_nvenc

# 5. 有哪些硬件滤镜
ffmpeg -filters | grep -E "_cuda|_qsv|_vaapi|_amf|_vulkan|_opencl|_d3d1[12]"

# 6. 容器默认编码器与支持情况
ffmpeg -h muxer=mp4
ffmpeg -h muxer=matroska

# 7. 检查构建启用了哪些硬件相关库
ffmpeg -buildconf | grep -E "nvenc|cuda|qsv|libvpl|libmfx|vaapi|amf|vulkan|d3d11"
```

### 8.3 硬件可用性验证（避免"能解析但跑不了"）

```bash
# 最小可用性测试：不写文件，只验证管线能否初始化
ffmpeg -f lavfi -i "testsrc=size=1920x1080:rate=30:duration=1" \
  -c:v hevc_nvenc -preset p6 -cq 24 -f null -

# 检查实际使用的 hwaccel（verbose 日志）
ffmpeg -v verbose -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -f null - 2>&1 | grep -iE "hwaccel|device|nvenc"

# 检查输出文件的 codec tag（验证 hvc1 是否生效）
ffprobe -v error -show_entries stream=codec_name,codec_tag_string -of json out.mp4

# 检查是否真的走了硬件路径（对比耗时）
ffmpeg -benchmark -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=1920:1080" -c:v hevc_nvenc -cq 24 -f null - 2>&1 | tail -3
```

### 8.4 端到端兼容性检查清单

在把硬件管线投入生产前，逐项确认：

- [ ] `ffmpeg -hwaccels` 列出目标方法
- [ ] `ffmpeg -encoders` 列出目标编码器
- [ ] 目标编码器的 `pix_fmt` 列表包含你的输入格式
- [ ] 目标 `profile` 在编码器支持列表中
- [ ] 硬件代际支持目标 codec（AV1 需新卡）
- [ ] 输出容器的 codec 兼容性（HEVC→MP4 需 hvc1）
- [ ] 并发会话数满足需求
- [ ] 质量参数方向正确（MF 与其他平台相反）
- [ ] 已用 `-f null -` 验证管线可初始化
- [ ] 已做实际编码测试并检查输出可播放

---

## 9. 选型速查

### 9.1 平台选型

| 场景 | 推荐平台 | 理由 |
| --- | --- | --- |
| **Windows + NVIDIA** | NVENC | 像素格式最丰富、参数最全、生态最好 |
| **Windows + AMD** | AMF | 官方推荐的 `d3d11va + d3d11` 组合 |
| **Windows + Intel 核显** | QSV | `vpp_qsv` 一体化处理最省事 |
| **Linux 服务器（无独显）** | QSV（Xeon 带核显） | 无需额外硬件 |
| **Linux + Intel/AMD** | VAAPI | 厂商中立，驱动成熟 |
| **Linux + NVIDIA** | NVENC + CUDA | 性能最强 |
| **macOS** | VideoToolbox | 唯一选择，M 系列能效极佳 |
| **跨厂商通用** | Vulkan | 需新驱动，兼容性逐步改善 |
| **无 GPU** | 软件编码 | x264/x265/SVT-AV1 |

### 9.2 codec 选型

| 需求 | 推荐 codec | 平台 |
| --- | --- | --- |
| **最大兼容性** | H.264 | 全部平台 |
| **同质量省一半码率** | HEVC | 全部平台（除老卡） |
| **最新最高压缩** | AV1 | RTX40+/Arc+/RDNA3+ |
| **低延迟直播** | H.264 | 全部平台 |
| **Apple 生态** | H.264 或 HEVC+hvc1 | NVENC/QSV/AMF |
| **10bit HDR** | HEVC main10 | 全部平台 |
| **4:4:4 专业** | H.264 high444p / HEVC rext | NVENC（专业卡）/QSV gen11+ |

### 9.3 全硬件管线速查

```bash
# NVIDIA（最通用）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i in.mp4 \
  -vf "scale_cuda=1920:1080" -c:v hevc_nvenc -preset p6 -rc vbr -cq 24 -b:v 0 \
  -c:a copy -movflags +faststart out.mp4

# Intel QSV（最简洁）
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i in.mp4 \
  -vf "vpp_qsv=w=1920:h=1080:scale_mode=hq" -c:v hevc_qsv -preset slower \
  -global_quality 24 -c:a copy -movflags +faststart out.mp4

# AMD AMF（官方推荐）
ffmpeg -hwaccel d3d11va -hwaccel_output_format d3d11 -i in.mp4 \
  -c:v hevc_amf -usage transcoding -quality quality -rc vbr_peak \
  -b:v 6M -maxrate 9M -bufsize 12M -c:a copy -movflags +faststart out.mp4

# VAAPI（Linux）
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi -i in.mp4 \
  -vf "scale_vaapi=w=1920:h=1080:mode=hq" -c:v hevc_vaapi \
  -rc_mode ICQ -global_quality 24 -c:a copy -movflags +faststart out.mp4

# Vulkan（跨厂商）
ffmpeg -init_hw_device vulkan -hwaccel vulkan -hwaccel_output_format vulkan -i in.mp4 \
  -vf "scale_vulkan=1920:1080" -c:v h264_vulkan -qp 24 \
  -c:a copy -movflags +faststart out.mp4
```

### 9.4 兼容性关键开关速查

| 目标 | 开关 |
| --- | --- |
| Apple 能播 HEVC | `-tag:v hvc1` |
| 网络播放优化 | `-movflags +faststart` |
| 零拷贝（NVIDIA） | `-hwaccel_output_format cuda` |
| 零拷贝（QSV） | `-hwaccel_output_format qsv` |
| 零拷贝（VAAPI） | `-hwaccel_output_format vaapi` |
| 零拷贝（AMF） | `-hwaccel_output_format d3d11` |
| 10bit 输出 | `-pix_fmt p010le`（或 `yuv420p10le`） |
| 强制 CBR | `-rc cbr -b:v X -maxrate X -bufsize 2X` |
| 恒定质量 | NVENC `-rc vbr -cq N`；QSV/VAAPI `-global_quality N` |
| 低延迟 | `-tune ll -zerolatency 1`（NVENC）/ `-low_delay_brc 1`（QSV） |
| 指定 GPU | `-hwaccel_device N` + `-gpu N`（NVENC） |
| 音频不重编码 | `-c:a copy` |
| 视频不重编码 | `-c:v copy` |

---

## 附录：本文参数来源对照

| 章节 | 主要来源 |
| --- | --- |
| 1 编解码器清单 | 本机 `ffmpeg -encoders` / `-decoders` 实测枚举（28 硬件编码器 + 22 硬件解码器）；`hwaccelintro-ffmpeg.md` §FFmpeg API Implementation Status |
| 2 平台 × codec 矩阵 | `hwaccelintro-ffmpeg.md` §Platform API Availability；`support-matrix-nvidia.md`（NVENC 代际）；`hardware-quicksync-ffmpeg.md` §Hardware Support（QSV 代际）；`hardware-amf-ffmpeg.md`（AMF 容器支持） |
| 3 profile / level / pix_fmt | 本机 `ffmpeg -h encoder=<name>` 逐个实测；H.264/HEVC level 上限取自 ITU-T 规范常用值 |
| 4 码率控制 | 本机 `ffmpeg -h encoder=<name>` 参数实测；`ffmpeg-all.md` §16.31 QSV（码控选择规则）、§16.33 VAAPI（`rc_mode` 取值）、§16.26 MediaFoundation（`rate_control` 取值） |
| 5 容器兼容性 | `ffmpeg-formats.md` §4.4 MOV/MPEG-4 muxers（含 fragmentation、faststart）；本机 `ffmpeg -h muxer=<name>` 实测 |
| 6 全硬件工作流 | `hwaccelintro-ffmpeg.md` §CUDA/§VAAPI/§AMD；`hardware-amf-ffmpeg.md` §Transcode（官方推荐配置）；`hardware-quicksync-ffmpeg.md`；`ffmpeg-filters.md` 各硬件滤镜章节 |
| 7 配对表 | 本机 `ffmpeg -h encoder=<name>` 的 "Supported pixel formats" / "Supported hardware devices" 实测；`ffmpeg-filters.md` §11.123 hwmap（跨设备映射） |
| 8 陷阱与验证 | 综合实测经验与官方文档注意事项 |
| 9 速查 | 综合全文 |
