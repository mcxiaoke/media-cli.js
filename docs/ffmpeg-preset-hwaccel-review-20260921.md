# Preset 组织与硬件加速自动适配 调查报告

> 调查范围：`cmd/cmd_ffmpeg.js`、`lib/ffmpeg_presets.js`、`lib/preset_loader.js`、`lib/ffmpeg_build.js`、`lib/ffmpeg_run.js`、`lib/ffmpeg_plan.js`、`lib/hwaccel.js`、`lib/hwdetect.js`、`presets.yaml`
> 说明：本次为纯调查，未修改任何代码。文中"实证"指已通过实际运行 CLI/脚本验证过的结论。日期：2026-09-21

## 一、现状架构（30 秒版）

- **预设**：内置 21 个（`ffmpeg_presets.js`，S-4 参数化写法：`videoCodecFamily` +
  `filters: "{scaleFilter}"` 占位符）＋ 用户 YAML（`presets.yaml`，`preset_loader.js`
  加载，**同名直接覆盖内置**）。
- **分层**（S-4）：`resolveHwPlan`
  两层决策——硬件检测（`hwdetect`，进程内缓存）→ 文件探测（`probeLayer` 干跑 1 帧，按组合缓存）→
  `selectTier` 选层。编码器由 `ENCODER_MATRIX[tier][codecFamily]` 决定，质量由 `QUALITY_OFFSET`
  归一化。
- **命令组装**（`ffmpeg_build.js`）：输入参数（`-hwaccel`
  由 tier 决定）→ 滤镜（`buildFilterArgs`）→ 视频参数（`buildVideoArgsFromPlan`，tier 块优先）→ 音频参数 → 元数据 → 输出。

## 二、问题清单

### P0-1｜项目自带 presets.yaml 同名覆盖内置预设，直接架空了 S-4 分层

**现象**：`initPresetsAsync`（`ffmpeg_presets.js:572-586`）对 YAML 中与内置同名的预设执行
`PRESET_MAP.set(name, fp)` 静默覆盖。本仓库根目录自带 `presets.yaml`，且
`PRESET_SEARCH_PATHS`（`preset_loader.js`）包含
`cwd/presets.yaml`——**在项目目录运行 mediac 时必然会加载它**，其中 11+ 个预设（`h264_2k`、`hevc_2k`、`hevc_2km/2kl/2ku/2kh/2kt`、`hevc_4k*`、`hevc_speed`
等）与内置同名并整体覆盖。

而 YAML 里的这些同名预设全部是**旧式硬编码写法**（`presets.yaml:44-103`）：

```yaml
_base_hevc:
    videoArgs:
        "-c:v hevc_nvenc -rc vbr -tune hq -rc-lookahead 24 ... -cq {videoQuality} -bufsize
        {videoBitrateK} -maxrate {videoBitrateK}"
    filters: "scale_cuda=w={dimension}:h={dimension}:force_original_aspect_ratio=decrease:interp_algo=lanczos,format=cuda"
```

**证据（实证）**：`initPresetsAsync()` 后 `hevc_2k` 的 `videoCodecFamily` 变为
`undefined`、`videoArgs` 变为 NVENC 硬编码串；CPU 层（`-decode-mode cpu`）下 `createFFmpegArgs`
真实输出仍为 `-c:v hevc_nvenc -rc vbr ...`——**无 N 卡机器上必然失败**。

**根因链**：

1. `buildVideoArgsFromPlan`（`ffmpeg_build.js:95-121`）检测到 `preset.videoArgs` 含 `-c:v` 即返回
   `null`，让调用方"走原路径"（`ffmpeg_build.js:290-302`），**整个 tier 层被绕开**；
2. `buildScaleFiltersFromPlan`（`ffmpeg_build.js:54-82`）在有 tier 时**完全忽略 `preset.filters`
   内容**，只按 tier 现算 → YAML 里硬编码的 `scale_cuda` 实际没进命令（变成 CPU
   `scale=`），但编码器是硬编码 nvenc → 出现"CPU 滤镜 + NVENC 编码器"的畸形组合。

**影响**：S-4 重构对同名视频预设完全不生效；行为依赖"运行目录下是否存在 presets.yaml"，结果不可复现。

**建议**：

- 迁移 `presets.yaml` 到 S-4 写法（`videoCodecFamily: hevc` + `filters: "{scaleFilter}"`，去掉
  `-c:v` 硬编码），或将仓库自带的 `presets.yaml` 降级为"示例/模板"并改名（如
  `presets.example.yaml`）避免默认加载；
- 收紧覆盖语义：同名覆盖时给 warn 日志；或改为"内置优先，YAML 仅允许新增"；
- `buildVideoArgsFromPlan` 对含 `-c:v` 的旧式预设：明确"弃用并告警"而非静默走原路径。

### P0-2｜`--preset` 无法使用 YAML 新增的预设名（yargs choices 时序错误）

**现象**：`cmd_ffmpeg.js:117` 中 `--preset` 的 `choices: presets.getAllNames()` 在
**builder 阶段**取到的是 `PRESET_NAMES` 数组**引用**；而 YAML 预设是在 **handler 内**的
`loadYamlPresets()` 才 push 进 `PRESET_NAMES`。yargs 的 choices 校验发生在
**parse 阶段（handler 之前）**，因此 YAML 新增的预设名（实证：`hevc_qsv2k`、`hevc_qsv2km`）永远报
`Invalid values`，**无法通过 `--preset` 使用**。

**证据（实证）**：`--preset hevc_qsv2k` →
`parse ERR: Invalid values ... Choices: "h264_2k" ...`。唯一绕过是
`--ffargs "preset=hevc_qsv2k"`（`applyFfargs` 的 preset 分支直接写
`result.preset`，不经过 choices 校验，`ffmpeg_presets.js:708-711` 已确认存在）。

**影响**：用户自定义 YAML 预设只有"同名覆盖内置"一条路可通，而这条路由恰好是 P0-1 的破坏路径——**新写法被堵死，旧写法是唯一活路**，形成结构性推力让用户继续产出旧式预设。

**建议**：

- 把 `loadYamlPresets()` 提前到 builder 阶段（模块加载/程序启动时先异步初始化），让 `PRESET_NAMES`
  在 `choices` 校验前就包含 YAML 预设；
- 或 `--preset` 不用 `choices`，改为 handler 内手动校验并给出可用列表；
- 顺带修复 `getAllNames()` 返回内部数组引用的问题（返回副本），避免外部 push 污染。

### P0-3｜complexFilter 完全不参与分层，hevc_speed 在无 N 卡环境必失败

**现象**：`buildFilterArgs`（`ffmpeg_build.js:255-281`）对 `complexFilter` 直接
`formatArgs(tempPreset.complexFilter)` **原样输出**，不像 `filters` 那样走
`buildScaleFiltersFromPlan` 按 tier 生成。而：

- 内置 `PRESET_HEVC_SPEED`（`ffmpeg_presets.js:382-383`）与 YAML
  `hevc_speed`（`presets.yaml:292`）的 complexFilter 都**硬编码 `scale_cuda=...` +
  setpts/atempo/fps**；
- 探测命令（`buildLayerArgs` → `buildVideoFilters` + `buildAudioFilters`）与真实命令的 complexFilter
  **不是同一来源**：探测按 tier 组装，真实按 preset 字面量组装。

**证据（实证）**：CPU tier 下 `hevc_speed` 真实命令 complexFilter 仍是
`scale_cuda=...`；非 N 卡机器上探测即失败，绝不会降级成功。

**影响**：变速/帧率类预设是 S-4 重构的**死角**——`videoArgs` 有分层、`filters` 有分层，唯独
`complexFilter` 没有。

**建议**：complexFilter 也接入分层——把 `{scaleFilter}` 语义扩展到 complexFilter 模板（如
`[0:v]setpts=PTS/{speed},{scaleFilter},fps={framerate}[v]`），由 `buildVideoFilters`
现算替换各 tier 的滤镜；`hwaccel.js`
中已有注释承认这一路径可做（"现有 PRESET_HEVC_SPEED 的 complexFilter 可改用 buildVideoFilters +
buildAudioFilters 组合生成"），属未实施项。

### P1-1｜`--filters` 用户自定义滤镜在有 hwPlan 时全部丢失

**现象**：`buildScaleFiltersFromPlan` 有 tier 时返回
`buildVideoFilters({tier,size,speed,framerate})`，**完全不读 `preset.filters`
的用户内容**；`buildFilterArgs` 又在 `scaled || framerate>0` 时才输出 `-vf`。结果是：用户通过
`--filters` 或 YAML 传入的自定义滤镜（如
`yadif`、`hflip`、`unsharp`），只要有硬件分层（或不需要缩放）就被**静默丢弃**。

**影响**：自定义滤镜"看似配了、实际没生效"；`filters: "{scaleFilter}"`
占位符只是"预览占位标记"，并不会真实拼接用户的滤镜串。

**建议**：占位符机制真正实现"前缀/后缀拼接"——`preset.filters` 拆为
`preFilter, {scaleFilter}, postFilter` 三段，缩放滤镜只在占位处插入；或引入
`beforeFilters`/`afterFilters` 两个显式字段。

### P1-2｜PRESET_FIELDS 白名单缺 videoCodecFamily，与构造器脱节

**现象**：`preset_loader.js:93-121` 的 `PRESET_FIELDS` 白名单**不含
`videoCodecFamily`**（S-4 新字段），但 `validatePresetFields` 只 warn 不剔除，`FFmpegPreset`
构造函数实际会读取该字段。结果是用户在 YAML 里写 `videoCodecFamily` **能生效但收到 "unknown
field" 警告**（误导），不写则退回从 `videoArgs` 正则推断。

**影响**：S-4 新范式无法在 YAML 中"干净"声明，且告警与行为脱节。

**建议**：白名单补充 `videoCodecFamily`，并从文档示例中推广（旧式 `-c:v` 写法逐步标记 deprecated）。

### P2-1｜ENCODER_MATRIX.d3d 映射到 nvenc，与 d3d 层设计矛盾

**现象**（`hwaccel.js:71`）：

```js
d3d: { h264: "h264_nvenc", hevc: "hevc_nvenc" }   // d3d 层编码却落到 nvenc
```

但 `hwdetect.js:253` 探测 d3d 层用的是
`{ hwaccel: "d3d11va", encoder: "libx264" }`（libx264 验证解码链路），`TIER_ENCODER_PROBE.d3d`（`hwdetect.js:37-42`）又列了
`["h264_nvenc","hevc_nvenc","h264_qsv","hevc_qsv"]`
四个编码器——**三处对 d3d 层"用什么编码"的回答互不一致**。

**影响**：无 N 卡机器即使 d3d11va 可用，`buildEncoderArgs("d3d")` 也会输出 `h264_nvenc`
→ 探测失败 → 白白多探一层才降级 CPU；有 N 卡机器则 cuda 层已优先，d3d 层几乎永远不会被选中。该层实际是"死层"，探测成本冗余。

**建议**：明确 d3d 层语义——要么"d3d11va 硬解 +
CPU/libx264 编码"（`ENCODER_MATRIX.d3d = libx264/libx265`，质量标定走 x264 表），要么干脆从候选链移除；同时清理
`TIER_ENCODER_PROBE.d3d` 死配置。

### P2-2｜codecFamily 只支持 h264/hevc 两族，AV1/VP9 无路由

**现象**：`codecFamilyOf` 的正则只认 `hevc|h265|x265|hvc1`，其余全落 `h264`；`ENCODER_MATRIX`
也只有 h264/hevc 两行。用户通过 `--ffargs vc=av1_nvenc` 或 YAML 声明 AV1 时：`codecFamilyOfPreset`
推断为 `h264` → 探测用 `h264_nvenc`、真实命令却换成 `av1_nvenc` → **探测与真实不一致**。

**建议**：`codecFamily` 从"枚举两族"扩为"编码器名解析函数"（如 `av1` 族、`vp9`
族），`ENCODER_MATRIX` 补对应行；或至少在 `codecFamilyOf` 无法识别时显式告警而非静默落 h264。

### P2-3｜`--hwaccel` 在 decode-mode=auto 时被静默忽略

**现象**：`candidateTiers`（`hwdetect.js:339-364`）的 auto 分支**不读 `hwaccel` 参数**，只有
`decode-mode=gpu` 时 `--hwaccel` 才生效。用户执行 `mediac ffmpeg --hwaccel cuda` 而默认
`decode-mode=auto` 时，指定完全无效果且无任何提示。

**影响**：典型 UX 陷阱——用户以为锁定了 cuda，实际走自动探测（可能落在 qsv/cpu）。

**建议**：为 auto 分支做"hwaccel 白名单过滤"（如 `--hwaccel cuda`
在 auto 下只允许 cuda+cpu 候选），或在 `--hwaccel` 未配 `--decode-mode gpu` 时 warn。

### P2-4｜filterSupport（hwdetect 收集的滤镜可用性）从未被消费

**现象**：`hwdetect.js:266-272` 收集 `scale_cuda/scale_qsv/vpp_amf/scale_d3d11/scale_vulkan`
存在性，但全库无一处读取该字段——滤镜可用性完全靠 `probeLayer` 干跑兜底。

**建议**：在 `candidateTiers` 用 `filterSupport` 做静态预筛（如 `scale_d3d11`
缺失则 d3d 层无条件排除），减少冗余探测；这也是 P2-1 的配套修复。

### P2-5｜探测命令与真实命令仍有差异面（非致命但需知情）

- 探测（`buildProbeArgs`/`buildLayerArgs`）不含字幕、metadata、movflags、streamArgs、`-map`
  等——对"层可用性"判定无影响，可接受；
- **bitrateK 未传入探测**：`resolveHwPlan` 调 `selectTier` 时没传
  `entry.dstArgs.videoBitrateK`，探测命令无 `-bufsize/-maxrate`，与真实
  `buildVideoArgsFromPlan`（带 bitrateK）不完全同构；码率参数不改变编码器可用性，影响小；
- `probeCacheKey` 不含
  `speed/framerate/quality/hasAudio`：speed/framerate 影响滤镜串（setpts/atempo/fps），同键复用理论上可能复用"不同滤镜需求"的结果（注释已声明不影响判定，属知情取舍）。

## 三、更清晰的预设组织方案（建议，未实施）

**目标**：单一定义源、硬件无关、命名自解释、可组合。

1. **单源化**：预设定义收敛到一处。`presets.yaml`
   降级为"用户覆盖/新增"的**第二优先级**层：YAML 仅允许新增、覆盖需显式声明（如
   `override: true`）并告警，禁止静默覆盖内置。
2. **废除 `videoArgs` 内嵌 `-c:v`/`filters`
   硬编码写法**：预设改为声明式字段——`codecFamily`（h264/hevc/av1...）、`quality`（CRF 语义 Uniform）、`bitrateK`、`dimension`、`speed`、`framerate`、`container`；硬件细节（编码器、hwaccel、缩放滤镜）全部由 tier 层决定。
3. **滤镜三段式**：`beforeFilters` / `{scaleFilter}` 占位 /
   `afterFilters`，缩放由 tier 现算插入，用户自定义滤镜不再被丢弃；complexFilter 模板同样支持
   `{scaleFilter}` 占位。
4. **命名规范**：预设名与硬件解耦（去掉 `hevc_qsv2k` 这类厂商名），改为
   `{codec}_{dimension}_{quality档}`，如 `hevc_2k_high`；`u/h/m/l/t`
   后缀在注释与文档中给出释义或在命名中直接写全量词。
5. **字段 Schema 共享**：`PRESET_FIELDS` 白名单与 `FFmpegPreset`
   构造器字段从同一常量生成，杜绝 P1-2 式脱节；新增字段强制同步更新校验表。
6. **质量标定扩展**：`QUALITY_OFFSET`
   补 AMF 标定；d3d 层若改走 CPU 编码则复用 x264 表；AV1 各实现（nvenc/qsv/amf/svtav1）按需标定，未标定时显式降级说明而非回退 0。

## 四、硬件加速适配改进方案汇总

| #   | 问题                                      | 建议动作                                                        | 优先级 |
| --- | ----------------------------------------- | --------------------------------------------------------------- | ------ |
| 1   | YAML 同名覆盖架空 S-4 分层（P0-1）        | 迁移/改名自带 presets.yaml；覆盖需显式声明；`-c:v` 旧式预设告警 | P0     |
| 2   | YAML 新预设名无法 `--preset`（P0-2）      | 启动时预加载 YAML 再建 choices；或去 choices 改运行时校验       | P0     |
| 3   | complexFilter 不分层（P0-3）              | `{scaleFilter}` 占位扩展到 complexFilter；探测与真实同源        | P0     |
| 4   | 用户自定义滤镜被丢弃（P1-1）              | 滤镜三段式拼接                                                  | P1     |
| 5   | 白名单缺 videoCodecFamily（P1-2）         | 共享 Schema 常量                                                | P1     |
| 6   | d3d 层 = nvenc 矛盾 + 死配置（P2-1/P2-4） | 明确 d3d 语义（CPU 编码或移除）；消费 filterSupport             | P2     |
| 7   | 仅 h264/hevc 两族（P2-2）                 | codecFamily 解析器化；ENCODER_MATRIX 扩表                       | P2     |
| 8   | auto 模式忽略 `--hwaccel`（P2-3）         | auto 下做白名单过滤或 warn                                      | P2     |
| 9   | 探测命令差异面（P2-5）                    | 探测补传 bitrateK；缓存键按需细化                               | P3     |

## 五、调查方法备注

- 已实证项：YAML 同名覆盖后 `hevc_2k` 的字段变化与实际命令输出（CPU 层
  `-c:v hevc_nvenc`）；`--preset hevc_qsv2k`
  被 yargs 拒绝；YAML 加载 21→23 个预设的差异（同名 11 个、新增 2 个、`_base_*`
  过滤 5 个）；内置/自定义预设计数。
- 代码路径引用均按当前工作区实际行号，如需定位建议直接搜函数名。
- 本次未修改任何文件；`presets.yaml` 的迁移属于后续实施决策，未擅自改动。
