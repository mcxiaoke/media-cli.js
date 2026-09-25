# MediaCli 架构维护与渐进式简化实施方案

- **版本**：v1.2
- **日期**：2026-09-25 11:42:00（GMT+8）
- **状态**：提案，已完成首轮实证评审与修订；本文不包含代码实施
- **修订说明**：
  1. 明确本地单机应用定位，弱化过度设计的安全假设（防黑客攻破等辞令调整为实用防误触）；
  2. 补齐架构盲区：指出 Electron main 现存对 `lib/mediainfo.js` 的直接引用，规划由 transcode facade 统一导出收口；
  3. 解耦 R4 中路径白名单持久化与 service 运行时会话状态，避免循环依赖；
  4. 细化 R2 `useInputIngest`（明确入参 `string[]`、统一 STALE 回退与通知）与 R3 `createPublicTaskSnapshot` 字段契约；
  5. 明确现有 `createFFmpegEngine` 已是合理粒度，避免在 R5 强行抽象多回调浅包装函数；
  6. [v1.2 第二轮核对] 修正 §4.1 重复语句、R1 `buildCliTask` 事实描述（其生产调用点在 `cmd/cmd_ffmpeg.js`）、R1 改名前提说明（`ffweb` 已移除，仅剩 Desktop 消费者）、R0.4 构建产物排除的实际影响范围；方案方向与阶段划分未变。
- **范围**：根目录 MediaCli CLI、FFmpeg CLI、Electron Desktop
- **前置方案**：`docs/ffmpeg/REFACTOR-STRUCTURE-PLAN-MERGED-20260925.md` 已完成 transcode 目录搬迁与 facade 收口；本文是其后续维护方案，不推翻已落地的目录边界

---

## 1. 结论

当前项目最合适的结构是：

> **一个根 npm 发布单元、一份共享 transcode core、两个宿主适配器。**

```text
普通 CLI / FFmpeg CLI
  index.js + cmd/
          │
          ▼
  src/transcode/index.js（公共 facade）
          │
          ▼
  transcode core + lib/ legacy 共享能力

Electron Desktop
  renderer → preload → main
                         │
                         ▼
               src/transcode/index.js
```

本文不建议：

- 改成 npm workspaces；
- 拆成 `packages/core`、`packages/cli`、`packages/electron`；
- 为所有普通 CLI 命令建立统一领域服务；
- 创建包办输入、状态、进程、UI、删除源文件和生命周期的超级 `TranscodeService`；
- 一次性重写 `lib/`；
- 一次性迁移全部普通 CLI 命令；
- 在架构调整中修改 FFmpeg 编码器、滤镜、码率或硬件 tier 参数。

后续只做两类高收益工作：

1. **减少现有重复与事实源**：renderer 输入胶水、task 投影、状态协议、Electron 大 service；
2. **在出现真实重复后抽取窄 use-case**：优先提供纯函数或薄 factory，不拥有宿主生命周期和 UI。

---

## 2. 当前已验证基线

2026-09-25 本次只读核对时已实际执行：

| 门禁 | 结果 |
|---|---:|
| `npm test` | 320/320 通过 |
| `npm run check` | 125 个 JS 文件通过 |
| `npm run lint` | 通过 |
| `npm --prefix apps/mediac-desktop run typecheck` | 通过 |
| Git 工作区（执行核对命令前） | 干净 |

Electron E2E 在上一轮 transcode 迁移落地时记录为 4/4 通过；正式实施任何新阶段前，必须重新执行，不能把历史结果当作当前基线。

---

## 3. 当前结构与实际职责

### 3.1 普通 CLI

```text
index.js
  → 动态 import cmd/cmd_*.js
  → yargs builder / handler
  → lib/file.js、lib/helper.js、lib/debug.js 等
```

普通命令没有第二个宿主消费者。当前 `cmd_remove.js`、`cmd_pick.js`、`cmd_rename.js` 较大，但不宜因此立即建立全局 service 或大规模搬迁。

### 3.2 FFmpeg CLI

`cmd/cmd_ffmpeg.js` 不是独立程序，而是 `mediac ffmpeg` 子命令：

```text
cmd_ffmpeg.js
  → normalizeCliOptions
  → presets.createFromArgv
  → scanFFmpegInputs
  → prepareFFmpegPlan
  → createFFmpegEngine
  → runFFmpeg
  → deleteCompletedSources
```

### 3.3 Electron Desktop

标准 Electron 三进程结构已经建立：

```text
renderer（Vue/Pinia）
  → preload（contextBridge）
  → main（IPC + ffmpeg-service.ts）
  → src/transcode/index.js
```

作为本地桌面客户端，现有的 `preload`、context isolation、sandbox 以及已知路径打开保护属于良好的防御性编码实践，应当保持稳定。

### 3.4 共享 transcode core

`src/transcode/index.js` 已是 CLI/Electron 访问转码核心的主入口，`test/test_architecture_boundaries.js` 会阻止外部深导入内部文件。

但实测核对发现一处现存穿透：`ffmpeg-service.ts` 仍直接 `import { getMediaInfo } from "../../../../lib/mediainfo.js"`。由于媒体信息提取是转码前置的核心能力，后续应将其通过 `src/transcode/index.js` 导出，切断 Desktop 对 `lib/` 的直接穿透。

---

## 4. 当前主要维护问题

### 4.1 Electron `ffmpeg-service.ts` 职责过多

`apps/mediac-desktop/src/main/ffmpeg-service.ts` 约 824 行，同时负责：

- FFmpeg/FFprobe、preset、hardware 探测；
- 输入 staging 与 metadata 映射；
- plan 创建与 preview；
- runner 状态与执行；
- PID 追踪和强制停止；
- taskbar/防休眠；
- source deletion；
- 原生选择路径持久化与防误触打开校验；
- manifest 原子写入与崩溃恢复。

类名 `FfmpegEnvironmentService` 已不能准确表达这些职责。

### 4.2 renderer 输入 ingestion 重复

以下位置重复执行“保存输入 → IPC staging → 写入 Pinia → 日志/错误处理”：

- `src/renderer/src/App.vue`
- `src/renderer/src/components/ConfigPanel.vue`
- `src/renderer/src/components/GlobalDropMask.vue`
- `src/renderer/src/components/HeroEmpty.vue`

### 4.3 task metadata 存在多份投影

同一组媒体字段在以下位置重复维护：

1. `stageInputs()` 手工构造；
2. `createPlan()` 再次补字段；
3. `createPublicPlanSnapshot()` 再映射一次；
4. `src/shared/contracts.ts` 再声明一次 TypeScript 类型。

字段新增时容易出现“staging 有、plan 无”或“plan 有、IPC 无”。

### 4.4 status 协议存在双口径

内部 Engine 主要使用：

```text
pending / running / done / skipped / failed / cancelled
```

Electron public/renderer 又接受：

```text
success / done
```

当前做法是 main 收到 `task.done` 后把内部 `done` 改写成 `success`，renderer 同时兼容两者。这不是单一状态协议。

### 4.5 CLI 与 Electron 重复高层编排

两边均重复：

```text
normalize
→ preset
→ scan
→ prepare
→ preview
→ engine
→ deletion
```

但两者的输入、确认、dry-run、重试、状态、日志和资源定位并不完全相同，因此只能抽取窄 use-case，不能强行统一完整流程。

### 4.6 transcode 仍依赖 legacy 展示能力

`src/transcode/` 仍间接依赖：

- `lib/debug.js`
- `lib/i18n.js`
- `lib/helper.js`
- `lib/rename.js`
- `lib/file.js`
- `lib/mediainfo.js`

其中部分依赖是过渡期合理复用，但 `ffmpeg_run.js` 的终端进度/信号处理、`ffmpeg_build.js` 的日志副作用、`planner → rename.addEntryProps` 等可以逐步收敛。

本方案不要求一次性纯化 transcode；只在相关模块被修改时提取最小纯能力。

### 4.7 普通 CLI 启动仍会加载 FFmpeg

`index.js` 在 yargs parse 前 await 所有命令模块，而 `cmd_ffmpeg.js` 顶层会执行 `loadYamlPresets()`。因此普通命令也会加载 transcode 并初始化 preset/log 相关模块。

这是启动边界问题，不影响当前功能正确性。由于 yargs builder、help 和 preset choices 都依赖注册期状态，不能用未经原型验证的自写 argv 预解析器仓促处理，应作为独立阶段。

---

## 5. 目标边界

### 5.1 目录保持稳定

```text
mediac/
├── index.js
├── cmd/                         # CLI adapter、交互、展示
├── src/
│   └── transcode/               # FFmpeg 共享 core + 窄 application use-case
├── apps/mediac-desktop/
│   └── src/
│       ├── main/                # Electron host、IPC、状态、manifest
│       ├── preload/             # 安全桥
│       ├── renderer/            # Vue/Pinia
│       └── shared/              # IPC contract
├── lib/                         # legacy 共享层，只减不增
├── presets/
└── assets/
```

本轮不新建泛化的 `core/`、`services/`、`utils/`、`models/` 目录。

### 5.2 依赖规则

```text
cmd / Electron main
  → transcode facade
  → 允许使用明确的 legacy 共享能力

transcode
  → transcode 内部模块
  → 允许渐进使用 lib 中的纯能力
  → 不依赖 yargs、inquirer、Electron、Pinia、Vue

lib
  → 不得依赖 cmd、src、apps

renderer / preload
  → 不得直接依赖根 src、lib、Electron/Node 业务模块
  → renderer 仅依赖 app shared contracts
```

### 5.3 单一事实源

- preset：`presets/default.yaml`
- internal plan：Engine/task objects
- public IPC plan：`createPublicPlanSnapshot()` 唯一投影
- Electron public status：独立且明确的 IPC vocabulary
- runner 生命周期状态：Electron main session state machine
- renderer 展示状态：只消费 IPC 状态与事件，不反向定义 main 状态

---

## 6. 非目标

本方案明确不做：

1. npm workspaces / monorepo package 拆分；
2. 普通 CLI 全部迁移到 `src/`；
3. `lib/helper.js`、`lib/core.js` 一次性粉碎拆分；
4. 全部 transcode 文件重命名或按目录重组；
5. 所有 CLI 命令采用 BaseCommand/Repository/EventBus 框架；
6. 把 Electron `app.getPath()`、`process.resourcesPath` 放进 transcode；
7. 把终端 progress bar 和 renderer progress 合成同一 UI；
8. 让 renderer 直接 import transcode facade；
9. 在结构重构中改变 FFmpeg argv、编码器、滤镜、码率或硬件决策；
10. 没有第二个消费者时创建普通媒体操作的全局 service。

---

## 7. 分阶段实施方案

每个阶段应独立验证、独立回退。以下“提交”仅表示未来实施时的变更边界；本文不执行 commit。

### R0：基线、规则和决策门禁

**目标**：先建立安全网，不改业务行为。

#### 改动

1. 重新执行根项目与 Desktop 全部门禁。
2. 在 `test/test_architecture_boundaries.js` 增加：
   - `lib/` 不得 import `cmd/`、`src/`、`apps/`；
   - Electron renderer/preload 不得 import 根 `src/`、`lib/`；
   - Electron main 不得 import `cmd/`；
   - transcode 外部调用仍只能经 facade；将 `getMediaInfo` 纳入 facade 导出，切断 Electron main 对 `lib/mediainfo.js` 的直连。
3. 根 `package.json` 增加统一入口：
   - `desktop:dev`
   - `desktop:typecheck`
   - `desktop:build`
   - `desktop:test:e2e`
   - `desktop:package:win`
4. `scripts/check_syntax.cjs` 跳过 `out/`、`release/`、`test-results/`，避免扫描构建产物（实测扫描文件数 125 → 121：实际被扫到的只有 `apps/mediac-desktop/out/` 的 4 个 JS，`out/renderer/assets/*.js` 因既有 `assets` 跳过规则本就不参与，`release/`、`test-results/` 暂为空；规则属预防性收口）。
5. 更新 `AGENTS.md` 中关于新边界守卫的简短说明。

#### 路径处理与防误触约定

作为本地个人媒体工具，用户通过原生对话框、文件拖拽或文本输入框提供本地绝对路径均属合法的日常操作。现有的“已知路径白名单”机制定位是**防止调用系统 shell（如打开文件所在目录）时产生误操作**，而非将自身视为防范攻击者的网络沙箱。

因此，无需引入过于复杂的沙箱权限与安全授权流程，在未出现跨端真实复用需求前，不额外抽象泛化的公共 `InputService`，保持现有简单直接的本地路径处理逻辑。

#### 验证

- `npm test`
- `npm run check`
- `npm run lint`
- `npm --prefix apps/mediac-desktop run typecheck`
- `npm --prefix apps/mediac-desktop run build`

#### 回退

本阶段没有数据结构和业务行为变化，可整体回退。

---

### R1：Desktop 术语与历史注释清理

**目标**：删除已不存在的 WebUI/ffweb 语义，不改运行逻辑。

#### 建议改动

| 旧名称 | 建议名称 |
|---|---|
| `normalizeWebOptions` | `normalizeDesktopOptions` |
| `scanWebInputFiles` | `scanDesktopInputFiles` |
| 测试名 `CLI and ffweb...` | `CLI and desktop...` |
| `FfmpegEnvironmentService` | 暂不单独重命名；R4 拆分后改为 `DesktopTranscodeService` |
| `buildCliTask` | 暂不立即重命名；其生产调用点在 `cmd/cmd_ffmpeg.js`，改名须同步 CLI 侧，推迟到 R7 |

同时清理：

- `src/transcode/*.js` 中 WebUI/ffweb 注释；
- `src/transcode/hwaccel.js` 的“草稿、尚未接入”旧注释；
- `lib/media_parser.js` 等仍引用旧 `lib/ffmpeg_*` 路径的注释；
- 测试临时文件/测试名中的 web 术语。

#### 约束

- 只重命名符号和文本；
- 不改 normalize 行为；
- 不改 scan root/filelist/extra directories 语义；
- 不把 CLI 与 Desktop scan 强行合并。

#### 改名前提

前任方案 `docs/ffmpeg/REFACTOR-STRUCTURE-PLAN-MERGED-20260925.md` §5.2 曾明确把这些改名推迟，理由是“CLI/Desktop 扫描入口并非同构，提前抽象成通用名会掩盖真实差异”。该顾虑现已消解：`ffweb` WebUI 已在 `f3c4993` 整体移除，`normalizeWebOptions`、`scanWebInputFiles` 各自只剩 Desktop 一个消费者（`ffmpeg-service.ts`）+ 测试。因此本阶段改为带宿主语义的 `*Desktop*` 名，而不是抹平差异的通用名；CLI 侧 `scanFFmpegInputs` 与 Desktop 侧 `scanDesktopInputFiles` 仍保持两个独立入口。

#### 验证

- 根全量测试；
- Desktop typecheck/build；
- facade import 守卫；
- `test_ffmpeg_contracts.js` 与 `test_ffmpeg_parity.js`。

#### 回退

纯符号变更，可独立回退；不得与 application service 混在同一阶段。

---

### R2：统一 renderer 输入 ingestion

**目标**：删除四处重复胶水，不改变用户流程。

#### 建议位置

```text
apps/mediac-desktop/src/renderer/src/composables/useInputIngest.ts
```

或等价的 Pinia action。优先使用 composable，避免 `config`、`plan`、`log` store 之间产生新的循环依赖。

#### 单一入口职责

```text
ingestPaths(paths: string[])
  → 参数规范化与空值过滤（入参严格要求 string[]）
  → DOM File 转换留在 GlobalDropMask.vue，解出绝对路径后再传给 composable
  → configStore.addInputs(paths)
  → try:
      const res = await window.api.stageInputs(paths)
      if (res.added?.length) planStore.addStagedTasks(res.added)
      if (res.skippedDuplicates > 0) {
        logStore.append({ level: "INFO", message: `跳过 ${res.skippedDuplicates} 个重复添加的文件` })
      }
    catch (err):
      统一记录错误日志并执行 planStore.markStale()，防止状态不一致
```

#### 替换位置

- `App.vue`
- `ConfigPanel.vue`
- `GlobalDropMask.vue`
- `HeroEmpty.vue`

#### 保持不变

- `window.api.stageInputs` IPC contract；
- main 的 `stageInputs()`；
- `stagedEntries` 数据结构；
- STALE 状态语义；
- drop 事件 `.stop` 防冒泡处理；
- 重复路径过滤规则。

#### 验证

新增或扩展 Playwright E2E：

1. 文件选择 staging；
2. 目录选择 staging；
3. drop staging；
4. 空态 CTA staging；
5. 重复路径不重复加入；
6. IPC 失败时三 store 不进入部分更新状态，且 plan 标记为 STALE。

#### 回退

只替换 renderer 调用点；可独立回退，不涉及 main/核心。

---

### R3：统一 public task 投影与状态协议

**目标**：消除 Electron metadata 多次手工映射，并明确 internal/public status 边界。

#### R3.1 公共 task 投影

在 `src/transcode/ffmpeg_plan_snapshot.js` 新增：

```js
createPublicTaskSnapshot(taskOrEntry, index, defaultStatus = "pending")
```

`createPublicPlanSnapshot()` 改为复用该函数。

行为与契约规约：
- **双阶段兼容**：同时支持 Staged Entry（只有 `{ name, path, size, info }`，无目标路径，`status: "staged"`）与 Plan Task（已编排完整字段，`status: "pending"` 等）；
- **状态继承**：显式使用 `taskOrEntry.status || defaultStatus`，保证 staging 阶段传入时稳定保留 `"staged"`，plan 阶段默认为内部状态；
- **数值与空值规约**：统一未探测到的数值回退行为，与现有 `PlanTask` 契约保持一致（缺失数值时回退到 0 或 undefined 的策略两阶段统一），避免 IPC 序列化时 key 丢失引发前端表格渲染异常；
- **内部字段隔离**：不暴露 `argv`、preset 实例、`fileDstTemp`、`hwPlan` 等内部路径与能力对象；`rawMetadata` 保持 JSON 字符串。

Electron：

- `stageInputs()` 使用该函数构造初始公开 task；
- `createPlan()` 删除二次补 metadata 的循环；
- 内部 task 仍可保留 richer fields，但 public snapshot 继续只暴露 JSON-safe 字段。

#### R3.2 状态协议

建议明确两层 vocabulary，而不是强迫内部与 UI 使用同一名字。

内部 Engine 状态保持：

```text
pending / running / done / skipped / failed / cancelled
```

Electron public IPC 状态统一为：

```text
staged / pending / preparing / running / retrying
success / skipped / failed / cancelled
```

唯一映射：

```text
internal done → public success
```

调整范围：

- `src/shared/contracts.ts` 的 `TaskStatus` 删除 public `done`；
- `createPublicTaskSnapshot()` 显式执行 `done → success`；
- main 事件 reducer 不再把同一任务在 `done/success` 间来回改写；
- renderer terminal set 只接受 `success`；
- 兼容旧 `done` 的临时分支在同阶段删除，不长期双兼容。

注意：事件类型 `task.done` 可以保留，因为它是“任务完成事件”；不要把事件名与 task status 混为一谈。

#### 验证

新增测试：

1. `createPublicTaskSnapshot()` 完整字段快照；
2. public snapshot 继续排除内部字段；
3. staged raw entry 能得到与 plan task 一致的 metadata 字段；
4. internal `done` 始终投影为 public `success`；
5. renderer 不再接受/产生 public `done`；
6. late event 不得复活终态任务；
7. partial execution 统计仍只计算已选任务。

#### 回退

- 投影函数可保留兼容 wrapper；
- status 变更必须单独一个变更批次，不与 renderer composable 混合；
- 若 UI 回归，只回退 status 映射，不回退 metadata 投影。

---

### R4：拆分 Electron 宿主 service

**目标**：让 `ffmpeg-service.ts` 只保留 session/staging/plan/execute 协调，不再内嵌环境、路径防误触白名单持久化和 manifest 细节；同时切断对 `lib/mediainfo.js` 的直接穿透引用。

#### 第一版拆分范围

```text
apps/mediac-desktop/src/main/
├── ffmpeg-service.ts          # staged/currentPlan/status/execute 协调与上下文组合
├── ffmpeg-environment.ts      # binary/preset/hardware/system summary
├── path-whitelist.ts          # 原生对话框已选根路径持久化与基础比对
└── ffmpeg-manifest.ts         # 原子 manifest / stale task recovery
```

本阶段暂不强拆 `ffmpeg-execution.ts`。如果完成上述拆分后 service 仍承担过多并发细节，再单独评估；不要为了文件数量继续切碎执行状态机。

#### `ffmpeg-environment.ts`

负责：

- ffmpeg/ffprobe 定位与缓存；
- bundled candidate；
- preset resource candidate；
- hardware capability 缓存；
- `EnvironmentSummary` 构造。

依赖通过 constructor/factory 注入；不要把 `app.getPath()` 传入 transcode core。

#### `path-whitelist.ts`（原 `path-authorization.ts` 实用化）

负责：

- normalized path key（大小写/斜杠标准化）；
- `authorizePaths(paths)`（原生对话框选定根路径添加与去重）；
- `isAuthorizedRoot(targetPath)`（判定路径是否属于已选根或其子路径）；
- authorized path 的本地 JSON 异步持久化与启动恢复。

**解耦约束**：
本模块是纯粹的配置/白名单辅助工具，由 main 注入存储路径，**不持有任何 session 状态**。
复合判定 `isKnownMediaPath(path)` 留在 `ffmpeg-service.ts` 内部，由其组合运行时状态与白名单：
`isStagedEntry(p) || isCurrentPlanFile(p) || pathWhitelist.isAuthorizedRoot(p)`，避免反向引用与职责倒挂。

#### `ffmpeg-manifest.ts`

负责：

- manifest 路径管理；
- managed temp entry 校验；
- 原子 write/rename；
- 清理；
- stale manifest recovery（崩溃残留临时文件清理）。

manifest 格式保持不变，避免数据迁移。

#### `ffmpeg-service.ts`

保留：

- `stagedEntries`；
- `currentPlan`；
- runner status；
- AbortController；
- `stageInputs()`；
- `createPlan()`；
- `startExecution()`；
- `stopExecution()`；
- `dispose()`；
- `isKnownMediaPath()`（组合判定门面）。

**切断 legacy 直连**：
将 `ffmpeg-service.ts` 顶层对 `../../../../lib/mediainfo.js` 的直接引用改为从 `../../../../src/transcode/index.js` 统一导入，使 Desktop 彻底收敛到 transcode facade。

完成拆分后，将类名改为 `DesktopTranscodeService`，导出 singleton 可暂保留 `ffmpegEnvironment` 兼容名；`main/index.ts` 内部统一改用 `transcodeService`。

#### 状态与并发约束

- start/create/stop 状态转换不在本阶段重写；
- 拆分前后事件顺序保持一致；
- 不并行执行 create/stop/dispose 重构；
- manifest clear 仍在 execution finally；
- source deletion 仍显式由 service 调用，不隐式放入 Engine。

#### 验证

- Desktop typecheck/build；
- 现有 E2E 全量；
- 手动验证：路径白名单持久化、manifest 崩溃恢复、stop、PID 清理、重复执行、partial execution；
- Windows `package:win` 后从仓库外 cwd 启动和真实转码。

#### 回退

每个 helper 先通过 factory/实例注入接入 `ffmpeg-service.ts`；若出现回归，可恢复为原 service 内部调用而不改变 public IPC。

---

### R5：窄 transcode application use-case（条件阶段）

**目标**：在 R1-R4 完成后，判断 CLI/Electron 是否仍存在值得共享的同构业务；若现有边界已清晰，则避免过度设计。

#### 现实情况与设计定调

实测审查表明：
1. 现有的 `prepareFFmpegPlan` 已经完成了目标参数的纯计算；
2. 现有的 `createFFmpegEngine({ runTask, onEvent }).execute(plan, options)` 已经将队列、并发、重试与事件状态机做到了高内聚和解耦；
3. CLI 与 Desktop 的核心差异在于**宿主环境生命周期**（CLI 绑定终端 progress bar、信号退出；Desktop 绑定 Taskbar、防休眠、PID 追踪、IPC 事件）以及**确认交互**（CLI inquirer vs Vue 确认框）。

若强行抽象一个拍平的 `executeTranscodePlan`，其参数将包含高达 7 个以上的回调函数（`runTask`, `shouldRetry`, `confirmRetry`, `prepareAttempt`, `onEvent`, `onSummary`, `signal` 等），这直接违反了本方案自身设立的停止条件（“callback 数量接近或超过原始参数”），本质上是无实质收益的薄封装。

因此，**不建议在现阶段额外抽象 `executeTranscodePlan` 浅包装函数**。现有 `prepareFFmpegPlan` + `createFFmpegEngine` 已是合理且稳定的应用层接口。

#### 本阶段执行内容（仅做测试加固）

1. 不变动现有 core 调用模式；
2. 将 `test_ffmpeg_parity.js` 扩展为针对同一组 options/entries 在 CLI 与 Desktop 两种模式下生成的 plan、tasks、argv 快照深度对齐；
3. 确保 CLI dry-run 与 Desktop 执行的核心参数完全同构。

---

### R6：普通 CLI 命令级 lazy loading（独立可选阶段）

**目标**：避免 `mediac move/decode` 等非 FFmpeg 命令加载 transcode/preset。

#### 前置研究

先记录：

- 普通命令冷启动耗时；
- `mediac --help` 耗时；
- `mediac ffmpeg --help` 耗时；
- preset load 日志/文件读取副作用；
- 动态 import 模块数量。

#### 约束

- 不自写一套完整 argv parser；
- 不破坏 aliases、全局 options、help、builder defaults；
- `ffmpeg --help` 必须仍显示全部 options 与 preset choices；
- 无参数、`--help`、`--version` 应有明确行为；
- preset choices 的异步加载时序必须先做原型验证。

可评估的方向：

- yargs 原生支持的 lazy command/module 机制；
- 安全的命令 token 预判后只加载目标命令；
- 把 preset 初始化从模块顶层移到可证明安全的注册/执行阶段。

没有可靠原型和回归测试时，保持现状，不为优化强改。

---

### R7：legacy 与普通大命令的渐进治理

**目标**：只在模块被修改时降低 `lib` 和大命令耦合，不做全仓搬迁。

#### transcode legacy 依赖候选

按实际调用和测试覆盖逐个提取：

1. 从 `lib/rename.js` 提取无写入副作用的 `applyFileNameRules()`；
2. 将 planner 必需的 task context 初始化从 `addEntryProps()` 依赖中解耦；
3. 从 `lib/helper.js` 提取 bitrate、media type 等纯函数；
4. 统一 bit-depth 判定来源，但保持各层不同策略；
5. 将 CLI-only confirm 逻辑迁到 `cmd/support/`，前提是先统一 `lrmove`、`zipu`、`moveup` 的确认入口。

每一项必须独立迁移测试，禁止一次性搬 `lib/`。

#### 普通大命令

只在下一次修改对应命令时拆：

```text
cmd_remove.js
  → cmd/internal/remove/conditions.js
  → cmd/internal/remove/planner.js
  → cmd/internal/remove/executor.js
  → cmd/internal/remove/report.js
```

`cmd_pick.js`、`cmd_rename.js` 同理。只有某个算法出现第二个消费者时，才从 `cmd/internal/` 提升到 `src/<domain>/`。

---

## 8. 验证矩阵

### 8.1 每个阶段的基础门禁

```powershell
npm test
npm run check
npm run lint
npm --prefix apps/mediac-desktop run typecheck
npm --prefix apps/mediac-desktop run build
```

### 8.2 renderer / IPC / 状态阶段

```powershell
npm --prefix apps/mediac-desktop run test:e2e
```

至少覆盖：

- stage file/directory/drop；
- create plan；
- partial execution；
- stop；
- delete-source confirmation；
- retry/failure；
- late event；
- app relaunch。

### 8.3 facade / npm 发布阶段

```powershell
npm run test:package
```

安装态 smoke：

- `mediac --version`
- `mediac --help`
- `mediac ffmpeg --help`
- `mediac ffmpeg --show-presets`
- 普通命令不依赖未发布的 `apps/` 文件

### 8.4 Windows Electron 打包阶段

```powershell
npm run desktop:package:win
```

手动检查：

1. 从仓库外 cwd 启动；
2. 无 FFmpeg 时显示可读错误；
3. 设置 `FFMPEG_PATH` 后完成真实转码；
4. preset 存在；
5. stop 后无残留 ffmpeg 子进程；
6. manifest/临时文件恢复行为不变。

### 8.5 FFmpeg 行为保护

R0-R7 的架构调整不得改变：

- 最终 argv；
- encoder family；
- tier 选择；
- scale/filter；
- bitrate/quality 映射；
- retry 条件；
- source deletion 条件。

若必须修改上述内容，应退出本架构方案，按项目规则使用真机 ffmpeg 和 `data/videos/` 逐项核验。

---

## 9. 风险与控制

| 风险 | 控制措施 |
|---|---|
| status 改名导致 UI 统计/终态错误 | internal/public 明确映射；先加 contract/E2E，再删除 `done` 兼容 |
| task 投影漏字段或丢 key | 统一空值数值回退策略；完整字段快照测试；IPC serializer 保持最终防线 |
| service 拆分引入竞态或反向依赖 | 白名单模块不持有 session 状态；保持事件顺序；stop/create 互斥测试 |
| manifest 拆分损坏恢复 | manifest 格式不变；Windows 重启恢复手工验证 |
| 调度层过早抽象造成参数爆炸 | 保持现有 `prepareFFmpegPlan` + `createFFmpegEngine`，不搞多回调浅包装 |
| renderer composable 引入 store 循环 | composable 统一协调，不让 store 互相 import |
| 未出现真实跨端复用时过早抽象输入层 | 作为本地应用保持现有直接路径处理，不抽无用 InputService |
| lazy loading 破坏 help/choices | 独立阶段；原型、benchmark、完整 CLI 回归后再决定 |
| `lib/` 重构扩散到普通 CLI | 每次只迁移一个纯函数或单命令私有模块 |
| 构建产物进入根 syntax check | R0 排除 `out/release/test-results` |

---

## 10. 回退原则

- R0-R4 每一阶段都应能单独回退；
- 不在同一阶段同时搬目录、改状态协议、重写执行流程；
- manifest schema、IPC channel、preset 格式不在 R0-R4 中变更；
- R5 保持现有调度引擎接口，仅做 parity 测试对齐；
- Electron helper 拆分先内部委托，不删除原行为；
- 普通 CLI 不要求与 FFmpeg 批次绑定发布。

---

## 11. 完成标准

完成 R0-R4 后，应满足：

1. CLI 与 Electron 统一经 `src/transcode/index.js` 访问 transcode（含媒体元数据探测能力，切断 main 对 `lib/mediainfo.js` 的直连）；
2. renderer/preload 不直接依赖根 core 或 Node 业务模块；
3. WebUI/ffweb 旧名称和“草稿未接入”注释清零；
4. renderer 只有一处输入 ingestion 编排，且异常时统一回退 STALE；
5. public task metadata 只有一个投影函数，兼容 staged 与 plan 双阶段；
6. public task status 不再同时接受 `done/success`；
7. Electron service 不再内嵌路径白名单持久化和 manifest 文件格式细节，且白名单模块与 session 会话状态完全解耦；
8. `lib/` 没有新增跨领域职责；
9. 普通大命令没有被无触发条件地全量搬迁；
10. 根测试、lint、check、package smoke、Desktop typecheck/build/E2E 全部门禁通过。

R5-R7 是条件演进或独立加固，不应成为 R0-R4 是否完成的阻塞项。

---

## 12. 推荐首批实施范围

为了控制风险，建议首次只实施：

```text
R0 基线与边界规则完善
  +
R1 Desktop 术语清理
```

两项完成后暂停评审，再进入：

```text
R2 renderer ingestion
  →
R3 task projection/status
  →
R4 Electron service 拆分与 mediainfo 收口
```

这样可以先验证命名和规则不会引入无价值 churn，再处理真正影响维护性的重复与职责问题。R5 仅作为测试 parity 验证加固，无需预先创建新的抽象函数。
