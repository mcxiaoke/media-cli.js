# mediac FFmpeg 桌面应用 & ffmpeg lib 代码审查报告（dsf）

- 日期：2026-09-24 22:52 (GMT+8)
- 审查范围：
  - Electron 桌面应用 `apps/mediac-desktop/`（main / preload / shared / renderer）
  - WebUI `ffweb/`（server.js / task_runner.js / dialog.js / assets）
  - ffmpeg 核心库 `lib/ffmpeg_*.js`、`lib/hwaccel.js`、`lib/hwdetect.js`、`lib/gpu.js`、`lib/preset_loader.js` 等
  - 静态原型 `ffmpeg-ui-demo/`、测试 `test/` 与 `apps/mediac-desktop/tests/`
- 审查方式：逐行阅读关键源文件，按「代码质量 / 代码逻辑 / 工程架构 / UI-UX / 安全」五类输出，均标注 `文件:行号` 依据。

---

## 0. 结论摘要

整体架构是清晰的：`lib/ffmpeg_*.js` 负责领域逻辑（plan/build/run/engine），`ffweb` 与 Electron 是两个并行的前端封装，共用同一套 lib。优点是引擎层有详尽的消歧、容错与回归测试，安全基调（sandbox、contextIsolation、token、回环绑定、路径穿越防护）建得不错。

但存在一批**紧迫**问题，按影响排序：

| 级 | 编号 | 问题 | 位置 |
|----|------|------|------|
| 🔴 高 | L-01 | Electron 菜单与 renderer 动作不匹配，"添加媒体目录"菜单失效 | index.ts:72 / App.vue:260 |
| 🔴 高 | L-02 | `jobs` 配置实际完全被忽略，执行恒为串行 | ffmpeg-service.ts:518, ffweb/task_runner.js:256 |
| 🔴 高 | L-03 | 共享契约 `RunnerState` 定义不完整（缺 `STALE`），三处类型漂移 | contracts.ts:1-9, ffmpeg-service.ts:40, plan.ts:14 |
| 🟠 中 | L-04 | 桌面端无 i18n，全部硬编码中文；UI 用原生 `alert/confirm` | App.vue:71,118 等 |
| 🟠 中 | L-05 | 声明了 naive-ui / @vueuse / @vicons 依赖但从未使用（死依赖） | apps/mediac-desktop/package.json:20-31 |
| 🟠 中 | L-06 | "关于"菜单项只是复用了"打开设置"，无真正关于页 | index.ts:182-185 |
| 🟠 中 | L-07 | 帮助菜单硬编码开发路径 `data/videos`，生产环境失效 | index.ts:173-180 |
| 🟠 中 | L-08 | IPC 参数校验不一致/不严格 | index.ts:235-243, 248-255 |
| 🟠 中 | L-09 | ffweb 与 Electron 存在大量重复的胶水逻辑 | 多处 |
| 🟡 低 | L-10 | ffmpeg_engine 主循环直接改写入参 task 状态，副作用大 | ffmpeg_engine.js:132, 279-301 |
| 🟡 低 | L-11 | `resolveHwPlan` 中应降级的分支最后都 throw，if 分支冗余 | ffmpeg_run.js:843-849 |
| 🟡 低 | L-12 | `formatPresetOption` 等渲染逻辑无单测，仅 e2e 覆盖 | ConfigPanel.vue |

---

## 1. 代码质量（Code Quality）

### 1.1 死代码 / 未使用（Dead code）

- **Q1-1 🔴** `apps/mediac-desktop/src/main/ffmpeg-service.ts:32`：`const execFileAsync = promisify(execFile)` 定义了 `execFileAsync`，全文仅此一处，未在任何地方调用（仅 `execFileSync` 被 `killTrackedProcessesSync` 使用，L439）。`execFile` 与 `promisify` 均成了死导入。
- **Q1-2 🟠** `apps/mediac-desktop/package.json:21-30`：`@vueuse/core`、`naive-ui`、`@vicons/ionicons5` 三个依赖在 `src/` 中零引用（全仓 grep 无 import）。项目实际 UI 用原生 `<svg>` + 自写 scoped CSS，未使用 naive-ui。这几个依赖应移除，否则打包体量虚增、退役面积扩大。
- **Q1-3 🟡** `ffweb/server.js:31-34`：`MAX_BODY_BYTES / MAX_INPUTS / MAX_PATH_LENGTH` 常量定义得很好，但 `MAX_INPUTS/MAX_PATH_LENGTH` 仅在 `_validatePlanBody` 使用，`MAX_BODY_BYTES` 本应防大包，却在 `dialog/select`（readBody 注入 L324-341）之外的接口共用 `readBody`，见 L-08。

### 1.2 魔法值 / 硬编码

- **Q2-1 🟡** `ffmpeg-service.ts:217`：并发上限 `const limit = 8` 直接字面量，缺命名常量/注释说明选用理由；且此值并未暴露给使用者配置。
- **Q2-2 🟡** `ffmpeg-service.ts:299,302`：预设回退硬编码 `"hevc_2k" → "h264_2k"`，与 `presets.getAllNames()[0]` 混用（L304）。同一回退逻辑在 `ffweb/task_runner.js:209-211` 又复制了一遍 → 三处重复。
- **Q2-3 🟡** `index.ts:175`：菜单项"打开媒体素材目录"硬编码 `path.resolve(__dirname, "../../../../data/videos")`，这是开发机路径，打进生产包后必然 `existsSync` 为 false，菜单点了没反应。属于把开发配置泄露到生产 UI。

### 1.3 命名 / 结构

- **Q3-1 🟠** 状态枚举各写各的：
  - `shared/contracts.ts:1-9` `RunnerState`：`IDLE/PLANNING/READY/RUNNING/STOPPING/STOPPED/COMPLETED/FAILED`（**缺 STALE**）
  - `src/main/ffmpeg-service.ts:40` 私有 status：额外含 `STALE`
  - `src/renderer/.../stores/plan.ts:5-8` 又各自声明同名 `RunnerState`（含 STALE）
  - `ffweb/task_runner.js:31` 注释里的状态集合：`IDLE|PLANNING|RUNNING|STOPPED|COMPLETED`（连 READY/FAILED/STALE 都没有）
  这是**契约漂移的教科书案例**：共享类型无法表达实际状态空间。Renderer 的 `plan.status` 可能收到 `STALE`，但 `HeaderBar.vue` 的 `STATE_CONFIG` 有 STALE（HeaderBar.vue:33）而 `contracts.ts` 没有——类型与运行时不一致。
- **Q3-2 🟡** `ffmpeg-service.ts:39`：`stagedEntries` 用 `Map<string, { item; task; info }>`，`item`、`task`、`info` 三字段结构重叠（`task` 已含 `mediaInfo`/`rawMetadata`），`item` 与 `task` 实际几乎同构，联系方式冗余。

---

## 2. 代码逻辑（Logic）

### 2.1 菜单动作不匹配（功能 Bug）

- **L-01 🔴** `apps/mediac-desktop/src/main/index.ts:72`：菜单「添加媒体目录」发送 `window.webContents.send("menu:action", "add-directory")`；
  而 `App.vue:260` 的 switch 里处理的是 `case "add-dir"`（**不是** `add-directory`）。
  → **用户点菜单「添加媒体目录」时，renderer 匹配不到任何分支，目录选择不触发**（等同按钮失效）。同时主 menu 从未发送 `"open-output-dir"`，但 `App.vue:263` 里却写了 `case "open-output-dir"` 的分支——死分支，方向反了。
  - 修复建议：统一行为字符串（建议主进程与渲染进程都引用 `shared/ipc-channels.ts` 里定义的常量，而不是魔法字符串 `"menu:action"` + 裸字符串动作），消除 `add-dir/add-directory` 拼写歧义。

### 2.2 `jobs` 配置被无视（功能/经验差距）

- **L-02 🔴** UI（`ConfigPanel.vue` + `stores/config.ts:17` `adv.jobs`）允许用户设并发任务数；`createPlan` 时 `ffmpeg-service.ts:347` 也把 `concurrency: normalized.jobs || 1` 传给了 plan 阶段；但 **执行阶段 `ffmpeg-service.ts:558` 硬编码 `concurrency: 1`**；`ffweb/task_runner.js:256` 更是 createPlan 阶段就直接 `concurrency: 1`。
  → 用户选的 `jobs` 并发对实际转码毫无影响，永远是串行。属于"设置存在但无效"的体验陷阱。应让执行阶段透传并发（并注意 8 并发 probe 与转码并发共用进程资源上限）。

### 2.3 `resolveHwPlan` 降级分支冗余

- **L-11 🟡** `lib/ffmpeg_run.js:843-850`：
  ```js
  if (decodeMode === DecodeMode.GPU) { throw err }
  // auto 模式下连 cpu 都失败属异常，也抛出
  throw err
  ```
  两个分支行为完全一样（都 throw），`if` 是死条件。若意图是 auto 模式下应静默降级到 cpu，这里逻辑没实现；若意图确为"auto 也抛"，则应删掉冗余 if。**注释与代码自相矛盾**（注释声称 auto 连 cpu 失败才抛，实际 auto 也一样抛）。

### 2.4 引擎副作用

- **L-10 🟡** `lib/ffmpeg_engine.js:132,279-301`：引擎主循环直接 `task.status = "running"/"done"/"failed"` 改写**入参** plan.tasks（即调用方持有的 `currentPlan.tasks` 引用）。而在桌面端 `ffmpeg-service.ts:540-546` 又在 `onEvent` 里再次 `pt.status = ...` 改同样的 task——**同一 task 状态被两个地方写**，且 renderer 端 `App.vue:307-321` 也用事件再写一份 plan store。三个 sources of truth，状态同步容易漂移。建议引擎改用「不可变 result + 回调返回状态」而非 in-place 修改。

### 2.5 进度 / 任务索引

- **L-13 🟡** `ffmpeg-service.ts:238`：`index: this.stagedEntries.size` 在并发 worker（L220-271）里被使用；但 `stagedEntries` 是在 worker 执行过程中边 `set` 边增长，多个 worker 并发时 `this.stagedEntries.size` 取值**不确定**，可能两个 task 拿到相同 index。而且 `index` 语义（全局累计序号）与 renderer 表格顺序无关紧要时用它没问题，一旦用于"第几条"展示会错乱。建议改为 worker 内原子序号（如 `cursor` 处分配）。
- **L-14 🟡** `lib/ffmpeg_engine.js:77`：`concurrency` 默认 1，但上层（desktop/ffweb）从未传 >1，因此该并发能力实际闲置（同 L-02）。

### 2.6 状态机 / 竞态

- **L-15 🟠** `ffmpeg-service.ts:453-599` `startExecution` 返回后即算完成，引擎异步 `.execute(...)` 由 `void` 触发（L552），异常只落到 `.catch` 改 `summary/status`。问题：`this.status = "RUNNING"`（L500）在 `await recoverStaleTasks()/writeTaskManifest` 之后设置，若这段 await 抛错，status 停在 READY 而 abortController 已建——状态与对象不一致。建议把「写 manifest」与「引擎启动」放进同一 try，保证状态原子推进。
- **L-16 🟡** `stopExecution`（L601-608）与引擎 `onSummary`（L559-585）并发写 `this.status`/`this.summary`：stop 先置 `STOPPING`，随后引擎 onSummary 又置 `STOPPED/COMPLETED`，中间存在窗口期 renderer 可能看到 `STOPPING` 却拿不到最终态。可通过单一状态机 + 顺序化（串行队列）收敛。

---

## 3. 工程架构（Architecture）

### 3.1 两条并行 UI 栈，胶水逻辑大量重复

- **L-09 🟠** 同一套 `lib/` 之上同时存在：
  1. Electron 桌面（`apps/mediac-desktop/`，Vue3 + Pinia）
  2. WebUI（`ffweb/`，原生 JS + index.html）
  两者各自重新实现了：
  - `scanWebInputFiles` → 计划生成（desktop `createPlan` 与 ffweb `task_runner.createPlan` 结构几乎一致）
  - 预设回退选择（`getPreset(x)||hevc_2k||h264_2k||[0]`，desktop L299-304 vs ffweb L208-212）
  - 命令预览拼接、`createPublicPlanSnapshot` 调用、状态机、日志行
  差异点（如 desktop 多了 staged 预导入、ffweb 无）造成**同一语义两套实现、bug 双倍**。建议：将「计划生成 + 执行编排」抽成 lib 层的统一高层 API（`prepareAndRun`），ffweb 与 Electron 都只做 thin 适配，消除重复。
- **L-17 🟡** `ffweb/task_runner.js:189-311` 的 `createPlan` 逻辑与桌面 `ffmpeg-service.ts:290-431` 几乎逐行重复（normalize → 预设回退 → scan → prepare → 预览命令 → 快照）。若未来改参数契约，两边都要同步改，风险高。

### 3.2 契约漂移

- **L-03 🔴 / Q3-1**：`shared/contracts.ts` 是本应唯一事实源，但实际三处各自声明状态/任务形状。建议：
  - 收敛为唯一 `contracts.ts`（`RunnerState` 补 `STALE`，`PlanTask` 字段对齐 `ffmpeg-service` 里实际下的字段 `bitDepth/pixelFormat/profile/level/aspectRatio/audioChannels/audioSampleRate/audioBitrate/rawMetadata`，contracts.ts 已声明但 desktop 未全部使用）。
  - ffweb 也改 import `contracts.ts`（或抽到 lib 共享的 schema 模块）而不是在自己文件里内联结构（`getSnapshot` L84-117 / `getEnv` L146-176 手写快照结构）。
- **L-18 🟡** `index.ts` 用裸字符串 `"menu:action"`（L65-184）与 renderer `App.vue` 裸处理（L255-295），而 IPC 通道名却统一收在 `shared/ipc-channels.ts`。建议菜单动作也收进常量，避免又是字符串漂移点。

### 3.3 配置与资源定位脆弱

- **L-19 🟡** `ffmpeg-service.ts:95-108` `resolvePresetPath` 用 9 个硬编码候选路径逐一遍历找 `default.yaml`——这是对打包产物结构不确定的"打地鼠"式兜底，一旦 electron-builder `asar` 隔离、`resourcesPath` 结构变化即失效。建议构建期把预设作为资源固定写入 `process.resourcesPath/presets`，运行时只查 1-2 个确定位置。
- **Q3-2 🟡**（同上面 stagedEntries 结构冗余）。

---

## 4. UI / UX

### 4.1 无国际化

- **L-04 🟠** 桌面端所有文案硬编码中文（`App.vue:71,76,118`、`HeaderBar.vue`、`ExecutionBoard.vue`、`SettingsModal` 等全仓无 `i18n` 引用），与 CLI 项目本身具备 `lib/i18n.js` 中英双语的传统不符。作为一个公开发布的桌面产品，至少应把用户可见字符串收敛到单一 i18n 表。

### 4.2 原生弹窗打断体验

- **L-04 🟠** `App.vue` 大量使用浏览器原生 `alert()`（L71「请先添加至少一个媒体文件或目录」、L118「生成计划失败...」）、`window.confirm()`（L75 高危确认、L118）、`ExecutionBoard` 等——在 Electron 里这些是系统原生弹框，样式与主题（深浅色）完全脱节，且不可定制。既已声明用 naive-ui（却没用），建议引入消息/模态组件统一交互。

### 4.3 信息层级 / 反馈

- **L-20 🟡** `ExecutionBoard.vue:53-59` ETA 依赖 `planSnapshot.totalDuration` 与 `overallPercent`/`currentSpeed`。当只执行**子集**任务时，`totalDuration` 仍是全量计划的总时长（`planSnapShot` 未随选中任务缩放），ETA 会严重失真。应改用当前执行任务的总时长折算。
- **L-21 🟡** `App.vue:226-236` keydown `Ctrl+Enter` 触发 `createPlan`，与菜单 `index.ts:97-101` accelerator `CmdOrCtrl+Enter` **重复绑定同一动作**——若两者都命中会 double-call。建议只保留一处（例如只在菜单 accelerator，或只在 renderer keydown）。
- **L-22 🟡** `ConfigPanel.vue` 开头一大段 `watch`（L52-118）用日志记录每次参数变更（"转码预设已切换""修改视频分辨率"...），在没有"审计"需求时会产生大量噪音日志占用 `maxLogs=500`（`log.ts:33`）挤掉真正有用的转码日志。建议降级或可关闭。

---

## 5. 安全（Security）

总体正面：`index.ts:202-207` 正确设置 `contextIsolation:true / nodeIntegration:false / sandbox:true`，并在 preload `index.ts:71-73` 强硬校验 `process.contextIsolated`；IPC 用 `isTrustedSender` 校验发送方；ffweb 强制回环绑定、随机 token、`timingSafeEqual` 鉴权、路径穿越防护。以下为可加强点：

- **S-1 🟠** `index.ts:248-255`：`SYSTEM_SHOW_IN_FOLDER` / `SYSTEM_OPEN_PATH` 仅校验 `typeof === "string"`，renderer 可传入**任意路径**让主进程 `shell.openPath`。虽然当前 renderer 可信，但若未来引入任何未转义路径（如文件名来自外部文件元数据，`showInFolder(fullPath)` 直接透传），会成为打开/暴露任意路径的通道。建议至少校验为 `path.resolve` 后是绝对路径，并对 `openPath` 加白名单/确认。
- **S-2 🟡** `ffmpeg-service.ts:72-75` `isManagedTempPath` 只凭文件名含 `_tmp@`/`@tmp_` 子串判定是否可删——`recoverStaleTasks`（L58-70）会据此 `rm` manifest 里的 tempPath。若恶意/异常 manifest 指向同名模式但非真实 temp 的路径，可能误删。建议 temp 路径归一到统一 temp 根目录下再校验，而不是只靠文件名启发式。
- **S-3 🟡** `ffweb/app.js:420,443-449` 用 `innerHTML + escapeHtml()` 手动转义渲染用户路径；目前转义正确，但手工拼接 innerHTML 一旦后续加字段漏 escape 即为 XSS 点。建议改用 DOM 文本节点 / 统一 sanitizer。
- **S-4 🟡** `ffweb/server.js:141-144` `_requestToken` 从 URL query 读 token——token 会进浏览器历史、访问日志，泄露面比 header 大。SSE 必须用 query，但 REST 可仅用 `X-Token`，当前 fetch 混用两者（app.js:24-28 两个都带），建议 REST 只走 header。

---

## 6. 测试（Test）

做得好的：CLI 侧 `test/` 覆盖相当扎实——`test_ffmpeg_contracts.js` 校验跨模块共享参数形态、`test_ffweb_flow.js` 跑真机转码 + 覆盖 `task/stop`/`override` 语义、`test_ffmpeg_*.js` 覆盖 scan/plan/engine/build/hw，且均为真实断言。桌面端有 Playwright e2e（`tests/e2e/specs/01-smoke / 02-interaction / 03-workflow`）。

- **T-1 🟠** 桌面 renderer 的纯函数逻辑（`formatPresetOption`、`formatSize/highlightFfmpegCmd`、`plan store` 的 `overallPercent/eta/selectedIds` 计算）**无单元测试**，只有 e2e。这些是 UI 最易回归的位置，建议抽成 pure 模块并补 vitest 单测。
- **T-2 🟡** `test_default_presets.js` / `test_preset_schema.js` 覆盖了预设 schema，但**预设回退链**（`hevc_2k→h264_2k→[0]`）没有专门用例；该回退在 desktop/ffweb 都重复实现（见 L-09），一旦有一个实现改了 fallback 顺序没有测试兜底。
- **T-3 🟡** `playswright.config.ts:15` `retries:0`：e2e 零重试，遇到 ffmpeg/环境 flaky 就直接红，CI 稳定性不佳。建议至少 `retries: 1`。

---

## 7. 优先级修复建议（Roadmap）

**第一批（功能/架构阻断，先做）**
1. 统一菜单-渲染动作常量，修掉 `add-directory/add-dir` 失效 bug（L-01）。
2. 抽 lib 层统一「计划生成 + 执行」高层 API，ffweb/Electron 去重（L-09/L-17）；并让 `jobs` 真正生效（L-02）。
3. 收敛 `RunnerState`/task 形状到唯一 `contracts.ts`，补齐 `STALE`（L-03/Q3-1）。

**第二批（稳定性/安全）**
4. 引擎去 in-place 副作用或缺状态归因（L-10、L-15、L-16）。
5. IPC 路径参数校验 + temp 路径根目录强约束（S-1/S-2）。
6. 修 `resolveHwPlan` 死分支，明确降级语义（L-11）。

**第三批（体验/清理）**
7. 引入 i18n + 替换原生 alert/confirm（L-04）。
8. 移除未用依赖（naive-ui/@vueuse/@vicons）与死代码 `execFileAsync`、开发路径菜单（Q1-1/Q1-2/Q2-3）。
9. 修 ETA 子集失真、快捷键双绑定、噪音日志 watch（L-20/21/22）。
10. 补 renderer 纯函数单测、e2e retries（T-1/T-3）。

---

*本报告基于对 `apps/mediac-desktop/src/**`、`lib/ffmpeg_*.js`、`ffweb/**`、`ffmpeg-ui-demo/**`、`test/**` 的逐行阅读；所有行号以当前工作区为准。*