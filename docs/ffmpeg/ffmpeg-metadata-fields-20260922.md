# FFprobe / MediaInfo 元数据字段实测分析（2026-09-22）

> **目的**：为「源特征提取」定一套**最大兼容**的取值规则，避免位深/色度/fps 判错导致选错编码器或缩放链路。
> **数据**：`F:/temp/testvideos/testvideos_ffprobe.json` 与 `testvideos_mediainfo.json`，各 **877** 条、**逐文件一一对应**（0 条单边缺失），其中含视频流的 **730** 个。
> **工具**：ffprobe = `C:/Home/Apps/ffmpeg/bin/ffprobe.exe`；mediainfo = MediaInfoLib 26.05。
> **复现**：`node temp/analyze_providers.mjs "F:/temp/testvideos"`。

---

## 1. pix_fmt / 色度 / 位深分布

### 1.1 ffprobe `pix_fmt`（18 种，730 个视频文件）

| pix_fmt | 数量 | 位深 | 色度 |
| --- | --- | --- | --- |
| `yuv420p` | 547 | 8 | 4:2:0 |
| `yuv420p10le` | 81 | 10 | 4:2:0 |
| **（字段缺失）** | **30** | ? | ? |
| `yuv444p` | 20 | 8 | 4:4:4 |
| `yuvj420p` | 11 | 8 | 4:2:0（full range） |
| `yuv422p` | 10 | 8 | 4:2:2 |
| `gbrp` | 5 | 8 | planar RGB |
| `yuv420p12le` / `yuv444p10le` / `yuv422p10le` | 各 4 | 10/12 | — |
| `gray` / `gray12le` / `gray10le` | 3 / 2 / 1 | 8/12/10 | 灰度 |
| `yuvj422p` / `yuv422p12le` / `yuv444p12le` | 各 2 | — | — |
| `rgb24` / `yuv410p` | 各 1 | 8 | RGB / **4:1:0** |

**色度归类汇总**：4:2:0 = 643｜未知（pix_fmt 缺失）= 30｜4:4:4 = 26｜4:2:2 = 18｜gray = 6｜rgb = 6｜**4:1:0 = 1**

> ⚠️ `yuv410p`（4:1:0）与 `gbrp`（planar RGB）是色度解析的两个漏网值：前者**无任何硬件支持**，必须软解并在 scale 时转 4:2:0；后者色度概念不适用。

### 1.2 mediainfo（Video track）

| 字段 | 取值分布 |
| --- | --- |
| `ColorSpace` | YUV 526｜**缺失 163**｜RGB 6｜Y 2 |
| `ChromaSubsampling` | 4:2:0 514｜**缺失 157**｜4:2:2 13｜4:4:4 13 |
| `BitDepth` | 8bit 517｜10bit 87｜**缺失 84**｜12bit 9 |

**mediainfo 的 `ColorSpace` 不是 ffprobe 语义**：它取 `YUV/RGB/Y`，而 ffprobe 的 `color_space` 取 `bt709/bt2020nc/...`。项目里 `pixelFormat = ColorSpace + ChromaSubsampling`（如 `"YUV4:2:0"`）**不含位深**——这正是位深误判的根源。

---

## 2. 位深判定的可靠性（核心结论）

| 取值来源 | 覆盖率 | 结论 |
| --- | --- | --- |
| ffprobe `bits_per_raw_sample` | **231/730（32%）** | ❌ 不可靠：**68% 的文件该字段直接缺失**（为 0 的有 0 个）。95 个 >8bit 文件全靠 `pix_fmt` 后缀解析 |
| ffprobe `pix_fmt` 后缀 | ✅ 主力 | 后缀齐全：`10le/12le/16le`、`p010/p012/p210/p410`、`gray10le` 等；**无后缀 = 8bit**（可靠约定） |
| mediainfo `BitDepth` | 646/730（88.5%） | ⚠️ 兜底：缺失时若默认 8bit，会有**真实误判** |

**双方都给值时的交叉结果：完全一致 311/695，冲突 0** → 两个 provider 各自都对，只是**覆盖不同**：
- 仅 ffprobe 能给：5 个（mediainfo `BitDepth` 缺失）
- 仅 mediainfo 能给：301 个（ffprobe 无后缀但属 8bit）

### 2.1 ★ 位深误判的真实风险样本（只用 mediainfo + 默认 8bit 就会中招）

| 文件 | ffprobe pix_fmt | 真实位深 | mediainfo BitDepth |
| --- | --- | --- | --- |
| `chromium_media_testdata\agtm-metadata-track-frag.mp4` | `gray12le` | **12** | 缺失 |
| `chromium_media_testdata\bear-320x240-v-vp9_profile2_subsample_cenc-v.mp4` | `yuv420p10le` | **10** | 缺失 |
| `chromium_media_testdata\bear_av1_720p_444_10bit.ivf` | `yuv444p10le` | **10** | 缺失 |
| `photoprism\MP4\bear-320x240-v-vp9_profile2_subsample_cenc-v.mp4` | `yuv420p10le` | **10** | 缺失 |

（另有 6 个文件**两边都给不出位深**：`pix_fmt` 缺失 + `BitDepth` 缺失，多为 WebM 分片/加密样本。）

> mediainfo 的 `BitDepth` 缺失形态：**均为字段缺失**（无 `"0"` 这种占位值），所以"缺失 vs =0"不需额外区分。

---

## 3. 最大兼容的归一化规则（建议落地为 `normalizeSourceProfile()`）

| 目标字段 | 取值优先级 | 兜底与告警 |
| --- | --- | --- |
| **bitDepth** | ① `pix_fmt` 后缀（`10le/12le/16le`、`p010/p012/p210/p410`、`gray10le`…）→ 命中即用；② `pix_fmt` 命中已知识别为 8bit 的格式表（`yuv420p/yuvj420p/yuv422p/yuv444p/nv12/gbrp/gray/rgb24/yuva*`）→ 8；③ mediainfo `BitDepth`；④ ffprobe `bits_per_raw_sample`（仅当 >0，实际只有 32% 有值） | 全部落空 → **标记 `unknown` 并按 10bit 走保守路径**（见下），同时 warn 一次 |
| **chroma** | ① `pix_fmt` 解析（444/422/420/**410**/gray/rgb）；② mediainfo `ChromaSubsampling`（实测能把 150/157 的缺失补上）；③ 视作 4:2:0 并记录 | 4:1:0 / gray / rgb 需单独分支（无硬件支持或色度不适用） |
| **codec** | ① ffprobe `codec_name`；② mediainfo `Format`/`Format_Profile` | DRM/加密流 ffprobe 会给 `codec_name=undefined`（实测 `drm.m4v`），此时必须用 mediainfo 兜底 |
| **fps** | ① ffprobe `avg_frame_rate`（分数串，注意 `0/0`）；② mediainfo `FrameRate`（小数）；VFR（63 个）只用平均值 | **不要用 `r_frame_rate`**（见 §4.1） |
| **duration** | ① ffprobe `format.duration`；② mediainfo General `Duration`（ms→s） | — |
| **主视频流** | ffprobe：`codec_type=video` 且 **`disposition.attached_pic≠1`**；mediainfo：`@type=Video` | 两侧规则天然一致（见 §4.4） |

### 3.1 为什么"位深未知时按 10bit 保守处理"是安全的

两条位深对齐逻辑对 8bit 源**都是无副作用的**：
- `swdec` 层的 `-pix_fmt yuv420p`：8bit 源本就是 `yuv420p` → no-op；
- `cuda/qsv` 层的 `scale_cuda=…:format=nv12`：8bit 源的硬件帧 sw_format 本就是 `nv12` → no-op（实测 8bit 全链路性能无差异）。

而反过来（10bit 当 8bit）会直接**编码器打不开**。所以未知时按 10bit 处理是**安全的单向容错**。

### 3.2 合并两 provider 后的实测覆盖率

| 指标 | 覆盖率 |
| --- | --- |
| 位深可判定 | 694/730 = **95.1%** |
| 色度可判定 | 706/730 = **96.7%** |
| 仍判不了 | 36 个（30 个 `pix_fmt` 缺失的裸流/分片 + 少数 gray/rgb 无 mediainfo 字段）→ 按 §3 的 unknown 路径处理 |

---

## 4. 其他字段的坑（都已在本数据集里出现）

### 4.1 fps：`r_frame_rate` 会给出**错误**值（72/730 = 10% 与 `avg_frame_rate` 差异 >0.01）

| 文件 | `r_frame_rate` | `avg_frame_rate` | 真相 |
| --- | --- | --- | --- |
| `chromium_media_testdata\10.mpg` | **50/1** | 25/1 | 隔行场率翻倍 |
| `chromium_media_testdata\bbb.hevc` | **60/1** | 25/1 | 裸流时基推导错误 |
| `bear-320x180-10bit-frame-1.h264` | **1200000/1** | 25/1 | 单帧裸流，完全无意义 |
| `bear-1280x720-hevc-10bit-hdr10.hevc` | **30000/1001** | 25/1 | 同上 |
| `90rotation.mp4` | 53/3（17.67） | 54000/3529（15.30） | VFR，两者都不是"标称值" |

另有 **55 个文件 `avg_frame_rate=0/0`**（无帧率信息）→ 必须用 mediainfo `FrameRate`。
→ **规则：一律取 `avg_frame_rate`，`0/0` 时落 mediainfo；`r_frame_rate` 只用于参考，不参与任何决策。**

### 4.2 显示尺寸：SAR 与旋转

- **SAR≠1 或字段缺失：24 个**（如 `10.mpg` SAR=178:163、`bbb-320x240-2video-2audio.mp4` SAR=4:3）→ `width/height` 不是显示尺寸，`--dimension` 的"长边"必须用**显示宽高**（SAR 校正后）。
- **旋转≠0：18 个**（`side_data_list[].rotation`，取值为 `-90/-180/90`）→ 竖屏判定/缩放同样受影响；mediainfo 侧有 `Rotation`/`PixelAspectRatio`/`DisplayAspectRatio` 可交叉校验。

### 4.3 HDR：两侧字段体系不同，各有独占信息

| | ffprobe | mediainfo |
| --- | --- | --- |
| 传输特性 | `color_transfer=smpte2084` / `arib-std-b67` | `transfer_characteristics=PQ` / `HLG` |
| 原色 | `color_primaries=bt2020` | `primaries` **缺失** |
| 矩阵 | `color_space=bt2020nc` | `matrix_coefficients=BT.2020 non-constant` |
| Dolby Vision | ❌ 无 | ✅ `HDR_Format=Dolby Vision` |

**HDR 文件 36 个** → 判"是否 HDR"用 ffprobe 的 `color_transfer` 更稳；要识别 Dolby Vision（保 DV 需要 `-c:v copy`）必须用 mediainfo 的 `HDR_Format`。

### 4.4 封面图 / 多视频流：两侧表示不同，规则要分清

| 场景 | ffprobe | mediainfo |
| --- | --- | --- |
| 封面图 | 也是 `codec_type=video`，但 **`disposition.attached_pic=1`** | **`@type=Image`**（不是 Video） |

实测 4 个带封面文件：`id3_png_test.mp3`（封面 png）、`ticket-a_aac.mkv`（主 h264 + **两个** mjpeg 封面）、`drm.m4v`、`…(1080p).mp4`。
→ **ffprobe 侧必须显式排除 `attached_pic`**，否则会把封面当主视频；mediainfo 侧按 `@type=Video` 天然正确。
**多视频流 18 个**（1 个文件有 3 条视频轨）→ 取第一条非封面，并记录轨道数以便上层决策。

### 4.5 其余

| 项 | 数量 | 影响 |
| --- | --- | --- |
| `pix_fmt` 字段缺失（裸流 `.h264/.hevc/.ivf` 单帧） | 30 | 位深/色度都无法判定 → §3 的 unknown 路径 |
| 隔行（`field_order=tt/bb`） | 9 | 需 `yadif` 类反交错；硬解/scale 对隔行敏感 |
| 奇数宽高 | 9 | scale 目标必须取偶（项目已有 `toEven`） |
| alpha / gray 格式 | 6 | 色度不适用；硬解多不支持 |
| >8bit | 97 | 位深判定的主要风险面 |
| VFR（mediainfo `FrameRate_Mode=VFR`） | 63 | 不能按标称帧率做"是否需要改帧率"的判断 |
| 视频流 `codec_name` 缺失（DRM） | 1+ | 需 mediainfo `Format` 兜底 |

---

## 5. 建议的实现改动（对应 lib/）

1. **补 `bitDepth` 透传（高优先，P0）**：`buildEncoderArgs()` 目前只收到 `pixFmt`，mediainfo 回退路径下 `pixelFormat="YUV4:2:0"` 不含位深 → `swdec` 层**不会**注入 `-pix_fmt yuv420p` → 10bit 源 + h264 目标仍会 `Error while opening encoder`。
   修法：`buildEncoderArgs(tierName, {…, pixFmt, bitDepth})`，内部判据改用 `bitDepthOf(pixFmt, bitDepth)`；`buildVideoArgsFromPlan` 传 `entry.info?.video?.bitDepth`。（`scaleFormatOverride` 那条路**已经**传了 bitDepth，两条路要一致。）
2. **位深取值分级**：按 §3 的顺序实现，并把"未知"显式传递下去（不要静默按 8bit）。
3. **fps 取值改 `avg_frame_rate`**，`0/0` 落 mediainfo；`r_frame_rate` 不参与决策（当前 10% 的文件会拿到 50/60/1200000 这类错值）。
4. **主视频流选择**：ffprobe 分支加 `disposition.attached_pic!==1`；mediainfo 分支保持 `@type=Video`。
5. **显示宽高**：`--dimension` 用 SAR/rotation 校正后的显示尺寸（24 + 18 个文件受影响）。
6. **codec 兜底**：ffprobe `codec_name` 缺失（DRM）时用 mediainfo `Format`。
7. 可选：把本节 §1/§2 的分布与"未知位深"计数写进 `--info` 输出，便于用户自查。

---

## 6. 一句话总结

位深必须**以 ffprobe 的 `pix_fmt` 为主**（`bits_per_raw_sample` 68% 缺失、mediainfo `BitDepth` 9.5% 缺失且含 4 个真 >8bit 样本），色度以 `pix_fmt` 为主、mediainfo 补 150/157；两者都给值时**零冲突**，所以策略是「ffprobe 主 + mediainfo 兜底」而不是二选一。位深未知时按 **10bit 保守处理** 是安全的（两条对齐逻辑对 8bit 都是 no-op）。

> ⚠️ 以上是**测试集**（`F:/Temp/testvideos`，专门构造的畸形样本集）的结论。真实片库的规律见 §7 —— 有几条需要修正。

---

## 7. 真实片库实测（2026-09-22，`U:\` 2447 个文件）

**数据**：`F:/Temp/ureal/ureal_ffprobe.json` / `ureal_mediainfo.json`（各 2447 条；ffprobe 失败 3、mediainfo 失败 1）；
索引脚本 `temp/gen_index_ureal.py`（复用 `F:/Temp/testvideos/generate_index.py` 的口径），分析脚本 `temp/analyze_realcontent.mjs`、`temp/analyze_providers.mjs "F:/Temp/ureal" ureal_`。
**规模**：总时长 1502 小时 / 总体积 2363 GB；中位 0.39h、0.40GB（以剧集为主）。

### 7.1 测试集 vs 真实片库：畸形项几乎全部消失

| 维度 | 测试集（730 视频） | **真实片库（2444 视频）** |
| --- | --- | --- |
| `pix_fmt` 缺失 | 30（4.1%） | **2（0.08%）** |
| 色度非 4:2:0 | 87（11.9%） | **2（0.08%）** |
| 位深 >8bit | 97（13.3%） | 169（6.9%） |
| mediainfo `BitDepth` 缺失 | 84（11.5%） | **96（3.9%，全部集中在 rmvb/rv40）** |
| 两 provider 位深冲突 | 0 | **0** |
| 合并后位深可判定率 | 95.1% | **100%（仅 1 个文件判不了）** |
| **SAR≠1** | 24（3.3%） | **118（4.8%）** ← 真实片库更高 |
| **attached_pic（封面流）** | 4 | **279（11.4%）** ← 真实片库更高 |
| 旋转 | 18 | **0** |
| 隔行 | 9（1.2%） | 6（0.25%） |
| **`r_frame_rate` ≠ `avg`（>0.01）** | 72（9.9%） | 39（1.6%，**全是 23.979/25.003 这类抖动**） |
| VFR（mediainfo） | 63（8.6%） | **368（15%）** |
| 奇数宽高 / alpha / gray | 9 / 6 | **0 / 0** |
| HDR | 36 | 40（1.6%，含 Dolby Vision 7、HDR Vivid 1） |

> **读法**：测试集里的"怪值"（`pix_fmt` 缺失、gray/rgb/4:1:0、奇数宽高、`r_frame_rate=1200000/1`）在真实片库里**基本不存在**；真实片库真正高频的是 **封面流 11.4%** 与 **非方形像素 4.8%**，这两个是测试集里被低估的项。

### 7.2 真实片库的内容规律

| 维度 | 分布 |
| --- | --- |
| codec | h264 71.3%（High 58.9% / Main 10.6%）｜hevc 20.6%（Main 13.9% / **Main10 6.8%**）｜**mpeg4 4.0%**｜**rv40 3.8%**｜mpeg2 0.2%｜wmv3 0.04% |
| 位深 × codec | h264\|8 71.0%｜hevc\|8 13.9%｜**hevc\|10 6.8%**｜mpeg4\|8 4.0%｜rv40\|8 3.8%｜h264\|10 0.2%（仅 4 个） |
| 色度 | **4:2:0 99.9%** |
| 容器 | mp4/mov 69.2%｜mkv 25.9%｜**rm 3.8%**｜flv 0.8%｜avi 0.2% |
| 分辨率 | 1080p+ 68.6%｜720p+ 14.2%｜480p+ 8.4%｜**4K 4.5%（110，其中 10bit 52）**｜SD 4.3% |
| **长边 ≤1920（默认无需缩小）** | **94.5%（2310/2444）** |
| 帧率 | 23.976 41.9%｜25 25.1%｜24 11.9%｜29.97 9.6%｜**23.974~23.980 抖动值 ≈ 6.6%** |
| 音频 | aac 83.4%｜eac3 8.6%｜ac3 5.5%｜dts 1.1%｜**cook(RealAudio) 0.7%**｜truehd 0.04% |

### 7.3 由真实数据修正的三条规则

1. **fps：改"标称帧率 + 容差"，不要无条件用 `avg_frame_rate`**（修正 §3 的写法）。
   真实数据里 `r=24.000 / avg=23.975`、`r=25.000 / avg=25.003`、`r=15.000 / avg=15.015` 这类抖动是**常态**（37% 的文件属 23.976 家族，实测值在 23.974~23.980 之间）。若拿 avg 与目标帧率严格比较，正常片会被误判为"需要改帧率"。
   **规则**：`r` 落在 [1,240] 且与 `avg` 相对差 ≤5% → 用 `r`（标称）；否则用 `avg`（覆盖测试集里裸流的 `r=1200000/1`）；**比较目标帧率时用 ±2% 容差**（23.976↔24 = 0.1% 判为不变，23.976↔25 = 4.1% 判为需改）。
2. **`attached_pic` 排除是最高 ROI 的字段修正**：真实片库 11.4%（279 个动画 mp4 带 mjpeg 封面，且**与"多视频流"完全重合**）。不排除就会把 320x240 封面当主视频处理。
3. **`SAR` 校正显示尺寸**：4.8%（118 个，含《辛德勒的名单》SAR=27:22、《火的战车》53:45 这类 DVD 转录）。`--dimension` 的长边必须用 `width × SAR` 得到的显示宽高，否则缩放尺寸会偏（例如 720x480 SAR=27:22 实际显示 16:9）。

### 7.4 位深对齐在真实片库的影响面（直接对应 P0-2）

- 10bit 文件 **169 个（6.9%）**，**全部是 `yuv420p10le`**；若目标预设是 h264，则这 169 个都要走位深对齐（`h264_nvenc/qsv` 不吃 10bit）。
- **其中 117 个（169 - 52 个 4K 内）长边 ≤1920 → 任务不需要缩放**，位深对齐只能靠**独立于缩放**的 `depthAlignNeeded` 路径输出（`docs/CHANGES-20260921.md` 23:00 条已修）；否则会被"无缩放不输出 `-vf`"的门控整段跳过 → 白落 libx264。
- 但 **`buildEncoderArgs()` 仍只收到 `pixFmt`、没收到 mediainfo 的独立 `bitDepth`** → mediainfo 回退路径下（`pixelFormat="YUV4:2:0"`）这 169 个文件仍会漏掉对齐（§5.1 的 P0）。

### 7.5 真实片库里的边缘但真实存在的需求

| 项 | 数量 | 说明 |
| --- | --- | --- |
| **rv40（RealVideo）** | 94（3.8%） | **无任何硬件加速**（NVDEC/QSV/DXVA 都不支持）→ 必然落软解；音频多为 `cook`（RealAudio） |
| mpeg4 (Simple/ASP) | 98（4.0%） | cuda 有 `mpeg4_cuvid` ✓，但 qsv/d3d/vulkan 都不行（只有 cuda 覆盖） |
| mpeg2video | 5 | cuda/qsv/d3d 都可硬解 |
| 隔行（tt/bb） | 6 | 纪录片 mkv/ts → 需反交错 |
| Dolby Vision | 7 | 只能用 mediainfo `HDR_Format` 识别；保 DV 需 `-c:v copy` |
| HDR Vive / ST 2094 | 1 / 3 | 同上，动态 HDR 元数据 |
| 4K+ 10bit | 52 | 全 GPU 链路收益最大的批次（实测 2.3~7.9x） |
