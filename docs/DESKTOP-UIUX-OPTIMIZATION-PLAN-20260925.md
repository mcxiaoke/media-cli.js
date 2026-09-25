# MediaCli Desktop UI/UX 体验改进与优化实施方案（确定版）

- **版本**：v2.0
- **日期**：2026-09-25 14:38:00（GMT+8）
- **状态**：**终极确定方案**（已深度评估 Review 意见，甄别吸收有效成果，去除过度设计，落实用户明确要求）
- **版本演进与关键修订摘要**：
  1. **甄别吸收同行审查（Review）核心成果**：
     - **修复 P0-1 勾选丢失与全选 Fallback**：引入以规范化文件绝对路径（`filePath`）为基准的稳定选择集映射；空选时严格禁用开始按钮；`startExecution` 必须显式传递 ID 数组，杜绝 `undefined` 隐式全选执行；
     - **修复 P0-2 任务删除后重规划复活**：将已展开的任务队列确立为权威数据源，用户从列表移除的任务自动进入排除名单，后续重规划绝不再重新扫描引入；
     - **修复 P0-3 严密判定开始按钮就绪态**：综合考量未完成摄入（`isIngesting`）、空勾选、规划失败（`FAILED`）及全部跳过场景，动态展示按钮文案（如 `开始转码 (12)`、`重试失败项 (3)`）；
     - **补齐 P0-5 & 4.6 真实目标规格契约**：在公共计划快照中扩展经过 FFmpeg 计划计算后的只读目标规格摘要（`targetSummary`：实际编码器、目标分辨率、目标码率、音频策略），杜绝前端凭借 preset 猜测带来的偏差；
     - **优化 4.7 播放产物失败容错**：捕获 `openPath` 错误并回退为文件夹定位提示；未成功任务禁用播放；
  2. **剪除 Review 中的过度设计（立足本地工具做减法）**：
     - 拒绝在主进程引入重量级的 `prepareAndStart` 事务协议与全局 revision 版本指纹系统，改由渲染层内聚事务管道 `ensurePlanAndRun()` 串联，配合主进程在 `startExecution` 的前置守卫，用极简代码达成绝对安全，零底层架构冲击；
     - 弱化黑客攻防式的“安全事故”焦虑，聚焦于本地用户的“防手滑、防困惑、防丢状态”体验改进；
  3. **彻底落实用户核心指令（设置与关于彻底解耦）**：
     - 顶栏物理移除 CPU 核数与内存占用；
     - 设置界面（SettingsModal）剥离所有不可修改的静态数据，只留用户可配置项；
     - 建立独立的“关于 / 系统信息 (AboutModal)”，集中承纳 CPU 型号、系统内存、GPU 矩阵、FFmpeg 路径与版本、预设加载统计及环境重测入口；
  4. **紧凑屏（960×640）空间适配**：
     - 底部对比面板采用“默认单行差异摘要（不超过 28px）+ 一键展开双栏结构化卡片”的渐进呈现方式，最大化保留长列表的可视区域。

---

## 1. 对标主流产品（ShanaEncoder / HandBrake）的心智模型

通过深入对标 Windows 平台主流个人转码标杆 **ShanaEncoder** 与 **HandBrake** 的交互范式，提炼出本地转码工具的核心心智模型：

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        主流桌面转码心智模型                            │
├────────────────────────────────────────────────────────────────────────┤
│  添加视频 ──► 选定/调参 ──► 确认输出路径 ──► [一键开始] ──► 原地播放/验收 │
│      ▲                                              │                  │
│      └───────────────── 顺畅无阻断 ─────────────────┘                  │
└────────────────────────────────────────────────────────────────────────┘
```

主流工具的 4 大黄金法则：
1. **主操作一键直达**：用户调整完参数，随时点击显眼的“开始转码”，系统静默完成内部准备并立即执行，**绝不要求用户先点“生成计划”，再点“开始转码”**；
2. **输出位置一目了然**：界面底部常驻显示产物保存路径，并配有极简的“保存在源文件夹中”选项，执行前无需费心翻找确认；
3. **参数差异原地对比**：选中任务时原地呈现源文件规格与目标产物规格对比，无需弹窗或打开厚重的抽屉；
4. **验收闭环零跳转**：转码完成后，原地直接调用系统默认播放器回放产物，立刻确认画质与音轨。

---

## 2. 深度审查甄别与解决方案矩阵

| 审查项 (Review 关注点) | 定性与甄别 | 终极解决方案 (本方案实施对策) |
|---|---|---|
| **P0-1 勾选丢失与全选 Fallback** | **致命逻辑缺陷，坚决采纳** | 1. `planStore` 记录规范化源文件绝对路径（`filePath`）的稳定选择集；<br>2. 参数变更重规划时按路径恢复用户已有勾选，新文件默认勾选；<br>3. 空选时开始按钮禁用；`startExecution` 必须显式传 IDs，主进程杜绝隐式全选。 |
| **P0-2 移除任务重规划复活** | **真实体验硬伤，坚决采纳** | 展开任务后，任务列表即为权威队列；移除任务时将路径加入 `excludedPaths`，后续重规划绝不把用户删掉的文件重新扫入。 |
| **P0-3 开始按钮状态判断不全** | **真实体验硬伤，坚决采纳** | 建立严密就绪计算：`canStart = !isBusy && !isIngesting && planStore.status !== 'PLANNING' && planStore.status !== 'FAILED' && selectedCount > 0`，动态显示数量与重试文案。 |
| **P0-4 导入竞态与调参误解** | **部分采纳，过度设计剪枝** | 剪除复杂的全局 revision 指纹协议；在 `isIngesting` 时禁用开始按钮；转码执行期间（`RUNNING`）将左侧配置面板设为只读锁定，简洁直观消除歧义。 |
| **P0-5 & 4.6 目标规格公共契约缺失** | **架构设计盲点，坚决采纳** | 在 `createPublicTaskSnapshot` 中显式扩展由底层计划算出的 `targetSummary`（包含实际硬件编码器、计算后的实际目标分辨率与码率），彻底避免前端盲目猜测。 |
| **主进程 prepareAndStart 重构** | **过度设计，坚决剪除** | 维持现有跨进程 IPC 边界与稳定单测；在 Renderer 内部封装轻量安全的 `ensurePlanAndRun()` 管道函数，前后端加固后即可完美达成原子效果。 |
| **挂机动作（系统休眠/关机）** | **暂缓，不纳入本轮** | 涉及底层操作系统副作用与引擎终态断言，遵照用户“做减法、不盲目堆功能”原则，本期完全剥离。 |
| **设置与关于信息混杂** | **用户核心明确指令，坚决落实** | 顶栏移除 CPU/内存监控；设置弹窗只保留可修改项；新建独立的关于/系统信息弹窗集中呈现所有静态硬件与探测数据。 |

---

## 3. 终极界面交互布局结构（960×640 紧凑屏适配）

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ [顶栏 HeaderBar]                                                         │
│ 侧栏折叠 | 12 个文件 · 10 个已选中   [🚀 NVIDIA NVENC]    [开始转码 · 10] │
├──────────────────────┬───────────────────────────────────────────────────┤
│ [左侧配置 ConfigPanel]│ [右侧任务主区 TaskTable]                          │
│ 预设模板选择 / 微调  │ 高密度任务表格：复选框 | 格式 | 文件名 | 进度 | 操作│
│ (转码运行中参数锁定)  ├───────────────────────────────────────────────────┤
│                      │ [底部信息对比与路径条]（高度自适应）              │
│                      │ 1920×1080 H.264 → 1080p HEVC (nvenc) · AAC [详情▾]│
│                      │ ☑ 保存在源文件夹  |  指定输出: [ D:\Export ] [更改]│
├──────────────────────┴───────────────────────────────────────────────────┤
│ [状态栏 StatusBar]                                                       │
│ 就绪 | 速度 2.8x | 预估剩余 01:25             [日志 (0)]  [关于与系统信息]│
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 五大核心优化与落地方案

### 优化一：动线解阻与一键流水线贯通（核心减法）

#### 1. 按钮状态与动态语义
- 在 `HeaderBar.vue` 中，主开始按钮由严格的计算属性控制：
  ```ts
  const canStart = computed(() => {
    if (isBusy.value || isIngesting.value) return false
    if (planStore.status === "PLANNING" || planStore.status === "FAILED") return false
    return planStore.selectedTasks.filter((t) => t.status !== "success" && t.status !== "skipped").length > 0
  })
  ```
- **按钮动态文案**：
  - 队列就绪：`开始转码 · ${selectedExecutableCount}`
  - 正在摄入媒体：`正在读取文件...`
  - 正在准备计划：`正在准备...`
  - 存在失败项且全部已处理完毕：`重试失败项 · ${failedCount}`

#### 2. 前端事务管道与勾选持久化（`ensurePlanAndRun`）
- 在 `App.vue` 中封装统一的执行入口：
  ```ts
  async function startExecution() {
    if (!canStart.value) return

    // 1. 记忆当前用户明确勾选的文件绝对路径
    const selectedPaths = new Set(
      planStore.tasks.filter((t) => planStore.selectedIds.has(t.id)).map((t) => t.path)
    )

    // 2. 若存在未推演输入或配置已变动 (STALE/hasStaged)，隐式触发推演
    if (planStore.hasStaged || planStore.status === "STALE" || !planStore.planSnapshot) {
      planStore.status = "PLANNING"
      try {
        // 过滤掉被用户主动从表格移除的文件，保证排除项不复活
        const effectiveInputs = getEffectiveInputs(configStore.inputs, planStore.excludedPaths)
        const plan = await window.api.createPlan({ ...buildPayload(), inputs: effectiveInputs })
        planStore.setPlan(plan)
        
        // 3. 按源文件绝对路径恢复用户的勾选意图
        planStore.restoreSelectionByPaths(selectedPaths)
      } catch (err) {
        planStore.status = "FAILED"
        logStore.append({ level: "ERROR", message: `准备转码失败: ${err.message}` })
        return
      }
    }

    // 4. 显式提取选中的任务 ID，禁止传递空数组或 undefined
    const executableIds = planStore.tasks
      .filter((t) => planStore.selectedIds.has(t.id) && t.status !== "success" && t.status !== "skipped")
      .map((t) => t.id)
    
    if (executableIds.length === 0) return

    // 5. 启动转码引擎
    await window.api.startExecution(executableIds)
  }
  ```
- **主进程防线加固**：
  - 在 `ffmpeg-service.ts:startExecution` 中明确守卫：若 `taskIds` 为空数组直接抛错拒绝，禁止将 `undefined` 隐式回退为“执行全部任务”。

#### 3. 移除阻断式黄色提示条
- 彻底移除 `HeaderBar.vue` 原有的 *“已摄入新媒体，请点击「生成计划」”* 和 *“参数已变更，请点击「更新计划」”*；
- 界面只需保持正常的主题背景与状态指示胶囊，不再阻断用户。

---

### 优化二：输出目录常驻与单一事实源管理

#### 1. 界面底部常驻控制条
- 在任务列表底部常驻极简路径条：
  - 复选框：`☑ 保存在源文件夹同级`；
  - 自定义路径展示：未勾选时显示当前指定的 `configStore.outputDir`，并提供 `[更改]` 按钮；
  - 多源目录提示：当勾选“保存在源文件夹同级”且检测到当前任务来源跨越不同目录时，弱化提示 *“（产物将分别保存在各自源文件所在目录下）”*。

#### 2. 单一事实源设计（拒绝底栏与侧栏双写冲突）
- 底栏与左侧 `ConfigPanel` 共享 `configStore.outputDir` 与 `configStore.outputBesideSource`；
- 点击底栏的 `[更改]` 按钮，直接调用 Electron 的文件夹选择弹窗，选定后同步写回 store，保证全局状态一致。

---

### 优化三：数据契约扩展与紧凑型两级元数据对比

#### 1. 扩展公共任务快照契约（`createPublicTaskSnapshot`）
在 `src/transcode/ffmpeg_plan_snapshot.js` 中，为每个任务投影只读的 `targetSummary`：
```javascript
targetSummary: {
  container: task.targetContainer || path.extname(task.fileDst || "").replace(/^\./, ""),
  videoEncoder: task.targetEncoder || task.hwPlan?.encoder || "libx264",
  width: task.targetWidth || task.width,
  height: task.targetHeight || task.height,
  fps: task.targetFps || task.fps,
  qualityOrBitrate: task.targetQuality ? `CRF ${task.targetQuality}` : task.targetBitrate || "自适应",
  audioCodec: task.targetAudioCodec || "aac",
  audioBitrate: task.targetAudioBitrate || "128k",
}
```
保证前端能直接渲染经过硬件探测与自适应缩放计算后的真实产物参数，杜绝猜测。

#### 2. 960×640 屏幕下的两级渐进展示
- **默认态（单行紧凑差异摘要）**：
  - 仅占用一行高度（约 26px）：
    `1920×1080 H.264 · 30fps → 1080p HEVC (hevc_nvenc) · CRF 23 · AAC 128k`，右侧保留一个小巧的 `[详情 ▾]` 按钮；
  - 优点：最大化保留任务表格的可视行数，即使窗口仅有 640px 高度也不会拥挤。
- **展开态（ShanaEncoder 风格结构化双栏卡片）**：
  - 点击 `[详情 ▾]` 后展开为紧凑的左右两列卡片：
    - **左列（输入源）**：文件大小、时长、封装、视频编码、原始分辨率/帧率、音频编码/声道；
    - **右列（目标产物）**：目标文件名、目标封装、实际编码器、目标分辨率/帧率、质量/码率、音频策略、目标完整路径；
  - 点击右上角 `[收起 ▴]` 随时折叠。

---

### 优化四：验收闭环——系统播放器直调与容错

#### 1. 任务行操作与右键上下文菜单打通
- 在 `TaskTable.vue` 中为每一行提供直接回放能力：
  - **播放源文件**：调用 `window.api.openPath(task.path)`；
  - **播放转码产物**：仅在 `task.status === 'success'` 时高亮可用，调用 `window.api.openPath(task.fileDst)`。
- 右键上下文菜单同步增加：`播放源文件`、`播放转码产物`、`在文件夹中定位`、`复制文件路径`。

#### 2. 健壮的错误捕获与 Fallback
- `openPath` 底层返回错误信息（如 Windows 缺少关联播放器或文件被移动）：
  - 前端捕获后弹出友好通知：*“无法调用播放器直接打开：${error}。已为您在资源管理器中定位该文件。”*；
  - 自动调用 `showItemInFolder` 作为容错回退。
- 若开启了“转码成功后删除源文件”，在转码完成后自动将“播放源文件”按钮置灰，避免尝试打开已被清理的文件。

---

### 优化五：设置与关于彻底解耦、视觉与日志做减法

#### 1. 设置 (SettingsModal) 与 关于 (AboutModal) 的纯粹解耦
- **应用设置（SettingsModal.vue）**：**纯粹保留可修改的配置项**：
  - 界面外观主题（深色 / 浅色）；
  - 硬件加速器选用（auto / cuda / qsv / amf / d3d11va / cpu）；
  - 解码模式偏好；
  - 默认并发任务数；
  - 产物覆盖开关、动漫增强模式开关、严格模式开关；
  - 安全删除源文件高危开关；
  - 自定义外部 FFmpeg 可执行文件路径。
- **关于与系统信息（AboutModal.vue）**：**集中承纳所有静态环境数据与硬件探测结果**：
  - MediaCli Desktop 版本号、Electron / Node / Chrome 运行时版本；
  - 物理处理器信息（从顶栏迁入，如 `AMD Ryzen 7 7840HS (16 逻辑核心)`）；
  - 系统总内存与空闲情况（从顶栏迁入）；
  - 探测到的 GPU 完整设备列表、驱动架构与硬件加速支持矩阵；
  - 当前生效的 FFmpeg 二进制路径、ffprobe 路径、版本号；
  - 内置 YAML 预设与用户自定义预设加载总数；
  - 提供“重新检测环境”刷新按钮。

#### 2. 顶栏监控瘦身
- 从 `HeaderBar.vue` 物理移除 `cpuText` 与 `memText`；
- 顶栏硬件区仅保留当前生效的 GPU 加速芯片胶囊（例如 `🚀 RTX 4070 (NVENC)`）。

#### 3. 参数调节日志降噪
- `ConfigPanel.vue` 中滑动条的高频变动日志降级为 `DEBUG` 级别写入，不在控制台默认展开，不触发顶栏红点提示，保持界面清爽。

---

## 5. 实施计划与安全保障

### 阶段一：动线解阻与一键流水线实现（核心体验飞跃）
- **涉及文件**：
  - `apps/mediac-desktop/src/renderer/src/components/HeaderBar.vue`
  - `apps/mediac-desktop/src/renderer/src/App.vue`
  - `apps/mediac-desktop/src/renderer/src/stores/plan.ts`
  - `apps/mediac-desktop/src/main/ffmpeg-service.ts`
- **实施要点**：
  - 按钮解禁，加入 `canStart` 完备计算属性与动态文案；
  - 实现路径级别的选择集保持（`selectedPaths`）；
  - 实现 `excludedPaths` 防止删除行复活；
  - 在 `App.vue` 落地 `ensurePlanAndRun`；
  - 主进程 `startExecution` 严禁空选 fallback。

### 阶段二：数据契约扩展与底部对比面板
- **涉及文件**：
  - `src/transcode/ffmpeg_plan_snapshot.js`
  - `apps/mediac-desktop/src/shared/contracts.ts`
  - `apps/mediac-desktop/src/renderer/src/components/TaskTable.vue`
- **实施要点**：
  - 在快照投影中追加 `targetSummary`；
  - 在 `TaskTable.vue` 底部重构单行差异摘要与可折叠双栏详细对比卡片；
  - 在底部常驻输出路径控制条，双向绑定 `configStore`。

### 阶段三：回放验收打通、设置与关于彻底解耦
- **涉及文件**：
  - `apps/mediac-desktop/src/renderer/src/components/TaskTable.vue`
  - `apps/mediac-desktop/src/renderer/src/components/HeaderBar.vue`
  - `apps/mediac-desktop/src/renderer/src/components/SettingsModal.vue`
  - `apps/mediac-desktop/src/renderer/src/components/AboutModal.vue`（新建）
  - `apps/mediac-desktop/src/renderer/src/components/StatusBar.vue`
  - `apps/mediac-desktop/src/renderer/src/components/ConfigPanel.vue`
- **实施要点**：
  - 接入 `openPath` 回放产物与源文件，增加失败回退逻辑；
  - 顶栏移除 CPU/内存监控；
  - 设置弹窗剥离只读信息，新建关于/系统信息弹窗收拢只读数据；
  - 滑块参数变动日志降级为 DEBUG。

### 阶段四：验证与测试回归
- 运行 `npm run check` 确保全量语法通过；
- 运行 `npm test` 确保底层 334+ 项单元测试与边界测试 100% 通过；
- 运行 `npm --prefix apps/mediac-desktop run typecheck` 确保 TypeScript 类型零错误；
- 在 960×640 紧凑窗口下实测各分辨率与缩放比例显示效果。
