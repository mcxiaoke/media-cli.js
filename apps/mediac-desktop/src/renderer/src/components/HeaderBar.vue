<script setup lang="ts">
import { computed } from "vue"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"

const props = defineProps<{
  statsText?: string
  isIngesting?: boolean
}>()

const emit = defineEmits<{
  (e: "toggle-sidebar"): void
  (e: "open-settings"): void
  (e: "create-plan"): void
  (e: "start-execution"): void
  (e: "stop-execution"): void
  (e: "clear-all"): void
}>()

const plan = usePlanStore()
const logStore = useLogStore()

const STATE_CONFIG: Record<string, { label: string; cls: string }> = {
  IDLE: { label: "待机", cls: "" },
  PLANNING: { label: "分析中", cls: "info" },
  READY: { label: "待执行", cls: "" },
  RUNNING: { label: "转码中", cls: "info" },
  STOPPING: { label: "正在停止", cls: "warn" },
  STOPPED: { label: "已停止", cls: "" },
  COMPLETED: { label: "已完成", cls: "ok" },
  FAILED: { label: "异常", cls: "err" },
  STALE: { label: "参数已修改", cls: "warn" },
}

const stateInfo = computed(() => {
  // 忙碌态优先：此前 hasStaged 会无条件把 RUNNING/STOPPING 也显示成「待规划」，
  // 用户在转码进行中看到「待规划」会误以为任务没在跑。
  if (plan.status === "RUNNING" || plan.status === "PLANNING" || plan.status === "STOPPING") {
    return STATE_CONFIG[plan.status] || { label: plan.status, cls: "" }
  }
  if (plan.hasStaged) {
    return { label: "待规划", cls: "warn" }
  }
  return STATE_CONFIG[plan.status] || { label: plan.status, cls: "" }
})

const selectedExecutableTasks = computed(() => {
  return plan.tasks.filter(
    (t) => plan.selectedIds.has(t.id) && t.status !== "success" && t.status !== "skipped"
  )
})

const failedTasks = computed(() => {
  return plan.tasks.filter((t) => plan.selectedIds.has(t.id) && t.status === "failed")
})

const canStart = computed(() => {
  if (plan.status === "RUNNING" || plan.status === "STOPPING" || plan.status === "PLANNING") return false
  if (plan.tasks.length === 0) return false
  if (props.isIngesting) return false
  return selectedExecutableTasks.value.length > 0
})

const startButtonText = computed(() => {
  if (plan.status === "PLANNING") return "正在准备…"
  if (props.isIngesting) return "读取媒体中…"
  if (plan.status === "RUNNING") return "正在转码…"
  if (plan.status === "STOPPING") return "正在停止…"

  if (plan.tasks.length > 0 && selectedExecutableTasks.value.length === 0) {
    if (failedTasks.value.length > 0) {
      return `重试失败项 (${failedTasks.value.length})`
    }
    return "已全部完成"
  }

  const count = selectedExecutableTasks.value.length
  return count > 0 ? `开始转码 · ${count}` : "开始转码"
})

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "light"
  const next = cur === "dark" ? "light" : "dark"
  document.documentElement.setAttribute("data-theme", next)
  localStorage.setItem("mediac_theme", next)
}
</script>

<template>
  <header class="header-bar" data-testid="header-bar">
    <!--
      左侧区：仅侧边栏切换。
      原 GPU/加速器胶囊已移除：它依赖异步的 env 探测结果，首帧渲染为空、
      探测返回后才有内容，导致整条顶栏（含右侧操作区）在启动时发生横向跳动。
      硬件与加速信息统一在状态栏（底部）与「关于」面板展示，那里不参与首屏布局。
    -->
    <div class="hw-zone">
      <button
        class="icon-btn sidebar-btn"
        data-testid="btn-sidebar-toggle"
        title="收起/展开左侧配置栏 (Ctrl+B)"
        @click="$emit('toggle-sidebar')"
      >
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16" />
          <path d="M5 8h1.5" />
          <path d="M5 12h1.5" />
          <path d="M5 16h1.5" />
        </svg>
      </button>
    </div>

    <!-- 常用操作区 -->
    <div class="actions-zone">
      <button
        class="btn"
        :class="{
          'btn-primary pulse': plan.status === 'STALE' || plan.hasStaged,
          'btn-secondary': plan.status !== 'STALE' && !plan.hasStaged
        }"
        :disabled="plan.status === 'RUNNING' || plan.status === 'PLANNING'"
        data-testid="btn-plan"
        @click="emit('create-plan')"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span>{{ plan.status === "PLANNING" ? "分析中…" : (plan.hasStaged ? "生成计划" : (plan.status === "STALE" ? "更新计划" : "生成计划")) }}</span>
      </button>

      <button
        class="btn btn-primary"
        :disabled="!canStart"
        data-testid="btn-start"
        @click="emit('start-execution')"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        <span>{{ startButtonText }}</span>
      </button>

      <button
        class="btn btn-danger"
        :disabled="plan.status !== 'RUNNING' && plan.status !== 'STOPPING'"
        data-testid="btn-stop"
        @click="emit('stop-execution')"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="1.5" />
        </svg>
        <span>终止</span>
      </button>

      <button
        class="btn btn-ghost"
        :disabled="plan.status === 'RUNNING' || plan.tasks.length === 0"
        data-testid="btn-clear"
        @click="emit('clear-all')"
      >
        清空
      </button>

      <!-- 待推演或参数变更微调提示 (非阻断) -->
      <div v-if="plan.hasStaged" class="stale-alert" data-testid="stale-alert">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>新媒体待转码 · 点击开始将自动推演</span>
      </div>
      <div v-else-if="plan.status === 'STALE'" class="stale-alert" data-testid="stale-alert">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>参数已变更 · 可直接开始转码</span>
      </div>
    </div>

    <!-- 状态与控制区 -->
    <div class="status-zone">
      <span v-if="statsText" class="stats-text" data-testid="tb-stats">{{ statsText }}</span>

      <div
        class="pill state-pill"
        :class="stateInfo.cls"
        data-testid="state-tag"
      >
        <span v-if="plan.status === 'RUNNING'" class="spinner"></span>
        <span class="label">{{ stateInfo.label }}</span>
      </div>

      <button
        class="icon-btn log-btn"
        data-testid="btn-open-log"
        title="打开运行日志 (Ctrl+L)"
        @click="logStore.drawerOpen = !logStore.drawerOpen"
      >
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
        <span v-if="logStore.errCount > 0" class="badge err-badge">
          {{ logStore.errCount > 99 ? '99+' : logStore.errCount }}
        </span>
      </button>

      <button
        class="icon-btn theme-btn"
        data-testid="btn-theme-toggle"
        title="切换主题（暗黑 / 明亮）"
        @click="toggleTheme"
      >
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </button>

      <button
        class="icon-btn"
        data-testid="btn-open-settings"
        title="设置 (Ctrl+,)"
        @click="$emit('open-settings')"
      >
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.header-bar {
  height: 46px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
  gap: 12px;
}

.hw-zone {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.sidebar-btn {
  margin-right: 2px;
}

.actions-zone {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.stats-text {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-3);
  margin-right: 4px;
  white-space: nowrap;
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
  color: #fff;
  font-weight: 600;
}

.btn-primary:hover {
  background: var(--primary-hover);
}

.btn-primary:disabled {
  background: var(--primary);
  opacity: 0.38;
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
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 250px;
  overflow: hidden;
  text-overflow: ellipsis;
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
  0% { box-shadow: 0 0 0 0 rgba(31, 136, 61, 0.4); }
  70% { box-shadow: 0 0 0 6px rgba(31, 136, 61, 0); }
  100% { box-shadow: 0 0 0 0 rgba(31, 136, 61, 0); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-2px); }
  to { opacity: 1; transform: translateY(0); }
}

svg.sm {
  width: 13px;
  height: 13px;
}

.status-zone {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border-radius: 12px;
  background: var(--bg-input);
  font-size: 12px;
  color: var(--text-2);
  border: 1px solid var(--border);
}

.pill.info {
  background: var(--info-soft);
  color: var(--info);
  border-color: transparent;
}

.pill.ok {
  background: var(--primary-soft);
  color: var(--primary-text);
  border-color: transparent;
}

.pill.warn {
  background: var(--warning-soft);
  color: var(--warning);
  border-color: transparent;
}

.pill.err {
  background: var(--error-soft);
  color: var(--error);
  border-color: transparent;
}

.state-pill {
  font-weight: 600;
}

.spinner {
  width: 10px;
  height: 10px;
  border: 2px solid var(--primary-soft);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.icon-btn {
  position: relative;
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-2);
  width: 28px;
  height: 28px;
  border-radius: var(--radius);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s ease;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
  border-color: var(--border);
}

.i {
  width: 16px;
  height: 16px;
}

.badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}

.err-badge {
  background: var(--error);
  color: #fff;
}
</style>
