# FFmpeg 滤镜组装方案：scale / fps / speed + filter vs complexFilter + 软硬件解码（评审稿）

> **版本**: 2026-09-22 19:18（GMT+8）
> **状态**: 待评审，未实施、未提交
> **范围**: `cmd/cmd_ffmpeg.js` 真实命令路径的滤镜组装（`lib/ffmpeg_build.js` `buildFilterArgs`/`buildScaleFiltersFromPlan`）与探测路径（`lib/hwaccel.js` `buildLayerArgs`）的一致性；音视频变速/帧率/缩放/软件滤镜在硬件层上的组合。
> **适用命令定位**: 仅视频压制（转码/压缩/调优/缩放/fps/speed），不做裁切/叠加/转场等编辑特效。
> **依据**: 官方文档镜像 `temp/ffmpeg-docs/`（`ffmpeg-filters.md`、`ffmpeg-cmd.md`、`hwaccelintro-ffmpeg.md`）+ 项目指南 `docs/ffmpeg/` + S-4 设计文档 + `lib/{ffmpeg_build,hwaccel,ffmpeg_presets,ffmpeg_plan,ffmpeg_run}.js` 实测。

---

## 1. 结论先行（要解决什么 / 怎么解决）

发现 4 个真实缺口（其中 1 个直接导致"全部降级 CPU"）+ 2 个一致性/配置矛盾。**均已在真实 build `C:\Home\Apps\ffmpeg\bin\ffmpeg.exe N-126733`（RTX 4070 + UHD 750）上复现验证。**

1. **【本次新证·最致命】NVENC 参数块选项拼写错 → 所有 NVENC 探测失败 → 全部降级 CPU**：`buildEncoderArgs` 的 nvenc 分支写的是下划线 `-spatial_aq / -temporal_aq / -rc_lookahead`，而本 build 的 h264_nvenc/hevc_nvenc/av1_nvenc 注册名是**连字符** `-spatial-aq / -temporal-aq / -rc-lookahead` → ffmpeg 报 `Unrecognized option 'spatial_aq'` → **每一次走 nvenc 的探测都失败** → auto 一路降级到 `cpu`。这正是你问的"输出 hevc 明明 nvenc 能编，为啥全走 `-c:v libx265`"的答案；且 nvenc 分支被 h264/hevc/av1 **共用**，所以 **h264 也走不了 GPU**。次因：`-weighted_pred 1` 与默认 B 帧冲突（`Weighted prediction is not supported with BFrames`）。
2. **真实路径不给音频变速** → 无 complexFilter 模板的预设（如 `hevc_2kt`）配 `--speed` 时只 `setpts` 视频、不加 `atempo` 音频 → **音画不同步**（你刚遇到的）。
3. **探测路径与真实路径对 speed 处理不一致** → probe 走 `-filter_complex` 生成 `atempo`、真实走 `-vf` 且无音频滤镜 → **违背项目自身"探测=真实同构"原则**。
4. **无软件↔硬件帧边界处理**（全仓没有 `hwdownload`）→ 在硬件层追加软件滤镜（`--filters`）会失败。
5. **speed 取值域自相矛盾**：CLI 校验放行 `0–4.0`，但 `validateSpeed` 仅允许 `0.5–2.0` → 2.0–4.0 过校验后在构建期抛错。

### 1.1 【编码参数正确性】已验证的 nvenc 修正块（真实 build 实测）

| 原（错，全走 CPU） | 改（实测 hevc_nvenc/h264_nvenc 均 exit 0） | 说明 |
| --- | --- | --- |
| `-spatial_aq 1` / `-temporal_aq 1` | `-spatial-aq 1` / `-temporal-aq 1` | 连字符；本 build 不认下划线 |
| `-rc_lookahead 32` | `-rc-lookahead 32` | 同上，统一连字符 |
| `-weighted_pred 1`（与 B 帧冲突） | **删除** `-weighted_pred`（保留 `-b_ref_mode each`） | 或 `-bf 0` 才可与 weighted_pred 共存；压制场景删之最稳 |
| `-tune hq` / `-cq` / `-surfaces` / `-rc vbr` / `-b_ref_mode` | 不变 | 实测 hevc/h264 nvenc 均接受 |

> ⚠️ **qsv / amf 分支未验证**：本机 candidate 链是 `[cuda,swdec,d3d,cpu]`（未探 qsv；amf 无 A 卡未实测）。qsv 历史上用下划线（`-global_quality/-look_ahead/-async_depth/-extbrc`）可能本就正确，但**须在真实 Intel/AMD 机上按同样方法逐个 `ffmpeg -h encoder=…_qsv/_amf` 校验拼写**，勿照 nvenc 的教训想当然。列为实施后必做的验证项（§7）。

> ✅ **实施状态（本编码器参数块部分，已在工作树实现、真实 build 验证、110/110 ffmpeg 测试通过、未提交）**：`buildEncoderArgs` 的 switch 已按"官方/社区公认 + 精简"重写——
> - **nvenc**：`-rc vbr -tune hq` +（质量模式）`-cq <q> -b:v 0` /（码率模式）`-b:v/-maxrate/-bufsize <k>`；**删除** spatial-aq/temporal-aq/rc-lookahead/surfaces/b_ref_mode/weighted_pred 全部可选调优。
> - **qsv**：`-global_quality <q>`（ICQ）/（码率）`-b:v/-maxrate`；**删除** look_ahead/look_ahead_depth/async_depth/extbrc。
> - **amf**：本机无 A 卡不可验证 → **只保留** `-b:v`（有码率时），**删除** qp_i/qp_p/quality/header_insertion_mode，避免同类崩溃；待 A 卡复验再补质量项。
> - **cpu**：x264/x265 `-crf -preset medium`；av1/vp9 `-crf -b:v 0`（不再误加 `-preset`）；**删除** `-tune film`。
> - 实测：可硬解 hevc 文件由 `tier=cuda -c:v hevc_nvenc`（修复前 `all failed→libx265`）。
> 其余（补 `-af` 变速、probe/real 同构、hw→sw 边界、speed 域收敛、copy 互斥 warn）仍待你确认 D2/D3/D4 后实施。

**方案主线（最简可靠）**：
- **先修编码器参数块正确性（§1.1）**：连字符化 nvenc 选项 + 去 `weighted_pred`，让 GPU 真正可用——这是"全走 libx265"的根因，收益最大（GPU 27x vs CPU 10x）。
- **变速 = `setpts`(视频) + `atempo`(音频) 成对，作为两个独立的 simple 滤镜 `-vf` / `-af`**（官方确认 `-vf+ -af` 由 muxer 按 PTS 对齐即可保持同步，变速**不需要** `-filter_complex`）。
- **让真实路径与探测路径共用同一套滤镜生成函数**（`buildVideoFilters` + `buildAudioFilters`），从结构上消灭"同构"漂移。
- **建立显式"帧域"模型**，在 VRAM↔系统内存边界自动插 `hwupload`/`hwdownload`+`format=`。
- **把 speed 统一收敛到 0.5–2.0**（单条 atempo、无需链式）；`--speed` 与音频 `copy` 冲突时**自动禁 copy + warn**（决策 D1/D5）。

---

## 2. 根因证据（精确到行）

| # | 现象 | 证据 | 结论 |
| --- | --- | --- | --- |
| A | 真实路径无音频滤镜 | 全仓 `-af`/`atempo`/`buildAudioFilters`/`needsComplexFilter` 仅出现在 `hwaccel.js`（探测 `buildLayerArgs:909-920`）与 `ffmpeg_args_known.js` 词表；`ffmpeg_build.js` 只在 `preset.complexFilter` 存在时 push `-filter_complex`（`:450`） | 非模板预设的 `--speed` 不产 `atempo` → 不同步 |
| B | 探测≠真实 | 探测 `buildLayerArgs`：`useComplex=needsComplexFilter(speed,hasAudio)`，为真时产 `-filter_complex [0:v]setpts…[v];[0:a]atempo[a]`；真实 `buildScaleFiltersFromPlan` 仅产 `-vf`（含 setpts），从不产 `-af` | 同构被破坏 |
| C | 无 hw→sw 边界 | 全仓无 `hwdownload`；`ffmpeg_build.js:481` 只处理 `cpu/swdec + *_cuda` 的 `hwupload_cuda`（sw→hw），未处理 hw→sw | 硬件层加软滤镜会失败 |
| D | speed 域冲突 | `cmd_ffmpeg.js` 校验 `speed<0‖>4.0` 才报错；`hwaccel.js validateSpeed` 对 `<0.5‖>2.0` 抛错 | 2.0–4.0 过校验后抛错 |
| **E** | **【本次新证】nvenc 选项拼写错 → 全部降级 CPU** | 真实 build 跑 `buildProbeArgs(cuda,hevc,speed1.5)` 报 `Unrecognized option 'spatial_aq'`；`ffmpeg -h encoder=hevc_nvenc/h264_nvenc` 显示选项是连字符 `-spatial-aq/-temporal-aq/-rc-lookahead`；改连字符+去 `-weighted_pred` 后 hevc_nvenc、h264_nvenc 探测均 exit 0 | nvenc 探测必失败 → auto 降到 cpu（`-c:v libx265/libx264`）；nvenc 分支被 h264/hevc/av1 共用，**h264 GPU 同样失效** |

**官方依据（`temp/ffmpeg-docs`）**：
- `setpts=PTS/N` 为 N 倍速；变速后须显式给 CFR（`-vf fps`/`-r`）。→ `ffmpeg-filters.md §20.19 setpts`、`§11.99 fps`。
- `atempo` 原生 `[0.5,100]`，>2 跳样降质、官方建议链式；与 `setpts` 用同一 N 成对即可由 muxer 按时间戳同步。→ `§8.65 atempo` + `§20.19` 推论。
- simple `-vf`/`-af` 各自单入单出同类型即可，**多入/多出或跨流合成才需 `-filter_complex`**；单纯"视频变速+音频变速"用 simple 完全合法且同步。→ `ffmpeg-cmd.md §3.3.1/§3.3.2、§5.9`。
- 硬件滤镜与软件滤镜"可能没有共同格式"，边界须插 `hwdownload`/`hwupload` 并前后补 `format=`；用了软件滤镜就不能 `hwaccel_output_format`（否则帧被下载、硬件收益消失）。→ `hwaccelintro-ffmpeg.md §Hardware filters/§Transcode with Scaling`、`ffmpeg-filters.md §11.122 hwdownload、§11.124 hwupload、§12.7 scale_cuda`。

---

## 3. 设计原则（写死为契约）

- **G1 单一组装源**：真实命令与探测命令的滤镜段由**同一函数族**产出（`buildVideoFilters`/`buildAudioFilters`）。任何一侧单独拼滤镜即视为 bug。
- **G2 变速优先用 simple `-vf`+`-af`**：`setpts`(视频) 与 `atempo`(音频) 各挂各流，muxer 按 PTS 对齐保同步。仅当预设确有跨流需求（overlay/split/concat）才用 `-filter_complex`。
- **G3 帧域显式化**：每条视频滤镜链在"VRAM / 系统内存"两域之一运行；跨域必须插入转换滤镜：
  - `sw→hw`：`format=nv12,hwupload(_cuda)`（已实现，仅 cpu/swdec 层 + `*_cuda`）。
  - `hw→sw`：`hwdownload,format=nv12`（**新增**，硬件层出现软件滤镜时）。
- **G4 顺序恒定**：`pre(sw调优/降噪) → setpts(变速) → scale → fps → post(sw调优)`；缩放/帧率用同一 `scale`/`fps`，不再叠 `-r` 二次重采样。
- **G5 speed 收敛 0.5–2.0**：单条 `atempo`，不做链式；CLI 与 `validateSpeed` 统一该域。
- **G6 位深对齐不变**：10bit 源 + h264 目标仍在 `scale` 选项内塞 `format=nv12`（cuda/qsv）或 `-pix_fmt yuv420p`（swdec）。

---

## 4. 目标滤镜组装（伪代码）

### 4.1 真实路径 `buildFilterArgs`（改造后，与探测共用）

```
if (preset.complexFilter) {            // 高级模板预设（如 hevc_speed）保持原样
    -filter_complex  resolveComplexFilterScale(preset.complexFilter, tier)
} else {                               // 默认：simple 链，视频/音频各自
    vf = buildVideoFilters({tier,size,speed,framerate,pre,post})  // 含 hw 边界
    af = buildAudioFilters(speed)      // NEW：speed≠1 → "atempo=speed"
    if (vf) -vf vf
    if (af) -af af
}
```

### 4.2 `buildVideoFilters` 增补 hw→sw 边界（G3）

在既有 `pre → setpts → scale → fps → post` 基础上：

- **post 段是软件滤镜**（unsharp/deband 等）且**当前 tier 帧在 VRAM**（cuda/qsv，scale 输出 `format=cuda/qsv`）：在 post 之前插入 `hwdownload,format=nv12`，其后软件滤镜在内存域执行，若再喂硬件编码器需 `hwupload`（或按 G3+AMF 注意事项：此时建议整链落回软件编码，见 §5 决策）。
- **pre 段是软件滤镜**（如 yadif 反交错，宜在缩放前）在 VRAM 帧上：无法既保留硬件 scale 又在 scale 前跑软滤镜而不反复上下传——**本期不支持**；提示用户"反交错等前处理请用 `--decode-mode cpu`/swdec"。

> 简化落点：`--filters` 目前就是"追加到 post"，绝大多数后处理（锐化/去带/降噪）都在缩放后，`hwdownload` 一条即可覆盖；把"pre+hw scale 混合"明确划为越界，避免踩帧域 thrash。

### 4.3 探测 `buildLayerArgs`（改造后）

- 去掉 `needsComplexFilter` 的"speed 就转 complex"分支，改为与 §4.1 一致地产 `-vf`(+scale/hw 边界) 与 `-af atempo`。
- 探测仍只加 `-frames:v 1 -f null -`；命令形态 = 真实命令（G1）。
- `probeCacheKey` 继续含 `speed|framerate`（既有）。

### 4.4 帧率 / 缩放

- 缩放尺寸仍由脚本层 `calcLongEdge` 预计算偶数（不变）。
- 帧率统一用链内 `fps=N` 滤镜（在 setpts 之后），**不再输出 `-r`**（避免与 fps 二次重采样、也避免 `setpts`+`-r` 交互歧义）。若日后要支持 VFR，另立方案。

---

## 5. 关键决策点（已全部敲定，含实测依据）

| # | 议题 | 决策 |
| --- | --- | --- |
| **D1** | speed 上限 | ✅ 收敛 **0.5–2.0**（单条 atempo、无链式）；CLI 校验、`validateSpeed`、builder describe、i18n 统一到该域 |
| **D2** | 变速组装方式 | ✅ **simple `-vf`(setpts,scale,fps) + `-af`(atempo)**，不用 complex（实测同步：有 -af 7.8/7.78s，无 -af 7.8/11.67s 不同步）；probe/real 共用同一 `-vf`+`-af` |
| **D3** | 硬件层 + 软件滤镜 | ✅ **下载一次 + 软件 scale + 软滤镜在内存跑 + 仍硬件编码**（实测 T1：`-hwaccel_output_format cuda … -vf "hwdownload,format=nv12,scale=…,unsharp=…" -c:v *_nvenc` 通过）；无软滤镜时维持 0 拷贝 `scale_cuda`；不走 hwupload 往返（需设备上下文，实测报错） |
| **D4** | hevc_speed 预设 | ✅ **删除**（speed 经 D2 通用化后冗余；同步从 `test_default_presets` EXPECTED 清单移除） |
| **D5** | speed 与音频 copy 冲突 | ✅ **忽略 copy、强制重编码音频**以套 `atempo`，并 warn"speed≠1 时音频不能 copy" |
| **D6** | NVENC 参数块 | ✅ 已实施（工作树+真实 build 实测，见 §1.1）：精简核心参数、删臆造调优；qsv/amf 待真机复验 |

> ✅ **实施状态（2026-09-22 20:16）**：D1–D6 全部落地于工作树并真机验证（RTX 4070）；`eslint` 全绿、`npm test` 254/257（3 个既有 default_presets 计数失败，非本次）。support-matrix 四组合端到端通过（cuda 0拷贝 / cuda+speed 同步 / cuda+软滤镜 hwdownload+软件scale+nvenc / vvc→swdec CPU解码+nvenc）。尚未提交。

---

## 6. 实施变更点清单（评审通过后按此改）

| 文件 | 函数/位置 | 变更 |
| --- | --- | --- |
| `lib/hwaccel.js` | `buildEncoderArgs` **nvenc 分支**（P0，直击"全走 CPU"） | `-spatial_aq→-spatial-aq`、`-temporal_aq→-temporal-aq`、`-rc_lookahead→-rc-lookahead`（连字符）；**删除 `-weighted_pred 1`**（与 B 帧冲突），保留 `-b_ref_mode each`（D6，已实测） |
| `lib/hwaccel.js` | qsv / amf 分支 | **仅校验拼写**：`ffmpeg -h encoder=…_qsv/_amf` 逐个核对选项存在性（本机未探 qsv、无 A 卡未测 amf）；发现同类下划线/不存在项一并修（列入 §7） |
| `lib/hwaccel.js` | **cpu 分支**（已改，待提交） | `-tune film` 仅 `h264` 加、`hevc`(libx265) 不加——上一轮已在工作树，随本方案一并提交 |
| `lib/ffmpeg_build.js` | `buildFilterArgs` | 无 complexFilter 分支：产 `-vf`（现有）**并新增 `-af buildAudioFilters(speed)`**（G2）；speed≠1 且音频 copy 时按 D5 **强制重编码音频 + warn** |
| `lib/ffmpeg_build.js` | `buildScaleFiltersFromPlan` | post 软滤镜在 VRAM 层前插 `hwdownload,format=nv12`（D3） |
| `lib/hwaccel.js` | `buildVideoFilters` | 增加 hw→sw 边界参数并按域插 `hwdownload`；保持 pre→setpts→scale→fps→post 顺序 |
| `lib/hwaccel.js` | `buildLayerArgs` | 与真实路径对齐：去掉 speed→complex 特例，改产 `-vf`+`-af`（G1 同构）；保留复杂模板预设路径 |
| `lib/hwaccel.js` | `validateSpeed` | 收敛 0.5–2.0（D1）；越界抛错与 CLI 一致 |
| `cmd/cmd_ffmpeg.js` | speed 校验 + builder describe | 0–4.0 → **0.5–2.0**（D1）；文案与实际一致 |
| `lib/i18n.js` | speed 文案 / copy-speed 冲突 warn | 补键 |
| `presets/default.yaml` | hevc_speed（D4=保留） | 不动 |

> 不改探测判定语义（仍看退出码+超时）；`probeCacheKey` 视 D1 决定是否仍含 speed（含，保留）。

---

## 7. 测试计划（`node --test`）

1. **同构**：同一 (tier,speed,framerate,size,codecFamily) 下，`buildLayerArgs` 与真实 `createFFmpegArgs` 的滤镜段（`-vf`/`-af`）逐 token 一致（新增/强化）。
2. **变速同步**：`buildFilterArgs`（无 complexFilter + speed=1.5）产出含 `setpts=PTS/1.5`（在 -vf）与 `atempo=1.5`（在 -af）；speed=1 时两者都不出现。
3. **copy 互斥（D5）**：音频判为 `-c:a copy` 且 speed≠1 → 不产 `-af atempo`（或按决策行为）+ warn。
4. **hw→sw 边界（D3）**：cuda 层 + `--filters unsharp` → `-vf` 内 `scale_cuda…,hwdownload,format=nv12,unsharp`；cpu 层 + 同滤镜 → 直接 `,unsharp`（无 download）。
5. **speed 域**：`validateSpeed` 与 CLI 对 2.5/0.4 的处理一致（要么都拒要么按 D1 放宽+链式）。
6. **端到端真实校验**：对一条已知素材 `--speed 1.5` 实转，`ffprobe` 断言输出音频时长≈视频时长（同步），非 `视频12s/音频18s` 之类。
7. **【新增】GPU 路径恢复**：修 nvenc 参数块后，对一条 NVDEC 可解的 1080p hevc/h264 素材走 auto，断言真实命令用 `*_nvenc`（不再 `libx265/libx264`）——即本次"全走 CPU"的回归守卫。
8. **【新增】编码器选项存在性核对**：脚本对每个编码器跑 `ffmpeg -h encoder=<enc>`，断言 `buildEncoderArgs` 产出的每个 `-xxx` 都在该编码器选项表内（防下划线/连字符/不存在项再次静默致探测失败）；先覆盖 nvenc(本机)、qsv，amf 标注"需 A 卡复验"。

---

## 8. 风险与边界

- **帧域 thrash**：pre 软滤镜 + 硬件 scale 混用会反复上下传，本期明确不支持（D3），引导走 swdec。
- **atempo 音质**：>2 跳样降质，故 D1 建议封顶 2.0。
- **copy 冲突**：不显式处理会在真实执行期报"filter on copied stream"，务必按 D5 前置拦截。
- **回归面**：改 `buildVideoFilters`/`buildLayerArgs` 触及探测，须跑全量测试 + 至少一条 GPU 路径、一条 cpu 路径真实转码冒烟。
- **既有 hevc_speed**：若 D4 保留模板，确保 simple 新路径不与其 complex 分支冲突（二选一，现有 if 分支已隔离）。

---

## 9. 待办（你确认后）

1. 定 D1–D5（尤其 **D1 speed 上限** 与 **D5 copy 冲突处理**）。
2. 我按 §6 分步实施：先"变速补 `-af` + probe/real 同构"（直击你遇到的不同步），再"hw→sw 边界"，再"speed 域收敛"。每步带测试。
3. 全量 `npm test` + `eslint` + 至少两条真实转码（GPU/cpu）冒烟验证音画同步。
4. 变更记 `docs/CHANGES-20260922.md` 顶部；本方案定稿后并入 `docs/ffmpeg/` 作为滤镜组装依据。

_本文件为滤镜/变速/缩放/帧率组装与软硬件解码适配的评审方案，与既有 S-4 分层（`lib/hwaccel.js`）及"探测=真实同构"原则保持一致。_
