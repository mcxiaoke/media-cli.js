# FFmpeg 命令链路代码质量与硬件加速架构评审

> 评审日期：2026-09-21
> 评审对象：`cmd/cmd_ffmpeg.js` 及其全部依赖（硬件加速分层、编码器矩阵、GPU 矩阵、预设加载、执行与恢复）
> 评审方法：**源码逐行通读 + 本机真实 ffmpeg 实测 + ffmpeg 官方文档/源码选项核对**
> 结论优先级：P0（功能不可用）> P1（正确性/性能显著受损）> P2（边界/健壮性）> P3（可维护性）

---

## 0. 结论先行

**整体评价：架构方向正确、工程质量高于平均水平，但存在 2 个 P0 级功能缺陷、4 个 P1 级正确性/性能缺陷。**

| 维度 | 评分 | 说明 |
|---|---|---|
| 模块分层 | ★★★★☆ | plan / build / run 三段分离，纯函数边界清晰；`hwaccel` 与 `hwdetect` 双层决策设计正确 |
| 硬件加速逻辑 | ★★★☆☆ | 分层思想与实测数据扎实，但**候选链顺序与实测吞吐不符**（P1-1），**关键分支漏传位深**（P0-2） |
| 编码器选择 | ★★☆☆☆ | 静态矩阵 + 按厂商分发的思路对，但**矩阵值未做运行时校验**，cpu 层 AV1 编码器在主流构建上不存在（P0-1） |
| 探测/降级机制 | ★★★☆☆ | 「探测命令与真实命令同构」原则好，但**探测开销无并发去重与负缓存**（P1-2），**短素材上硬件反而更慢**（P2-5） |
| 错误处理 | ★★★☆☆ | 错误提取/日志落盘考虑周到，但**stderr 错误判定过粗**（P1-4）、**损坏文件的 CPU 重试必然无效**（P1-5） |
| 可测试性 | ★★★★☆ | 220 个单测全绿；关键常量可导出；但**性能与端到端回归缺失** |
| 文档与注释 | ★★★★★ | 注释质量极高（每处踩坑都留了根因与实测数据），本次评审发现的少数注释与现状不符已在下文标注 |

**必须修的 2 个 P0：**

1. `ENCODER_MATRIX.cpu.av1 = "libaom-av1"` —— 本机（及绝大多数 Windows 分发构建）**没有这个编码器**，任何 AV1 输出在降级到 CPU 层时 100% 失败。本机有 `libsvtav1`。
2. `buildEncoderArgs()` 未接收 `bitDepth`，导致 `swdec` 层的 10bit→8bit 对齐在 **mediainfo 回退路径下失效**，输出 `Error while opening encoder`。

**最高收益的 2 个优化：**

- 候选链从 `cuda → d3d → swdec → cpu` 改为按实测吞吐排序（实测 d3d 比 swdec 慢 32%），收益 15%–32% 吞吐。
- 视频任务默认 `jobs=1` 过于保守：RTX 4070 上 4 路 NVENC 并发**零失败、提速 1.5x**。

---

## 1. 评审范围与实证环境

### 1.1 代码范围（约 5,700 行）

| 文件 | 行数 | 职责 |
|---|---|---|
| `cmd/cmd_ffmpeg.js` | 1066 | 命令入口、计划编排、确认交互、删源、重试 |
| `lib/ffmpeg_plan.js` | 446 | 码率/尺寸/命名/展示的纯计算 |
| `lib/ffmpeg_build.js` | 664 | ffmpeg 参数构建（输入/滤镜/编码/音频/元数据） |
| `lib/ffmpeg_run.js` | 640 | 单文件执行、进度、错误提取、临时文件清理 |
| `lib/hwaccel.js` | 1276 | 层定义、编码器矩阵、质量标定、探测与选层 |
| `lib/hwdetect.js` | 594 | 设备能力探测、候选链解析 |
| `lib/gpu.js` | 462 | GPU 型号→代次→NVDEC/NVENC 支持矩阵 |
| `lib/ffmpeg_presets.js` / `preset_loader.js` / `preset_schema.js` | 468 / 291 / 162 | YAML 预设分层加载与校验 |
| `lib/mediainfo.js` / `media_parser.js` | 225 / 369 | ffprobe/mediainfo 双 provider 探测 |
| `lib/ffmpeg_bin.js` | 46 | ffmpeg 可执行文件定位 |

### 1.2 实证环境（全部数据来自本机真实运行）

```
OS        : Windows 10
ffmpeg    : N-126733-gfddc59cf3-2026-09-20-nonfree-shared (gyan)
libavcodec: 63.14.100
GPU       : NVIDIA GeForce RTX 4070 (Ada, gen40) + Intel UHD 750
-hwaccels : cuda, vaapi, dxva2, qsv, d3d11va, opencl, vulkan, d3d12va, amf
本项目判定 caps.usable : cuda=yes  qsv=yes  amf=no（无 A 卡）  d3d=yes  cpu=yes
caps.staticOk          : cuda/qsv/amf/d3d 全部 yes（-encoders 里都在）
编码器数  : 238（libfdk_aac ✓  libsvtav1 ✓  libx264 ✓  libx265 ✓  libvpx-vp9 ✓  libaom-av1 ✗）
测试素材  : F:/temp/testvideos/formats/*、mysamples/*（含 4K10bit HEVC / 4:2:2 10bit / AV1 / 1080p 8bit）
           temp/testvideos/*（chromium media testdata，含加密与损坏样本 47 个）
```

### 1.3 评审方法

1. 全量源码通读（含历史备份版本对比，确认哪些缺陷已修、哪些是新引入）。
2. 运行项目自身的 `detectHardwareCapabilities` / `candidateTiers` / `selectTier` / `createFFmpegArgs`，用真实素材生成真实命令并实际执行（脚本见附录 A）。
3. 用 `ffmpeg -h encoder=xxx` / `-h filter=xxx` 逐项核对代码里写死的选项名与取值范围（`s-4` 方案注释里的结论全部实测复核）。
4. 五组吞吐对照实验（不同层 / 不同素材 / 不同帧数 / 并发度）。
5. 端到端批量转码 47 个文件，统计成功率、层级分布、失败原因。

---

## 2. 架构总览

### 2.1 调用链

```
index.js
  └─ cmd/cmd_ffmpeg.js
       ├─ [模块加载] await loadYamlPresets()        ← ESM 顶层 await，保证 yargs choices 已就绪
       ├─ planFFmpegTasks(argv)
       │    ├─ initAutoConfirm / 参数校验（jobs/speed/dimension/input）
       │    ├─ argparser.parseArgs(ffargs) → presets.applyFfargs → presets.createFromArgv
       │    ├─ mf.walk → 类型过滤 → applyFileNameRules → slice(start,count)
       │    ├─ pMap(prepareFFmpegCmd, jobs)         ← 每文件 ffprobe + dstArgs + 输出路径 + 字幕
       │    ├─ --delete-source-files：目标「存在且非空」才删源（0 字节则保留）
       │    ├─ resolveFFmpegBinary() → setFFmpegPath() → detectHardwareCapabilities()
       │    └─ 预览：createFFmpegArgs(lastTask, previewPlan{cpu tier}) → confirm
       └─ runFFmpegTasks({tasks,...})
            ├─ pMap(runFFmpegCmd, jobs)             ← 视频默认 jobs=1（串行）
            ├─ 失败重试：decodeMode 强制 cpu，顺序逐个执行
            └─ 汇总落盘

lib/ffmpeg_run.js runFFmpegCmd
  ├─ resolveHwPlan(entry)
  │    ├─ 音频文件 → 直接 cpu 层
  │    ├─ forcedEncoder === "copy" → 直接 cpu 层（流复制不参与分层）
  │    ├─ detectHardwareCapabilities()（进程内缓存 + in-flight 去重）
  │    └─ selectTier()  ← 双层决策第二层
  │         ├─ resolveTiers(caps, decodeMode, hwaccel)  ← 第一层：设备能力 → 候选链
  │         │     └─ candidateTiers()：厂商白名单 ∩ -hwaccels ∩ usable ∩ 滤镜预筛 + swdec + cpu
  │         └─ 逐层 probeLayer() 干跑（串行 await，只缓存成功）
  │              └─ gpuBlocksDecode()：NVDEC 矩阵明确 "no" 时跳过干跑（仅 auto + cuda/d3d）
  ├─ createFFmpegArgs(entry, hwPlan)   ← lib/ffmpeg_build.js（纯函数，三段式）
  │    ├─ buildInputArgs   : -hide_banner -n -v -progress - -nostats [-hwaccel ...] -i ...
  │    ├─ buildFilterArgs  : complexFilter 优先，否则 -vf（pre → setpts → scale → fps → post）
  │    ├─ buildVideoArgs   : buildEncoderArgs(tier.name, {quality,bitrateK,codecFamily,pixFmt,forcedEncoder,tier})
  │    ├─ buildAudioArgs   : extract / copy 判定 + libfdk_aac 缺失降级
  │    └─ buildMetaArgs + buildStreamArgs
  ├─ executeFFmpeg（execa, shell:false, encoding:latin1, cleanup:true）
  │    └─ stdout 解析 out_time= 驱动进度条
  ├─ 产物校验：DstExists / 临时文件 ≤20KB 且源 >1MB 判失败 → fs.move 改名
  └─ finally：progressBar.stop + 删除临时文件
```

### 2.2 数据流关键点

- **位深**：`entry.info.video.bitDepth`（mediainfo 有，ffprobe 常无）与 `.pixelFormat`（ffprobe 内嵌位深如 `yuv420p10le`；mediainfo 只有 `YUV4:2:0`）。**两个 provider 语义不同，这是本次发现 P0-2 的根因。**
- **质量值**：`QUALITY_OFFSET` 三段阶梯表（495 次编码标定）→ `normalizeQuality` → 按**实际编码器实现**（而非层名）分发 `-cq` / `-global_quality` / `-qp_i,p` / `-crf`。
- **候选链**：`GPU_VENDOR_HWACCELS[vendor]` → 与 `caps.hwaccels` 取交集 → `caps.usable` → `filterSupport`（scale_cuda/scale_qsv/vpp_amf）→ 追加 `swdec` → 追加 `cpu`。

### 2.3 值得肯定的设计（保持，不要动）

1. **双层决策**：设备级探测（便宜、可缓存）与文件级干跑（贵、按组合缓存）分离，`hwdetect.js` 头部注释把判定依据写清楚了。
2. **探测与真实命令同源**：`buildLayerArgs`（探测）与 `buildScaleFiltersFromPlan`（真实）共用 `buildVideoFilters` / `buildEncoderArgs`——这是避免「探测通过、真实失败」的关键，方向完全正确（虽有一处漏网，见 P2-3）。
3. **`probeCache` 只缓存成功**：注释里记录了"损坏文件导致同键正常文件被连带降级"的真实事故，这个取舍是对的。
4. **`-pix_fmt`/`format=nv12` 的位深对齐方案**：实测证明 `scale_cuda=...:format=nv12` 是唯一能把 10bit→8bit 留在显存内的写法（见 §4.2 表 2），方案站得住。
5. **质量按「实际编码器实现」而非层名分发**：正确处理了 `swdec` 层与「矩阵缺失回退 CPU 编码器」两种情形。
6. **临时文件注册表 + SIGINT/SIGTERM/exit 清理**：解决了 Ctrl+C 残留半截文件的问题。
7. **`--delete-source-files` 的 0 字节保护**：先判「存在且非空」再删源，避免用坏产物换掉好源文件。
8. **预设 YAML 单源化 + `_override: true` 保护 + 未知字段告警**：解决了用户层静默架空内置预设的问题。

---

## 3. 问题清单

### P0-1 · CPU 层 AV1 编码器 `libaom-av1` 在主流构建上不存在，AV1 输出必失败

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwaccel.js:73`（`cpu: { h264, hevc, av1: "libaom-av1", vp9 }`）；`:83` `ENCODER_MATRIX.swdec = ENCODER_MATRIX.cpu` 会继承同一问题 |
| 现象 | `ffmpeg ... -c:v libaom-av1 ...` → `Unknown encoder 'libaom-av1'` → `Error selecting an encoder`，退出码非 0 |
| 实证 | 本机构建配置**没有** `--enable-libaom`；`-encoders` 中 `libaom-av1` 缺失，`libsvtav1` 存在。命令实测：`Unknown encoder 'libaom-av1'`；对照组 `libsvtav1` / `libvpx-vp9` 均成功 |
| 注释与现状不符 | `hwaccel.js:78-79` 写「libsvtav1 不随 ffmpeg 主构建分发（本机实测无）」——**该实测结论已过期**：本机构建 `configuration:` 明含 `--enable-libsvtav1`，且 `-encoders` 有 `libsvtav1`。libaom 反而没有 |
| 影响 | 任何声明 `videoCodecFamily: av1` 的预设（内置 YAML 当前没有，但 AV1 已普及，用户自定义必然出现），在无 NVIDIA 显卡、或 `--hwaccel`/`--decode-mode cpu`、或硬件层全部探测失败降级到 cpu/swdec 时，**100% 转码失败** |
| 修复 | 二选一，推荐 A：<br>**A（推荐）** 改成 `"libsvtav1"`，并在 `buildEncoderArgs` 中按 `caps.encoders` 做运行时回退：`libsvtav1 → libaom-av1 → librav1e → av1_nvenc`；<br>**B** 保持矩阵为「候选列表」而非单值，`pickEncoder` 取第一个 `caps.encoders.has()` 命中者 |

**建议的最小改动：**

```js
// lib/hwaccel.js
const AV1_CPU_CANDIDATES = ["libsvtav1", "libaom-av1", "librav1e"]
cpu: { h264: "libx264", hevc: "libx265", av1: "libsvtav1", vp9: "libvpx-vp9" },

// pickEncoder / buildEncoderArgs：拿到候选后若 caps.encoders 不含，则按候选列表回退
```

> 注：`libsvtav1` 在纯 CRF 模式下同样需要 `-b:v 0`（`buildEncoderArgs` 的 `cpu` 分支已处理 av1/vp9，见 `hwaccel.js:711-713`），切换到 libsvtav1 后该逻辑仍然适用。

---

### P0-2 · `swdec` 层的 10bit→8bit 对齐漏传位深，mediainfo 回退路径下必然失败

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwaccel.js:723-730`（`bitDepthOf(pixFmt)` 只传一个参数）；`lib/hwaccel.js:665-667`（`buildEncoderArgs` 的 opts 无 `bitDepth`）；调用方 `lib/ffmpeg_build.js:234-241` 与 `lib/hwaccel.js:804-811` 都没传 |
| 正常路径 | ffprobe（默认 provider）：`pixelFormat = "yuv420p10le"` → `bitDepthOf` 的正则匹配 `10le` → 判 10bit → 输出 `-pix_fmt yuv420p` → 成功 |
| 失效路径 | **ffprobe 失败回退 mediainfo**：`pixelFormat = "YUV4:2:0"`（不含位深），`bitDepth = 10` 存在但**没被传进去** → 判 8bit → **不输出** `-pix_fmt` |
| 实证 | ① `bitDepthOf('YUV4:2:0') === "8bit"`，`bitDepthOf('YUV4:2:0', 10) === "10bit"`；<br>② `buildEncoderArgs("swdec", {codecFamily:"h264", pixFmt:"YUV4:2:0"})` → `-c:v libx264 -crf 24`（**无 `-pix_fmt`**）；<br>③ 真实命令对照（4K10bit → h264）：<br>　- 无 `-pix_fmt yuv420p`：`[enc:h264_nvenc] Error while opening encoder ... rc=127` **FAIL**<br>　- 有 `-pix_fmt yuv420p`：rc=0 **OK（1586ms）** |
| 与调用的错位 | `ffmpeg_build.js:230-231` 的注释写着「pixFmt 传给 buildEncoderArgs：……现另用于 swdec 层的位深对齐」，但**只传了 pixFmt，没传 bitDepth**，注释与实现不符 |
| 影响 | 只在 ffprobe 失败、回退 mediainfo 的 10bit 源 + h264 目标上触发。触发后 swdec 层的探测也会失败（因为探测命令缺同一个参数），于是整批落到 libx264，**丢掉实测 1.69x 的加速**（表 2） |
| 修复 | ① `buildEncoderArgs(tierName, { ..., bitDepth })` 增加参数；② 内部改 `bitDepthOf(pixFmt, bitDepth)`；③ `ffmpeg_build.js:234-241` 补 `bitDepth: entry.info?.video?.bitDepth`；④ `hwaccel.js:804-811`（`buildLayerArgs` 侧）同步补 |

---

### P1-1 · 候选链顺序与实测吞吐不符：d3d 排在用更快的 swdec 之前

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwdetect.js:405-410`（`GPU_VENDOR_HWACCELS`）、`:562-569`（先 push `swdec` 再 push `cpu`）；`lib/hwaccel.js:292-362`（TIERS） |
| 现状 | N 卡机器候选链 = `["cuda", "d3d", "swdec", "cpu"]`（实测确认） |
| 根因 | `d3d` 层的 `scale_d3d11` 在本机**运行时不可用**（见下），因此 d3d 层只能走 CPU `scale=`，形成「硬解 → 下载到内存 → CPU scale → 硬编」= **2 次 PCIe 拷贝**；而 `swdec` 是「软解 → CPU scale → 硬编」= **1 次拷贝** |
| 实证 | 1080p8bit → 720p H264 全片 300 帧（2 次取最优）：<br>`cuda` **692ms** / `swdec` **723ms** / `d3d` **955ms** / `cpu(libx264)` **1750ms**<br>→ **d3d 比 swdec 慢 32%** |
| 注释已知但未落地 | `hwaccel.js:339-342` 已记录「硬解+下载+CPUscale 17.1x（2 次拷贝） vs swdec 27.7x vs libx264 10.9x」——**结论正确，但候选链没有应用它**：cuda 失败后先试的是更慢的 d3d |
| `scale_d3d11` 复验 | 本机 `scale_d3d11` 滤镜存在，但：<br>① 参数名是 `width/height`（**不是** `w/h`，写 `w=` 直接 `Option not found`）；<br>② 改对参数名后仍失败：`Error reinitializing filters! / Invalid argument`（rc=127）；<br>③ `hwaccel.js:329` 注释记的失败串是 `Could not create the texture 80070057`，**当前版本串已变**，注释需更新 |
| 影响 | 4:2:2 / 高位深 / 损坏首帧等导致 cuda 不可用的素材，会优先落到最慢的硬件路径 |
| 修复 | **A（推荐，改动小）** 候选链改 `cuda → swdec → d3d → cpu`，即 vendor 层之后立刻插 swdec；<br>**B（更稳）** 给 TIERS 增加 `throughputRank` 字段（cuda 0 / swdec 1 / d3d 2 / cpu 3），`candidateTiers` 按 rank 排序——将来某台机器 `scale_d3d11` 可用时只需调整该字段；<br>**C** 顺带把注释里的 `scale_d3d11` 失败串与「参数名是 width/height」补进注释 |

---

### P1-2 · 探测开销：串行 `await`、无 in-flight 去重、无负向记忆

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwaccel.js:1134-1191`（`selectTier` 的 `for (const tier of tiers)` 串行 `await probeLayer`）；`:844-846`（`probeCache`）；`:979-985`（只缓存成功） |
| 现象 | 每个文件、每个候选层各 spawn 一个完整 ffmpeg 进程（`CUDA` 上下文初始化本身约 50–100ms）。**参数组合不同的文件越多，探测次数越多** |
| 实证 | ① 63 个文件的 dry-run 耗时 **13s**，其中绝大部分是探测与 ffprobe；② 端到端批量 47 个文件：转码本身 22s，但 prepare 阶段（ffprobe + 每层探测）占更长；③ 每组不同 (codec/位深/pixFmt/尺寸/forcedEncoder/speed/fps) 组合都会各跑一轮 |
| 现状的正确部分 | 「只缓存成功」是必要的（注释记录了损坏文件污染缓存的真实事故），**不应简单改成全量缓存失败** |
| 影响 | 大批量、多规格混合目录的首批文件明显卡顿；N 卡上 CUDA 上下文反复创建/销毁 |
| 修复（三项叠加） | ① **in-flight 去重**：`probeCache` 存 `{promise}` 而非 `{bool}`，同 key 并发只真正跑一次（`hwdetect.js` 的 `capabilitiesPromise` 已是这个模式，可直接照搬）；<br>② **负向计数**：按 key 记 `failStreak`，同一 key 在**不同文件**上连续失败 ≥3 次后，本进程内该 key 标记为 `blacklisted`（**不写入持久缓存**），新文件直接跳过该层；若期间出现一次成功则清零；<br>③ **探测更轻**：`-frames:v 1` 可考虑改为「首帧 + `-t 0.1`」以覆盖「首帧可解、第二帧崩」的情形（同时降低 P2-6 的风险）；探测超时 15s 对 4K/8K 素材偏紧，可按源分辨率动态调整 |

---

### P1-3 · ffmpeg 二进制定位不一致：探测/执行保留了绕过 `FFMPEG_PATH` 的退路

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwaccel.js:933` `const bin = ffmpegPath || (await which("ffmpeg", ...))`；`lib/ffmpeg_run.js:460` `execa(ffmpegPath || "ffmpeg", args, ...)` |
| 正确实现 | `lib/ffmpeg_bin.js` 的 `resolveFFmpegBinary()`：`FFMPEG_PATH` → `FFMPEG_BINARY` → `which`。**两者不一致** |
| 实证 | 本机 `FFMPEG_PATH` 未设置、`which ffmpeg` = `C:\Home\Apps\ffmpeg\bin\ffmpeg.exe`，两条路径恰好一致，问题被掩蔽 |
| 风险 | 用户设了 `FFMPEG_PATH` 指向 nonfree 版（有 libfdk_aac），但探测走 PATH 上的 essentials 版（无 libfdk_aac）→ 「探测说有 fdk → 不降级 → 执行时报 Unknown encoder」。这正是 `ffmpeg_run.js:456-459` 注释里描述的历史坑，但**退路还在** |
| 影响 | 仅在使用多个 ffmpeg 版本、或 `detectHardwareCapabilities` 抛错导致 `caps.ffmpegPath` 缺失时触发 |
| 修复 | 两处都改为 `const bin = ffmpegPath || (await resolveFFmpegBinary())`；`probeLayer` 的 `ffmpegPath` 参数缺失时同样走 `resolveFFmpegBinary()`，若仍为 null 则**直接返回 false 并明确告警**，不要静默落到裸 `ffmpeg` |

---

### P1-4 · `stderr` 错误判定过粗，损坏文件会刷屏

| 项 | 内容 |
|---|---|
| 位置 | `lib/ffmpeg_run.js:495-502`：`if (line.includes("Error") || line.includes("error")) { progressBar?.stop(); log.showRed(...) }` |
| 现象 | 只要 stderr 的**任意 chunk** 含子串 `error`/`Error` 就打印一行 `FFmpeg Error:`，并**停止进度条** |
| 实证 | 47 文件批量中，7 个损坏样本（chromium 加密流）每个刷出十几行：<br>`FFmpeg Error: [h264 @ ...] slice type 14 too large at 0` / `non-existing PPS 1 referenced` / `QP 86 out of range` / `Decode error rate 1 exceeds maximum 0.666667` ...（见 `temp/review/run1.log`） |
| 附带问题 | ① `--debug`（`-v repeat+level+info`）下 stderr 全是 info 输出，命中率更高；② 文件名/滤镜名里含 "error" 会误报；③ 每个 chunk 都 `progressBar?.stop()`，串行模式下进度条会被打断 |
| 修复 | ① 只在 `-v error` 级别下（非 debug）做该提示；② 判定改为「行首 `[error]` 前缀」或「行以 `Error`/`error` **开头**」；③ 加节流：同一文件最多打印 N 条（如 3 条），其余计入计数并在最终 `extractFFmpegError` 里给出第一条 |
| 备注 | `extractFFmpegError`（`:344-375`）写得很好（从前往后找第一条 `[error]`，跳过 `Link`/`src:`/`dst:` 噪声），**它是正确的**；问题只在这个实时提示分支 |

---

### P1-5 · 损坏文件的 CPU 重试必然无效，白白多跑一遍

| 项 | 内容 |
|---|---|
| 位置 | `cmd/cmd_ffmpeg.js:702-733`（`failedTasks` → 逐个 `decodeMode = "cpu"` 重试） |
| 现象 | 重试把 `decodeMode` 置为 cpu 后**无条件重试**，不区分失败原因 |
| 实证 | 47 文件批量中 7 个失败样本的重试结果：<br>`FFCMD[SW](R) Error(22/47) ... Decoding error: Invalid data found when processing input`<br>`FFCMD[SW](R) Error(33/47) ... SEI type 181 size 195 truncated at 151`<br>……**7 个全部重试后再失败**。这些是源文件数据损坏，换 CPU 解码不可能修复 |
| 影响 | 每个真损坏文件多跑一次完整转码（大文件代价显著）；进度被串行重试拖住；汇总里失败数不变 |
| 修复 | 重试前用 `entry.ffmpegError` 做错误分类，**解码层/容器层错误不重试**：<br>`/decoding error|invalid data|SEI .* truncated|non-existing (PPS|SPS)|moov atom not found|error while decoding|invalid start code|concealing/i`<br>只对「编码器相关」错误重试：<br>`/error while opening encoder|unknown encoder|impossible to convert|not supported|out of memory|no capable devices/i` |

---

### P2-1 · `d3d` 层的静态判定用 `every()` 要求 NVENC 与 QSV 编码器同时存在

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwdetect.js:38-43`（`TIER_ENCODER_PROBE.d3d = ["h264_nvenc","hevc_nvenc","h264_qsv","hevc_qsv"]`）、`:216-221`（`.every(...)`） |
| 问题 | d3d 层的**设备探测**用的是 `-hwaccel d3d11va + libx264`（`:254-260`），与那四个编码器毫无关系；但入场判定却要求四者齐全 |
| 后果 | 纯 Intel 机器（只有 `*_qsv`，无 `*_nvenc`）或纯 AMD 机器上，`staticOk.d3d = false` → `candidateTiers` 里 `GPU_VENDOR_HWACCELS.intel = ["qsv","d3d"]` 的 d3d 被 `!caps.usable[t]` 过滤掉 → **d3d11va 解码兜底被丢弃** |
| 本机为何没暴露 | 本机构建同时含 nvenc 与 qsv，四者齐全 |
| 修复 | `d3d` 的静态判定只应基于 `hwaccels.has("d3d11va")`；`TIER_ENCODER_PROBE` 里删掉 `d3d` 项（或改为只校验 `libx264` 存在） |

---

### P2-2 · `probeCacheKey` 缺 `hasAudio`，可导致探测结论被错误复用

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwaccel.js:866-880`（key 含 tier/codec/codecFamily/pixFmt/dimension/bitDepth/forcedEncoder/speed/framerate，**无 hasAudio**） |
| 相关性 | `buildProbeArgs` → `buildLayerArgs` → `needsComplexFilter({speed, hasAudio})`：`validateSpeed(speed) !== 1 && hasAudio` 决定是否走 `-filter_complex` |
| 后果 | `speed ≠ 1` 时，有音频的文件用 `-filter_complex`，无音频的用 `-vf`。**两种命令结构不同，探测结论不可互推**，但缓存 key 相同（只按 speed 分） |
| 触发面 | 目录中同时含「有音轨」与「无音轨」视频 + `--speed/预设 speed ≠ 1`（如 `hevc_speed` 预设）。窄但真实 |
| 修复 | `probeCacheKey` 增加 `hasAudio` 维度 |

---

### P2-3 · 「探测与真实同构」有一处漏网：`hasScale` 不一致

| 项 | 内容 |
|---|---|
| 位置 | 探测侧 `lib/hwaccel.js:785`（`buildVideoFilters` 调用**未传 `hasScale`**，默认 `true`，因此总是带 `w=/h=`）；真实侧 `lib/ffmpeg_build.js:179-193`（`hasScale: needScale`，且 `needScale=false` 时传 `size=null`） |
| 后果 | 「无需缩放但需位深对齐」的任务：探测命令是 `scale_cuda=w=1920:h=1080:...:format=nv12`，真实命令是 `scale_cuda=interp_algo=lanczos:format=nv12`（无 w/h = 1:1） |
| 实际影响 | 通常等价（此时 size 本就等于源尺寸），但在特殊像素格式/奇数尺寸下可能出现「探测通过、真实失败」 |
| 修复 | `buildLayerArgs` 也接受 `hasScale` 并透传给 `buildVideoFilters`，两侧用同一个判定函数 |

---

### P2-4 · `preset` 未声明 `dimension` 时，奇数尺寸会被静默改写

| 项 | 内容 |
|---|---|
| 位置 | `lib/ffmpeg_plan.js:286` `const dstScaleNeeded = srcWidth > dstDimension || srcHeight > dstDimension`（`dstDimension = 0` 时恒为 `true`）→ `ffmpeg_build.js:179` `needScale = true` → 用 `hwPlan.size` 缩放 |
| 链路 | `resolveHwPlan`：`dimension = 0` → 传 `Math.max(srcW, srcH)` → `calcLongEdge(1919, 1080, 1919)` → `toEven(1919) = 1918` |
| 后果 | 源 `1919x1080` + 无 dimension 的自定义 preset → 输出 `1918x1080`。**宽度被静默改变** |
| 修复 | `dimension <= 0` 时 `needScale` 强制 `false`（完全不缩放，也不做偶数对齐） |

---

### P2-5 · 极短素材上硬件路径反而更慢（无自适应）

| 项 | 内容 |
|---|---|
| 实证 | 1080p8bit → 720p H264，不同帧数（3 次取最优）：<br>20 帧：`cuda 380ms` / `swdec 412ms` / **libx264 368ms（最快）**<br>60 帧：`cuda 429ms` / swdec 455ms / libx264 606ms<br>150 帧：`cuda 522ms` / swdec 570ms / libx264 1036ms<br>300 帧：`cuda 675ms` / swdec 727ms / libx264 1763ms |
| 线性拟合 | `cuda ≈ 359 + 1.05N`；`swdec ≈ 390 + 1.13N`；`libx264 ≈ 268 + 4.98N`（ms）<br>→ **交叉点约 N ≈ 23～32 帧**（30fps 下约 0.8–1.1 秒） |
| 结论 | 约 1 秒以内的极短素材，纯 CPU 更快（GPU 上下文初始化 ≈ 90ms 固定开销占主导） |
| 建议 | `resolveHwPlan` 增加短路：`srcDuration < 1.5s`（或 `frames ≈ fps*duration < 45`）且**无需位深对齐**时直接走 cpu 层，跳过全部探测。这对「大量小视频/GIF 源」场景收益明显 |
| 注意 | 这是优化建议，不是缺陷——当前实现在长素材上是正确的 |

---

### P2-6 · `-frames:v 1` 探测覆盖不足（已知取舍，建议记录并微调）

| 项 | 内容 |
|---|---|
| 位置 | `lib/hwaccel.js:832-836`（`"-frames:v", "1"`） |
| 现象 | 只解首帧。首帧正常、后续帧损坏的文件会被判为「该层可用」，然后在真实转码中失败 |
| 实证 | 47 文件批量里 7 个失败样本全部属于此类（SEI truncated / non-existing PPS / VP9 decoding error）——它们通过了 prepare 与探测，在真实转码第 N 帧才崩 |
| 建议 | ① 探测改为 `-frames:v 3`（成本几乎不变，能拦住「第二帧就崩」）；② 或在注释里明确记录该取舍（当前注释只记载了「不缓存失败」这一侧的应对，没写探测覆盖度） |

---

### P2-7 · 其他次要问题（清单）

| # | 位置 | 问题 | 建议 |
|---|---|---|---|
| a | `cmd/cmd_ffmpeg.js:280-284` | `--hwaccel` 声明为自由字符串，非法值（如 `vaapi`）只 warn 后走默认链，用户可能在 auto 模式下「以为指定了实际没生效」 | builder 加 `choices`（含 `auto`/`cpu`），或在 confirm 前回显「最终生效的候选链」 |
| b | `lib/hwaccel.js:1135 & 1176` | `tried.push(tier.name)` 在 `gpuBlocksDecode` 判断**之前**，导致被矩阵预筛掉的层也出现在 `tried` 里，且 reason 文案写 `after cuda,d3d failed`（实际是 skip 不是 fail） | 区分 `tried` / `skipped`，reason 文案分别表述 |
| c | `lib/hwaccel.js:691` | `-tune hq` 是 NVENC 的**默认值**（`-h encoder=h264_nvenc` 显示 `(default hq)`），属于冗余参数 | 无害，可删；注释可补一句「h264 1-4 / hevc 1-5，hq 为两端默认值」 |
| d | `lib/hwaccel.js:703` | AMF 只设 `-qp_i/-qp_p`，未设 `-qp_b`（该选项存在），B 帧 QP 取默认；也未使用 `-quality`（balanced/speed/quality/high_quality） | 补 `-qp_b`；`-quality` 可作为预设槽位暴露 |
| e | `lib/ffmpeg_run.js:139` | `entry.useCUDA = hwPlan.tier.name === "cuda"` 全仓库无人读取，是重构残留 | 删除（或改为 `entry.tierName` 供日志使用） |
| f | `lib/ffmpeg_run.js:386-396` | `getCommentArgs` 把**完整命令行（含绝对路径）**写入 `comment` 元数据，截断到 1000 字符 | 可追溯性好，但会泄露路径；建议改为只写 preset + tier + 关键参数，或加 `--no-comment` 开关 |
| g | `cmd/cmd_ffmpeg.js:685` vs `:546` | prepare 阶段并发 `config.JOBS.externalTool()`，run 阶段视频 `jobs=1`——两者不一致且 run 过于保守（见 §4.4） | 视频默认并发提到 2–3 |
| h | `cmd/cmd_ffmpeg.js:705` | `const strict = tasks[0]?.argv?.strict` 只取首个任务的 argv | 改为 `tasks.some(t => t.argv?.strict)` 或直接读 `argv.strict` |
| i | `presets/default.yaml:254,294,307` | `-profile:a aac_he -vbr N -b:a XXXk` 同时给 VBR 与码率；libfdk 在 VBR 模式下对 `-b:a` 的处理不直观 | 文档说明二者关系，或 VBR 预设去掉 `-b:a` |
| j | `lib/ffmpeg_run.js:604-637` | `resolveHwPlan` 的 `catch` 里两个分支（GPU / auto）行为完全相同，都 `throw err` | 合并分支，或让 GPU 模式携带更明确的错误类型 |

---

## 4. 性能实测数据（全部为本机真实运行）

### 4.1 端到端批量转码（chromium 47 个 mp4，`hevc_2k`，`-d` 真实执行）

| 指标 | 结果 |
|---|---|
| 转码耗时 | 22s |
| 成功 / 失败 | 40 / 7 |
| 层级分布 | `[HW]` 38、`[SW+HW]` 1、`[SW]` 1 |
| 失败原因 | **全部为源文件数据损坏**（`SEI type N truncated`、`Decoding error: Invalid data`、`non-existing PPS`、`QP 86 out of range`），非代码问题 |
| 重试效果 | 7 个全部触发 CPU 重试，**7 个全部再失败**（见 P1-5） |

### 4.2 4K 10bit HEVC → 1080p H264（全片 132 帧，2 次取最优）

| 路径 | 耗时 | 相对 libx264 |
|---|---|---|
| cuda（硬解 + `scale_cuda:format=nv12` + `h264_nvenc`） | **690ms** | **3.84x** |
| swdec（软解 + CPU scale + `h264_nvenc` + `-pix_fmt yuv420p`） | 1571ms | 1.69x |
| 软解 + `hwupload_cuda` + `scale_cuda` + `h264_nvenc` | 1618ms | 1.64x |
| cpu（软解 + CPU scale + `libx264`） | 2650ms | 1.00x |

→ 印证 `hwaccel.js` 的两条核心论断：**① 位深转换必须放在 scale 的 `format=` 选项内**（否则 4K10bit → h264 直接 `Error while opening encoder`，实测 `rc=127`）；**② swdec 层确实有价值**（1.69x）。

### 4.3 1080p 8bit → 720p H264（全片 300 帧，2 次取最优）

| 层 | 命令形态 | 耗时 | 相对 cpu |
|---|---|---|---|
| cuda | `-hwaccel cuda -hwaccel_output_format cuda` + `scale_cuda` + `h264_nvenc` | **692ms** | 2.53x |
| swdec | CPU scale + `h264_nvenc` | 723ms | 2.42x |
| d3d | `-hwaccel d3d11va` + CPU scale + `h264_nvenc` | 955ms | 1.83x |
| cpu | CPU scale + `libx264` | 1750ms | 1.00x |

→ **d3d 比 swdec 慢 32%**，但候选链把 d3d 排在 swdec 前面（P1-1）。

### 4.4 NVENC 并发能力（RTX 4070，4K→1080p × 4 路）

| 模式 | 总耗时 | 失败数 |
|---|---|---|
| 并发 4 路 | **1808ms** | **0** |
| 串行 4 路 | 2710ms | 0 |

→ **并发 4 路零失败、提速 1.5x**。当前 `runFFmpegTasks` 对视频固定 `jobs=1`（`cmd_ffmpeg.js:685`）过于保守。建议默认并发 2–3（显存安全），保留 `-j` 覆盖。

### 4.5 帧数规模 vs 各层吞吐（1080p→720p，见 P2-5 表格）

交叉点约 **23–32 帧**；低于该值纯 CPU 更快。

### 4.6 NVDEC 矩阵预筛判定（本项目 `gpu.js` 输出，gen40）

| 源格式 | 判定 | 行为 |
|---|---|---|
| h264 / yuv420p / 8bit | `yes` | 正常探测 |
| h264 / yuv420p10le | **`no`** | 预筛跳过 cuda+d3d（40 系 NVDEC 不支持 H.264 10bit，与 NVIDIA 官方矩阵一致） |
| h264 / yuv422p10le | **`no`** | 同上 |
| hevc / yuv420p、yuv420p10le、yuv444p10le | `yes` | 正常探测 |
| hevc / yuv422p10le | **`no`** | 预筛（实测该素材最终落到 swdec 并成功） |
| vp9 / yuv420p、av1 / yuv420p、mpeg2 | `yes` | 正常探测 |
| 未知 codec（如 ffv1） | `null` | 不预筛（保守，正确） |

→ 矩阵数据与 NVIDIA 官方支持矩阵一致，预筛规则（仅 `no` 才拦截、`partial`/`unknown`/非 NVIDIA/`strict`/`gpu` 模式一律不拦）是安全的。**这块实现质量高，无需改动。**

---

## 5. 架构改进建议（按 ROI 排序）

| 优先级 | 建议 | 收益 | 成本 |
|---|---|---|---|
| 1 | 修 P0-1（AV1 编码器）与 P0-2（swdec 位深） | 消除两类必失败路径 | 极低（各 1–3 行 + 2 处调用点） |
| 2 | 改候选链顺序（P1-1） | cuda 不可用素材 +15%~32% 吞吐 | 低（改常量或加 rank 字段） |
| 3 | 视频默认并发 2–3（§4.4） | 批量场景 ~1.5x | 低 |
| 4 | 探测 in-flight 去重 + 负向计数（P1-2） | 大批量首批文件显著加速 | 中 |
| 5 | 错误分类后决定是否重试（P1-5） | 真损坏文件不再白跑一遍 | 低 |
| 6 | ffmpeg 定位统一走 `resolveFFmpegBinary`（P1-3） | 消除多版本环境下的不一致 | 极低 |
| 7 | stderr 提示节流与精化（P1-4） | 日志可用性 | 低 |
| 8 | 编码器选择运行时校验（P0-1 方案 A 的推广） | 所有族在所有机器上都不会选到不存在的编码器 | 中 |
| 9 | 短素材走 CPU 短路（P2-5） | 大量小文件场景 | 低 |
| 10 | 补端到端/性能回归测试 | 防止分层逻辑回退 | 中 |

### 5.1 关于「编码器静态矩阵」的长期建议

当前 `ENCODER_MATRIX` 是硬编码的「层 × 族 → 单值」，问题在于**它假定某个编码器一定存在**，而这与 ffmpeg 构建强相关（P0-1 就是这个假设崩了）。建议改为：

```
候选列表（按偏好排序） + caps.encoders 运行时命中
  h264: [h264_nvenc, h264_qsv, h264_amf, h264_mf, libx264]
  hevc: [hevc_nvenc, hevc_qsv, hevc_amf, hevc_mf, libx265]
  av1 : [av1_nvenc, av1_qsv, av1_amf, libsvtav1, libaom-av1, librav1e]
  vp9 : [vp9_qsv, libvpx-vp9]
```

配合「层 → 允许的厂商实现」约束（cuda 层只允许 nvenc 实现、qsv 层只允许 qsv 实现……），既保留当前语义，又消除「矩阵里有、构建里没有」的失败。

### 5.2 关于「探测」的长期建议

把「每层干跑」升级为「静态判定优先 + 干跑仅补位」：

1. **能力表可静态回答的部分**（GPU 代次 × codec × chroma × bitDepth → yes/no）已有一半在 `gpu.js`，建议补齐 Intel QSV（Gen 代次能力表）与 AMD AMF 的对应矩阵；
2. 只有 `partial` / `unknown` / 无矩阵数据的组合才落到干跑；
3. 干跑结果按 key 做「成功缓存 + 失败计数」两级记忆（P1-2）。

这样可以把「每台机器每批任务的探测次数」从 O(文件组合数 × 层数) 降到接近 O(未知组合数)。

### 5.3 不建议做的事

- **不要**简单改成「缓存所有失败」——注释里记录的「损坏文件污染同键正常文件」事故是真实的，全量负缓存会引入更隐蔽的误降级。
- **不要**为 AMF 路径投入更多标定——本机无 A 卡，任何 QP 标定都是猜的，保持偏移 0 + 注释声明未标定即可。
- **不要**把质量标定表升级为逐点查表——现有三段阶梯（495 次编码标定）的精度对命令行工具已足够，逐点表的维护成本高于收益。

---

## 6. 复核：哪些历史缺陷确认已修

以下是 `docs/CHANGES-*.md` 与注释中记载的历史缺陷，本次复核确认**已修复且行为正确**：

| 缺陷 | 现状 |
|---|---|
| `choices: presets.getAllNames()` 拿到内部数组引用 | 已修（`getAllNames` 返回副本，`:167-169`） |
| `fileLog` 参数顺序颠倒（数组当 tag） | 已修（`cmd_ffmpeg.js:647` 传 `LOG_TAG`） |
| `acc + t.info?.duration \|\| 0` 运算符优先级 | 已修（显式括号，`:656-659`） |
| `--override` 声明但从未读取 | 已修（`:919-930`） |
| dry-run 也会真删源文件 | 已修（testMode 守卫，`:570-574`） |
| ffargs 数值 0 被误判为「用户已提供」 | 已修（`applyFfargs` 的 `hasArgvValue`，`:287-289`） |
| `vc` 别名误映射为 `videoCopy` | 已修（`ARG_ALIASES.vc = "videoCodec"`） |
| `entry.dstValues` 从未赋值导致模板变量泄漏 | 已修（改用 `entry.dstArgs`） |
| mediainfo 无 General track 时 TypeError 阻断 fallback | 已修（`fromMediaInfoJson` 抛可捕获错误） |
| `Intel Corporation` 含 "ati" 子串被误判为 AMD | 已修（`normalizeVendor` 先判 intel） |
| Ctrl+C 残留半截临时文件 | 已修（临时文件注册表 + 信号钩子） |
| 探测缓存缺位深键导致 10bit 误复用 8bit 结果 | 已修（`probeCacheKey` 含 `bitDepth`） |

---

## 附录 A · 复现脚本

本次评审使用的三个脚本已放在 `temp/`（可随时重跑）：

| 脚本 | 用途 |
|---|---|
| `temp/review_hwprobe.mjs` | 跑项目自身的 `detectHardwareCapabilities` / `candidateTiers`，打印 caps、各模式候选链、编码器缺失检查 |
| `temp/review_e2e.mjs` | 用真实素材走 `selectTier` + `createFFmpegArgs`，打印 tier/size/tried/reason 与完整命令，`--run` 时实际执行 60 帧 |
| `temp/review_matrix.mjs` | 验证 NVDEC 预筛判定表、`bitDepthOf` 两个 provider 的差异、`swdec` 的 `-pix_fmt` 输出、编码器矩阵缺失项 |

用法：

```bash
node temp/review_hwprobe.mjs
node temp/review_e2e.mjs "F:/temp/testvideos/formats/hevc_4k25P_main10_2.mp4" h264_2k --run
node temp/review_matrix.mjs
```

吞吐对照实验（bash，可独立重跑）：

```bash
SRC=hevc_4k25P_main10_2.mp4   # 4K 10bit HEVC
# cuda / swdec / hwupload / cpu 四路对照，见 §4.2
# 1080p 四层对照、帧数扫描、NVENC 并发 4 路，见 §4.3 – §4.5
```

批量端到端：

```bash
node index.js ffmpeg temp/testvideos --preset hevc_2k -A -e ".mp4" -d -o temp/review/out
```

---

## 附录 B · 本次核对过的 ffmpeg 官方/运行时事实

| 事实 | 来源 | 与代码的关系 |
|---|---|---|
| QSV 的 quality-based 码控是 `-global_quality N`（ICQ，"similar to crf mode of x264"） | `temp/ffmpeg-docs/hardware-quicksync-ffmpeg.md:262-266` | 代码 `hwaccel.js:698` 正确 |
| `-cq` 是 NVENC 专属；`-tune` 的 h264 取值 1-4、hevc 1-5，**默认均为 hq** | `ffmpeg -h encoder=h264_nvenc` / `hevc_nvenc` | 代码正确但 `-tune hq` 冗余（P2-7c） |
| `-cq` 取值范围 0-51，**0 表示 automatic** | `ffmpeg -h encoder=h264_nvenc` | `normalizeQuality` clamp 到 [0,51]，理论下界会撞上「automatic」语义（边界，低优先级） |
| AMF 有 `-qp_i/-qp_p/-qp_b` 与 `-quality` | `ffmpeg -h encoder=h264_amf` | 代码只用了前两个（P2-7d） |
| `scale_d3d11` 选项名是 `width`/`height`（不是 `w`/`h`） | `ffmpeg -h filter=scale_d3d11` | 代码不用它，注释记的参数名差异是对的 |
| 帧已在 GPU 内存时（`hwaccel cuda` 或 `hwaccel_output_format cuda`）**不需要**显式 `hwupload`；CPU 内存时才需要 | `temp/ffmpeg-docs/ffmpeg-all.md:37337-37339` | `ffmpeg_build.js:454-462` 的 `hwupload_cuda` 前置逻辑正确 |
| `libsvtav1` 是随包可用的 AV1 编码器，本机构建启用 | `ffmpeg -version` configuration + `-encoders` | 与 `hwaccel.js:79` 注释相反（P0-1） |
