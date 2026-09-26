<script setup lang="ts">
import { nextTick, watch } from "vue"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"
import type { PlanTask } from "../../../shared/contracts"

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  task: PlanTask | null
  isBusy: boolean
}>()

const emit = defineEmits<{
  (e: "close"): void
  (e: "playSource", task: PlanTask): void
  (e: "playOutput", task: PlanTask): void
  (e: "inspect", task: PlanTask): void
  (e: "openInFolder", task: PlanTask): void
  (e: "removeTask", task: PlanTask): void
  (e: "removeSelected"): void
  (e: "clearAll"): void
}>()

const planStore = usePlanStore()
const logStore = useLogStore()

watch(
  () => props.visible,
  (val) => {
    if (val) {
      void nextTick(() => {
        const first = document.querySelector<HTMLElement>(".ctx-menu .ctx-item")
        first?.focus()
      })
    }
  }
)

function isSelected(id: string) {
  return planStore.selectedIds.has(id)
}

function handleMenuKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" && e.key !== " ") return
  const target = e.target as HTMLElement | null
  if (!target?.classList?.contains("ctx-item")) return
  e.preventDefault()
  target.click()
}

function onPlaySource() {
  if (props.task) emit("playSource", props.task)
  emit("close")
}

function onPlayOutput() {
  if (props.task) emit("playOutput", props.task)
  emit("close")
}

function onInspect() {
  if (props.task) emit("inspect", props.task)
  emit("close")
}

function onOpenInFolder() {
  if (props.task) emit("openInFolder", props.task)
  emit("close")
}

async function onCopyPath() {
  const p = props.task?.path
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
  emit("close")
}

async function onCopyCmd() {
  const t = props.task
  if (t) {
    const cmd = planStore.previewCmdFor(t)
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
  emit("close")
}

function onToggleTask() {
  if (props.task) {
    planStore.toggleTask(props.task.id)
  }
  emit("close")
}

function onSelectAll() {
  planStore.selectAll()
  emit("close")
}

function onInvertSelection() {
  planStore.invertSelection()
  emit("close")
}

function onClearSelection() {
  planStore.clearSelection()
  emit("close")
}

function onRemoveTask() {
  if (props.task) emit("removeTask", props.task)
  emit("close")
}

function onRemoveSelected() {
  emit("removeSelected")
  emit("close")
}

function onClearAll() {
  emit("clearAll")
  emit("close")
}
</script>

<template>
  <div
    v-if="visible && task"
    class="ctx-menu"
    :style="{ top: `${y}px`, left: `${x}px` }"
    data-testid="task-context-menu"
    role="menu"
    @click.stop
    @keydown="handleMenuKeydown"
  >
    <div
      class="ctx-item"
      role="menuitem"
      tabindex="0"
      data-testid="ctx-play-src"
      @click="onPlaySource"
    >
      <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="6 4 18 12 6 20 6 4" />
      </svg>
      <span>播放源文件</span>
    </div>
    <div
      v-if="task.status === 'success'"
      class="ctx-item"
      role="menuitem"
      tabindex="0"
      data-testid="ctx-play-dst"
      @click="onPlayOutput"
    >
      <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
        <polygon points="10 8 16 12 10 16 10 8" />
      </svg>
      <span>播放转码产物</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-inspect" @click="onInspect">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
      <span>查看媒体信息 (ffprobe)</span>
      <span class="ctx-hint">双击</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-show-folder" @click="onOpenInFolder">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
      <span>在文件管理器中定位</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-copy-path" @click="onCopyPath">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
      </svg>
      <span>复制文件全路径</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-copy-cmd" @click="onCopyCmd">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
      <span>复制推演 FFmpeg 命令</span>
    </div>

    <div class="ctx-divider"></div>

    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-toggle-check" @click="onToggleTask">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 11 12 14 22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
      <span>{{ isSelected(task.id) ? '取消勾选此项' : '勾选此项' }}</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-select-all" @click="onSelectAll">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 11 12 14 22 4" />
        <polyline points="5 7 8 10 14 4" />
      </svg>
      <span>全选所有任务</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-invert-select" @click="onInvertSelection">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
      </svg>
      <span>反向选择</span>
    </div>
    <div class="ctx-item" role="menuitem" tabindex="0" data-testid="ctx-clear-select" @click="onClearSelection">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      </svg>
      <span>清空所有勾选</span>
    </div>

    <div class="ctx-divider"></div>

    <div class="ctx-item danger" role="menuitem" tabindex="0" data-testid="ctx-remove-task" @click="onRemoveTask">
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
      <span>从列表移除此项</span>
    </div>
    <div
      class="ctx-item danger"
      :class="{ disabled: planStore.selectedIds.size === 0 || isBusy }"
      role="menuitem"
      tabindex="0"
      data-testid="ctx-remove-selected"
      @click="onRemoveSelected"
    >
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      </svg>
      <span>移除所有已勾选项 ({{ planStore.selectedIds.size }})</span>
    </div>
    <div
      class="ctx-item danger"
      :class="{ disabled: isBusy }"
      role="menuitem"
      tabindex="0"
      data-testid="ctx-clear-all"
      @click="onClearAll"
    >
      <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      <span>清空全部任务列表</span>
    </div>
  </div>
</template>

<style scoped>
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

.ctx-item:focus-visible {
  outline: 1px solid var(--primary);
  outline-offset: -1px;
  background: var(--bg-hover);
  color: var(--primary-text);
}

.ctx-item.danger {
  color: var(--text-2);
}

.ctx-item.danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

.ctx-item.disabled {
  opacity: 0.38;
  cursor: not-allowed;
  pointer-events: none;
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

.i.sm {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
</style>
