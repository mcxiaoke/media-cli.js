<script setup lang="ts">
import { computed } from "vue"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"
import { formatSize, formatDuration } from "../utils/format"
import type { PlanTask, TaskStatus } from "../../../shared/contracts"

const planStore = usePlanStore()
const logStore = useLogStore()

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

function handleRowDblClick(task: PlanTask) {
  planStore.inspectedTask = task
}

function removeTask(task: PlanTask, event: MouseEvent) {
  event.stopPropagation()
  planStore.removeTask(task.id)
  logStore.append({
    level: "INFO",
    message: `已从任务列表中移除: ${task.name}`,
    timestamp: new Date().toLocaleTimeString(),
  })
}

function openInFolder(task: PlanTask, event: MouseEvent) {
  event.stopPropagation()
  // Before transcoding finishes, locate the existing source file;
  // Once finished, locate the generated destination file.
  const isDone = task.status === "success"
  const target = isDone ? (task.fileDst || task.path) : task.path
  if (target && window.api?.showInFolder) {
    void window.api.showInFolder(target)
  }
}

function handleRowClick(task: PlanTask, event: MouseEvent) {
  if ((event.target as HTMLElement).closest(".ck, .icon-btn, .t-ops")) return
  if (event.ctrlKey || event.metaKey) {
    planStore.toggleTask(task.id)
  } else {
    const s = new Set<string>()
    s.add(task.id)
    planStore.selectedIds = s
  }
}

function handleContextMenu(task: PlanTask, _event: MouseEvent) {
  const s = new Set<string>()
  s.add(task.id)
  planStore.selectedIds = s
}

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
  // CSS 只有 .fmt-other 兜底样式，此前返回不存在的 fmt-default 导致默认标签无样式
  return "fmt-other"
}

const selectedTaskPreview = computed(() => {
  const t = planStore.inspectedTask || planStore.tasks.find((task) => planStore.selectedIds.has(task.id)) || planStore.tasks[0]
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

  const dst = t.fileDst
    ? `${getBaseName(t.fileDst)} · [${planStore.planSnapshot?.presetName || '预设'}]`
    : `[待推演] 遵循当前预设及参数微调`

  return { name: t.name, srcText: src, dstText: dst }
})
</script>

<template>
  <div class="table-wrap">
    <table class="tasks" data-testid="tasks-table">
      <colgroup>
        <col style="width: 36px" />
        <col style="width: 38px" />
        <col style="width: 26%" />
        <col style="width: 84px" />
        <col style="width: 80px" />
        <col style="width: 130px" />
        <col style="width: 26%" />
        <col style="width: 120px" />
        <col style="width: 104px" />
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
              @click="planStore.toggleAll"
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
            sel: isSelected(task.id),
            dim: task.status === 'skipped'
          }"
          data-testid="task-row"
          :data-task-id="task.id"
          @click="handleRowClick(task, $event)"
          @dblclick="handleRowDblClick(task)"
          @contextmenu.prevent="handleContextMenu(task, $event)"
        >
          <td @click.stop>
            <span
              class="ck"
              :class="{ on: isSelected(task.id) }"
              data-testid="task-checkbox"
              role="checkbox"
              :aria-checked="isSelected(task.id)"
              tabindex="0"
              @click="planStore.toggleTask(task.id)"
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

    <!-- 列表底部操作与快速对比底板（对标 ShanaEncoder） -->
    <div class="table-bottom-bar" data-testid="table-bottom-bar">
      <div class="tb-actions">
        <button class="btn btn-sm btn-secondary" @click="planStore.toggleAll">
          {{ planStore.isAllSelected ? '取消全选' : '全选' }}
        </button>
        <button
          class="btn btn-sm btn-secondary"
          :disabled="planStore.selectedIds.size === 0"
          @click="planStore.removeSelectedTasks()"
        >
          移除所选 ({{ planStore.selectedIds.size }})
        </button>
      </div>

      <!-- 选中任务快速源 vs 目标对比面板 -->
      <div v-if="selectedTaskPreview" class="tb-preview" data-testid="task-quick-preview">
        <div class="pv-col pv-src" :title="selectedTaskPreview.name">
          <span class="pv-label">源媒体:</span>
          <span class="pv-val">{{ selectedTaskPreview.srcText }}</span>
        </div>
        <div class="pv-sep">→</div>
        <div class="pv-col pv-dst">
          <span class="pv-label">推演目标:</span>
          <span class="pv-val">{{ selectedTaskPreview.dstText }}</span>
        </div>
      </div>
      <div v-else class="tb-summary">
        共 {{ planStore.tasks.length }} 个视频文件 · 总计 {{ formatSize(planStore.totalSize) }} · 时长 {{ formatDuration(planStore.totalDuration) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
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

/* 底部操作与预览底板 (对标 ShanaEncoder) */
.table-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-top: 1px solid var(--divider);
  background: var(--bg-card);
  font-size: 12px;
  flex-shrink: 0;
  min-height: 40px;
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
</style>
