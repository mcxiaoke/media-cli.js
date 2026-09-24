# FFmpeg 核心层模块化重构方案

> **文档版本**：v1.0.0
> **创建日期**：2026-09-24
> **状态**：方案评审（未动代码）
> **关联模块**：`cmd/cmd_ffmpeg.js`、`ffweb/*`、`lib/ffmpeg_*.js`、`lib/hwaccel.js`
> **重构目标**：让 CLI 与 GUI 都退化成"薄适配器"，ffmpeg 后端收敛为单一可复用、可测试的模块化接口

---

## 0. 结论摘要（TL;DR）

你的判断方向是对的，但**病灶比"耦合乱"更严重**：现在的问题不是"耦合"（coupling），而是**业务逻辑分叉**（fork）——`ffweb/task_runner.js` 把 `cmd_ffmpeg.js` 的转码编排逻辑**复制了一份精简版**，两份代码独立演进。

实测证据：`ffweb/task_runner.js` 中下列 CLI 能力**全部为 0 次引用**：

| 能力 | CLI 引用数 | GUI 引用数 |
| :--- | :--- | :--- |
| `override`（覆盖已有产物） | 7 | **0** |
| `outputMode`（输出目录模式） | 3 | **0** |
| `strict`（严格模式） | 11 | **0** |
| `deleteSourceFiles` | 3 | **0** |
| `filelist`（清单输入） | 7 | **0** |
| 失败重试 | 9 | **0** |
| `include` / `exclude` 过滤 | 2 | **0** |
| `applyFileNameRules` | 2 | **0** |
| `readMusicMeta`（音频元数据） | 2 | **0** |
| `isAudioExtract`（音频提取） | 1 | **0** |
| 字幕 `subs/` 子目录检索 | — | **0** |

**这意味着：GUI 不是"另一个前端"，而是一个功能残缺的平行实现。** 每在 CLI 加一个参数，GUI 就落后一步；想修 GUI 的某个 bug，得改两处。这个分叉会随时间指数级恶化。

**结论**：不要"整理 import"，而是**把编排逻辑抽出为 `lib/ffmpeg_engine.js` 单一事实源**，CLI 和 GUI 各自只保留"参数构造 + 事件渲染"两层皮。

**好消息**：执行层（`lib/ffmpeg_run.js`）的回调口子**已经就绪**，最难的活已经干完了。

---

## 1. 现状诊断

### 1.1 分层现状（实际）

```
┌──────────────────────────────────────────────────────────────┐
│ cmd/cmd_ffmpeg.js  1126 行                                   │
│   包含：yargs 选项声明 + 参数校验 + 文件扫描 + 单文件任务构建   │
│        + 终端确认(5处) + 并发编排 + 重试 + 汇总 + 删除源文件    │
├──────────────────────────────────────────────────────────────┤
│ ffweb/task_runner.js  551 行                                 │
│   包含：文件扫描(重写) + 单文件任务构建(重写) + 确认(缺)        │
│        + 串行编排 + 状态机 + SSE 事件                          │
└──────────────────────────────────────────────────────────────┘
                          ↓ 两者都调用 ↓
┌──────────────────────────────────────────────────────────────┐
│ lib/ffmpeg_run.js  719 行   ← 已有 onProgress/onLog/signal ✅ │
│ lib/ffmpeg_build.js 768 行  ← 纯函数，无终端耦合 ✅            │
│ lib/ffmpeg_plan.js  478 行  ← 纯函数 ✅                       │
│ lib/hwaccel.js     1555 行  ← 纯函数 ✅                       │
│ lib/hwdetect.js     610 行  ← 纯函数 ✅                       │
│ lib/ffmpeg_presets.js 509 行 ← 纯函数 ✅                      │
└──────────────────────────────────────────────────────────────┘
```

**关键洞察**：`lib/` 底层是干净的（上表已验证终端交互引用数为 0）。**乱的是"编排层"——而编排层现在有两份。**

### 1.2 三个具体耦合症状

**症状 A：编排逻辑重复实现**

| `cmd/cmd_ffmpeg.js` | `ffweb/task_runner.js` | 说明 |
| :--- | :--- | :--- |
| `collectInputEntries()` L391-446 | `collectInputFiles()` L174-212 | 同一件事，两套实现 |
| `prepareFFmpegCmd()` L858-1126（268 行） | `createPlan()` L217-383（167 行） | **同一件事，GUI 版少了 12 项能力** |
| `planFFmpegTasks()` L454-716 | — | CLI 独有：校验、确认、抽样 |
| `runFFmpegTasks()` L722-842 | `startExecution()` L388-535 | 并发编排 vs 串行编排，重试逻辑 CLI 独有 |

**症状 B：终端交互硬编码在编排里**

`cmd/cmd_ffmpeg.js` 有 **5 处** `confirmDangerousAction` 阻塞式询问：

- L560 — 文件数 > 1000 确认
- L580 — 准备任务确认
- L618 — 删除源文件确认
- L705 — 开始处理确认
- L755 — 失败重试确认

GUI 无法复用这条路径，只能绕开（于是绕开时把能力一起丢了）。

**症状 C：`argv` 巨型对象穿透全层**

yargs 解析出的 `argv` 被原样塞进 `entry.argv`，一路穿到 `ffmpeg_build.js` / `hwaccel.js`。没有规范化契约、没有类型边界、没有校验集中点。GUI 只能手工拼一个"长得像 argv"的对象（`task_runner.js` L243-248 的 `mergedArgv`），**拼错不会报错，只会静默行为异常**。

---

## 2. 目标架构

### 2.1 分层目标

```
┌────────────────────────────────────────────────────────────┐
│ 适配器层（薄皮，各自 <200 行）                                │
│   cmd/cmd_ffmpeg.js   → yargs 声明 + CLI Hooks + 终端渲染     │
│   ffweb/task_runner.js→ HTTP/SSE + Web Hooks + 状态机        │
└────────────────────────────────────────────────────────────┘
                            ↓ 统一契约 ↓
┌────────────────────────────────────────────────────────────┐
│ lib/ffmpeg_engine.js  ← 唯一编排事实源                       │
│   plan(options, hooks) / run(plan, hooks) / cancel()        │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ lib/ffmpeg_task.js    ← 单文件 → 可执行任务（唯一实现）        │
│ lib/ffmpeg_scan.js    ← 输入收集（唯一实现）                  │
│ lib/ffmpeg_options.js ← 选项规范化 + 校验（唯一契约）          │
└────────────────────────────────────────────────────────────┘
                            ↓
┌────────────────────────────────────────────────────────────┐
│ lib/ffmpeg_run.js / ffmpeg_build.js / ffmpeg_plan.js /      │
│ hwaccel.js / hwdetect.js / ffmpeg_presets.js  （保持不动）    │
└────────────────────────────────────────────────────────────┘
```

### 2.2 新增模块清单

| 新模块 | 职责 | 主要来源 |
| :--- | :--- | :--- |
| `lib/ffmpeg_options.js` | 选项 schema、默认值、规范化、集中校验 | 从 `cmd_ffmpeg.js` L454-508 抽出 |
| `lib/ffmpeg_scan.js` | 输入收集：filelist / 目录遍历 / 扩展名与文件名过滤 | 从 `cmd_ffmpeg.js` L391-446 抽出 |
| `lib/ffmpeg_task.js` | 单文件 → 任务条目（含产物路径、字幕、跳过判定） | 从 `cmd_ffmpeg.js` `prepareFFmpegCmd` L858-1126 抽出 |
| `lib/ffmpeg_engine.js` | 编排：plan / run / cancel，通过 hooks 回调 | 从 `cmd_ffmpeg.js` L454-842 抽出 |

**注意**：不移动现有 `lib/ffmpeg_*.js`，避免大规模路径 churn；新模块平铺在 `lib/`，与现有命名约定一致。

---

## 3. 核心接口设计

### 3.1 统一 Hooks 契约（这是解耦的枢纽）

编排层所有"需要和用户打交道"的动作，一律通过 hooks 回调注入，**编排层自身不含任何终端/网络代码**：

```javascript
/**
 * 编排钩子契约：CLI 与 GUI 各自实现，引擎只负责在正确时机调用。
 * 所有 hook 均为可选；缺省时采用"无人值守"默认行为（见下表）。
 */
const EngineHooks = {
    // 进度与日志（已有，直接复用 ffmpeg_run 的回调口子）
    onProgress: (p) => {},        // { taskIndex, total, percent, speed, currentTime, srcDuration }
    onLog: (level, tag, message) => {},
    onTaskStart: (task, index) => {},
    onTaskDone: (task, index, result) => {},

    // 确认类：返回 Promise<boolean>。缺省 → 视为 true（无人值守）
    onConfirm: async (request) => true,
    //   request: { kind, message, count?, preset?, duration?, danger? }
    //   kind ∈ 'continue' | 'prepare' | 'process' | 'deleteSource' | 'retry'

    // 渲染类：纯展示，无返回值
    onPlanReady: (plan) => {},    // 计划就绪（CLI 打印命令预览，GUI 推送 snapshot）
    onSummary: (summary) => {},   // 执行汇总
}
```

**关键设计点**：`onConfirm` 把 5 处硬编码询问统一成一个可替换策略。默认 `true` 保证批处理/自动化场景天然可用（等价于现在的 `--auto-confirm`），而危险操作（`danger: true`）默认应为 `false` —— 见下方 3.4 安全约束。

### 3.2 引擎接口（`lib/ffmpeg_engine.js`）

```javascript
/**
 * 计划阶段：扫描 → 构建任务 → 确认。返回 plan 或 null（用户取消/无文件）。
 * 不做任何 IO 之外的副作用（dry-run 契约天然成立）。
 */
export async function planTasks(rawOptions, hooks = {}) {
    const options = normalizeOptions(rawOptions)   // ffmpeg_options.js，含校验
    const entries = await collectEntries(options)  // ffmpeg_scan.js
    if (entries.length === 0) return null
    await hooks.onConfirm?.({ kind: 'prepare', ... })
    const tasks = await pMap(entries, buildTask, { concurrency: options.jobs })
    const ready = tasks.filter(Boolean)
    if (ready.length === 0) return null
    const plan = { tasks: ready, options, testMode: !options.doit, stats: computeStats(ready) }
    hooks.onPlanReady?.(plan)
    return plan
}

/**
 * 执行阶段：并发编排 → 失败重试 → 汇总 → 可选删源。
 */
export async function runPlan(plan, hooks = {}) { /* ... */ }

/**
 * 取消：绑定 AbortController，杀进程树，清理临时文件。
 */
export function cancelPlan(controller) { /* ... */ }
```

**返回值契约**：`plan` 是**纯数据**（可 JSON 序列化），因此 GUI 可以直接把它作为 HTTP 响应体或 SSE 快照下发，无需二次转换。

### 3.3 两个适配器的最终形态

**CLI（`cmd/cmd_ffmpeg.js`，预计 1126 → ~230 行）**

```javascript
const handler = async (argv) => {
    const hooks = createCliHooks(argv)      // 实现 onConfirm → inquirer
    const plan = await planTasks(argv, hooks)
    if (!plan) return
    await runPlan(plan, hooks)
}

// lib/cli_hooks.js —— CLI 专有的交互实现（从原文件平移，逻辑不变）
function createCliHooks(argv) {
    return {
        onConfirm: async (req) => {
            if (isAutoConfirm()) return req.danger !== true
            const answer = await confirmDangerousAction(req.message)
            return !(await abortIfCancelled(answer, LOG_TAG))
        },
        onPlanReady: (plan) => { /* 打印 PRESET / CMD / 总时长 */ },
        onSummary: (s) => { /* 打印统计 */ },
        onProgress: (p) => { /* cli-progress 进度条 */ },
        onLog: (lvl, tag, msg) => log[lvl]?.(tag, msg),
    }
}
```

**GUI（`ffweb/task_runner.js`，预计 551 → ~200 行）**

```javascript
class TaskRunner {
    async createPlan(body) {
        const hooks = this.#createHooks()
        this.currentPlan = await planTasks(body, hooks)   // ← 同一引擎
        return toApiResponse(this.currentPlan)
    }
    async startExecution() {
        this.abortController = new AbortController()
        await runPlan(this.currentPlan, { ...this.#createHooks(), signal: this.abortController.signal })
    }
    #createHooks() {
        return {
            onProgress: (p) => this.emit('PROGRESS', p),
            onLog: (lvl, tag, msg) => this.appendLog(lvl, tag, msg),
            onConfirm: async (req) => this.#askFrontend(req),  // ← GUI 补回确认能力
            onPlanReady: (plan) => this.emit('PLAN_READY', plan),
            onSummary: (s) => this.emit('ALL_DONE', s),
        }
    }
}
```

**收益**：GUI 自动继承全部 12 项缺失能力（`override` / `strict` / 重试 / 过滤 / 音频提取 …），且未来 CLI 新增参数 GUI 零改动。

### 3.4 安全约束（重要）

当前 CLI 的确认语义是"默认拒绝"（`abortIfCancelled` 未确认即中止），而 GUI 目前**完全没有确认环节**。抽象时必须保留危险操作的保守默认：

| 操作 | `danger` | 缺省行为 | 理由 |
| :--- | :--- | :--- | :--- |
| 文件数 > 1000 继续 | false | `true` | 仅性能提示，可安全继续 |
| 准备任务 / 开始处理 | false | `true` | dry-run 默认，无副作用 |
| **删除源文件** | **true** | **`false`** | 不可逆，必须显式确认 |
| **失败重试** | false | `false` | 会产生额外转码开销 |

即：`onConfirm` 缺省实现为 `() => req.danger !== true`。这样 GUI 未实现确认 UI 时，**删源这类破坏性操作自动被拒绝**，而不是静默执行。

---

## 4. 分步实施计划

按"低风险、可独立验证、随时可停"原则切分。每步结束都应能通过现有测试。

### 阶段 0：加装护栏（无行为变更）
- 补齐 `test/test_ffmpeg_engine_contract.js`：先以**特征测试**（characterization test）锁定 `prepareFFmpegCmd` 对给定输入产出的任务条目结构（含产物路径、字幕选择、跳过判定）。
- 目的：后续搬迁时用它证明"行为未变"。**这一步是全部重构的安全网，不可跳过。**

### 阶段 1：抽出选项层（`lib/ffmpeg_options.js`）
- 把 `cmd_ffmpeg.js` L454-508 的校验逻辑（preset 必填、jobs>0、speed 域 0.5–2.0、dimension≥0、路径存在性）移入 `normalizeOptions()`。
- 同时把 builder 中的选项 schema 一并迁入，`cmd_ffmpeg.js` 的 `builder` 改为由 schema 生成。
- **验证**：`npm run check` + `npm run lint` + 现有 `test/test_ffmpeg_params_v2.js` 全绿。

### 阶段 2：抽出扫描层（`lib/ffmpeg_scan.js`）
- 迁移 `collectInputEntries()`（L391-446）与 `applyFileNameRules` 调用。
- **验证**：CLI 跑一次真实目录 dry-run，文件数与跳过名单与重构前逐行比对一致。

### 阶段 3：抽出任务构建层（`lib/ffmpeg_task.js`）
- 迁移 `prepareFFmpegCmd()`（L858-1126，268 行）——**这是最核心的一步**，GUI 的能力缺口正在此。
- 保持函数体逐行不变，只改导出与依赖注入（`log` 调用改为 `hooks.onLog`）。
- **验证**：阶段 0 的特征测试必须全绿；再对 `data/videos/TEST2__*` 跑一轮 dry-run 比对命令字符串。

### 阶段 4：抽出编排层（`lib/ffmpeg_engine.js`）
- 迁移 `planFFmpegTasks()` / `runFFmpegTasks()`，5 处 `confirmDangerousAction` 全部替换为 `hooks.onConfirm`。
- 新增 `lib/cli_hooks.js` 承接原 CLI 交互实现。
- `cmd_ffmpeg.js` 退化为 ~230 行薄适配器。
- **验证**：CLI 端到端（含确认交互、取消、重试）行为不变。

### 阶段 5：GUI 切换到统一引擎
- 删除 `task_runner.js` 中重复的 `collectInputFiles()` 与 `createPlan()` 实现，改为调用 `planTasks()`。
- `ffweb` 补上确认 UI（前端加一个确认弹层，接 `/api/confirm` 或复用 SSE 双向通道）。
- **验证**：`test/test_ffweb_flow.js` + GUI 实机验证；重点验证 GUI 新获得的 `override` / `strict` / 重试能力。

### 阶段 6：收敛与清理
- 移除 `cmd_ffmpeg.js` 中的死代码与重复 import。
- 更新 `AGENTS.md` 的 ffmpeg 模块清单与 `docs/FFMPEG-USAGE.md`。
- 按项目规范在 `docs/CHANGES-YYYYMMDD.md` 追加变更摘要。

---

## 5. 工作量与风险评估

| 阶段 | 内容 | 复杂度 | 风险 |
| :--- | :--- | :--- | :--- |
| 0 | 特征测试护栏 | ★★☆ | 无 |
| 1 | 选项层 | ★★☆ | 低 |
| 2 | 扫描层 | ★☆☆ | 低 |
| 3 | 任务构建层 | ★★★★ | **中高** |
| 4 | 编排层 | ★★★★ | **中高** |
| 5 | GUI 接入 | ★★★ | 中 |
| 6 | 清理 | ★☆☆ | 低 |

**总量**：净增约 900–1200 行（新模块 + hooks），`cmd_ffmpeg.js` 减约 900 行，`task_runner.js` 减约 350 行。**代码总量基本持平，但重复消除、职责单一。**

### 主要风险与对策

| 风险 | 对策 |
| :--- | :--- |
| **行为漂移**（重构最怕静默改变行为） | 阶段 0 特征测试 + 每阶段 dry-run 命令字符串逐字比对 |
| 阶段 3/4 是 268 行 + 263 行的大搬迁 | 只做"移动 + 依赖注入"，**禁止顺手优化**；优化留到阶段 6 之后独立提交 |
| GUI 确认 UI 缺失导致删源被拒 | 3.4 的保守默认保证安全；UI 作为独立小任务补 |
| 长时间无法合并中间状态 | 每阶段独立可提交，主干始终可用 |

### 明确的非目标

- **不动** `lib/hwaccel.js` / `hwdetect.js` / `ffmpeg_build.js` / `ffmpeg_plan.js`（已验证干净，且含真机核验过的参数决策）
- **不改** 任何 ffmpeg 编码/滤镜参数（AGENTS.md 明确要求真机核验）
- **不换** 技术栈、不引入新运行时依赖
- **不做** 性能优化（另开任务）

---

## 6. 备选方案对比

| 方案 | 做法 | 评价 |
| :--- | :--- | :--- |
| **A. 抽引擎 + Hooks（本方案）** | 新增 4 个 lib 模块，双适配器薄皮 | ⭐⭐⭐⭐⭐ 根治分叉，执行层已就绪，改动可控 |
| B. GUI 改为 spawn CLI 子进程 | `ffweb` 调 `node index.js ffmpeg ...` 解析 stdout | ⭐⭐ 零重复但丧失结构化进度；取消/临时文件清理不可靠；确认交互无法穿透 |
| C. 只把 CLI 逻辑提到 lib，GUI 继续自己一份 | 局部改善 | ⭐⭐ 分叉仍在，问题未解决 |
| D. 全部推倒重写 | 重新设计 | ⭐ 抹掉真机核验成果，成本极高 |

**推荐 A**。理由：执行层（`ffmpeg_run.js` 的 `onProgress`/`onLog`/`signal`）**已经做完了最难的部分**，剩下的本质是"把已有代码搬到正确的位置"，属于低创造、高确定性的工作。

---

## 7. 建议的下一步

先做**阶段 0（特征测试护栏）**，它是唯一"必须先做且不可省"的一步，且本身零行为变更、可立即验证。

阶段 0 完成后再决定是否推进阶段 1–6——届时你手上会有一份能证明"行为未变"的安全网，重构风险将从"中高"降到"低"。
