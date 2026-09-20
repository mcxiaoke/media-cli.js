# media_parser 字段类型分析报告

> 日期：2026-09-20
> 触发：mediainfo 进入 PATH 后，两个 provider 的解析结果差异暴露
> 脚本：`research/hwtest/e2e/analyze_types.mjs`、`verify_numeric.mjs`
> 样本：`F:\Temp\testvideos` 按编码分层抽样

---

## 〇、结论先行

| 问题 | 决策 |
| --- | --- |
| 要不要"全字段统一为字符串"？ | ❌ **不要**。会破坏下游数值运算 |
| 要不要改 `convertNumber`？ | ❌ **不要**。它的行为是正确的 |
| 需要针对性修复的字段 | **仅 2 处**：`video.bitDepth` 缺失兜底（已修）、`media:null` 崩溃（已修） |
| `aspectRatio` | 下游**零使用**，可用 width/height 现算，**不改** |
| `codec` 类型不一致 | 下游唯一用途是字幕 `tx3g` 判定，**实测两 provider 结果一致**，**不改** |

---

## 一、完整字段类型矩阵（实测）

抽样 40+ 文件 × 2 provider，逐字段统计 JS 类型：

| 字段 | mediainfo | ffprobe | 下游需要 | 结论 |
| --- | --- | --- | --- | --- |
| `format` | string | string | ✅ | 一致 |
| `size` | number | number | ✅ | 一致 |
| `duration` | number | number | ✅ | 一致 |
| `bitrate` | number | number | ✅ | 一致 |
| `createdAt` | string | string | ✅ | 一致 |
| `video.format` | string | string | ✅ | 一致 |
| `video.profile` | string | string | ✅ | 一致 |
| `video.bitDepth` | number | number | ✅ | 一致（但 ffprobe 侧**常缺失**） |
| `video.width` / `height` | number | number | ✅ | 一致 |
| `video.pixelFormat` | string | string | ✅ | 一致（**值语义不同**，见第三节） |
| `video.bitrate` / `duration` | number | number | ✅ | 一致 |
| `audio.format` | string | string | ✅ | 一致 |
| `audio.bitrate` / `duration` / `sampleRate` | number | number | ✅ | 一致 |
| **`video.level`** | **number \| string** | number | 显示 | ★ 不一致 |
| **`video.framerate`** | **number \| string** | number | ❌ | ★ 不一致 |
| **`video.codec`** | **number \| string** | string | 字幕判定 | ★ 不一致 |
| **`audio.codec`** | **number \| string** | string | ❌ | ★ 不一致 |
| **`video.aspectRatio`** | **number** | **string** | ❌ | ★ 不一致 |

---

## 二、逐项裁决

### 2.1 `video.level` —— 类型不一致但**无害**，不改

```
mediainfo: 1（number）或 "Main"（string，Format_Level 为文本时）
ffprobe  : 1（number）
```

**下游仅 2 处使用，都是模板字符串拼接**：

```js
// cmd/cmd_ffmpeg.js:1178
`${ivideo?.format}(${ivideo?.profile}@${ivideo?.level},${ivideo?.bitDepth})`
// cmd/cmd_ffmpeg.js:1305
showText.push(`v:${vc}(${iv.profile}@${iv.level})`)
```

模板字符串对 number/string 行为完全相同。**不影响功能。**

### 2.2 `video.framerate` —— 类型不一致但**下游未使用**，不改

```
mediainfo: 29.97（number）或 "undefined/undefined"（string，字段缺失时的拼接产物）
ffprobe  : 29.97（number）
```

`grep` 确认下游**零使用**。但注意 mediainfo 路径有个小瑕疵：当 `FrameRate` 与 `FrameRate_Num/Den` 都缺失时，会产生字面量字符串 `"undefined/undefined"`（`media_parser.js:166` 的 `||` 拼接）。**属潜在隐患，但当前无消费者，暂不改。**

### 2.3 `video.codec` / `audio.codec` —— 类型不一致但**判定正确**，不改

```
mediainfo: "tx3g" / "S_HDMV/PGS" / 55（CodecID 为纯数字时被转 number）
ffprobe  : "tx3g" / "[0][0][0][0]"（codec_tag_string）
```

**下游唯一用途**（`cmd_ffmpeg.js:1788`）：

```js
const isAllTextSubs = subs?.every((e) => e.codec === "tx3g")
```

实测两个 provider 的判定结果**完全一致且都正确**：

| 文件 | 字幕 | mediainfo codec | ffprobe codec | isAllTextSubs |
| --- | --- | --- | --- | --- |
| bear-...-avt_subt_frag.mp4 | mov_text | `tx3g` | `tx3g` | **true** ✅ |
| haruhi.mkv | ass ×3 | `S_TEXT/ASS` | `[0][0][0][0]` | **false** ✅ |

**两个 provider 都正确区分了「MP4 的 tx3g」与「MKV 的 ass」。不改。**

### 2.4 `video.aspectRatio` —— 类型不一致但**下游零使用**，不改

```
mediainfo: 1.78（number）
ffprobe  : "16:9"（string）
```

`grep -rn "aspectRatio" lib/ cmd/ test/` **结果为空**——完全没有消费者。

你的判断正确：**有 width 和 height，直接 `width / height` 现算更准**（aspectRatio 是容器声明值，可能与实际像素尺寸不符，例如 SAR ≠ 1 的变形素材）。

---

## 三、🔴 实际修复的两个真实缺陷

### 3.1 `video.bitDepth` 在 ffprobe 侧常缺失（已修）

实测：**ffprobe 的 `bitDepth` 在 15 个样本里只有 3 个有值**：

```
hevc_4k25P_main10_2.mp4   ffprobe.bitDepth = undefined
hevc_4k50P.mp4            ffprobe.bitDepth = undefined
1.avi                     ffprobe.bitDepth = undefined
```

根因：`media_parser.js:135` 读的是 `bits_per_raw_sample` / `bits_per_sample`，但这两个字段对多数容器返回空。

**同时**，mediainfo 的 `pixelFormat`（`YUV4:2:0`）**不含位深信息**，而 ffprobe 的（`yuv420p10le`）**含**。

**修复**：`bitDepthOf(pixFmt, explicitBitDepth)` 双路兜底——优先用显式位深，缺失时从像素格式串解析。这样**两个 provider 都能正确判定 10bit**：

| 文件 | provider | pixelFormat | bitDepth | 判定 | 编码器 |
| --- | --- | --- | --- | --- | --- |
| hevc 10bit | mediainfo | `YUV4:2:0` | 10 | 10bit | hevc_nvenc ✅ |
| hevc 10bit | ffprobe | `yuv420p10le` | (无) | 10bit | hevc_nvenc ✅ |
| bbb720 8bit | mediainfo | `YUV4:2:0` | 8 | 8bit | h264_nvenc ✅ |

### 3.2 `media:null` 导致崩溃 + fallback 失效（已修）

MediaInfo 对无法解析的文件返回：

```json
{ "creatingLibrary": {...}, "media": null }
```

此时 `fromMediaInfoJson` 的 `root` 为 `undefined`，`root["Format"]` 抛 **TypeError**。

而 `lib/tryfp.js` 的 `throwNativeErr` 把 TypeError 归为「编程错误」**直接 rethrow**：

```js
const programmingErrors = [EvalError, RangeError, ReferenceError, TypeError, URIError]
if (programmingErrors.includes(err.constructor)) throw err
```

**后果**：mediainfo 解析失败 → TypeError 穿透 → **mediainfo→ffprobe 的 fallback 永久失效** → 整个 `getMediaInfo` 崩溃，而不是降级。

**修复**：显式检查 `root`，抛出**可捕获的普通 Error**：

```js
if (!root) {
    throw new Error("mediainfo: no General track (unparseable file)")
}
```

修复后实测：mediainfo 失败 → 正确降级到 ffprobe。

---

## 四、为什么不该"全改"或改 `convertNumber`

### 4.1 下游**确实有数值运算**

```js
// cmd/cmd_rename.js:678
if (duration > 0) { ... }
// cmd/cmd_rename.js:680
bitrate: `${Math.floor(bitrate / 1000)}K`
```

`convertNumber` 把这些转成 number 是**必要且正确**的。全改字符串会直接破坏这两处。

### 4.2 下游做运算的字段类型**本来就稳定**

专门验证了 40 文件 × 2 provider：

```
下游做数值运算的字段 —— 非 number 的情况：
  ✅ 全部为 number，类型稳定
```

`duration` / `bitrate` / `width` / `height` / `bitDepth` / `sampleRate` 在两个 provider 下**都是 number**。

### 4.3 类型不一致的字段，下游**要么不用，要么只做字符串拼接**

见第二节逐项裁决。**没有一处因类型不一致而产生错误行为。**

---

## 五、改动清单

| 文件 | 改动 | 原因 |
| --- | --- | --- |
| `lib/media_parser.js` | `fromMediaInfoJson` 增加 `root` 空值检查 | 修 `media:null` 崩溃 + fallback 失效 |
| `lib/hwaccel.js` | `bitDepthOf(pixFmt, explicitBitDepth)` 双路兜底 | mediainfo 的 pixelFormat 不含位深 |
| `lib/hwaccel.js` | `bitDepth` 贯穿 `pickEncoder` / `buildEncoderArgsForSource` / `probeCacheKey` / `probeLayer` / `selectTier` / `buildLayerArgs` | 同上 |
| `cmd/cmd_ffmpeg.js` | 传入 `ivideo.bitDepth` | 同上 |

**未改动**（经实测确认无需改）：
`aspectRatio`、`video.level`、`video.framerate`、`video.codec`、`audio.codec`、`convertNumber`

---

## 六、质量门禁

| 检查 | 结果 |
| --- | --- |
| `npm run check` | **97 个 .js 全通过** |
| `npm test` | **71/71 通过** |
| `eslint`（3 个改动文件） | **exit 0** |
| 真实素材 E2E | **10/10 通过** |

---

## 七、遗留（低优先，当前无消费者）

| 项 | 说明 |
| --- | --- |
| `video.framerate` 可能为 `"undefined/undefined"` | `media_parser.js:166` 的 `||` 拼接产物。下游未使用，暂不改 |
| `video.codec` 在 ffprobe 下为 `[0][0][0][0]` | 对字幕无影响（tx3g 判定正确），但可读性差 |
| `video.size` 在 ffprobe 下为 0 | `mediainfo.js:50` 的 stream 字段清单未请求 `size` |
| provider 策略未固定 | `getMediaInfo` 默认走 mediainfo；`format`/`profile` 的值体系不同，若未来有按这些值做判断的代码需注意 |
