# MediaCli FFmpeg 桌面端 UI/UX 设计稿（交付开发）

> **文档版本**：v1.3.0（v1.2 基础上：新增全域拖放感知与引导大画板、微调参数脏标记与一键还原、任务检查器抽屉取代常驻命令折叠条释放表格视野、状态机引入 STALE 过期平滑容错、失败任务直达关联日志）
> **创建日期**：2026-09-24
> **状态**：定稿（实施就绪）
> **适用范围**：`apps/mediac-desktop` 渲染进程 UI 层
> **配套交付**：交互原型 `ffmpeg-ui-demo/mediac-desktop-ui.html`（模拟数据，演示布局、组件、状态与交互）
> **与其他文档的关系**：本文档**只定义 UI/UX**。技术架构、IPC 契约、主进程/共享编排层一律以 `docs/FFMPEG-ELECTRON-ARCHITECTURE-FINAL-20260924.md` 为准；本文档不推翻其 §2 总体架构、§5 IPC 契约、§6 状态机/事件协议、§8 实现要点。UI 布局与组件为**全新设计**，取代架构文档 §7 的组件方案。
> **硬约束**：预设名单动态渲染（来源 `presets/default.yaml`，**禁止写死**）；参数名使用 `lib/ffmpeg_options.js` 的 `OPTION_KEYS` 白名单；所有转码逻辑在 lib 层，渲染进程只消费快照与事件。

---

## 1. 设计目标与原则

### 1.1 定位

一个**以批处理为核心**的 FFmpeg 转码工作台：用户加入文件/目录 → 选预设 → 微调参数 → 生成计划（dry-run 预览）→ 开始转码 → 查看进度、日志与结果。单窗口、高密度、低干扰。

### 1.2 设计目标

| 目标 | 含义 |
| :--- | :--- |
| 简洁专注 | 主流程落在一个窗口左右两区，杜绝多页面跳转；核心视线集中在批量任务本身 |
| 核心功能齐全 | 覆盖 CLI 全部高频能力：批量输入、预设、视频/音频微调、输出命名、硬件加速、并发、覆盖/删除源/严格模式、计划预览、执行与日志 |
| 统一组件库 | 实现层**统一 Naive UI**（暗色为主、可切亮色、`size="small"` 高密度），杜绝手写 CSS 造轮子；本文档每个控件都标注对应 Naive UI 组件 |
| 现代桌面范式 | 对标 HandBrake / Permute / Linear / VS Code 现代桌面工具：全域拖放、双击查看检查器、按需抽屉、即时反馈 |

### 1.3 设计原则

1. **计划先行**：默认永远先"生成计划"（等价 CLI dry-run），任务表只展示计划产物；"开始转码"必须基于已生成计划。
2. **状态可见与平滑容错**：运行状态机（IDLE→…→COMPLETED + STALE）以顶部胶囊 + 按钮可用性 + 表格状态三重呈现；参数变更标记为 `STALE`（过期）而非粗暴清空已分析好的任务列表。
3. **渐进式披露（Progressive Disclosure）**：右侧大表格拥有 100% 垂直高度；命令预览与元数据对比收进按需呼出的**任务检查器抽屉（Task Inspector）**，避免常驻挤压主视区。
4. **脏状态可视化（Dirty State）**：微调字段与预设默认值对比，改动项高亮微点标记并支持一键还原（Undo），随时清楚哪些参数被自定义。
5. **批量为王**：表格默认全选、支持选中项执行、单项重试/定位/移除；数百文件场景由虚拟滚动兜底。
6. **全域拖放感知**：全窗口任何区域均可响应拖拽投放，空态时呈现大型引导画板（Hero Dropzone）。
7. **危险操作前置确认**：删除源文件（回收站文案）、覆盖已有产物，执行前弹 `NDialog` 确认。

---

## 2. 信息架构与布局

### 2.1 布局总览（1280×820，最小 960×640）

```
┌───────────────────────────────────────────────────────────────────────┐
│ 顶栏 HeaderBar · 品牌 / 环境徽章 / 全局状态胶囊 / 日志按钮 / 侧栏切换 / 设置  52px  │
├────────────────┬──────────────────────────────────────────────────────┤
│ 左栏（380px，   │ 右栏（弹性主工作区）                                   │
│  可拖拽/可收起）│ 顶部工具栏 Toolbar：生成/更新计划 · 开始转码 · 终止 · 清空 │
│ 1 输入与输出    │        右侧统计：N 个任务 · 总大小 · 总时长 · 状态提示   │
│ 2 预设 (配方)   │ ┌────────────────────────────────────────────────┐  │
│ 3 视频微调(折叠)│ │ 任务表 TaskTable（NDataTable 虚拟滚动，全屏高视野）│  │
│ 4 音频微调(折叠)│ │ # / 源文件 / 大小 / 时长 / 解码→编码 / 目标 / 状态/ 操作│  │
│ 5 高级选项(折叠)│ │ （空态时为居中 Hero Dropzone 引导画板）           │  │
│                │ └────────────────────────────────────────────────┘  │
│                │ 底部状态与执行看板 ExecutionBar（常态 32px 紧凑 / 执行时展开）│
└────────────────┴──────────────────────────────────────────────────────┘
（两大抽屉按需右侧滑入，不占主区纵向高度：
  - 任务检查器 TaskInspectorDrawer：行双击或详情按钮唤出，含流元数据对比、高亮命令、单任务日志
  - 运行日志抽屉 LogPanel：顶栏或报错直达唤出，含等级过滤、复制、清屏、任务聚焦）
```

- 窗口：1280×820，最小 960×640（沿用 `main/index.ts` 现状）。
- 左栏默认 380px，右侧 5px 拖拽手柄可调 **320~560px**；可一键收起/展开（`Ctrl+B`，收起时记忆上次宽度）。
- 视频/音频/高级三个参数卡片**默认折叠**：保留标题行 + 生效摘要 + 脏改动标记，点击标题展开。
- 密度：全组件 `size="small"`，行高 36px 级，字号正文 13px、次要 12px、等宽命令 12px。

### 2.2 页面内滚动与全域交互策略

- **全域拖放感知**：文件拖入窗口任意区域，触发半透明全屏虚线蒙层 `“释放以添加媒体文件”`，空态与有任务态统一无缝。
- **左栏**：5 个卡片整体纵向滚动（输入多时 chips 独立限高滚动，不挤占下方预设与输出设置）。
- **右栏**：任务表自适应撑满剩余高度（取消常驻命令预览条，净增 120px 垂直视野）；底部执行栏平滑展开/收起。
- **双抽屉体系**：任务检查器（460px）与日志抽屉（480px）均自右侧滑出，带半透明遮罩与 `Esc` 快捷关闭。

### 2.3 桌面平台范式（Windows 优先）

这是 **Electron 桌面应用**，不是网页。以下为硬性设计约束：

| 维度 | 规范 |
| :--- | :--- |
| 窗口 | 原生标题栏 + 窗口尺寸/位置持久化；最小 960×640 |
| 交互 | 任务行**右键菜单**（定位/重试/移除）；`Esc` 关闭弹窗；`Ctrl+Enter` 快速生成计划 |
| 文件选择 | 一律 **native 对话框**（`selectFiles`），不用网页式文件控件；拖放走 OS 事件 + `getPathForFile` |
| 系统集成 | Windows 任务栏进度（`setProgressBar`）、系统通知（`session.summary`）、`showInFolder` 定位 |
| 密度 | 全组件 `size="small"`、32px 级控件、等宽字体展示路径/命令/日志；键鼠优先，不依赖触控 |
| 字体 | 系统栈优先 `Segoe UI`（Win）/ `PingFang SC`（mac）；等宽 `Consolas / Cascadia Mono` |
| 弹窗策略 | 常规参数**不用弹窗**（面板内折叠可见，便于批量对照）；仅系统级设置（主题、工具路径、GPU、关于）进 SettingsModal；日志用右侧抽屉，不常驻主面板 |

> 关于"参数是否用弹窗"的主流做法（HandBrake / Shutter Encoder / FFmpeg Batch AV）：核心与常用参数直接在**主窗口面板内折叠**展示，弹窗只留给不常用的系统配置（工具路径、环境检测、主题）。批量转码需要持续对照参数，弹窗会打断工作流。

---

## 3. 视觉设计令牌

实现层直接采用 **Naive UI 主题变量**（`darkTheme` 默认、`lightTheme` 可切换），以下为关键 token 与用途；组件自身颜色由 Naive UI 管理，**不再引入第二套色板**。

| Token（Naive UI 命名） | 暗色值 | 用途 |
| :--- | :--- | :--- |
| `bodyColor` | `#101014` | 窗口底色 |
| `cardColor` | `#18181c` | 卡片/面板底色 |
| `borderColor` | `rgba(255,255,255,0.12)` | 卡片描边、输入框描边 |
| `dividerColor` | `rgba(255,255,255,0.09)` | 区块分隔线 |
| `textColorBase` | `rgba(255,255,255,0.82)` | 正文 |
| `textColor2` | `rgba(255,255,255,0.6)` | 次要信息 |
| `textColor3` | `rgba(255,255,255,0.4)` | 占位/禁用 |
| `primaryColor` | `#63e2b7` | 主按钮、进度、运行态、链接 |
| `infoColor` | `#70bfff` | 信息徽章 |
| `warningColor` | `#f2c97d` | 跳过/告警 |
| `errorColor` | `#e88080` | 失败/危险操作 |
| `borderRadius` | `3px` | 全组件统一 |
| 字体 | 系统栈（Segoe UI / PingFang SC / Microsoft YaHei） | 正文 |
| 等宽字体 | `Consolas / Cascadia Mono / SF Mono` | 命令预览、日志 |

状态色语义（全局一致，不另造色）：

| 状态 | 颜色 | 形态 |
| :--- | :--- | :--- |
| pending 待处理 | textColor3 | 灰字 + 空心圆点 |
| running 转码中 | primaryColor | 主色 + loading 圆环/进度 |
| done 已完成 | successColor | 绿勾 |
| skipped 已跳过 | warningColor | 黄徽章（悬浮显示原因） |
| failed 失败 | errorColor | 红徽章（悬浮显示错误） |
| cancelled 已取消 | textColor3 | 灰徽章 |

---

## 4. 组件规格（分区 × 逐控件）

> 每个控件给出：功能、Naive UI 映射、交互、状态。字段名与 `OPTION_KEYS` 白名单对应，传参走 `normalizeWebOptions`（见 §7）。

### 4.1 HeaderBar（顶栏）

| 元素 | 规格 |
| :--- | :--- |
| 品牌 | 左：应用图标（SVG）+ "mediac FFmpeg Studio" + 版本号 |
| ffmpeg 状态 | `NTag`：正常显示 "ffmpeg 6.1.1"；缺失 → `error` 红标 "ffmpeg 未找到" + 点击弹出设置（引导配置 `FFMPEG_PATH`） |
| GPU 徽章 | `NTag`（info）：`hardware.gpus[0]` + 由 `tier` 派生 "NVENC/CUDA" / "QSV" / "AMD VCN" / "CPU Mode"；探测失败显示 "GPU: 未知" |
| 运行状态胶囊 | `NTag` 六态文案：IDLE 待机 / PLANNING 分析中 / READY 待执行 / RUNNING 转码中 / STOPPING 正在停止 / COMPLETED 已完成 / FAILED 异常 |
| 日志 | 图标按钮 + **未读错误角标**（ERROR 计数，清屏后清零）→ 日志面板（§4.7） |
| 侧栏切换 | 图标按钮，收起/展开左栏（`Ctrl+B`）；收起后主面板全宽 |
| 设置 | 图标按钮 → SettingsModal（§4.8） |

### 4.2 InputOutputCard（左栏 1：输入与输出）

**输入区**

| 元素 | 规格 |
| :--- | :--- |
| 拖拽投放区 | 虚线框卡片；`@drop` → `window.api.getPathForFile(file)` 逐文件取物理路径；拖入中高亮边框 |
| 添加文件 / 添加目录 | `NButton`（secondary）→ `selectFiles({mode:"file", multiple:true})` / `selectFiles({mode:"directory"})` |
| 手动路径 | `NInput`（placeholder "粘贴文件/目录路径，回车添加"）+ 回车/添加按钮 |
| 输入清单 | `NTag` 列表（closable）：**单行显示完整路径**（等宽字体）；目录条目行尾附带 "24 个文件" 徽章；单项可删 |
| 去重 | 相同路径去重（`normalizeInputs` 行为一致） |

**输出区**

| 元素 | 规格 |
| :--- | :--- |
| 输出目录 | `NInput`（默认空 = 源文件同目录）+ "选择目录" → `selectFiles({mode:"directory"})` |
| 输出模式 | `NSelect` 三选一（省空间，语义以 `ffmpeg_task.js` 实行为准）：`tree` 保持完整目录层级 / `dir` 仅保留父目录名（默认）/ `file` 全部扁平写入输出目录 |
| 命名 | 前缀 `prefix`、后缀 `suffix` 两个 `NInput`；模板变量提示 `{preset} {dimension} {videoQuality} …`（tooltip） |

### 4.3 PresetCard（左栏 2：预设）

| 元素 | 规格 |
| :--- | :--- |
| 预设选择 | `NSelect` **动态分组**：按 `type` + `videoCodecFamily` 分 HEVC / H.264 / AV1 / VP9 / 音频 五组，数据来自 `getEnvironment().presets`；**禁止写死预设名**；选项**两行**：主行 preset 名（含推荐/说明标记）+ 次行关键指标摘要（`HEVC · 1080p · CRF 23 · 峰值 8M · aac 192k`），收起态下方徽章同步展示 |
| 预设特性徽章 | 选中后展示：`videoCodecFamily` / `dimension`（如 1080p）/ `videoQuality`（CRF）/ `maxBitrate`（如 8M）/ `audioCodec`+`audioBitrate`；来源 preset 字段 |
| 默认项 | 首次启动选中 `hevc_2k`（预设数据自带推荐标记） |
| 切换行为 | 切换后：徽章刷新；微调字段若为"跟随预设"则保持空（显示预设值作为占位提示）；已有手动值**保留不清空** |

### 4.4 VideoCard / AudioCard（左栏 3-4：参数微调，**默认折叠**）

> 折叠头显示当前生效摘要（如 `HEVC · 1080p · CRF 23` / `aac 192k`），点击展开滑块与选择器；展开态改动实时刷新摘要。
> **脏状态指示（Dirty State）**：若某项被手动改动（偏离所选预设默认值），标签旁点亮微型圆点（`primaryColor`），右侧显现单项“撤销/恢复默认”按钮；折叠头显示“已微调 N 项 · [全部还原]”。

| 字段（OPTION_KEYS） | 控件（Naive UI） | 取值/规则 |
| :--- | :--- | :--- |
| `dimension` 长边 | `NSelect` + 自定义项 `NInputNumber` | 0=保持原分辨率；常用档 3840/2560/1920/1280/854；**只降不升** |
| `videoQuality` 质量 | `NSlider` + `NInputNumber` 联动 | 0=跟随预设；区间随预设族：h264/hevc 0–51、av1/vp9 0–63 |
| `videoBitrate` 码率 | `NSelect`（自动 + 档位）+ 自定义 `NInput` | 字符串码率 `128k / 3M`；留空=跟随预设 |
| `framerate` 帧率 | `NSelect` | 0=保持；常用 23.976/24/25/29.97/30/50/60；只降不升 |
| `speed` 倍速 | `NSelect` | 0=不变速；0.5/0.75/1.25/1.5/2.0（域 0.5–2.0，服务端校验） |
| `audioCodec` 音频编码 | `NSelect` | 空=跟随预设；copy/aac/libopus/mp3/flac |
| `audioBitrate` 音频码率 | `NSelect` | 空=跟随预设；96k/128k/192k/256k/320k |
| 改动生效 | 值变化即写入本地 state，**不自动调接口**；若已有计划则状态置为 `STALE`（提示更新计划，不粗暴清空任务列表） | |

> 说明：`videoQuality` 统一显示为"质量"（CRF 基准），实现时提示文案区分 CPU（CRF）与硬件（CQ），数值由 hwaccel 层做偏移换算，UI 不感知细节。

### 4.5 AdvancedCard（左栏 5：高级选项，默认折叠）

| 字段 | 控件 | 规则 |
| :--- | :--- | :--- |
| `hwaccel` 硬件加速 | `NSelect` | auto / cuda / qsv / amf / d3d / cpu；默认 auto |
| `decodeMode` 解码模式 | `NSelect` | auto / gpu / cpu；默认 auto |
| `jobs` 并发数 | `NInputNumber`（1–4） | 仅对音频任务生效；旁注"视频任务始终串行执行"（对齐 `cmd_ffmpeg.js` 并发策略） |
| `override` 覆盖已存在 | `NSwitch` | 关闭时目标已存在 → 跳过（Skip[Dst]） |
| `anime` 动漫调优 | `NSwitch` | 收紧质量并注入线条保护参数 |
| `strict` 严格模式 | `NSwitch` | 禁用自动降级/重试；不支持文件按跳过处理 |
| `deleteSourceFiles` 转码后删除源 | `NSwitch`（**error 色高危**） | 勾选后"生成计划"弹 `NDialog` 确认，文案见 §6.4；确认后才随 `createPlan` 传 `deleteSourceFiles:true, deleteSourceConfirmed:true` |

### 4.6 TaskTable / ExecutionBar / TaskInspectorDrawer（右栏）

**顶部工具栏**：
- `生成计划` / `更新计划`（secondary；无计划为 secondary，若参数被改动置 `STALE` 则变更为 `primary` 脉冲高亮并提示“更新计划”）；
- `开始转码`（primary，READY 可用；支持"执行选中项"）；
- `终止`（error ghost，仅 RUNNING/STOPPING 可用）；
- `清空`（ghost）。
- 右侧统计：`N 个任务 · 总大小 · 总时长 · 状态提示`。

**任务表**（`NDataTable` + `virtual-scroll`，撑满剩余高度）：
- **空态画板（Hero Dropzone）**：无任务时，右侧呈现居中大型极简拖放引导区，文案“拖入媒体文件或目录开始转码”，带 `[选择文件]`、`[选择目录]` 原生按钮；
- **全域拖放蒙层**：窗口任意处拖入文件时，全屏平滑呈现虚线半透明蒙层；
- **行双击与检查**：双击任意任务行直接弹出**任务检查器（TaskInspectorDrawer）**；
- **失败行日志直达**：转码失败行内嵌 `[查看报错]` 标签，点击直达日志抽屉并自动聚焦该任务。

| 列 | 内容 |
| :--- | :--- |
| 多选 | 默认全选；工具栏按钮执行选中项 |
| # | 序号 |
| 源文件 | 主文字文件名 + 子行 `videoCodec / width×height / fps · 路径短名`（快照 §5.2 增补字段） |
| 大小 | 人类可读 |
| 时长 | mm:ss 或 h:mm:ss |
| 解码 → 编码 | 主文字 `源编码 → 输出编码族`（如 `H.264 → HEVC`）；子行 `解码 {decodeMode} · {encoder}`（如 `解码 auto · libx265`）；音频任务显示 `AAC → aac` / `→ copy` |
| 目标文件 | 主文字输出文件名 + 子行输出目录短名 |
| 状态 | 状态徽章（§3 色板）；running 行内嵌 mini 进度（percent）；skipped/failed 悬浮 tooltip 显示 `skipReason`/`error` + 失败行直达日志按钮 |
| 操作 | 图标按钮：详情（唤出检查器） / 定位 `showInFolder` / 重试（仅 failed/cancelled） / 移除 |

**任务检查器（TaskInspectorDrawer，右侧滑入 460px 抽屉）**：
- 取代常驻命令预览折叠条，释放 100% 主视区垂直空间；
- **源流规格对比**：分辨率、编码、帧率、音轨 vs 目标输出规格；
- **FFmpeg 完整命令**：等宽字体着色展示，支持一键复制（`navigator.clipboard`）；
- **任务独立日志**：提取当前任务的执行耗时与控制台输出。

**执行看板（ExecutionBar，右栏底部固定条）**：
- **待机/就绪状态（32px 紧凑条）**：单行高密度展示任务总数、总大小、当前预设；
- **转码运行状态（平滑展开 64px 专业看板）**：
  - 上行：总体进度条（`NProgress`）、实时总体速度（x）、总体 ETA；
  - 下行：当前单项文件名称、单项百分比进度与实时 FPS；
- **完成横幅**：`session.summary` → 完成/失败/跳过/取消计数 + `[打开输出目录]` 快捷按钮。

### 4.7 LogPanel（浮层抽屉，不占主面板）

- **入口**：顶栏日志按钮（带未读 ERROR 计数角标）；任务失败行 `[查看报错]` 直达。
- **任务聚焦模式（Task-scoped）**：从具体任务点击进入时，顶部提供 `[清除聚焦]` 按钮，快速排查单任务。
- 头部：日志数量 + 等级过滤 `NSelect`（全部/INFO/CMD/WARN/ERROR）+ 操作：`日志目录` / `复制` / `清屏`。
- 正文：等宽字体行流，颜色映射 **INFO 淡青 / CMD 浅绿 / WARN 亮黄 / ERROR 珊瑚红**；自动滚屏；上限 500 行环形缓冲。

### 4.8 SettingsModal（设置弹窗）

| 区域 | 内容 |
| :--- | :--- |
| 主题 | `NRadioGroup` 暗色/亮色（`useLocalStorage` 记忆） |
| 工具路径 | 可编辑：`ffmpeg / ffprobe / mediainfo` 三行（`NInput` + 恢复默认按钮），占位提示**默认探测值**（来自环境变量/PATH，如 `C:\Home\Apps\ffmpeg\bin\ffmpeg.exe`）；留空 = 使用默认；改动点"保存设置"生效 |
| FFmpeg 环境 | 只读展示 `ffmpegPath/ffprobePath` + "重新检测"按钮（调 `getEnvironment` 刷新）；缺失时红色提示并指引设置 `FFMPEG_PATH` |
| 硬件 | 只读：GPU 列表（vendor/model/generation）、可用编码器数、hwaccel 列表 |
| 关于 | 应用版本 |

---

## 5. 运行状态机 → UI 映射

状态机以架构文档 §6.1 为准，UI 侧表现：

| 状态 | 顶栏胶囊 | 生成计划 | 开始转码 | 终止 | 表格 | 配置区 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| IDLE | 待机 | 可用 | 禁用 | 禁用 | 空/上次计划保留 | 可编辑 |
| PLANNING | 分析中 | 禁用 | 禁用 | 禁用 | 保留 + 表格 loading 骨架 | 锁定 |
| READY | 待执行 | 可用（重出计划） | 可用 | 禁用 | 全部 pending | 可编辑（改动转 STALE） |
| STALE | 参数已修改（黄） | **高亮（更新计划）** | 禁用 | 禁用 | 计划半透明保留（提示需更新） | 可编辑 |
| RUNNING | 转码中 | 禁用 | 禁用 | 可用 | 行内进度 | 锁定 |
| STOPPING | 正在停止 | 禁用 | 禁用 | 禁用 | 剩余项置 cancelled | 锁定 |
| STOPPED | 已停止 | 可用 | 禁用 | 禁用 | cancelled 保留 | 可编辑 |
| COMPLETED | 已完成 | 可用 | 可用（重跑） | 禁用 | 结果保留 | 可编辑 |
| FAILED | 异常 | 可用 | 禁用 | 禁用 | 保留 | 可编辑 |

---

## 6. 关键交互与文案

### 6.1 主流程

1. 添加输入（拖拽/按钮/手动）→ 2. 选预设并微调 → 3. **生成计划**（dry-run；>1000 文件时先 `NDialog` 确认，文案同 CLI "将处理 N 个文件"）→ 4. 检查任务表与命令预览 → 5. **开始转码**（默认执行全部，可勾选选中项）→ 6. 看板/日志 → 7. 汇总横幅 + 系统通知（`session.summary`）+ 任务栏进度清除。

### 6.2 计划生成失败

空输入 / 无匹配文件 / 预设缺失 → 工具栏旁 `NMessage` 错误提示（文案对齐 CLI 错误："未找到需要处理的媒体文件"、"请先选择预设"），状态回 IDLE。

### 6.3 终止

点击终止 → 状态先置 STOPPING（按钮禁用、胶囊"正在停止"）→ main 进程 abort + taskkill → 剩余 pending 置 cancelled → 汇总。期间 UI 不可再次触发操作。

### 6.4 删除源确认（高危）

勾选"转码后删除源"后首次"生成计划"弹出 `NDialog`，文案（对齐真实行为——工具自身安全回收目录，非系统回收站）：

> "转码成功且产物校验通过后，源文件将被移入 Mediac 安全回收目录（`~/.mediac/deleted/日期`），可随时恢复。请确认是否继续？"

按钮："取消" / "确认删除源"。确认后才提交 `deleteSourceConfirmed:true`。

### 6.5 重试与定位

- 重试：仅 failed/cancelled 行显示；点击 = `startExecution([taskId])`，行回 pending 并重新入队。
- 定位：`showInFolder(fullPath)`；输出未生成时禁用。

### 6.6 空态与引导

- 无计划时任务表显示引导空态："添加文件并点击『生成计划』后，任务将在此列出"。
- 输入为空时"生成计划"按钮点击给出提示（§6.2）。
- 日志为空显示"等待日志…"。

---

## 7. 数据与接口对接

### 7.1 渲染进程 → main（`DesktopApi`，沿用架构文档 §5，不改名）

| 场景 | 调用 |
| :--- | :--- |
| 初始化 | `getAppVersion()` + `getEnvironment()` |
| 添加输入 | `selectFiles({mode})` / `getPathForFile(file)` |
| 生成计划 | `createPlan({ inputs, output, outputMode, preset, options })`，options 键取自 `OPTION_KEYS`（dimension/framerate/speed/videoBitrate/videoQuality/videoCodec/videoCopy/audioBitrate/audioQuality/audioCodec/audioCopy/metadata/filters/hwaccel/decodeMode/strict/jobs/override/deleteSourceFiles/deleteSourceConfirmed/anime/prefix/suffix…） |
| 执行 | `startExecution(taskIds?)`（不传=全部） |
| 终止 | `stopExecution()` |
| 定位 | `showInFolder(fullPath)`（架构文档 §5.2 增补） |
| 通知 | `notify(title, body)`（架构文档 §5.2 增补，`session.summary` 时） |

### 7.2 main → 渲染进程（事件，只读消费白名单）

| 事件 | UI 动作 |
| :--- | :--- |
| `task.started` | 行状态 → 转码中（loading） |
| `task.progress` | 行内 mini 进度 + 执行看板（percent/speed/currentTime/srcDuration → ETA） |
| `task.log` | 日志终端追加（按等级着色） |
| `task.attempt.started/done` | 可选：重试行标记 |
| `task.done` | 行 → done/failed |
| `task.skipped` | 行 → skipped（悬浮显示 reason） |
| `task.cancelled` | 行 → cancelled |
| `session.summary` | 汇总横幅 + `notify` + 任务栏进度清除 + 状态 → COMPLETED/STOPPED |

### 7.3 计划快照（`PublicPlanSnapshot`）

表格列与快照字段一一对应：`tasks[].name/path/size/duration/fileDst/status/error/skipReason`；源媒体信息子行用架构文档 §5.2 增补的 `videoCodec/width/height/fps`；统计用 `totalTasks/totalSize/totalDuration`；命令预览用 `previewCmd`。

### 7.4 预设动态渲染（硬约束）

`EnvironmentSummary.presets` 数组按 `type`、`videoCodecFamily` 分组渲染 `NSelect` 的 `NSelectGroupOption`；徽章字段：`videoCodecFamily/videoQuality/videoBitrate/maxBitrate/audioCodec/audioBitrate/dimension`（字段缺失时隐藏对应徽章）。预设增删只改 `presets/default.yaml`，UI 自动跟随，**任何代码/文档不得写死预设名**。

---

## 8. i18n 建议

- 沿用 CLI 的 `lib/i18n.js` 键风格，渲染进程维护 `zh`/`en` 两套文案对象（`stores/settings.ts` 持久化语言偏好）。
- 本期 P0 可只交付中文文案，但**所有用户可见字符串必须走 `t()` 函数**，不允许硬编码散落组件内。
- 状态文案与 CLI 日志语义保持一致（"待处理/转码中/已完成/已跳过/失败/已取消"）。

---

## 9. 实施清单与验收

> 组件命名沿用架构文档目录规划（`components/` 6 个组件 + `stores/runner.ts` + `stores/settings.ts`），组件**内容**按本文档 §4 实现。

| 阶段 | 内容 | 验收 |
| :--- | :--- | :--- |
| **P0 骨架** | Naive UI 暗色主题挂载；布局三区（顶栏/左右栏/底日志）落位；HeaderBar 环境徽章（ffmpeg 状态 + GPU） | `npm run typecheck` 零错误；1280×820 与 960×640 下无溢出 |
| **P1 配置区** | InputOutputCard / PresetCard（动态分组、选项两行指标）/ VideoAudioCard（默认折叠+摘要）/ AdvancedCard；输出模式 `NSelect`；字段全部走 `normalizeWebOptions` | 预设下拉与 `presets/default.yaml` 一致（改 YAML 自动跟随）；拖拽 200 文件去重正确；左栏拖拽调宽 320~560 生效 |
| **P2 计划与表格** | 生成计划 → `PublicPlanSnapshot` → TaskTable（虚拟滚动、多选、状态徽章、悬浮原因、解码→编码列、右键菜单）；命令预览联动选中行 | 拖入 200 文件目录计划生成秒级、滚动不卡顿；行状态与事件一致 |
| **P3 执行与打磨** | ExecutionBar / LogPanel（浮层抽屉）/ 左栏收起展开 / 状态机锁定 / 删除源确认弹窗 / 设置弹窗 / 通知与任务栏进度 | 全流程跑通：计划→执行→终止→重试→汇总；日志抽屉可打开/过滤/复制/清屏；`npm test` 通过（lib 回归） |

**总工时预估**：2.5 ~ 3.5 个工作日（UI 层，不含架构文档 P1 主进程改造）。

---

## 10. 维护指南（UI 相关补充）

1. **改预设**：只改 `presets/default.yaml`，UI 自动跟随；验证 `node index.js ffmpeg --show-presets`。
2. **新增 UI 字段**：先确认是否已存在于 `OPTION_KEYS`；不存在则按架构文档维护指南的四步链路新增（ipc-channels → contracts → preload → handleTrusted），并同步本文档 §4 控件表。
3. **改文案**：改 `t()` 键值，不直接改组件内字符串。
4. **回归**：涉及 lib 改动 `npm test` + `npm run check` + `npm run lint`；UI 改动 `npm run typecheck` + `npm run build`。
