# MediaCli FFmpeg Electron 客户端第二轮架构与工程风险审查报告

> **审查对象**：`docs/FFMPEG-ELECTRON-ARCHITECTURE-FINAL-20260924.md`（v1.2.0）及 `apps/mediac-desktop` 实际工程配置  
> **审查时间**：2026-09-24 18:05:00（GMT+8）  
> **审查角度**：资深前端架构师、Electron 桌面专家、系统稳定性工程视角  
> **总体评价**：架构方案主体脉络清晰，瘦身减法策略务实，但存在 **1 个直接导致打包安装包启动即崩溃的致命隐患（P0）**，以及 **3 个关乎用户体验、进程安全与性能的高危问题（P1/P2）**。

---

## 一、 审查核心发现总览

| 编号 | 严重级别 | 问题分类 | 核心风险 | 影响面 |
|:---|:---|:---|:---|:---|
| **ISSUE-01** | **P0 致命** | 构建打包与模块解析 | 跨目录引用 `lib/*` 的外部运行时依赖未打包进安装包，`package:win` 产物必抛 `MODULE_NOT_FOUND` 闪退 | 生产构建发布 |
| **ISSUE-02** | **P1 高危** | 规范版本脱节 | 架构文档 §7 仍保留旧版“底部固定命令框”与“死板冻结”，与最新 UI/UX 原型（v1.3.0）严重冲突 | 交互实现与布局 |
| **ISSUE-03** | **P1 高危** | 进程生命周期与安全 | `before-quit` 同步 taskkill 缺乏异常捕获，单点异常导致循环中断及 PID 误杀 | 退出清理与系统安全 |
| **ISSUE-04** | **P2 中高** | IPC 负载与内存管理 | 大目录海量文件（>1000）导入时全量对象一次性 `structuredClone` 导致主渲染进程 GC 停顿与掉帧 | 极限性能与平滑度 |

---

## 二、 详细缺陷剖析与整改代码

### 2.1 【P0 致命缺陷】跨目录依赖在 `electron-builder` 打包时丢失，安装包直接闪退

#### 1. 现象与证据链
在 `apps/mediac-desktop/src/main/ffmpeg-service.ts` 中：
```typescript
import { createFFmpegEngine } from "../../../../lib/ffmpeg_engine.js";
import { detectHardwareCapabilities } from "../../../../lib/hwdetect.js";
```
通过相对路径跨目录引用了根目录的 `lib/` 源码。而 `lib/` 内部大量使用了以下第三方运行时依赖：
- `p-map`（`lib/ffmpeg_engine.js`）
- `systeminformation`（`lib/hwdetect.js`）
- `fs-extra`、`execa`（`lib/ffmpeg_run.js`、`lib/file.js`）
- `yaml`（`lib/preset_loader.js`）

**致命冲突点**：
查阅 `apps/mediac-desktop/electron.vite.config.ts`：
```typescript
main: {
  plugins: [copyCoreData],
  build: {
    externalizeDeps: true, // <-- 这里强制将所有 node_modules 依赖外置！
  },
}
```
再查阅 `apps/mediac-desktop/package.json`：
```json
{
  "dependencies": {
    "vue": "^3.5.0"
  }
}
```
`apps/mediac-desktop/package.json` 的 `dependencies` **完全没有声明** `p-map`、`systeminformation` 等依赖！

#### 2. 运行时后果
- **本地开发态（`electron-vite dev`）**：因为 Node.js 会向上逐级查找父目录的 `node_modules`，所以在开发机上测试完全正常，产生了“一切良好”的假象。
- **打包安装态（`electron-builder --win`）**：`electron-builder` 打包时只会将 `apps/mediac-desktop/node_modules` 压入 `app.asar`。当用户安装打包好的 `.exe` 启动时，主进程在执行到 `import pMap from 'p-map'` 时会立即抛出致命异常：
  ```
  Uncaught Exception: Error: Cannot find module 'p-map'
  ```
  导致桌面客户端启动闪退或硬件探测失败！

#### 3. 确切整改方案（推荐配置内联打包）
在 `apps/mediac-desktop/electron.vite.config.ts` 中，使用 `externalizeDepsPlugin` 的 `exclude` 选项，显式把跨目录用到的第三方库内联打包到 `out/main/index.js` 中：
```typescript
// apps/mediac-desktop/electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [
      copyCoreData,
      externalizeDepsPlugin({
        // 排除出外部依赖清单，强制由 Rollup 将其打包进 main bundle
        exclude: [
          "p-map",
          "systeminformation",
          "fs-extra",
          "execa",
          "yaml",
          "file-type"
        ]
      })
    ]
  },
  // ...
})
```
同时在 `apps/mediac-desktop/package.json` 中补齐开发所必需的类型定义声明。

---

### 2.2 【P1 高危缺陷】架构文档 UI 规格滞后，与最新高保真原型严重冲突

#### 1. 现象与矛盾点
在架构文档 `docs/FFMPEG-ELECTRON-ARCHITECTURE-FINAL-20260924.md` 中：
- **§7 布局规格**：“右栏弹性（任务表格 + 命令预览 + 执行看板），底部折叠日志（160px ~ 320px）”；
- **§8.7 命令预览**：“当前 previewCmd 恒为空串……实现：createPlan 后为首个任务拼装展示命令，填充快照 previewCmd”。
- **§7.2 控件交互**：“READY 后冻结输入控件 + 【重新分析】按钮”。

**与最新成果的冲突**：
在最新定稿的 `FFMPEG-ELECTRON-UI-UX-DESIGN-FINAL-20260924.md` (v1.3.0) 及实机运行的 `ffmpeg-ui-demo/mediac-desktop-ui.html` (v0.3.0) 中：
1. **底部命令预览已被彻底废弃**：因为固定在底部的命令框会挤占 200px 高度，导致任务表格极度狭窄；已重构成从右侧滑出的 `TaskInspectorDrawer`（任务检查器抽屉），双击任务即可查看源媒体 vs 目标对比、音视频流及完整高亮 FFmpeg 命令行，且释放了 100% 的表格垂直空间。
2. **日志已改为浮层抽屉**：日志面板不是底部挤占视窗，而是右侧滑出抽屉，并支持针对失败任务的 `viewTaskLog(taskId)` 专属聚焦过滤。
3. **输入冻结已进化为平滑 STALE 状态机**：死板的冻结或重置会让用户迷失输入；现代桌面交互采用微调脏标记（Dirty State）+ 一键 Undo + 状态栏平滑过渡到 `STALE`（参数已修改），执行按钮动态切为「更新计划」，丝毫不打断心流。

#### 2. 整改方案
开发实施必须以 `docs/FFMPEG-ELECTRON-UI-UX-DESIGN-FINAL-20260924.md` 为 UI 唯一标准，架构方案已在 v1.2.0 修订中补正说明，切勿退回到老式垂直压迫布局。

---

### 2.3 【P1 高危缺陷】`before-quit` 同步 taskkill 的异常中断与孤儿进程/误杀风险

#### 1. 现象与漏洞点
架构文档 §8.8 建议：
> `before-quit` → `dispose()` 改为同步：对 `activePids` 逐个 `execFileSync("taskkill", ["/PID", pid, "/T", "/F"])`，再同步清理 manifest。

**潜在问题**：
1. **未处理异常中断循环**：在 Windows 下，若某个任务在应用退出前 1 毫秒刚好执行结束或异常退出，`activePids` 中仍残留该 PID。此时 `execFileSync("taskkill", ...)` 会因为找不到进程返回错误码 128，并直接在 Node.js 中**抛出未捕获异常**！循环直接被终止，导致排在后面的真正正在运行中的 FFmpeg 进程根本无法被 kill，沦为后台永久吃 CPU/GPU 的僵尸孤儿进程！
2. **PID 重用误杀风险**：若应用长时间挂起或发生异常，操作系统的 PID 可能会被重新分配给系统或其他正在运行的应用程序，盲目按 PID 执行 `/F` 强杀存在误杀宿主其他程序的理论隐患。

#### 2. 整改方案
在 `ffmpeg-service.ts` 中，必须为每个进程的强杀套上严密的局部异常捕获：
```typescript
// 规范的进程清理实现
private killTrackedProcessesSync() {
  const pids = [...this.activePids];
  this.activePids.clear();
  
  for (const pid of pids) {
    try {
      if (process.platform === "win32") {
        // 关键点：用 try-catch 隔离，防止单一 PID 不存在中断整条清理链路
        child_process.execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
          timeout: 2000
        });
      } else {
        process.kill(pid, "SIGKILL");
      }
    } catch (_) {
      // 容忍进程已自然退出的 128 错误，确保后续进程继续执行清理
    }
  }
}
```

---

### 2.4 【P2 性能隐患】导入大规模文件时的 IPC 序列化与响应式开销

#### 1. 现象
当影视后期或摄像用户拖入一个包含 3000+ 片段的素材目录时，`createPlan` 会一次性推演全部 3000 个任务对象。
当前 `contracts.ts` 契约定义：
```typescript
createPlan(body: Record<string, unknown>): Promise<PublicPlanSnapshot>;
```
`PublicPlanSnapshot.tasks` 是一个全量数组。经由 Electron 的 `contextBridge` 与 `structuredClone` 传输时，3000 个包含完整元数据与路径的大对象会导致：
1. 主进程与渲染进程之间序列化耗时达数百毫秒；
2. 渲染进程中 Vue 3 会递归地为 3000 个对象及其深层属性绑定响应式代理（Proxy），引发短时间内存猛增和几秒的严重主线程卡顿（GC Pause）。

#### 2. 整改方案
1. **轻量化快照传输**：任务表格首屏仅需要展示表格列字段（id, name, size, duration, status, fileDst）。详细的音视频流对比与生成命令行，延后至用户在 `TaskInspectorDrawer` 中打开该任务时，按需向主进程请求。
2. **`shallowRef` 优化**：在 Pinia 的 `usePlanStore` 中，对任务数组使用 `shallowRef(tasks)` 而非深度响应式 `ref(tasks)`，从根本上杜绝数千个 Proxy 对象的内存开销。

---

## 三、 总结与执行路线指引

通过本次架构审查：
1. **已在主架构方案（`v1.2.0`）中补充了基于 Playwright 的现代化端到端测试方案**，可直接拉起真实 Electron 实例守护质量底线；
2. **排查出了打包发布（`externalizeDeps`）与进程退出（`taskkill` 异常隔离）的致命坑点**，在开发首日即可提前规避；
3. **彻底理顺了 UI/UX 与架构规范的统一步调**，为后续高效、稳健的编码落地打下了坚实基础。
