# 码率单位统一方案（bps → kbps）

日期：2026-09-23 ｜ 状态：**待评审**（本轮未改任何代码）

## 1. 背景与目标

`MediaCli` 目前**码率数值单位混乱**，主要有三类：

- **内部计算数值**：全部是 `bps`（bit/s），如 `dstVideoBitrate = reqVideoBitrate * pixelsScale`。
- **模板变量**：`videoBitrateK`/`audioBitrateK` 是字符串带 `K`（如 `"2000K"`），由 `Math.round(bps/1000)+"K"` 生成。
- **CLI 文档**：`i18n.js` 里 `--video-bitrate` 的 describe 写的是 *"Set video bitrate (in kbytes)"*，**但代码实际按 bps 用** —— `dstVideoBitrate = reqVideoBitrate * pixelsScale`，用户传 `2000` 会被当成 `2000 bps`（几乎不可用）。文档与实现不符，这是一处现存 bug。

目标（用户已拍板）：**内部码率一律统一为 `kbps`（1 kbps = 1000 bps）**，避免 bps/kbps 混用；并让 `buildEncoderArgs` 里 `maxrate = b:v × 1.5` 这类**数值计算**在纯数字域完成。

## 2. 关键约束（决定方案边界）

1. **模板变量 `{videoBitrateK}`/`{audioBitrateK}` 必须保持带 `K` 字符串**：
   - `audioArgs = "-c:a libfdk_aac -b:a {audioBitrateK}"` → 需要 `-b:a 256K`。
   - 文件名后缀 `suffix: "_{audioBitrateK}"` → 需要 `s_256K.m4a`。
   - 若改成纯数字，`-b:a 256` = 256 bit/s（错误），文件名变 `s_256`。**故模板层仍是字符串**。
2. **源码率来自 mediainfo（原生 bps）**：`srcVideoBitrate = ivideo?.bitrate`。改 kbps 时**只需在取源处 `/1000` 一次**，不能漏。
3. **探测链路一致性**：`bitrateK` 贯穿 `buildEncoderArgs → buildLayerArgs → buildProbeArgs → probeLayer → selectTier` 透传，改动会同时作用真实命令与探测命令（保持一致），`probeCacheKey` 随其自然失效。**统一改不产生探测/真实不一致**。

## 3. 统一后的原则

- **内部与 preset / CLI 全部用 `kbps` 纯数字**。
- **只在三条边界输出带 `K` 的字符串**：
  1. 模板变量 `videoBitrateK` / `audioBitrateK`（供 audioArgs / suffix / prefix）。
  2. `buildEncoderArgs` 拼 `-b:v / -maxrate / -bufsize` 时。
  3. 日志显示（`kNum`）。

## 4. 字段映射表（改点清单）

| 位置 | 现（bps） | 改后（kbps） |
|---|---|---|
| `presets/*.yaml` 的 `videoBitrate` | `4000000`（=4M） | `4000` |
| `presets/*.yaml` 的 `audioBitrate` | `192000` | `192` |
| `ffmpeg_plan.js` `bitrateMap` 档位 threshold/value | `320*1000`… | `320`… |
| `ffmpeg_plan.js` `srcVideoBitrate` | `ivideo?.bitrate` | `Math.round(ivideo?.bitrate/1000)` |
| `ffmpeg_plan.js` `srcAudioBitrate` | `iaudio?.bitrate` | `Math.round(iaudio?.bitrate/1000)` |
| `ffmpeg_plan.js` `dstVideoBitrate/dstAudioBitrate` | `reqVideoBitrate×scale`（bps） | 同式，单位即为 kbps |
| `ffmpeg_plan.js` `reqVideoBitrate` | `userArgs ?? preset`（bps） | `userArgs ?? preset`（kbps） |
| CLI `--video-bitrate` / `--audio-bitrate` | `number`（文档 kbytes 但实现 bps） | `number`（kbps），describe 改 kbps |
| 模板 `videoBitrateK` / `audioBitrateK` | `${Math.round(x/1000)+"K"}` | `${x+"K"}`（仍是字符串，数值已 kbps） |
| `kNum()`（日志） | `Math.round(v/1000)+"K"` | `Math.round(v)+"K"` |
| `buildEncoderArgs` 入参 `bitrateK` | `"2000K"` 字符串 | `2000` 数字(kbps) |

## 5. buildEncoderArgs 改造（对应本轮需求）

```js
// 入参：bitrateK(kbps number), [maxBitrateK](kbps number, 可选)
// 规整：入口兼容 number 或 "2000K" 字符串 → 统一 kbps number
const b = kbpsOf(bitrateK)
// maxBitrateK 缺省 = b × 1.5
const m = maxBitrateK != null ? kbpsOf(maxBitrateK) : Math.round(b * 1.5)

if (b > 0) {          // VBR 模式：有目标码率
    switch (impl) {
      case "nvenc": // 已在 switch 里，改用 kb(b)/kb(m)
        args.push("-rc","vbr","-tune","hq","-rc-lookahead","20",
                  "-b:v", kb(b), "-maxrate", kb(m), "-bufsize", kb(m))
    }
    // qsv: -b:v kb(b) -maxrate kb(m)
    // amf: -rc vbr_peak -b:v kb(b) -maxrate kb(m)
    // cpu h264/hevc: -b:v kb(b) -preset medium -maxrate kb(m) -bufsize kb(m)
    // cpu av1/vp9:  -b:v kb(b)
} else {              // CQ 模式：无目标码率（本轮已实现，不变）
    // nvenc: -cq <q> -b:v 0 / qsv: -global_quality / amf: qvbr / cpu: -crf
}
// 助手
const kb = (n) => String(Math.round(n)) + "K"
```

> 说明：这正好实现你要的"有 bitrateK 走 VBR（`-b:v`），无则走 CQ；`maxrate` 独立且缺省 = `b:v×1.5`"，且 `×1.5` 现在在 kbps 纯数字上直接算，无须解析字符串。

## 6. 要新增的字段（可选显式）

- preset 可选声明 **`videoMaxBitrateK`**（kbps 纯数字）；缺省时 `buildEncoderArgs` 自动用 `b × 1.5`（用户已定）。显式声明的预设可覆盖该默认。

## 7. 涉及修改的文件

1. `presets/default.yaml`、`presets.example.yaml` —— 所有 `videoBitrate`/`audioBitrate` bps→kbps，字段注释同步。
2. `lib/ffmpeg_plan.js` —— `bitrateMap`、src 码率 `/1000`、`kNum`、`videoBitrateK/audioBitrateK` 生成。
3. `lib/hwaccel.js` `buildEncoderArgs` —— `bitrateK` 作 kbps number、新增 `maxBitrateK` + `×1.5` 缺省、`kb()` 格式化。
4. `lib/ffmpeg_build.js` —— `bitrateK` 取 `tempPreset.videoBitrateK`（已是 kbps 数值）透传。
5. `lib/i18n.js` —— bitrate describe 单位改 kbps（修掉当前 "in kbytes" 与 bps 不符）。
6. `cmd/cmd_ffmpeg.js` ——（如需）CLI bitrate 帮助文本。
7. 测试：`test_ffmpeg_t5_hw_autofit.js`（bitrateK `"2000K"`→`2000`，断言 `-maxrate`→`"2000K"`）、`test_ffmpeg_params_v2.js`（`100000`→`100`）、`test_preset_schema.js`（`videoBitrate: 4000000`→`4000`）。

## 8. 风险与注意事项

- **外部/用户自定义 preset（bps）语义会变**：升级后旧 preset 的数值须手动 `/1000`。仓库内 `presets/` 是唯一事实源，一并改。
- **取源 `srcVideoBitrate` 漏 `/1000` 是最大风险点**：必须只在 `ivideo?.bitrate` / `iaudio?.bitrate` 处换算一次，其余全走 kbps。
- **`{bitrate}` 模板变量**：`FFMPEG-USAGE.md` 提到 `{bitrate}`，但 `calculateDstArgs` 未返回该键——需澄清它是二手房字段还是死链，避免误改。
- **CLI 传值行为变化**：`--video-bitrate 4000000` 旧写法须改为 `--video-bitrate 4000`；提及在 CHANGES/文档。
- **probeCacheKey**：bitrateK 数值变化会让旧缓存失效（预期内）。

## 9. 建议实施顺序

1. 先改 `ffmpeg_plan.js` + preset + i18n（数据源统一 kbps）。
2. 改 `hwaccel.js buildEncoderArgs`（kbps 数值 + maxBitrateK + kb()）。
3. 跑 `test/test_ffmpeg_t5_hw_autofit.js` 并更新断言。
4. 用 `data/videos` 实测 VBR（`-b:v`+`-maxrate`←×1.5）与 CQ 两条路径。

---

**待你确认的剩余问题**：
1. `videoMaxBitrateK`（预设可选显式字段）是否按此命名？还是统一用 CLI `--max-bitrate`？
2. `{bitrate}` 模板变量是否实际在用（若否，列入清理）。
3. 是否同意"外部自定义 preset 需手动把 bps `/1000`"的迁移口径（一次性破坏性变更）。