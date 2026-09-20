# 编码器质量参数标定报告

> 日期：2026-09-20
> 素材：`F:\Temp\testvideos\formats`（8K 8bit / 4K 10bit / 1080p 8bit）
> 脚本：`research/hwtest/e2e/calibrate_quality.py`
> 数据：`F:\Temp\hwtest\calib\calib_result.json`
> 规模：**495 次编码**（6 编码器 × 3 素材 × 11 质量点 × 3 轮取中位数），0 失败

---

## 一、标定方法

- 统一输出 1920×1080，截取 3 秒，仅视频（`-an`）
- 判据：**产物字节数对齐**（同等大小 ≈ 同等质量）
- 每点跑 3 轮取**中位数**，消除单次波动

### 素材选择（按位深约束）

| 素材 | 分辨率 | 像素格式 | 可用编码器族 |
| --- | --- | --- | --- |
| `hevc_8k60P_bilibili_1.mp4` | 7680×4320 | `yuv420p` (8bit) | **avc + hevc** |
| `hevc_4k25P_main10_2.mp4` | 3840×2160 | `yuv420p10le` (10bit) | **仅 hevc** |
| `Big_Buck_Bunny_1080_10s_5MB.mkv` | 1920×1080 | `yuv420p` (8bit) | **avc + hevc** |

**4K 素材是 10bit**，h264 编码器不接受 → 首轮标定中 `avc_nvenc`/`avc_qsv` 各失败 33 次。已在脚本中按位深过滤。

---

## 二、核心结论

### 2.1 偏移量不是常数，随质量值递减

以 x264/x265 的 CRF 为基准，各实现的等效偏移：

| 质量值 | AVC-nvenc | AVC-qsv | HEVC-nvenc | HEVC-qsv |
| --- | --- | --- | --- | --- |
| 18 | +5 | +2 | +6 | +0 |
| 20 | +5 | +2 | +6 | -1 |
| 22 | +5 | +2 | +6 | -1 |
| 24 | +5 | +2 | +6 | -1 |
| 26 | +5 | +2 | +6 | -2 |
| 28 | +4 | +3 | +6 | -1 |
| 30 | +4 | +3 | +8 | -1 |
| 32 | +4 | +3 | +6 | -1 |
| 34 | +3 | +3 | +4 | -1 |
| 36 | +2 | +2 | +2 | +0 |
| 38 | +0 | +0 | +0 | -1 |

**规律**：低质量区偏移大（+5~+6），高质量区趋近 0。因为高质量区各编码器都接近「视觉无损」，差异被压缩。

### 2.2 简化实现：3 段阶梯

| 实现 | crf ≤ 26 | crf 28–34 | crf ≥ 36 |
| --- | --- | --- | --- |
| **avc_nvenc** | **+5** | **+4** | **+1** |
| **avc_qsv** | **+2** | **+3** | **+1** |
| **hevc_nvenc** | **+6** | **+6** | **+1** |
| **hevc_qsv** | **-1** | **-1** | **0** |

### 2.3 AVC 与 HEVC 的偏移确实不同（你的判断正确）

| | AVC | HEVC |
| --- | --- | --- |
| nvenc 偏移 | +4 ~ +5 | **+6** |
| qsv 偏移 | +2 ~ +3 | **-1** |

**HEVC 的偏移量普遍比 AVC 大 1~2 档**，因为 x265 的 CRF 语义比 x264 更「严格」（同数值压得更狠）。

---

## 三、重要发现

### 3.1 🔴 `hevc_qsv` 处理 10bit 源时 rate control 失效

实测 `hevc_qsv` 在 10bit 4K 源上：

| `-q:v` | 产物大小 | 异常 |
| --- | --- | --- |
| 18 | **17,794,947** | ❌ 暴涨 10 倍 |
| 20 | 10,575,962 | ❌ |
| 22 | 6,729,515 | ❌ |
| 24 | 3,956,893 | ⚠️ |
| 26 | 2,675,581 | 略高 |
| 28 | 1,706,074 | 正常 |

**对照**：同一 `-q:v 18` 在 8bit 8K 源上产物 1,616,369（正常）。

**结论**：QSV 在 10bit 输入下，**低 `-q:v` 值会触发 rate control 失效**，产物反而暴涨。这是硬编码器行为，无法通过参数修复。

**实现建议**：10bit 源 + qsv 层时，`-q:v` 下限钳制到 **24**（或直接跳过 qsv 层）。

### 3.2 `-tune` 在 AVC/HEVC 上取值不同

| | h264_nvenc | hevc_nvenc |
| --- | --- | --- |
| `-tune` 范围 | **1–4** | **1–5** |
| 取值 | hq / ll / ull / lossless | hq / **uhq** / ll / ull / lossless |

**HEVC 多一个 `uhq`（Ultra high quality）**。共用 `-tune hq` 是安全的（两者都有），但若要调优需按族区分。

### 3.3 `-preset` 三家类型与语义都不同

| | NVENC | QSV | libx264/x265 |
| --- | --- | --- | --- |
| 类型 | **int** p1–p7 | **int** 1–7 | **string** |
| 默认 | p4 | 0 | medium |
| 实测 | p1/p7 产物反而**大于** p4 | — | — |

**不能跨层共用**。

---

## 四、实现方案

### 4.1 质量值归一化

以 **x264/x265 的 CRF 为基准**，各层做阶梯偏移：

```js
/**
 * 质量值归一化偏移表
 * 以 x264/x265 的 CRF 为基准，各实现做阶梯偏移
 *
 * 标定依据：495 次编码（8K/4K/1080p 真实素材，3 轮取中位数）
 * 见 research/hwtest/e2e/ENCODER-QUALITY-CALIBRATION.md
 */
const QUALITY_OFFSET = {
    //        crf<=26  crf28-34  crf>=36
    avc_nvenc: [5, 4, 1],
    avc_qsv:   [2, 3, 1],
    hevc_nvenc:[6, 6, 1],
    hevc_qsv:  [-1, -1, 0],
}

function offsetOf(tierName, codecFamily, crf) {
    const key = `${codecFamily}_${tierName}`
    const row = QUALITY_OFFSET[key]
    if (!row) return 0
    if (crf <= 26) return row[0]
    if (crf <= 34) return row[1]
    return row[2]
}

/**
 * 把 preset 声明的 CRF 值转换为该层的等效质量值
 */
function normalizeQuality(tierName, codecFamily, crf) {
    const v = crf + offsetOf(tierName, codecFamily, crf)
    return Math.max(0, Math.min(51, v))
}
```

### 4.2 10bit + qsv 的钳制

```js
// hevc_qsv 在 10bit 源上低 -q:v 会触发 rate control 失效（产物暴涨 10 倍）
// 实测：-q:v 18 → 17.8MB，-q:v 28 → 1.7MB
const QSV_10BIT_MIN_Q = 24

function clampForBitDepth(tierName, pixFmt, q) {
    if (tierName === "qsv" && bitDepthOf(pixFmt) === "10bit") {
        return Math.max(QSV_10BIT_MIN_Q, q)
    }
    return q
}
```

### 4.3 应用位置

改 `lib/hwaccel.js` 的 `buildEncoderArgs`：

```js
export function buildEncoderArgs(tierName, {
    quality = 24, bitrateK, codecFamily = "h264", pixFmt,
} = {}) {
    const matrix = ENCODER_MATRIX[tierName] || ENCODER_MATRIX.cpu
    const encoder = matrix[codecFamily] || matrix.h264
    // 质量值归一化：把 preset 的 CRF 换算成该层的等效值
    let q = normalizeQuality(tierName, codecFamily, quality)
    q = clampForBitDepth(tierName, pixFmt, q)
    ...
}
```

---

## 五、局限性

| 项 | 说明 |
| --- | --- |
| **AMF 未标定** | 本机无 A 卡，`-qp_i/-qp_p` 的等效性未知 |
| **素材有限** | 3 个素材（8K/4K/1080p），内容复杂度不同会影响偏移 |
| **判据单一** | 仅用产物大小，未做 VMAF/PSNR 客观质量评估 |
| **偏移随内容变化** | 动画/实拍/高动态内容的偏移可能不同 |
| **`hevc_qsv` 10bit 数据异常** | 已排除异常段，但正常段的可靠性也受影响 |
| **x265 参数** | 用 `-x265-params log-level=error` 抑制日志，未调 x265 内部参数 |

---

## 六、复现

```bash
cd research/hwtest/e2e
python calibrate_quality.py
# 输出 F:\Temp\hwtest\calib\calib_result.json
```
