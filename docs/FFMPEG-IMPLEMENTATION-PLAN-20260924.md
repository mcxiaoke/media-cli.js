# FFmpeg 共享核心与 Electron 实施计划

> **文档版本**：v1.0.0
> **创建时间**：2026-09-24 12:20:49（GMT+8）
> **状态**：执行中
> **评审依据**：`docs/FFMPEG-PLAN-REVIEW-20260924.md`
> **关联计划**：
> - `docs/FFMPEG-CORE-REFACTOR-PLAN-20260924.md`
> - `docs/FFMPEG-ELECTRON-GUI-PLAN-20260924.md`
> - `docs/FFMPEG-EXTRACT-AND-LOG-PLAN-20260924.md`
>
> **执行原则**：先修安全/行为阻断项，再抽取共享核心；先让 CLI 和现有 ffweb 复用 Engine，再实现 Electron；不提前进行全局日志重构或独立 npm 抽包。

---

## 0. 目标和非目标

### 0.1 目标

建立一套 CLI、WebUI、Electron 共用的 FFmpeg 领域核心：

```text
Options -> Scan -> Task -> Plan -> Execute -> Result/Event
```

并保证：

- CLI 与 WebUI 不再复制任务编排逻辑；
- stop/retry/delete-source/override 语义统一；
- Engine 产生结构化结果和事件；
- Electron 只负责 IPC、UI 和桌面生命周期；
- ffmpeg/ffprobe、preset、硬件探测使用同一环境上下文；
- 临时文件、进程和崩溃恢复有明确策略；
- 后续可独立抽包和扩展日志消费者。

### 0.2 第一阶段非目标

本阶段不做：

- Electron UI 页面开发；
- Vue/Pinia/Tailwind 组件实现；
- 全仓库 `debug.js` 替换；
- 独立 `ffmpeg-core` npm 包；
- 改编码器、滤镜、码率或硬件 tier 算法；
- 引入未经验证的 Job Object 包；
- 提交 Git commit 或 push。

---

## 1. 当前已知阻断

- [x] `npm test` 基线中的 ffweb stop 测试失败（第一批已修复并转绿）；
- [x] `--override` 当前没有真正替换旧目标（第一批已修复）；
- [x] ffweb token 未被 API/SSE 统一验证（第一批已修复）；
- [x] ffweb CORS 全开放（第一批已修复）；
- [x] ffweb PowerShell title 存在参数注入风险（第一批已修复）；
- [ ] `runFFmpegCmd()` 仍返回可变 entry；已有 `toRunResult` 过渡适配，Engine 稳定契约待完成；
- [ ] AbortSignal 尚未贯穿 mediainfo/ffprobe；硬件 probe、encode、commit 已支持；
- [ ] preset、ffmpeg/ffprobe、capability cache 仍有全局状态；
- [ ] 当前 npm 门禁不检查 TypeScript/Vue/Electron。

---

## 2. 阶段 0：安全与行为止血

### 2.1 ffweb stop 语义

- [x] 梳理 `ffweb/task_runner.js` 的状态机和 stop API；
- [x] 保证 stop 等待 active task settle；
- [x] pending task 标记为 cancelled；
- [x] 防止 `Promise.all()` 提前 reject 后错误进入完成态；
- [x] 保持已有日志和临时文件清理行为；
- [x] 强化 `test/test_ffweb_flow.js` 的取消断言。

**验收**：

- [x] 收到 PROGRESS；
- [x] 收到 TASK_START；
- [x] task 最终为 cancelled；
- [x] session 最终为 STOPPED；
- [ ] 无 retry/delete-source；
- [ ] 无 ffmpeg 残留进程；
- [x] 无临时文件残留。

### 2.2 override 安全提交

- [x] 核对临时文件命名和最终 rename 流程；
- [x] 保留临时文件写入时的防覆盖保护；
- [x] override=false 在 spawn 前跳过已有目标；
- [x] override=true 在临时结果验证后安全替换旧目标；
- [x] 替换失败时保留旧目标和源文件；
- [x] 只有最终目标验证成功后才设置 success；
- [x] 增加真实内容替换测试。

### 2.3 ffweb 安全修复

- [x] 所有 API/SSE 验证 token；
- [x] 校验 Origin；
- [x] 删除 `Access-Control-Allow-Origin: *`；
- [x] 限制 body、输入数量和输出路径；
- [x] 固定 PowerShell 脚本，通过环境变量传递 title；
- [x] 禁止用户输入拼接 PowerShell 源码；
- [x] 增加认证和 Origin 回归测试。

**阶段 0 验收**：

- [x] `npm test` 全绿；
- [x] `npm run check` 通过；
- [x] `npm run lint` 不新增错误；
- [x] stop、override、ffweb 安全测试通过；
- [x] `docs/CHANGES-20260924.md` 追加本阶段摘要。

---

## 3. 阶段 1：测试 seam 与领域契约

### 3.1 Options

- [x] 新增 `lib/ffmpeg_options.js`；
- [x] 定义规范化 `FFmpegOptions`；
- [x] 分离 CLI yargs schema 与领域 schema；
- [x] 明确 `mode: plan | execute`；
- [x] 明确 `jobs`、preset、outputMode、strict、override、deleteSourceFiles；
- [x] 保留 `--ffargs` 优先级和现有数值校验。

### 3.2 Plan

- [x] 定义 `InternalExecutionPlan`；
- [x] 定义 `PublicPlanSnapshot`；
- [x] 增加 planId/taskId/index/status；
- [x] 明确 skipped/cancelled/failed；
- [x] 禁止将 Set/Map/Error/内部 argv 直接发送到 renderer。

### 3.3 Result/Event

- [x] 定义 `RunResult` 判别联合；
- [ ] 定义 `TaskAttemptResult`；
- [x] 定义 `EngineEvent`；
- [x] 事件包含 runId/taskId/seq/attempt/timestamp；
- [x] 明确 success/failed/skipped/cancelled。

### 3.4 测试 seam

- [ ] 为 buildTask 注入 mediaInfo/musicMeta/fs/hardware/logger；
- [x] 为 scan 注入文件遍历和过滤依赖；
- [ ] 为 execute 注入 fake runner；
- [x] 建立 feature/characterization tests；
- [x] 私有函数测试通过公共测试入口完成，不依赖脆弱的 rewire。

**阶段 1 验收**：

- [x] Options/Plan/Result/Event 有测试；
- [x] InternalPlan 与 PublicSnapshot 有明确投影；
- [x] 不改变现有 CLI 外部参数；
- [x] 不改变编码参数算法。

---

## 4. 阶段 2：抽取共享核心

### 4.1 Scan

- [x] 新增 `lib/ffmpeg_scan.js`；
- [ ] 抽取单文件/目录/多输入/filelist 收集；
- [x] 抽取去重、排序、媒体类型过滤；
- [ ] 抽取 extensions/include/exclude/regex；
- [ ] 抽取 start/count；
- [x] 统一 ScanEntry 结构；
- [ ] 明确不存在路径和无媒体文件语义。

### 4.2 Task

- [x] 新增 `lib/ffmpeg_task.js`；
- [x] 抽取单文件任务构建；
- [ ] 保留 outputMode、字幕、audio extract、metadata、prefix/suffix；
- [ ] 保留临时文件和 skipReason；
- [x] 移除对 GUI/CLI 原始 body 的隐式依赖。

### 4.3 Engine

- [x] 新增 `lib/ffmpeg_engine.js`；
- [x] 使用实例化依赖，不使用模块级 configure；
- [ ] 统一 prepare/run concurrency；
- [ ] 统一 retry/Attempt；
- [x] 统一 stop/cancel；
- [ ] 统一 delete-source 确认；
- [x] 统一 summary/result；
- [ ] 处理异常、取消、空计划、全部跳过和 stale plan。

**阶段 2 验收**：

- [ ] CLI 和 ffweb 对相同输入产生相同 task 集合；
- [ ] dry-run 不写最终产物；
- [ ] strict/retry/cancel/delete-source 语义有测试；
- [ ] task 状态不会因单个异常提前结束 session。

---

## 5. 阶段 3：迁移 CLI 与 ffweb

### 5.1 CLI

- [ ] `cmd/cmd_ffmpeg.js` 改为薄适配器；
- [ ] yargs/描述/交互确认留在 CLI；
- [ ] 调用统一 Options/Scan/Task/Engine；
- [ ] 保留现有 dry-run、错误和退出码；
- [ ] 更新 FFMPEG-USAGE 和 CHANGES。

### 5.2 ffweb

- [ ] `ffweb/task_runner.js` 删除重复扫描和任务构建；
- [ ] 只保留 HTTP/SSE transport 和状态映射；
- [x] 使用 PublicPlanSnapshot；
- [ ] 使用 EngineEvent；
- [ ] 补确认、retry、delete-source、override；
- [ ] 保留 WebUI 功能回归。

**阶段 3 验收**：

- [ ] CLI 全流程回归通过；
- [ ] ffweb 环境、计划、执行、停止、SSE 全流程通过；
- [ ] 不再存在两份 retry/任务构建/汇总逻辑。

---

## 6. 阶段 4：Electron

### 6.1 独立 app package

- [ ] 新建 `apps/mediac-desktop`；
- [ ] 根 CLI 包的 main/bin/files 不变；
- [ ] 配置 electron-vite；
- [ ] 配置 TypeScript/Vue typecheck；
- [ ] preload 使用安全 sandbox 方案；
- [ ] main 设置 contextIsolation/sandbox/nodeIntegration 策略。

### 6.2 安全 IPC

- [ ] `src/shared/contracts.ts`；
- [ ] `src/shared/ipc-channels.ts`；
- [ ] preload 暴露 webUtils 窄接口；
- [ ] 所有 IPC 校验 sender；
- [ ] 所有参数运行时校验；
- [ ] 禁止任意导航/新窗口/外部 URL；
- [ ] 配置 CSP 和 permission deny。

### 6.3 Engine 接入

- [ ] Electron 不直接调用 runFFmpegCmd；
- [ ] Electron 只调用 Engine；
- [ ] 订阅 EngineEvent；
- [ ] 支持 plan snapshot、task status、取消、summary；
- [ ] 支持 renderer reload 后的状态恢复；
- [ ] 处理窗口关闭、托盘、before-quit 和 dispose。

### 6.4 环境与资源

- [ ] 统一解析 ffmpeg/ffprobe；
- [ ] 能力探测和执行使用同一 binary context；
- [ ] preset 从 resources 加载；
- [ ] 不自动信任 cwd preset；
- [ ] capability/probe cache 按 binary/version 隔离。

**阶段 4 验收**：

- [ ] 拖拽文件可获得真实路径；
- [ ] Electron 不出现隐式 Node integration；
- [ ] Engine 与 CLI 行为一致；
- [ ] main/preload/renderer build 通过；
- [ ] Electron E2E 通过。

---

## 7. 阶段 5：进程、恢复与打包

### 7.1 进程生命周期

- [ ] `runFFmpegCmd` 支持 onSpawn/onExit；
- [ ] PID 注册/注销可靠；
- [ ] AbortSignal 贯穿 media probe/hardware probe/encode/commit；
- [ ] pending task 正确 cancelled；
- [ ] 停止后无 ffmpeg 子进程；
- [ ] 用户 Stop、正常退出和 before-quit 可清理。

### 7.2 Windows 进程树

- [ ] 短期使用 `taskkill /T /F` fallback；
- [ ] 不使用 shell 拼接 PID；
- [ ] 不使用阻塞主进程的 execSync；
- [ ] Job Object 作为独立可选增强；
- [ ] 若实现 Job Object，使用 suspended spawn + assign + resume；
- [ ] 不声称未经验证的“0 延迟强杀”。

### 7.3 临时文件恢复

- [ ] session manifest 持久化；
- [ ] 记录 runId/taskId/tempPath/outputPath/createdAt；
- [ ] 成功/失败/取消后移除记录；
- [ ] 启动时只清理 manifest 中精确路径；
- [ ] 不按固定 `%TEMP%` 目录盲删。

### 7.4 打包

- [ ] 决定是否捆绑 ffmpeg/ffprobe；
- [ ] ffmpeg/ffprobe 使用 extraResources；
- [ ] native modules 正确 rebuild/unpack；
- [ ] 确认 FFmpeg GPL/nonfree/libfdk_aac 许可；
- [ ] 生成 notices；
- [ ] Windows Authenticode 签名；
- [ ] NSIS/Portable 产物；
- [ ] 干净机启动测试。

**阶段 5 验收**：

- [ ] 用户停止后无残留进程；
- [ ] 主进程异常退出的行为符合实际声明；
- [ ] 临时文件恢复不误删其它任务；
- [ ] Portable/NSIS 在干净 Windows 环境可运行；
- [ ] 许可和签名资料齐全。

---

## 8. 阶段 6：日志与独立抽包

### 6.1 日志

- [ ] 先以 EngineEvent 作为 FFmpeg 日志来源；
- [ ] `debug.js` 保持兼容 façade；
- [ ] import 不创建目录、不注册 process handler；
- [ ] consumer 支持 flush/flushSync/close；
- [ ] record 有 schemaVersion/seq/runId/taskId；
- [ ] JSONL stdout 纯净；
- [ ] 脱敏完整路径、argv、metadata、command；
- [ ] GUI/SSE 有背压和丢弃策略。

### 6.2 独立包

- [ ] 无 mediac 固定目录依赖；
- [ ] 无全局 setFFmpegPath；
- [ ] 无 debug/i18n/helper/file 的隐式副作用；
- [ ] preset 和 ffmpeg binary context 可配置；
- [ ] package exports 和 dependencies 完整；
- [ ] tarball 安装后有独立测试；
- [ ] CLI、ffweb、Electron 仍共用同一 Engine API。

---

## 9. 第一批实际执行清单

本批次只处理阶段 0 和阶段 1 的必要部分：

- [x] 读取并核对 `ffweb/server.js`、`ffweb/dialog.js`、`ffweb/task_runner.js`；
- [x] 读取并核对 `lib/ffmpeg_run.js`、`lib/ffmpeg_build.js`、`cmd/cmd_ffmpeg.js`；
- [x] 读取并核对 `test/test_ffweb_flow.js`；
- [x] 修复 stop 状态和取消测试；
- [x] 修复 override 最终提交；
- [x] 修复 ffweb token/Origin/CORS/PowerShell 参数边界；
- [x] 增加 RunResult/cancelled/override 测试；retry/delete-source 纳入后续 Engine 测试；
- [x] 增加 scan/task 测试 seam；
- [x] 运行 `npm test`；
- [x] 运行 `npm run check`；
- [x] 运行 `npm run lint`；
- [x] 更新本计划勾选状态；
- [x] 更新 `docs/CHANGES-20260924.md`。

**第一批完成条件**：

```text
现有 P0 行为有明确测试；
stop/override/ffweb security 不再静默失败；
没有开始大规模核心搬迁；
npm test/check/lint 结果已记录；
本计划对应项目已标记完成。
```

---

## 10. 执行记录

| 日期 | 阶段 | 结果 | 备注 |
| :--- | :--- | :--- | :--- |
| 2026-09-24 | 计划创建 | 已完成 | 综合三份评审报告建立实施计划 |
| 2026-09-24 | 第一批 | 已完成 | ffweb 安全、stop/cancel、override、RunResult 过渡适配、scan/task seam；npm test 297/297 通过 |
| 2026-09-24 | 阶段 1A：领域契约 | 已完成 | FFmpeg Options adapters、Internal/Public Plan、EngineEvent、PublicSnapshot；ffweb 已接入 Options/PublicSnapshot；npm test 304/304 通过；Attempt/fake runner/完整 Engine 留待后续 |
| 2026-09-24 | 阶段 2A：共享执行 Engine | 已完成 | 新增实例化 `ffmpeg_engine`，统一队列、状态、取消、summary、RunResult 和 EngineEvent；ffweb 执行循环已切换；npm test 307/307 通过；retry/delete-source/完整 prepare 留待后续 |

---

## 11. 状态更新规则

每完成一个可独立验证的步骤，必须同步更新：

1. 本计划对应 checkbox；
2. `docs/CHANGES-YYYYMMDD.md` 顶部变更摘要；
3. 测试/检查命令和结果；
4. 若发现计划与代码事实冲突，先记录偏差，不静默改变范围。

未经明确确认，不执行：

- `git commit`；
- `git push`；
- FFmpeg 编码/滤镜参数调优；
- 大规模无关重构；
- 删除现有用户文档。
