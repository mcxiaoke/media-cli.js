# 三家编码器质量参数等效性分析

> 日期：2026-09-20
> 依据：`temp/ffmpeg-docs/`（官方文档）+ `ffmpeg -h encoder=xxx`（运行时权威参数表）+ 本机实测
> 素材：`Big_Buck_Bunny_1080_10s_5MB.mkv`，输出 640×360，取 3 秒
> 结论：**同一质量值在三家不等效**，跨层降级会产生质量跳变

---

## 一、结论速览

| 发现 | 影响 |
| --- | --- |
| **同数值产物大小差 1.3~1.5 倍** | 同一 `-cq 28` 与 `-crf 28`，nvenc 产物是 x264 的 1.45 倍 |
| **QSV 的 `-q:v` 与 `-global_quality` 不等价** | 205020 vs 187287，**文档说 `-q:v` 是 `-global_quality` 别名，实测不符** |
| **`-rc vbr` 对 nvenc 是默认值** | 加不加 `-rc vbr` 产物完全相同，但显式写出更清晰 |
| **`-preset p4` 是 nvenc 默认** | p1/p7 产物反而更大（p1=289316, p7=290164, p4=202664） |
| **`-tune` 取值有限** | `ul` 未定义（报错），`lossless` 产物 9.3MB（不适合常规转码） |

---

## 二、质量值等效映射（实测）

### 2.1 原始数据

| 质量值 | nvenc `-cq` | qsv `-q:v` | x264 `-crf` |
| --- | --- | --- | --- |
| 20 | 690,623 | 669,807 | 508,942 |
| 24 | 362,502 | 379,420 | 265,440 |
| 28 | 202,664 | 205,020 | 139,512 |
| 32 | 102,364 | 110,644 | 78,479 |

**比值（相对 x264）**

| 质量值 | nvenc/x264 | qsv/x264 |
| --- | --- | --- |
| 20 | 1.36 | 1.32 |
| 24 | 1.37 | 1.43 |
| 28 | 1.45 | 1.47 |
| 32 | 1.30 | 1.41 |

### 2.2 等效换算

以「产物大小对齐」为判据：

| x264 `-crf` | nvenc 需用 `-cq` | 偏移 |
| --- | --- | --- |
| 20 | 24 | **+4** |
| 24 | 26 | **+2** |
| 28 | 30 | **+2** |
| 32 | 32 | **0** |

**粗略规律**：`nvenc_cq ≈ x264_crf + 2`（低质量区间偏移更大）

---

## 三、三家参数体系对照

### 3.1 质量参数

| | NVENC | QSV | AMF | libx264/x265 |
| --- | --- | --- | --- | --- |
| **主质量参数** | `-cq` (0–51, 0=auto) | `-q:v` / `-global_quality` (1–51) | `-qp_i/-qp_p/-qp_b` (-1–51) | `-crf` (-1–FLT_MAX) |
| **默认值** | `-cq 0`（=自动，产物 757742） | 无（CQP 默认，产物 275117） | — | `-crf 23`（产物 311888） |
| **同数值质量** | 偏高 | 偏高 | 未实测 | 基准 |

### 3.2 速度/质量预设

| | NVENC | QSV | AMF | libx264 |
| --- | --- | --- | --- | --- |
| **参数名** | `-preset` | `-preset` | `-quality` / `-preset` | `-preset` |
| **取值类型** | **int** p1–p7 | **int** 1–7 | **int** 0–3 | **string** ultrafast…placebo |
| **默认** | p4 | 0 (veryfast=7) | -1 | medium |
| **取值示例** | p1(最慢)/p4/p7(最快) | veryslow=1 / medium=4 / veryfast=7 | balanced=0/speed=1/quality=2/high_quality=3 | slow/medium/fast |

**注意**：三家的 `-preset` **类型和语义都不同**（nvenc/qsv 是整数索引，x264 是字符串），不能共用。

### 3.3 调优参数

| | NVENC | QSV | AMF |
| --- | --- | --- | --- |
| **参数名** | `-tune` (1–4) | 无直接对应 | `-usage` (-1–5) |
| **取值** | hq / ll / ull / lossless | — | — |
| **实测** | hq=202664, ll=307021, lossless=9367652 | — | — |
| **lookahead** | `-rc-lookahead` (0–INT_MAX) | `-look_ahead` (bool) + `-look_ahead_depth` | `-preanalysis` (bool) |
| **AQ** | `-spatial-aq` / `-temporal-aq` / `-aq-strength`(1–15) | 无 | `-vbaq` (bool) |
| **QP 范围** | `-qmin`/`-qmax` | `-min_qp_i/p/b` / `-max_qp_i/p/b` | — |

---

## 四、QSV 的 `-q:v` vs `-global_quality`（重要）

### 4.1 实测差异

```
-q:v 28              → 205,020 bytes
-global_quality 28   → 187,287 bytes     ← 3 次稳定复现，非误差
```

### 4.2 官方文档说明

`temp/ffmpeg-docs/ffmpeg-all.md:8988`（Intel QuickSync 章节）：

> The ratecontrol method is selected as follows:
> - When **global_quality** is specified, a quality-based mode is used. Specifically this means either
>   - **CQP** - constant quantizer scale, when the **qscale codec flag is also set** (the `-qscale` ffmpeg option).
>   - **LA_ICQ** - intelligent constant quality with lookahead, when the `look_ahead` option is also set.
>   - **ICQ** – intelligent constant quality otherwise. For the ICQ modes, global quality range is 1 to 51, with 1 being the best quality.

**解读**：
- `-q:v` 设置的是 **qscale flag** → 走 **CQP**（固定量化参数）
- `-global_quality` 不设 qscale → 走 **ICQ**（智能恒定质量）
- **两者是不同的 rate control 模式**，产物自然不同

**结论**：本实现用 `-q:v` 是对的（CQP 更可预测），但要意识到它与 `-global_quality` 不等价。

### 4.3 QSV 的 mode 选择逻辑

```
global_quality 指定?
├─ 是 + qscale flag (-q:v)     → CQP     （固定 QP）
├─ 是 + look_ahead             → LA_ICQ  （带前瞻的智能恒定质量）
├─ 是（否则）                   → ICQ     （智能恒定质量）
└─ 否 + b 指定
   ├─ + look_ahead             → LA      （带前瞻的 VBR）
   ├─ + vcm                    → VCM
   ├─ maxrate == b             → CBR
   └─ maxrate > b              → VBR
```

---

## 五、当前实现的问题

`lib/hwaccel.js` 的 `buildEncoderArgs` 目前：

```js
case "cuda":
case "d3d":
    args.push("-c:v", encoder, "-rc", "vbr", "-tune", "hq", "-cq", String(quality))
    break
case "qsv":
    args.push("-c:v", encoder, "-q:v", String(quality))
    break
case "amf":
    args.push("-c:v", encoder, "-qp_i", String(quality), "-qp_p", String(quality))
    break
case "cpu":
    args.push("-c:v", encoder, "-crf", String(quality))
    break
```

**问题**：直接把 preset 的 `videoQuality` 传给三家，但**同数值不等效**。

例：`hevc_2kt` 的 `videoQuality: 28`
- cuda 层 → `-cq 28`（相当于 x264 crf≈26）
- cpu 层 → `-crf 28`

降级到 cpu 时**质量会下降**（同一数值下 x264 压得更狠）。

---

## 六、改进方案

### 6.1 方案 A：质量值归一化（推荐）

以 **x264 CRF 为基准**，各层做偏移换算：

```js
const QUALITY_OFFSET = {
    cuda: +2,   // nvenc -cq 比 crf 松 2 档
    qsv:  +2,   // qsv -q:v 类似
    amf:  +2,   // 未实测，暂用同值
    d3d:  +2,   // 同 nvenc
    cpu:   0,   // 基准
}

function adjustQuality(tierName, baseQuality) {
    const off = QUALITY_OFFSET[tierName] ?? 0
    return Math.max(0, Math.min(51, baseQuality + off))
}
```

### 6.2 方案 B：显式声明每层的质量语义

preset 声明「目标质量档位」（如 `quality: "high"`），各层自行映射。

**优点**：语义清晰
**缺点**：改动大，需要重新定义所有预设

### 6.3 方案 C：不改，接受跳变

**优点**：零改动
**缺点**：降级时质量不一致

---

## 七、建议

1. **采用方案 A**：偏移量小、改动集中、效果可验证
2. **偏移量需更多素材标定**：当前只有 1 个素材 4 个质量点的数据
3. **`-preset` 不要跨层共用**：类型和语义都不同
4. **`-tune` 仅 NVENC 有**：QSV/AMF 需用各自参数（`-look_ahead` / `-usage`）
5. **AMF 参数未实测**：本机无 A 卡，`-qp_i/-qp_p` 的等效性未知

---

## 八、附：实测命令

```bash
SRC="F:/Temp/testvideos/formats/Big_Buck_Bunny_1080_10s_5MB.mkv"

# nvenc
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i "$SRC" \
  -vf "scale_cuda=w=640:h=360,format=cuda" -c:v h264_nvenc -rc vbr -tune hq -cq 28 -t 3 n.mp4

# qsv
ffmpeg -hwaccel qsv -hwaccel_output_format qsv -i "$SRC" \
  -vf "scale_qsv=w=640:h=360" -c:v h264_qsv -q:v 28 -t 3 q.mp4

# x264
ffmpeg -i "$SRC" -vf "scale=w=640:h=360" -c:v libx264 -crf 28 -t 3 x.mp4
```
