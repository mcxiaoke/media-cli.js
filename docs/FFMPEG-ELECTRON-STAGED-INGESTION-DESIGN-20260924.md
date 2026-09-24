# Mediac Electron 桌面端两段式解耦流水线与即时探针架构设计方案

> 文档版本：v1.0.0  
> 创建时间：2026-09-24 (GMT+8)  
> 适用工程：`apps/mediac-desktop`  
> 标杆参考：ShanaEncoder 7.4 / HandBrake 1.9 实测交互范式（见 `E:\Pictures\Screenshots\`）

---

## 1. 背景与现状痛点

在传统的单阶段“黑盒模型”中：
- 用户拖入或选择媒体目录（例如一个包含 80 个视频的文件夹）；
- 前端仅仅将路径记录在输入清单中，右侧主界面继续保持空白的 `HeroEmpty` 引导画板；
- 用户在点击「生成计划」按钮之前，**根本不知道里面扫出了多少个视频、总大小是多少、有哪些封装格式**；
- 只有点击「生成计划」，后端才开始全量目录递归 + 并发 `ffprobe` 提取元数据 + 预设与命令行装配，耗费数秒后才能看到任务表格。

**核心问题**：
1. **黑盒盲盒感**：用户对当前工作空间中的文件缺乏掌控感与确定性；
2. **多次追加困难**：当用户先拖入文件夹 A，又想追加 3 个单文件时，缺乏增量追加与自动去重机制；
3. **计算与 I/O 耦合**：由于将文件发现（I/O）、流分析（ffprobe）与参数推演（CPU 内存运算）杂糅在 `createPlan` 单个方法中，用户一旦改动预设或参数，不得不全量重新经历重度 I/O。

---

## 2. 业界标杆范式（ShanaEncoder & HandBrake）

参考对标截图实测（`ShanaEncoder_20260924_200201.png` ~ `200255.png` 及 `HandBrake_20260924_200036.png` ~ `200040.png`）：

1. **导入即探测（Ingestion & Probing）**：
   - 拖入文件/目录时，立即弹出扫描进度浮层（如 HandBrake: `正在扫描标题 27/82 (66%)` / ShanaEncoder: `添加 [24/60] 信息已被提取`）；
   - 主表格立即上屏，呈现每个视频的真实时长、容器格式、音视频编码等源规格；
2. **两段式状态机解耦**：
   - 导入后未绑定预设前，状态处于中性待命态（`等待` / `STAGED`）；
   - 配置目标参数后，批量进入就绪态（`待执行` / `READY`）；
3. **源媒体 vs 目标推演双栏对比底板**：
   - 列表底端常驻微型信息看板：左侧显示源媒体输入信息（格式/分辨率/帧率/码率），右侧显示目标转码参数，上下键切换行时实时联动；
4. **增量追加与规范化去重**：
   - 支持多次拖放与点选，已存在项自动去重跳过，新项无缝追加至末尾。

---

## 3. 两段式解耦流水线架构（Two-Phase Decoupled Pipeline）

```
[用户交互] 拖拽文件/文件夹，或点击添加
   │
   ▼
【阶段 A：即时发现与元数据快速探针 (Ingestion & Probing)】
   │  IPC 通道：api.stageInputs(paths: string[])
   │
   ├─► 1. 后端多目录递归扫描（支持常见音视频扩展名）
   ├─► 2. 规范化绝对路径去重（与前端当前已有条目对比，去重防刷）
   ├─► 3. 异步轻量 ffprobe 并发探测（8~16 并发，只抓宽高、时长、编码、码率，单视频 <30ms）
   ├─► 4. 实时向前端流式推送扫描进度与解析条目：
   │      eventSink({ type: "input.progress", current: 24, total: 60, item })
   │
   ▼
[前端 UI 即时呈现]
   ├─► 卸载 HeroEmpty 空态，表格立即展示条目列表！
   ├─► 任务状态标记为：【待规划 (STAGED)】（优雅中性蓝/灰色标签）
   ├─► 源文件列即刻显示：文件名、路径、大小、时长、原始编码（如 "1080p · H.264 · 60fps"）
   ├─► 目标文件列标为："[待配置] 遵循左侧预设"
   ├─► 顶栏/底栏统计即时更新："已导入 60 个文件 · 总计 18.4 GB · 时长 4小时12分"
   │
   ▼
【阶段 B：预设绑定与转码命令行生成 (Planning & Ready)】
   │  用户挑选预设或微调参数，点击「生成计划 / 更新计划」
   │  IPC 通道：api.createPlan({ preset, tune, adv, taskIds? })
   │
   ├─► 后端纯内存快速运算（元数据已在阶段 A 提取完毕，零磁盘二次 I/O）
   ├─► <5ms 毫秒级批量拼接每个文件的目标文件名、分辨率计算与 ffmpeg 命令行
   │
   ▼
[前端状态无缝跃迁]
   └─► 状态批量由【STAGED】变为【READY (待执行)】
   └─► 目标文件名与完整参数装填就绪
   └─► 「开始转码」按钮点亮激活！
```

---

## 4. 核心数据契约与状态机演进

### 4.1 任务状态生命周期
```
[ 用户添加路径 ]
      │
      ▼
   STAGED (待规划，已探查元数据)
      │
      │ ──► 点击「生成计划 / 更新计划」
      ▼
    READY (待执行，推演命令就绪)
      │
      │ ──► 点击「开始转码」
      ▼
   RUNNING (转码中)
    ┌─┴─────────────┬─────────────┐
    ▼               ▼             ▼
 SUCCESS (成功)   FAILED (失败)  SKIPPED (跳过)
```

### 4.2 接口与 IPC 通道定义
- `contracts.ts`:
  - `TaskStatus` 补充 `'staged'`；
  - `PlanTask` 属性完善：
    - `path`: 绝对规范化路径（唯一 Key）；
    - `sourceMeta?`: `{ format: string; width: number; height: number; fps: number; vcodec: string; acodec: string; bitrate: number; duration: number }`；
    - `fileDst?`: string（`staged` 状态时可选，`ready` 时必填）；
    - `cmdPreview?`: string（`staged` 状态为空，`ready` 时装配完整）；
- `ipc-channels.ts`:
  - `STAGE_INPUTS`: `'ffmpeg:stage-inputs'`（入参：`paths: string[]`，返回：`PlanTask[]`）；
  - `REMOVE_STAGE_ITEMS`: `'ffmpeg:remove-stage-items'`（入参：`ids: string[]`）。

---

## 5. 多次增量添加与数据更新策略

1. **绝对路径规范化去重（Canonical Deduplication）**：
   - 使用 `path.resolve(p)` 抹平大小写与斜杠差异；
   - 过滤已在 `planStore.tasks` 中存在的路径；
   - 日志记录：`跳过 N 个已存在的重复媒体文件`；
2. **增量探针，避免全量重测**：
   - 仅对新增的路径触发后台 `ffprobe`；
   - 列表中既有任务的状态与数据保持不变；
3. **混合状态自适应（Hybrid State Adaptation）**：
   - 若列表中存在 `STAGED` 任务，HeaderBar 的按钮自动切换为「更新计划」并高亮脉冲；
   - 点击「更新计划」时，仅需内存计算将 `STAGED` 任务提升为 `READY`；
4. **单项与多选批量移除**：
   - 表格支持勾选多项按 `Delete` 或点击 `[移除选中]`，即时剔除任务并更新总统计。

---

## 6. UI/UX 体验升维与组件改进点

1. **容器格式彩色徽章**：
   - 文件名前置彩色胶囊：`MP4`（紫）、`MKV`（蓝）、`WEBM`（青）、`MOV`（橙）、`AVI`（绿）；
2. **表格底部双栏参数速查底板（Input vs Output Info Bar）**：
   - 在 TaskTable 下方集成 64px 紧凑面板；
   - 选中行时，左侧显示原始媒体规格全貌，右侧显示推演目标规格，上下方向键即时响应；
3. **主工作区快捷操作栏**：
   - 表格右上角提供 `[+ 添加文件]` 与 `[+ 添加目录]`，无需来回切换侧栏；
   - 表格左下角提供 `[全选]`、`[反选]`、`[移除选中]` 按钮；
4. **表格行右键上下文菜单**：
   - 右键直达：在资源管理器中定位、查看详细元数据、从列表中移除。

---

## 7. 实施分步规划

- **Phase 1**：底层契约与后端探测服务（`contracts.ts`, `ffmpeg-service.ts`, `ipc-channels.ts`）
- **Phase 2**：Pinia Store 增量管理与状态跃迁（`stores/plan.ts`, `stores/config.ts`）
- **Phase 3**：TaskTable 组件多态渲染与双栏底板、彩色徽章实现
- **Phase 4**：自动化测试（Playwright E2E、Unit Tests）与全链路验证
