# FFmpeg 硬解支持矩阵与混合链实测报告（2026-09-21 起，2026-09-22 修订）

> **定位**：本文是**本机实测数据**报告，不是通用能力清单。通用兼容性/选型见《FFmpeg 硬件加速兼容性与全硬件工作流指南》（`ffmpeg-guide-hwaccel-compat.md`），参数细节见 `ffmpeg-guide-hwaccel.md`。
> **机器**：NVIDIA GeForce RTX 4070（驱动 610.47）+ Intel UHD Graphics 750（iGPU，oneVPL 2.15）
> **ffmpeg**：三套实测——`C:/Home/Apps/ffmpeg/bin`（master `N-126733-gfddc59cf3-2026-09-20`，下文记 **master**）、`C:/Home/Apps/ffmpeg/ff8`（8.1.2 gyan full_build，记 **ff8**）、`C:/Home/Apps/ffmpeg/ff7`（n7.1.1，记 **ff7**）。**不要求支持 ffmpeg 7 以下版本**。
> **素材**：① FFmpeg FATE `bear` 系列样本集 `temp/testvideos`（232 个文件，110~111 个可软解且尺寸有效）；
> ② 自建 codec×位深×色度 矩阵 `F:/temp/testvideos/mysamples`（87 个文件，84 个有效，覆盖 vvc/avs2/avs3/evc/prores/apv/theora/msmpeg4v2 与 h264/hevc/vp9/av1 的各色度位深组合）；
> ③ 真实高码率素材 `F:/temp/testvideos/jellyfin`（4K/8K 30~50 Mbps）。
> **复现**：`node temp/probe_hwdec_matrix.mjs`（矩阵）、`node temp/probe_hwdec_matrix.mjs --xtab`（交叉统计，`TEST_DIR=...` 可换素材目录）、`bash temp/hybrid_chain_test2.sh`（混合链计时）、`bash temp/bench_d3d_vs_cpu.sh`（4K/8K d3d vs 软解）、`bash temp/bench_d3d_vulkan_pipelines.sh`（d3d12/vulkan 管线）、`bash temp/bench_hard_pipelines.sh`（硬样本管线 + CPU 判据）、`bash temp/bench_encoder_matrix.sh`（编码器能力矩阵）。原始记录在 `temp/probe_hwdec_*_<ts>.{json,md}`。

---

## 0. 判定口径：为什么不能用退出码

**这是本次最重要的一条方法论结论**：`-hwaccel cuda` 在**硬解不被支持时不一定报错**。

```
# h264 High 10（NVDEC 不支持该 profile）
$ ffmpeg -hwaccel cuda -i hi10p.mp4 -f null -      ; echo $?
0                                                  # ← 退出码 0！

# 但 warning 级别能看到真相：
[h264 @ ...] Hardware is lacking required capabilities
[h264 @ ...] Failed setup for format cuda: hwaccel initialisation returned error.
[h264 @ ...] Failed setup for format cuarray: hwaccel initialisation returned error.
# 实际是「静默回退软件解码」
```

因此本报告的判定**解析 verbose 日志中解码器是否真的切到硬件像素格式**，而不是看退出码：

| 判定 | 含义 | 证据 |
| --- | --- | --- |
| **HW** | 真硬解（帧在显存） | `pix_fmt: cuda/qsv/d3d11/d3d12/vulkan` 或 `pixfmt:<同上>`；QSV 另认 `Decoder: output is video memory surface` |
| **SW** | 静默回退软件解码（= 硬件没生效） | exit=0 但无上述字段；常伴随 `Failed setup for format X` |
| **UP** | **软解 + 上传**：日志出现硬件像素格式，但帧是**上传**到设备的（软件解码），非真硬解 | 出现 `Disabling host image transfers` / `hwupload` / `transfer` 等上传证据 |
| **ER** | 硬失败 | 非 0 退出（实测同一失败在不同版本退出码不同：69/127/171，故只看非 0） |
| **BR** | 工具链问题（对照文件同样失败） | 见 §5.1 归一化规则 |
| **TP** | 硬件帧下载格式被拒（色度/位深限制，非硬解能力问题） | `Invalid output format X for hwframe download` |

**推论（写代码时的硬约束）**：**不能靠「指定了 `-hwaccel`」判断是否真在硬解**。要判定必须靠 (a) 能力预检/支持矩阵，或 (b) 显式 `-hwaccel_output_format <hwfmt>` 让硬件帧成为硬性要求（此时硬解不可用会转为硬失败，而不是静默软解）——见 §4.2。

### 0.1 判据可靠性修订（2026-09-22，用 mysamples 全套素材复核后）

`pixfmt:<hwfmt>` 这一条**会假阳性**：ffmpeg 在解码器不支持该 codec 时，仍可能把**软件解码**的帧**上传**到硬件设备，日志照样出现 `pixfmt:<hwfmt>`。实测最典型的是 vulkan + ProRes/APV（NVIDIA 官方 NVDEC 矩阵里根本没有这两个 codec 的解码器，不可能硬解）。

五种判据的实测可靠性：

| 判据 | 可靠性 | 反例（本轮实测） |
| --- | --- | --- |
| 退出码 | ❌ 不可用 | 硬解失败静默软解仍 exit=0 |
| `pixfmt:<hw>` | ⚠️ 会假阳性 | vulkan + ProRes：`pixfmt:vulkan` 出现，实为软解+上传 |
| 解码器级 `Reinit context …, pix_fmt:<hw>` | ✅ 出现即可判真硬解，**但不是必要条件** | `cuda + hevc 10bit` 真硬解却不打印该行 |
| CPU 时间对比（`-benchmark`） | ⚠️ 短切片/提前退出时被帧线程预读放大 | ProRes：软解 CPU=3.69s vs vulkan 路径 0.64s，看着像硬解 |
| **厂商官方解码矩阵交叉验证** | ✅ 最可靠（与实测逐条一致） | Ada 5th-gen NVDEC：HEVC 4:4:4=YES、HEVC 4:2:2=NO、H.264 4:2:2=NO、H.264 10bit=NO、VP9 仅 4:2:0 |

**落地判据（已写入 `temp/probe_hwdec_matrix.mjs`）**：
1. 有硬件像素格式 + **有上传证据**（`Disabling host image transfers` / `hwupload` / `transfer`）→ **UP（软解+上传）**，不算硬解；
2. 否则沿用原判定（不要求"解码器级证据"，否则会把 `cuda + hevc 10bit` 这类真硬解误降级）；
3. 结论档位（支持/不支持某 codec）与**官方矩阵**对齐后再下定论。

---

## 1. 结论一：CUDA 硬解不了的素材，其它通道能救回多少

以 `cuda` 为基准通道，对 110 个可软解文件逐一做「纯解码」探测（模式 = 强制硬件帧 `-hwaccel X -hwaccel_output_format <hwfmt>`），交叉统计：

| 分组 | 文件数 | qsv 可硬解 | d3d11va | d3d12va | vulkan | 至少一个替代通道 |
| --- | --- | --- | --- | --- | --- | --- |
| `cuda` = HW | 92 | 72/92 | 70/92 | 70/92 | 70/92 | 72/92 |
| **`cuda` ≠ HW** | **18** | **4/18** | **0/18** | **0/18** | **0/18** | **4/18** |

**正方向**：`cuda` 硬解不了的 18 个文件里，14 个（**78%**）其它通道也都不行 → "cuda 不行 ⇒ 别的也不行" 成立约 78%。
**反方向**：`cuda` 能解的 92 个里，d3d11va/d3d12va/vulkan 各有 **22 个（24%）不行**，qsv 有 20 个（22%）不行 → **"cuda 行" 推不出 "别的也行"**。
**并集**：任一通道可硬解 96/110。替代通道的全部增量 = **4 个文件**（全是 VP9）；"仅 cuda 可解" = **20 个文件**。

能救回来的 4 个（救兵都是 QSV）：

| 文件 | codec / pix_fmt | 分辨率 | 为什么 cuda 不行 | 为什么 QSV 行 |
| --- | --- | --- | --- | --- |
| `bear-vp9a-odd-dimensions.webm` | vp9 yuv420p | **161×121**（奇数） | hwaccel 初始化失败 | QSV 接受奇数分辨率 |
| `bear-vp9-odd-dimensions.webm` | vp9 yuv420p | 奇数 | 同上 | 同上 |
| `bear-320x240-P444.webm` | vp9 **yuv444p** | 320×240 | 静默软解 | Intel 支持 VP9 4:4:4 |
| `bear-vp9a-444.webm` | vp9 **yuv444p** | 320×240 | 静默软解 | 同上 |

### 1.1 按 codec 的通道覆盖（HW 数 / 该 codec 文件数）

| codec | 文件数 | cuda | qsv | d3d11va | d3d12va | vulkan |
| --- | --- | --- | --- | --- | --- | --- |
| h264 | 37 | 35/37 | 35/37 | 35/37 | 35/37 | 35/37 |
| vp9 | 20 | 14/20 | **18/20** | 13/20 | 13/20 | 14/20 |
| vp8 | 17 | **17/17** | 0/17 | 0/17 | 0/17 | 0/17 |
| hevc | 14 | 14/14 | 14/14 | 14/14 | 14/14 | 14/14 |
| av1 | 10 | 8/10 | 7/10 | 7/10 | 7/10 | 7/10 |
| mpeg1video / mpeg4 / mjpeg | 各 1 | **1/1** | 0~1 | 0~1 | 0~1 | 0~1 |
| theora / msmpeg4v3 / flv1 / rv10 / vvc | 8 | 0/8 | 0/8 | 0/8 | 0/8 | 0/8 |

**要点**：
- **VP8 / MPEG-1 / MPEG-4 / MJPEG 只有 cuda（NVDEC）能硬解**——DXVA/Vulkan 通用层根本没有这些解码器（VP8 上 QSV 直接硬失败）。所以 NVIDIA 机器上 **cuda 是覆盖面最宽的通道**，d3d/vulkan 是它的子集。
- 唯一反向例外：**VP9 上 QSV（18/20）比 cuda（14/20）宽**（VP9 4:4:4 + 奇数分辨率）。
- `vvc` / `theora` / `rv10` / `flv1` / `msmpeg4v3`：**全通道无硬解**，只能 CPU。

### 1.2 为什么会这样（机理）

硬解能力 = `codec/profile/位深/色度/分辨率约束` × `具体解码 API`。cuda 失败可分两类：

1. **共性 codec gap**（占多数，78% 的来源）：这块 GPU 的解码引擎本身没有该 codec/profile（vvc、h264 High 10、theora、rv10、flv1、av1 4:4:4…）→ **任何 API 都救不了**。
2. **API/驱动参数约束**（占少数）：同一 codec，但某个 API/驱动不接受该形态（奇数分辨率、VP9 4:4:4）→ **换 API 有效**。

**因此不能把 "cuda 不行 ⇒ 全部不行" 当规则写进代码**，但可以作为默认策略：cuda 失败先落 CPU，仅对已知有救的形态（VP9 族）额外试一次 QSV。

---

## 2. 结论二：硬件 scale 与混合 CPU scale

### 2.1 硬件 scale 滤镜可用性（三版本实测）

| 滤镜 | master | ff8 | ff7 | 说明 |
| --- | --- | --- | --- | --- |
| `scale_cuda` | ✅ | ✅ | ✅ | 输出 `format=cuda`（帧留在显存，0 拷贝） |
| `scale_qsv` | ✅ | ✅ | ✅ | 支持 `mode=hq`；不支持 `force_original_aspect_ratio`/`h=-2` |
| `scale_d3d12` | ✅ | ✅ | — | ff7 无 `d3d12va` hwaccel，也没有该滤镜 |
| `scale_vulkan` | ✅ | ✅ | — | ff7 没有该滤镜 |
| **`scale_d3d11`** | ❌ | ❌ | — | **本机不可用**：8bit 对照文件也失败，报 `Could not create the texture (80070057)`；ff7 无此滤镜 |

**`scale_d3d11` 不可用是"工具链级"结论**：对照文件（h264 8bit，各通道必能硬解）同样失败，与输入素材无关 → 结论是 **D3D11 硬 scale 链路整体不可用**，d3d 层必须配 CPU `scale=`。这正是 `lib/hwaccel.js` 里 `d3d` 层 `filter: "scale"` 的实测依据。

### 2.2 混合（硬解 + CPU scale）的两种写法

同为「硬解 + 下载到内存 + CPU scale」，两种写法行为**不同**：

| 写法 | 命令形态 | 8bit | 10bit |
| --- | --- | --- | --- |
| **隐式下载** | `-hwaccel X -hwaccel_output_format <sw_fmt|不指定> -vf scale=…` | 全通道可用 | **只有 QSV 可用**；cuda/d3d11va/d3d12va/vulkan 静默软解（SW） |
| **显式 hwdownload** | `-hwaccel X -hwaccel_output_format <hw_fmt> -vf "hwdownload,format=<sw_fmt>,scale=…"` | 全通道可用 | 全通道可用（12bit：master 可用，ff8/ff7 报 `Invalid output format p012le`） |

- **必须显式指定下载格式**：`hwdownload` 不给 `format=` 会协商出 `monow` 而失败（`Invalid output format monow for hwframe download`）。
- 下载格式要**同时匹配位深与色度**：420→`nv12`/`p010`/`p012`；422→`yuv422p`/`p210`；444→`yuv444p`/`yuv444p10le`。色度不匹配时报 `Invalid output format X for hwframe download`（本报告判为 **TP**，不是硬解能力问题）。
- **GPU scale 不会自动上传**：只写 `scale_cuda=…` 不给 `hwupload` 会报 `Impossible to convert between the formats supported by the filter …`。必须显式 `hwupload_cuda,` 前缀（`hwupload_cuda` 自带设备）或 `-init_hw_device cuda=cu -filter_hw_device cu` + 通用 `hwupload`。
- **GPU scale 的输出格式必须显式给**：`scale_cuda=W:H:format=nv12`（8bit）/ `format=p010le`（10bit）。默认 format 会让 `hevc_nvenc` 报 `Invalid argument`；而 `-pix_fmt p010le` 对接硬件编码器是**错的**（等价于强制下载回内存 → 失败）。

---

## 3. 结论三：链路选型的唯一原则 —— 帧在哪解码，filter 就放哪

跨 PCIe 拷贝次数是决定性因素（单位是「帧数据往返显存 ↔ 内存」一次）：

| 链路 | 拷贝次数 |
| --- | --- |
| 硬解 + 硬件 scale + 硬编（`-hwaccel_output_format <hwfmt>` + `scale_xxx`） | **0** |
| 软解 + CPU filter + 硬编（编码器内部上传） | **1**（上传） |
| 软解 + `hwupload` + 硬件 scale + 硬编 | **1**（上传） |
| 硬解 + 下载 + CPU filter + 硬编 | **2**（下载 + 上传） |

实测吞吐（`speed=x`，越大越快）：

| 链路 | 720p→360p，h264_nvenc，60s 素材 | 4K hevc→1080p，6 循环 |
| --- | --- | --- |
| 硬解 + `scale_cuda` + nvenc（**全 GPU**） | **39.1x** | **14.1x** |
| 硬解 + 下载 + CPU scale + nvenc | 17.1x | 2.93x |
| 硬解（不缩放）+ nvenc | 17.4x | — |
| 软解 + CPU scale + nvenc | **27.7x** | 3.42x |
| 软解 + `hwupload_cuda` + `scale_cuda` + nvenc | 23.1x | 3.23x |
| 软解（不缩放）+ nvenc | 25.1x | — |
| 纯软全链（libx264 veryfast） | 10.9x | — |

**可写进代码的三条规则：**

1. **硬解可用 ⇒ 全 GPU 链路**（硬解 + 硬件 scale + 硬编），0 拷贝：**2.2~2.6 倍** 于半吊子组合。这是最大的一笔收益。
2. **硬解不可用 ⇒ 整条链路留在内存**：不加 `-hwaccel`、不加 `-hwaccel_output_format`、不上传，软解 + CPU filter + 硬件编码（编码器自己上传，1 次拷贝）。
   - **不要"半吊子"指定 `-hwaccel` 却把帧下载回来做 CPU filter**（17.1x < 25.1x，比干脆软解还慢）。等价地：**`-hwaccel X` 配 CPU scale 而 `-hwaccel_output_format` 缺省时，硬件解码的收益被下载成本吃掉**。
   - **软解路径下 `hwupload` 做 GPU scale 不划算**（27.7 vs 23.1；4K 3.42 vs 3.23）：多一次上传抵消了 GPU 缩放优势，CPU 缩放本身通常不是瓶颈。只有链里有 CPU 没有的 GPU 能力（`tonemap_cuda`/`overlay_cuda`/`yadif_cuda`）、要串多个 GPU filter、或 CPU 被占满时才值得。
3. **`-hwaccel_output_format` 只在预检确认硬解可用时写**：它把「静默软解」变成「硬失败」（实测 High 10 上 `-hwaccel cuda -hwaccel_output_format cuda` + `scale_cuda` 直接 ERR）。而只写 `-hwaccel cuda`（不带 output format）在硬解不了时行为与纯软解一致（都 OK）——**无害但会让日志骗人**。

### 3.1 编码器侧的格式对齐（同一条"位置一致性"）

- **`h264_nvenc` 不吃 10bit 输入**（`p010le` 在 `-h encoder=h264_nvenc` 的格式列表里，但**实测不支持** → 编码器打不开）；`hevc_nvenc` 可直接吃 `p010`。
- 「10bit 源 + h264 目标」的三种对齐写法，**只有第一种是全 GPU 0 拷贝**：

| 写法 | 结果 | 说明 |
| --- | --- | --- |
| `scale_cuda=w=W:h=H:interp_algo=lanczos:format=nv12` | ✅ **0 拷贝** | `format` 是 scale 的**选项**（`:` 连接）→ 10bit→8bit 在 GPU 内完成，输出仍是硬件帧 |
| `-vf "scale_cuda=…,format=nv12"` | ❌ | 逗号后是**独立 `format` 滤镜** → 要求把 cuda 帧转成系统内存 → `Impossible to convert between the formats` |
| `-pix_fmt nv12` | ❌ | 输出选项，同样要求出显存 |
| `scale_cuda=…:format=cuda` | ❌ | scale 的 `format` 只接**软件**格式名 → `Unsupported output format: cuda` |

- 「仍是硬件帧」的证据：输出可再接一个 `scale_cuda`；输出可被 `hwdownload,format=nv12` 成功下载（`hwdownload` 只接受硬件帧）。
- 性能实测（4K→1080p，h264_nvenc，loop 6）：`:format=nv12` **16.5x** ≈ 0 拷贝基准 **16.3x**，而 2 拷贝路径 **6.92x** → 位深对齐**无性能损失**。
- 1:1 对齐（任务不需要缩放、但仍要把 10bit 喂给 h264 编码器）成本 ~1%：`scale_cuda=format=nv12`（w/h 缺省 = iw/ih）**36.7x** vs 无滤镜基准 **37.1x**。
- 软解链路（帧在系统内存）用 `-pix_fmt yuv420p`（实测可用，且对 8bit 源无副作用）。
- **别信 `-h encoder=<x>` 的格式列表**（列出 ≠ 驱动支持），要实测。

> media-cli 落地：`lib/hwaccel.js` `scaleFormatOverride()` + `buildScaleFilter()` 的 `swFormat` 参数
> （仅 cuda/qsv 层 + h264 族 + 10bit 源触发），见 `docs/CHANGES-20260921.md` 23:00 条。

---

## 4. 结论四：版本差异（7.x 只能兜底）

| 项 | master | ff8 (8.1.2) | ff7 (7.1.1) |
| --- | --- | --- | --- |
| **QSV** | ✅ 可用（oneVPL 2.15） | ✅ 可用 | ❌ **完全不可用**：`Error initializing an MFX session: -3`（libmfx legacy 与本机 oneVPL 不兼容），连 8bit h264 对照都失败 |
| `d3d12va` hwaccel | ✅ | ✅ | ❌ 不存在 |
| `scale_d3d11` / `scale_d3d12` / `scale_vulkan` | ✅ | ✅ | ❌ 均不存在 |
| `scale_qsv` / `scale_cuda` | ✅ | ✅ | ✅ |
| 12bit hw frame 下载（p012） | ✅ 可下载 | ❌ `Invalid output format p012le` | ❌ 同左 |
| vulkan 解 hevc 10bit | ✅ | ✅ | ❌ **挂死**（30s 超时） |
| 静默软解行为（`-hwaccel cuda` 遇不支持 profile） | 有 | 有 | 有 |

**结论**：7.x 可作为兜底，但**主力应用 master/8.x**；在 7.x 上必须靠 §0 的检测语义与 §2 的能力表做降级。

---

## 5. 方法学：对照归一化（避免把"工具链问题"当成"素材问题"）

### 5.1 规则

每个 (版本 × hwaccel × 模式) 组合先跑**对照文件**（8bit h264 / hevc 10bit / vp9 12bit，均为各通道本该能解的形态），按位深档判定：

- 对照 **FAIL/TMO** → 该组合判为 **BR**（工具链/驱动问题），样本结论一律作废、不计入统计；
- 对照 **SW** → 该组合在该位深档本身就是软解（如 `d3d11va` 不指定 `-hwaccel_output_format` 时的 10bit），标 `degraded`，但**不覆盖**样本判定；
- 该位深档**找不到可用对照** → 标 `??`（无法区分工具链问题与样本问题）。

实测被这条规则拦下的假结论（若不归一化会全部误记为"素材不支持"）：

| 假结论 | 真相 |
| --- | --- |
| `d3d11va` 硬 scale 在本机"不支持素材 X" | 对照文件同样失败 → `scale_d3d11` 工具链级不可用 |
| ff7 `qsv` 各模式"不支持素材 X" | 对照 8bit h264 同样失败 → ff7 的 QSV 在本机不可用 |
| ff8/ff7 12bit `mixeddl` "不支持" | 对照同样失败 → 该版本不能下载 p012 硬件帧 |

### 5.2 已知偏差（读结论时注意）

- 素材是 FFmpeg FATE 样本集，**theora/rv10/vp8/msmpeg4v3 占比远高于真实素材**；真实素材的 cuda 失败更集中在 h264 High 10 / VVC / AV1 4:4:4 等"共性 gap" → **真实场景下 78% 只会更高**。
- "替代通道能救" 依赖机器上**同时存在 Intel 核显**；纯 NVIDIA 机器上 cuda 失败 ≈ 100% 只能 CPU。
- 交叉统计只测**纯解码**，不含 scale/下载环节；叠加 §2 的约束后，替代通道的**有效**补位率只会更低。
- 吞吐数据来自短素材（60s/33s），含进程启动开销，仅作量级对比。

---

## 6. 结论五：mysamples 全量矩阵 + 官方矩阵交叉验证（2026-09-22）

对 `mysamples` 84 个有效文件做 5 通道纯解码交叉统计（84 × 5 = 420 次探测）：

| 分组 | 文件数 | qsv | d3d11va | d3d12va | vulkan | 至少一个替代通道 |
| --- | --- | --- | --- | --- | --- | --- |
| `cuda`=HW | 65 | 62/65 | 57/65 | 57/65 | 56/65 | 62/65 |
| **`cuda`≠HW** | **19** | 3/19 | **0/19** | **0/19** | **0/19** | **3/19** |

- 正方向：`cuda` 不行的 19 个里 **16 个（84%）所有替代通道也不行**（修正前为 63%——差额就是 vulkan 的 UP 假阳性）；
- 并集：任一通道可硬解 **68/84**；"仅 cuda 可解" 3 个，"仅替代通道可解" **3 个**（全部是 qsv：hevc 4:2:2 8/10bit、vp9 4:4:4 10bit）。
- 修正效果：`prores` vulkan 覆盖 3/3 → **0/3**、`apv` 1/1 → **0/1**（原为软解+上传被误记作硬解）。

**与 NVIDIA 官方 NVDEC 矩阵逐条一致**（`docs/ffmpeg/support-matrix-nvidia.md`，Ada 5th-gen）：

| 档位 | 官方矩阵 | 实测 |
| --- | --- | --- |
| H.264 4:2:0 8bit / 10bit | YES / **NO** | ✅ 一致 |
| H.264 4:2:2 8/10bit | **NO / NO** | ✅ 一致 |
| HEVC 4:2:0 8/10/12bit | YES | ✅ 一致 |
| HEVC 4:2:2 8/10/12bit | **NO / NO / NO** | ✅ 一致（cuda 全失败） |
| **HEVC 4:4:4 8/10/12bit** | **YES** | ✅ 一致（cuda 真硬解，13x） |
| VP9（仅 4:2:0） | 无 4:2:2/4:4:4 | ✅ 一致 |
| MPEG-1/2/4、VC-1、VP8、MJPEG | YES | ✅ 一致 |
| VVC / AVS2 / AVS3(EVC) / ProRes / APV / Theora / MSMPEG4 | 无 | ✅ 一致（全通道无解） |

**NVDEC 的真实缺口（+ 谁能补）**：

| 缺口 | cuda | qsv | d3d11va | d3d12va | vulkan |
| --- | --- | --- | --- | --- | --- |
| HEVC **4:2:2** 8/10bit | ❌ | **✅ 唯一** | ❌ | ❌ | ❌ |
| HEVC 4:4:4 / VP9 4:4:4 / h264 高位深高色度 | HEVC444 ✅ / 其余 ❌ | ✅ | ❌ | ❌ | 假阳性（UP） |
| vvc / avs2 / avs3 / prores / apv / theora / msmpeg4v2 | ❌ | ❌ | ❌ | ❌ | ❌（UP 假阳性） |

> ⚠️ 本节 vulkan 列已扣除"软解+上传"（UP）的假阳性；`prores`/`apv` 修正前记 3/3、1/1，实为 **0/3、0/1**（判定规则见 §0.2）。

---

## 7. 结论六：d3d12 / vulkan 管线实测（硬解全流程 vs 硬解+软编）

管线形态：
- **d3d12 全流程** = `-hwaccel d3d12va -hwaccel_output_format d3d12` + `scale_d3d12` + `h264_d3d12va`
- **vulkan 全流程** = `-hwaccel vulkan -hwaccel_output_format vulkan` + `scale_vulkan` + `h264_vulkan`
- **硬解+软编** = 同一解码 + `hwdownload,format=<按位深色度>` + CPU `scale=` + `libx264`

| 样本 | d3d12 全流程 | vulkan 全流程 | qsv 全流程 | 硬解+软编 |
| --- | --- | --- | --- | --- |
| hevc 4:2:2 8bit | ❌ `Impossible to convert`（无解码覆盖→静默软解，一要求硬件帧即硬失败） | ❌ 同左 | ✅ **6.48x**（CPU 0.39s vs 软解 1.00s = 真硬解） | ❌ `Invalid output format yuv422p` |
| hevc 4:4:4 8bit | ❌ 同左 | ❌ `Error while opening encoder` | ❌ `device failed (-17)` | ❌ `Invalid output format yuv444p` |
| vp9 4:4:4 10bit | ❌ 同左 | ❌ | ❌ `not supported` | ❌ |
| prores 4:2:2 10bit | ❌ 同左 | ❌ `Error while opening encoder` | ❌ | ❌ `Invalid output format p210le` |
| hevc 8K 4:2:0 | ❌ `h264_d3d12va` 打不开 8K | ✅ **2.33x** | — | ✅ 1.11x |
| hevc 10bit → h264 | ❌ 缺位深对齐（编码器打不开） | ❌ 同左 | ✅ | — |

**三条结论**：
1. **d3d12va 在这些硬样本上零解码覆盖**：一律静默软解；一旦显式 `-hwaccel_output_format d3d12`，就从"软解"变成**硬失败**（`Impossible to convert`）。其编码器 `h264_d3d12va` 对 8K / 10bit 输入也打不开 → **d3d 系没有可用价值**。
2. **vulkan 的"能跑"多是假象**：无 vulkan 解码器时 ffmpeg 软解+上传（日志显示 `pixfmt:vulkan`），且上传后的帧连 `nv12`/`p210le`/`yuv444p` 都不匹配 `hwdownload` → 取不回帧做软编。唯一有独立价值的是 **8K 4:2:0 全流程**（`h264_vulkan` 支持 8K，而 `h264_d3d12va` 不支持）。
3. **qsv 是唯一能在 NVDEC 缺档（HEVC 4:2:2）上跑通全流程硬件的通道**（`scale_qsv` + `h264_qsv`，6.48x）→ 支持"在 N 卡机器上按 codec 门控保留 qsv 补位"。

---

## 8. 结论七：编码器能力矩阵 —— 编码侧同样有静默降级

合成源（`lavfi testsrc2`，1s）+ `-pix_fmt` 指定编码器输入格式，**并用 ffprobe 复核产物真实格式**：

| 档位 | nvenc | qsv | vulkan | d3d12va | mf | 软编 |
| --- | --- | --- | --- | --- | --- | --- |
| VP9 420 | **无此编码器** | `vp9_qsv` ✅ **0.50x**（产物确为 vp9） | ✗ | ✗ | ✗ | libvpx-vp9 0.24x |
| **8K H.264** | ✗ 打不开（4096 上限） | ✗ | ✗ | ✗ | ✅ **真 8K** 0.59x | libx264 |
| 8K HEVC | ✅ 0.68x | ✅ 0.14x | ✗ | ✗ | ✗ | libx265 |
| 10bit H.264 | ✗ | ⚠️ **静默降 8bit** | ✗ | ✗ | ⚠️ **静默降 8bit** | libx264 High10 ✅ |
| 4:2:2（8/10bit） | ✗ | ⚠️ **静默降 420** | ✗ | ✗ | ⚠️ **静默降 420** | libx264 High422 |
| 4:4:4 8bit | ✅ 3.56x | ✅ | ✗ | ✗ | ⚠️ 降 420 | libx264 |
| 4:4:4 **10bit** | hevc ✅ **3.24x**（h264 ✗） | ⚠️ 降级 | ✗ | ✗ | ⚠️ 降级 | libx265 |
| 12bit HEVC | ⚠️ **静默降 10bit** | ⚠️ | ✗ | ✗ | ✗ | libx265 ✅ |
| AV1 | ✅ `av1_nvenc` 4.22x | ✗ | ✗ | ✗ | ✗ | libsvtav1 2.43x |

**⚠️ 编码侧静默降级（与解码侧同源）**：`-pix_fmt yuv422p -c:v h264_qsv` **退出码 0**，但产物实测是 `yuv420p` —— ffmpeg 在编码器前自动插了一次格式转换。**所以"编码器 OK"不等于"支持该格式"，必须 ffprobe 产物格式复核。**
（12bit HEVC 同理：`hevc_nvenc` 请求 12bit 实得 10bit。）

**回答"NVENC 不支持、但别的硬件支持"——真缺口只有两个**：

| 缺口 | 现状（N 卡机器） | 可用的硬件替代 | 收益 |
| --- | --- | --- | --- |
| **VP9 输出** | cuda 层无 vp9 族 → `ENCODER_MATRIX` 落 libvpx-vp9（CPU） | **`vp9_qsv`**（0.50x vs 0.24x） | ~2.1x |
| **8K H.264 输出** | h264_nvenc 打不开（>4096） | **`h264_mf`**（真 8K，0.59x） | 从"无硬件方案"到可用 |

其余档位（10bit H.264 / 4:2:2）**所有硬件编码器都不支持真格式**（qsv/mf 只是静默降级），只能 libx264 —— 与代码里既有注释"h264_nvenc/qsv 只支持 8bit，10bit 源必须降级 cpu 用 libx264"一致。

---

## 9. 落地建议（对应 `lib/hwaccel.js`）

1. **砍掉 `d3d` 层**（§3 + §7 + 8K 实测三重支持）：无解码覆盖（硬样本一律静默软解；`-hwaccel_output_format` 一开就硬失败），解码+下载只带来 2 次 PCIe 拷贝（真素材上比软解慢 6~35%，且 10bit 场景直接崩），编码器又只有 nvenc 一族。
2. **qsv 按 codec 门控保留为补位**：HEVC 4:2:2（NVDEC 无）与 VP9 4:4:4 是它的独有覆盖；但对 VP8/MPEG-1/MPEG-4/MJPEG 要先排除（那些只有 cuda 支持，qsv 会失败）。
3. **编码器回退链补一维**：`按族的硬件编码器回退 = 本层 → 其他厂商硬件编码器（能力确凿者）→ CPU`。两个入口：`vp9 → vp9_qsv`、`h264 且输出长边 > 4096 → h264_mf`。**每个回退都要校验产物格式/尺寸**，否则会像 qsv/mf 的 422/10bit 那样"假成功静默降级"。
4. **判定逻辑（探针/日志）**：`pixfmt:<hw>` 不能单独用作硬解证据，必须叠加"无上传证据"，并与官方矩阵口径对齐（§0.2）。
