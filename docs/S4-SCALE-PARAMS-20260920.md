# S-4 缩放参数方案：dimension = 长边

> 创建：2026-09-20
> 关联：`docs/S-4-HWACCEL-PLAN-v2-20260920.md`（硬件加速分层方案 v2）
> 本机环境：Windows 10 + RTX 4070 + Intel UHD 750（无 AMD 显卡）
> 实测素材：`F:\Temp\testvideos`（formats / videos / 现场生成竖屏）
> 验证脚本：`research/hwtest/run_dimension_verify.py`、`research/hwtest/run_noup_fps_speed.py`
> 原始数据：`research/hwtest/dimension_verify.json`、`research/hwtest/noup_fps_speed_verify.json`

---

## 一、dimension 语义定义

**`dimension` = 输出视频的长边像素值。** 短边按原始宽高比等比推导，且宽高均向下对齐到偶数。

### 1.1 计算规则

```js
/**
 * 按长边约束计算输出尺寸
 * @param {number} srcW  输入宽
 * @param {number} srcH  输入高
 * @param {number} D     目标长边（如 1080 / 720 / 480）
 * @returns {{w:number, h:number}}
 */
function calcLongEdge(srcW, srcH, D) {
    const even = (x) => Math.floor(x / 2) * 2;
    // 禁止放大：目标长边不超过源长边
    const target = Math.min(D, Math.max(srcW, srcH));
    if (srcW >= srcH) {
        // 横屏 / 正方形：宽是长边
        return { w: even(target), h: even(srcH * target / srcW) };
    } else {
        // 竖屏：高是长边
        return { w: even(srcW * target / srcH), h: even(target) };
    }
}
```

> **禁止放大已内置**：`target = Math.min(D, max(srcW, srcH))`。
> 源长边 ≥ D 时正常缩小；源长边 < D 时保持原尺寸不放大。

### 1.2 关键点

| 点 | 说明 |
| --- | --- |
| **方向判定** | 必须比较 `srcW >= srcH`，**不能假设素材是横屏**。竖屏素材（手机拍摄、短视频）必须走高 = D 的分支 |
| **偶数对齐** | `Math.floor(x/2)*2` 向下取偶。**不要用 `Math.round`**，否则可能向上取到奇数再减 1，与滤镜行为不一致 |
| **禁止放大** | 目标长边取 `Math.min(D, max(srcW, srcH))`。**已内置**，见 1.3 节实测 |
| **SAR 处理** | 若素材有非 1:1 的 SAR（像素宽高比），需先按 SAR 校正。本次测试素材均为 SAR=1 |

### 1.3 禁止放大实测

对 D=1920 的验证（`research/hwtest/run_noup_fps_speed.py`）：

| 源 | 源长边 | 期望长边 | 实际输出 | 结果 |
| --- | --- | --- | --- | --- |
| 1280×720 | 1280 | 1280（保持） | 1280×720 | ✅ 不放大 |
| 1920×1080 | 1920 | 1920（等值） | 1920×1080 | ✅ |
| 3840×2160 | 3840 | 1920 | 1920×1080 | ✅ 缩小 |
| 7680×4320 | 7680 | 1920 | 1920×1080 | ✅ 缩小 |
| 1080×1920（竖） | 1920 | 1920（等值） | 1080×1920 | ✅ |
| 2160×3840（竖） | 3840 | 1920 | 1080×1920 | ✅ 缩小 |

**6/6 全部正确**：小源保持原尺寸，大源正常缩小，竖屏方向也正确。

#### 滤镜层表达式（若不使用脚本预计算）

```bash
scale=if(gte(iw\,ih)\,min({D}\,iw)\,-2):if(lt(iw\,ih)\,min({D}\,ih)\,-2)
```

**注意**：此写法只在 CPU `scale` 上实测通过。**`scale_cuda` / `scale_qsv` 上的 `-2` 已实测存在格式协商冲突**（见第四节），因此本方案仍要求**脚本层预计算显式尺寸**。

### 1.4 实测验证的尺寸表（含禁止放大后）

> 下表为**开启禁止放大后**的实测结果。`min(D, 源长边)` 决定目标长边。
> 例：1280×720 源在 D=1080 时**不放大**，保持 1280×720。

| 源尺寸 | 源长边 | D=1080 | D=720 | D=480 |
| --- | --- | --- | --- | --- |
| 1280×720 | 1280 | **1280×720**（不放大） | **1280×720**（不放大） | 480×270 |
| 1920×1080 | 1920 | 1080×608 | 720×404 | 480×270 |
| 1920×818 | 1920 | 1080×460 | 720×306 | 480×204 |
| 1920×800 | 1920 | 1080×450 | 720×300 | 480×200 |
| 3840×2160 | 3840 | 1080×608 | 720×404 | 480×270 |
| 4096×2160 | 4096 | 1080×570 | 720×380 | 480×252 |
| 7680×4320 | 7680 | 1080×608 | 720×404 | 480×270 |
| **1080×1920**（竖） | 1920 | **1080×1920**（不放大） | 404×720 | 270×480 |
| **720×1280**（竖） | 1280 | **720×1280**（不放大） | **720×1280**（不放大） | 270×480 |
| **2160×3840**（竖） | 3840 | 608×1080 | 404×720 | 270×480 |

**长边算法实测确认**（不含放大抑制时）：长边 == D，宽高比保持（容差 < 1%），宽高均为偶数。
**禁止放大实测确认**：源长边 < D 时保持原尺寸（见 1.3 节 6/6 验证）。

---

## 二、五层完整参数方案

### 2.0 通用约定

- `{W}` `{H}` = 由 `calcLongEdge()` 预先算好的**显式偶数尺寸**
- **不要依赖滤镜自动保比例**（`h=-2` / `force_original_aspect_ratio`），原因见第四节
- `{Q}` = 质量参数，`{BR}` = 码率

### 2.1 Tier 1 — cuda（NVIDIA 硬解硬编，零拷贝）

```bash
# 8bit 源
-hwaccel cuda -hwaccel_output_format cuda \
-vf "scale_cuda=w={W}:h={H}:interp_algo=lanczos,format=cuda" \
-c:v h264_nvenc -cq {Q}

# 10bit 源（必须换 hevc_nvenc）
-hwaccel cuda -hwaccel_output_format cuda \
-vf "scale_cuda=w={W}:h={H}:interp_algo=lanczos,format=cuda" \
-c:v hevc_nvenc -cq {Q}
```

| 项 | 值 |
| --- | --- |
| 滤镜 | `scale_cuda` |
| 参数名 | `w` / `h`（**不是** `width`/`height`） |
| 算法 | `interp_algo=lanczos`（可选 nearest/bilinear/bicubic/lanczos） |
| 输出格式 | `format=cuda` **必须显式指定** |
| 实测覆盖 | 8bit 源 100%；10bit 源需 hevc_nvenc |

### 2.2 Tier 1 — qsv（Intel 硬解硬编）

```bash
# 8bit 源
-hwaccel qsv -hwaccel_output_format qsv \
-vf "scale_qsv=w={W}:h={H}" \
-c:v h264_qsv

# 10bit 源
-hwaccel qsv -hwaccel_output_format qsv \
-vf "scale_qsv=w={W}:h={H}" \
-c:v hevc_qsv
```

| 项 | 值 |
| --- | --- |
| 滤镜 | `scale_qsv` |
| 参数名 | `w` / `h` |
| 算法 | `mode=hq`（可选 low_power/hq/compute/vd/ve） |
| 输出格式 | `format`（默认 `same`，通常不用改） |
| ⚠️ 限制 | **不支持 `force_original_aspect_ratio`**；**不支持 `h=-2`**（`Size values less than -1 are not acceptable`） |
| ⚠️ 限制 | **不能混 CPU `scale=`**（rc=127），必须配 `-hwaccel_output_format qsv` + `scale_qsv` |

### 2.3 Tier 1 — amf（AMD 硬解硬编）

```bash
# 解码走 d3d11va（AMF 无独立解码 hwaccel），编码走 amf
-hwaccel d3d11va \
-vf "vpp_amf=w={W}:h={H}:scale_type=bicubic" \
-c:v h264_amf

# 10bit 源
-hwaccel d3d11va \
-vf "vpp_amf=w={W}:h={H}:scale_type=bicubic" \
-c:v hevc_amf
```

| 项 | 值 |
| --- | --- |
| 滤镜 | **`vpp_amf`**（AMF 专用缩放，不是 `scale_amf`） |
| 参数名 | `w` / `h` |
| 算法 | `scale_type=bilinear\|bicubic` |
| 色彩 | `color_profile` / `in_color_range` / `out_color_range` / `in_primaries` / `out_primaries` / `in_trc` 等一整套 |
| 另有 | `sr_amf`（HQ 超分，含 `keep-ratio` / `fill` / `algorithm` 选项） |
| ⚠️ **未实测** | 本机无 A 卡且缺 `amfrt64.dll`。**仅验证到语法解析层**（滤镜名与参数名被正确识别）。`h=-2` 是否支持、实际产出尺寸均需 A 卡机器复验 |

### 2.4 Tier 2 — d3d（Windows 通用兜底）

```bash
# 8bit 源
-hwaccel d3d11va \
-vf "scale=w={W}:h={H}" \
-c:v h264_nvenc -cq {Q}

# 10bit 源（必须换 hevc_nvenc）
-hwaccel d3d11va \
-vf "scale=w={W}:h={H}" \
-c:v hevc_nvenc -cq {Q}
```

| 项 | 值 |
| --- | --- |
| 滤镜 | **CPU `scale`**（`scale_d3d11` 实测不可用） |
| 参数名 | `w` / `h`，也支持 `width`/`height` |
| 算法 | `flags=lanczos`（可选） |
| 零拷贝变体 | `-hwaccel_output_format d3d11` + nvenc，**但不能带 scale** |
| 实测覆盖 | 8bit 100%；10bit 需 hevc_nvenc |

### 2.5 Tier 4 — cpu（最终兜底）

```bash
-vf "scale=w={W}:h={H}:flags=lanczos" \
-c:v libx264 -crf {CRF}
```

| 项 | 值 |
| --- | --- |
| 滤镜 | CPU `scale` |
| 参数名 | `w` / `h` |
| 实测覆盖 | **100%（含 10bit、4:2:2、8K、非偶数高度）** |

---

## 二·五、fps 与 speed 滤镜

### 2.5.1 fps（帧率控制）

```bash
# 追加到任意层的滤镜链末尾
-vf "...scale...,fps={framerate}"
```

| 写法 | 实测结果 |
| --- | --- |
| `fps=25` | ✅ 25/1 |
| `fps=15` | ✅ 15/1 |
| `fps=60` | ✅ 60/1 |
| `fps=29.97` | ✅ 2997/100（小数自动转分数） |
| `fps=30000/1001` | ✅ 30000/1001（精确分数） |
| `scale=...,fps=25` | ✅ 顺序无关，两序均可用 |

**跨层可用性**（cuda / qsv / d3d / cpu 四层实测）：**全部 4/4 通过**。

**建议**：`fps` 放在滤镜链**末尾**（`scale` 之后），避免先降帧再缩放造成不必要的计算。用分数形式（`30000/1001`）比小数（`29.97`）更精确。

**注意**：`fps` 是重采样，会增删帧。若只要改容器声明的帧率而不重采样，应使用输出参数 `-r`（但会与 `-vf fps` 语义不同）。

### 2.5.2 speed（变速）

变速需要**视频和音频分别处理**：

```bash
# 视频：setpts 缩放时间戳
setpts=PTS/{speed}

# 音频：atempo 缩放时长
atempo={speed}
```

**推荐用 complexFilter 保证音画同步**：

```bash
-filter_complex "[0:v]setpts=PTS/{speed},{scaleFilter},fps={framerate}[v];[0:a]atempo={speed}[a]" \
-map "[v]" -map "[a]"
```

#### setpts 实测（视频）

| speed | 期望时长 | 实际 | 结果 |
| --- | --- | --- | --- |
| 0.5（慢放） | 10.56s | 10.52s | ✅ |
| 1.5 | 3.52s | 3.56s | ✅ |
| 2.0 | 2.64s | 2.72s | ✅ |
| 4.0 | 1.32s | 1.40s | ✅ |

#### atempo 实测（音频）

| speed | 结果 | 说明 |
| --- | --- | --- |
| 0.5 | ✅ 10.56s | 下限 |
| 1.0 | ✅ 5.27s | 原速 |
| 1.5 | ✅ 3.52s | |
| 2.0 | ✅ 2.64s | |
| 3.0 | ✅ 1.75s | |
| **0.4** | ❌ `Result too large` | **超出下限** |
| **0.25** | ❌ `Result too large` | **超出下限** |

**⚠️ atempo 有效范围是 `[0.5, 100]`**，低于 0.5 直接报错。超出范围需**链式拆分**：

```bash
# 0.25x 慢放 = 0.5 × 0.5
atempo=0.5,atempo=0.5      # ✅ 实测 21.1s（源 5.28s）
# 4x 快放 = 2.0 × 2.0
atempo=2.0,atempo=2.0      # ✅ 实测 1.32s
```

#### 组合实测：speed + 禁止放大 + fps

| speed | 输出 | 结果 |
| --- | --- | --- |
| 1.5 | 1920×1080, 25fps, 3.52s | ✅ |
| 2.0 | 1920×1080, 25fps, 2.64s | ✅ |

**跨层可用性**（`setpts + scale + fps` 在 cuda / qsv / d3d / cpu）：**全部 4/4 通过**。

#### 变速实现注意事项

| 点 | 说明 |
| --- | --- |
| **音频必须同步变速** | 只改视频会导致音画不同步。若源无音轨（如部分 webm/mkv），需跳过 `atempo` |
| **atempo 下限 0.5** | 低于此值必须链式拆分，建议实现里自动拆 |
| **`speed=1.0` 时应短路** | 避免无意义的 `setpts`/`atempo` 滤镜开销 |
| **变速会改变帧率感知** | `setpts=PTS/0.5` 会让帧率显示减半（30→15），配合 `fps=` 可规整 |
| **与 `-t`/`-ss` 配合** | 变速后时长变化，若需截断应按变速后的时长计算 |

### 2.5.3 完整滤镜链顺序建议

```
setpts（变速） → scale（缩放） → fps（帧率）
音频侧：atempo（变速）
```

实测该顺序在四层均可用。`setpts` 必须在 `scale` 之前，否则缩放后再改时间戳没有意义；`fps` 放最后规整输出帧率。

---

## 三、实测验证结果

### 3.1 验证方法

对 11 个素材（含 3 个现场生成竖屏）× 3 个 dimension 档位 × 7 个层配置 = **231 次执行**，每次：
1. 按长边算法算出期望尺寸
2. 真实转码 1 帧到文件
3. 用 ffprobe 读回实际尺寸
4. 校验三项：`max(w,h) == D`、`|AR_out - AR_in|/AR_in < 1%`、`w,h 均为偶数`

### 3.2 结果

| 层配置 | 通过 |
| --- | --- |
| cuda + h264_nvenc | 30/33 |
| **cuda + hevc_nvenc** | **33/33** ✅ |
| qsv + h264_qsv | 30/33 |
| **qsv + hevc_qsv** | **33/33** ✅ |
| d3d + h264_nvenc | 30/33 |
| **d3d + hevc_nvenc** | **33/33** ✅ |
| **cpu + libx264** | **33/33** ✅ |
| **合计** | **222/231** |

### 3.3 9 个失败项分析

**全部 9 个失败是同一原因**：素材 `hevc_4k25P_main10_2.mp4`（HEVC Main10 10bit）配 `h264_nvenc` / `h264_qsv`。

```
[h264_nvenc] Provided device doesn't support required NVENC features
[h264_qsv]   Current pixel format is unsupported
```

**这与缩放参数无关，是编码器位深约束**（S-4 方案 3.3 已记录）。换成 `hevc_nvenc` / `hevc_qsv` 后全部通过。

**结论：长边算法本身 231/231 零错误**，9 个失败纯属编码器选型问题。

### 3.4 竖屏验证（重点）

| 素材 | 源 | D | 期望 | cuda | qsv | d3d | cpu |
| --- | --- | --- | --- | --- | --- | --- | --- |
| portrait_1080x1920 | 1080×1920 | 1080 | **608×1080** | ✅ | ✅ | ✅ | ✅ |
| portrait_1080x1920 | 1080×1920 | 720 | **404×720** | ✅ | ✅ | ✅ | ✅ |
| portrait_1080x1920 | 1080×1920 | 480 | **270×480** | ✅ | ✅ | ✅ | ✅ |
| portrait_720x1280 | 720×1280 | 1080 | **608×1080** | ✅ | ✅ | ✅ | ✅ |
| portrait_4k | 2160×3840 | 1080 | **608×1080** | ✅ | ✅ | ✅ | ✅ |

**竖屏方向全部正确**：长边（高度）== D，宽度按比例推导。

### 3.5 非偶数高度验证

| 素材 | 源 | D | 期望 | 结果 |
| --- | --- | --- | --- | --- |
| odd_1920x818 | 1920×818 | 1080 | 1080×460 | ✅ 全层通过 |
| odd_1920x818 | 1920×818 | 720 | 720×306 | ✅ |
| odd_1920x818 | 1920×818 | 480 | 480×204 | ✅ |
| Sintel_1080 | 1920×818 | 1080 | 1080×460 | ✅ |

**显式偶数尺寸写法彻底解决了 S-4 方案里的 `height not divisible by 2` 问题**（对比：`force_original_aspect_ratio=decrease` 会产出 1080×459 奇数）。

---

## 四、为什么不用滤镜自动保比例

这是本方案的核心决策，实测依据如下。

### 4.1 三种写法的实测对比

素材 `odd_1920x818.mp4`（1920×818，D=1080）：

| 写法 | cuda | qsv | cpu | 产出 |
| --- | --- | --- | --- | --- |
| `scale=w=1080:h=-2` | ❌ | ❌ | ✅ 1080×460 | 各层不一致 |
| `scale=w=1080:h=1080:force_original_aspect_ratio=decrease` | ✅ | ❌ | ✅ | qsv 直接报错 |
| **显式 `w=1080:h=460`** | ✅ | ✅ | ✅ | **全层一致** |

### 4.2 失败原因

**cuda / qsv 上的 `h=-2` 失败**：

```
cuda: Impossible to convert between the formats supported by the filter 'Parsed_format_1' and 'auto_scale_0'
qsv:  Impossible to convert between the formats supported by the filter 'Parsed_scale_qsv_0' and 'auto_scale_0'
```

原因：`h=-2` 让滤镜自行推导尺寸，与后续显式 `format=` 的协商冲突。

**qsv 上的 `force_original_aspect_ratio` 失败**：

```
Error applying option 'force_original_aspect_ratio' to filter 'scale_qsv': Option not found
```

原因：`scale_qsv` 的 AVOptions 只有 `w` / `h` / `format` / `mode`。

### 4.3 各滤镜保比例能力对照

| 能力 | `scale_cuda` | `scale_qsv` | `vpp_amf` | CPU `scale` |
| --- | --- | --- | --- | --- |
| `h=-2`（保比例 + 偶数） | ⚠️ 语法支持但实测冲突 | ❌ 不支持 | ❓ 未实测 | ✅ |
| `h=-1`（保比例，不保证偶数） | ✅ | ✅ | ❓ | ✅ |
| `force_original_aspect_ratio` | ✅ | ❌ | ❌ | ✅ |
| `force_divisible_by` | ✅ | ❌ | ❌ | ✅ |
| 位置写法 `=640:360` | ✅ | ✅ | ❓ | ✅ |

**结论**：唯一跨全层可用且行为一致的写法是**显式传入偶数尺寸**。这也是本方案要求 `calcLongEdge()` 在脚本层预计算的原因。

---

## 五、参数对照速查表

| 维度 | cuda | qsv | amf | d3d | cpu |
| --- | --- | --- | --- | --- | --- |
| **滤镜名** | `scale_cuda` | `scale_qsv` | `vpp_amf` | `scale` | `scale` |
| **参数名** | `w`/`h` | `w`/`h` | `w`/`h` | `w`/`h` 或 `width`/`height` | `w`/`h` |
| **算法** | `interp_algo=lanczos` | `mode=hq` | `scale_type=bicubic` | `flags=lanczos` | `flags=lanczos` |
| **格式** | `format=cuda`（必填） | `format`（默认 same） | `format`（默认 same） | 自动 | 自动 |
| **hwaccel** | `-hwaccel cuda -hwaccel_output_format cuda` | `-hwaccel qsv -hwaccel_output_format qsv` | `-hwaccel d3d11va` | `-hwaccel d3d11va` | 无 |
| **8bit 编码器** | `h264_nvenc` | `h264_qsv` | `h264_amf` | `h264_nvenc` | `libx264` |
| **10bit 编码器** | `hevc_nvenc` | `hevc_qsv` | `hevc_amf` | `hevc_nvenc` | `libx264` |
| **实测覆盖** | 33/33 | 33/33 | 未实测 | 33/33 | 33/33 |

### 附加滤镜（追加到滤镜链）

| 滤镜 | 语法 | 范围/取值 | 实测 |
| --- | --- | --- | --- |
| **fps** | `fps={framerate}` | 任意正数或分数（`30000/1001`） | 四层全通过 |
| **speed（视频）** | `setpts=PTS/{speed}` | `speed > 0` | 四层全通过 |
| **speed（音频）** | `atempo={speed}` | **`[0.5, 100]`** | 超出需链式拆分 |
| **禁止放大** | `scale=if(gte(iw\,ih)\,min({D}\,iw)\,-2):if(lt(iw\,ih)\,min({D}\,ih)\,-2)` | 仅 CPU `scale` 实测 | 6/6 |

**滤镜链顺序**：`setpts` → `scale` → `fps`

---

## 六、实现约束清单

| # | 约束 | 依据 |
| --- | --- | --- |
| 1 | **尺寸必须在脚本层算好**，不依赖滤镜自动保比例 | 第四节：三种自动写法跨层行为不一致 |
| 2 | **偶数对齐用 `Math.floor(x/2)*2`** | 保证与滤镜/编码器预期一致 |
| 3 | **必须判定横竖屏**（`srcW >= srcH`） | 竖屏素材长边在高上 |
| 3b | **禁止放大：目标长边取 `Math.min(D, max(srcW, srcH))`** | 1.4 节：6/6 实测正确 |
| 4 | **10bit 源必须换 hevc 编码器** | 9 个失败项全部源于此 |
| 5 | **`scale_cuda` 必须显式 `format=cuda`** | 否则帧格式不匹配 |
| 6 | **`scale_qsv` 不能用 `force_original_aspect_ratio`，也不能用 `h=-2`** | 实测 rc=8 / rc=127 |
| 7 | **qsv 不能混 CPU `scale=`** | 实测 rc=127 |
| 8 | **d3d 层必须用 CPU `scale=`**（不用 `scale_d3d11`） | S-4 方案 3.2 + 本轮复验 |
| 9 | **AMF 路径需在 A 卡机器复验** | 本机缺 `amfrt64.dll` |
| 10 | 各滤镜参数名不统一，**不能全层共用一条参数串** | 第五节对照表 |
| 11 | **`atempo` 范围 `[0.5, 100]`，超出必须链式拆分** | 2.5.2 节：0.4/0.25 实测报错 |
| 12 | **变速必须音视频同步**（`setpts` + `atempo`） | 否则音画不同步 |
| 13 | **滤镜链顺序：`setpts` → `scale` → `fps`** | 2.5.3 节，四层实测可用 |
| 14 | **`fps` 用分数形式更精确**（`30000/1001` 优于 `29.97`） | 2.5.1 节实测 |
| 15 | **`speed=1.0` 时应短路**，避免无意义滤镜开销 | 实现建议 |

---

## 七、待复验项

| 项 | 原因 | 影响 |
| --- | --- | --- |
| **AMF `vpp_amf` 全链路** | 本机无 A 卡、缺 `amfrt64.dll` | 2.3 节参数为语法层验证，实际可用性未知 |
| **AMF 是否支持 `h=-2`** | 同上 | 若支持可简化，但按统一策略仍建议显式计算 |
| **`sr_amf` 超分路径** | 同上 | 本方案未采用 |
| **qsv 10bit 完整矩阵** | 仅验证 hevc_qsv 单点 | 10bit 4:2:2 等边缘格式未测 |
| **SAR ≠ 1 的素材** | 测试素材均为 SAR=1 | 若存在变形素材需先做 SAR 校正 |
| **`fps` 与输出 `-r` 的差异** | 仅测了 `-vf fps` | `-r` 是容器声明，语义不同 |
| **变速与 `-ss`/`-t` 配合** | 未测 | 变速后时长变化，截断点需重新计算 |
| **atempo 上限 100 的实际行为** | 仅测到 3.0 | 极高倍速未验证 |
| **无音轨素材的变速** | 部分素材无音轨 | 需在实现中跳过 `atempo` |

---

## 八、附：验证复现

```bash
# 1. 生成竖屏与特殊比例素材
ffmpeg -f lavfi -i testsrc2=size=1080x1920:rate=25 -t 1 -c:v libx264 -pix_fmt yuv420p portrait_1080x1920.mp4
ffmpeg -f lavfi -i testsrc2=size=1920x818:rate=25 -t 1 -c:v libx264 -pix_fmt yuv420p odd_1920x818.mp4

# 2. 运行长边验证
cd research/hwtest
python run_dimension_verify.py
# 输出 dimension_verify.json（231 条记录）

# 3. 单点复核（竖屏 D=1080 应得 608x1080）
ffmpeg -hwaccel cuda -hwaccel_output_format cuda -i portrait_1080x1920.mp4 \
  -vf "scale_cuda=w=608:h=1080,format=cuda" -c:v h264_nvenc -frames:v 1 out.mp4
ffprobe -select_streams v:0 -show_entries stream=width,height -of csv=p=0 out.mp4
# → 608,1080

# 4. 禁止放大 + fps + speed 验证
cd research/hwtest
python run_noup_fps_speed.py
# 输出 noup_fps_speed_verify.json（34 条记录）

# 5. 单点复核（禁止放大：720p 源 D=1920 应保持 1280x720）
ffmpeg -i Big_Buck_Bunny_720_10s_2MB.mkv \
  -vf "scale=if(gte(iw\,ih)\,min(1920\,iw)\,-2):if(lt(iw\,ih)\,min(1920\,ih)\,-2)" \
  -c:v libx264 -frames:v 1 out.mp4
# → 1280x720（未放大）

# 6. 单点复核（atempo 下限）
ffmpeg -i src.mp4 -vn -af "atempo=0.4" -c:a aac out.m4a
# → Error opening output files: Result too large
ffmpeg -i src.mp4 -vn -af "atempo=0.5,atempo=0.5" -c:a aac out.m4a
# → 成功（0.25x）
```
