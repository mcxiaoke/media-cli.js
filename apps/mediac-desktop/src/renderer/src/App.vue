<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue"
import HeaderBar from "./components/HeaderBar.vue"
import StatusBar from "./components/StatusBar.vue"
import GlobalDropMask from "./components/GlobalDropMask.vue"
import ConfigPanel from "./components/ConfigPanel.vue"
import HeroEmpty from "./components/HeroEmpty.vue"
import TaskTable from "./components/TaskTable.vue"
import ExecutionBoard from "./components/ExecutionBoard.vue"
import TaskInspectorDrawer from "./components/TaskInspectorDrawer.vue"
import LogDrawer from "./components/LogDrawer.vue"
import SettingsModal from "./components/SettingsModal.vue"

import { useEnvStore } from "./stores/env"
import { useConfigStore } from "./stores/config"
import { usePlanStore } from "./stores/plan"
import { useLogStore } from "./stores/log"
import { formatSize, formatDuration } from "./utils/format"

const envStore = useEnvStore()
const configStore = useConfigStore()
const planStore = usePlanStore()
const logStore = useLogStore()

// Sidebar resizer & collapse state
const sidebarWidth = ref(380)
const isSidebarCollapsed = ref(false)
const isResizing = ref(false)
const showSettings = ref(false)

function toggleSidebar() {
  isSidebarCollapsed.value = !isSidebarCollapsed.value
}

function startResizing(e: MouseEvent) {
  isResizing.value = true
  const startX = e.clientX
  const startW = sidebarWidth.value

  function onMouseMove(moveEvent: MouseEvent) {
    const delta = moveEvent.clientX - startX
    const newW = Math.max(320, Math.min(560, startW + delta))
    sidebarWidth.value = newW
  }

  function onMouseUp() {
    isResizing.value = false
    window.removeEventListener("mousemove", onMouseMove)
    window.removeEventListener("mouseup", onMouseUp)
  }

  window.addEventListener("mousemove", onMouseMove)
  window.addEventListener("mouseup", onMouseUp)
}

// Right toolbar stats
const tbStatsText = computed(() => {
  if (planStore.tasks.length === 0) return "尚无任务计划"
  const count = planStore.tasks.length
  const size = formatSize(planStore.totalSize || planStore.planSnapshot?.totalSize || 0)
  const duration = formatDuration(planStore.totalDuration || planStore.planSnapshot?.totalDuration || 0)
  if (planStore.hasStaged) {
    return `${count} 个文件 (${planStore.stagedCount} 待推演) · ${size} · ${duration}`
  }
  return `${count} 个任务 · ${size} · ${duration}`
})

// Create / Update plan
async function createPlan() {
  if (configStore.inputs.length === 0) {
    alert("请先添加至少一个媒体文件或目录")
    return
  }
  if (configStore.adv.deleteSource) {
    const ok = window.confirm(
      "【高危确认】转码成功且产物校验通过后，源文件将被移入 Mediac 安全回收目录（~/.mediac/deleted/日期），可随时恢复。请确认是否继续？"
    )
    if (!ok) return
  }

  planStore.status = "PLANNING"
  try {
    const payload = JSON.parse(JSON.stringify({
      inputs: [...configStore.inputs],
      output: configStore.outputDir || undefined,
      preset: configStore.preset,
      options: {
        outputMode: configStore.outputMode,
        prefix: configStore.prefix || undefined,
        suffix: configStore.suffix || undefined,
        fps: configStore.tune.fps > 0 ? configStore.tune.fps : undefined,
        speed: configStore.tune.speed > 0 ? configStore.tune.speed : undefined,
        dimension: configStore.tune.dimension > 0 ? configStore.tune.dimension : undefined,
        videoBitrate: configStore.tune.bitrate.trim() || undefined,
        videoQuality: configStore.tune.quality > 0 ? configStore.tune.quality : undefined,
        audioCodec: configStore.tune.audioCodec || undefined,
        audioBitrate: configStore.tune.audioBitrate || undefined,
        hwaccel: configStore.adv.hwaccel !== "auto" ? configStore.adv.hwaccel : undefined,
        decodeMode: configStore.adv.decodeMode !== "auto" ? configStore.adv.decodeMode : undefined,
        jobs: configStore.adv.jobs > 1 ? configStore.adv.jobs : undefined,
        override: configStore.adv.override,
        anime: configStore.adv.anime,
        strict: configStore.adv.strict,
        deleteSourceFiles: configStore.adv.deleteSource,
        deleteSourceConfirmed: configStore.adv.deleteSource,
      },
    }))
    const plan = await window.api.createPlan(payload)
    planStore.setPlan(plan)
    logStore.append({
      level: "INFO",
      message: `计划已生成：共 ${plan.totalTasks} 个任务，预估耗时 ${plan.totalDuration.toFixed(1)} 秒`,
      timestamp: new Date().toLocaleTimeString(),
    })
  } catch (error: any) {
    planStore.status = "FAILED"
    const msg = error instanceof Error ? error.message : String(error)
    alert(`生成计划失败: ${msg}`)
    logStore.append({
      level: "ERROR",
      message: `生成计划失败: ${msg}`,
      timestamp: new Date().toLocaleTimeString(),
    })
  }
}

// Start execution
async function startExecution() {
  if (planStore.tasks.length === 0) return
  planStore.status = "RUNNING"
  const selected = Array.from(planStore.selectedIds)
  try {
    await window.api.startExecution(selected.length > 0 ? selected : undefined)
    logStore.append({
      level: "INFO",
      message: `开始执行转码任务（共 ${selected.length || planStore.tasks.length} 项）`,
      timestamp: new Date().toLocaleTimeString(),
    })
  } catch (error: any) {
    planStore.status = "FAILED"
    const msg = error instanceof Error ? error.message : String(error)
    logStore.append({
      level: "ERROR",
      message: `执行失败: ${msg}`,
      timestamp: new Date().toLocaleTimeString(),
    })
  }
}

// Stop execution
async function stopExecution() {
  planStore.status = "STOPPING"
  try {
    await window.api.stopExecution()
    logStore.append({
      level: "WARN",
      message: "收到终止信号，正在中止转码进程…",
      timestamp: new Date().toLocaleTimeString(),
    })
  } catch (error: any) {
    logStore.append({
      level: "ERROR",
      message: `终止失败: ${error?.message || error}`,
      timestamp: new Date().toLocaleTimeString(),
    })
  }
}

// Clear all tasks & inputs
function clearAll() {
  if (planStore.status === "RUNNING") return
  configStore.clearInputs()
  planStore.setPlan(null)
}

let unsubscribeEvents: (() => void) | null = null
let unsubscribeMenu: (() => void) | null = null

async function stageAddedPaths(paths: string[]) {
  if (!paths || paths.length === 0) return
  try {
    const res = await window.api.stageInputs(paths)
    if (res.added && res.added.length > 0) {
      planStore.addStagedTasks(res.added)
    }
  } catch (err) {
    console.error("stageInputs error:", err)
  }
}

async function pickFilesGlobal() {
  try {
    const res = await window.api.selectFiles({ mode: "file", multiple: true })
    if (res.paths.length > 0) {
      configStore.addInputs(res.paths)
      await stageAddedPaths(res.paths)
    }
  } catch (err) {
    console.error("pickFilesGlobal error:", err)
  }
}

async function pickDirGlobal() {
  try {
    const res = await window.api.selectFiles({ mode: "directory" })
    if (res.paths.length > 0) {
      configStore.addInputs(res.paths)
      await stageAddedPaths(res.paths)
    }
  } catch (err) {
    console.error("pickDirGlobal error:", err)
  }
}

function openOutputDir() {
  const dir = configStore.outputDir || (planStore.tasks[0]?.fileDst ? planStore.tasks[0].fileDst.replace(/[/\\][^/\\]+$/, "") : "")
  if (dir) {
    if (window.api?.openPath) {
      void window.api.openPath(dir)
    } else if (window.api?.showInFolder) {
      void window.api.showInFolder(dir)
    }
  }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
    e.preventDefault()
    toggleSidebar()
  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault()
    if (planStore.status !== "RUNNING" && planStore.status !== "PLANNING") {
      void createPlan()
    }
  }
}

onMounted(async () => {
  window.addEventListener("keydown", handleKeydown)

  // Initialize theme: default to light
  const savedTheme = localStorage.getItem("mediac_theme") || "light"
  document.documentElement.setAttribute("data-theme", savedTheme)

  // Initialize environment & version
  await envStore.fetchEnv()
  if (envStore.summary?.presets && envStore.summary.presets.length > 0) {
    if (!envStore.summary.presets.some((p) => p.name === configStore.preset)) {
      configStore.preset = envStore.summary.presets[0].name
    }
  }

  // Subscribe to system menu action events
  if (window.api?.onMenuAction) {
    unsubscribeMenu = window.api.onMenuAction((action: string) => {
      switch (action) {
        case "add-files":
          void pickFilesGlobal()
          break
        case "add-dir":
          void pickDirGlobal()
          break
        case "open-output-dir":
          openOutputDir()
          break
        case "create-plan":
          void createPlan()
          break
        case "start-execution":
          void startExecution()
          break
        case "stop-execution":
          void stopExecution()
          break
        case "clear-tasks":
          clearAll()
          break
        case "toggle-sidebar":
          toggleSidebar()
          break
        case "toggle-log":
          logStore.drawerOpen = !logStore.drawerOpen
          break
        case "toggle-theme": {
          const cur = document.documentElement.getAttribute("data-theme") || "light"
          const next = cur === "dark" ? "light" : "dark"
          document.documentElement.setAttribute("data-theme", next)
          localStorage.setItem("mediac_theme", next)
          break
        }
        case "open-settings":
          showSettings.value = true
          break
      }
    })
  }

  // Subscribe to engine IPC events
  unsubscribeEvents = window.api.onEngineEvent((event: any) => {
    if (event.type === "task.log") {
      logStore.append({
        level: event.level || "INFO",
        message: event.message || "",
        taskId: event.taskId,
        timestamp: event.timestamp || new Date().toLocaleTimeString(),
      })
    } else if (event.type === "task.started") {
      planStore.updateTaskStatus(event.taskId, "running")
    } else if (event.type === "task.progress") {
      planStore.updateTaskProgress(event.taskId, event.percent || 0, event.speed)
    } else if (event.type === "task.done") {
      planStore.updateTaskStatus(event.taskId, "success")
    } else if (event.type === "task.failed") {
      planStore.updateTaskStatus(event.taskId, "failed", event.error)
    } else if (event.type === "task.skipped") {
      planStore.updateTaskStatus(event.taskId, "skipped", event.reason)
    } else if (event.type === "task.cancelled") {
      planStore.updateTaskStatus(event.taskId, "cancelled")
    } else if (event.type === "session.summary") {
      const summary = event.summary as any
      planStore.status = summary?.isCancelled ? "STOPPED" : "COMPLETED"
      if (window.api?.notify) {
        void window.api.notify(
          "转码任务完成",
          `共处理 ${summary?.total || 0} 个文件，成功 ${summary?.succeeded || 0} 个`
        )
      }
    }
  })
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown)
  unsubscribeEvents?.()
  unsubscribeMenu?.()
})
</script>

<template>
  <div class="app-container" data-testid="app-container">
    <!-- 全域拖拽高亮蒙层 -->
    <GlobalDropMask />

    <!-- 顶栏 HeaderBar -->
    <HeaderBar
      :stats-text="tbStatsText"
      @toggle-sidebar="toggleSidebar"
      @open-settings="showSettings = true"
      @create-plan="createPlan"
      @start-execution="startExecution"
      @stop-execution="stopExecution"
      @clear-all="clearAll"
    />

    <!-- 主工作区双栏布局 -->
    <div class="layout">
      <!-- 左侧配置侧栏 -->
      <aside
        class="side"
        :class="{ collapsed: isSidebarCollapsed }"
        :style="{ width: isSidebarCollapsed ? '0px' : `${sidebarWidth}px` }"
      >
        <ConfigPanel v-show="!isSidebarCollapsed" @collapse="toggleSidebar" />
      </aside>

      <!-- 拖拽手柄 -->
      <div
        v-show="!isSidebarCollapsed"
        class="side-resizer"
        :class="{ drag: isResizing }"
        data-testid="side-resizer"
        title="拖动调整左栏宽度"
        @mousedown="startResizing"
      ></div>

      <!-- 右侧主任务区 -->
      <main class="main" data-testid="main-panel">
        <!-- 侧栏收起时的左边缘浮动展开按钮 -->
        <button
          v-if="isSidebarCollapsed"
          class="btn-edge-expand"
          data-testid="btn-edge-expand"
          title="展开转码配置栏 (Ctrl+B)"
          @click="toggleSidebar"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span>配置</span>
        </button>

        <!-- 表格或空态 -->
        <HeroEmpty v-if="planStore.tasks.length === 0" />
        <TaskTable v-else />

        <!-- 底部紧凑/展开执行看板 -->
        <ExecutionBoard />
      </main>
    </div>

    <!-- 底部状态栏 StatusBar -->
    <StatusBar />

    <!-- 侧拉式右侧检查器抽屉 -->
    <TaskInspectorDrawer />

    <!-- 侧拉式右侧日志抽屉 -->
    <LogDrawer />

    <!-- 设置弹窗 -->
    <SettingsModal
      :show="showSettings"
      @close="showSettings = false"
    />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background-color: var(--bg-body);
  color: var(--text-base);
}

.layout {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.side {
  flex: none;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: var(--bg-body);
  transition: width 0.16s ease, padding 0.16s ease;
}

.side.collapsed {
  width: 0 !important;
  padding: 0 !important;
  border-right: none;
}

.side-resizer {
  width: 5px;
  flex: none;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 20;
}

.side-resizer::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--divider);
}

.side-resizer:hover,
.side-resizer.drag {
  background: var(--primary-soft);
}

.side-resizer:hover::after,
.side-resizer.drag::after {
  background: var(--primary);
}

.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-body);
  position: relative;
}

.btn-edge-expand {
  position: absolute;
  top: 12px;
  left: 0;
  z-index: 30;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 4px 4px 0;
  padding: 6px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-2);
  cursor: pointer;
  box-shadow: 2px 0 8px rgba(0, 0, 0, 0.1);
  transition: all 0.12s ease;
}

.btn-edge-expand:hover {
  background: var(--bg-hover);
  color: var(--primary-text);
  border-color: var(--border-strong);
}

.btn-edge-expand svg {
  width: 12px;
  height: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--divider);
  flex: none;
  flex-wrap: wrap;
  background: var(--bg-card);
}

.tb-left {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.tb-right {
  display: flex;
  gap: 14px;
  align-items: center;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}

.muted {
  color: var(--text-3);
  font-family: var(--mono);
  font-size: 11px;
}

.btn {
  height: 28px;
  padding: 0 12px;
  font-size: 12px;
  font-family: var(--font);
  border-radius: var(--radius);
  border: 1px solid transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-base);
  background: transparent;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
}

.btn:hover {
  background: var(--bg-hover);
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  background: transparent;
}

.btn-primary {
  background: var(--primary);
  color: #101014;
  font-weight: 600;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-primary:disabled {
  background: var(--primary);
  opacity: 0.38;
}

[data-theme="light"] .btn-primary {
  color: #fff;
}

.btn-secondary {
  border-color: var(--border);
  background: var(--bg-input);
}

.btn-secondary:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.btn-ghost {
  color: var(--text-2);
}

.btn-ghost:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

.btn-danger {
  color: var(--error);
  border-color: transparent;
}

.btn-danger:hover {
  background: var(--error-soft);
}

.btn-danger:disabled {
  opacity: 0.38;
  background: transparent;
}

.stale-alert {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: 4px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11px;
  font-weight: 500;
  animation: fadeIn 0.2s ease-out;
}

.stale-alert svg {
  width: 14px;
  height: 14px;
}

.pulse {
  animation: pulseAnim 1.8s infinite;
}

@keyframes pulseAnim {
  0% { box-shadow: 0 0 0 0 rgba(99, 226, 183, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(99, 226, 183, 0); }
  100% { box-shadow: 0 0 0 0 rgba(99, 226, 183, 0); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}

svg.i {
  width: 14px;
  height: 14px;
}

svg.i.sm {
  width: 13px;
  height: 13px;
}
</style>
