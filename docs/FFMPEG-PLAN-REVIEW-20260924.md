# FFmpeg 重构与 Electron 实施计划综合评审报告

> **文档版本**：v1.0.0
> **评审时间**：2026-09-24 12:13:16（GMT+8）
> **状态**：评审完成 / 建议合并修订后实施
> **评审对象**：
> - `docs/FFMPEG-CORE-REFACTOR-PLAN-20260924.md`
> - `docs/FFMPEG-ELECTRON-GUI-PLAN-20260924.md`
> - `docs/FFMPEG-EXTRACT-AND-LOG-PLAN-20260924.md`
> - `cmd/cmd_ffmpeg.js`
> - `ffweb/*`
> - `lib/ffmpeg_*.js` 及其依赖
> - `test/test_ffweb_flow.js` 等现有测试
>
> **评审基线提交**：`f749759d955383714866d838f5acc091d5b02481`
> **说明**：本报告只做架构、代码、测试、安全与打包可行性评审，不包含本轮代码修改。

---

## 0. 执行摘要

### 0.1 总体结论

三份计划的共同方向基本正确：

1. CLI、WebUI 和未来 Electron GUI 不应各自维护一套 FFmpeg 编排逻辑；
2. 应将选项、扫描、任务构建、执行、重试、取消、删源和汇总抽到共享核心；
3. Electron 主进程可以直接复用 Node.js ESM 业务逻辑，Electron 是当前合理的桌面技术路线；
4. 独立 npm 包与全局日志重构可以保留为后续目标，但不应成为 Electron 第一阶段的前置条件。

但是，**三份文档当前不是同一个架构的不同阶段，而是三套相互冲突的方案**。其中存在模块命名、接口签名、职责边界、构建入口、资源定位、状态机和测试策略的直接冲突。现有示例代码也包含无法编译、不会执行、被静默忽略或不安全的设计。

因此最终判定如下：

| 评审项 | 判定 | 说明 |
| :--- | :--- | :--- |
| 抽取共享 FFmpeg Engine | **Go** | 能根治 CLI 与 WebUI 的业务分叉 |
| CLI/GUI 薄适配器方向 | **Go** | 正确解耦方向 |
| Electron 技术路线 | **Go** | 与当前业务能力匹配 |
| 抽取独立 npm 包 | **条件 Go** | 应在核心边界稳定且出现第二个包级消费者后实施 |
| 全局 `debug.js` 日志总线 | **条件 Go** | 应独立实施并提供完整兼容层 |
| 当前三份计划直接照做 | **No-Go** | 存在多项 P0 冲突与安全阻断 |
| Electron 文档“实施就绪”状态 | **撤回** | 当前更接近概念验证草案 |
| 现有 ffweb 继续开放 API | **No-Go** | 修复认证、CORS 与 PowerShell 注入问题前不建议使用 |

### 0.2 最高优先级阻断项

实施前必须优先解决以下问题：

1. **现有 `ffweb` 存在未认证 API、全开放 CORS 和 PowerShell 参数注入风险**；
2. **`npm test` 当前不是绿色基线**，WebUI stop 状态断言失败；
3. **当前 `--override` 实际没有覆盖旧目标**，会完成昂贵转码后删除新临时产物；
4. **三份计划的模块、API、Hook 和状态模型互相冲突**；
5. **当前 `runFFmpegCmd()` 没有稳定的 `RunResult`、取消和进程生命周期契约**；
6. **Electron 的 `onSpawn` 当前不存在，ProcessGuard 示例不会登记任何 PID**；
7. **Electron 初始化可能让能力探测与真实执行使用不同的 ffmpeg/ffprobe**；
8. **预设路径在 electron-vite 打包后会失效，且桌面端自动信任 cwd 预设不安全**；
9. **全局日志、ffmpeg binary、preset 和 probe cache 使所谓“纯可复用 Engine”仍受宿主全局状态污染**；
10. **现有 npm 脚本无法检查 TypeScript、Vue、preload、renderer 和打包结果**。

### 0.3 最应保留的设计

以下内容值得保留，但需要按本报告修订：

- 共享 FFmpeg 编排核心；
- 领域 Options 与 CLI/Web adapters 分离；
- plan 阶段与 execute 阶段分离；
- 内部执行对象与公开 IPC DTO 分离；
- Task 与 Attempt 分层；
- `AbortSignal` 贯穿整个执行链；
- 结构化 EngineEvent，而不是简单字符串日志回调；
- Electron main/preload/renderer 分离；
- 默认 dry-run 和危险操作显式确认；
- Windows 进程树与孤儿进程问题被正式纳入设计；
- 日志 import 副作用治理；
- 独立包边界意识；
- 特征测试和干净机打包验证。

---

## 1. 评审范围、方法与验证基线

### 1.1 评审范围

本报告覆盖：

- 三份 FFmpeg 计划文档的架构、接口、阶段顺序和工作量；
- CLI 与 `ffweb` 的编排逻辑分叉；
- FFmpeg 底层模块的依赖、状态和生命周期；
- 预设加载和 electron-vite/electron-builder 打包兼容性；
- Electron main/preload/renderer 安全边界；
- Windows 进程守护、Abort、临时文件和崩溃恢复；
- 日志可插拔化与 JSONL 输出；
- 独立 npm 包的可行边界；
- 当前测试覆盖、测试有效性和新增门禁；
- 外部依赖版本与 Node/Electron 版本要求。

### 1.2 评审方法

采用了以下方法：

- 阅读三份计划全文；
- 逐段核对 CLI、WebUI、FFmpeg 底层模块、debug、i18n、helper 等源码；
- 对比计划中的模块名、函数名、参数签名和示例 import；
- 核对 `ffweb/server.js`、`ffweb/dialog.js` 的认证、CORS 和 PowerShell 调用；
- 核对 `presets/default.yaml`、preset loader 和 electron-vite bundle 资源路径；
- 核对 `runFFmpegCmd()` 的所有 return/catch/abort 路径；
- 对照 Electron 官方 `webUtils`、ESM、sandbox、ASAR、安全和进程文档；
- 核对 2026-09-24 的主要 npm dist-tag；
- 运行现有语法检查和测试基线。

### 1.3 当前验证结果

#### 语法检查通过

```text
npm run check

Node 24.21.0 satisfies engines "node": ">=20"
All 108 *.js passed node --check
```

#### 测试基线未通过

```text
npm test

tests 287
pass 285
fail 2
```

失败集中在：

```text
test/test_ffweb_flow.js:174
AssertionError: Status should be stopped, got RUNNING
```

Node 将失败测试和其父 suite 分别计入失败，因此显示 `fail 2`；根因集中在 WebUI 停止流程的状态/时序问题。

此外，当前取消测试允许：

```javascript
["STOPPED", "COMPLETED", "IDLE"]
```

即使任务已经完成、根本没有发生有效取消，测试也可能通过。因此需要同时修正实现与测试断言，不能只把等待时间调长。

### 1.4 当前门禁盲区

现有命令：

```text
npm test       -> node --test "test/*.js"
npm run check  -> 只检查 .js/.cjs/.mjs
npm run lint   -> 只扫描 .js
```

无法发现：

- TypeScript 编译错误；
- Vue SFC/template 错误；
- Electron preload 错误；
- renderer build 错误；
- main/preload/renderer bundle 错误；
- ASAR 和 extraResources 配置错误；
- packaged app 启动错误。

---

## 2. 当前代码的真实架构与主要事实

### 2.1 CLI 与 WebUI 确实存在业务分叉

当前：

```text
cmd/cmd_ffmpeg.js
  ├─ yargs/argv
  ├─ 输入扫描
  ├─ preset 类型过滤
  ├─ include/exclude/start/count
  ├─ outputMode
  ├─ prepareFFmpegCmd
  ├─ dry-run
  ├─ 确认
  ├─ 并发
  ├─ retry
  ├─ delete-source
  └─ summary

ffweb/task_runner.js
  ├─ 自己的输入扫描
  ├─ 自己的 mergedArgv
  ├─ 自己的 createPlan
  ├─ 串行执行
  ├─ 自己解析日志
  └─ 自己维护 recentLogs/status
```

CORE 文档指出的“业务逻辑分叉”是客观存在的，抽取共享 Engine 有明确价值。

### 2.2 `lib/` 不是完全纯函数层

部分算法模块确实较为纯净，例如 FFmpeg 参数和滤镜计算，但整个可达依赖链包含：

- 文件系统 IO；
- ffprobe/ffmpeg 外部进程；
- preset 加载和全局 Map；
- debug import 副作用；
- i18n；
- process signal/exit handler；
- 模块级 ffmpeg 路径；
- 硬件能力和 probe cache。

因此“底层模块零修改直接复用”和“纯业务逻辑 100% 原生复用”表述过度乐观。更准确的说法是：

> FFmpeg 编码/滤镜/码率决策算法可最大程度复用，但宿主 IO、进程、日志、缓存和生命周期需要显式适配。

### 2.3 当前 `runFFmpegCmd()` 的真实接口

见 `lib/ffmpeg_run.js:91-112`：

```javascript
{
  showBar = true,
  onProgress = null,
  onLog = null,
  signal = null
}
```

当前不存在：

- `onSpawn`；
- `onExit`；
- 稳定的 `RunResult`；
- taskId/runId；
- attempt；
- stage 化错误；
- cancelled 与 failed 的可靠区分。

### 2.4 当前 progress/log 回调是底层原始形态

`onProgress` 大致包含：

```javascript
{
  percent,
  speed,
  currentTime,
  srcDuration,
  entry
}
```

`onLog` 只收到原始字符串或 stderr chunk。

WebUI 当前自行补充：

- taskIndex；
- total；
- currentFile；
- 日志前缀分类。

因此 CORE 计划中“已有回调直接复用”需要一层 Engine 适配，而不是直接透传。

### 2.5 当前存在重要模块级全局状态

主要包括：

- `ffmpeg_run.js` 的模块级 `ffmpegPath` 和 `setFFmpegPath()`；
- `hwdetect.js` 的全局 capabilities cache；
- `hwaccel.js` 的全局 probe cache；
- `ffmpeg_presets.js` 的全局 preset Map；
- `preset_loader.js` import 时计算的搜索路径；
- `mediainfo.js` import 时的 ffprobe/mediainfo 探测；
- `debug.js` import 时创建目录并注册 process handler。

这些状态与“每个 Engine 可独立创建、可测试、可嵌入 Electron”不兼容。

---

## 3. 当前代码与产品行为中的 P0 问题

### 3.1 ffweb 未认证 API、全开放 CORS 和本地高权限操作

### 位置

- token 生成：`ffweb/server.js:38`
- URL token：`ffweb/server.js:79-84`
- CORS：`ffweb/server.js:142-150`
- API 路由：`ffweb/server.js:210-268`
- 可配置监听 host：`cmd/cmd_ffweb.js:32-35,107-110`

### 问题

服务虽然生成 token，但 API/SSE 路由没有统一验证 token，同时：

```text
Access-Control-Allow-Origin: *
```

`/api/plan` 和 `/api/task/start` 能接收输入和输出路径并启动真实任务。恶意网页可能从浏览器访问本机服务并触发本地任务。

### 建议

修复前：

1. 暂停或移除 ffweb 对外能力；
2. 至少只监听 loopback；
3. 不要认为 loopback 本身能防御恶意网页；
4. 所有 API/SSE 强制验证 token；
5. 校验 `Origin`；
6. 删除 `Access-Control-Allow-Origin: *`；
7. 限制请求体、文件数量、路径范围和并发；
8. Electron 不复用 HTTP API。

### 3.2 PowerShell title 参数注入

### 位置

- HTTP body title：`ffweb/server.js:236-243`
- PowerShell 插值：`ffweb/dialog.js:51-75,81-108`

### 问题

title 被插入 PowerShell 双引号字符串。PowerShell 会展开 `$()` 等子表达式，仅转义普通双引号不足以阻止命令执行。

### 建议

- 使用固定 `.ps1`；
- 通过 `-File` 执行；
- 用户值通过参数文件、临时 JSON 或环境变量传递；
- 用户输入不得成为 PowerShell 源码。

### 3.3 WebUI stop 状态与测试基线失败

### 位置

- `test/test_ffweb_flow.js:148-182`
- 实际失败断言：`test/test_ffweb_flow.js:174`

### 问题

停止后状态仍为 `RUNNING`。同时测试允许 `COMPLETED/IDLE`，不能证明发生了有效取消。

### 建议验收

- 收到 PROGRESS；
- 收到 TASK_START；
- 任务最终为 cancelled；
- batch/session 最终 STOPPED；
- 没有 retry；
- 没有 delete-source；
- ffmpeg 进程已退出；
- 临时文件已清理；
- 收到取消和 summary 事件。

### 3.4 `--override` 当前没有真正覆盖旧目标

### 位置

- override 准备逻辑：`cmd/cmd_ffmpeg.js:987-1008`
- 临时文件参数：`lib/ffmpeg_build.js:299-320`
- 最终目标存在处理：`lib/ffmpeg_run.js:272-281`

### 当前行为

1. override 允许任务通过准备阶段；
2. ffmpeg 写入唯一临时文件；
3. 转码成功后检测到旧 `fileDst` 存在；
4. 删除新临时文件；
5. 不替换旧目标；
6. 不设置成功状态。

这会浪费一次完整转码并保留旧文件。

### 正确语义

```text
唯一临时文件 + -n
  -> 转码成功
  -> 验证临时文件存在且非零
  -> override=false: 保留旧目标并报告冲突
  -> override=true: 安全、原子替换旧目标
  -> 替换成功后才标记 success
```

必须保证：

- 新转码失败时旧目标仍在；
- 替换失败时旧目标仍在；
- 替换失败不得删源；
- 只有最终目标验证成功才允许删源。

### 3.5 `runFFmpegCmd()` 状态由可选布尔值拼接

当前不同路径会设置：

- `ok`；
- `ffmpegFailed`；
- `ffmpegError`；
- `skipped`；
- 或直接返回 `undefined`。

Abort 也被 catch 为普通失败。Electron 示例所谓“从返回值判断成功”并没有建立新契约，因为返回值本身就是 entry。

### 必须改为判别联合

```typescript
type RunResult =
  | { status: 'success'; outputPath: string; bytes: number }
  | { status: 'failed'; stage: 'plan'|'spawn'|'encode'|'commit'; error: string }
  | { status: 'skipped'; reason: string }
  | { status: 'cancelled'; reason: string }
```

所有代码出口必须显式 return。

### 3.6 Abort 没有贯穿 probe 和 commit

当前问题：

- 外部 signal listener 未移除；
- media probe 没有 signal/timeout；
- hardware probe 不接收 signal；
- probe 最长可能等待 15 秒；
- abort 与子进程成功退出竞态时仍可能提交文件；
- commit 前未再次检查 aborted。

### 建议

signal 必须贯穿：

```text
scan -> media probe -> hardware probe -> encode -> commit
```

并在 `finally` 移除 listener。取消必须映射为 `cancelled`，不得计为 failed。

### 3.7 ffweb 自身还有 preset/字段错误

静态审计发现：

- `getAllPresets()` 返回 Map，但 fallback 使用 `allPresets[0]`；
- 输出扩展名使用 `activePreset.ext`，实际字段是 `format`；
- 串行执行；
- 缺 retry、outputMode、字幕 `subs/` 等 CLI 能力。

因此不能把 ffweb 当前实现逐段翻译成 Electron；应只迁移其 transport/UI 思路，业务逻辑统一来自 Engine。

---

## 4. 三份计划之间的直接冲突

### 4.1 模块命名冲突

CORE：

```text
lib/ffmpeg_options.js
lib/ffmpeg_scan.js
lib/ffmpeg_task.js
lib/ffmpeg_engine.js
```

ELECTRON：

```text
lib/ffmpeg_orchestrator.js
buildConversionTasks()
```

如果都实施，会形成两个编排事实源。

### 决策

采用 CORE 的分层模块；Electron 只调用 Engine。不要新增平行的 `ffmpeg_orchestrator.js`。

### 4.2 Hook 契约冲突

CORE 定义：

```javascript
onProgress(p)
onLog(level, tag, message)
```

当前底层是：

```javascript
onProgress({ percent, speed, currentTime, srcDuration, entry })
onLog(rawLine)
```

日志计划又提出大写 level，而现有 debug 导出是小写方法。

### 决策

保留两层：

```text
ffmpeg_run raw adapter
ffmpeg_engine EngineEvent
```

不要让单文件执行器承担 GUI/任务语义。

### 4.3 Options 层与 yargs 冲突

CORE 计划把 yargs builder schema 移入共享 `lib/ffmpeg_options.js`。这会让独立包反向依赖 CLI 框架、描述和 i18n。

### 决策

```text
FFmpegOptions             共享领域契约
normalizeCliOptions()     CLI adapter
normalizeWebOptions()     Web/Electron adapter
yargs builder             留在 cmd 层
```

### 4.4 plan/confirm 阶段冲突

CORE 示例在 `planTasks()` 内等待确认；GUI `createPlan()` 又要等 plan 返回后前端才能展示确认内容，容易形成握手或死锁。

### 决策

```text
preparePlan()  -> 只生成 plan，不确认，不执行
presentPlan()  -> adapter 展示，用户批准
executePlan()  -> 执行，开始/retry/delete-source 在执行阶段确认
```

### 4.5 “纯 JSON plan” 与当前 entry 冲突

当前 entry 可能包含：

- fs.Stats；
- FFmpegPreset 实例；
- argv；
- hwPlan；
- Set；
- 错误对象；
- 执行期可变字段。

WebUI 当前已经手工做 public projection。

### 决策

明确分离：

```text
InternalExecutionPlan
PublicPlanSnapshot
```

### 4.6 日志顺序冲突

日志计划把全局日志总线提前到阶段 1；CORE 又要求部分底层模块保持不动。结果会同时存在：

- 旧模块直接写 debug；
- 新 Engine 写 Hook；
- WebUI 自己写 recentLogs；
- Electron 再建立一套日志流。

### 决策

先定义 FFmpeg EngineEvent；全局 debug 总线作为独立后续项目。不要在同一个阶段全仓库迁移。

### 4.7 Electron 自己维护第二套调度器

ELECTRON 示例自己使用 `p-limit`、调 `runFFmpegCmd()`、维护 summary 和状态；这会重新复制 ffweb 的编排分叉。

### 决策

Electron TaskRunner 只负责 IPC、事件转发和窗口生命周期。并发、重试、状态、删源和 summary 全部由 Engine 管理。

### 4.8 i18n/configure 方案冲突

Extract 文档提出全局：

```javascript
engine.configure({ t })
```

CORE 没有对应入口，而且模块级可变配置不利于多 Engine 和测试。

### 决策

采用实例化依赖：

```javascript
createFFmpegEngine({
  translate,
  logger,
  mediaProbe,
  binaryResolver,
  presetStore,
  deleteSource
})
```

---

## 5. CORE 重构方案详细评审

### 5.1 P1：扫描层不能只抽 `collectInputEntries()`

完整扫描还包括：

- 多输入；
- filelist；
- 路径去重；
- preset 类型过滤；
- extensions/include/exclude；
- 排序；
- start/count；
- info 早退；
- 不存在路径与无媒体文件的错误区分。

### 建议统一 ScanEntry

```javascript
{
  root,
  path,
  name,
  stats,
  size,
  ctime,
  mtime,
  isFile,
  isDir,
  index
}
```

### 5.2 P1：`prepareFFmpegCmd()` 不能逐行不变直接复用

当前函数隐式依赖：

- `entry.argv.decodeMode`；
- `entry.argv.outputMode`；
- chalk；
- MediaInfo；
- music-metadata；
- fs；
- hardware detection；
- global logger/i18n。

WebUI `mergedArgv` 没有完整字段，直接调用可能在：

```javascript
entry.argv.decodeMode.toUpperCase()
```

处报错。

而且该函数当前是私有函数，模块只导出 CLI command 字段。

### 建议

先建立测试 seam：

```javascript
buildTask(input, {
  getMediaInfo,
  readMusicMeta,
  detectHardwareCapabilities,
  exists,
  stat,
  onEvent
})
```

再抽到 `ffmpeg_task.js`。

### 5.3 P1：Options 规范化不完整

必须明确：

- undefined/null/0/false；
- 显式 0 与未设置的区分；
- `--ffargs` 优先级；
- preset 初始化时机；
- outputMode 默认；
- GUI 显式 execute mode；
- 文件路径检查属于 options 还是 scan；
- jobs 的来源只保留一处。

### 5.4 P1：并发策略不能压成一个 jobs

当前 CLI 至少有：

- prepare/probe 并发；
- run 并发；
- UNC 默认；
- 视频默认 1；
- 音频默认 4。

建议：

```javascript
{
  prepareConcurrency,
  runConcurrency
}
```

GUI adapter 显式决定默认值。

### 5.5 P1：重试必须建模为 Attempt

当前 retry 包含：

- 仅 ffmpeg failure；
- strict/dry-run 不重试；
- 重新 prepare；
- CPU fallback；
- 串行；
- retry 成功后参与删源。

建议：

```text
Task
├── Attempt 1: hardware
└── Attempt 2: CPU fallback
```

并分离：

- `onTaskAttemptDone()`；
- `onTaskDone()`。

### 5.6 P1：早期退出路径未定义

包括：

- show-presets；
- invalid preset；
- empty input；
- info；
- all skipped；
- user cancel。

建议明确 plan status：

```text
empty | ready | info | invalid | cancelled
```

或把 show-presets/info 保留在 CLI adapter，不进入通用 Engine。

### 5.7 P1：阶段顺序不能保证独立验证

推荐新顺序：

```text
0A 修复现有 Bug
0B 建立测试 seam
0C 建立正确行为基线
1  定义 Options/Plan/Event/RunResult
2  统一 scan
3  统一 task
4  实现 engine 安全语义
5  CLI adapter
6  ffweb adapter
7  Electron adapter
8  日志/抽包/清理
```

### 5.8 P2：`lib/cli_hooks.js` 层级不合适

CLI hooks 依赖 inquirer、readline、终端和 CLI 确认，应放在：

```text
cmd/ffmpeg_hooks.js
```

而不是共享 `lib/`。

### 5.9 P2：`cancelPlan(controller)` 过度抽象

更简单：

```javascript
const controller = new AbortController()
await runPlan(plan, { signal: controller.signal, hooks })
controller.abort()
```

规划阶段也接受同一个 signal，不另建隐式全局 cancel。

---

## 6. Electron 方案详细评审

### 6.1 P0：webUtils 必须在 preload 中调用

删除：

```typescript
window.webUtils
file.path
```

使用窄接口：

```typescript
contextBridge.exposeInMainWorld('api', {
  resolveDroppedFiles(files: File[]): string[] {
    return files.map(file => webUtils.getPathForFile(file)).filter(Boolean)
  }
})
```

### 6.2 P0：示例 import 路径错误

从 `src/main/services/task_runner.ts` 到根 `lib/` 应是：

```typescript
../../../lib/...
```

原方案的：

```typescript
../../../../lib/...
```

会越过仓库根目录。

类型应放：

```text
src/shared/contracts.ts
src/shared/ipc-channels.ts
```

并使用 `import type`，不要从 `preload/index.d.ts` 普通 import。

### 6.3 P0：根 package 不能直接改成 Electron 入口

建议独立：

```text
apps/mediac-desktop/
```

保留根 `mediac` 的 CLI `main/bin/files`。

### 6.4 P0：TypeScript 门禁缺失

新增：

```text
typecheck
vue-tsc
lint:ts
lint:vue
build:electron
test:electron
package:win
```

### 6.5 P0：sandbox preload 与 ESM

推荐：

- main：按 electron-vite 5 正确构建；
- preload：bundle 为 CJS；
- renderer：Vite ESM；
- sandbox/contextIsolation 开启；
- nodeIntegration 关闭。

### 6.6 P0：Preset 资源定位失效

Electron 不应依赖 bundle 后 `import.meta.url` 查找内置 preset。

推荐：

```text
builtin: process.resourcesPath/presets/default.yaml
user: app.getPath('userData')/presets.yaml
project: 用户显式导入
```

不自动信任 cwd preset。

### 6.7 P0：ffmpeg/ffprobe 可能不一致

新增 EnvironmentService，统一解析：

- app resources；
- `FFMPEG_PATH`；
- `FFMPEG_BINARY`；
- PATH；
- 同目录 ffprobe；
- 版本和 build；
- 同一 binary context。

### 6.8 P0：onSpawn 不存在

增加：

```typescript
onSpawn(child)
onExit(metadata)
```

并保证 untrack。Probe 子进程也要纳入监督。

### 6.9 P0：ProcessGuard 与临时文件恢复不成立

- 正常任务结束必须 untrack；
- 不用 `execSync` 阻塞主进程；
- 不用 shell 拼 `taskkill`；
- 记录 executable/startTime；
- 使用 session manifest 精确恢复临时路径；
- Job Object 需要 suspended spawn 后再加入，或明确删除强制崩溃清理承诺。

### 6.10 P1：硬件 DTO 与真实结构不一致

当前真实 caps 包括 Set、build、vendor、filters、gpus 等；计划 DTO 包含未实际探测的 decoders。

建议建立唯一：

```typescript
toHardwareCapsDto(rawCaps)
```

### 6.11 P1：缓存未按 binary/version 隔离

caps/probe cache 至少按：

```text
canonical ffmpeg path
version
build configuration
```

隔离。切换 binary 时清理相关缓存和旧 plan。

### 6.12 P1：IPC 缺 task status 和 snapshot

增加：

- `onTaskStatusChange`；
- `onTaskEvent`；
- `getTaskSnapshot()`；
- planId/batchId；
- task revision；
- renderer reload 恢复。

### 6.13 P1：生命周期不完整

需要：

- `TaskRunner.dispose()`；
- 幂等 stop；
- before-quit 等待；
- renderer crash/reload；
- 单实例锁；
- powerSaveBlocker.stop()；
- progress bar reset；
- 关闭窗口策略。

### 6.14 P1：Electron 安全基线

必须明确：

- CSP；
- contextIsolation；
- sandbox；
- nodeIntegration=false；
- sender 校验；
- IPC runtime schema；
- navigation 限制；
- window.open deny；
- permission deny；
- shell.openExternal allowlist；
- 不以管理员权限运行。

### 6.15 P1：打包与许可证

需要明确：

- ffmpeg/ffprobe 是否随包；
- extraResources；
- ASAR/unpack；
- native ABI；
- FFmpeg GPL/nonfree 和 libfdk_aac；
- notices；
- Authenticode；
- Portable/NSIS；
- 干净机测试。

### 6.16 P2：依赖版本过时

2026-09-24 重新评估：

| 依赖 | 文档版本 | 建议 |
| :--- | :--- | :--- |
| electron | 未列 | 使用当前受支持稳定版并锁定 |
| electron-vite | 2.3.x | 重新评估 5.x |
| electron-builder | 24.x | 使用当前 26.x 安全线 |
| electron-store | 8.2.x | 重新评估 11.x |
| p-limit | 5.x | 重新评估 7.x |
| radix-vue | 未固定 | 评估当前维护项目 Reka UI |
| TypeScript/vue-tsc | 缺失 | 必须加入 |

### 6.17 P2：5～7 天估算偏低

应拆成：

1. 技术原型；
2. 内部可用版；
3. 可发布版。

正式版还要覆盖安全、崩溃、打包、签名、许可、干净机和多版本硬件回归。

---

## 7. 抽包与日志方案详细评审

### 7.1 实际依赖比计划更宽

### 直接依赖缺失

- `ffmpeg_plan.js` 还依赖 `music-metadata`；
- `ffmpeg_build.js` 还依赖 `hwaccel`；
- `ffmpeg_run.js` 还依赖 chalk、cli-progress、dayjs、execa、fs-extra、file、i18n 等；
- preset loader 还依赖 js-yaml；
- 未来编排器会依赖 mediainfo、rename、command_utils、errors、config、file、helper。

### helper/core/encoding 不应整包搬运

- helper 实际只需要少量函数，而且 helper 自己依赖 debug；
- core 实际只需要 format/round/filter 等少量工具；
- encoding 实际只需要两个媒体标签校验函数，却会拖入 iconv/config/unicode/debug；
- ffmpeg_run 当前从 file 只需要两个大小常量。

### 结论

“抽包几乎只改 import”不成立。必须拆小工具和依赖端口。

### 7.2 新模块不直接 import debug 仍不够

现有底层模块仍直接 import debug：

- hwaccel；
- hwdetect；
- gpu；
- preset_loader；
- ffmpeg_plan；
- ffmpeg_build；
- ffmpeg_run；
- helper。

因此传递依赖仍会创建 mediac 临时日志目录并注册 exit handler。

### 7.3 i18n 统计不准确

计划称底层使用约 12 个 key，实际列出的底层模块中主要只有 ffmpeg_run 使用一个 key；而 CLI cmd_ffmpeg 有大量 t() 调用。

这说明应先决定独立包是否包含编排和用户可见错误。建议核心返回：

- error code；
- details；
- adapter 负责翻译。

### 7.4 模块级 configure 不适合多 Engine

应使用实例依赖，不使用模块级全局 configure。

### 7.5 日志 record 设计不完整

当前草案问题：

- category 实际是对象，不是字符串；
- `formatArgs()` 没有定义；
- 任意对象直接进入 data；
- Error/Set/Map/BigInt/循环引用不安全；
- 多 consumer 共享可变 record；
- 没有 seq/runId/taskId；
- 没有 schemaVersion；
- 预着色字符串可能把 ANSI 写入 JSON；
- 完整 argv/命令/metadata 存在隐私风险。

建议最小结构：

```javascript
{
  schemaVersion: 1,
  seq,
  runId,
  taskId,
  timestamp,
  level,
  category,
  tag,
  message,
  data
}
```

data 必须白名单投影和安全序列化。

### 7.6 consumer 契约缺少生命周期

至少需要：

```javascript
{
  name,
  levels,
  write(record),
  flush(),
  flushSync(),
  close()
}
```

`process.on('exit')` 只能执行同步 flush，且宿主显式启用。

### 7.7 consumer name 没有真正使用

`Set` 按对象 identity 注册，文档声称的 name 去重没有实现。异步 rejection 也不会被同步 try/catch 捕获。

### 7.8 JSON stdout 仍会被绕过

直接来源包括：

- console.warn；
- cli-progress；
- show*；
- logWithTag；
- ffmpeg stderr；
- help/error。

JSON 模式必须从入口明确关闭 human 输出，并保证 stdout 每行独立 JSON.parse 成功。

### 7.9 日志文件与 GUI 路由未定义

当前 WebUI 和 ffmpeg_run 都可能 fileLog，若 bus 再广播会产生重复。需要统一：

```text
record -> console
       -> file
       -> gui
       -> json
```

每个 record 只能按明确路由写一次。

### 7.10 SSE 缺背压

`client.write()` 返回值未处理。需要：

- ring buffer；
- 批量 IPC；
- 最大队列；
- 丢 debug 保 error；
- dropped count；
- seq 检测缺行。

### 7.11 独立包应最后实施

必须先满足：

- import 不创建 mediac 目录；
- import 不注册 process handler；
- import 不信任 cwd；
- 无全局 setFFmpegPath；
- 无完整 helper/core/i18n/file 强依赖；
- preset 正确打包；
- package exports 和依赖完整；
- tarball import 测试。

---

## 8. 推荐目标架构

### 8.1 推荐仓库结构

```text
media-cli.js/
  cmd/
    cmd_ffmpeg.js
    ffmpeg_cli_options.js
    ffmpeg_hooks.js
  lib/
    ffmpeg_options.js
    ffmpeg_scan.js
    ffmpeg_task.js
    ffmpeg_engine.js
    ffmpeg_events.js
    ffmpeg_run.js
    ...
  ffweb/
    ... transport/UI adapter
  apps/
    mediac-desktop/
      package.json
      electron.vite.config.ts
      electron-builder.yml
      src/
        main/
        preload/
        renderer/
        shared/
```

独立 `ffmpeg-core` npm 包可以在后续阶段增加，不是 Electron 第一阶段必需条件。

### 8.2 Options 契约

```javascript
normalizeCliOptions(argv, deps)
normalizeWebOptions(body, deps)
```

共同输出：

```javascript
{
  schemaVersion: 1,
  mode: 'plan' | 'execute',
  inputs,
  output,
  outputMode,
  preset,
  jobs,
  strict,
  override,
  deleteSourceFiles,
  ...
}
```

yargs builder、alias、描述和 choices 保留在 CLI adapter。

### 8.3 Plan 双层模型

```text
InternalExecutionPlan
  ├─ full preset/runtime context
  ├─ info
  ├─ dstArgs
  ├─ temp path
  └─ internal status

PublicPlanSnapshot
  ├─ planId
  ├─ mode
  ├─ preset summary
  ├─ task summaries
  ├─ total size/duration
  └─ preview command
```

PublicPlanSnapshot 必须可直接 JSON 序列化且不含内部 Set/Map/Error。

### 8.4 Engine 接口

```javascript
const engine = createFFmpegEngine({
  logger,
  translate,
  binaryResolver,
  mediaProbe,
  presetStore,
  deleteSource,
  clock
})

const plan = await engine.prepare(rawOptions, {
  signal,
  onEvent
})

const result = await engine.execute(plan, {
  mode: 'execute',
  concurrency,
  signal,
  confirm,
  onEvent
})

engine.cancel()
await engine.dispose()
```

### 8.5 状态模型

Runner/session：

```text
IDLE -> PLANNING -> READY -> RUNNING
                              -> STOPPING -> STOPPED
                              -> COMPLETED
                              -> FAILED
```

Task：

```text
PENDING -> PREPARING -> QUEUED -> RUNNING
                              -> RETRYING
                              -> SUCCESS
                              -> FAILED
                              -> SKIPPED
                              -> CANCELLED
```

Attempt 独立记录每次硬件/CPU 尝试。

### 8.6 EngineEvent

建议统一：

```text
plan.ready
task.started
task.attempt.started
task.progress
task.log
task.attempt.done
task.done
task.skipped
task.cancelled
session.summary
session.error
```

所有事件带：

```text
runId, taskId, attempt, seq, timestamp
```

### 8.7 确认请求

```javascript
{
  id,
  kind: 'process' | 'retry' | 'deleteSource' | 'override',
  danger,
  message,
  affectedTasks
}
```

默认策略必须区分：

- 无人值守；
- 显式 auto-confirm；
- 交互确认；
- danger 默认拒绝。

不能通过可选链静默跳过确认。

---

## 9. 推荐执行流程

```text
normalize options
  -> resolve environment/ffmpeg/ffprobe/presets
  -> scan inputs
  -> filter/sort/slice
  -> build tasks
  -> build public plan snapshot
  -> user/adaptor reviews
  -> confirm process
  -> run queue
      -> media/hardware probe with signal
      -> spawn encode
      -> track process
      -> stream progress/events
      -> validate temp output
      -> commit atomic output
      -> optional retry attempt
  -> optional delete-source confirm and delete
  -> summary
  -> dispose
```

---

## 10. 安全整改方案

### 10.1 ffweb

短期：

- 暂停；
- loopback；
- token/Origin；
- 无 CORS *；
- body/path/并发限制。

长期：

- 固定 PowerShell 脚本；
- 参数文件/JSON；
- 统一 Engine；
- Electron 不经过 HTTP。

### 10.2 Electron

- main/preload/renderer 隔离；
- contextIsolation/sandbox；
- CSP；
- sender 校验；
- runtime schema；
- navigation/window/permission 限制；
- 不暴露任意 Electron API；
- path/output/override/delete-source 都需主进程验证。

### 10.3 权限与危险操作

- 永不默认删除源；
- delete-source 每次显式确认；
- override 显式确认；
- 替换失败保留源和旧目标；
- 禁止管理员权限运行，除非有明确需求；
- 不自动执行 cwd 预设中的参数。

---

## 11. 进程、取消与崩溃恢复

### 11.1 正常执行

- signal 进入所有 probe/encode；
- onSpawn 登记 PID；
- onExit/finally untrack；
- commit 前检查 signal；
- session stop 后 pending 标 cancelled；
- 等待所有 active task settled。

### 11.2 Windows 短期方案

- AbortSignal；
- `taskkill.exe /T /F` 通过 `execFile`；
- 不经 shell；
- 不使用 `execSync` 阻塞 UI；
- 保存 PID、exe、startTime；
- 只能声称用户 Stop/正常退出清理。

### 11.3 Windows 强崩溃方案

若需要主进程强杀后立即清理：

- native supervisor/helper；
- CREATE_SUSPENDED；
- AssignProcessToJobObject；
- KILL_ON_JOB_CLOSE；
- ResumeThread；
- Electron ABI/x64/ARM64；
- 签名和 CI。

### 11.4 临时文件恢复

使用持久化 session manifest，精确记录 temp/output/run/task/time；不要按固定目录和模糊文件名盲删。

---

## 12. 打包与资源方案

必须先决定：

1. 是否捆绑 ffmpeg/ffprobe；
2. 使用哪一 build；
3. GPL/nonfree/libfdk_aac 许可义务；
4. 用户 preset 与内置 preset 位置；
5. Portable/NSIS 支持矩阵；
6. 是否签名和自动更新。

资源原则：

```text
presets/default.yaml -> extraResources
ffmpeg.exe/ffprobe.exe -> extraResources（如分发）
native .node -> asarUnpack + Electron rebuild
JS bundle -> asar
```

必须在无系统 Node、无 ffmpeg、无 ffprobe、损坏用户 preset、无硬件、多个 ffmpeg 版本的干净环境验证。

---

## 13. 日志与 JSONL 路线

### 13.1 第一阶段：只做 EngineEvent

- 不改全仓库 debug；
- 不立即做 JSONL CLI；
- 先让 CLI/ffweb/Electron 消费结构化事件。

### 13.2 第二阶段：debug 兼容 façade

- 保留全部导出；
- 行为矩阵测试；
- import 无副作用；
- 显式 exit flush；
- file flush/close；
- consumer map；
- 安全序列化；
- JSON/ANSI 边界；
- SSE 背压。

### 13.3 第三阶段：JSONL

- stdout 只允许 JSONL；
- stderr 允许人类诊断；
- 关闭 progress/human console；
- 默认脱敏；
- 完整 argv/命令需 opt-in；
- 每行可独立 JSON.parse；
- 加 schemaVersion。

---

## 14. 测试策略

### 14.1 阶段 0：现有 Bug

- stop/cancel；
- override；
- ffweb token/Origin/PowerShell；
- preset Map/ext 错误。

### 14.2 Options

- CLI argv；
- Web body；
- ffargs 优先级；
- undefined/0/false；
- jobs；
- outputMode；
- preset；
- execute mode。

### 14.3 Scan

- file/dir/multiple/filelist；
- dedupe/sort；
- include/exclude/extensions；
- start/count；
- missing/empty/invalid；
- video/audio filtering。

### 14.4 Task

- preset type；
- output mode；
- subtitles/subs；
- audio extract；
- target exists；
- temp path；
- metadata/prefix/suffix；
- 0-byte/bad media；
- strict skip。

### 14.5 Engine

- dry-run；
- prepare/run concurrency；
- process confirm；
- retry attempt；
- cancel；
- delete-source；
- override commit；
- all skipped/empty/invalid；
- exception summary；
- stale plan；
- runner dispose。

### 14.6 Environment

- ffmpeg/ffprobe pairing；
- version/build；
- env path；
- resource path；
- binary switch cache invalidation。

### 14.7 Logs

- level/category；
- ANSI；
- Error/Set/Map/BigInt/circular；
- seq/order；
- flush/close；
- JSONL purity；
- redaction；
- SSE backpressure。

### 14.8 Electron

- webUtils drag；
- TS/Vue build；
- IPC sender/runtime validation；
- task status/snapshot；
- reload recovery；
- close/quit；
- powerSaveBlocker；
- progress bar；
- packaged startup。

### 14.9 Process

- PID register/unregister；
- probe cancellation；
- stop tree；
- no ffmpeg after stop；
- temp cleanup；
- manifest recovery；
- Job Object/strong-kill if implemented。

### 14.10 Packaging

- NSIS；
- Portable；
- no system Node/ffmpeg；
- no ffprobe；
- corrupted preset；
- no GPU；
- different build；
- signature；
- license notices。

---

## 15. 修订后的实施路线

### 阶段 0A：安全与现有 Bug 止血

交付：

- ffweb 风险处置；
- stop 状态和测试；
- override 正确提交；
- 完整绿色基线。

验收：

```text
npm test
npm run check
npm run lint
安全回归测试
```

### 阶段 0B：测试 seam

交付：

- 可注入 media probe/hardware/fs/runner；
- buildTask 可测；
- InternalPlan/PublicSnapshot 基础类型。

### 阶段 1：统一契约

交付：

- FFmpegOptions；
- InternalExecutionPlan；
- PublicPlanSnapshot；
- RunResult；
- Task/Attempt 状态机；
- EngineEvent；
- EnvironmentContext。

### 阶段 2：Scan/Task/Engine

按顺序抽取，不同时大范围改编码算法。

### 阶段 3：CLI 切换

保持 CLI 外部行为，只有已确认 Bug 修复允许变化。

### 阶段 4：ffweb 切换

只保留 HTTP/SSE/UI adapter；修复安全边界。

### 阶段 5：独立 Electron app

先搭 shared contracts/preload/main 骨架和安全门禁，再接 Engine。

### 阶段 6：进程监督/恢复

onSpawn/onExit、Abort、manifest、before-quit；Job Object 单独验收。

### 阶段 7：UI

拖入、任务列表、预设、高级参数、日志、进度、停止、失败重试、删源确认。

### 阶段 8：打包/发布

extraResources、native、许可、签名、NSIS/Portable、干净机。

### 阶段 9：日志/抽包

全局 debug 总线和独立 npm 包作为后续独立项目。

---

## 16. 发布前验收标准

### Core

- CLI 和 WebUI 使用同一 Engine；
- 不存在第二套扫描/任务构建/重试逻辑；
- InternalPlan 不直接发 renderer；
- 所有状态有判别联合；
- cancelled 不进入 retry/delete-source；
- override 真正替换并可回滚。

### Environment

- 探测和执行使用同一 ffmpeg/ffprobe；
- binary 切换清缓存；
- preset 资源在 packaged app 可加载；
- 不自动信任 cwd。

### Security

- ffweb token/Origin/CORS/PowerShell 安全；
- Electron sandbox/contextIsolation/CSP；
- IPC sender/runtime validation；
- 无任意 shell/path 权限。

### Process

- stop 后无 ffmpeg；
- 无监听器泄漏；
- 无未登记 PID；
- 无盲删临时文件；
- 崩溃恢复只处理 manifest 精确路径；
- Job Object 声明与实际能力一致。

### Packaging

- Portable/NSIS 可启动；
- 无系统 Node/ffmpeg 仍可运行或给出明确引导；
- native ABI 正确；
- licenses/notices 完整；
- 签名符合发布策略。

### Tests

- npm 原有门禁全绿；
- TS/Vue typecheck 全绿；
- main/preload/renderer build 全绿；
- Electron E2E 全绿；
- packaged smoke 全绿；
- 停止、override、崩溃和恢复均有真实测试。

---

## 17. 需要产品层确认的开放问题

1. `ffweb` 是继续维护、仅开发调试，还是安全修复后下线？
2. Electron 第一版是否只支持 Windows？
3. 是否捆绑 ffmpeg/ffprobe？
4. 使用 GPL、LGPL 还是 nonfree build？
5. 是否允许用户从项目目录导入 preset？
6. override 是原地原子替换，还是保留备份？
7. 关闭窗口时是取消、最小化托盘还是阻止关闭？
8. 是否需要 pause/resume？
9. 是否需要自动更新？
10. JSONL 和完整 ffmpeg 命令是否属于第一版范围？
11. Electron GUI 是否需要完整中英文 i18n？
12. 正式版目标市场和签名证书是否已具备？

---

## 18. 最终建议

### 可以立即开始的工作

- 修复 ffweb 安全问题；
- 修复 stop 和 override；
- 补测试 seam 和基线；
- 编写统一 Options/Plan/Event/RunResult 契约；
- 将三份计划合并为一份主实施计划。

### 暂不应开始的工作

- 按 Electron 示例直接写 TaskRunner；
- 全仓库日志总线替换；
- 抽独立 npm 包；
- 打包 NSIS/Portable；
- 引入 Job Object 原生依赖；
- 在 Internal entry 上直接加 TypeScript `as any`。

### 总体判断

Electron 仍然是最合理的 GUI 技术路线，但正确顺序是：

```text
先修安全和现有 Bug
  -> 统一 Engine 契约
  -> 抽共享核心
  -> CLI/ffweb 验证
  -> 独立 Electron app
  -> 进程与崩溃恢复
  -> 打包发布
  -> 最后日志总线与独立抽包
```

不应先画 UI、再把现有 CLI 分叉直接搬进 Electron。

---

## 19. 主要源码与文档索引

### 计划

- `docs/FFMPEG-CORE-REFACTOR-PLAN-20260924.md`
- `docs/FFMPEG-ELECTRON-GUI-PLAN-20260924.md`
- `docs/FFMPEG-EXTRACT-AND-LOG-PLAN-20260924.md`
- `docs/FFMPEG-WEBUI-PLAN-20260923.md`
- `docs/FFMPEG-USAGE.md`

### CLI/WebUI

- `cmd/cmd_ffmpeg.js`
- `cmd/cmd_ffweb.js`
- `ffweb/server.js`
- `ffweb/dialog.js`
- `ffweb/task_runner.js`
- `ffweb/assets/app.js`

### FFmpeg 核心

- `lib/ffmpeg_options.js`（待新增）
- `lib/ffmpeg_scan.js`（待新增）
- `lib/ffmpeg_task.js`（待新增）
- `lib/ffmpeg_engine.js`（待新增）
- `lib/ffmpeg_run.js`
- `lib/ffmpeg_build.js`
- `lib/ffmpeg_plan.js`
- `lib/ffmpeg_bin.js`
- `lib/ffmpeg_presets.js`
- `lib/ffmpeg_args_known.js`
- `lib/arg_parser.js`
- `lib/preset_loader.js`
- `lib/preset_schema.js`
- `lib/hwdetect.js`
- `lib/hwaccel.js`
- `lib/gpu.js`
- `lib/mediainfo.js`

### 宿主依赖

- `lib/debug.js`
- `lib/i18n.js`
- `lib/helper.js`
- `lib/core.js`
- `lib/encoding.js`
- `lib/file.js`
- `lib/rename.js`
- `lib/command_utils.js`
- `lib/errors.js`
- `lib/config.js`

### 测试

- `test/test_ffweb_flow.js`
- `test/test_ffmpeg_params_v2.js`
- `test/test_ffmpeg_build_filters.js`
- `test/test_ffmpeg_bin_caps.js`
- `test/test_ffmpeg_anime.js`
- `test/test_ffmpeg_t4_forced_encoder.js`
- `test/test_ffmpeg_t5_hw_autofit.js`

### 外部官方依据

- Electron webUtils：<https://www.electronjs.org/docs/latest/api/web-utils>
- Electron Security：<https://www.electronjs.org/docs/latest/tutorial/security>
- Electron ESM：<https://www.electronjs.org/docs/latest/tutorial/esm>
- Electron sandbox：<https://www.electronjs.org/docs/latest/tutorial/sandbox>
- Electron ASAR：<https://www.electronjs.org/docs/latest/tutorial/asar-archives>
- Electron native modules：<https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules>
- Electron powerSaveBlocker：<https://www.electronjs.org/docs/latest/api/power-save-blocker>
- electron-vite guide：<https://electron-vite.org/guide/>
- electron-builder：<https://www.electron.build/>
- Windows Job Objects：<https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
