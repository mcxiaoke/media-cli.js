# mediac-desktop Electron 应用与 ffmpeg lib 集成代码审查报告

- 审查日期：2026-09-24 22:54 (GMT+8)
- 审查范围：`apps/mediac-desktop`（Electron 主进程 / preload / Vue3 渲染层 / e2e 测试 / 构建打包配置，共约 7100 行），以及桌面端经 `../../../../lib/` 引用的 lib 模块（ffmpeg_engine / ffmpeg_run / ffmpeg_build / ffmpeg_planner / ffmpeg_plan_snapshot / ffmpeg_options / ffmpeg_scan / ffmpeg_bin / hwdetect / mediainfo）
- 审查方式：全部源文件通读 + 关键结论逐条对照代码核验（非子代理结论照单全收，未核实项单独标注"疑似"）
- 总体结论：**架构方向正确、安全基线扎实，但存在 3 个 P0 级功能性缺陷（失败任务被标成功 / 菜单快捷键绕过状态守卫 / 打包后 ffmpeg 依赖 PATH）和一批 P1 状态机/契约问题，建议在下一个迭代集中修复 P0 与 P1 前四项**

---

## 一、总体评价

**做得好的部分**（先说结论中的确定事实）：

- 安全基线扎实：`contextIsolation: true` + `sandbox: true` + `nodeIntegration: false`（main/index.ts:202-207），IPC 有 `isTrustedSender` 来源校验（main/index.ts:34-45），参数类型逐项校验后才进 service，`setWindowOpenHandler` 全拒、`will-navigate` 全拦。
- IPC 序列化防御到位：`ipc-serializer.ts` 处理循环引用/BigInt/Error/Set/Map，避免 ffmpeg 内部对象直接跨进程。
- lib 侧无 `shell:true`（execa 数组直传）、删除源文件走回收目录 `safeRemove` 且有产物存在性/大小/路径校验（ffmpeg_planner.js:226-253），不会误删。
- 崩溃恢复有 manifest 机制（active-tasks.json 原子写 + 启动清理残留 temp 文件）。
- 桌面调用 lib 的字段契约大部分真实存在（plan.totalSize/previewCmd、summary.isCancelled、deletion.deleted/kept/failed、buildTaskDeps.getMediaInfo 签名均匹配），说明是按实际接口写的，不是臆造。

**主要问题集中在**：主进程状态机健壮性、事件契约的细微错位、渲染层与主进程双重状态机不同步、以及少量"承诺了但没实现"的 UI 功能。

---

## 二、P0 — 严重功能缺陷（均已核验）

### P0-1 失败任务被标记为 success，`task.failed` 是死代码分支

`ffmpeg-service.ts:537-544`：

```ts
} else if (event.type === "task.done" || ... || event.type === "task.failed") {
  if (event.type === "task.done") pt.status = "success"
  ...
  else if (event.type === "task.failed") pt.status = "failed"
```

但 engine 对失败任务**同样发 `task.done`**，靠 payload 里的 `failed: true` 区分（lib/ffmpeg_engine.js:294-301：`summary.failed++` 后 `emit(ENGINE_EVENT.TASK_DONE, { taskId, ..., failed: true })`），且 `ENGINE_EVENT` 常量表里**根本不存在 `task.failed`**（lib/ffmpeg_events.js:1-10 只有 started/progress/done/skipped/cancelled）。

**后果链**（确定）：转码失败的任务在 `currentPlan` 里 status 变成 `success`；`ffmpeg-service.ts:579-582` 的 `allFinished` 据此判定，有失败任务时也可能误置 `COMPLETED`；渲染层表格显示成功，用户以为转码完成实际产物缺失。这是数据正确性级别的缺陷。

**修复**：`task.done` 分支先判 `event.failed`；同时补上 `task.cancelled` 分支（目前取消后任务 status 停留 `running`，快照显示仍在转码）。

### P0-2 菜单快捷键绕过所有状态守卫，可把运行中会话打成 FAILED

- Electron 菜单 `生成计划 Ctrl+Enter / 开始转码 F5 / 终止 Shift+F5`（main/index.ts:96-116）从不根据运行状态禁用，直接发 `menu:action`。
- App.vue 的 keydown 处理（App.vue:226-236）对 Ctrl+Enter 有 `status !== "RUNNING" && !== "PLANNING"` 守卫，但 **Electron 菜单加速键优先于页面 keydown 拦截按键**，实际生效的是无守卫的菜单路径（App.vue:266-273：`case "create-plan": void createPlan()`）。
- `startExecution()`（App.vue:123-141）自身无 RUNNING 守卫，第一步就 `planStore.status = "RUNNING"`，主进程 `ffmpeg-service.ts:453-455` 抛错，catch 里置 `status = "FAILED"`——**引擎实际仍在运行**，但 UI 显示"异常"、开始按钮重新可用，后续引擎事件会把状态进一步搅乱。

**修复**：菜单分支复用同一守卫（或直接禁用菜单项/在 handler 里判状态）；`startExecution` 入口加状态自检。

### P0-3 打包产物不含 ffmpeg，无 PATH 机器上功能不可用且静默

- `resolveFFmpegBinary()`（lib/ffmpeg_bin.js:30-46）只查 `FFMPEG_PATH`/`FFMPEG_BINARY` 环境变量和 PATH（which），**没有 `process.resourcesPath` 回退**——而预设文件反而有 9 个候选路径含 resourcesPath（ffmpeg-service.ts:95-108），二者不对称。
- electron-builder.yml `extraResources` 只打包 presets，不打包 ffmpeg 二进制。
- 用户机器 PATH 无 ffmpeg 时：`getSummary().ffmpegPath = null` 界面能显示，但 `runFFmpeg` 兜底用裸 `"ffmpeg"`（lib/ffmpeg_run.js:617）——探测到 null 与实际执行命中的二进制可能不一致，正是该处代码注释自己警告过的风险。

**修复**（二选一）：安装包捆绑 ffmpeg 进 extraResources 并在 resolveFFmpegBinary 加 resourcesPath 候选；或在无 ffmpeg 时给用户明确的引导 UI（下载指引/手动选路径），且 `runFFmpeg` 拒绝在未解析路径时裸调 `ffmpeg`。

### P0-4 日志自动滚动在缓冲区满 500 条后静默失效

`LogDrawer.vue:8-16` 的 watch 源是 `filteredLogs.length`；`stores/log.ts:33/49` 缓冲满 500 后 `push + shift` 使长度恒为 500，watcher 永不再触发。转码长任务（日志量最大的场景）恰好是最需要自动滚动的场景。

**修复**：watch 改监听 `filteredLogs` 末尾元素或长度 + 最后一条时间戳，或用 `logs.value[logs.value.length - 1]` 作为 watch 源。

---

## 三、P1 — 重要问题（均已核验，按建议修复顺序排列）

### P1-1 `summary.failed` 类型契约错位，任务栏错误态永不触发

`ffmpeg-service.ts:562`：`Array.isArray(summary.failed) ? summary.failed.length : 0`——但 engine 的 `summary.failed` 是**数字计数**（ffmpeg_engine.js:294 `summary.failed++`），永远不是数组 → `failedCount` 恒 0，`setTaskbarProgressError()` 永不触发。因防御性写法不抛错，属静默失败。修复：`typeof summary.failed === "number" ? summary.failed : 0`。

### P1-2 `onSummary` 异常被 engine 吞掉，service 状态可永久卡死在 RUNNING

状态终态转换只在 `onSummary` 回调（ffmpeg-service.ts:584）和 `.catch`（:588）里。但 engine 通过 `safeCallAsync` 调 onSummary 并吞掉一切异常（ffmpeg_engine.js:28-35, 311）。若 onSummary 内 `deleteCompletedSources` 或原生任务栏调用抛错：execute 正常 resolve、catch 不触发、`status` 永久停在 RUNNING → `createPlan`（:291）/`startExecution`（:455）全部被锁，只能重启应用。修复：service 侧把 onSummary 内容包 try/catch，兜底置 FAILED/STOPPED；engine 侧 `safeCallAsync` 失败时至少 rethrow 或上报。

### P1-3 previewCmd 与真实执行命令不符（缺编码器与缩放参数）

`ffmpeg-service.ts:378`：`createFFmpegArgs(firstTask, firstTask.hwPlan || null)`——plan 阶段任务没有 `hwPlan`（只在执行期由 runFFmpegCmd 设置，lib/ffmpeg_run.js:211）。`hwPlan` 为 null 时 `buildVideoArgsFromPlan` 直接返回 null（lib/ffmpeg_build.js:215-216），缩放段也被剔除（`resolveEffectiveSize` 返回 null，:107-110）。**用户在 UI 看到的"预览命令"没有任何 `-c:v` 编码参数**，与实际执行命令严重不符，误导调参。修复：预览前先做一次 hwaccel 分层探测（hwdetect 已有结果），或 UI 明确标注"示意命令，实际参数以执行为准"。

### P1-4 任务/输入删除单向同步，删除的文件会在下次"生成计划"时复活

- `ConfigPanel.vue:242 removeInput` 不删除对应 staged 任务行；`TaskTable.vue:32 removeTask` 不删除 `configStore.inputs` 条目。
- 而 `createPlan` 按 `normalized.inputs` 重扫（ffmpeg-service.ts:327 `scanWebInputFiles({ inputs: normalized.inputs ... })`）→ 用户从表格删掉的文件在下次生成计划时**无声复活**，无任何提示。
- 另 `TaskTable.vue:32` 删除任务无 RUNNING 守卫，可删除正在转码的行，渲染层与引擎状态脱钩（引擎仍写该任务进度）。

### P1-5 设置页"工具路径"是死功能

`SettingsModal.vue:55-75` 仅读写 localStorage `mediac_tool_*`，全仓库无任何消费方（主进程读不到 renderer 的 localStorage，也无 IPC 传递该配置）。用户设置 ffmpeg/exiftool 路径保存后零效果。要么接通（经 IPC 传给 resolveFFmpegBinary 候选路径），要么删掉该设置项。

### P1-6 拖放双重 stage 竞态

`ConfigPanel.vue:367-369` dropzone 的 `@drop` 未 `stopPropagation`，`GlobalDropMask.vue:65` 的 window 级 drop 监听同时触发 → 同批文件并发两次 `stageInputs`。主进程去重靠 `stagedEntries.set`（ffmpeg-service.ts:268，在异步 ffprobe 之后），并发窗口内两路都能通过去重检查，产生双份 ffprobe 探测与重复日志（最终靠渲染层按 path 去重兜底）。修复：dropzone `@drop.stop`，或主进程在 probe 前先同步占位 stagedEntries。

### P1-7 进度统计只计一个运行任务 + 高频全量拷贝

- `stores/plan.ts:38-40`：`tasks.find(t => t.status === "running")` 只取第一个运行中任务，`overallPercent`/ETA 在并行执行（jobs 1-4，SettingsModal.vue:210）时偏低。
- `plan.ts:145-161`：每条进度事件执行 `[...tasks.value]` 全量拷贝 + `findIndex`（O(n)），数百文件时高频进度事件导致整表重渲染，无虚拟滚动（TaskTable）叠加，大目录场景会卡顿。
- `updateTaskProgress` 无条件置 `status: "running"`，乱序事件可复活已完成任务（疑似，需复现确认）。

### P1-8 `deleteSourceConfirmed` 恒等于 `deleteSourceFiles`，主进程确认机制形同虚设

App.vue:104-105 两个值同源（`configStore.adv.deleteSource`），`ffmpeg-service.ts:313-319` 的"必须显式确认"检查永远通过。实际防线只剩渲染层 `window.confirm`，可接受但脆弱：任何绕过 UI 的调用路径（如 P0-2 的菜单快捷键异常路径）都不会有二次确认。建议确认语义收敛到一处。

---

## 四、P2 — 工程架构与代码质量问题

### 架构层面

1. **双重状态机不同步是多数 P0/P1 的根因**：渲染层 `planStore.status` 与主进程 `service.status` 各自维护、靠事件弱同步，异常路径两边各自置 FAILED/COMPLETED，必然漂移。建议渲染层状态完全由主进程 snapshot 事件驱动（`getTaskSnapshot` IPC 已存在但渲染层从未调用，contracts.ts:164 属于死接口）。
2. **`ffmpeg-service.ts` 全文 `any`**：`hardware: any`、`currentPlan: any`、`stagedEntries: Map<string, {item: any; ...}>`，`prepareFFmpegPlan` 等调用全用 `(fn as any)`。lib 是无类型 JS，但至少应为 plan/task/summary 定义 TS 接口（shared/contracts.ts 已有雏形），`as any` 掩盖了 P1-1 这类契约错位——TS 本可拦住 `Array.isArray(summary.failed)` 与 number 的矛盾。
3. **STALE 状态从未被设置**（ffmpeg-service.ts:40 定义、全仓无赋值），死枚举值。
4. **`stopExecution` 与 engine 双重杀进程**：`killTrackedProcessesSync`（:439）对每个 PID `execFileSync("taskkill /F")` 同步阻塞主进程（每 PID 上限 2s），而 engine 内部 abort 已有 execa `forceKillAfterDelay` 优雅终止（ffmpeg_run.js:623-624）。功能冗余无损害，但 `/F` 抢杀会打断 ffmpeg 写临时产物的正常清理路径，建议保留 engine 侧、去掉同步 taskkill（或仅作 5s 超时兜底）。
5. **`runFFmpegCmd` "产物过小"路径返回 undefined**（ffmpeg_run.js:379-429 只打日志不 return）→ `toRunResult(undefined)` 给出无信息量的 "FFmpeg returned no result"，丢失根因（lib 侧问题，桌面直接受害）。
6. **STOPPING 期间可 createPlan**（:291 只挡 RUNNING）：旧 run 收尾前重建 plan 会覆盖 `currentPlan`，旧 run 的 onEvent/onSummary 会改错新 plan 的任务状态。
7. **stageInputs 与 plan 扫描的文件口径不一致**：`collectInputFiles` 的 `isMediaFile` 含图片/RAW（helper.js:78），plan 阶段按视频预设过滤（ffmpeg_scan.js:72-77）→ staged 列表里存在永远不会进计划的文件，用户看到"已导入 N 项"但计划可能只有 M 项，且无解释。`index: this.stagedEntries.size` 在并发 await 间读取会产生重复 index（细节 bug）。
8. **stagedEntries 在 createPlan 后被 task 覆盖**（:421 `{item: t, task: t, info}`），item 形态从扫描结果变为 task，契约脆弱。

### 渲染层代码质量

9. **ConfigPanel.vue 1231 行**，stage/drop/预设联动/高级设置全在一个组件里，应拆分 + 抽 composable。
10. **重复代码**：`stageAddedPaths` 在 App.vue:179 / ConfigPanel.vue:159 / HeroEmpty.vue:8 / GlobalDropMask.vue:50 四处复制（仅 ConfigPanel 版处理了 skippedDuplicates，其余静默丢弃该信息）；`openOutputDir` 两处；`logStore.append({... timestamp: new Date().toLocaleTimeString()})` 样板约 30 处（timestamp 应下沉为 store 默认值）；btn/tag/badge/sw 样式在 6 个组件各抄一份。
11. **未使用依赖/死代码**：package.json 装了 `naive-ui`、`@vueuse/core` 但渲染层零引用（全部手写组件）；`log.ts:31 addLog`、`plan.ts:24 planningProgress` 未被调用；帮助菜单"关于 mediac FFmpeg Studio"与"偏好设置"发同一个 action（main/index.ts:182-185 vs 165-169），无独立关于对话框。
12. **快捷键承诺未兑现**：TaskInspectorDrawer.vue:104 / SettingsModal.vue:114 标注"关闭 (Esc)"、HeaderBar.vue:207/244 标注 Ctrl+L / Ctrl+,，但全局 keydown 只处理 Ctrl+B / Ctrl+Enter（App.vue:226-236），模态无焦点陷阱。
13. **样式 bug**：`TaskTable.vue:113 getFmtClass` 返回 `"fmt-default"`，CSS 里只有 `.fmt-other`（:584）→ 默认格式标签无样式。
14. **主题状态过期**：`SettingsModal.vue:19 currentTheme` 仅 setup 时初始化一次，HeaderBar 切主题后打开设置显示旧值。
15. **中英文混杂**：HeaderBar.vue:46 "CPU Mode"、LogDrawer.vue:25 "No logs"、TaskInspectorDrawer.vue:102 状态标签直接渲染英文原始值（staged/success），与其余全中文 UI 割裂；主进程日志（ffmpeg-service eventSink）全中文而 lib 日志全英文，同屏混排。
16. **原生 `alert/confirm`**（App.vue:113/71 等）与整体自绘 UI 风格割裂。
17. **无障碍**：`role="checkbox"/"switch"` 的 span（TaskTable.vue:155/190、SettingsModal.vue:225）及 dropzone 仅 `@click`，无 Enter/Space 键处理，键盘无法操作。
18. **TaskInspectorDrawer 兜底命令是硬编码伪造**（:29 `ffmpeg -i ... -c:v libx265 -crf 23 ...`），无计划/无预览时展示与所选预设无关的假命令，误导用户。
19. **日志细节**：`errCount` 只增不减（仅清屏重置），500 条滚动后错误历史已丢但计数仍在；焦点过滤 `l.text.includes(focusedTaskId)`（log.ts:75）存在前缀误匹配。
20. **ExecutionBoard STOPPED 状态展示不一致**（:37-46 进度归零但完成数保留）；快速预览无选中时静默回退 `tasks[0]`（TaskTable.vue:116）与"选中任务"标签语义矛盾。

### 打包与构建

21. **打包产物携带未使用依赖**：`dependencies` 里的 vue/pinia/naive-ui/@vueuse 会被 electron-builder 打进安装包 node_modules，但渲染层产物已由 vite 完整打包，纯属体积浪费（naive-ui 全量不小）。应移到 devDependencies 或确认 builder 排除。
22. **`picomatch` 外部化依赖**：构建产物 `out/main/index.js` 顶部 `require("picomatch")`（try/catch 可选加载，来自 glob 库）。picomatch 只存在于 devDependency 传递链（vite），生产依赖树无它；当前因有 try/catch 兜底不崩溃，但属打包配置的味道问题——若未来某次升级去掉 try/catch 会变成启动即崩。建议在 `externalizeDepsPlugin` exclude 名单处理或确认。
23. **帮助菜单"打开媒体素材目录"指向开发仓库路径**（main/index.ts:175 `path.resolve(__dirname, "../../../../data/videos")`），打包后解析到不存在路径，被 existsSync 静默吞掉——开发遗留菜单项，应删除或改为打开用户媒体库。
24. **e2e 覆盖薄弱**（395 行，3 个 spec）：覆盖 smoke/交互/工作流主干，但对本报告 P0-1/P0-2（失败任务状态、运行中菜单操作）无断言；无失败转码用例。`typecheck` 脚本存在但需确认 CI 是否执行。

---

## 五、修复优先级建议

| 优先级 | 条目 | 预估改动量 |
| --- | --- | --- |
| 立即 | P0-1 done/failed 判定 + task.cancelled 分支 | 小（<10 行） |
| 立即 | P0-2 菜单快捷键状态守卫 | 小 |
| 立即 | P1-1 summary.failed 数字判定 | 1 行 |
| 短期 | P0-4 日志滚动 watch 源 | 1 行 |
| 短期 | P1-2 onSummary try/catch 兜底 | 小 |
| 短期 | P1-4 删除双向同步 | 中 |
| 短期 | P1-3 previewCmd 失真 | 中（需接 hwaccel 分层） |
| 迭代内 | P0-3 打包 ffmpeg / 引导 UI | 中（产品决策） |
| 迭代内 | P1-5/6/7/8、架构项 1/2（状态机收敛 + 去 any） | 大 |
| 排期 | P2 渲染层重构（拆组件/抽 composable/去重复） | 大 |

## 六、审查方法与置信度说明

- 以上标注"已核验"的条目均由审查者亲自读取对应文件的对应行确认，非仅凭工具结论。
- 标注"疑似"的 2 处（updateTaskProgress 复活完成任务、STOPPING 清空后 summary 竞态）需要构造复现场景才能定论，已注明。
- lib 侧未覆盖本次桌面调用链之外的模块（cmd/ 层、其余命令），不在本次范围内。
