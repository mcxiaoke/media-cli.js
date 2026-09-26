# 转码核心重构与桌面端演进实施方案（方向 1-2-3）

- **日期**：2026-09-26（GMT+8）
- **版本**：v1.0
- **依据**：`docs/FFMPEG-REVIEW-20260926.md`（§B3/B5/C6/A9）与 `docs/ARCHITECTURE-MAINTENANCE-PLAN-20260925.md`
- **实施原则**：按**风险从高到低**逐步实施；每阶段保持 100% 独立验证、向后兼容，不引入任何行为漂移。

---

## 目录与风险定级

| 阶段 | 对应方向 | 核心目标 | 风险评级 | 关键影响面 |
|---|---|---|:---:|---|
| **阶段一** | **方向 2** | 契约与输入统一（消除 `directories` 语义双写，修复 B5） | **高** | CLI 与 Desktop 扫描入口契约、下游任务收集与去重 |
| **阶段二** | **方向 1** | 转码核心高内聚纯化（`ffmpeg_run.js` 与 `ffmpeg_build.js` 拆分） | **中高** | 实时转码调度、流式进度计算、错误日志提取、命令行拼装 |
| **阶段三** | **方向 3** | 桌面端大组件解耦与增强（SFC 组件拆分、试运行 Dry-run、状态恢复） | **中** | `TaskTable.vue`、`ConfigPanel.vue`、主进程状态恢复 IPC |

---

## 阶段一（高风险）：统一 `directories` 与 `inputs` 契约（B5 修复）

### 1.1 现状与缺陷诊断

在前期评审（`FFMPEG-REVIEW-20260926` §B5）中已指出输入语义双写的缺陷：
1. `src/transcode/ffmpeg_options.js` 的 `normalizeInputs(inputs, directories)` 已在规范化阶段将 `directories` 并入 `inputs`；
2. 但 `toLegacyArgvOptions` 转换时又因 `OPTION_KEYS` 不含 `directories` / `inputs` 而将其剥除；
3. 导致 `cmd/cmd_ffmpeg.js:447-458` 必须手工打补丁，把 `argv.directories` 重新塞回 `mergedArgv`；
4. `src/transcode/ffmpeg_scan.js` 的 `collectCliInputEntries(root, argv, ...)` 又针对 `argv.directories` 做了**二次遍历**与拼接；
5. 结果：CLI 的 `directories`（额外根目录）与 Desktop 的 `inputs: string[]`（统一路径清单）存在语义脱节。

### 1.2 实施方案

1. **统一输入入口为 `inputs: string[]`**：
   - 让 `collectCliInputEntries` 接受标准的 `inputs: string[]`（当传入单个 string 时自动归一为数组）；
   - 内部按遍历规则对全部根路径（文件或目录）统一扫描并去重，不再单独维护 `argv.directories` 的二次外挂扫描；
2. **规范化输出保留 `inputs`**：
   - `normalizeCliOptions` 与 `normalizeDesktopOptions` 统一产出 `normalized.inputs`；
   - `toLegacyArgvOptions` 明确保留 `inputs` 数组属性，消除 `cmd/cmd_ffmpeg.js` 中的手工补丁；
3. **兼容性保障**：
   - CLI 依然接受 `--directories` 选项，但在 yargs 解析后立即并入 `inputs`，保持用户 CLI 参数语法 100% 兼容。

### 1.3 验证门禁

- `npm test`（重点覆盖 `test_ffmpeg_options.js`、`test_ffmpeg_scan.js`、`test_ffmpeg_parity.js`）；
- CLI 测试：同时测试单文件、单目录、多目录（`--directories`）扫描，确认产出任务数与去重正常；
- 桌面端 E2E：`npm run desktop:test:e2e`（验证输入收集与去重用例 04-ingest 正常）。

---

## 阶段二（中高风险）：转码核心层高内聚纯化（方向 1）

### 2.1 `src/transcode/ffmpeg_run.js` (927 行) 解耦

#### 职责拆分方案

`ffmpeg_run.js` 目前集成了 4 类完全不同的职责，按高内聚原则切分：

```text
src/transcode/
├── ffmpeg_progress.js    # [NEW] 纯文本流解析：progress/stderr 正则匹配、平滑速率、ETA 计算 (~230 行)
├── ffmpeg_error.js       # [NEW] 错误提取与持久化：exitCode 判定、报错特征提取、writeErrorReport (~180 行)
└── ffmpeg_run.js         # [MODIFY] 进程执行调度：execa 包装、信号处理、临时文件管理、runFFmpeg 主入口 (~520 行)
                          # re-export 进度与错误工具函数，保证零破坏兼容
```

1. **`ffmpeg_progress.js`**：
   - 包含：`PROGRESS_LINE_RE`、`parseProgressLine`、`createProgressTracker`、`formatSpeed`、平滑采样逻辑。
   - 特性：纯数据流解析，无外部 IO，无系统调用。
2. **`ffmpeg_error.js`**：
   - 包含：`extractErrorInfo`、`isRecoverableDecodeError`、`writeErrorReport`、错误日志归档格式化。
   - 特性：错误诊断纯逻辑与错误报告文件写入。
3. **`ffmpeg_run.js`**：
   - 包含：`runFFmpeg`、`runFFmpegCmd`、`registerTempFile`、`cleanupTempFiles`、`installTempCleanupHooks`。
   - 对外全量 re-export 子模块符号，保持测试用例（如 `test_ffmpeg_run.js`）零感知。

### 2.2 `src/transcode/ffmpeg_build.js` (873 行) 提纯

#### 职责拆分方案

提取字幕与元数据辅助能力，使主体聚焦于命令拓扑生成：

```text
src/transcode/
├── ffmpeg_tags.js        # [NEW] 字幕格式降级判断、MKV 统计标签清理、元数据参数拼装 (~160 行)
└── ffmpeg_build.js       # [MODIFY] 命令行结构拼装：输入侧、三段滤镜、视频参数、音频参数、拍平 (~710 行)
```

1. **`ffmpeg_tags.js`**：
   - 提取：`shouldDegradeSubtitle`、`buildSubtitleArgs`、`buildMetadataArgs`、`buildStripTagsArgs`。
2. **`ffmpeg_build.js`**：
   - 专注于命令行参数主体拓扑（`createFFmpegArgs`、`buildVideoArgsFromPlan`、`flattenArgs`）。

### 2.3 验证门禁

- `npm test`（335 用例全绿）；
- `npm run check`（130+ 文件语法检查通过）；
- `npm run lint`（0 error / 0 warning）；
- `npm run desktop:typecheck`（0 error）；
- CLI dry-run 验证命令行一致性。

---

## 阶段三（中风险）：桌面端大组件解耦与增强（方向 3）

### 3.1 前端大组件解耦（SFC 瘦身）

1. **`TaskTable.vue` (1560 行) 拆分**：
   - 提取 `TaskContextMenu.vue`（~250 行）：将 15+ 项右键菜单交互、快捷键响应抽成独立弹层组件；
   - 提取 `useTaskSelection.ts`（~160 行）：将表格多选（Shift 连选、Ctrl 增减、全选、键盘 Arrow 导航）封装为独立 Pinia/Composable 逻辑；
   - `TaskTable.vue` 行数压缩至 1100 行左右，专注于表格主体渲染与状态绑定。
2. **`ConfigPanel.vue` (1251 行) 拆分**：
   - 提取 `CommandPreview.vue`（~180 行）：将底部的动态命令推演、复制命令、基准命令提示拆成独立组件；
   - `ConfigPanel.vue` 行数压缩至 1050 行左右，专注于配置表单与滑块逻辑。

### 3.2 桌面端能力增强（C6 & A9 遗留落地）

1. **C6 桌面端试运行（Dry-run 入口）**：
   - 在底栏「开始转换」旁增加「试运行（测前10帧）」菜单项/开关；
   - 触发时向主进程传递 `dryRun: true`，主进程以 `ffmpeg -frames:v 10 -f null -` 模式执行，只验证硬件加速与滤镜兼容性，不产生实际大文件产物。
2. **A9 状态恢复接口**：
   - 主进程 `ffmpeg-service.ts` 暴露 `execution:get-status` IPC 通道；
   - 渲染层在挂载时主动查询当前是否有活跃会话，避免误触发 reload 后状态脱钩。

### 3.3 验证门禁

- `npm run desktop:lint` 与 `npm run desktop:typecheck` 0 错误；
- `npm run desktop:test:e2e`（全部 Playwright E2E 测试通过）；
- 手动启动应用验证右键菜单、多选及试运行功能。

---

## 实施路线图与回退方案

1. **执行次序**：
   - 第一步：实施阶段一（输入契约统一），运行根测试与 E2E；
   - 第二步：实施阶段二（转码核心拆分），运行根测试与 E2E；
   - 第三步：实施阶段三（桌面端组件拆分与增强），运行 E2E 验证。
2. **安全与回退**：
   - 每个子阶段独立执行、独立验证、独立记录 `docs/CHANGES-YYYYMMDD.md`；
   - 任何阶段测试不通过则利用 git 恢复单阶段改动，不跨阶段污染。
