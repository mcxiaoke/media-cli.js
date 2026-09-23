# 编码器 质量↔VMAF↔体积 ↔ 偏移 参考（2026-09-23）

> ffmpeg 已由 master(N-126733) 换为官方 **8.1** 后，质量参数、码率、体积在 **cpu / nvenc / qsv / amf** × **h264 / hevc / av1** 间的对等关系需重新梳理。本文基于既有标定数据，用 **VMAF 等值**口径给出：跨族质量偏移、等 VMAF 体积对比、两轴澄清、以及 mediac preset 质量对比表。

---

## 〇、数据来源（依据）

| 资产 | 路径 | 说明 |
|---|---|---|
| 原始测量 | `temp/compare/gbc01* 三种码率控制方式对比.xlsx`、`gbc07*` | 两段 1080p 动画 MV 的逐质量档位原始记录 |
| 结构化数据 | `temp/compare/_crf_data.json` | 由 Excel 转出：`{编码器:{视频:[[q, kbps, VMAF均值, low1%, 大小 MB]]}}`，q=16~51，共 6 编码器 |
| 既有成表 | `docs/ffmpeg/CRF-BITRATE-REFERENCE-20260923.md` | 质量→码率→VMAF 的逐档表（x264/x265/svtav1/h264_nvenc/hevc_nvenc/av1_nvenc），已复用其"跨族勿按数字对齐，按 VMAF"的关键结论 |
| 本次脚本 | `temp/compare/calc_offset.mjs`、`preset_quality_table.mjs`、`equal_vmaf_size.mjs` | 反插值算偏移 / 预设质量对比 / 等 VMAF 体积对比（可重跑） |

**测试素材**：gbc01《名もなき何もかも》(6:04)、gbc07《極私的極彩色アンサー》(2:48)，均为 1080p 23.976、HEVC Main10 10bit 源。**低复杂度动画类**内容。

---

## 一、先澄清两个容易搞反的轴

| 轴 | 问题 | 结论（数据支撑） |
|---|---|---|
| **轴一 · 质量刻度** | 同一个质量数字（`-crf`/`-cq`），谁的 VMAF 高？ | **nvenc 的 CQ 比 cpu 的 CRF 更"松"**：同一数字 26，x264 VMAF≈93，h264_nvenc≈98。→ 要追平 x264 的观感，nvenc 须把数字**加大 ~+7**。 |
| **轴二 · 比特效率** | 同一码率预算，谁的 VMAF 高？ | **cpu 更高效**：同 ~2021kbps，x264 VMAF≈93 vs h264_nvenc≈91。→ 这就是"cpu 编码质量比 gpu 好"的正确出处，是**比特效率**问题。 |

**不冲突**：轴一管"质量数字怎么换算"，轴二管"体积/码率谁省"。网上"nvenc 同质量体积大 8–15%"等说法属于**轴二**，而"质量偏移量"属于**轴一**——方向相反，别混用。

---

## 二、跨族质量偏移（VMAF 等值，`calculateOffset`）

偏移基准 = **各自 codec 的 CPU 编码器**（见下方⚠️模型）；正=调大/更松，负=更紧。
**约定：qsv = amf ≈ nvenc**（同一硬件 CQ 刻度，未单独标定；Intel/AMD 建议各补扫描复核）。

> ⚠️ **基准模型（重要）**：**每个 codec 的 CPU 编码器各为自己的 base（=0）** —— h264=x264 / hevc=x265 / av1=svtav1 / vp9=libvpx **互不关联**。硬件(hw)只在该 codec 内部相对它的 CPU base 加偏移。**不要跨 codec 用 x264 当统一基准**（不同 codec 的 CRF/CQ 刻度没有可比性）。偏移 = 同 codec 内 `hw等效q − cpu等效q`（VMAF 等值反插值）。

| 目标族 | 键 | base / 偏移 |
|---|---|---|
| h264 CPU (x264 CRF) | `cpu-h264` | 0（h264 基准） |
| hevc CPU (x265 CRF) | `cpu-hevc` | 0（hevc 基准） |
| av1 CPU (svtav1 CRF) | `cpu-av1` | 0（av1 基准） |
| vp9 CPU (libvpx CRF) | `cpu-vp9` | 0（vp9 基准） |
| h264 HW (nvenc/qsv/amf CQ) | `hw-h264` | **+7**（相对 x264） |
| hevc HW (nvenc/qsv/amf CQ) | `hw-hevc` | **+5**（相对 x265） |
| av1 HW (nvenc/qsv/amf CQ) | `hw-av1` | 0（svtav1 顶部饱和，数据异常，保守不偏移；粗参考） |
| vp9 HW | `hw-vp9` | 0（未标定，保守） |

**落地实现** `lib/hwaccel.js`（已导出）：

```js
const VMAF_QUALITY_OFFSET = {
    "cpu-h264": 0, "cpu-hevc": 0, "cpu-av1": 0, "cpu-vp9": 0,
    "hw-h264": 7, "hw-hevc": 5, "hw-av1": 0, "hw-vp9": 0,
}
// from 应传与 family **同 codec** 的 cpu 族，如 from="cpu-hevc"
export function calculateOffset({ family, from, quality } = {}) {
    const b = (k) => VMAF_QUALITY_OFFSET[k] ?? 0
    const offset = b(family) - (b(from) ?? 0)
    const out = { offset }
    if (quality != null) out.adjusted = Math.max(0, Math.min(51, Math.round(quality + offset)))
    return out
}
```

> 为什么用**单值常数**而非旧的分档表：q=16~51 在 VMAF 90~97 区间内，h264/hevc 族的偏移基本恒定；旧 `QUALITY_OFFSET`（`lib/hwaccel.js`）是按**字节大小**标定、且在 cuda/qsv 层直接生效，本文口径改按 **VMAF 观感**，更贴感知。两者用途不同，均保留。

---

## 三、等 VMAF 下各编码器的体积对比（反驳"体积由信息量决定"）

对同一 VMAF 目标反插值出每编码器应取的 q，再读该 q 的码率，得**相对 x264 的比率**：

| 编码器(族) | VMAF 93 | VMAF 95 | 相对 x264（省） |
|---|--:|--:|--:|
| svtav1(eff av1) | ×0.47 | ×0.43 | 省 ~55% |
| av1_nvenc | ×0.41 | ×0.41 | 省 ~60% |
| hevc_nvenc | ×0.51 | ×0.51 | 省 ~50% |
| x265(eff hevc) | ×0.66 | ×0.66 | 省 ~34% |
| h264_nvenc | ×0.71 | ×0.70 | 省 ~30% |
| x264(h264) | ×1.00 | ×1.00 | 基准 |

**结论**：**等 VMAF 下体积并不相等**。av1 ≈ h264 的 40%，hevc ≈ 50–66%，h264 系最费。"体积≈质量、由信息量决定"只对**同一编码标准内**近似成立；跨标准由编码效率主导——这正是 hevc/av1 存在的意义。

> ⚠️ **h264_nvenc(×0.70) < x264 在此数据里反常**，疑为低复杂度动画 + VMAF 顶部饱和所致，**勿外推**。稳健排序：**av1(≈0.40–0.55) < hevc(≈0.5–0.66) < h264(≈0.7–1.0)**。实拍/高动态素材整体可能上移。

---

## 四、mediac preset 质量对比表（基准 = 各 preset 自己的 `cpu-<codec>`）

> 各列给出"改用对应 码控族-codec 时，为保持同等观感(VMAF)应设的 videoQuality"。`hw-*` = nvenc/qsv/amf 通用。

| preset | codec | q | cpu-h264 | cpu-hevc | cpu-av1 | hw-h264 | hw-hevc | hw-av1 |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| h264_2k | avc | 24 | 24 | 27 | 43 | 32 | 32 | 44 |
| h264_4k | avc | 23 | 23 | 26 | 42 | 31 | 31 | 43 |
| hevc_2k | hevc | 24 | 21 | 24 | 40 | 29 | 29 | 41 |
| hevc_4ku | hevc | 20 | 17 | 20 | 36 | 25 | 25 | 37 |
| av1_2k | av1 | 28 | 9 | 12 | 28 | 17 | 17 | 29 |
| av1_4ku | av1 | 24 | 5 | 8 | 24 | 13 | 13 | 25 |
| vp9_2k | vp9 | 38 | 38 | 41 | 51 | 46 | 46 | 51 |

读法：`hevc_2k`(q24) 若改用 h264 硬件编码器，等观感应设 **hw-h264≈32**；改用 x264 则 **cpu-h264≈21**（x265 比 x264 严 +3，反向 −3）。
脚本 `temp/compare/preset_quality_table.mjs` 可对全部 30 个视频 preset 重跑出完整表。

---

## 五、结论与使用建议

1. **跨族质量对等必须用 VMAF**（轴一），不能用体积/字节数（那属轴二、且跨编码器会误导）。
2. **同 codec 内 hardware 加偏移、CPU 不加**：x265 用原值(=x264 用x264值)、h264 硬件 +7、hevc 硬件 +5、av1/vp9 硬件 0（保守）。**不同 codec 各用自己的 CPU 刻度，勿跨 codec 对数字。**
3. **"cpu 质量> gpu 质量" 指的是等码率比特效率**（轴二），与质量数值换算（轴一）方向相反，勿混用。
4. **体积预算视角**（要省体积或压到某目标）：av1 最省、hevc 次之、h264 最费，按第三节比率换算。
5. **已知局限**：
   - 仅两段**低复杂度动画**，VMAF 顶部饱和；对实拍/高动态素材，CPU 优势会拉大、硬件 CQ 偏移可能需更大。
   - **av1/svtav1 CRF→VMAF 高度非线性**，其偏移(±19~20)与等 VMAF 体积均为外推，需按内容分档或补测才能定稿。
   - **qsv=amf≈nvenc 是未验证假设**（本机仅 NVIDIA）；Intel/AMD 各投一段扫描后并入脚本即可更新。
   - **落地状态**：`normalizeQualityForEncoder`（`lib/hwaccel.js`）已接 `calculateOffset`——preset 的 `videoQuality` 视为 x264 基准索引，运行时按实际编码器实现自动补偿。若要"CRF/CQ + maxrate 峰值封顶"，`buildEncoderArgs` 仍需另接线（当前 CQ 分支不发 `-maxrate`）。

---

### 附：相关文件
- 数据：`temp/compare/_crf_data.json`；成表：`docs/ffmpeg/CRF-BITRATE-REFERENCE-20260923.md`
- 函数：`lib/hwaccel.js`（`calculateOffset`、`VMAF_QUALITY_OFFSET`）
- 重跑脚本：`temp/compare/calc_offset.mjs`、`preset_quality_table.mjs`、`equal_vmaf_size.mjs`