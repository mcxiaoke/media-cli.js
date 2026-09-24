<script setup lang="ts">
import { computed } from "vue"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"
import { formatSize, formatDuration } from "../utils/format"
import type { PlanTask, TaskStatus } from "../../../shared/contracts"

const planStore = usePlanStore()
const logStore = useLogStore()

const STATUS_MAP: Record<TaskStatus, { text: string; cls: string }> = {
  pending: { text: "待处理", cls: "" },
  preparing: { text: "准备中", cls: "info" },
  running: { text: "转码中", cls: "info" },
  retrying: { text: "重试中", cls: "warn" },
  success: { text: "已完成", cls: "ok" },
  done: { text: "已完成", cls: "ok" },
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

function openInFolder(task: PlanTask, event: MouseEvent) {
  event.stopPropagation()
  const target = task.fileDst || task.path
  if (target && window.api?.showInFolder) {
    void window.api.showInFolder(target)
  }
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
          @dblclick="handleRowDblClick(task)"
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
            <div class="t-main" :title="task.name">{{ task.name }}</div>
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
            <div class="t-main" :title="task.fileDst">{{ getBaseName(task.fileDst) }}</div>
            <div class="t-sub" :title="task.fileDst">{{ getDirName(task.fileDst) }}</div>
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
                <i :style="{ width: `${planStore.overallPercent}%` }"></i>
              </div>
            </div>
          </td>
          <td>
            <div class="t-ops">
              <button
                class="icon-btn"
                title="检查任务详情与命令行"
                data-testid="btn-inspect-task"
                @click="inspectTask(task, $event)"
              >
                <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
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
                class="icon-btn"
                title="查看该任务日志"
                data-testid="btn-task-log"
                @click="focusTaskLog(task, $event)"
              >
                <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              </button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
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
