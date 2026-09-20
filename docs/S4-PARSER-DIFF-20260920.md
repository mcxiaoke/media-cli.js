# mediainfo vs ffprobe 解析差异分析

> 日期：2026-09-20
> 触发：用户把 mediainfo 放入 PATH（`C:\Home\Apps\ffmpeg\bin\MediaInfo.exe`，MediaInfoLib v26.05）
> 脚本：`research/hwtest/e2e/compare_parsers.mjs`
> 样本：8 个真实文件（h264/av1/vp9/hevc-10bit/hevc-422/mpeg4/rmvb/含字幕 mkv）
> 结果：**90 处字段值差异**

---

## 〇、先更正一条过时记忆

| 旧记忆 | 现状 |
| --- | --- |
| "本机 mediainfo CLI 不可用（PATH 与 ffmpeg bin 下均无，es 也搜不到）" | ❌ **已过时**。现位于 `C:\Home\Apps\ffmpeg\bin\MediaInfo.exe`，`mediainfo --Version` 返回 `MediaInfoLib - v26.05` |

**重要后果**：`lib/mediainfo.js` 的 `getMediaInfo()` 默认 `useMediaInfo: true`，会**优先走 mediainfo**。mediainfo 一旦可用，所有解析结果自动切换到 mediainfo 路径——这正是本次回归的成因。

---

## 一、🔴 严重：一个由 mediainfo 启用引入的真实回归

### 1.1 现象

`lib/hwaccel.js` 的 `bitDepthOf()` 只从 pixelFormat 字符串推断位深。但两个 provider 的 pixelFormat 语义**完全不同**：

| provider | 8bit 源 | 10bit 源 |
| --- | --- | --- |
| **ffprobe** | `yuv420p` | `yuv420p10le` ← 位深**内嵌** |
| **mediainfo** | `YUV4:2:0` | `YUV4:2:0` ← **完全相同！位深不在字符串里** |

实测：

```
hevc_4k25P_main10_2.mp4 (HEVC Main10)
  provider    = mediainfo
  pixelFormat = "YUV4:2:0"
  bitDepth    = 10            ← 只在独立字段里
  bitDepthOf(pixelFormat) = "8bit"   ❌ 误判
  → 选 h264_nvenc → 编码 10bit 源失败
```

### 1.2 影响链

```
mediainfo 可用
  → getMediaInfo 默认走 mediainfo
  → pixelFormat = "YUV4:2:0"（无位深信息）
  → bitDepthOf() 恒返回 "8bit"
  → pickEncoder() 选 h264_nvenc / h264_qsv
  → 10bit 源编码失败（"Provided device doesn't support required NVENC features"）
```

**这直接破坏 S-4 实现里「10bit 源必须用 hevc 编码器」这条核心约束。**

### 1.3 修复

`bitDepthOf()` 增加 `explicitBitDepth` 参数，优先使用 mediainfo 的 `BitDepth` 字段：

```js
export function bitDepthOf(pixFmt, explicitBitDepth) {
    // 优先用显式位深（mediainfo 提供，ffprobe 通常没有）
    const n = Number(explicitBitDepth)
    if (Number.isFinite(n) && n > 0) return n >= 9 ? "10bit" : "8bit"
    if (!pixFmt) return "8bit"
    // 退回解析像素格式串（ffprobe 路径）
    return /(p10|p12|p16|10le|12le|16le|10be|12be|16be)/i.test(pixFmt) ? "10bit" : "8bit"
}
```

并把 `bitDepth` 贯穿到整条链路：
`cmd_ffmpeg.js` → `selectTier` → `probeLayer` → `buildProbeArgs` / `buildLayerArgs` → `pickEncoder` / `buildEncoderArgsForSource` / `probeCacheKey`

### 1.4 修复验证

| 文件 | provider | pixelFormat | bitDepth | 判定 | cuda 编码器 |
| --- | --- | --- | --- | --- | --- |
| hevc_4k25P (10bit) | mediainfo | `YUV4:2:0` | 10 | **10bit** | **hevc_nvenc** ✅ |
| hevc_4k25P (10bit) | ffprobe | `yuv420p10le` | (无) | **10bit** | **hevc_nvenc** ✅ |
| hevc_4k50P (422 10bit) | mediainfo | `YUV4:2:2` | 10 | **10bit** | **hevc_nvenc** ✅ |
| bbb720 (8bit) | mediainfo | `YUV4:2:0` | 8 | 8bit | h264_nvenc ✅ |

两个 provider 现在**结论一致**。回归测试 `npm test` 71/71 通过，lint 零 error，真实素材 E2E 10/10 通过。

---

## 二、90 处差异的完整分类

### 2.1 类型不同（最危险）

| 字段 | mediainfo | ffprobe | 风险 |
| --- | --- | --- | --- |
| `video.aspectRatio` | `1.78`（**number**） | `"16:9"`（**string**） | 下游做数值比较/运算会出错或恒 false |
| `video.bitDepth` | `8` / `10` | `undefined` | 见第一节 |
| `video.size` | `4811768` | `0` | ffprobe 侧不可用（见 2.4） |

### 2.2 命名体系不同（key 相同、value 不同）

| 字段 | mediainfo | ffprobe |
| --- | --- | --- |
| `format`（顶层） | `mpeg-4` / `webm` / `avi` / `realmedia` / `matroska` | `QuickTime / MOV` / `Matroska / WebM` / `AVI (Audio Video Interleaved)` / `RealMedia` |
| `video.format` | `avc` / `mpeg-4 visual` / `realvideo 4` | `h264` / `mpeg4` / `rv40` |
| `video.codec` | `V_VP9` / `V_MPEGH/ISO/HEVC` / `A_DTS`（CodecID） | `[0][0][0][0]` / `avc1`（codec_tag_string） |
| `video.profile` | `Main 4:2:2 10` / `Simple` / `0` | `Rext` / `Simple Profile` / `Profile 0` |
| `video.language` | `en`（ISO 639-1） | `eng`（ISO 639-2） |
| `createdAt` | `2019-01-23 03:37:29 UTC` | `2019-01-23T03:37:29.000000Z` |

**影响**：任何按 `format`/`profile` 做判断的代码（如预设匹配、编码器选择）在两个 provider 下行为不同。

### 2.3 数值精度差异（来源不同）

| 字段 | mediainfo | ffprobe | 原因 |
| --- | --- | --- | --- |
| `bitrate`（整体） | 3852989 | 3852988 | 舍入 |
| `video.bitrate` | 4000000 | 3849414 | mediainfo 取**声明值**，ffprobe 取**实测均值** |
| `audio.bitrate` | 128000 | 124158 | 同上 |
| `duration`（rmvb） | 11.01 | 11.14 | 容器声明 vs 实际 |
| `video.level` | `4` / `0` | `8` / `-99` | 级别数值体系不同（-99 = ffprobe 未知） |

**影响**：码率智能缩放（`smartBitrate`）会因 provider 不同算出不同目标码率。

### 2.4 一侧缺失

| 字段 | mediainfo | ffprobe | 说明 |
| --- | --- | --- | --- |
| `video.bitDepth` | ✅ 有 | ❌ 无 | ffprobe 请求了 `bits_per_raw_sample`/`bits_per_sample` 但该容器下为空 |
| `video.size` | ✅ 有 | ❌ `0` | **`lib/mediainfo.js:50` 的 stream 字段清单没有请求 `size`** |
| `audio.profile` | ❌ 无 | ✅ `LC` / `DTS-HD MA` | — |
| `video.profile` | ✅ 有 | 部分无 | — |

**`video.size` 是个独立问题**：`media_parser.js:136` 写了 `data["size"] || data["tags"]?.["NUMBER_OF_BYTES"] || ...`，但 `mediainfo.js` 的 ffprobe 字段清单里**没有 `size`**，所以 `data["size"]` 永远是 undefined。这条 `||` 链形同虚设。

### 2.5 差异量分布

| 文件 | 差异数 |
| --- | --- |
| hevc_4k25P_main10_2.mp4 | 14 |
| hevc_4k50P.mp4 | 14 |
| 1.avi | 14 |
| 11.rmvb | 11 |
| PE2_Leopard_4K.mkv | 10 |
| Big_Buck_Bunny_1080.webm | 10 |
| Big_Buck_Bunny_1080.mkv | 9 |
| Big_Buck_Bunny_1080.mp4 | 8 |
| **合计** | **90** |

---

## 三、建议

| # | 建议 | 优先级 |
| --- | --- | --- |
| 1 | **`bitDepthOf` 必须同时接收 pixelFormat + bitDepth**（已修） | 🔴 已修 |
| 2 | **统一 `aspectRatio` 类型**：mediainfo 给数字、ffprobe 给字符串，下游应按数值归一化 | 🔴 高 |
| 3 | **明确 provider 策略**：`getMediaInfo` 默认走 mediainfo 后，所有依赖 `format`/`profile` 的判断都变了。要么固定 provider，要么在解析层做值归一化 | 🔴 高 |
| 4 | **补 ffprobe 字段清单的 `size`**，让 `media_parser.js:136` 的 `||` 链真正生效 | 🟡 中 |
| 5 | **`video.codec` 语义不一致**：mediainfo 给 CodecID，ffprobe 给 codec_tag_string，后者常是 `[0][0][0][0]` 无意义值 | 🟡 中 |
| 6 | **`level` 归一化**：ffprobe 的 `-99` 是"未知"，不该当数值参与比较 | 🟡 中 |
| 7 | 建立 provider 一致性测试，防止未来再次漂移 | 🟢 低 |

---

## 四、复现

```bash
# 需要 mediainfo 在 PATH
export PATH="/c/Home/Apps/ffmpeg/bin:$PATH"
cd research/hwtest/e2e
node compare_parsers.mjs
```
