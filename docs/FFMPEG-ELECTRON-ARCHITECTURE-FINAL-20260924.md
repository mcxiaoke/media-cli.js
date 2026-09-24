# MediaCli FFmpeg 桌面端（Electron）最终架构与实施方案

> **文档版本**：v1.0.0
> **创建日期**：2026-09-24
> **状态**：定稿（实施就绪）
> **适用范围**：`apps/mediac-desktop`
> **取代关系**：本文档取代 `docs/FFMPEG-ELECTRON-GUI-PLAN-20260924.md`（架构与选型部分）与 `docs/FFMPEG-ELECTRON-UI-DESIGN-20260924.md`（全部）。两份旧文档仅供历史参考，实施一律以本文档为准。
> **基本原则**：以仓库代码现状为唯一事实源；不重写主进程与共享编排层；UI 层重写采用"组件化 + 状态管理 + 开箱组件库"，杜绝手写 CSS 造轮子。

---

## 0. 结论摘要（TL;DR）

1. **编排层抽离已完成**：GUI-PLAN 提出的"抽离 `lib/ffmpeg_orchestrator.js`"在仓库中已落地为 `lib/ffmpeg_planner.js`、`lib/ffmpeg_engine.js`、`lib/ffmpeg_scan.js`、`lib/ffmpeg_options.js`、`lib/ffmpeg_plan_snapshot.js` 等模块，CLI 与 GUI 已共享同一套转码决策逻辑。**不要再重复此重构**。
2. **主进程骨架已可用**：`apps/mediac-desktop` 已是可运行的 v0.1.0（electron-vite 三端分离、安全 IPC、engine 封装、electron-builder 打包产物齐全）。本文档只做**增量改造**，不做推翻重来。
3. **UI 选型定稿**：Naive UI（暗色主题、`size="small"` 高密度、`NDataTable` 虚拟滚动开箱即用）+ VueUse（偏好持久化）+ Pinia（任务/执行状态管理）。并发控制复用 engine 内置的 `p-map`，不另装 p-limit。
4. **修正旧方案的事实错误**：预设名单不再写死（实际 29 个，见 §3.1）；删除源文案按真实行为写（工具自身回收目录，非系统回收站，见 §8.7）；`--jobs` 并发语义对齐 CLI（视频串行/音频并行，见 §6.3）；进度事件改为主进程节流（见 §8.2）。

---

## 1. 代码现状盘点（以仓库实况为准）

### 1.1 直接复用、零修改（共享编排层与引擎）

| 模块 | 职责 | 备注 |
| :--- | :--- | :--- |
| `lib/ffmpeg_engine.js` | 任务队列、并发（内置 p-map）、取消、自动重试、结果归一、事件协议 | `execute(plan, {mode, signal, concurrency, maxAttempts, shouldRetry, confirmRetry, onTask*})`；transport-agnostic |
| `lib/ffmpeg_planner.js` | `prepareFFmpegPlan` 计划推演、`deleteCompletedSources` 删除源、`scanWebInputFiles` 扫描 | 已抽取，CLI/GUI 共用 |
| `lib/ffmpeg_scan.js` | 输入文件递归扫描与过滤 | 已抽取 |
| `lib/ffmpeg_options.js` | `normalizeWebOptions` 规范化 GUI 参数、`OPTION_KEYS` 白名单、参数校验 | **UI 全部微调参数均已覆盖** |
| `lib/ffmpeg_plan_snapshot.js` | 内部计划 → 安全公开快照（剥离 preset 实例/argv/临时路径） | |
| `lib/mediainfo.js` | ffprobe 媒体信息（分辨率/帧率/编码/时长/码率） | |
| `lib/ffmpeg_run.js` | 单文件执行、进度解析、日志回调、AbortSignal | `onProgress({percent, speed, currentTime, srcDuration, entry})` |
| `lib/ffmpeg_bin.js` | ffmpeg/ffprobe 二进制定位（`FFMPEG_PATH` → `FFMPEG_BINARY` → `PATH`） | |
| `lib/hwdetect.js` | GPU/编码器/硬件分层探测 | `caps.gpus[{vendor, model, generation}]`、`caps.vendor` |
| `lib/ffmpeg_presets.js` / `presets/default.yaml` | 预设加载与内存模型 | 公开预设 29 个，`_base_*` 内部继承不暴露（`preset_loader.js:254`） |
| `lib/ffmpeg_events.js` | 引擎事件协议（type 常量 + 单调 seq + runId） | 事件可直接透传渲染进程 |

### 1.2 已存在但需修改

| 文件 | 问题 | 处理（见 §） |
| :--- | :--- | :--- |
| `src/main/ffmpeg-service.ts` | 执行并发硬编码 `concurrency: 1`；事件不经节流直发渲染进程；无 `STOPPING` 状态；`hardware.gpus` 类型为 `unknown[]` | §6.3、§8.2、§6.1、§5.2 |
| `src/shared/contracts.ts` | 缺 `showInFolder`/`notify`；快照任务缺源媒体信息字段 | §5 |
| `src/renderer/src/App.vue` | 单文件手写 CSS，无组件/状态管理 | §7 拆分为组件 + Pinia + Naive UI |

### 1.3 需新增

- 主进程 `src/main/native.ts`：任务栏进度、防休眠、系统通知、资源管理器定位。
- 渲染进程 `src/renderer/src/stores/`（runner、settings）与 `components/`（6 个组件）。

---

## 2. 总体架构（目标态）

```
┌─ main 进程（Node，复用 lib/* 100%）─────────────────────────────┐
│  index.ts        窗口生命周期 / 安全 IPC（handleTrusted）/ 错误兜底 │
│  ffmpeg-service  引擎封装：plan/执行/停止/快照/事件源（含节流）     │
│  native.ts       任务栏进度 / 防休眠 / 通知 / showItemInFolder     │
│  ipc-serializer  结构化克隆安全序列化（已有，保持）                │
└────────────────────────────┬────────────────────────────────────┘
                             │ invoke（请求-响应）
                             │ send  EXECUTION_EVENT（单向事件流，100ms 节流）
┌─ preload（contextBridge，sandbox+contextIsolation 保持）─────────┐
│  window.api（DesktopApi 实现 + webUtils.getPathForFile）          │
└────────────────────────────┬────────────────────────────────────┘
┌─ renderer（Vue 3 + Naive UI + Pinia）────────────────────────────┐
│  App.vue ─ 组装 6 组件；stores/runner.ts（任务/计划/运行态/日志）  │
│  stores/settings.ts（useLocalStorage 持久化偏好）                 │
└──────────────────────────────────────────────────────────────────┘
```

**数据流铁律**：
- 渲染进程只通过 `window.api` 与主进程通信，禁止 `nodeIntegration`、禁止直接操作文件系统。
- 主进程事件统一走 `EXECUTION_EVENT` 通道，渲染进程只消费 `ffmpeg_events.js` 定义的类型白名单。
- 计划推演、参数校验、并发、重试、删除源等全部逻辑在 lib 层，GUI 不复制、不 bypass。

---

## 3. 技术选型（最终）与差异说明

### 3.1 预设清单（修正 UI-DESIGN 的错误名单）

`presets/default.yaml` 实际公开预设 **29 个**（`_base_*` 为内部继承层，不暴露）：

| 分组 | 预设 |
| :--- | :--- |
| HEVC | `hevc_4kh`、`hevc_4k`、`hevc_4kl`、`hevc_2kh`、`hevc_2k`、`hevc_2kl`、`hevc_2kt` |
| AVC/H.264 | `h264_2kh`、`h264_2k`、`h264_2kl`、`h264_4kh`、`h264_4k`、`h264_4kl` |
| AV1 | `av1_2kh`、`av1_2k`、`av1_2kl`、`av1_2kt`、`av1_720p`、`av1_4kh`、`av1_4k`、`av1_4kl` |
| VP9 | `vp9_2k`、`vp9_4k` |
| 音频 | `audio_extract`、`aac_high`、`aac_medium`、`aac_low`、`aac_he`、`aac_voice` |

> **UI 要求**：预设下拉/分组必须由 `getEnvironment().presets` **动态渲染**（按 `type`、`videoCodecFamily` 分组），**禁止在代码或文档中写死预设名**——预设增删只改 `presets/default.yaml`，GUI 自动跟随。

### 3.2 组件与技术栈

| 领域 | 选型 | 取代 | 理由 |
| :--- | :--- | :--- | :--- |
| UI 组件 | `naive-ui`（`darkTheme`、`size="small"`） | 现状手写 CSS；GUI-PLAN 的 tailwind + radix-vue | 开箱 `NDataTable`（含**虚拟滚动**）、`NSlider`、`NProgress`、`NSelect`、`NDialog`、`NCollapse`、`NTag`、`NRadioGroup`，正是高密度桌面工具所需；无需手写表格/弹窗交互 |
| 状态管理 | `pinia` | UI-DESIGN 的"事件总线"设想 | 任务队列 + 计划 + 运行态 + 日志流，需要可调试的单向 store；事件总线在此规模后期必乱 |
| 工具库 | `@vueuse/core`（`useLocalStorage` 记忆偏好） | UI-DESIGN 同款（保留）；electron-store 不再需要 | 渲染进程偏好持久化足够 |
| 图标 | `@vicons/ionicons5` | lucide-vue-next | Naive UI 官方推荐，按需 import |
| 并发池 | engine 内置 `p-map`（lib 已有依赖） | GUI-PLAN 的 `p-limit` | 不新增依赖 |
| 大列表 | `NDataTable` `virtual-scroll` | `@tanstack/vue-virtual` | 组件自带，无需额外库 |
| 进度节流 | 主进程 100ms 节流后 `send` | `throttle-debounce` / renderer 节流 | 从源头减少 IPC 量，渲染进程无需再节流 |

---

## 4. 目录规划（目标态）

```
apps/mediac-desktop/
├── src/
│   ├── main/
│   │   ├── index.ts            # [修改] 窗口/生命周期/安全IPC/错误兜底（保持）
│   │   ├── ffmpeg-service.ts   # [修改] 并发策略/事件节流/STOPPING
│   │   ├── native.ts           # [新增] 任务栏进度/防休眠/通知/showItemInFolder
│   │   └── ipc-serializer.ts   # [保持]
│   ├── preload/
│   │   ├── index.ts            # [修改] 增补 API 转发
│   │   └── index.d.ts          # [修改] 渲染进程 Window.api 强类型
│   ├── shared/
│   │   ├── contracts.ts        # [修改] 见 §5
│   │   └── ipc-channels.ts     # [修改] 新增 show-in-folder / notify 通道
│   └── renderer/src/
│       ├── main.ts             # [修改] 挂载 Naive UI darkTheme
│       ├── App.vue             # [重写] 组装布局
│       ├── stores/
│       │   ├── runner.ts       # [新增] 计划/任务/运行态/事件订阅
│       │   └── settings.ts     # [新增] useLocalStorage 偏好
│       └── components/
│           ├── HeaderBar.vue
│           ├── InputOutputCard.vue
│           ├── PresetConfigCard.vue
│           ├── TaskTable.vue
│           ├── ExecutionBoard.vue
│           └── LogTerminal.vue
└── electron.vite.config.ts / electron-builder.yml  # [保持]
```

---

## 5. IPC 契约（contracts.ts 增补）

### 5.1 现有 API 全部保留

`DesktopApi`（`getPathForFile` / `selectFiles` / `getAppVersion` / `getEnvironment` / `createPlan` / `startExecution` / `stopExecution` / `getTaskSnapshot` / `onEngineEvent`）**一个都不改名、不删除**，避免破坏已有调用与打包产物。

### 5.2 增补内容

```typescript
// 新增系统能力
showInFolder: (fullPath: string) => Promise<void>
notify: (title: string, body: string) => Promise<void>

// EnvironmentSummary 修正：gpus 类型化 + 主加速器 tier
interface EnvironmentSummary {
  // ...现有字段不变
  hardware: {
    gpus: Array<{ vendor: string; model: string; generation?: string }>
    encoders: string[]
    hwaccels: string[]
    tier: "nvidia" | "intel" | "amd" | "cpu"   // 由 hwdetect caps.vendor 派生
  }
}

// PublicPlanSnapshot.tasks 增补源媒体信息（支撑表格 "H.264 / 1080p / 24fps / 450MB" 子行）
// 数据来源：task.info 已有，快照投影时补充暴露
interface PlanTask {
  // ...现有字段不变
  videoCodec?: string   // 如 "h264"
  width?: number
  height?: number
  fps?: number
}
```

> 实现注意：`hwdetect.js` 已返回 `caps.gpus[{vendor, model, generation}]` 与 `caps.vendor`，`ffmpeg-service.getSummary` 只需映射即可，无需重新探测。`getEnvironment()` 在 `createPlan` 时已隐式调用，GPU 徽章无额外开销。

### 5.3 事件协议（渲染进程只读白名单）

`ffmpeg_events.js` 的 type 原样透传，渲染进程按白名单消费：

| 事件 | payload 要点 | 用途 |
| :--- | :--- | :--- |
| `task.started` | taskId, taskIndex, total | 状态胶囊 → 转码中 |
| `task.progress` | taskId, percent, speed, currentTime, srcDuration | 倍速/FPS/ETA/双进度条 |
| `task.log` | taskId, message | 日志终端 |
| `task.attempt.done` / `task.attempt.started` | attempt | 重试可视化（可选） |
| `task.done` | taskId, result, failed? | 完成/失败 |
| `task.skipped` | taskId, result.reason | 已跳过 + 原因 |
| `task.cancelled` | taskId | 终止 |
| `session.summary` | summary{success, failed, skipped, cancelled, isCancelled} | 总览 + 通知 + 任务栏进度清除 |
| `process.spawn` / `process.exit` | pid, taskId（service 自定义） | PID 追踪日志（调试） |

---

## 6. 状态机与执行流（修正版）

### 6.1 状态机

```
IDLE → PLANNING → READY → RUNNING → STOPPING → STOPPED → READY(保留未完成项)
                              │
                              ├→ COMPLETED → IDLE（重置）
                              └→ FAILED（引擎致命异常）
```

- 现状 `stopExecution` 直接置 `STOPPED`（`ffmpeg-service.ts:291-296`）。**修正**：先置 `STOPPING` 并发事件，`abort()` + `taskkill` 完成、`onSummary` 回调后再置 `STOPPED`。渲染进程终止按钮在 `STOPPING` 期间禁用。
- `COMPLETED` 判定沿用现有 `onSummary` 逻辑（`summary.isCancelled ? STOPPED : COMPLETED`）。

### 6.2 终止清理（现有实现，保持）

1. `AbortController.abort()` 传递取消信号；
2. Windows 平台 `taskkill /PID <pid> /T /F` 强杀进程树（`killTrackedProcesses`，防 NVENC 被僵尸进程占用）；
3. 启动时 `recoverStaleTasks` 清理上次残留 `_tmp@*@tmp_` 临时产物（`isManagedTempPath`）。

### 6.3 并发策略（对齐 CLI，修正硬编码 1）

- 策略与 `cmd_ffmpeg.js:642` 一致：**视频串行（`concurrency = 1`）、音频类并行（`concurrency = min(jobs, 4)`）**。
- `ffmpeg-service.startExecution` 由硬编码 `concurrency: 1` 改为按 `currentPlan` 的任务类型计算后传入 `engine.execute`。
- UI 的"并发任务数"输入框（1~4）仅对音频任务生效，界面加说明文案（"视频任务始终串行执行"），避免用户误解死选项。

### 6.4 重试策略

- `engine.execute` 默认 `maxAttempts = 1`（不重试）。GUI 传入 `maxAttempts: 2`（非 strict），与 CLI 行为对齐（`cmd_ffmpeg.js:671`：strict 时 1 次，非 strict 自动重试 1 次）。
- **单项手动重试无需新 IPC**：`startExecution(taskIds)` 已支持按 id 执行，engine 会对 failed 任务重新 `runTask`。TaskTable 的"重试"按钮 = `runner.retry(taskId)` → `startExecution([taskId])`。

---

## 7. UI 布局与组件规格

布局采纳 UI-DESIGN 的双栏工作台：左栏固定 380px（参数与预设），右栏弹性（任务表格 + 命令预览 + 执行看板），底部折叠日志（160px ~ 320px）。窗口 `1280x820` / 最小 `960x640`（与 `main/index.ts` 现状一致）。

### 7.1 HeaderBar.vue

版本号、FFmpeg/FFprobe 状态（缺失红标 + 配置提示）、GPU 徽章（`hardware.gpus[0].vendor + model` + `tier` 派生 "NVENC/CUDA"/"QSV"/"CPU Mode"）、运行状态胶囊（六态，含 STOPPING）。

### 7.2 InputOutputCard.vue

- 拖拽投放区：`@drop` → `window.api.getPathForFile(file)`（preload 已暴露 `webUtils.getPathForFile`，物理路径毫秒级）。
- 【添加文件】【添加目录】→ `selectFiles({mode})`（主进程 `dialog.showOpenDialog`）。
- 文件清单：数量/总体积、单项删除、清空。
- 输出目录 + 输出模式 `NRadioGroup`：**文案以 `ffmpeg_task.js:147-162` 实行为准**：
  - `tree`：完整保持原目录层级树；
  - `dir`：仅保留源文件父目录名一层（`{输出目录}/{父目录名}`）；
  - `file`：全部扁平写入输出目录。

### 7.3 PresetConfigCard.vue

- 预设 `NSelect`：**动态分组**（见 §3.1），切换时展示预设特性徽章（`videoCodecFamily / videoQuality / videoBitrate / audioCodec / audioBitrate / dimension`，全部来自 `EnvironmentSummary.presets`）。
- 视频微调：长边 `dimension`、质量 `videoQuality`（CRF/CQ）、码率 `videoBitrate`、帧率 `framerate`、变速 `speed`。
- 音频微调：`audioCodec`（copy/aac/libopus/mp3/flac）、`audioBitrate`。
- 高级开关：`override`、`strict`、`deleteSourceFiles`（红色高危标识）、`jobs`。
- **参数名一律使用 `OPTION_KEYS` 白名单**（`ffmpeg_options.js:5-44`），经 `normalizeWebOptions` 传入 `createPlan`，服务端校验兜底（`ffmpeg-options` 校验 speed 0.5~2.0、jobs>0、dimension>=0 等）。

### 7.4 TaskTable.vue

- `NDataTable` + `virtual-scroll`（拖入数百文件不卡顿）。
- 列：多选框（默认全选）/ 序号 / 源文件（主文字文件名 + 子行 `videoCodec/width/height/fps` + 大小，见 §5.2）/ 时长 / 目标产物 / 状态胶囊 / 操作（定位 `showInFolder`、移除、重试）。
- 状态映射：`pending`→待处理、`running`→转码中（loading）、`done`→已完成、`skipped`→已跳过（悬浮显示 `skipReason`）、`failed`→失败（悬浮显示 error）、`cancelled`→已取消。

### 7.5 ExecutionBoard.vue

- 【开始转码】执行全部或选中项（`startExecution(selectedIds)`）；【终止】`stopExecution()`，仅 RUNNING/STOPPING 可用。
- 指标卡：倍速 `speed`、FPS（由 progress 推算）、已用/剩余（`currentTime/srcDuration` 反推 ETA）。
- 双进度条：总体（completed/total）、当前文件（`percent`）。

### 7.6 LogTerminal.vue

- 折叠（160~320px）、等级过滤、关键字过滤、自动滚屏（上滚解除吸底）、清屏、复制。
- 着色沿用 UI-DESIGN：INFO 淡青 / CMD 浅绿 / WARN 亮黄 / ERROR 珊瑚红；等宽字体。

---

## 8. 关键实现要点

### 8.1 拖拽物理路径
已具备（preload `getPathForFile`）。渲染进程 `handleDrop` 直接调用，无需 PowerShell 中转。

### 8.2 进度事件节流（主进程）
`ffmpeg_run` 的 `onProgress` **无内置节流**（每个 `out_time` 直发）。当前 service 又原样 `send` 给渲染进程。**修正**：在 `ffmpeg-service` 的事件出口按 `task.progress` 做 100ms 节流（取最新值），其余事件类型直发。渲染进程消费即可，无需再节流。

### 8.3 任务栏进度
`native.ts` 订阅事件：`task.progress` → `mainWindow.setProgressBar(percent / 100)`（0~1）；`session.summary` → 失败用 `setProgressBar(1, { mode: "error" })`，正常/清除用 `setProgressBar(-1)`。

### 8.4 防休眠
`RUNNING` 起调用 `powerSaveBlocker.start("prevent-app-suspension")`，进入 `STOPPED / COMPLETED / FAILED` 时 `stop()` 释放。长时间批量转码防止系统睡眠。

### 8.5 系统通知
`session.summary` → `new Notification({ title, body })`（成功/失败计数），点击 `show()` + `focus()` 窗口。

### 8.6 资源管理器定位
新增 IPC `showInFolder` → 主进程 `shell.showItemInFolder(fullPath)`。

### 8.7 删除源文件（文案修正 + 流程保持）
**事实**：`helper.safeRemove` 将源文件移动到工具自身的安全回收目录 `~/.mediac/deleted/YYYYMMDD/`（`helper.js:616-659`），**不是系统回收站**。
- UI 确认弹窗文案按真实行为写：
  > "转码成功且产物校验通过后，源文件将被移入 Mediac 安全回收目录（`~/.mediac/deleted/日期`）。请确认是否继续？"
- 流程保持现有实现：勾选 + Naive UI `NDialog` 确认 → `createPlan` 传 `deleteSourceFiles: true, deleteSourceConfirmed: true` → 服务端在 `session.summary` 后调 `deleteCompletedSources(confirmDeleteSource)`（`ffmpeg-service.ts:263-276`）。

### 8.8 GPU 徽章与错误兜底
GPU 徽章数据见 §5.2；`dialog.showErrorBox` 启动兜底已存在（`index.ts:138`），渲染进程保留错误横幅。

---

## 9. 分阶段实施与验收

> 每阶段完成后运行对应验收命令；涉及 `lib/` 时补 `npm test`（CLI 回归，确保 GUI 改造不漂移 CLI 行为）。

| 阶段 | 内容 | 验收 |
| :--- | :--- | :--- |
| **P0 基础** | `npm i naive-ui @vueuse/core pinia` + `npm i -D @vicons/ionicons5`；`main.ts` 挂载 `darkTheme`；`App.vue` 换成 Naive UI 布局骨架 | `npm run typecheck` 零错误 |
| **P1 契约与主进程** | contracts/ipc-channels 增补（§5）；`ffmpeg-service` 并发策略（§6.3）、进度节流（§8.2）、STOPPING（§6.1）；新增 `native.ts`（§8.3-8.6） | 手动转码：事件流节流生效、任务栏进度联动、终止可清理 |
| **P2 组件与 store** | 拆 6 组件 + `stores/runner.ts` + `stores/settings.ts`；预设动态分组（§3.1）；TaskTable 虚拟滚动 | 拖入含 200 个视频的目录，计划生成秒级、滚动不卡顿 |
| **P3 打磨与打包** | 通知/定位/防休眠联调；删除源弹窗文案（§8.7）；窗口尺寸记忆 | `npm run build` + `npm run package:win` 产出 portable + NSIS；`npm test` 通过 |

**总工时预估：3 ~ 4 个工作日**（不含外部依赖下载/安装）。

---

## 10. 维护指南

1. **预设增删**：只改 `presets/default.yaml`，GUI 动态分组自动跟随；验证 `node index.js ffmpeg --show-presets`。
2. **新增 IPC**：`ipc-channels.ts` → `contracts.ts` → `preload/index.ts`（+`index.d.ts`）→ `main/index.ts` `handleTrusted` 四步，类型必须贯穿全链路；保持 `isTrustedSender` 与 `toSerializable` 约束。
3. **编码/滤镜参数改动**：遵循 AGENTS.md，先真机 `ffmpeg -h encoder=X` 与 1 帧 `-f null -` 核验，禁止凭文档臆造调优项。
4. **回归命令**：`npm run typecheck`（TS）、`npm run build`（打包前）、涉及 lib 改动 `npm test` + `npm run check` + `npm run lint`。
5. **升级 Electron**：保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，升级前回归 IPC 全链路。
