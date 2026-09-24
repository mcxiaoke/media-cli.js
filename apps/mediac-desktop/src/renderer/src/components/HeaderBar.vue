<script setup lang="ts">
import { computed } from "vue"
import { useEnvStore } from "../stores/env"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"

defineEmits<{
  (e: "toggle-sidebar"): void
  (e: "open-settings"): void
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
  if (!g) return "CPU Mode"
  const tier = env.summary?.hardware.tier?.toUpperCase() || ""
  return tier ? tier + " · " + g.model : g.model
})

function toggleTheme() {
  const cur = document.documentElement.getAttribute("data-theme") || "dark"
  const next = cur === "dark" ? "light" : "dark"
  document.documentElement.setAttribute("data-theme", next)
  localStorage.setItem("mediac_theme", next)
}
</script>

<template>
  <header class="header-bar" data-testid="header-bar">
    <div class="brand">
      <svg class="logo-icon" viewBox="0 0 24 24" width="20" height="20">
        <rect x="1" y="3" width="22" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.6" />
        <path d="M9.5 8.5v7l6-3.5z" fill="currentColor" />
      </svg>
      <span class="logo">mediac FFmpeg Studio</span>
      <span class="version">v{{ env.version }}</span>
      <span class="sub">批量音视频转码工作台</span>
    </div>

    <div class="status-zone">
      <div v-if="env.summary?.ffmpegPath" class="pill env-pill" data-testid="hw-tag" title="FFmpeg 二进制路径">
        <span class="dot ok"></span>
        <span>ffmpeg</span>
      </div>

      <div class="pill gpu-pill" :title="'硬件分层: ' + (env.summary?.hardware.tier || 'cpu')">
        <span class="gpu-name">{{ gpuText }}</span>
      </div>

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
        title="打开运行日志"
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
        class="icon-btn"
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
        title="设置"
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
  height: 48px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.logo {
  font-weight: 700;
  font-size: 14px;
  color: var(--text-base);
  letter-spacing: 0.2px;
}

.version {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--text-3);
  background: var(--bg-input);
  padding: 1px 6px;
  border-radius: 4px;
}

.sub {
  font-size: 12px;
  color: var(--text-3);
  margin-left: 4px;
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
