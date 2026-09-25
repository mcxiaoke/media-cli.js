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
import AboutModal from "./components/AboutModal.vue"

import { useEnvStore } from "./stores/env"
import { useConfigStore } from "./stores/config"
import { usePlanStore } from "./stores/plan"
import { useLogStore } from "./stores/log"
import { formatSize, formatDuration } from "./utils/format"
import { useInputIngest } from "./composables/useInputIngest"
import { MENU_ACTIONS } from "../../shared/ipc-channels"

const envStore = useEnvStore()
const configStore = useConfigStore()
const planStore = usePlanStore()
const logStore = useLogStore()
const { ingestPaths, isIngesting } = useInputIngest()

// Sidebar resizer & collapse state
const sidebarWidth = ref(380)
const isSidebarCollapsed = ref(false)
const isResizing = ref(false)
const showSettings = ref(false)
const showAbout = ref(false)

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

/**
 * 运行中/规划中/终止中的状态守卫。
 * 菜单加速键由主进程直接派发，绕过页面 keydown 拦截，
 * 因此守卫必须落在动作函数本身，而不能只写在 keydown 里。
 */
function isBusy() {
  return planStore.status === "RUNNING" || planStore.status === "PLANNING" || planStore.status === "STOPPING"
}

async function createPlanInternal() {
  if (configStore.inputs.length === 0) {
    throw new Error("请先添加至少一个媒体文件或目录")
  }
  // 主进程会校验 deleteSourceConfirmed；必须让它反映本次弹窗的真实确认结果，
  // 而非直接复用 deleteSource 开关状态（否则校验形同虚设）
  let deleteSourceAck = false
  if (configStore.adv.deleteSource) {
    const ok = window.confirm(
      "【高危确认】转码成功且产物校验通过后，源文件将被移入 Mediac 安全回收目录（~/.mediac/deleted/日期），可随时恢复。请确认是否继续？"
    )
    if (!ok) {
      throw new Error("用户取消了高危删除确认")
    }
    deleteSourceAck = true
  }

  planStore.status = "PLANNING"
  const effectiveInputs = planStore.excludedPaths.size > 0
    ? configStore.inputs.filter((p) => !planStore.excludedPaths.has(p))
    : [...configStore.inputs]

  if (effectiveInputs.length === 0) {
    throw new Error("没有有效的待转码输入文件")
  }

  const payload = JSON.parse(JSON.stringify({
    inputs: effectiveInputs,
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
      deleteSourceConfirmed: deleteSourceAck,
    },
  }))
  const plan = await window.api.createPlan(payload)
  planStore.setPlan(plan)
  logStore.append({
    level: "INFO",
    message: `计划已生成：共 ${plan.totalTasks} 个任务，预估耗时 ${plan.totalDuration.toFixed(1)} 秒`,
    timestamp: new Date().toLocaleTimeString(),
  })
}

// Create / Update plan
async function createPlan() {
  if (isBusy()) return
  if (configStore.inputs.length === 0) {
    alert("请先添加至少一个媒体文件或目录")
    return
  }
  const knownPreviousPaths = new Set(planStore.tasks.map((t) => t.path))
  const selectedPaths = new Set(
    planStore.tasks.filter((t) => planStore.selectedIds.has(t.id)).map((t) => t.path)
  )

  try {
    await createPlanInternal()
    planStore.restoreSelectionByPaths(knownPreviousPaths, selectedPaths)
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
  // 入口自检：菜单 F5 与页面按钮共用此函数，无守卫会把运行中的会话打成 FAILED
  if (isBusy()) return
  if (planStore.tasks.length === 0 && configStore.inputs.length === 0) return

  // 1. 记忆当前用户明确勾选的文件绝对路径
  const knownPreviousPaths = new Set(planStore.tasks.map((t) => t.path))
  const selectedPaths = new Set(
    planStore.tasks.filter((t) => planStore.selectedIds.has(t.id)).map((t) => t.path)
  )

  // 2. 若存在未推演输入或配置已变动 (STALE/hasStaged) 或尚未生成计划，隐式触发流水线推演
  if (planStore.hasStaged || planStore.status === "STALE" || !planStore.planSnapshot) {
    try {
      await createPlanInternal()
      planStore.restoreSelectionByPaths(knownPreviousPaths, selectedPaths)
    } catch (err: any) {
      planStore.status = "FAILED"
      const msg = err instanceof Error ? err.message : String(err)
      logStore.append({
        level: "ERROR",
        message: `准备转码失败: ${msg}`,
        timestamp: new Date().toLocaleTimeString(),
      })
      return
    }
  }

  // 3. 显式提取选中的任务 ID，禁止传递空数组或 undefined
  const executableTasks = planStore.tasks.filter(
    (t) => planStore.selectedIds.has(t.id) && t.status !== "success" && t.status !== "skipped"
  )
  const executableIds = executableTasks.map((t) => t.id)
  if (executableIds.length === 0) {
    // 检查是否有失败项可供重试
    const failedTasks = planStore.tasks.filter((t) => t.status === "failed")
    if (failedTasks.length > 0) {
      for (const t of failedTasks) {
        planStore.selectedIds.add(t.id)
      }
      const retryIds = failedTasks.map((t) => t.id)
      if (configStore.adv.override) {
        logStore.append({
          level: "INFO",
          message: "[配置提醒] 已启用覆盖已有产物模式（override: true），同名目标文件将被直接重写",
          timestamp: new Date().toLocaleTimeString(),
        })
      }
      planStore.status = "RUNNING"
      try {
        await window.api.startExecution(retryIds)
        logStore.append({
          level: "INFO",
          message: `重试失败转码任务（共 ${retryIds.length} 项）`,
          timestamp: new Date().toLocaleTimeString(),
        })
      } catch (error: any) {
        planStore.status = "FAILED"
        const msg = error instanceof Error ? error.message : String(error)
        logStore.append({
          level: "ERROR",
          message: `重试失败: ${msg}`,
          timestamp: new Date().toLocaleTimeString(),
        })
      }
      return
    }
    return
  }

  if (configStore.adv.override) {
    logStore.append({
      level: "INFO",
      message: "[配置提醒] 已启用覆盖已有产物模式（override: true），同名目标文件将被直接重写",
      timestamp: new Date().toLocaleTimeString(),
    })
  }

  planStore.status = "RUNNING"
  try {
    await window.api.startExecution(executableIds)
    logStore.append({
      level: "INFO",
      message: `开始执行转码任务（共 ${executableIds.length} 项）`,
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
  if (planStore.status !== "RUNNING" && planStore.status !== "STOPPING") return
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
  if (isBusy()) return
  configStore.clearInputs()
  planStore.setPlan(null)
}

let unsubscribeEvents: (() => void) | null = null
let unsubscribeMenu: (() => void) | null = null

async function pickFilesGlobal() {
  try {
    const res = await window.api.selectFiles({ mode: "file", multiple: true })
    if (res.paths.length > 0) {
      await ingestPaths(res.paths)
    }
  } catch (err) {
    console.error("pickFilesGlobal error:", err)
  }
}

async function pickDirGlobal() {
  try {
    const res = await window.api.selectFiles({ mode: "directory" })
    if (res.paths.length > 0) {
      await ingestPaths(res.paths)
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
  if (e.key === "Escape") {
    if (showSettings.value) {
      showSettings.value = false
      return
    }
    if (showAbout.value) {
      showAbout.value = false
      return
    }
    if (logStore.drawerOpen) {
      logStore.drawerOpen = false
      return
    }
    if (planStore.inspectedTask) {
      planStore.inspectedTask = null
      return
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
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

  // Restore and sync custom external tool paths if saved in localStorage
  const savedFfmpeg = localStorage.getItem("mediac_tool_ffmpeg") || ""
  const savedFfprobe = localStorage.getItem("mediac_tool_ffprobe") || ""
  if (savedFfmpeg || savedFfprobe) {
    if (window.api?.setCustomToolPaths) {
      try {
        await window.api.setCustomToolPaths({ ffmpeg: savedFfmpeg, ffprobe: savedFfprobe })
      } catch (err) {
        console.error("Failed to restore custom tool paths:", err)
      }
    }
  }

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
        case MENU_ACTIONS.ADD_FILES:
          void pickFilesGlobal()
          break
        case MENU_ACTIONS.ADD_DIRECTORY:
          void pickDirGlobal()
          break
        case MENU_ACTIONS.OPEN_OUTPUT_DIR:
          openOutputDir()
          break
        case MENU_ACTIONS.CREATE_PLAN:
          void createPlan()
          break
        case MENU_ACTIONS.START_EXECUTION:
          void startExecution()
          break
        case MENU_ACTIONS.STOP_EXECUTION:
          void stopExecution()
          break
        case MENU_ACTIONS.CLEAR_TASKS:
          clearAll()
          break
        case MENU_ACTIONS.TOGGLE_SIDEBAR:
          toggleSidebar()
          break
        case MENU_ACTIONS.TOGGLE_LOG:
          logStore.drawerOpen = !logStore.drawerOpen
          break
        case MENU_ACTIONS.TOGGLE_THEME: {
          const cur = document.documentElement.getAttribute("data-theme") || "light"
          const next = cur === "dark" ? "light" : "dark"
          document.documentElement.setAttribute("data-theme", next)
          localStorage.setItem("mediac_theme", next)
          break
        }
        case MENU_ACTIONS.OPEN_SETTINGS:
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
      // 失败任务同样发 task.done（engine 无 task.failed 事件），靠 failed 标记区分
      if (event.failed === true) {
        planStore.updateTaskStatus(event.taskId, "failed", (event.result as any)?.error || "转码失败")
      } else {
        planStore.updateTaskStatus(event.taskId, "success")
      }
    } else if (event.type === "task.skipped") {
      planStore.updateTaskStatus(event.taskId, "skipped", event.reason)
    } else if (event.type === "task.cancelled") {
      planStore.updateTaskStatus(event.taskId, "cancelled")
    } else if (event.type === "session.summary") {
      const summary = event.summary as any
      const failedCount = typeof summary?.failed === "number" ? summary.failed : 0
      planStore.status = summary?.isCancelled
        ? "STOPPED"
        : failedCount > 0
          ? "FAILED"
          : "COMPLETED"
      const total = summary?.total || 0
      const succeeded = typeof summary?.success === "number" ? summary.success : 0
      logStore.append({
        level: failedCount > 0 ? "ERROR" : "INFO",
        message: `转码结束：共 ${total} 个任务，成功 ${succeeded} 个，失败 ${failedCount} 个，跳过 ${summary?.skipped || 0} 个，耗时 ${((summary?.elapsedMs || 0) / 1000).toFixed(1)} 秒`,
        timestamp: new Date().toLocaleTimeString(),
      })
      if (window.api?.notify) {
        void window.api.notify(
          failedCount > 0 ? "转码任务结束（含失败）" : "转码任务完成",
          `共处理 ${total} 个文件，成功 ${succeeded} 个${failedCount > 0 ? `，失败 ${failedCount} 个` : ""}`
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
      :is-ingesting="isIngesting"
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
        <ConfigPanel v-show="!isSidebarCollapsed" :is-busy="isBusy()" @collapse="toggleSidebar" />
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
    <StatusBar @open-about="showAbout = true" />

    <!-- 侧拉式右侧检查器抽屉 -->
    <TaskInspectorDrawer />

    <!-- 侧拉式右侧日志抽屉 -->
    <LogDrawer />

    <!-- 设置弹窗 -->
    <SettingsModal
      :show="showSettings"
      @close="showSettings = false"
    />

    <!-- 关于与系统信息弹窗 -->
    <AboutModal
      :show="showAbout"
      @close="showAbout = false"
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
