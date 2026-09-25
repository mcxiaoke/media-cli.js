# MediaCli FFmpeg 桌面端（Electron）最终架构与实施方案

> **文档版本**：v1.2.0（自动化测试与架构审校版）
> **创建日期**：2026-09-24（v1.0.0）
> **修订日期**：2026-09-24（v1.2.0）
> **状态**：实施就绪
> **适用范围**：`apps/mediac-desktop`
> **取代关系**：本文档取代 `docs/FFMPEG-ELECTRON-GUI-PLAN-20260924.md`（架构与选型部分）、`docs/FFMPEG-ELECTRON-UI-DESIGN-20260924.md`（全部）及本文件 v1.0.0/v1.1.0。
> **基本原则**：以仓库代码现状为唯一事实源；不重写主进程与共享编排层；UI 层组件化；**v1 做减法**——砍掉删除源、并发控制、自动重试、FPS 指标、单实例锁、事件白名单、计划修订校验等暂不需要的能力，把核心链路（导入→计划→预览→执行→监控→日志→定位）做扎实；补齐 Playwright E2E 自动化测试防护网。

---

## 0. 修订记录

### 0.1 v1.1.0 → v1.2.0（Playwright 测试规范与架构风险甄别）
依据 E2E 测试参考项目 `C:\Home\Projects\mytools\tools\filelist\tests\e2e` 与实机架构审查补充：
1. **测试体系增补**：新增第 10 节《前端自动化测试规范（基于 Playwright）》，详述 `_electron.launch()` 夹具、测试沙箱隔离、核心用例套件与 CI 运行规范；
2. **UI 规格纠偏**：对齐最新高保真原型（`mediac-desktop-ui.html` v0.3.0）与 UI/UX 规范（`FFMPEG-ELECTRON-UI-UX-DESIGN-FINAL-20260924.md` v1.3.0），淘汰底部常驻命令框，采用右侧滑出式 `TaskInspectorDrawer` 与平滑 `STALE` 状态机；
3. **架构隐患附注**：新增第 12 节，揭示 4 项潜在重大工程缺陷（打包外置依赖闪退、taskkill 同步退出异常中断孤儿进程、UI 布局退化风险、大规模任务 IPC 内存压力）并给出确切整改方案。

### 0.2 v1.0.0 → v1.1.0（瘦身减法修订）
依据 `docs/FFMPEG-ELECTRON-ARCHITECTURE-REVIEW-20260924-174303.md` 甄别后调整：

| 决策 | 原方案 | 本次调整 | 理由 |
| :--- | :--- | :--- | :--- |
| 删除源文件 | UI 暴露 + ffprobe 验证 | **v1 不在 UI 暴露**，CLI 保留 | 产物弱校验是 CLI 既有行为；砍掉即消除 2.3/3.2 整类风险，不增加验证代码 |
| 并发控制 | jobs 1~4 | **v1 固定 concurrency=1**，无 jobs UI | 视频本就串行；避免与 CLI/engine 语义拉扯 |
| 自动重试 | maxAttempts=2 + CPU fallback | **v1 不做自动重试**，手动"重试"= `startExecution([id])` | 省略 shouldRetry/confirmRetry/prepareAttempt 三件套 |
| FPS 指标 | 推算 FPS | **砍掉**，只留倍速/进度/ETA | progress 无 frame 数据（`ffmpeg_run.js:650-669`），硬做要改解析 |
| 计划修订校验 | planId + configRevision | **READY 后平滑转 STALE 提醒更新**，纯 renderer | 本地单窗，主进程校验是防御性投入；平滑降级不打断心流 |
| 事件白名单 | 主进程白名单 | **renderer 按 type 忽略未知** | 砍掉主进程过滤代码 |
| runId/seq | 唯一 runId + 事件清洗 | **新执行开始时 renderer 清空会话状态** | 事件实时直发，无并发会话 |
| STOPPING 竞态 | execution token | **start 守卫加 PLANNING/STOPPING**（1 行） | 守卫已杜绝并发执行 |
| 退出清理 | 等待 summary 的优雅退出 | **dispose 同步 taskkill**（需包裹 try-catch） | 不引入退出状态机 |
| 单实例锁 | requestSingleInstanceLock + manifest 强化 | **v1 不做**，记入已知限制 | 本地工具多实例场景低频 |

其余安全/防御类建议（主进程最终校验、token、事件 seq）一律降级搁置。

---

## 1. 代码现状盘点（以仓库实况为准）

### 1.1 直接复用、零修改（共享编排层与引擎）

| 模块 | 职责 | 备注 |
| :--- | :--- | :--- |
| `lib/ffmpeg_engine.js` | 任务队列、并发（内置 p-map）、取消、结果归一、事件协议 | `execute(plan, {mode, signal, concurrency, onTask*})`；transport-agnostic |
| `lib/ffmpeg_planner.js` | `prepareFFmpegPlan` 计划推演、`deleteCompletedSources`（CLI 用） | 已抽取，CLI/GUI 共用 |
| `lib/ffmpeg_scan.js` | `scanWebInputFiles` 输入文件递归扫描与过滤 | 已抽取（**注意：不属 planner**） |
| `lib/ffmpeg_options.js` | `normalizeWebOptions` 规范化 GUI 参数、`OPTION_KEYS` 白名单、参数校验 | UI 微调参数均已覆盖；speed 合法值含 `0`（不变速）与 `0.5~2.0` |
| `lib/ffmpeg_plan_snapshot.js` | 内部计划 → 安全公开快照 | |
| `lib/mediainfo.js` | ffprobe 媒体信息（分辨率/帧率/编码/时长/码率） | |
| `lib/ffmpeg_run.js` | 单文件执行、进度解析、日志回调、AbortSignal | `onProgress({percent, speed, currentTime, srcDuration, entry})` |
| `lib/ffmpeg_bin.js` | 二进制定位 | ffmpeg：`FFMPEG_PATH`→`FFMPEG_BINARY`→`PATH`；ffprobe 另支持 `FFPROBE_PATH`→`FFPROBE_BINARY`→ffmpeg 同目录→`PATH` |
| `lib/hwdetect.js` | GPU/编码器/硬件分层探测 | `caps.gpus[{vendor, model, generation}]`、`caps.vendor`（fallback 为 `"any"`） |
| `lib/ffmpeg_presets.js` / `presets/default.yaml` | 预设加载与内存模型 | 公开预设 29 个，`_base_*` 不暴露 |
| `lib/ffmpeg_events.js` | 引擎事件协议（type 常量 + seq + runId） | |

### 1.2 已存在但需修改

| 文件 | 问题 | 处理 |
| :--- | :--- | :--- |
| `src/main/ffmpeg-service.ts` | 空数组被当作执行全部；任务对象复用有 `ok` 残留风险；start 守卫只挡 RUNNING；dispose 异步不等待；`hardware.gpus` 为 `unknown[]` | §5、§6、§8 |
| `src/shared/contracts.ts` | 缺 `showInFolder`/`notify`；快照任务缺源媒体信息 | §5 |
| `src/renderer/src/App.vue` | 单文件手写 CSS，无组件/状态管理 | §7 拆分 |

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
┌─ preload（contextBridge，sandbox + contextIsolation 保持）───────┐
│  window.api（DesktopApi 实现 + webUtils.getPathForFile）          │
└────────────────────────────┬────────────────────────────────────┘
┌─ renderer（Vue 3 + Naive UI + Pinia）────────────────────────────┐
│  App.vue ─ 组装 6 组件；stores/runner.ts（任务/计划/运行态/日志）  │
│  stores/settings.ts（useLocalStorage 持久化偏好）                 │
└──────────────────────────────────────────────────────────────────┘
```

**数据流铁律**：
- 渲染进程只通过 `window.api` 与主进程通信，禁止 `nodeIntegration`、禁止直接操作文件系统。
- 主进程事件统一走 `EXECUTION_EVENT` 通道；渲染进程按 type 消费已知类型、忽略未知类型（不做主进程白名单）。
- 计划推演、参数校验、并发、结果判定等逻辑全在 lib 层，GUI 不复制、不 bypass。

---

## 3. 技术选型（最终）

### 3.1 预设清单（动态渲染，禁止写死）

`presets/default.yaml` 实际公开预设 **29 个**（`_base_*` 为内部继承层，不暴露）：

| 分组 | 预设 |
| :--- | :--- |
| HEVC | `hevc_4kh` `hevc_4k` `hevc_4kl` `hevc_2kh` `hevc_2k` `hevc_2kl` `hevc_2kt` |
| AVC/H.264 | `h264_2kh` `h264_2k` `h264_2kl` `h264_4kh` `h264_4k` `h264_4kl` |
| AV1 | `av1_2kh` `av1_2k` `av1_2kl` `av1_2kt` `av1_720p` `av1_4kh` `av1_4k` `av1_4kl` |
| VP9 | `vp9_2k` `vp9_4k` |
| 音频 | `audio_extract` `aac_high` `aac_medium` `aac_low` `aac_he` `aac_voice` |

> UI 预设下拉/分组由 `getEnvironment().presets` **动态渲染**（按 `type`、`videoCodecFamily` 分组），禁止在代码或文档中写死预设名。

### 3.2 组件与技术栈

| 领域 | 选型 | 理由 |
| :--- | :--- | :--- |
| UI 组件 | `naive-ui`（`darkTheme`、`size="small"`） | 开箱 `NDataTable`（含虚拟滚动）、`NSlider`、`NProgress`、`NSelect`、`NDialog`、`NCollapse`、`NTag`、`NRadioGroup` |
| 状态管理 | `pinia` | 任务队列 + 计划 + 运行态 + 日志，单向可调试 |
| 工具库 | `@vueuse/core`（`useLocalStorage` 记忆偏好） | |
| 图标 | `@vicons/ionicons5` | Naive UI 官方推荐，按需 import |
| 并发 | engine 内置 `p-map`（lib 已有依赖） | v1 固定 `concurrency: 1`，不新增并发依赖 |
| 大列表 | `NDataTable` `virtual-scroll` | 无需额外库 |
| 进度节流 | 主进程 100ms 节流后 `send` | 从源头减少 IPC 量 |

---

## 4. 目录规划（目标态）

```
apps/mediac-desktop/
├── src/
│   ├── main/
│   │   ├── index.ts            # [修改] 窗口/生命周期/安全IPC/错误兜底（保持）
│   │   ├── ffmpeg-service.ts   # [修改] 空选择守卫/任务副本/事件节流/同步退出
│   │   ├── native.ts           # [新增] 任务栏进度/防休眠/通知/showItemInFolder
│   │   └── ipc-serializer.ts   # [保持]
│   ├── preload/
│   │   └── index.ts            # [修改] 增补 API 转发（类型声明沿用 src/env.d.ts）
│   ├── shared/
│   │   ├── contracts.ts        # [修改] 见 §5
│   │   └── ipc-channels.ts     # [修改] 新增 show-in-folder / notify 通道
│   └── renderer/src/
│       ├── main.ts             # [修改] 挂载 Naive UI darkTheme
│       ├── App.vue             # [重写] 组装布局
│       ├── stores/runner.ts    # [新增] 计划/任务/运行态/事件订阅
│       ├── stores/settings.ts  # [新增] useLocalStorage 偏好
│       └── components/         # [新增] 6 个组件（见 §7）
└── electron.vite.config.ts / electron-builder.yml  # [保持]
```

---

## 5. IPC 契约（contracts.ts 增补）

### 5.1 现有 API 全部保留

`DesktopApi` 9 个方法（`getPathForFile` / `selectFiles` / `getAppVersion` / `getEnvironment` / `createPlan` / `startExecution` / `stopExecution` / `getTaskSnapshot` / `onEngineEvent`）**一个都不改名、不删除**。

### 5.2 增补内容

```typescript
// 新增系统能力
showInFolder: (fullPath: string) => Promise<void>
notify: (title: string, body: string) => Promise<void>

// EnvironmentSummary 修正：gpus 类型化 + tier（映射规则见下）
interface EnvironmentSummary {
  // ...现有字段不变
  hardware: {
    gpus: Array<{ vendor: string; model: string; generation?: string }>
    encoders: string[]
    hwaccels: string[]
    tier: "nvidia" | "intel" | "amd" | "cpu"
  }
}

// PublicPlanSnapshot.tasks 增补源媒体信息（支撑表格 "H.264 / 1080p / 24fps / 450MB" 子行）
interface PlanTask {
  // ...现有字段不变
  videoCodec?: string
  width?: number
  height?: number
  fps?: number
}
```

> **tier 映射规则**（`hwdetect.js:301` 的 `vendor` fallback 是 `"any"`，不能直接强转）：
> `nvidia/intel/amd` → 对应厂商；`any`/`other`/未知 → `"cpu"`（显示 "CPU Mode (Software)"）。

---

## 6. 状态机与执行流（v1 修正版）

### 6.1 状态机

```
IDLE → PLANNING → READY → RUNNING → STOPPING → STOPPED → READY（重新开始）
                              │
                              ├→ COMPLETED → IDLE（重置）
                              └→ FAILED（引擎致命异常）
```

- **生命周期守卫（v1 只加 1 行）**：`startExecution` 在 `PLANNING/RUNNING/STOPPING` 期间一律拒绝（现只挡 `RUNNING`，补 `PLANNING/STOPPING`）。单窗本地应用无并发执行，不做 execution token。
- `stopExecution` 行为不变：`abort()` + `taskkill /T /F`，状态由 `onSummary` 回调置为 `STOPPED`/`COMPLETED`。
- **STOPPED 语义**：未完成任务被 engine 标记为 `cancelled`；`STOPPED → READY` 后，用户选中未完成项再点开始（`startExecution(ids)`）即可重跑，无需新增状态或数据恢复逻辑。

### 6.2 空选择语义（修复 2.2）

- **主进程**：`startExecution(taskIds)` —— `taskIds === undefined` 表示"全部"，显式空数组直接抛错"未选择任务"。
- **preload**：不再把 `undefined` 转成 `[]`，原样透传。
- **renderer**：始终显式传选中 id 列表或全部 id；"全部"按钮 = 传全量 id。

### 6.3 执行前任务副本（修复 3.4）

`startExecution` 对选中的任务做浅拷贝并重置运行期字段后交给 engine，杜绝上一轮 `ok/status/ffmpegError` 残留污染本轮结果判定（`ffmpeg_result.js:53-58` 信任 `ok === true`）：

```ts
const clean = (task) => ({
  ...task,
  status: "pending", ok: undefined, ffmpegFailed: undefined,
  ffmpegError: undefined, error: undefined, skipReason: undefined,
})
```

### 6.4 并发与重试（v1 决策）

- **并发**：固定 `concurrency: 1`（视频串行），不提供 jobs UI。音频并行留待 v2（如需，对齐 CLI `cmd_ffmpeg.js:642`：`jobs || (video ? 1 : 4)`）。
- **重试**：无自动重试（不接 `shouldRetry/confirmRetry/prepareAttempt`）。手动"重试"按钮 = `startExecution([taskId])`，engine 会重跑 failed 任务。

---

## 7. UI 布局与组件规格

布局沿用双栏工作台：左栏固定 380px（参数与预设），右栏弹性（任务表格 + 命令预览 + 执行看板），底部折叠日志（160px ~ 320px）。窗口 `1280x820` / 最小 `960x640`（与 `main/index.ts` 现状一致）。

### 7.1 HeaderBar.vue

版本号、FFmpeg/FFprobe 状态（缺失红标 + 配置提示）、GPU 徽章（`gpus[0].vendor + model` + §5.2 tier 派生 "NVENC/CUDA"/"QSV"/"CPU Mode"）、运行状态胶囊。

### 7.2 InputOutputCard.vue

- 拖拽投放区：`@drop` → `window.api.getPathForFile(file)`（物理路径毫秒级）。
- 【添加文件】【添加目录】→ `selectFiles({mode})`。
- 文件清单：数量/总体积、单项删除、清空。
- 输出目录 + 输出模式 `NRadioGroup`，文案以 `ffmpeg_task.js:146-162` 实行为准：
  - `tree`：完整保持原目录层级树；
  - `dir`：仅保留源文件父目录名一层（`{输出目录}/{父目录名}`）；
  - `file`：全部扁平写入输出目录。
- **READY 后冻结**：生成计划后禁用输入/输出/预设/微调等影响计划的控件，提供【重新分析】按钮（防 2.1 旧计划执行）。

### 7.3 PresetConfigCard.vue

- 预设 `NSelect`：动态分组（§3.1），切换展示特性徽章（`videoCodecFamily/videoQuality/videoBitrate/audioCodec/audioBitrate/dimension`）。
- 视频微调：长边 `dimension`、质量 `videoQuality`、码率 `videoBitrate`、帧率 `framerate`、变速 `speed`。
- 音频微调：`audioCodec`（copy/aac/libopus/mp3/flac）、`audioBitrate`。
- 高级开关：`override`、`strict`（**v1 无删除源、无 jobs**）。
- 参数名一律使用 `OPTION_KEYS` 白名单（`ffmpeg_options.js:5-44`），服务端校验兜底（speed 含 `0` 合法、jobs>0、dimension>=0）。

### 7.4 TaskTable.vue

- `NDataTable` + `virtual-scroll`。
- 列：多选框（默认全选）/ 序号 / 源文件（主文字 + 子行 `videoCodec/width/height/fps` + 大小）/ 时长 / 目标产物 / 状态胶囊 / 操作（定位 `showInFolder`、移除、重试）。
- 状态映射：`pending`→待处理、`running`→转码中、`done`→已完成、`skipped`→已跳过（悬浮显示原因）、`failed`→失败（悬浮显示 error）、`cancelled`→已取消。

### 7.5 ExecutionBoard.vue

- 【开始转码】执行全部或选中项；【终止】仅 RUNNING/STOPPING 可用。
- 指标卡：**倍速**（`speed`）、**已用/剩余**（`currentTime/srcDuration` 反推 ETA）。不显示 FPS（无数据依据）。
- 双进度条：总体（completed/total）、当前文件（`percent`）。

### 7.6 LogTerminal.vue

折叠（160~320px）、等级过滤、关键字过滤、自动滚屏（上滚解除吸底）、清屏、复制。着色：INFO 淡青 / CMD 浅绿 / WARN 亮黄 / ERROR 珊瑚红；等宽字体。

---

## 8. 关键实现要点

### 8.1 拖拽物理路径
已具备（preload `getPathForFile`），渲染进程直接调用。

### 8.2 进度事件节流（主进程）
`ffmpeg_run` 的 `onProgress` 无内置节流（每个 `out_time` 直发，`ffmpeg_run.js:662-669`）。在 `ffmpeg-service` 事件出口对 `task.progress` 做 100ms 节流（取最新值），其余类型直发。

### 8.3 任务栏进度
`native.ts`：`task.progress` → `setProgressBar(percent / 100)`；`session.summary` → 失败 `setProgressBar(1, { mode: "error" })`，完成清除 `setProgressBar(-1)`。

### 8.4 防休眠
`RUNNING` 起 `powerSaveBlocker.start("prevent-app-suspension")`，终态 `stop()` 释放。

### 8.5 系统通知
`session.summary` → `new Notification({ title, body })`（成功/失败计数），点击 `focus()` 窗口。

### 8.6 资源管理器定位
新增 IPC `showInFolder` → 主进程 `shell.showItemInFolder(fullPath)`。

### 8.7 命令预览（P0 实现项）
当前 `previewCmd` 恒为空串（`prepareFFmpegPlan` 默认值，service 未传）。**实现**：`createPlan` 后为首个任务拼装展示命令（复用 `lib/ffmpeg_build.js` 命令拼装），填充快照 `previewCmd`。

### 8.8 退出清理（简化）
`before-quit` → `dispose()` 改为**同步**：对 `activePids` 逐个 `execFileSync("taskkill", ["/PID", pid, "/T", "/F"])`，再同步清理 manifest。不等待 engine summary（engine 随主进程退出即终止），不引入退出状态机。

### 8.9 GPU 徽章与错误兜底
数据见 §5.2 tier 映射；`dialog.showErrorBox` 启动兜底已存在（`index.ts:138`）。

---

## 9. 分阶段实施与验收

| 阶段 | 内容 | 验收 |
| :--- | :--- | :--- |
| **P0 基础** | `npm i naive-ui @vueuse/core pinia` + `npm i -D @vicons/ionicons5`；`main.ts` 挂 `darkTheme`；App.vue 换 Naive UI 布局骨架 | `npm --prefix apps/mediac-desktop run typecheck` 零错误 |
| **P1 契约与主进程** | contracts/ipc-channels 增补（§5）；service：空选择守卫、任务副本、PLANNING/STOPPING 守卫、进度节流、同步退出、previewCmd 生成；新增 `native.ts` | 手动转码：事件节流、任务栏进度、终止清理、命令预览非空 |
| **P2 组件与 store** | 拆 6 组件 + `stores/runner.ts`/`stores/settings.ts`；预设动态分组；READY 冻结 + 重新分析；TaskTable 虚拟滚动 | 拖入 200 个视频目录，计划秒级、滚动不卡顿 |
| **P3 打包与回归** | 通知/定位/防休眠联调；窗口尺寸记忆 | `npm --prefix apps/mediac-desktop run build` + `package:win`；涉及 lib 时根目录 `npm test` |

> **命令注意**：桌面端命令在 `apps/mediac-desktop` 内执行（`typecheck`/`build`/`package:win`），根目录命令（`test`/`check`/`lint`）在仓库根执行；文档统一写 `npm --prefix apps/mediac-desktop run ...` 以免混淆。

**总工时预估：3 ~ 4 个工作日**。

---

## 10. 前端自动化测试规范（基于 Playwright）

参考仓库成熟实践 `C:\Home\Projects\mytools\tools\filelist\tests\e2e`，为 Electron 客户端建立端到端自动化测试防护网。由于 Electron 具有独立的主进程与渲染进程，测试方案选用 Playwright 原生的 `_electron.launch()` 驱动机制，直接挂载真实 Electron 窗口并验证端到端业务闭环。

### 10.1 目录结构与套件规划

在 `apps/mediac-desktop` 建立专门的端到端测试套件：

```
apps/mediac-desktop/tests/e2e/
├── playwright.config.ts        # 全局配置（超时、报告器、Trace 录制、失败自动截图）
├── fixtures.ts                 # 核心夹具（管理 Electron 启动、临时测试沙箱隔离、窗口句柄绑定）
├── helpers/
│   └── test-media.ts           # 虚拟/微型测试音视频素材生成器（免外部下载）
└── specs/
    ├── 01-launch-and-env.spec.ts     # 启动空态、Hero 引导画板、硬件探测标签有效性验证
    ├── 02-drag-and-plan.spec.ts      # 全域文件/目录拖拽、生成计划、TaskTable 表格多选
    ├── 03-tuning-and-stale.spec.ts   # 参数微调（CRF/分辨率）、脏状态（Dirty State）感知、一键撤销与 STALE 状态机
    ├── 04-task-inspector.spec.ts     # 双击任务、TaskInspector 抽屉滑出、媒体规格对比、命令高亮与复制
    └── 05-execution-and-logs.spec.ts # 执行转码、进度看板联动、停止信号、失败任务一键聚焦日志
```

### 10.2 核心配置与 Fixture 落地

#### ① Playwright 配置 (`playwright.config.ts`)
```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  timeout: 45000,
  expect: { timeout: 6000 },
  fullyParallel: false, // 桌面单实例串行测试，避免 GPU 硬件加速与本地端口竞争
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: '../../temp/e2e-report' }]
  ],
  use: {
    actionTimeout: 10000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
});
```

#### ② 专属 Electron 测试夹具 (`fixtures.ts`)
对齐 `filelist/tests/e2e/fixtures.js` 的 `base.extend` 范式，通过环境变量跳过弹窗并提供隔离目录：
```typescript
import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';

interface DesktopFixtures {
  electronApp: ElectronApplication;
  appPage: Page;
  scratchDir: string;
}

export const test = base.extend<DesktopFixtures>({
  // 隔离的临时工作目录夹具
  scratchDir: async ({}, use) => {
    const dir = path.join(__dirname, '../../temp/e2e-scratch', `worker-${process.pid}`);
    fs.mkdirSync(dir, { recursive: true });
    await use(dir);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  },

  // Electron 实例生命周期管理
  electronApp: async ({}, use) => {
    const mainJs = path.join(__dirname, '../../out/main/index.js');
    const app = await electron.launch({
      args: [mainJs],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        MEDIAC_TEST_MODE: '1',
        MEDIAC_AUTO_CONFIRM: '1' // 自动化测试跳过模态系统弹窗
      }
    });
    await use(app);
    await app.close();
  },

  // 绑定首个渲染进程窗口并等待 Vue 挂载
  appPage: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#app', { state: 'visible' });
    await use(page);
  }
});

export { expect };
```

### 10.3 核心业务测试套件规范

1. **测试驱动选择器规范**：
   - 避免直接依赖随机生成的 CSS 类名，组件模板统一添加明确的 `data-testid` 属性（如 `[data-testid="hero-empty"]`, `[data-testid="btn-plan"]`, `[data-testid="inspector-drawer"]`）。
2. **场景用例矩阵**：
   - **空态与全域拖拽**：断言启动展示 `hero-empty`，`tasks-table` 隐藏；触发 `dragenter` 验证 `global-drop-mask` 激活；
   - **参数微调与脏标记**：修改 CRF 数值后，断言 `dot-quality` 脏点出现、`btn-reset-video` 链接显示、状态切换为 `STALE`；点击重置后验证属性恢复基准值；
   - **任务检查器抽屉**：双击表格行，断言 `inspector-drawer` 开启，对比区展示正确源编码（H.264/HEVC），命令预览框包含有效高亮元素并可成功调用复制；
   - **日志聚焦联动**：模拟任务执行报错，断言错误胶囊展示「查看报错」链接；点击后断言日志抽屉打开并自动添加当前 `taskId` 过滤标签。

### 10.4 运行与持续集成命令

- 本地前台快速测试：`npm --prefix apps/mediac-desktop run test:e2e`
- 查看 HTML 测试报告：`npx playwright show-report temp/e2e-report`

---

## 11. 维护指南与已知限制

1. **预设增删**：只改 `presets/default.yaml`，GUI 动态分组自动跟随。
2. **新增 IPC**：`ipc-channels.ts` → `contracts.ts` → `preload/index.ts` → `main/index.ts` `handleTrusted` 四步，类型贯穿全链路；保持 `isTrustedSender` 与 `toSerializable` 约束。
3. **编码/滤镜参数改动**：遵循 AGENTS.md，先真机 `ffmpeg -h encoder=X` 与 1 帧 `-f null -` 核验。
4. **干净环境构建**：先在仓库根 `npm install` 安装根依赖（`lib/*` 跨目录导入 `p-map`/`fs-extra`/`execa`/`systeminformation` 等运行时包），再进 `apps/mediac-desktop` 执行 `npm install` 与构建。
5. **回归命令**：桌面端 `typecheck`/`build`；自动化回归 `npm --prefix apps/mediac-desktop run test:e2e`；涉及 lib 改动补根目录 `npm test`。

---

## 12. 架构审查与潜在严重风险附注（Architectural Review & Risk Notes）

针对本方案及 `apps/mediac-desktop` 现有代码实现，经资深架构审查甄别，发现以下 **4 项高危工程隐患**，必须在正式编码或上线前予以纠正：

### 12.1 隐患一：跨目录引用第三方依赖导致打包安装包闪退崩溃（P0 致命隐患）
- **现象与根因**：
  `apps/mediac-desktop/src/main/` 跨目录导入了根目录的 `lib/ffmpeg_engine.js`、`lib/hwdetect.js` 等模块。这些模块在运行时依赖 `p-map`、`systeminformation`、`fs-extra`、`execa`。
  然而，`apps/mediac-desktop/electron.vite.config.ts` 的 main 配置了 `build: { externalizeDeps: true }`，并且 `apps/mediac-desktop/package.json` **未声明上述依赖**。
  在开发环境（`electron-vite dev`）由于 Node 会递归向上寻找根目录 `node_modules` 能正常运行；但在执行 `package:win` 构建出安装包后，打包器仅收纳 `apps/mediac-desktop/node_modules` 入 `app.asar`，用户安装后启动调用硬件探测或转码时会立即抛出 `Error: Cannot find module 'p-map'` 导致主进程崩溃退出！
- **必须整改方案**：
  在 `apps/mediac-desktop/electron.vite.config.ts` 中配置打包内联：
  ```typescript
  import { externalizeDepsPlugin } from 'electron-vite';
  // ...
  main: {
    plugins: [
      copyCoreData,
      externalizeDepsPlugin({
        exclude: ['p-map', 'systeminformation', 'fs-extra', 'execa', 'yaml']
      })
    ]
  }
  ```
  或者在 `apps/mediac-desktop/package.json` 中完整声明这些运行时依赖。

### 12.2 隐患二：UI 布局与规范严重滞后于最新交互原型（P1 架构滞后）
- **现象与根因**：
  本文档 §7 仍描述为“底部折叠命令预览 (P0)”与“底部折叠日志面板 (160~320px)”，并采用“READY 后简单粗暴冻结所有输入控件”。
  在最新实操验证的 `FFMPEG-ELECTRON-UI-UX-DESIGN-FINAL-20260924.md` (v1.3.0) 与 `mediac-desktop-ui.html` (v0.3.0) 中，已彻底淘汰底部常驻命令框（释放了 100% 的表格垂直视野），升级为右侧滑出式 `TaskInspectorDrawer`；同时将死板的输入控件冻结升级为现代桌面应用的平滑 `STALE` 状态机（修改参数时不销毁表格，仅置灰并亮起「更新计划」按钮）。
- **必须整改方案**：
  实现时全面对齐 v1.3.0 UI/UX 规范，坚决废弃底部挤占高度的固定命令条。

### 12.3 隐患三：`before-quit` 同步 taskkill 异常中断与孤儿进程风险（P1 进程安全）
- **现象与根因**：
  §8.8 提出在 `before-quit` 中逐个调用同步 `execFileSync("taskkill", ["/PID", pid, "/T", "/F"])`。
  在 Windows 下，若某个子进程已经正常终止，`taskkill` 会返回退出码 128 并直接抛出 Node.js 异常。如果不使用 `try-catch` 包裹单个 kill，首个已退出进程的异常将直接中断整个 `dispose()` 循环，导致后续真正运行中的 ffmpeg 进程成为僵尸孤儿进程；此外，长期运行中存在 Windows PID 轮转重用而误杀其他用户软件进程的潜在风险。
- **必须整改方案**：
  同步 taskkill 必须对每个 PID 进行独立的 `try { ... } catch {}` 容错隔离，并在执行前核验进程树状态。

### 12.4 隐患四：海量文件导入时 IPC 序列化性能瓶颈（P2 内存与性能）
- **现象与根因**：
  当用户批量拖入含数千个视频文件的素材文件夹时，`createPlan` 将整个数千任务对象的完整结构体一次性经 IPC `structuredClone` 传输至渲染进程，并在 Vue 中全量转换响应式 Proxy，会导致渲染进程数秒的严重 GC 停顿与掉帧。
- **必须整改方案**：
  渲染进程任务表格结合虚拟滚动，快照数据仅传输首屏/视口展示所需的核心字段（id, name, status, size, duration, dst），详细媒体元数据在用户打开 `TaskInspectorDrawer` 时按需二次拉取。
