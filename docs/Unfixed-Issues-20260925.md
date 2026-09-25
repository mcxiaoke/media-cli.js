# 未修复问题备忘（基于两份 2026-09-24 review 的逐条核验）

- 核验日期：2026-09-25
- 依据来源：`docs/Review_FFmpeg_Electron_dsf_20260924.md`、`docs/FFMPEG-ELECTRON-CODE-REVIEW-20260924-qwm.md`
- 核验基线：当前 HEAD（含 `71a686a` P0/P1 修复提交、`f3c4993` ffweb 移除提交）
- 结论口径：**真实存在且当前代码仍未修复**的问题。已修复项（P0-1/2/4、P1-1/2/3、L-01/02/03/05/06/07/14/15/18 等）与随 ffweb 移除而失效的项（L-09/17、S-3/4、Q1-3 等）不在本列表。

> **2026-09-25 勾销**：第一批 #13/#10/#11/#16/#36 与第二批 #26/#17/#28/#14/#5/#3/#33/#29/#4+#34+#9
> 已修复并验证（npm test 318/318、lint 0、typecheck、e2e 4/4），详见 `docs/CHANGES-20260925.md`。
> 下表中这些编号仅作历史记录保留。

## 重要问题（建议优先处理）

| # | 问题 | 位置 |
|---|------|------|
| 1 | P1-4 删除单向同步：removeInput 只删 inputs、removeTask 只删任务行，互不联动，被删文件下次"生成计划"时无声复活；removeTask 无 RUNNING 守卫 | `stores/config.ts:104`、`stores/plan.ts:71`、`TaskTable.vue:32` |
| 2 | P1-5 设置页"工具路径"死功能：仅读写 localStorage `mediac_tool_*`，全仓无消费方、无 IPC | `SettingsModal.vue:27-71` |
| 3 | P1-6 拖放双重 stage 竞态：dropzone `@drop` 未 `.stop`，window 级 drop 同时触发，同批文件两路并发 `stageInputs` | `ConfigPanel.vue:368`、`GlobalDropMask.vue:65` |
| 4 | P1-7 进度统计：`overallPercent` 只取第一个 running 任务；`updateTaskProgress` 逐事件全量拷贝 + 无条件置 running（乱序可复活已完成任务） | `stores/plan.ts:26-34,137-148` |
| 5 | P1-8 `deleteSourceConfirmed` 与 `deleteSourceFiles` 同源，主进程确认检查形同虚设 | `App.vue:115-116` |
| 6 | staged index 并发不确定：probe worker 在 await 后读 `stagedEntries.size` 当 index，可重复；且 stage 与 plan 文件口径不一致（含图片/RAW vs 仅视频） | `ffmpeg-service.ts:284`、`lib/ffmpeg_scan.js:74` |
| 7 | P0-3 残留：安装包仍不捆绑 ffmpeg（extraResources 仅 presets），无 ffmpeg 时无下载引导 UI（仅报错文案） | `electron-builder.yml:11-15` |
| 8 | L-19 resolvePresetPath 仍靠 9 个硬编码候选路径"打地鼠" | `ffmpeg-service.ts:105-117` |
| 9 | L-20 ETA 子集执行失真：仍用全量 `planSnapshot.totalDuration` 折算 | `ExecutionBoard.vue:53-59` |
| 10 | S-1 `SYSTEM_OPEN_PATH` / `SYSTEM_SHOW_IN_FOLDER` 仅校验 string，可传任意路径打开 | `main/index.ts:280-287` |
| 11 | S-2 `isManagedTempPath` 仅凭文件名子串判定可删，无 temp 根目录强约束 | `ffmpeg-service.ts:84-87` |

## lib 引擎侧

| # | 问题 | 位置 |
|---|------|------|
| 12 | L-10 引擎主循环 in-place 改写入参 task.status，三处状态真源易漂移 | `lib/ffmpeg_engine.js:116,124,132` |
| 13 | L-11 resolveHwPlan 冗余 if：GPU 分支 throw 后又无条件 throw，注释与代码自相矛盾 | `lib/ffmpeg_run.js`（~843） |
| 14 | P2-5 "产物过小"分支只打日志不 return entry，`toRunResult(undefined)` 丢失根因 | `lib/ffmpeg_run.js`（~379-431） |
| 15 | P2-4 stopExecution 同步 `taskkill /F` 与 engine 侧 abort 冗余，/F 抢杀打断正常清理路径 | `ffmpeg-service.ts`（killTrackedProcessesSync） |

## 状态机与架构

| # | 问题 | 位置 |
|---|------|------|
| 16 | P2-6 createPlan 仅挡 RUNNING，STOPPING 期间可重建计划覆盖 currentPlan | `ffmpeg-service.ts:337` |
| 17 | P2-1 getTaskSnapshot 为死接口：preload 暴露但渲染层从不调用 | `preload/index.ts:39` |
| 18 | P2-2 service 仍有 11 处 `as any`，契约错位缺 TS 拦截 | `ffmpeg-service.ts` |
| 19 | P2-8 stagedEntries 存 `{item: t, task: t, info}` 同构冗余，item 被 task 覆盖 | `ffmpeg-service.ts:314,470` |
| 20 | P2-3 残留：主进程 service 自身从不置 STALE（渲染层现已会置） | `ffmpeg-service.ts` |

## 渲染层体验 / 代码质量

| # | 问题 | 位置 |
|---|------|------|
| 21 | L-04 无 i18n，全硬编码中文；大量原生 alert/confirm | `App.vue:82,86,129`、`SettingsModal.vue:87` |
| 22 | L-21 Ctrl+Enter 双绑定：菜单 accelerator 与渲染层 keydown 重复（两侧均有守卫） | `main/index.ts:113`、`App.vue` keydown |
| 23 | L-22 ConfigPanel watch 噪音日志（8 个 watch、13 处 append）挤占 500 条日志缓冲 | `ConfigPanel.vue:52-160` |
| 24 | P2-9 ConfigPanel 仍 1231 行，未拆分 | `ConfigPanel.vue` |
| 25 | P2-10 stageAddedPaths 三处复制（+GlobalDropMask 内联版）；logStore.append timestamp 样板约 30 处 | `App.vue:193`、`ConfigPanel.vue:159`、`HeroEmpty.vue:8` |
| 26 | P2-11 死代码：addLog、planningProgress 无人调用 | `stores/log.ts:36`、`stores/plan.ts:17` |
| 27 | P2-12 快捷键承诺未兑现：Esc / Ctrl+L / Ctrl+, 只有 title 文案无实现，模态无焦点陷阱 | `TaskInspectorDrawer.vue:104`、`SettingsModal.vue:114`、`HeaderBar.vue` |
| 28 | P2-13 getFmtClass 返回 `fmt-default`，CSS 只有 `.fmt-other`，默认格式标签无样式 | `TaskTable.vue:112,584` |
| 29 | P2-14 currentTheme 仅 setup 初始化一次，切主题后打开设置显示旧值 | `SettingsModal.vue:19` |
| 30 | P2-15 中英文混杂（"CPU Mode"、"No logs"），主进程中文日志与 lib 英文日志同屏混排 | `HeaderBar.vue:46`、`LogDrawer.vue:28` |
| 31 | P2-17 无障碍：role="checkbox"/"switch" 的 span 及 dropzone 无键盘操作 | `TaskTable.vue:155,190`、`SettingsModal.vue:225` |
| 32 | P2-18 TaskInspectorDrawer 兜底命令为硬编码伪造（libx265 -crf 23），与所选预设无关 | `TaskInspectorDrawer.vue:29` |
| 33 | P2-19 errCount 滚动后失真；日志焦点过滤 `includes` 前缀误匹配 | `stores/log.ts:20,75` |
| 34 | P2-20 STOPPED 展示不一致：进度归零但完成数保留 | `ExecutionBoard.vue:33-50` |

## 构建与测试

| # | 问题 | 位置 |
|---|------|------|
| 35 | P2-22 构建产物仍含可选 require("picomatch")，外部化配置未显式处理 | `out/main/index.js:12947-12948` |
| 36 | T-3 e2e `retries: 0`，flaky 直接红 | `tests/e2e/playwright.config.ts:15` |
| 37 | T-1 / L-12 渲染层纯函数无单元测试（无 vitest） | `apps/mediac-desktop` |
| 38 | T-2 预设回退链（hevc_2k→h264_2k→[0]）无专项用例 | `test/` |
| 39 | P2-24 e2e 无失败转码用例，对 P0-1/P0-2 场景无断言 | `tests/e2e/specs/` |
| 40 | Q2-2 残留：desktop 侧预设回退仍硬编码（ffweb 副本已随删除消失） | `ffmpeg-service.ts:345-349` |

---

## 建议处理顺序

1. **立即**：#10/#11（S-1/S-2 安全加固）、#1/#3/#4（P1-4/6/7 用户可感知）、#13（L-11 一行改动）
2. **短期**：#2（P1-5 接通或删除）、#5、#6、#9、#14、#16
3. **迭代内**：#7（ffmpeg 捆绑决策）、#12、#15、#17-#20、#36
4. **长尾排期**：渲染层质量项 #21-#34、构建测试项 #35/#37-#40

> 本列表为备忘性质；行号以 2026-09-25 当前 HEAD 为准，后续修复后请同步勾销。
