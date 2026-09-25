<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue"
import { usePlanStore } from "../stores/plan"
import { useConfigStore } from "../stores/config"
import { useLogStore } from "../stores/log"
import { formatSize, formatDuration } from "../utils/format"
import type { PlanTask, TaskStatus } from "../../../shared/contracts"

const planStore = usePlanStore()
const configStore = useConfigStore()
const logStore = useLogStore()
const isDetailExpanded = ref(false)
const emit = defineEmits<{ (e: "clearAll"): void }>()

async function playMedia(filePath: string) {
  if (!filePath || !window.api?.openPath) return
  try {
    const err = await window.api.openPath(filePath)
    if (err) {
      logStore.append({
        level: "WARN",
        message: `无法直接播放: ${err}，已为您在资源管理器中定位`,
        timestamp: new Date().toLocaleTimeString(),
      })
      if (window.api?.showInFolder) {
        void window.api.showInFolder(filePath)
      }
    }
  } catch (e: any) {
    if (window.api?.showInFolder) {
      void window.api.showInFolder(filePath)
    }
  }
}

function playSource(task: PlanTask, event?: MouseEvent) {
  event?.stopPropagation()
  void playMedia(task.path)
}

function playOutput(task: PlanTask, event?: MouseEvent) {
  event?.stopPropagation()
  if (task.fileDst) {
    void playMedia(task.fileDst)
  }
}

const hasMultipleSourceDirs = computed(() => {
  const dirs = new Set(
    planStore.tasks.map((t) => {
      const idx = Math.max(t.path.lastIndexOf("/"), t.path.lastIndexOf("\\"))
      return idx > 0 ? t.path.substring(0, idx) : ""
    })
  )
  return dirs.size > 1
})

async function pickOutputDir() {
  try {
    const res = await window.api.selectFiles({ mode: "directory", multiple: false })
    if (res.paths && res.paths[0]) {
      configStore.setCustomOutputDir(res.paths[0])
    }
  } catch (err) {
    console.error("pickOutputDir error:", err)
  }
}

const STATUS_MAP: Record<TaskStatus, { text: string; cls: string }> = {
  staged: { text: "待规划", cls: "staged" },
  pending: { text: "待处理", cls: "" },
  preparing: { text: "准备中", cls: "info" },
  running: { text: "转码中", cls: "info" },
  retrying: { text: "重试中", cls: "warn" },
  success: { text: "已完成", cls: "ok" },
  failed: { text: "失败", cls: "err" },
  skipped: { text: "跳过", cls: "warn" },
  cancelled: { text: "已取消", cls: "dis" },
}

function getStatusInfo(status: TaskStatus) {
  return STATUS_MAP[status] || { text: status, cls: "" }
}

// 双击行：直接呼出媒体信息与推演命令检查器 (ffprobe)
function handleRowDblClick(task: PlanTask, event?: MouseEvent) {
  if (event && (event.target as HTMLElement).closest(".ck, .icon-btn, .t-ops")) return
  window.getSelection()?.removeAllRanges()
  planStore.activeTaskId = task.id
  planStore.inspectedTask = task
}

function removeTask(task: PlanTask, event?: MouseEvent) {
  event?.stopPropagation()
  // 运行中禁止移除：引擎仍会写盘，移除后该任务进度/结果事件静默失配
  if (isPlanBusy()) return
  planStore.removeTask(task.id)
  if (task.path) {
    configStore.removeInputs([task.path])
    if (window.api?.removeStagedInputs) {
      void window.api.removeStagedInputs([task.path])
    }
  }
  logStore.append({
    level: "INFO",
    message: `已从任务列表中移除: ${task.name}`,
    timestamp: new Date().toLocaleTimeString(),
  })
}

function openInFolder(task: PlanTask, event?: MouseEvent) {
  event?.stopPropagation()
  // Before transcoding finishes, locate the existing source file;
  // Once finished, locate the generated destination file.
  const isDone = task.status === "success"
  const target = isDone ? (task.fileDst || task.path) : task.path
  if (target && window.api?.showInFolder) {
    void window.api.showInFolder(target)
  }
}

// 行点击：仅更新当前激活行（用于底部信息快速聚焦），绝不冲刷选项框多选集合
function handleRowClick(task: PlanTask, event: MouseEvent) {
  if ((event.target as HTMLElement).closest(".ck, .ck-cell, .icon-btn, .t-ops")) return
  planStore.activeTaskId = task.id
}

// 选项框点击：仅鼠标左键点击选项框时切换勾选状态
function handleCheckboxClick(task: PlanTask, event: MouseEvent) {
  event.stopPropagation()
  planStore.toggleTask(task.id)
}

// ============ 右键常用菜单状态与操作 ============
interface ContextMenuState {
  visible: boolean
  x: number
  y: number
  task: PlanTask | null
}

const contextMenu = ref<ContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  task: null,
})

function openContextMenu(task: PlanTask, event: MouseEvent) {
  event.preventDefault()
  planStore.activeTaskId = task.id

  const menuWidth = 220
  const menuHeight = 340
  const winW = window.innerWidth
  const winH = window.innerHeight

  let x = event.clientX
  let y = event.clientY

  if (x + menuWidth > winW) {
    x = Math.max(10, winW - menuWidth - 10)
  }
  if (y + menuHeight > winH) {
    y = Math.max(10, winH - menuHeight - 10)
  }

  contextMenu.value = {
    visible: true,
    x,
    y,
    task,
  }
}

function closeContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.task = null
}

function inspectFromMenu() {
  if (contextMenu.value.task) {
    planStore.inspectedTask = contextMenu.value.task
  }
  closeContextMenu()
}

function openInFolderFromMenu() {
  if (contextMenu.value.task) {
    openInFolder(contextMenu.value.task)
  }
  closeContextMenu()
}

async function copyPathFromMenu() {
  const p = contextMenu.value.task?.path
  if (p) {
    if (window.api?.copyText) {
      await window.api.copyText(p)
    } else {
      await navigator.clipboard.writeText(p)
    }
    logStore.append({
      level: "INFO",
      message: `已复制源文件路径: ${p}`,
      timestamp: new Date().toLocaleTimeString(),
    })
  }
  closeContextMenu()
}

async function copyCmdFromMenu() {
  const t = contextMenu.value.task
  if (t) {
    const baseCmd = planStore.planSnapshot?.previewCmd
    let cmd = ""
    const firstTask = planStore.tasks[0]
    if (baseCmd && firstTask) {
      cmd = baseCmd
        .split(`"${firstTask.path}"`).join(`"${t.path}"`)
        .split(firstTask.path).join(t.path)
        .split(`"${firstTask.fileDst}"`).join(`"${t.fileDst}"`)
        .split(firstTask.fileDst).join(t.fileDst)
    } else {
      cmd = `ffmpeg -i "${t.path}" "${t.fileDst || 'output.mp4'}"`
    }
    if (window.api?.copyText) {
      await window.api.copyText(cmd)
    } else {
      await navigator.clipboard.writeText(cmd)
    }
    logStore.append({
      level: "INFO",
      message: `已复制推演 FFmpeg 命令`,
      timestamp: new Date().toLocaleTimeString(),
    })
  }
  closeContextMenu()
}

function toggleTaskFromMenu() {
  if (contextMenu.value.task) {
    planStore.toggleTask(contextMenu.value.task.id)
  }
  closeContextMenu()
}

function selectAllFromMenu() {
  planStore.selectAll()
  closeContextMenu()
}

function invertSelectionFromMenu() {
  planStore.invertSelection()
  closeContextMenu()
}

function clearSelectionFromMenu() {
  planStore.clearSelection()
  closeContextMenu()
}

function removeTaskFromMenu() {
  if (contextMenu.value.task) {
    removeTask(contextMenu.value.task)
  }
  closeContextMenu()
}

function removeSelectedFromMenu() {
  // 运行中禁止移除：引擎仍会写盘，移除后进度事件静默失配，用户失去可见性
  if (isPlanBusy()) return
  // removeSelectedTasks 会清空 selectedIds，先捕获路径再同步剔除 inputs 与主进程 staged
  const paths = planStore.tasks
    .filter((t) => planStore.selectedIds.has(t.id))
    .map((t) => t.path)
    .filter((p): p is string => Boolean(p))
  planStore.removeSelectedTasks()
  if (paths.length > 0) {
    configStore.removeInputs(paths)
    if (window.api?.removeStagedInputs) {
      void window.api.removeStagedInputs(paths)
    }
  }
  closeContextMenu()
}

// 与 App.vue 的 isBusy 同口径：菜单/右键操作与顶栏按钮共用状态守卫
function isPlanBusy() {
  return (
    planStore.status === "RUNNING" ||
    planStore.status === "PLANNING" ||
    planStore.status === "STOPPING"
  )
}

async function clearAllTasksFromMenu() {
  // 与顶栏 clearAll 严格等价。此前只 setPlan(null)，遗漏三件事：
  // 1) 无 busy 守卫：RUNNING 中清空会让 UI 与引擎脱钩（状态被重置、终止按钮消失）；
  // 2) 未清 configStore.inputs：下次生成计划时被清空的文件全量复活；
  // 3) 未清主进程 stagedEntries：相同文件再次导入被当重复静默丢弃。
  if (isPlanBusy()) return
  configStore.clearInputs()
  planStore.setPlan(null)
  if (window.api?.clearStagedInputs) {
    try {
      await window.api.clearStagedInputs()
    } catch (err) {
      console.error("clearStagedInputs error:", err)
    }
  }
  closeContextMenu()
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === "Escape" && contextMenu.value.visible) {
    closeContextMenu()
  }
}

onMounted(() => {
  window.addEventListener("click", closeContextMenu)
  window.addEventListener("resize", closeContextMenu)
  window.addEventListener("keydown", handleGlobalKeydown)
})

onUnmounted(() => {
  window.removeEventListener("click", closeContextMenu)
  window.removeEventListener("resize", closeContextMenu)
  window.removeEventListener("keydown", handleGlobalKeydown)
})

function inspectTask(task: PlanTask, event: MouseEvent) {
  event.stopPropagation()
  planStore.inspectedTask = task
}

function focusTaskLog(task: PlanTask, event: MouseEvent) {
  event.stopPropagation()
  logStore.focusTask(task.id)
  logStore.drawerOpen = true
}

function getBaseName(filePath: string) {
  if (!filePath) return "—"
  const parts = filePath.split(/[/\\]/)
  return parts[parts.length - 1] || filePath
}

function getDirName(filePath: string) {
  if (!filePath) return ""
  const parts = filePath.split(/[/\\]/)
  if (parts.length <= 1) return ""
  return parts.slice(0, -1).join("/")
}

function isSelected(id: string) {
  return planStore.selectedIds.has(id)
}

function isRowSelectedOrActive(id: string) {
  return planStore.activeTaskId === id || planStore.selectedIds.has(id)
}

function isRowActive(id: string) {
  return planStore.activeTaskId === id
}

function getFmtText(name: string) {
  if (!name) return "FILE"
  const m = name.match(/\.([a-z0-9]+)$/i)
  return m ? m[1].toUpperCase() : "FILE"
}

function getFmtClass(name: string) {
  const ext = getFmtText(name).toLowerCase()
  if (ext === "mp4") return "fmt-mp4"
  if (ext === "mkv") return "fmt-mkv"
  if (ext === "webm") return "fmt-webm"
  if (ext === "mov") return "fmt-mov"
  if (ext === "avi") return "fmt-avi"
  if (ext === "ts" || ext === "m2ts") return "fmt-ts"
  return "fmt-other"
}

// 快速对比底板：优先展示当前激活聚焦项，或检查项，或勾选项，或首项
const selectedTask = computed(() => {
  return planStore.inspectedTask
    || (planStore.activeTaskId ? planStore.tasks.find((task) => task.id === planStore.activeTaskId) : null)
    || planStore.tasks.find((task) => planStore.selectedIds.has(task.id))
    || planStore.tasks[0]
    || null
})

const selectedTaskPreview = computed(() => {
  const t = selectedTask.value
  if (!t) return null
  const src = [
    t.containerFormat || getFmtText(t.name),
    t.width && t.height ? `${t.width}x${t.height}` : "",
    t.fps ? `${t.fps}fps` : "",
    t.videoCodec ? t.videoCodec.toUpperCase() : "",
    t.audioCodec ? t.audioCodec.toUpperCase() : "",
    formatSize(t.size),
    formatDuration(t.duration),
  ].filter(Boolean).join(" · ")

  const ts = t.targetSummary
  const dstParts = []
  if (ts?.width && ts?.height) dstParts.push(`${ts.width}x${ts.height}`)
  if (ts?.fps) dstParts.push(`${ts.fps}fps`)
  if (ts?.videoEncoder) dstParts.push(ts.videoEncoder)
  if (ts?.quality) dstParts.push(`CRF ${ts.quality}`)
  else if (ts?.bitrate) dstParts.push(`${Math.round(ts.bitrate / 1000)}k`)
  if (ts?.audioCodec) dstParts.push(ts.audioCodec.toUpperCase())
  if (ts?.container) dstParts.push(ts.container.toUpperCase())

  const dst = dstParts.length > 0
    ? dstParts.join(" · ")
    : t.fileDst
      ? `${getBaseName(t.fileDst)} · [${planStore.planSnapshot?.presetName || '预设'}]`
      : `[待推演] 遵循当前预设及参数微调`

  return { name: t.name, srcText: src, dstText: dst, task: t }
})
</script>

<template>
  <div class="table-container" data-testid="table-container">
    <div class="table-body-scroll">
      <table class="tasks" data-testid="tasks-table">
        <colgroup>
          <col style="width: 36px" />
          <col style="width: 38px" />
          <col style="width: 26%" />
          <col style="width: 84px" />
          <col style="width: 80px" />
          <col style="width: 130px" />
          <col style="width: 24%" />
          <col style="width: 120px" />
          <col style="width: 140px" />
        </colgroup>
        <thead>
          <tr>
            <th>
              <span
                class="ck"
                :class="{ on: planStore.isAllSelected }"
                data-testid="ck-all"
                role="checkbox"
                :aria-checked="planStore.isAllSelected"
                tabindex="0"
                title="全选 / 取消全选"
                @click.left="planStore.toggleAll"
                @keydown.space.prevent="planStore.toggleAll"
              ></span>
            </th>
            <th>#</th>
            <th>源文件</th>
            <th>大小</th>
            <th>时长</th>
            <th>解码 → 编码</th>
            <th>目标文件</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody data-testid="tasks-tbody">
          <tr
            v-for="task in planStore.tasks"
            :key="task.id"
            :class="{
              sel: isRowSelectedOrActive(task.id),
              active: isRowActive(task.id),
              checked: isSelected(task.id),
              dim: task.status === 'skipped'
            }"
            data-testid="task-row"
            :data-task-id="task.id"
            @click="handleRowClick(task, $event)"
            @dblclick="handleRowDblClick(task, $event)"
            @contextmenu.prevent.stop="openContextMenu(task, $event)"
          >
            <td class="ck-cell" @click.stop>
              <span
                class="ck"
                :class="{ on: isSelected(task.id) }"
                data-testid="task-checkbox"
                role="checkbox"
                :aria-checked="isSelected(task.id)"
                tabindex="0"
                title="勾选 / 取消勾选"
                @click.left.stop="handleCheckboxClick(task, $event)"
                @keydown.space.prevent="planStore.toggleTask(task.id)"
              ></span>
            </td>
            <td class="t-num">{{ task.index + 1 }}</td>
            <td>
              <div class="t-main" :title="task.name">
                <span class="fmt-tag" :class="getFmtClass(task.name)">{{ getFmtText(task.name) }}</span>
                <span>{{ task.name }}</span>
              </div>
              <div class="t-sub" :title="task.path">{{ getDirName(task.path) }}</div>
            </td>
            <td class="t-meta">{{ formatSize(task.size) }}</td>
            <td class="t-meta">{{ formatDuration(task.duration) }}</td>
            <td>
              <div class="codec-tag">
                <span class="c-src">{{ task.videoCodec || 'auto' }}</span>
                <span class="c-arrow">→</span>
                <span class="c-dst">{{ planStore.planSnapshot?.presetName || 'target' }}</span>
              </div>
            </td>
            <td>
              <div v-if="task.fileDst" class="t-main" :title="task.fileDst">{{ getBaseName(task.fileDst) }}</div>
              <div v-else class="t-main t-staged">[待推演] 遵循左侧预设</div>
              <div v-if="task.fileDst" class="t-sub" :title="task.fileDst">{{ getDirName(task.fileDst) }}</div>
            </td>
            <td>
              <div class="status-cell">
                <span
                  class="tag"
                  :class="getStatusInfo(task.status).cls"
                  data-testid="task-status"
                  :title="task.error || task.skipReason || ''"
                >
                  {{ getStatusInfo(task.status).text }}
                </span>
                <div v-if="task.status === 'running'" class="row-bar">
                  <i :style="{ width: `${task.progress || 0}%` }"></i>
                </div>
              </div>
            </td>
            <td>
              <div class="t-ops">
                <button
                  class="icon-btn"
                  title="播放源视频"
                  data-testid="btn-play-source"
                  @click="playSource(task, $event)"
                >
                  <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="6 4 18 12 6 20 6 4" />
                  </svg>
                </button>
                <button
                  v-if="task.status === 'success'"
                  class="icon-btn ok-icon"
                  title="播放转码产物"
                  data-testid="btn-play-output"
                  @click="playOutput(task, $event)"
                >
                  <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
                    <polygon points="10 8 16 12 10 16 10 8" />
                  </svg>
                </button>
                <button
                  class="icon-btn"
                  title="查看源媒体规格与推演命令 (ffprobe)"
                  data-testid="btn-inspect-task"
                  @click="inspectTask(task, $event)"
                >
                  <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </button>
                <button
                  class="icon-btn"
                  title="在资源管理器中定位"
                  data-testid="btn-show-in-folder"
                  @click="openInFolder(task, $event)"
                >
                  <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </button>
                <button
                  v-if="task.status === 'failed'"
                  class="icon-btn err-icon"
                  title="查看失败错误日志"
                  data-testid="btn-task-log"
                  @click="focusTaskLog(task, $event)"
                >
                  <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </button>
                <button
                  class="icon-btn del-btn"
                  title="从任务列表中移除"
                  data-testid="btn-remove-task"
                  @click="removeTask(task, $event)"
                >
                  <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 列表底部操作与快速对比底板（对标 ShanaEncoder） -->
    <div class="table-bottom-bar" data-testid="table-bottom-bar">
      <div class="bottom-top-row">
        <div class="tb-actions">
          <button
            class="btn btn-sm btn-secondary"
            data-testid="btn-toggle-all"
            title="全选或取消全选 (Space)"
            @click="planStore.toggleAll"
          >
            <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 11 12 14 22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            <span>{{ planStore.isAllSelected ? '取消全选' : '全选' }}</span>
          </button>
          <button
            class="btn btn-sm btn-secondary"
            data-testid="btn-remove-selected"
            :disabled="planStore.selectedIds.size === 0"
            title="从列表中移除当前所有已勾选项"
            @click="planStore.removeSelectedTasks()"
          >
            <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>移除所选 ({{ planStore.selectedIds.size }})</span>
          </button>
        </div>

        <!-- 选中任务单行紧凑差异摘要（默认态） -->
        <div v-if="selectedTaskPreview && !isDetailExpanded" class="tb-preview" data-testid="task-quick-preview">
          <div class="pv-col pv-src" :title="selectedTaskPreview.name">
            <span class="pv-label">源媒体:</span>
            <span class="pv-val">{{ selectedTaskPreview.srcText }}</span>
          </div>
          <div class="pv-sep">→</div>
          <div class="pv-col pv-dst">
            <span class="pv-label">推演目标:</span>
            <span class="pv-val">{{ selectedTaskPreview.dstText }}</span>
          </div>
          <button
            class="btn-detail-toggle"
            data-testid="btn-detail-toggle"
            title="切换展开/收起详细规格对比"
            @click="isDetailExpanded = true"
          >
            详情 ▾
          </button>
        </div>
        <div v-else-if="!selectedTaskPreview" class="tb-summary">
          共 {{ planStore.tasks.length }} 个视频文件 · 总计 {{ formatSize(planStore.totalSize) }} · 时长 {{ formatDuration(planStore.totalDuration) }}
        </div>
      </div>

      <!-- 展开态：Shana 风格结构化双栏详细对比卡片 -->
      <div v-if="selectedTaskPreview && isDetailExpanded" class="shana-compare-card" data-testid="shana-compare-card">
        <div class="card-head">
          <span class="card-title">媒体详细对比：{{ selectedTaskPreview.name }}</span>
          <button
            class="btn-detail-toggle"
            data-testid="btn-collapse-detail"
            @click="isDetailExpanded = false"
          >
            收起 ▴
          </button>
        </div>
        <div class="card-grid">
          <div class="card-col card-src">
            <div class="col-title">【输入源媒体】</div>
            <div class="card-item"><span>规格：</span><b>{{ selectedTaskPreview.task.width }}x{{ selectedTaskPreview.task.height }} · {{ selectedTaskPreview.task.fps }}fps</b></div>
            <div class="card-item"><span>编码：</span><b>{{ selectedTaskPreview.task.videoCodec || '未知' }} / {{ selectedTaskPreview.task.audioCodec || '未知' }}</b></div>
            <div class="card-item"><span>大小：</span><b>{{ formatSize(selectedTaskPreview.task.size) }} ({{ formatDuration(selectedTaskPreview.task.duration) }})</b></div>
            <div class="card-item truncate" :title="selectedTaskPreview.task.path"><span>路径：</span>{{ selectedTaskPreview.task.path }}</div>
          </div>
          <div class="card-col card-dst">
            <div class="col-title">【目标转码配置】</div>
            <div class="card-item"><span>目标规格：</span><b>{{ selectedTaskPreview.task.targetSummary?.width || selectedTaskPreview.task.width || '保持源' }}x{{ selectedTaskPreview.task.targetSummary?.height || selectedTaskPreview.task.height || '' }} · {{ selectedTaskPreview.task.targetSummary?.fps || selectedTaskPreview.task.fps || '原帧率' }}fps</b></div>
            <div class="card-item"><span>目标编码：</span><b>{{ selectedTaskPreview.task.targetSummary?.videoEncoder || '自动编码' }} · {{ selectedTaskPreview.task.targetSummary?.audioCodec || 'aac' }}</b></div>
            <div class="card-item"><span>质量策略：</span><b>{{ selectedTaskPreview.task.targetSummary?.quality ? 'CRF ' + selectedTaskPreview.task.targetSummary.quality : selectedTaskPreview.task.targetSummary?.bitrate ? Math.round(selectedTaskPreview.task.targetSummary.bitrate / 1000) + 'k' : '自适应' }}</b></div>
            <div class="card-item truncate" :title="selectedTaskPreview.task.fileDst || '同源文件目录'"><span>输出路径：</span>{{ selectedTaskPreview.task.fileDst || (configStore.outputBesideSource ? '自动保存在源文件同级' : configStore.outputDir || '源文件同级') }}</div>
          </div>
        </div>
      </div>

      <!-- 常驻输出路径条 (对标 Shana/HandBrake) -->
      <div class="output-dest-bar" data-testid="output-dest-bar">
        <label class="dest-ck-label" title="转码产物与源文件保存在相同文件夹">
          <input
            type="checkbox"
            class="dest-ck"
            data-testid="ck-dest-beside"
            :checked="configStore.outputBesideSource"
            @change="configStore.setOutputBesideSource(($event.target as HTMLInputElement).checked)"
          />
          <span>保存在源文件夹同级</span>
        </label>
        <div v-if="!configStore.outputBesideSource" class="custom-dest-box">
          <input
            type="text"
            class="dest-input"
            data-testid="input-dest-dir"
            placeholder="自定义输出目录路径…"
            :value="configStore.outputDir"
            @input="configStore.setCustomOutputDir(($event.target as HTMLInputElement).value)"
          />
          <button class="btn btn-sm btn-secondary" data-testid="btn-browse-dest" @click="pickOutputDir">更改…</button>
        </div>
        <span v-if="hasMultipleSourceDirs && configStore.outputBesideSource" class="multi-dir-hint">
          （产物将分别保存在各自源文件目录下）
        </span>
      </div>
    </div>

    <!-- 自定义右键常用菜单 -->
    <div
      v-if="contextMenu.visible && contextMenu.task"
      class="ctx-menu"
      :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
      data-testid="task-context-menu"
      @click.stop
    >
      <div class="ctx-item" data-testid="ctx-play-src" @click="contextMenu.task && playSource(contextMenu.task)">
        <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="6 4 18 12 6 20 6 4" />
        </svg>
        <span>播放源文件</span>
      </div>
      <div
        v-if="contextMenu.task.status === 'success'"
        class="ctx-item"
        data-testid="ctx-play-dst"
        @click="playOutput(contextMenu.task)"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
          <polygon points="10 8 16 12 10 16 10 8" />
        </svg>
        <span>播放转码产物</span>
      </div>
      <div class="ctx-item" data-testid="ctx-inspect" @click="inspectFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="16" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
        <span>查看媒体信息 (ffprobe)</span>
        <span class="ctx-hint">双击</span>
      </div>
      <div class="ctx-item" data-testid="ctx-show-folder" @click="openInFolderFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        <span>在文件管理器中定位</span>
      </div>
      <div class="ctx-item" data-testid="ctx-copy-path" @click="copyPathFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <span>复制文件全路径</span>
      </div>
      <div class="ctx-item" data-testid="ctx-copy-cmd" @click="copyCmdFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
        <span>复制推演 FFmpeg 命令</span>
      </div>

      <div class="ctx-divider"></div>

      <div class="ctx-item" data-testid="ctx-toggle-check" @click="toggleTaskFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
        <span>{{ isSelected(contextMenu.task.id) ? '取消勾选此项' : '勾选此项' }}</span>
      </div>
      <div class="ctx-item" data-testid="ctx-select-all" @click="selectAllFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 11 12 14 22 4" />
          <polyline points="5 7 8 10 14 4" />
        </svg>
        <span>全选所有任务</span>
      </div>
      <div class="ctx-item" data-testid="ctx-invert-select" @click="invertSelectionFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
        </svg>
        <span>反向选择勾选</span>
      </div>
      <div class="ctx-item" data-testid="ctx-clear-select" @click="clearSelectionFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        </svg>
        <span>取消全部勾选</span>
      </div>

      <div class="ctx-divider"></div>

      <div class="ctx-item ctx-danger" data-testid="ctx-remove-task" @click="removeTaskFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
        <span>从列表中移除此任务</span>
      </div>
      <div
        v-if="planStore.selectedIds.size > 0"
        class="ctx-item ctx-danger"
        data-testid="ctx-remove-selected"
        @click="removeSelectedFromMenu"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <span>移除所有勾选项 ({{ planStore.selectedIds.size }})</span>
      </div>
      <div class="ctx-item ctx-danger" data-testid="ctx-clear-all" @click="clearAllTasksFromMenu">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18m-2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        </svg>
        <span>清空任务列表</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.table-body-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: auto;
  position: relative;
}

table.tasks {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

table.tasks th {
  position: sticky;
  top: 0;
  background: var(--bg-table-head);
  backdrop-filter: blur(8px);
  z-index: 5;
  text-align: left;
  font-size: 11px;
  font-weight: 500;
  color: var(--text-3);
  padding: 8px 10px;
  border-bottom: 1px solid var(--divider);
  white-space: nowrap;
}

table.tasks td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--divider);
  vertical-align: middle;
  font-size: 12px;
}

tbody tr {
  cursor: pointer;
  transition: background-color 0.12s;
}

tbody tr:hover {
  background: var(--bg-hover);
}

tbody tr.sel {
  background: var(--primary-soft);
}

tbody tr.dim {
  opacity: 0.55;
}

.t-num {
  color: var(--text-3);
  font-size: 11px;
}

.t-main {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-base);
  font-weight: 500;
}

.t-sub {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 2px;
  font-family: var(--mono);
}

.t-meta {
  color: var(--text-2);
  font-family: var(--mono);
  font-size: 11px;
  white-space: nowrap;
}

.codec-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-2);
}

.c-src {
  color: var(--info);
}

.c-arrow {
  color: var(--text-3);
}

.c-dst {
  color: var(--primary-text);
  font-weight: 600;
}

.status-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.row-bar {
  height: 3px;
  border-radius: 2px;
  background: var(--bg-active);
  overflow: hidden;
  width: 80px;
}

.row-bar i {
  display: block;
  height: 100%;
  background: var(--primary);
  transition: width 0.2s;
}

.ck {
  width: 16px;
  height: 16px;
  border: 1px solid var(--border-strong);
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: transparent;
  flex: none;
  vertical-align: middle;
  transition: background 0.12s, border-color 0.12s;
}

.ck::after {
  content: '✓';
  font-size: 11px;
  font-weight: 700;
  opacity: 0;
  transition: opacity 0.1s;
}

.ck.on::after {
  opacity: 1;
}

.ck.on {
  background: var(--primary);
  border-color: var(--primary);
  color: #101014;
}

[data-theme="light"] .ck.on {
  color: #fff;
}

.tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 3px;
  font-size: 11px;
  background: var(--bg-active);
  color: var(--text-2);
  white-space: nowrap;
}

.tag.info {
  background: var(--info-soft);
  color: var(--info);
}

.tag.ok {
  background: var(--primary-soft);
  color: var(--primary-text);
}

.tag.err {
  background: var(--error-soft);
  color: var(--error);
}

.tag.warn {
  background: var(--warning-soft);
  color: var(--warning);
}

.tag.staged {
  background: var(--warning-soft);
  color: var(--warning);
  font-weight: 500;
}

.t-staged {
  color: var(--text-3);
  font-style: italic;
  font-size: 11px;
}

/* 格式彩标 (对标 ShanaEncoder) */
.fmt-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
  margin-right: 6px;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.fmt-mp4 {
  background: rgba(59, 130, 246, 0.15);
  color: #3b82f6;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.fmt-mkv {
  background: rgba(168, 85, 247, 0.15);
  color: #a855f7;
  border: 1px solid rgba(168, 85, 247, 0.3);
}

.fmt-webm {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.fmt-mov {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.fmt-avi {
  background: rgba(236, 72, 153, 0.15);
  color: #ec4899;
  border: 1px solid rgba(236, 72, 153, 0.3);
}

.fmt-ts {
  background: rgba(99, 102, 241, 0.15);
  color: #6366f1;
  border: 1px solid rgba(99, 102, 241, 0.3);
}

.fmt-other {
  background: var(--bg-active);
  color: var(--text-2);
  border: 1px solid var(--border);
}

.tag.dis {
  opacity: 0.5;
}

.t-ops {
  display: flex;
  gap: 4px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

.icon-btn.err-icon {
  color: var(--error);
}

.icon-btn.err-icon:hover {
  background: var(--error-soft);
}

.icon-btn.del-btn:hover {
  background: var(--error-soft);
  color: var(--error);
}

.icon-btn.ok-icon {
  color: var(--success, #10b981);
}

.icon-btn.ok-icon:hover {
  background: rgba(16, 185, 129, 0.12);
}

/* 底部操作与预览底板 (对标 ShanaEncoder) */
.table-bottom-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--divider);
  background: var(--bg-card);
  font-size: 12px;
  flex-shrink: 0;
}

.bottom-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
}

.btn-detail-toggle {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 11px;
  color: var(--primary);
  padding: 2px 8px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.12s;
}

.btn-detail-toggle:hover {
  background: var(--primary-soft);
}

.shana-compare-card {
  background: var(--bg-hover);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px dashed var(--divider);
  padding-bottom: 4px;
}

.card-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-2);
}

.card-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.card-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}

.col-title {
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 2px;
}

.card-item {
  display: flex;
  gap: 6px;
  color: var(--text-2);
}

.card-item span {
  color: var(--text-3);
  flex-shrink: 0;
}

.card-item b {
  color: var(--text-base);
  font-family: var(--mono);
}

.card-item.truncate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--mono);
  font-size: 10px;
}

.output-dest-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  padding-top: 4px;
  border-top: 1px solid var(--border);
}

.dest-ck-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-base);
  cursor: pointer;
  user-select: none;
  font-weight: 500;
}

.dest-ck {
  accent-color: var(--primary);
  cursor: pointer;
}

.custom-dest-box {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  max-width: 460px;
}

.dest-input {
  flex: 1;
  height: 24px;
  font-size: 11px;
  font-family: var(--mono);
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-base);
}

.multi-dir-hint {
  font-size: 11px;
  color: var(--text-3);
}

.tb-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.tb-summary {
  color: var(--text-3);
  font-size: 11px;
}

.tb-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
  padding: 4px 10px;
  background: var(--bg-hover);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}

.pv-col {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  flex: 1;
}

.pv-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-3);
  flex-shrink: 0;
}

.pv-val {
  font-size: 11px;
  color: var(--text-base);
  overflow: hidden;
  text-overflow: ellipsis;
}

.pv-sep {
  color: var(--primary);
  font-weight: 700;
  flex-shrink: 0;
  font-size: 12px;
}

svg.i {
  width: 14px;
  height: 14px;
  flex: none;
}

svg.i.sm {
  width: 13px;
  height: 13px;
}

.ck-cell {
  user-select: none;
  text-align: center;
}

tbody tr.active {
  outline: 1px solid var(--primary);
  outline-offset: -1px;
}

tbody tr.checked {
  background: var(--primary-soft);
}

/* 按钮样式补全（防外部穿透缺失） */
.btn {
  height: 28px;
  padding: 0 10px;
  font-size: 12px;
  font-family: var(--font);
  font-weight: 500;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-base);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  user-select: none;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  white-space: nowrap;
}

.btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn:active:not(:disabled) {
  background: var(--bg-active);
}

.btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
}

.btn-sm {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
}

.btn-secondary {
  border-color: var(--border);
  background: var(--bg-input);
  color: var(--text-base);
}

.btn-secondary:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

/* ============ 自定义右键上下文菜单 ============ */
.ctx-menu {
  position: fixed;
  z-index: 2000;
  min-width: 200px;
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.2);
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  animation: ctxFadeIn 0.1s ease-out;
  user-select: none;
}

@keyframes ctxFadeIn {
  from { opacity: 0; transform: scale(0.97); }
  to { opacity: 1; transform: scale(1); }
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-base);
  border-radius: 3px;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
}

.ctx-item:hover {
  background: var(--bg-hover);
  color: var(--primary-text);
}

.ctx-item.ctx-danger {
  color: var(--text-2);
}

.ctx-item.ctx-danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

.ctx-divider {
  height: 1px;
  background: var(--divider);
  margin: 3px 2px;
}

.ctx-hint {
  margin-left: auto;
  font-size: 10px;
  color: var(--text-3);
  font-family: var(--mono);
}
</style>
