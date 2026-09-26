# FFmpeg 全链路评审（CLI + Electron + UI/UX）— 2026-09-26

> 评审时间：2026-09-26 09:33 (GMT+8)
> 评审范围：`cmd/cmd_ffmpeg.js`、`src/transcode/*`、`lib/{mediainfo,arg_parser,helper}.js`、`presets/*`、`apps/mediac-desktop/src/**`、`docs/ffmpeg/FFMPEG-USAGE.md`、`README*.md`
> 方法：代码通读 + 真机实证。标注【实测】的结论均已在本机复现（命令/脚本输出见正文）。
>
> **基线门禁（本次实测）**：`npm run lint` 0 错误；`npm run desktop:typecheck` 0 错误；`npm test` 334/334 通过。
>
> 说明：上一轮评审 `docs/FFMPEG-TRANSCODE-DESKTOP-BUG-REVIEW-20260925-qwm.md` 的多数结论已修复（见 §5），本文只列**当前仍然存在**的问题，并对未修项做了逐条复核。

---

## 0. 修复状态（2026-09-26 10:07 更新）

本轮已按本文结论实施修复，变更清单见 **`docs/CHANGES-20260926.md`**。状态如下：

**已修复**

| 编号 | 问题 | 修复要点 |
|---|---|---|
| A1 | `--hwaccel cpu` 无效 | `candidateTiers` 对 `cpu` 直接返回 `["cpu"]` |
| A2 | 桌面端速度/ETA 恒为 `—` | 执行层输出数值 `speed`，store 接受数字/字符串 |
| A3 | 幽灵选项（`--video-args` 等） | 确认 `0b03adb` 为主动移除 → **对齐文档/示例/i18n/死代码**，未恢复功能 |
| A4 | 用户层 `extends` 内置预设被丢弃 | `resolveExtends` 增加跨层 `base` 查找域 |
| A5 | AMD vendor 判为 other | `normalizeVendor` 加 `radeon`；`primaryVendor` 回退 `caps.vendor` |
| A6 | RUNNING 期改配置被静默丢弃 | `pendingStale` + `applyPendingStale()` |
| A7 | 底栏「移除所选」漏同步 | 与右键路径共用实现 |
| A8 | 重试把 skipped 泄漏进成功任务 | 引擎在 attempt 间复检 skip 并停止 |
| A9 | 运行中 reload 致 UI 脱钩 | 菜单改带 `guardReload()` 的显式项（**完整状态恢复 IPC 仍未做**） |
| A10 | About 版本号硬编码 | 改用 `envStore.version` |
| B2 | 注释与实现矛盾（6 处） | 按实现改写注释 |
| B4 | 库劫持宿主进程信号 | 非 Electron 环境才注册 SIGINT/SIGTERM |
| B6 | `toSerializable` DAG 误判 | 改路径栈；Set/Map 纳入进出栈 |
| C1 | mediainfo 死控件 / jobs 文案与上限 | 接线 mediainfo；jobs 上限改 8 并修正文案 |
| C4 | 设置开关 / 右键菜单键盘不可达 | 补 Space/Enter 与 Shift+F10·ContextMenu |
| C5 | 输出目录联动缺失、openPath 静默失败 | 统一走 `setCustomOutputDir`；补 catch+日志 |
| C6 | 推演命令可信度 | 区分「计划推演 / 本地估算」并加警示（**dry-run 入口仍未做**） |
| C7 | FAILED 无「打开输出目录」、状态胶囊被覆盖 | 两者均已修正 |
| L2 | `--error-file` 路径被忽略、JSON 丢 message | 支持显式路径（追加语义）+ Error 序列化 |
| L9 | 复制命令基准失配 | `previewCmdFor()` 按 path 反查 |
| L11 | 探测缓存键缺 `quality` | 纳入 `quality`；`bitrate` 有意排除并注明原因 |
| B14 | `-pix_fmt` 只注入 swdec | **未改行为**，改为在注释中如实记录局限 |

**仍未处理（明确遗留）**

| 编号 | 问题 | 说明 |
|---|---|---|
| B1 | 桌面端 TS/Vue 无 lint 门禁 | 需引入 `eslint-plugin-vue` / typescript-eslint 依赖，属独立基建改动 |
| B3 | `hwaccel.js` 等单文件过大 | 依赖 `ARCHITECTURE-MAINTENANCE-PLAN` R6 阶段推进 |
| B5 | `directories` 语义双写 | 需统一输入入口语义，涉及 CLI/desktop 契约 |
| B7 | 其余中低风险项 | `log.fileLog` 占位符错位、prepare/execute 并发默认不一致、`deleteCompletedSources` 的 `includeExisting` 差异、`selectTier` 对 0×0 尺寸抛错、`logStore` DEBUG 降级导致日志噪音、`entry.useCUDA` 死字段、桌面端无 `--exclude` 默认值 |
| C2 | 批量风险预检摘要 | 需新增 public 契约字段与 UI 区块 |
| C3 | 表格虚拟滚动 / 状态筛选 | 大目录场景的独立优化项 |
| A9 | 完整执行状态恢复 IPC | 本轮只堵住 reload 触发路径，未暴露 `execution:get-status` |
| C6 | dry-run / 试运行入口 | 桌面端仍无等价能力 |

---

## 1. 高优先级：功能正确性

### A1. `--hwaccel cpu` 与桌面端「硬件加速方式 = cpu」完全无效【实测】

`candidateTiers()` 的白名单分支显式排除了 `cpu`：

```js
// src/transcode/hwdetect.js:544-568
if (hwaccel && String(hwaccel).toLowerCase() !== "auto") {
    const name = normalizeHwaccelName(hwaccel)
    if (name && name !== "cpu") { /* 白名单生效 */ return ... }
    if (!name) { log.logWarn(...) }
    // name 为 null（非法值）或 cpu：走默认链   ← 这里静默穿透
}
```

实测（N 卡机器 + 完整 caps）：

| decodeMode | hwaccel | 返回候选链 |
|---|---|---|
| auto | （未传） | `["cuda","swdec","d3d","cpu"]` |
| auto | `auto` | `["cuda","swdec","d3d","cpu"]` |
| **auto** | **`cpu`** | **`["cuda","swdec","d3d","cpu"]`** ← 与 auto 完全相同 |
| auto | `cuda` | `["cuda","cpu"]` |
| auto | `qsv`（不可用） | `["cpu"]` |

影响面：
- CLI：`--hwaccel cpu` 静默无效（且连 warn 都没有）。用户要纯 CPU 必须改传 `--decode-mode cpu`，但 `docs/ffmpeg/FFMPEG-USAGE.md:128` 把 `cpu` 列为 `--hwaccel` 合法值。
- 桌面端：`SettingsModal.vue` 的「硬件加速方式」下拉项 `cpu · 仅 CPU 软解软编` 是**假开关**——选中后仍走 GPU 链路，且不会告警。用户若为规避显卡驱动问题而选它，问题会照旧出现。

修复方向：`name === "cpu"` 时直接 `return ["cpu"]`（或与 `decodeMode=cpu` 合并语义），同时统一 UI 与文档表述。

---

### A2. 桌面端「实时速度 / 剩余时间」恒为 `—`【代码确定，用户可见】

数据链上 speed 全程是**字符串**，而消费端按**数字**判定：

```js
// src/transcode/ffmpeg_run.js:653-680  speed= 1.5x → 字符串
currentSpeed = speedMatch[1].trim()          // "1.5x"
onProgress({ percent, speed: currentSpeed, ... })
```

```ts
// stores/plan.ts:239-252
function updateTaskProgress(taskId, percent, speed?: number) {
  ...
  speed: speed || list[idx].speed,            // 字符串被写进 number 字段（类型谎报）
}
if (typeof speed === "number") currentSpeed.value = speed   // 永远为 false
```

```ts
// ExecutionBoard.vue:54-66
const speedStat = computed(() => {
  if (!isRunning.value || planStore.currentSpeed <= 0) return "—"   // 恒为 "—"
```

结论：`currentSpeed` 在全仓库只有这一处赋值（已 grep 确认），因此执行看板的「实时速度」「剩余时间」两个指标**永远不会显示数值**。同时 `PlanTask.speed: number` 与运行时实际写入的字符串类型不一致，`vue-tsc` 之所以没报错是因为调用点用 `any` 透传。

附带影响：`etaStat` 的除数依赖 `currentSpeed`，ETA 也一并失效。

---

### A3. `--video-args` / `--audio-args` / `--filters` 是「文档里存在、CLI 里不存在」的幽灵选项【实测】

三个选项在 README 与使用手册中被反复描述为正式能力，但 `cmd/cmd_ffmpeg.js` 的 `builder` 从未声明它们，而该命令启用了 `.strictOptions()`：

```
$ node index.js ffmpeg ./data --preset hevc_2k --video-args "-rc vbr"
Unknown arguments: video-args, videoArgs, r, c

$ node index.js ffmpeg ./data --preset hevc_2k --filters "yadif=1"
Unknown argument: filters
```

文档侧引用（全部需同步修正）：

| 位置 | 内容 |
|---|---|
| `README.md:89-90` | 「`--video-args` / `--audio-args` / `--filters` 是追加式覆盖」 |
| `README_zh.md:86-87` | 同上（中文） |
| `docs/ffmpeg/FFMPEG-USAGE.md:104` | `--video-args` `-va` 追加视频编码参数 |
| `docs/ffmpeg/FFMPEG-USAGE.md:113` | `--audio-args` `-aa` 追加音频编码参数 |
| `docs/ffmpeg/FFMPEG-USAGE.md:288/314/335-337` | 含整节「§9.3 是"追加"不是"替换"」+ 示例命令 |
| `presets.example.yaml:24` | 把 `videoArgs` 列为合法预设字段 |
| `lib/i18n.js:432-435` | `ffmpeg.error.videoArgsCodec` 错误文案（**已无任何代码消费，死键**） |

代码侧的连带事实：
- `preset_schema.js` 的 `PRESET_FIELDS` **不含** `videoArgs` / `audioArgs` → 用户在 `~/.mediac/presets.yaml` 写 `videoArgs:` 会收到 `unknown field(s): videoArgs (ignored)` 并被丢弃。
- `ffmpeg_build.js` 已不再读取 `tempPreset.videoArgs`（grep 全仓库无读取点）。
- `buildAudioArgs()` 仍读取 `tempPreset.audioArgs`，但没有任何写入方（`createFromArgv` 不写、schema 不放行）→ **死代码分支**（`ffmpeg_build.js:616-621,632-641,550`）。

修复方向：二选一并保持一致——要么补回 `--video-args/--audio-args/--filters` 选项（含 `-c:v` 硬报错校验）与 schema 字段；要么删除全部文档/示例/死键/死代码。

---

### A4. 用户层预设 `extends` 内置预设名仍被整条丢弃【实测】

`preset_loader.js` 对每层 YAML **独立** 执行 `processPresets()`（含 `resolveExtends`），之后才 `mergePresets` 合并各层。因此用户层预设无法继承内置预设。

实测：`<项目>/presets.yaml` 写入

```yaml
my_custom:
    extends: hevc_2k
    videoQuality: 21
    _override: true
```

输出：

```
[PresetLoader] [INFO] Loading presets from: .../presets/default.yaml
[PresetLoader] [SUCCESS] Loaded 29 presets from YAML
[PresetLoader] [INFO] Loading presets from: .../temp/preset-extends-check/presets.yaml
[PresetLoader] [WARN] Failed to resolve preset 'my_custom': Preset not found: hevc_2k
[PresetLoader] [SUCCESS] Loaded 0 presets from YAML
my_custom 是否存在: false
```

这与 `presets.example.yaml` 的引导（「复制本文件到 `~/.mediac/presets.yaml`」并鼓励继承）直接冲突；失败只有一条 WARN，用户很容易以为自定义预设已生效。

修复方向：合并顺序改为「先按层解析 `extends`，解析时以已合并的低层表为基」——即把 `resolveExtends` 的查找域从「本层 raw」改为「本层 raw + 已合并表」。

---

### A5. AMD 显卡用户静默失去 AMF 硬件编码（vendor 归一化漏 Radeon）【代码确定】

```js
// src/transcode/gpu.js:385-400
if (v.includes("nvidia")) return "nvidia"
if (v.includes("intel")) return "intel"
if (v.includes("advanced micro devices") || v === "amd" || /\bati\b/.test(v) || /^ati/.test(v)) return "amd"
return "other"      // "AMD Radeon(TM) Graphics" / "AMD Radeon RX 7900 XTX" 全部落到这里
```

`systeminformation` 在 Windows 上返回的 AMD 型号串形如 `AMD Radeon RX 7900 XTX`，不含 `advanced micro devices`、不等于 `amd`、`\bati\b` 不匹配 → `"other"`。

后果链：
1. `primaryVendor(caps)` 优先取 `caps.gpus[0].vendor`（= `"other"`），即使 `caps.vendor` 已被 `usable.amf` 判为 `"amd"` 也被覆盖；
2. `GPU_VENDOR_HWACCELS.other = ["d3d"]` → **amf 层永不入场**；
3. `SWDEC_ENCODERS_BY_VENDOR.other` 为 `undefined` → `swdecUsable()` 返回 false → **swdec 层也永不入场**；
4. 结果：A 卡机器候选链退化为 `["d3d","cpu"]`，硬件编码收益全部丢失，且日志里看不到任何原因。

修复方向：`normalizeVendor` 增加 `radeon` / `rx ` 匹配；`primaryVendor` 在 gpus 判为 `other` 时回退到 `caps.vendor`。

---

### A6. RUNNING 期间修改配置被静默丢弃（P0-4 遗留）

```ts
// stores/plan.ts:191-204
function markStale() {
  if (tasks.value.length > 0) {
    if (status.value !== "RUNNING" && status.value !== "PLANNING" && status.value !== "STOPPING") {
      status.value = "STALE"
    }
  }
}
```

配置控件在 RUNNING 期间**仍可编辑**（`ConfigPanel` 只显示一条 `busy-lock-banner` 提示，没有 `disabled`），但 `markStale()` 在此期间是 no-op，运行结束后 `session.summary` 把状态直接置为 COMPLETED，**没有任何机制重新评估"配置已变"**。

于是：运行中把预设从 `hevc_2k` 改成 `av1_2k` → 界面显示 COMPLETED、无 STALE 标记 → 用户再点「开始转码」→ `startExecution` 的 `hasStaged || status === "STALE" || !planSnapshot` 全为 false → 直接复用主进程冻结的旧 `currentPlan.argv`。用户以为新预设已生效，实际跑的还是旧参数。

这正是 `DESKTOP-UIX-OPTIMIZATION-PLAN-REVIEW-20260925.md` P0-4 明确要求消除的「UI 显示配置已改变，但实际仍执行旧参数」歧义状态。

修复方向（任一）：RUNNING 期间真正禁用配置控件；或引入 config revision，终态后比对 revision 不一致即置 STALE。

---

### A7. 桌面端底栏「移除所选」未同步输入清单与主进程 staged【代码确定】

`TaskTable.vue` 存在两条语义应当等价的删除路径，但只有一条做了完整同步：

```html
<!-- :632 底栏按钮：只动 planStore -->
<button @click="planStore.removeSelectedTasks()">移除所选</button>
```

```ts
// :270-286 右键菜单：完整同步
planStore.removeSelectedTasks()
configStore.removeInputs(paths)          // ← 底栏缺失
window.api.removeStagedInputs(paths)     // ← 底栏缺失
```

后果：
- 左侧「输入与输出」的路径 chip 列表**仍显示**已被移除的文件（UI 自相矛盾）；
- 主进程 `stagedEntries` 仍保留该文件，`stageInputs` 的去重逻辑会把用户**重新导入同一文件**判为重复并静默丢弃（该坑在 `clearAllTasksFromMenu` 的注释里已被明确指出，此处是同类遗漏）。

单行 ✕ 删除（`removeTask`）与右键路径都是完整的，唯独底栏批量按钮遗漏。

---

### A8. CLI 重试链路把 `skipped` 状态泄漏进成功任务（B12 未修）

```js
// src/transcode/ffmpeg_engine.js:150-159
const preparedTask = await safeCallAsync(prepareAttempt, { task: currentTask, result, attempt, signal })
if (preparedTask) Object.assign(currentTask, preparedTask)     // 含 status
```

CLI 的 `prepareAttempt` 走 `buildCliTask({...retryEntry, signal})`（`cmd_ffmpeg.js:693-714`），而 `buildCliTask` 在重试时会因 `SHORT_DURATION` / `BAD_FORMAT` 等条件返回 `{ status: "skipped" }`。`Object.assign` 把该状态合并进任务后：

- 引擎在 attempt 之间**不复检** skip，`runFFmpegCmd` 也不检查 `entry.status`，照常执行 ffmpeg 并置 `ok = true`；
- `toRunResult()` 的**第一优先级**是 `Object.values(RUN_STATUS).includes(entry.status)` → 返回 `skipped`；
- 结果：**转码成功、产物已落盘的源文件被计为 skipped**（源文件不会删，方向保守，但统计与 UI 状态错误）。

桌面端 `prepareAttempt` 显式写了 `status: "pending"`（`ffmpeg-service.ts:643`），因此免疫；CLI 侧未修。

修复方向：重试前清 `status`/`skipped`（与桌面端对齐），或让 `toRunResult` 优先判定 `ok === true`。

---

### A9. 主进程执行状态无查询通道，运行中 reload 会让 UI 与引擎脱钩（B6 未修）

- `shared/ipc-channels.ts` 至今没有 `execution:get-status`；`DesktopTranscodeService.getStatus()` 存在但未被任何 IPC 暴露。
- `main/index.ts:181-182` 仍保留无守卫的 `role: "reload"` / `role: "forceReload"` 菜单项。
- 触发路径：运行中 Ctrl+R → 渲染层 store 全部重建为 IDLE、任务表清空 → 后续 `task.progress` / `task.done` 因 taskId 找不到而静默丢弃 → 此时无法终止（`stopExecution` 守卫只认 RUNNING/STOPPING）→ 结束时 `session.summary` 把空 store 置成 COMPLETED。

---

### A10. About 弹窗版本号硬编码

`AboutModal.vue:38` 写死 `<span class="badge">v0.1.0</span>`；而 `envStore.version`（由 `app:get-version` IPC 取回）在全渲染层**无任何消费点**（已 grep 确认）。即版本号展示恒为旧值，`getAppVersion` 是一次无用的 IPC 往返。

---

## 2. 中优先级：工程与架构

### B1. 桌面端 TS/Vue 无 lint 门禁

- 根 `npm run lint` = `eslint . --ext .js`，只覆盖 `.js`；`eslint.config.js` 的 `ignores` 也未排除 `apps/**`。
- `apps/mediac-desktop/package.json` 只有 `typecheck`，没有 `lint` 脚本，也没有自己的 ESLint 配置。
- 结论：`TaskTable.vue` / `ConfigPanel.vue` / `ffmpeg-service.ts` 等 4 万行级前端代码只受 `vue-tsc` 的类型约束，不受任何 lint 规则约束（未使用变量、`no-empty`、`no-fallthrough` 等一律漏检）。

### B2. 注释与实现矛盾（会误导后续维护）

| 位置 | 注释声称 | 实际 |
|---|---|---|
| `ffmpeg_build.js:513-517` | 「videoArgs 槽位已并入 buildVideoArgsFromPlan（无 -c:v 时作为额外参数附加）」 | 该函数完全不读 `videoArgs` |
| `hwaccel.js:548-549` | 「d3d/swdec/cpu 层帧在系统内存，由 `-pix_fmt` 对齐」 | `buildEncoderArgs` 只在 `tierName === "swdec"` 注入 `-pix_fmt`（B14 未修） |
| `ffmpeg_run.js:424-425` | 「产物过小属输出质量问题而非解码失败，**不应进重试链路**」 | `cmd_ffmpeg.js:684` 的 `shouldRetry` 只看 `result.status === "failed"`，产物过小必然进重试 |
| `hwaccel.js` 文件头 | 「文件末尾『对接说明』保留设计背景与未完成项」 | 该段大部分是历史遗留草稿（`cmd_ffmpeg.js 约 1957-2005 行` 等已不存在的引用） |

### B3. 单文件体量与职责混杂

| 文件 | 行数级 | 混合职责 |
|---|---|---|
| `src/transcode/hwaccel.js` | ~1580 行 | 尺寸计算 + 质量标定表（VMAF/QUALITY_OFFSET）+ 编码器矩阵 + 滤镜串生成 + 编码器参数分发 + 探测 + 缓存 + 层选择 + strict 语义 |
| `src/transcode/ffmpeg_build.js` | ~890 行 | 输入/滤镜/视频/音频/元数据/流参数组装 + 字幕降级 + MKV 统计标签清理 |
| `src/transcode/ffmpeg_run.js` | ~860 行 | 单文件执行 + 进度解析 + 错误提取 + 临时文件注册表 + 进程信号钩子 + 硬件分层入口 |
| `cmd/cmd_ffmpeg.js` | ~790 行 | yargs 声明 + 参数二次校验 + 扫描 + 计划 + 删源 + 预览 + 执行 + 汇总 |

`docs/ARCHITECTURE-MAINTENANCE-PLAN-20260925.md` 的 R0-R5 已落地，R6（CLI lazy loading）仍是独立待办阶段。

### B4. 库代码劫持宿主进程信号

```js
// src/transcode/ffmpeg_run.js:123-135
for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => { cleanupTempFiles(sig); process.exit(130) })
}
process.on("exit", () => cleanupTempFiles("exit"))
```

`installTempCleanupHooks()` 由 `runFFmpegCmd` 调用，而桌面端 `ffmpeg-service.ts` 的 `runTask` 也走 `runFFmpeg` → 同一份代码在 **Electron 主进程**注册了 `process.exit(130)` 级别的信号处理。CLI 场景合理，主进程场景属于越权：应由宿主（index.js / Electron main）决定退出策略，库只暴露 `cleanupTempFiles()`。另注 `process.on("exit")` 回调里调用 `log.logWarn`（同步写 stdout）在退出路径上并不安全。

### B5. `directories` 语义双写

- `ffmpeg_options.js:60-77` 的 `normalizeInputs(inputs, directories)` 把 `directories` **并入 `inputs`**；
- `ffmpeg_scan.js:158-169` 的 `collectCliInputEntries` 又按 `argv.directories` **二次遍历**；
- `normalizeCliOptions` 传 `directories`，`normalizeDesktopOptions` 不传。

结果是 CLI 的 `directories`（额外输入根）与 desktop 的 `inputs` 语义并不等价，`toLegacyArgvOptions` 又把 `directories` 从规范化结果里剥掉（不在 `OPTION_KEYS`），只能靠 `cmd_ffmpeg.js:450` 手工补回。建议统一为单一入口语义。

### B6. `toSerializable` 的环检测会把 DAG 误判为循环

```ts
export function toSerializable(value: unknown, seen = new WeakSet<object>()): unknown {
  ...
  if (seen.has(value)) return "[Circular]"     // 同一对象出现两次（非环）也会命中
```

当前 IPC payload 恰好没有共享引用，因此未触发；但这是潜伏缺陷——一旦 `mediaInfo` 或 `hardware` 子对象被两个字段共同引用，序列化结果会静默丢数据。正确做法是「当前路径栈」而非全局 visited 集。

### B7. 其余中低风险（上一轮 L 系列，仍未修）

| 编号 | 问题 | 位置 |
|---|---|---|
| L2 | `--error-file <路径>` 用户路径被忽略：只识别特殊值 `"json"`，其余一律写到 `fileDstDir/<name>_<preset>_error_<ts>.txt`；json 模式下 `JSON.stringify(Error)` 得 `{}`，`message` 丢失 | `ffmpeg_run.js:548-572` |
| L9 | 复制推演命令以 `planStore.tasks[0]` 为替换基准，而 `previewCmd` 由主进程按 `currentPlan.tasks[0]` 生成 → 移除过首行后替换失配，复制出指向已移除任务的命令 | `TaskTable.vue:212-239`、`TaskInspectorDrawer.vue:15-28` |
| L11 | `probeCacheKey` 不含 `quality` / `bitrate` → 长驻进程（Electron）跨批次复用旧探测结论 | `hwaccel.js:1128-1144` |
| — | `log.fileLog` 占位符串错位：`[${entry.dstArgs?.dstAudioBitrate \|\| entry.preset.name}]` 本应是预设名 | `ffmpeg_run.js:436` |
| — | 桌面端无 `--exclude` 默认值（CLI 的 `shana\|.m4a` 是 yargs default）→ 同目录同预设下两端处理集合不同 | `cmd_ffmpeg.js:140` vs `ffmpeg-service.ts:318` |
| — | prepare 并发默认 `argv.jobs \|\| (UNC?4:JOBS.externalTool())` 与 execute 默认 `jobs \|\| (video?1:4)` 不一致 | `cmd_ffmpeg.js:527,654` |
| — | `deleteCompletedSources` 桌面端未传 `includeExisting`（CLI 计划阶段传 true）→ 「已有产物」的删源语义两端不一致 | `ffmpeg-service.ts:664-667` |
| — | `selectTier` 无条件调用 `calcLongEdge(srcW, srcH, dimension)`，源宽高缺失（0x0）时抛 `invalid source size 0x0`，被包装成 `plan: ...` 的费解错误；`calculateDstArgs` 反而做了 `> 0` 保护 | `hwaccel.js:1373` |
| — | `logStore.append` 把 `"DEBUG"` 强转为 `INFO`，而 `ConfigPanel` 为每个 tune 字段都挂了 watcher → 拖动 CRF 滑杆会往日志抽屉灌入大量 INFO | `stores/log.ts:38-52`、`ConfigPanel.vue:100-163` |
| — | `resolveHwPlan` 仍写 `entry.useCUDA`（唯一写入点，无读取点） | `ffmpeg_run.js:212` |

---

## 3. UI / UX

### C1. 死控件与「设置项 ≠ 实际行为」

| 控件 | 问题 |
|---|---|
| 设置 → 工具路径 → `mediainfo` | **完全无效**：`FfmpegEnvironment.setCustomToolPaths` 只处理 `ffmpeg`/`ffprobe`；`EnvironmentSummary` 不返回它；`lib/mediainfo.js` 的 `mediainfoCall` 用的是 PATH 里的裸 `mediainfo`，且桌面端固定 `useMediaInfo: false`（只作 ffprobe 失败后的兜底）。三项收集 + localStorage 持久化 + IPC 传参全是空转 |
| 设置 → 硬件加速方式 → `cpu` | 见 A1，假开关 |
| 设置 → 并发任务数 | 输入 `max=4`，主进程 `MAX_CONCURRENCY = 8`；提示文案「仅音频并行，**视频始终串行**」与实际矛盾——`plannedConcurrency` 无差别应用于所有预设类型，设 4 就是 4 路并发视频转码（NVENC 会话数风险） |
| 关于弹窗版本号 | 见 A10 |

### C2. 缺少批量风险预检摘要（Phase 2 未落地）

`DESKTOP-UIUX-OPTIMIZATION-PLAN-REVIEW-20260925.md` §4.4 要求「一键执行前暴露批量风险摘要」：覆盖数量、将跳过数量、将删除源数量。当前 HeaderBar 只有 `stale-alert`（"参数已变更 · 可直接开始转码"），**看不到本批次的破坏性影响**。`override` 与 `deleteSource` 两个高危项藏在设置弹窗里，用户点「开始转码」前无法从界面确认它们会带来什么。

### C3. 表格规模与筛选

- `TaskTable` 直接 `v-for` 渲染全部 `planStore.tasks`，**无虚拟滚动**；CLI 侧对 >1000 文件有确认闸（`cmd_ffmpeg.js:502-509`），桌面端没有对应保护，大目录导入后 UI 与探测并发都无上限提示。
- 无按状态筛选 / 名称搜索 / 失败项一键过滤，只能靠底部「移除所选」。

### C4. 键盘可达性与无障碍缺口

- `SettingsModal` 的 4 个开关是 `role="switch" tabindex="0"` + **仅 `@click`**，无 `@keydown.space/enter` → 键盘用户无法操作（`TaskTable` 的 checkbox 反而是对的，有 `@keydown.space.prevent`）。
- 自定义右键菜单只能由 `@contextmenu` 打开，没有 `Shift+F10` / `Context Menu` 键盘入口（`§8.2 人工验收` 明确要求）。
- 状态色（`tag.ok/err/warn`）为主要区分手段，未提供非颜色冗余标识。

### C5. 输出目录相关

- `ConfigPanel.pickOutputDir` 直接 `config.outputDir = res.paths[0]`，绕过了 `setCustomOutputDir()` → `savedCustomOutputDir` 与 `outputBesideSource` 不同步（`TaskTable` 的 `pickOutputDir` 用的是正确写法，两处不一致）。
- 手动**输入**的输出目录不在主进程 `PathWhitelist` 内；在生成计划之前点「打开输出目录」（菜单/ExecutionBoard/StatusBar 都有入口），`isKnownMediaPath` 校验失败 → IPC reject，渲染层 `void window.api.openPath(dir)` 无 catch → 用户看到"点了没反应"，控制台一条未处理拒绝。

### C6. 推演命令的可信度

- `TaskInspectorDrawer` 在 `planSnapshot.previewCmd` 缺失时**自造**一条命令（`libx264` / `-crf 23` / `-vf scale=-2:W` …），却标注为「FFmpeg 命令行（完整推演）」。这条命令与真实执行无关（真实命令由硬件分层、预设族、按文件计算的码率共同决定），复制出去会误导。
- 即使 `previewCmd` 存在，它也是用 **cpu 层占位**（`buildPreviewHwPlan()`）生成的，因此展示的编码器不是实际会用的硬件编码器，且只反映 `tasks[0]`——多文件时不同源可能走不同 tier。
- 无 dry-run / 试运行入口（CLI 的 test 模式在桌面端没有对应物），用户无法在不产生文件的前提下验证整批命令。

### C7. 状态与信息重复

- `ExecutionBoard.isDone` 只含 `COMPLETED | STOPPED`，**FAILED 时不显示**「打开输出目录」——恰恰是失败后最需要去查看产物的场景。
- `HeaderBar` 与 `StatusBar` 重复展示同一套 ffmpeg/GPU/分层信息（`§Phase 5 视觉和日志降噪` 未落地）；`HeaderBar.stateInfo` 在 `hasStaged` 时把任何状态（含 COMPLETED/FAILED）统一覆盖为「待规划」。
- `TaskTable.STATUS_MAP` 里的 `preparing` / `retrying` 两个状态**无任何写入方**（死枚举）。

---

## 4. 已确认修复（避免重复报告）

以下上一轮评审结论经本次逐条复核，**已在位**：

- B1 终态后改配置不标 STALE → `markStale()` 已覆盖终态（`plan.ts:191-204`）
- B2 `--video-copy` 与滤镜冲突 → `createFromArgv` 统一收口清 `dimension/framerate/speed`（`ffmpeg_presets.js:521-528`）
- B3 webm 容器字幕硬失败 → `appendSubtitleArgs` 新增 webm 分支降级 `-sn`（`ffmpeg_build.js:399-411`）
- B4 右键清空绕过 busy 守卫 → 已补 `isPlanBusy()` + 清 inputs + 清 staged（`TaskTable.vue:297-313`）
- B5 `audioCodec:"copy"` 绕过容器兼容检查 → 已加闸并降级重编码（`ffmpeg_build.js:552-573`）
- B7 计划阶段删源早于总确认 → 已挪到总确认之后（`cmd_ffmpeg.js:612-641`）
- B9 stopExecution 同步串行 taskkill → 已改并行 `execFile`（`ffmpeg-service.ts:441-463`）
- B10 进度节流跨任务共享 → 已改按 taskId 分桶（`progressThrottleMap`）
- B11 ffargs 码率带单位被丢弃 / `an`·`anime` 键不可用 → 已补 `parseBitrate` 分支与 anime 分支（`ffmpeg_presets.js:310-323,355-359`）
- 桌面端 `ffmpeg-service.ts` 直连 `lib/mediainfo.js` → 已改经 `src/transcode/index.js` facade
- UIUX 评审 P0-1/P0-2/P0-3/P0-5（空选择不回退全选、移除项不复活、开始按钮可用性、public target summary 契约）→ 均已在位

---

## 5. 建议修复顺序

**第一批（用户可感、改动小）**

1. A1 `--hwaccel cpu` 语义修正 + 桌面端下拉文案（`hwdetect.js` 一处 return，UI 一处文案）
2. A2 speed 类型对齐（`ffmpeg_run.js` 输出数字，或 `plan.ts` 解析 `"1.5x"`）——一处改动即可点亮两个 UI 指标
3. A7 底栏「移除所选」补同步（照抄右键路径三行）
4. A10 + C1 mediainfo 死控件：接入或移除
5. C5 输出目录：`pickOutputDir` 改用 `setCustomOutputDir`；`openPath` 加 catch + 提示

**第二批（正确性/一致性）**

6. A3 文档与实现对齐（补回选项 或 删净文档+死键+死代码）
7. A4 跨层 `extends` 解析
8. A5 AMD vendor 归一化
9. A6 RUNNING 期间配置语义（锁定 或 revision）
10. A8 CLI 重试状态清理；A9 补 `execution:get-status` IPC + 菜单 reload 守卫

**第三批（工程基建）**

11. B1 给 `apps/mediac-desktop` 加 ESLint（含 vue 插件）并纳入根 lint
12. B2 清理 4 处与实现矛盾的注释；B4 把进程信号处理上移出库；B6 `toSerializable` 改路径栈
13. C2 批量风险摘要；C3 表格虚拟滚动/筛选；C4 键盘可达性补齐（对齐 `§8.2 验收标准`）
14. B3 视 R6 阶段推进，优先拆 `hwaccel.js`
