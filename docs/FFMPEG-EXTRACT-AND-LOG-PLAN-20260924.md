# FFmpeg 抽取时机 与 Log 可插拔化 评估

> **文档版本**：v1.0.0
> **创建日期**：2026-09-24
> **状态**：评估与建议（未动代码）
> **关联**：`docs/FFMPEG-CORE-REFACTOR-PLAN-20260924.md`（主重构方案）
> **回答两个问题**：
> 1. 先做现有重构、还是先抽 ffmpeg 独立包？
> 2. Log 能否改为可注册、可 JSON 输出？

---

## 第一部分：抽取时机 —— 先重构，但重构时预留抽取边界

### 1.1 结论

**不要先抽包，也不要"做完重构再抽"，而是：按现有方案重构，但在重构时把"抽取边界"作为设计约束写进接口。**

原因：**如果现在按"一个包"去抽，你会把 mediac 的通用模块一起拖走，得到一个虚胖的包；如果先重构再抽，则重构产出的接口天然就是包边界，抽取变成"改 import 路径"。**

### 1.2 实测依赖图（抽取障碍的量化）

我逐个核对了 ffmpeg 相关模块的 import，结果比预期好：

| ffmpeg 模块 | 依赖的 mediac 通用模块 | 抽取难度 |
| :--- | :--- | :--- |
| `lib/ffmpeg_bin.js` | **无**（仅 fs/which） | ✅ 直接可抽 |
| `lib/arg_parser.js` | **无**（零依赖） | ✅ 直接可抽 |
| `lib/hwaccel.js` | `debug` + `hwdetect` + `gpu` | 🟡 需带 gpu |
| `lib/hwdetect.js` | `debug` + `ffmpeg_bin` + `gpu` | 🟡 需带 gpu |
| `lib/preset_loader.js` | `debug` + `preset_schema` | 🟡 需带 schema |
| `lib/ffmpeg_presets.js` | `preset_loader` + `helper.parseBitrate` | 🟡 单函数依赖 |
| `lib/ffmpeg_plan.js` | `core` + `helper` + `debug` + `hwaccel` | 🟠 依赖面较宽 |
| `lib/ffmpeg_build.js` | `core` + `encoding` + `helper` + `debug` + `presets` | 🟠 依赖面最宽 |
| `lib/ffmpeg_run.js` | `helper` + `debug` + `file` + `i18n` + build/plan/hwdetect/hwaccel | 🟠 依赖面最宽 |

**通用模块规模（潜在搬迁面）**：

```
lib/core.js       611 行     lib/encoding.js     491 行
lib/helper.js     921 行     lib/gpu.js          462 行
lib/i18n.js      1253 行     lib/preset_schema.js 164 行
lib/file.js       396 行     lib/mediainfo.js    225 行
```

### 1.3 三个真实障碍

**障碍 1：`lib/helper.js`（921 行）是"瑞士军刀"，会被整包拖走**

`ffmpeg_build.js` / `ffmpeg_plan.js` / `ffmpeg_run.js` 都用 `helper`，但只用到其中一部分（`humanSize` / `humanSeconds` / `humanTime` / `pathShort` / `pathSplit` / `textHash` / `isVideoFile` / `isAudioFile` / `isMediaFile` / `parseBitrate`）。抽包时要么整包拖走 921 行，要么做符号级拆分。

**障碍 2：`lib/debug.js` 有 import 期副作用，且被 37 个模块依赖**

```javascript
// lib/debug.js
setupLogger()                                    // ← import 即执行
function setupLogger() {
    fs.mkdirsSync(getLogRootDir())               // ← import 即创建目录
    ...
}
process.on("exit", () => { flushFileLogSync() }) // ← import 即注册全局处理器
```

这直接引出你的第二个问题——**log 必须先解耦，否则抽包时会把"mediac 日志目录"和"全局 exit 处理器"一起带进新包。**

**障碍 3：`lib/i18n.js`（1253 行）为极少量 key 被拖入**

实测 ffmpeg 全模块的 i18n key 用量：

| 模块 | key 数 |
| :--- | :--- |
| `lib/ffmpeg_build.js` | 4 |
| `lib/ffmpeg_run.js` | 5 |
| `lib/hwaccel.js` | 1 |
| `lib/preset_loader.js` | 1 |
| `lib/ffmpeg_presets.js` | 1 |
| `lib/ffmpeg_plan.js` / `hwdetect.js` / `ffmpeg_bin.js` | 0 |

**为了约 12 个 key，拖进一个 1253 行的双语模块。** 这是抽包时最该先切的一刀。

**障碍 4：路径与命名硬编码 `mediac`**

```javascript
// lib/debug.js:116
path.join(os.tmpdir(), "mediac")

// lib/preset_loader.js:53-54
path.join(os.homedir(), ".mediac", "presets.yaml")
```

抽包后这些必须参数化，否则两个包会抢同一个目录。

### 1.4 建议的路径

```
现在 ──→ 阶段 0-6（主重构方案）──→ 抽包
         ↑
    把"抽取边界"作为设计约束
```

**在重构时加三个约束，让后续抽包几乎零成本：**

1. **新模块（`ffmpeg_options` / `ffmpeg_scan` / `ffmpeg_task` / `ffmpeg_engine`）不 import `debug.js`**，改为通过 hooks 的 `onLog` 输出。这样编排层天然零日志耦合。
2. **`i18n` 在引擎层改为注入**：`engine.configure({ t })`，默认透传 identity 函数。抽包时传自己的翻译表，不传就英文原文。
3. **`debug.js` 的路径与副作用参数化**（见第二部分）。

做完这三点，抽包工作 ≈ 改 import 路径 + 补一个 `package.json`。

---

## 第二部分：Log 可插拔化 —— 可以做，而且应该做

### 2.1 现状诊断

`lib/debug.js`（536 行）目前是**六种职责混在一个模块里**：

| 职责 | 相关导出 | 问题 |
| :--- | :--- | :--- |
| 1. 级别化 logger | `log`, `setLevel`, `getLevel`, `trace`…`error` | 基于 loglevel，正常 |
| 2. 彩色终端输出 | `showRed`/`showGreen`/`showYellow`…（9 个） | 硬编码 chalk，无法关闭 |
| 3. 分类前缀输出 | `logWithTag`, `LogCategory`, `logSuccess`…`logFail`（13 个） | 全部直写 `console.log` |
| 4. 文件日志 | `fileLog`, `flushFileLog`, `fileLogPath` | 硬编码 `os.tmpdir()/mediac` |
| 5. 目录副作用 | `setupLogger` → `mkdirsSync` | **import 即创建目录** |
| 6. 全局 exit 钩子 | `process.on("exit", …)` | **import 即注册** |

**核心问题**：**没有"日志消费者"抽象。** 所有输出路径都是硬编码的 `console.log` + `fs.appendFile`，无法注册新消费者（JSON 输出、SSE 推送、内存环形缓冲）。

**注意 `ffweb/task_runner.js` 只用了 1 处 log** —— 因为它自己造了一套 `appendLog()` + `this.recentLogs` 环形缓冲（551 行里的 57-72 行）。**这就是缺少消费者抽象的代价：每个前端都自己重造一遍日志收集。**

### 2.2 目标设计：注册式日志总线

```javascript
// lib/log/index.js —— 新的日志门面（保持现有导出名，兼容存量调用）
const consumers = new Set()

/**
 * 注册日志消费者。返回注销函数。
 * @param {Object} consumer
 * @param {string} consumer.name        - 标识，用于去重/注销
 * @param {string[]} [consumer.levels]  - 关心的级别，缺省全部
 * @param {Function} consumer.write     - (record) => void
 */
export function addConsumer(consumer) {
    consumers.add(consumer)
    return () => consumers.delete(consumer)
}

// 统一记录结构（这是 JSON 输出的基础）
function emit(level, category, tag, args) {
    const record = {
        ts: new Date().toISOString(),
        level,                        // 'INFO' | 'WARN' | 'ERROR' | ...
        category,                     // 'TASK' | 'SKIP' | 'SUCCESS' | ...
        tag,                          // 'FFConv' | 'FFCMD' | 'Prepare' | ...
        message: formatArgs(args),    // 纯文本（人类可读）
        data: args.length === 1 && typeof args[0] === 'object' ? args[0] : undefined,
    }
    for (const c of consumers) {
        if (c.levels && !c.levels.includes(level)) continue
        try { c.write(record) } catch { /* 消费者异常不影响主流程 */ }
    }
}
```

**内置消费者（各自独立文件）**：

| 消费者 | 用途 | 替代现状 |
| :--- | :--- | :--- |
| `consoleConsumer` | 彩色终端输出 | 现有 `showXxx` / `logWithTag` |
| `fileConsumer` | 追加写文件（现有缓存+阈值落盘逻辑平移） | 现有 `fileLog` |
| `jsonConsumer` | **JSONL 行式输出** | **新增** |
| `bufferConsumer` | 内存环形缓冲（供 GUI 快照） | `task_runner.recentLogs` |

**CLI 用法**：

```bash
mediac ffmpeg ./video.mp4 --preset hevc_2k --log-format json      # JSONL → stdout
mediac ffmpeg ./video.mp4 --preset hevc_2k --log-format json --log-file run.jsonl
mediac ffmpeg ./video.mp4 --preset hevc_2k --quiet                # 只留 file consumer
```

**GUI 用法**：

```javascript
const unregister = addConsumer({
    name: 'sse',
    write: (record) => broadcastSSE('LOG', record),   // 直接拿结构化 record
})
```

**抽包用法**：新包只注册自己的消费者，不碰 mediac 的目录与 exit 钩子。

### 2.3 副作用治理

| 现状 | 改法 |
| :--- | :--- |
| `import` 即 `mkdirsSync` | 改为**惰性**：首次真正写文件时再建目录 |
| `import` 即 `process.on('exit')` | 改为 `enableExitFlush()` 显式开启，由 `index.js` 调用 |
| `os.tmpdir()/mediac` 硬编码 | 改为 `configure({ rootDir })`，默认沿用 `mediac` 保持兼容 |
| 9 个 `showXxx` 硬编码 chalk | 保留为 `consoleConsumer` 的语法糖；`NO_COLOR` / 非 TTY 自动降级 |

**关键约束**：`lib/debug.js` 被 **37 个模块**依赖。所以必须**保留现有全部导出名**，新架构在内部替换实现。这样存量调用零改动，可以渐进迁移。

### 2.4 为什么现在做、而不是抽包时做

**因为 log 是抽取的障碍之一（1.3 障碍 2），也是 GUI 重复实现的根因（`task_runner` 自己造了环形缓冲）。**

先做 log 可插拔化，收益是三重的：
1. **抽包**：新包不再被 `os.tmpdir()/mediac` 与全局 exit 钩子绑架
2. **GUI**：删掉自造日志缓冲，直接注册 SSE 消费者
3. **CLI**：立刻获得 JSON 输出能力（对自动化/CI 有用）

---

## 第三部分：修订后的实施顺序

在原主方案基础上插入 log 重构，并调整顺序：

| 序 | 任务 | 说明 | 复杂度 |
| :--- | :--- | :--- | :--- |
| **0** | 特征测试护栏 | 原方案阶段 0，不可省 | ★★☆ |
| **1** | **Log 可插拔化（本方案第二部分）** | **提前做**：它是抽取障碍 + GUI 重复根因 | ★★★ |
| 2 | 选项层 `ffmpeg_options.js` | 原阶段 1；**不 import debug** | ★★☆ |
| 3 | 扫描层 `ffmpeg_scan.js` | 原阶段 2 | ★☆☆ |
| 4 | 任务构建层 `ffmpeg_task.js` | 原阶段 3（核心） | ★★★★ |
| 5 | 编排层 `ffmpeg_engine.js` | 原阶段 4；**i18n 改为注入** | ★★★★ |
| 6 | GUI 接入统一引擎 | 原阶段 5；**顺带删自造日志缓冲** | ★★★ |
| 7 | 收敛清理 | 原阶段 6 | ★☆☆ |
| **8** | **抽取为独立包** | 此时 ≈ 改 import + package.json | ★★ |

**为什么 log 排在 1 而不是更后**：它是后续所有步骤的"公共依赖"。如果先做引擎再改 log，引擎里会散落大量 `log.xxx` 调用，回头还得再改一遍。**先立总线，后面全走总线。**

---

## 第四部分：风险提示

| 风险 | 说明 | 对策 |
| :--- | :--- | :--- |
| **37 个模块的兼容性** | `debug.js` 被广泛依赖，改坏影响全工具 | 保留全部导出名；新架构内部替换；逐模块渐进迁移 |
| **日志顺序** | 引入消费者后，异步消费者可能打乱顺序 | 同步 `write` 契约；异步消费者自行排队 |
| **退出时丢日志** | 现在靠 `process.on('exit')` 兜底 | `enableExitFlush()` 由 `index.js` 显式调用，行为不变 |
| **JSON 输出污染 stdout** | JSONL 与人类日志混写会破坏管道解析 | `--log-format json` 时自动关闭 console consumer 的彩色输出 |
| **抽包后的目录冲突** | 两个包都用 `~/.mediac` | 抽包时把 `rootDir` / preset 路径全部参数化（本方案 2.3 已覆盖） |

---

## 结论

**问题一**：**先按现有方案重构，不要先抽包。** 但重构时把"抽取边界"当设计约束——新模块不碰 `debug.js`、i18n 走注入、路径参数化。做完之后抽包 ≈ 改 import 路径。

**问题二**：**Log 应该改，而且应该提前到重构第 1 步做。** 它既是抽取的障碍（import 期副作用 + 硬编码路径），也是 GUI 重复造日志缓冲的根因。设计要点是**注册式消费者总线 + 统一 record 结构**，JSON 输出只是其中一个内置消费者。必须保留 `debug.js` 现有导出名以兼容 37 个依赖模块。
