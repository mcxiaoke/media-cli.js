# media-cli.js ffmpeg 系统综合修改方案（评审稿）

> 前置：本方案基于调查结论 `docs/ffmpeg-preset-hwaccel-review-20260921.md`
> 与用户对五项决策的确认（2026-09-21）。状态：**待评审，未实施**。本文档只描述修改方案，未改动任何代码。原则：仅供用户审阅拍板；文中所有“待定”项集中在 §8 开放决策点，拍板后按 §7 分阶段实施。

---

## 0. 用户已确认的五项决策（输入）

| #   | 决策                                                           | 对应调查问题               |
| --- | -------------------------------------------------------------- | -------------------------- |
| D1  | 预设单源化：去掉 JS 内置定义，只用 YAML，YAML 随 npm 打包发布  | P0-1、P0-2、P1-2、A6       |
| D2  | 修复历史遗留硬编码（S-4 重构未完成部分）                       | P0-1 根因链、P0-3、P1-1    |
| D3  | 采纳滤镜三段式（beforeFilters / {scaleFilter} / afterFilters） | P1-1                       |
| D4  | decoder / encoder 默认自动，用户可显式指定                     | P2-3（--hwaccel 静默忽略） |
| D5  | 修复硬件加速自动适配                                           | P2-1、P2-2、P2-4、P2-5     |

---

## 1. 目标架构（改后形态）

```
┌─────────────────────────────────────────────────────────┐
│ 预设（单一事实源，全部 YAML）                              │
│  ┌─────────────────────────────┐   ┌─────────────────┐  │
│  │ presets/default.yaml（随包）  │   │ 用户 presets.yaml │  │
│  │ 内置预设的 YAML 等价物        │   │ 新增/覆盖（显式）  │  │
│  └─────────────┬───────────────┘   └────────┬────────┘  │
│                └──────────┬─────────────────┘            │
│              preset_loader（合并/覆盖+告警）                │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│ 分层（S-4 完整化）                                        │
│  codecFamily 解析（h264/hevc/av1...）                     │
│  ENCODER_MATRIX + 显式 encoder 覆盖（D4）                  │
│  hwdetect（含 filterSupport 预筛） → probeLayer（同构探测） │
│  selectTier（cuda→qsv→amf→cpu；d3d 按 §5.1 决策）           │
│  buildVideoFilters / buildScaleFiltersFromPlan            │
│  buildVideoArgsFromPlan（无 -c:v 残留）                    │
└──────────────────────────────────────────────────────────┘
```

核心变化一句话：**预设只描述“输出目标”（格式/质量/尺寸/速度），一切硬件实现细节由分层层决定；预设定义只剩 YAML 一份，随包发布，用户可覆盖。**

---

## 2. 改造一：预设单源化（YAML only + 随包发布）——D1

### 2.1 打包与目录布局

| 路径                     | 用途                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| `presets/default.yaml`   | **内置预设的唯一事实源**，随 npm 包发布（`package.json` 的 `files` 字段加入 `presets/`） |
| `~/.mediac/presets.yaml` | 用户全局覆盖/新增（已有语义，保留）                                                      |
| `cwd/presets.yaml`       | 项目局部覆盖/新增（保留，但改为“仅新增 + 显式覆盖”）                                     |

实现要点：

1. **删除 `ffmpeg_presets.js` 中 21 个内置预设定义**（`initPresets()` 全部条目），改为
   `initPresetsAsync()` 从 `presets/default.yaml` 加载后注册。`PRESET_MAP`
   在启动时先装入 default.yaml，再依次合并用户层。
2. **合并优先级（低→高）**：`presets/default.yaml` → `~/.mediac/presets.yaml` →
   `cwd/presets.yaml`。同名预设：
    - 用户层**新增**：直接注册（当前行为，但需修复 yargs 时序，见 §2.3）；
    - 用户层**同名覆盖**：默认**禁止或告警**（见 §8-开放点 1）。倾向方案：必须显式写
      `_override: true`
      才允许覆盖，否则 warn 并跳过——避免再次出现“cwd 下存在 presets.yaml 就静默架空全部内置”的 P0-1 场景。
3. **`preset_loader.js` 的 `PRESET_SEARCH_PATHS`
   增加 default.yaml 路径**，且 default.yaml 相对包根解析（`import.meta.url` 定位，不依赖 cwd）。
4. 仓库根目录自带的 `presets.yaml` 处理：见 §8-开放点 2。倾向方案：改名 `presets.example.yaml`
   并从搜索路径排除；示例语义不变。

### 2.2 内置预设迁移清单（21 个 → YAML 条目）

迁移规则：`videoCodecFamily` + `filters: "{scaleFilter}"` + 参数化字段，**删除所有 `-c:v` /
`scale_cuda` / `scale_qsv` 硬编码**（即 D2）。

| 原内置名                                | 迁移后声明（示意）                                                         |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `h264_2k`                               | `codec_family: h264`, `dimension: 2000`, `quality: 24`                     |
| `h264_2km`                              | 同上 + `bitrate_k: 8000`                                                   |
| `h264_2kl`                              | 同上 + `bitrate_k: 12000`                                                  |
| `h264_2kh`                              | 同上 + `quality: 18`                                                       |
| `hevc_2k`、`hevc_2km/l/h/t`、`hevc_4k*` | `codec_family: hevc` + 对应尺寸/质量                                       |
| `hevc_speed`                            | `codec_family: hevc` + `speed: 1.5`，complexFilter **改用模板**（见 §4.3） |
| 其余（vp9/av1 如已存在）                | 如实迁移；av1 族路由见 §5.3                                                |

字段与 `PRESET_FIELDS` 白名单同步（§2.4）。

### 2.3 修复 yargs choices 时序（P0-2）

当前：`--preset` 的 `choices` 在 builder 阶段取 `getAllNames()` 引用，YAML 在 handler 内才加载。

方案（选一，倾向 A）：

- **A**：`loadYamlPresets()`
  提前到 CLI 启动初始化（命令注册前异步完成），choices 在 parse 时即包含全部预设。工作量小，且
  `--preset` 的自动补全/校验语义保持。
- **B**：`--preset` 去掉 `choices`，handler 内手动校验并输出可用列表 + 建议。

同时修复 `getAllNames()` 返回内部数组**引用**的问题（返回 `[...PRESET_NAMES]` 副本）。

### 2.4 YAML Schema 同步（P1-2）

- `PRESET_FIELDS` 白名单与 `FFmpegPreset` 构造器字段由**同一常量集合**生成（如 `preset_schema.js`
  导出字段表，loader/构造器共用），杜绝“能生效但报 unknown field”脱节；
- default.yaml 的 `_base_*` 继承机制保留（`resolveExtends`
  已有循环检测），\_base 条目仍过滤不出现在 preset 列表；
- 新增字段的文档注释（README / `--help`）同步。

---

## 3. 改造二：历史遗留硬编码清理（S-4 收尾）——D2

### 3.1 `videoArgs` 含 `-c:v` 的旧式预设

- **default.yaml 与示例中彻底移除 `-c:v` 编码器硬编码**（由 `ENCODER_MATRIX[tier][codecFamily]`
  决定）；
- `buildVideoArgsFromPlan`（`ffmpeg_build.js:95-121`）的分叉逻辑改为：视频参数**一律走 tier 层生成**（`buildVideoArgs`
  内 `planVideoArgs` 仅用于显式 `--video-args`/ffargs 覆盖），含 `-c:v` 的旧式 `videoArgs`
  视为**弃用**——warn 一次并忽略（或按 §8-开放点 3 直接报错）；
- 删除
  `buildVideoArgs`（290-302 行）中“planVideoArgs 为 null 时用 tempPreset.videoArgs 原样”的退路，避免再出现“CPU 滤镜 +
  NVENC 编码器”畸形组合（实证根因）。

### 3.2 滤镜三段式（D3）——替代现有 `{scaleFilter}` 占位符

```yaml
pre_filters: "yadif=1" # 可选：缩放前（反交错等，需在硬件解码后适用于搬运链）
filters: "{scaleFilter}" # 可选：仍支持字面量 {scaleFilter} 表示“缩放由 tier 决定”
post_filters: "unsharp=luma_msize_x=3" # 可选：缩放后
```

组装规则（`buildScaleFiltersFromPlan` 重写）：

| 场景                   | 滤镜输出                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 有 tier + 缩放/变速    | `pre_filters` + tier 生成的 `scale`（或 `scale_cuda` 等） + `post_filters`，用 `,` 拼接；缩放滤镜只替换 `{scaleFilter}` 占位符 |
| 有 tier + 无缩放不变速 | `pre_filters` + `post_filters`（**不再整段丢弃用户滤镜**——修复 P1-1）                                                          |
| 预览（无 tier）        | 原样输出（含占位符时缩放不生效并 warn）                                                                                        |

兼容：仍接受旧的 `filters: "xxx,{scaleFilter}"`
写法，拆分规则：占位符前=pre、后=post（向后兼容默认.yaml 已迁移的用户）。

### 3.3 complexFilter 接入分层（P0-3）

- 内置 `hevc_speed` 的 complexFilter 模板化：
    ```
    [0:v]setpts=PTS/1.5,{scaleFilter},fps=30[v];[1:a]atempo=1.5[a]
    ```
    其中 `{scaleFilter}` 由 `buildVideoFilters` 按 tier 现算替换；`hwaccel.js`
    注释中已承认此路径（“现有 PRESET_HEVC_SPEED 的 complexFilter 可改用 buildVideoFilters +
    buildAudioFilters 组合生成”），本次落地；
- **探测与真实命令同源**：`buildLayerArgs` 的 complexFilter 生成逻辑与 `buildFilterArgs`
  共用同一组装函数，杜绝“探测用 tier 组装、真实用字面量”的错位。

### 3.4 `buildScaleFiltersFromPlan` 合并

- `tempPreset.filters` 的非 scale 内容不再被丢弃；三段式 + 占位符替换统一在
  `buildScaleFiltersFromPlan` 内完成；
- `filters` 字段仅存 pre/post 两部分（占位符自动拆分），`pre_filters`/`post_filters`
  为显式新字段（建议迁移期两者都支持，`pre_filters` 优先）。

---

## 4. 改造三：decoder / encoder 默认自动、可显式指定——D4

### 4.1 语义定义

| 项                 | 默认                                        | 显式指定方式                                     | 优先级         |
| ------------------ | ------------------------------------------- | ------------------------------------------------ | -------------- | --- | --- | ------------------------------------------------ | ----------- |
| decoder（hwaccel） | auto（分层探测：cuda→qsv→amf→cpu）          | `--hwaccel cuda                                  | qsv            | amf | d3d | cpu`+`--decode-mode gpu`（或合并为新语义，见下） | 显式 > auto |
| encoder            | auto（`ENCODER_MATRIX[tier][codecFamily]`） | `--video-codec h264_nvenc` / `--ffargs "vc=..."` | 显式 > tier 表 |

### 4.2 `--hwaccel` 语义修正（P2-3 修复）

当前：`decode-mode=auto` 时 `--hwaccel` 被**静默忽略**（`candidateTiers` auto 分支不读该参数）。

方案（选一，倾向 B）：

- **A**：合并为单选项——`--hwaccel auto|cuda|qsv|amf|d3d|cpu`，删掉 `--decode-mode`；`--hwaccel auto`
  为默认，其余值 = 显式指定（等价于原 decode-mode=gpu + 锁定层，且保留 CPU 回退）。
- **B**（改动最小）：保留 `--decode-mode`，但 auto 分支把 `--hwaccel`
  作为**白名单过滤**——`--hwaccel cuda` 时候选集只含 cuda+cpu；若该层探测失败自动落 cpu 并提示。同时
  **auto 模式下若用户传了 `--hwaccel`，输出一行提示“已按显式 hwaccel 过滤候选层”**，消除无声忽略。

### 4.3 encoder 显式指定的穿透

- `buildEncoderArgs`（`hwaccel.js:508` 起）增加参数 `forcedEncoder`：非空时跳过
  `ENCODER_MATRIX`，直接用用户指定编码器 + 对应质量参数（nvenc→`-cq`、qsv→`-global_quality`、x264/x265→`-crf`、amf→`-qp_i/-qp_p`）；
- `resolveHwPlan` 的 `codecFamily` 优先级：**显式 encoder 解析出的族 > preset.videoCodecFamily >
  videoArgs 推断**（避免 `--ffargs vc=av1_nvenc` 被推断成 h264 探测，见 §5.3）；
- 显式 encoder 时探测命令**使用同一 encoder**（不退回 ENCODER_MATRIX），保证“探测=真实”。

---

## 5. 改造四：硬件加速自动适配修复——D5

### 5.1 d3d 层语义（P2-1）

现状矛盾：`ENCODER_MATRIX.d3d` 落 `h264_nvenc/hevc_nvenc`；`hwdetect` 探测用
`{d3d11va, libx264}`；`TIER_ENCODER_PROBE.d3d` 列 4 个编码器——三处不一致，d3d 几乎为死层。

方案（选一，拍板见 §8-开放点 4）：

- **A（推荐）**：d3d 层 = **d3d11va 硬解 + CPU 编码**（libx264/libx265），`ENCODER_MATRIX.d3d`
  改为此映射，`QUALITY_OFFSET` 复用 x264/x265 表；`TIER_ENCODER_PROBE.d3d` 清理为
  `[libx264, libx265]`；探测与真实一致。
- **B**：d3d 层仅做“可解不可编的兜底”时不参与分层（从 `TIERS` 移除），只保留解码侧能力说明。
- **C**：删除 d3d 层，仅 cuda/qsv/amf/cpu 四层。

附：若用户显式 `--hwaccel d3d` + 显式 encoder（D4），组合按用户指定执行。

### 5.2 filterSupport 消费（P2-4）

- `hwdetect` 收集的 `filterSupport`（`scale_cuda/scale_qsv/vpp_amf/scale_d3d11/scale_vulkan`）在
  `candidateTiers` 做**静态预筛**：
    - 层依赖的缩放滤镜缺失 → 直接排除该层（如 `scale_d3d11` 缺失排除 d3d）；
    - 减少 `probeLayer` 干跑次数，缩短探测时间。

### 5.3 codecFamily 扩展（P2-2）

- `codecFamilyOf` 从“枚举 h264/hevc”改为**解析函数**：
    - hevc/h265/x265/hvc1 → `hevc`；av1/av1_nvenc/av1_qsv/av1_amf/libsvtav1 →
      `av1`；vp9/vp9_nvenc/libvpx-vp9 → `vp9`；其余 → `h264`（保持默认）；
- `ENCODER_MATRIX`
  扩展 av1 行：`cuda: av1_nvenc; qsv: av1_qsv; amf: av1_amf; cpu: libsvtav1`（d3d 按 §5.1 决策）；
- `QUALITY_OFFSET` 补 av1（nvenc/qsv 标定方法同 h264/hevc；amf/libsvtav1 未标定则按 §5.5 处理）；
- 无法识别的 codec 显式 warn，不再静默落 h264。

### 5.4 探测命令同构补全（P2-5）

- `resolveHwPlan` → `selectTier` **传 `videoBitrateK`**（当前缺失），探测命令含
  `-bufsize/-maxrate`，与真实 `buildVideoArgsFromPlan` 同构；
- `probeCacheKey` 增加 `speed`、`framerate`（滤镜串相关，避免跨参数复用不完整），`hasAudio` 与
  `quality` 维持现状并在注释中说明理由（不改变编码器可用性）。

### 5.5 AMF 质量标定（P2 附带）

- `QUALITY_OFFSET` 补 AMF 行（amf 使用 `-qp_i/-qp_p`
  语义，标定需实测；未标定前**显式注释 + 运行时 debug 提示**，不回退 0 无提示）；
- 或接受“AMF 质量略偏”并在文档写明现状（拍板见 §8-开放点 5）。

---

## 6. 向后兼容与已有用户升级路径（D1 的伴生责任）

| 已有资产                                                           | 迁移指引                                                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用户自写 `~/.mediac/presets.yaml` 旧式预设（含 `-c:v`/scale_cuda） | 启动时检测：**warn + 指明弃用字段**，并给出建议替换写法；功能保留一个版本周期（见 §8-开放点 3）                                                                                   |
| 依赖 21 个内置预设名的脚本                                         | 名字不变（default.yaml 同名注册），行为升级为分层正确                                                                                                                             |
| 依赖内置预设旧行为的用户                                           | `--preset hevc_2k` 在新版得到分层正确的命令（编码器随机器变化）——**结果可能改变**，文档/README 显著说明“预设结果与硬件相关，指定 `--video-codec` 可固定编码器”（D4 提供锁定手段） |
| 仓库自带 presets.yaml                                              | 改 `presets.example.yaml`（若拍板），README 说明复制到 `~/.mediac/` 或 cwd 使用                                                                                                   |

---

## 7. 分阶段实施步骤与验收标准

### Phase 0：Schema 与测试基线（前置，最小风险）

- 抽取 `preset_schema.js` 统一字段表；补充 preset 加载/合并/覆盖的单元测试。
- 验收：`npm run check && npm run lint` 通过；新测试覆盖同名覆盖告警、_base_ 继承、字段白名单。

### Phase 1：预设单源化（D1 + D2 的 3.1/3.2）

- 迁移 21 个内置 → `presets/default.yaml`；`initPresets`
  删除；搜索路径加 default.yaml；yargs 时序修复（§2.3）；`-c:v` 弃用告警 + tier 全权接管视频参数。
- 验收（实证脚本）：`--preset h264_2k` CPU 层输出 `libx264` +
  `scale=`；GPU 层输出对应硬件编码器 + 硬件缩放；**无 cwd/yaml 环境下内置预设全部可用**；YAML 新增名可通过
  `--preset`。

### Phase 2：滤镜三段式 + complexFilter 分层（D3 + P0-3）

- `buildScaleFiltersFromPlan` 重写；complexFilter 模板化；探测与真实同源。
- 验收：`--filters "yadif"` 在有 hwPlan 时保留；`hevc_speed` CPU 层输出 `setpts + scale(CPU) + fps`
  而非 scale_cuda；N 卡/Intel/AMD/无卡四类环境各跑通一次（如环境不全，用 `--decode-mode cpu`
  模拟无卡路径）。

### Phase 3：decoder/encoder 显式指定（D4）

- `--hwaccel` 白名单过滤语义；`--video-codec` 穿透 ENCODER_MATRIX；codecFamily 优先级修正。
- 验收：`--hwaccel qsv` 在 auto 下候选只剩 qsv+cpu 且**有提示**；`--ffargs vc=av1_nvenc`
  探测族为 av1；显式 encoder 的探测命令与真实命令编码器一致。

### Phase 4：硬件自动适配修复（D5）

- d3d 层语义、filterSupport 预筛、codecFamily 扩展、bitrateK 传入探测、probeCacheKey 补 speed/framerate、AMF 标定或明示。
- 验收：`--hwaccel auto` 无卡机器在 qsv 层若 `scale_qsv`
  缺失直接被预筛排除（看 debug 日志层级链）；d3d 层探测编码器与真实一致；av1 预设可分层。

**全程不改行为的约束**：Phase
0-1 之间、1-2 之间的过渡期禁止出现“命令行可用但自带 presets.yaml 时行为跳变”的状态。

---

## 8. 开放决策点（待用户拍板）

| #   | 决策点                         | 选项                                                                   | 倾向                            |
| --- | ------------------------------ | ---------------------------------------------------------------------- | ------------------------------- | --------------- |
| 1   | 用户 YAML 同名覆盖内置预设     | A 显式 `_override:true` 才允许；B 禁止覆盖；C 维持静默覆盖             | **A**                           |
| 2   | 仓库自带 presets.yaml          | A 改名 presets.example.yaml 并从搜索路径排除；B 保留为默认加载；C 删除 | **A**                           |
| 3   | 旧式 `-c:v` 预设的弃用策略     | A warn 一个版本周期后移除；B 立即报错；C 永久兼容                      | **A**                           |
| 4   | d3d 层语义                     | A d3d11va 硬解 + CPU 编码；B 不参与分层；C 删除 d3d 层                 | **A**                           |
| 5   | AMF 质量标定                   | A 实测补标定（需 AMF 环境）；B 本轮接受偏差并文档明示                  | **B**（环境受限）               |
| 6   | `--decode-mode` 与 `--hwaccel` | A 合并为单选项 `--hwaccel auto                                         | ...`；B 保留两选项 + 白名单过滤 | **B**（改动小） |
| 7   | AV1/VP9 族是否本轮支持         | A 本轮扩表；B 仅实现“未知 codec warn，不落 h264”                       | 由用户定                        |

---

## 9. 风险与影响面

| 风险                                   | 等级 | 缓解                                                          |
| -------------------------------------- | ---- | ------------------------------------------------------------- |
| 内置预设行为变化（硬件相关结果改变）   | 中   | README 醒目说明 + D4 显式编码器锁定手段                       |
| YAML 迁移遗漏某字段（21 个预设逐个迁） | 中   | 迁移后用“新旧 preset 展开参数 diff”测试兜底                   |
| complexFilter 模板化引入滤镜顺序问题   | 中   | 探测与真实共用组装函数 + 四类环境实测                         |
| d3d/av1 等少用路径无真机验证           | 低   | 用 `--decode-mode cpu`/调试日志覆盖逻辑分支，真机标定列为后续 |
| 覆盖策略收紧导致老用户配置失效         | 低   | 仅 warn 不阻断（开放点 1/3 均含告警路径）                     |

---

## 10. 结论

报告给出了“问题是什么”，本方案给出“按什么顺序、怎么改成什么样”。方案本身有
**7 个开放决策点（§8）**需要你拍板后才能冻结实施范围；拍板后可按 §7 的 Phase
0→4 分批落地，每阶段独立验收、可回滚。
