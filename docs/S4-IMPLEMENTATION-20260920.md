# S-4 硬件加速分层实施报告

> 实施日期：2026-09-20
> 方案依据：`docs/S-4-HWACCEL-PLAN-v2-20260920.md`、`docs/S-4-SCALE-PARAMS-20260920.md`
> 本机环境：Windows 10 + RTX 4070 + Intel UHD 750（无 AMD 显卡）

---

## 一、交付物

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `lib/hwdetect.js` | 新增 | **第一层**：硬件能力检测（设备级） |
| `lib/hwaccel.js` | 新增 | **第二层**：文件探测、层级定义、参数生成 |
| `cmd/cmd_ffmpeg.js` | 改造 | 接入双层决策，替换旧 `canUseCUDADecoder` |
| `lib/ffmpeg_presets.js` | 改造 | `filters` 改占位符，移除 `force_original_aspect_ratio` |
| `temp/backups/cmd_ffmpeg.js.bak-*` | 备份 | 改动前备份 |
| `temp/backups/ffmpeg_presets.js.bak-*` | 备份 | 改动前备份 |

---

## 二、分层架构

### 2.1 双层决策（按你的要求）

```
┌─────────────────────────────────────────────────────────────┐
│ 第一层：硬件检测（设备级，进程内缓存，只跑一次）              │
│   lib/hwdetect.js · detectHardwareCapabilities()            │
│                                                             │
│   ffmpeg -encoders  → 静态能力（有哪些编码器）               │
│   ffmpeg -hwaccels  → 有哪些 hwaccel                        │
│   ffmpeg -filters   → 有哪些硬件滤镜                        │
│   + 真实设备初始化探测 → 排除「列在 -encoders 但设备不可用」  │
│                                                             │
│   输出：candidateTiers() → [cuda?, qsv?, amf?, d3d?, cpu]   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ 第二层：文件探测（文件级，按组合缓存）                        │
│   lib/hwaccel.js · selectTier()                             │
│                                                             │
│   逐层干跑（探测命令 == 真实命令，只看退出码，带超时）        │
│   缓存键 = 层|编码|位深|像素格式|尺寸档                       │
│                                                             │
│   输出：最终层 + 尺寸 + 降级链 + 原因                         │
└─────────────────────────────────────────────────────────────┘
```

**为什么必须双层**（你的判断，实测印证）：

| 只看硬件 | 只看文件 | 双层 |
| --- | --- | --- |
| 无 N 卡仍会尝试 cuda | 无法预筛，每次都要试遍所有层 | ✅ 先按厂商排除不可能项，再按文件确认 |

### 2.2 实测：本机硬件检测结果

```
vendor: nvidia
usable: { cuda: true, qsv: true, amf: false, d3d: true, cpu: true }
staticOk:{ cuda: true, qsv: true, amf: true,  d3d: true, cpu: true }
probeDetail: {
  cuda: "device ok",
  qsv:  "device ok",
  d3d:  "device ok",
  amf:  "DLL/device unavailable (e.g. amfrt64.dll)"   ← 静态有、实际不可用
}
```

**关键**：`h264_amf` **列在 `-encoders` 里**，但设备探测失败。若只看静态能力会误判 AMF 可用 —— 这正是双层中「设备探测」的价值。

---

## 三、三种模式的实测行为

### 3.1 auto 模式（默认）

```
候选: cuda → qsv → d3d → cpu（逐层降级）
```

| 文件 | 源 | 命中层 | 降级链 |
| --- | --- | --- | --- |
| Big_Buck_Bunny_1080_10s_5MB.mkv | h264 1920×1080 | cuda | 一次命中 |
| sample__1080__libx265__flac__30s__video.mkv | hevc 1920×1080 | cuda | 一次命中 |
| bear-vp9a-odd-dimensions.webm | vp9 161×121 | **qsv** | cuda→qsv |
| quick-brown-fox-...-hevc-rext-10bit.mp4 | hevc Rext gray10le | **d3d** | cuda→qsv→d3d |
| hls_last_segment.ts | h264 1280×720 | cuda | 一次命中 |

**结果：10/10 通过**（含 2 个纯音频跳过），分布 `{cuda:6, qsv:1, d3d:1}`

### 3.2 gpu 模式（手动指定）

```bash
--decode-mode gpu --hwaccel cuda
```

**结果：8/10**，其中 2 个**硬失败并给出明确错误**（不降级）：

```
hwaccel 'cuda' unavailable for this input (size=161x121, pix_fmt=yuv420p, codec=vp9).
Try --decode-mode auto or cpu.
hwaccel 'cuda' unavailable for this input (size=1280x720, pix_fmt=gray10le, codec=hevc).
Try --decode-mode auto or cpu.
```

✅ 符合方案 4.5「手动模式必须硬失败」。

显式 `--hwaccel amf`（本机无 A 卡）：

```
hwaccel 'amf' is not available on this machine (vendor=nvidia, usable={...amf:false...})
```

✅ 在硬件检测层就被拒绝，不会跑到 ffmpeg。

### 3.3 cpu 模式

**结果：10/10 通过**，全部 `tier=cpu`，命令中**不含 `-hwaccel`**。

---

## 四、真实 CLI 端到端验证

用真实 `index.js ffmpeg` 命令跑通（stub 掉 inquirer 交互确认）：

### auto 模式生成的实际命令

```bash
ffmpeg -hide_banner -n -v error -progress - -nostats \
  -hwaccel cuda -hwaccel_output_format cuda \
  -i Big_Buck_Bunny_720_10s_2MB.mkv \
  -vf scale_cuda=w=1280:h=720:interp_algo=lanczos,format=cuda \
  -c:v h264_nvenc -rc vbr -tune hq -cq 24 -bufsize 4000K -maxrate 4000K \
  ...
```

### 产物校验

| 源 | 源尺寸 | 产物 | 期望 | 结果 |
| --- | --- | --- | --- | --- |
| Big_Buck_Bunny_720 | 1280×720 | 1280×720 h264 yuv420p | 不放大 | ✅ |
| Sintel | 1920×818 | 1920×818 h264 | 长边=1920 保持 | ✅ |
| hevc_4k25P_main10_2 | 3840×2160 | **1920×1080 hevc yuv420p10le** | 缩小 + 保留 10bit | ✅ |

**10bit 源正确使用了 hevc 编码器并保留 `yuv420p10le`**。

---

## 五、实施中发现并修复的问题

### 5.1 🔴 QSV 质量参数被静默忽略（新发现）

```
-cq 18          → 398093 bytes
-cq 30          → 398093 bytes   ← 三档完全相同
-cq 45          → 398093 bytes

-q:v 18         → 1163905 bytes
-q:v 45         → 28756 bytes    ← 生效
```

**QSV 必须用 `-q:v`**，`-cq` / `-global_quality` 会被静默吞掉（与方案 3.5 记录的 `-vbr` 同类问题）。
已在 `lib/hwaccel.js` 的 `buildEncoderArgs()` 按层区分处理。

### 5.2 🔴 `speed=0` 被误判为越界

CLI 的 `--speed` 默认值是 **0**（表示不变速），但校验函数只认 `1`，导致：

```
Error: speed out of range [0.5, 2]: 0
```

已修复为 `0` 与 `undefined/null` 一律视为不变速。

### 5.3 🟡 像素格式字段名不匹配

`mediainfo` 返回的字段是 **`pixelFormat`**，我最初读的是 `pixFmt`/`pix_fmt`，导致 10bit 源被当成 8bit：

```
修复前: hevc_4k25P_main10_2.mp4 → 降级到 SW（h264 编码器不接受 10bit）
修复后: hevc_4k25P_main10_2.mp4 → cuda 层，hevc_nvenc，产物 yuv420p10le
```

### 5.4 🟡 `-hwaccel` 必须在 `-i` 之前

探测命令组装时 `-hwaccel` 落到了输出位置，报 `Option hwaccel cannot be applied to output`。
已将 `buildLayerArgs()` 拆为 `inputArgs` / `outputArgs` 两段。

### 5.5 🟡 行尾符污染

Python 重写把 `cmd_ffmpeg.js` 从 LF 转成 CRLF，产生 2104 条 prettier 警告。
已用二进制模式规范回 LF。

---

## 六、质量门禁

| 检查 | 结果 |
| --- | --- |
| `npm test` | **71/71 通过**（与改动前基线一致，无回归） |
| `npm run check` | **89 个 .js 全部通过**语法检查 |
| `eslint`（4 个改动文件） | **exit 0，零 error 零 warning** |
| 真实素材 auto 模式 | **10/10** |
| 真实素材 cpu 模式 | **10/10** |
| 真实素材 gpu 模式 | **8/10 + 2 个预期硬失败** |
| 真实 CLI 端到端 | **3/3 产出可解析文件，尺寸/编码正确** |

---

## 七、未完成 / 待复验

| 项 | 说明 |
| --- | --- |
| **AMF 全链路** | 本机无 A 卡，仅验证「硬件检测能正确排除」。`vpp_amf` 参数与 `-qp_i` 需 A 卡复验 |
| **音频 libfdk_aac 降级** | 属方案 4.7，本次未实施（当前构建有 libfdk_aac，不触发） |
| **i18n 文案** | 降级原因提示暂为英文硬编码，需补 `lib/i18n.js` 键 |
| **探测超时值** | 当前 15000ms 为经验值，未在超长素材上压测 |
| **失败重试链路** | 现有 `retryOnFailed` → `decodeMode=cpu` 已能对接，但未做端到端验证 |
| **vendor 多显卡** | 本机同时有 N 卡和 Intel 核显，当前优先级取 cuda；混合场景策略未细化 |

---

## 八、复现方式

```bash
# 1. 分层决策单测（走真实模块）
node temp/hwaccel-draft-tests/test_hwdetect.mjs
node temp/hwaccel-draft-tests/test_twolayer.mjs

# 2. 真实素材 E2E（随机 10 个，固定种子 20260920）
cd <research>/hwtest/e2e
python run_real_e2e.py --mode auto
python run_real_e2e.py --mode cpu
python run_real_e2e.py --mode gpu --hwaccel cuda

# 3. 真实 CLI 端到端
node run_cli_e2e.mjs
```
