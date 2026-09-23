# Intel 硬件编解码 NO（不支持）分析报告

> 数据来源：`media-capabilities-supported-by-intel-hardware-20260923095654.md`（Intel 官方 oneVPL Developer Reference，ID 772607，2024-03-07）。
> 结构说明：Intel 矩阵按**硬件代次分列、codec 分行**，**✔ = 支持，空白 = 不支持**（无 N/A）。标有「fixed-function hardware + shader-based」的行为混合/shader 编码路径，空白代表该路径也不可用。
> 单元格：`✔` 绿色=支持，`✗` 红色=不支持(NO)。本报告聚焦 NO，结论仅列重要 codec 家族缺口。

## 一、编码(Encode) 支持矩阵（主流代次）

### NVENC 等价 — 编码

| Codec \ 代次 | 5代 Core | 6代 Core | 7/8代 Core | 9代 Core | 10代 Ice Lake | 10代 其他 | 11代 Core | 12/13代 Core | Iris Xe MAX(独显) | Arc A 系(独显) |
|---|---|---|---|---|---|---|---|---|---|---|
| AVC 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| AVC (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ |
| VP8 (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✗ | ✗ |
| MPEG2 (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ |
| MJPEG 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| MJPEG 8-bit, 4:2:2 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| MJPEG 8-bit, 4:4:4 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| HEVC 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| HEVC 10-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| HEVC 8-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ |
| HEVC 10-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ |
| HEVC 8-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| HEVC 10-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| HEVC 12-bit | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ |
| HEVC (fixed-function hardware + shader-based) 10-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ |
| HEVC (fixed-function hardware + shader-based) 12-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ | ✔ | ✗ |
| HEVC (fixed-function hardware + shader-based) 8-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✗ |
| HEVC (fixed-function hardware + shader-based) 10-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✗ |
| HEVC (fixed-function hardware + shader-based) 12-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ | ✔ | ✗ |
| VP9 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| VP9 10-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| VP9 8-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| VP9 10-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✔ | ✔ | ✔ | ✔ |
| AV1 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ |
| AV1 10-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ |
| HEVC 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| AV1 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## 二、解码(Decode) 支持矩阵（主流代次）

### NVDEC 等价 — 解码

| Codec \ 代次 | 5代 Core | 6代 Core | 7/8代 Core | 9代 Core | 10代 Ice Lake | 10代 其他 | 11代 Core | 12/13代 Core | Iris Xe MAX(独显) | Arc A 系(独显) |
|---|---|---|---|---|---|---|---|---|---|---|
| AVC 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| MPEG2 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| VC1 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| MJPEG 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| VP8 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✗ | ✗ |
| HEVC 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| HEVC 12-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |
| HEVC 8-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ | ✔ | ✔ |
| HEVC 12-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |
| HEVC 8-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ | ✔ | ✔ |
| HEVC 12-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |
| VP9 8-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| VP9 10-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ | ✔ | ✔ | ✗ | ✗ | ✔ | ✔ |
| VP9 12-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |
| VP9 8-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ | ✔ | ✔ |
| VP9 10-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✔ | ✗ | ✗ | ✗ | ✔ | ✔ |
| VP9 12-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |
| AV1 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |
| AV1 10-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✔ | ✔ |

## 三、编码(Encode) 支持矩阵（其他 / 嵌入式）

### 编码（其他/嵌入式）

| Codec \ 代次 | Atom x5/x7 | Atom E3900/P·C N-J | Core 混合架构 | Atom x6000E/IoT |
|---|---|---|---|---|
| AVC 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ |
| AVC (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✔ | ✔ | ✗ | ✗ |
| VP8 (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| MPEG2 (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| MJPEG 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ |
| MJPEG 8-bit, 4:2:2 | ✗ | ✔ | ✔ | ✔ |
| MJPEG 8-bit, 4:4:4 | ✗ | ✔ | ✔ | ✔ |
| HEVC 8-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ |
| HEVC 8-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| HEVC 10-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| HEVC 8-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| HEVC 12-bit | ✗ | ✗ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 8-bit, 4:2:0 | ✗ | ✔ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 10-bit, 4:2:0 | ✗ | ✔ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 12-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 8-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 10-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| HEVC (fixed-function hardware + shader-based) 12-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| VP9 8-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ |
| VP9 10-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ |
| VP9 8-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| VP9 10-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| AV1 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| AV1 10-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| HEVC 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| AV1 | ✗ | ✗ | ✗ | ✗ |

## 四、解码(Decode) 支持矩阵（其他 / 嵌入式）

### 解码（其他/嵌入式）

| Codec \ 代次 | Atom x5/x7 | Atom E3900/P·C N-J | Core 混合架构 | Atom x6000E/IoT |
|---|---|---|---|---|
| AVC 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ |
| MPEG2 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ |
| VC1 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ |
| MJPEG 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ |
| VP8 8-bit, 4:2:0 | ✔ | ✔ | ✔ | ✔ |
| HEVC 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ |
| HEVC 10-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ |
| HEVC 12-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| HEVC 8-bit, 4:2:2 | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:2:2 | ✗ | ✗ | ✔ | ✔ |
| HEVC 12-bit, 4:2:2 | ✗ | ✗ | ✗ | ✗ |
| HEVC 8-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| HEVC 10-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| HEVC 12-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ |
| VP9 8-bit, 4:2:0 | ✗ | ✔ | ✔ | ✔ |
| VP9 10-bit, 4:2:0 | ✗ | ✗ | ✔ | ✔ |
| VP9 12-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| VP9 8-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| VP9 10-bit, 4:4:4 | ✗ | ✗ | ✔ | ✔ |
| VP9 12-bit, 4:4:4 | ✗ | ✗ | ✗ | ✗ |
| AV1 8-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |
| AV1 10-bit, 4:2:0 | ✗ | ✗ | ✗ | ✗ |

## 五、逐代关键缺口（仅列重要 codec 家族）

- **5代 Core**：编码缺 AV1、HEVC(全不支持)、VP9 高位深/4:4:4、VP8；解码缺 AV1、HEVC(全不支持)、VP9 高位深/4:4:4
- **6代 Core**：编码缺 AV1、HEVC(仅 shader 混合)、VP9 高位深/4:4:4；解码缺 AV1、HEVC 4:2:2、HEVC 4:4:4、HEVC 12-bit、VP9 高位深/4:4:4
- **7/8代 Core**：编码缺 AV1、HEVC(仅 shader 混合)、VP9 高位深/4:4:4；解码缺 AV1、HEVC 4:2:2、HEVC 4:4:4、HEVC 12-bit
- **9代 Core**：编码缺 AV1、HEVC(仅 shader 混合)、VP9 高位深/4:4:4；解码缺 AV1、HEVC 4:2:2、HEVC 4:4:4、HEVC 12-bit
- **10代 Ice Lake**：编码缺 AV1、HEVC 12-bit；解码缺 AV1、HEVC 12-bit
- **10代 其他**：编码缺 AV1、HEVC(仅 shader 混合)、VP9 高位深/4:4:4；解码缺 AV1、HEVC 4:2:2、HEVC 4:4:4、HEVC 12-bit
- **11代 Core**：编码缺 AV1、VP8；解码缺 基本全支持
- **12/13代 Core**：编码缺 AV1、VP8；解码缺 基本全支持
- **Iris Xe MAX(独显)**：编码缺 AV1、VP8；解码缺 VP8
- **Arc A 系(独显)**：编码缺 HEVC 12-bit、VP8；解码缺 VP8
- **Atom x5/x7**：编码缺 AV1、HEVC(全不支持)、VP9 高位深/4:4:4、VP8；解码缺 AV1、HEVC(全不支持)、VP9 高位深/4:4:4
- **Atom E3900/P·C N-J**：编码缺 AV1、HEVC(仅 shader 混合)、VP9 高位深/4:4:4、VP8；解码缺 AV1、HEVC 4:2:2、HEVC 4:4:4、HEVC 12-bit、VP9 高位深/4:4:4
- **Core 混合架构**：编码缺 AV1、HEVC 4:2:2、HEVC 12-bit、VP8；解码缺 AV1、HEVC 12-bit
- **Atom x6000E/IoT**：编码缺 AV1、HEVC 4:2:2、HEVC 12-bit、VP8；解码缺 AV1、HEVC 12-bit

## 六、跨代规律

- **AV1 编码**：仅 **Arc A 系独显** 支持；其余所有代次（含 11/12/13 代核显）均不支持。
- **AV1 解码**：从 **11 代 Core** 与 **独显（Iris Xe MAX / Arc）** 开始支持；10 代及更早不支持。
- **HEVC 4:2:2 / 4:4:4 编码**：11 代起经「fixed-function + shader-based」混合路径支持；Arc 走固定功能；10 代仅 Ice Lake 部分支持；9 代及 5–8 代不支持。
- **HEVC 12-bit 编码**：**全代次均不支持**（所有表该行为空）。
- **HEVC 12-bit 解码** 与 **VP9 12-bit 解码**：从 **11 代** 与独显开始支持；10 代及更早不支持。
- **VP8 编码**：仅 6/7/8/9/10 代经 shader-based 支持；**5 代、独显、11/12/13 代、嵌入式** 均不支持。
- **VC1 / MPEG2 / MJPEG 解码**：覆盖最广，绝大多数代次（含嵌入式）均支持。
- **解码能力普遍强于编码**：同一代次的 HEVC/VP9 高位深、AV1 通常先出现在解码侧。

---
*生成脚本：`parse_intel.py`　·　中间数据：`intel_data.json`　·　HTML 版：`intel_no_report.html`*
