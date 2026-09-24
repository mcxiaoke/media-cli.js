<script setup lang="ts">
import { computed } from "vue"
import { useEnvStore } from "../stores/env"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"

defineProps<{
  statsText?: string
}>()

const emit = defineEmits<{
  (e: "toggle-sidebar"): void
  (e: "open-settings"): void
  (e: "create-plan"): void
  (e: "start-execution"): void
  (e: "stop-execution"): void
  (e: "clear-all"): void
}>()

const env = useEnvStore()
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
  return STATE_CONFIG[plan.status] || { label: plan.status, cls: "" }
})

const gpuText = computed(() => {
  const g = env.summary?.hardware.gpus[0]
  const tier = env.summary?.hardware.tier?.toUpperCase() || ""
  if (!g) return tier && tier !== "CPU" ? tier : "CPU Mode"
  return tier ? tier + " · " + g.model : g.model
})

const cpuText = computed(() => {
  const sys = env.summary?.system
  if (!sys?.cpuCores) return ""
  return `${sys.cpuCores} 核`
})

const memText = computed(() => {
  const sys = env.summary?.system
  if (!sys?.totalMemGb) return ""
  const used = Math.max(0, sys.totalMemGb - sys.freeMemGb)
  return `${used}G / ${sys.totalMemGb}G`
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
    <!-- 左侧区：侧边栏切换 + 硬件状态监控胶囊 -->
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

      <div class="pill hw-pill" :title="'GPU 编码加速器: ' + gpuText">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="6" width="20" height="12" rx="2" />
          <path d="M6 12h4m-2-2v4m7-2h.01m3 0h.01" />
        </svg>
        <span class="hw-name">{{ gpuText }}</span>
      </div>

      <div v-if="cpuText" class="pill hw-pill" :title="'CPU: ' + (env.summary?.system?.cpuModel || 'CPU')">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <line x1="9" y1="1" x2="9" y2="4" />
          <line x1="15" y1="1" x2="15" y2="4" />
          <line x1="9" y1="20" x2="9" y2="23" />
          <line x1="15" y1="20" x2="15" y2="23" />
        </svg>
        <span class="hw-name">{{ cpuText }}</span>
      </div>

      <div v-if="memText" class="pill hw-pill" title="系统内存使用概况">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 19v-3m4 3v-6m4 3v-4m4 4v-8" />
          <rect x="2" y="3" width="20" height="18" rx="2" />
        </svg>
        <span class="hw-name">{{ memText }}</span>
      </div>
    </div>

    <!-- 常用操作区 -->
    <div class="actions-zone">
      <button
        class="btn"
        :class="{
          'btn-primary pulse': plan.status === 'STALE',
          'btn-secondary': plan.status !== 'STALE'
        }"
        :disabled="plan.status === 'RUNNING' || plan.status === 'PLANNING'"
        data-testid="btn-plan"
        @click="emit('create-plan')"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
        <span>{{ plan.status === "PLANNING" ? "分析中…" : (plan.status === "STALE" ? "更新计划" : "生成计划") }}</span>
      </button>

      <button
        class="btn btn-primary"
        :disabled="plan.status === 'RUNNING' || plan.tasks.length === 0 || plan.status === 'STALE' || plan.status === 'PLANNING'"
        data-testid="btn-start"
        @click="emit('start-execution')"
      >
        <svg class="i sm" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5.5v13l11-6.5z" />
        </svg>
        <span>开始转码</span>
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

      <!-- 参数变更 STALE 告警 -->
      <div v-if="plan.status === 'STALE'" class="stale-alert" data-testid="stale-alert">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span>参数已变更，请点击「更新计划」</span>
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

.hw-pill {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-2);
  gap: 5px;
}

.hw-name {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.dot.ok {
  background: var(--primary);
}

.gpu-pill {
  font-family: var(--mono);
  font-size: 11px;
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
