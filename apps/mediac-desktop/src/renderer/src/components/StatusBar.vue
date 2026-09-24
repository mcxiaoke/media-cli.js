<script setup lang="ts">
import { computed } from "vue"
import { useEnvStore } from "../stores/env"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"

const env = useEnvStore()
const plan = usePlanStore()
const logStore = useLogStore()

const ffmpegStatusText = computed(() => {
  if (env.summary?.ffmpegPath) return "ffmpeg: 就绪"
  return "ffmpeg: 未检测到"
})

const ffprobeStatusText = computed(() => {
  if (env.summary?.ffprobePath) return "ffprobe: 就绪"
  return "ffprobe: 未检测到"
})

const hwTierText = computed(() => {
  const tier = env.summary?.hardware.tier || "cpu"
  return `加速: ${tier.toUpperCase()}`
})

const taskSummary = computed(() => {
  if (plan.status === "RUNNING") {
    return `转码中 · 总体进度 ${Math.round(plan.overallPercent)}%`
  }
  if (plan.status === "PLANNING") {
    return "正在分析媒体并规划转码命令行…"
  }
  if (plan.tasks.length === 0) {
    return "就绪 · 待添加任务"
  }
  return `就绪 · ${plan.tasks.length} 个任务待处理`
})

const sysSummary = computed(() => {
  const sys = env.summary?.system
  if (!sys) return ""
  const usedMem = Math.max(0, sys.totalMemGb - sys.freeMemGb)
  return `CPU: ${sys.cpuCores} 核 · 内存: ${usedMem}G / ${sys.totalMemGb}G`
})
</script>

<template>
  <footer class="status-bar" data-testid="status-bar">
    <div class="status-left">
      <div class="status-item" :title="env.summary?.ffmpegPath || '未配置'">
        <span class="status-dot" :class="{ ok: !!env.summary?.ffmpegPath }"></span>
        <span>{{ ffmpegStatusText }}</span>
      </div>
      <div class="status-sep"></div>
      <div class="status-item" :title="env.summary?.ffprobePath || '未配置'">
        <span class="status-dot" :class="{ ok: !!env.summary?.ffprobePath }"></span>
        <span>{{ ffprobeStatusText }}</span>
      </div>
      <div class="status-sep"></div>
      <div class="status-item" :title="'硬件加速分层: ' + (env.summary?.hardware.tier || 'cpu')">
        <span class="status-dot ok"></span>
        <span>{{ hwTierText }}</span>
      </div>
    </div>

    <div class="status-center">
      <span class="task-info">{{ taskSummary }}</span>
    </div>

    <div class="status-right">
      <div v-if="sysSummary" class="status-item sys-item" :title="env.summary?.system?.cpuModel || ''">
        <span>{{ sysSummary }}</span>
      </div>
      <div class="status-sep"></div>
      <button
        class="status-btn"
        data-testid="status-log-btn"
        title="打开运行日志抽屉 (Ctrl+L)"
        @click="logStore.drawerOpen = !logStore.drawerOpen"
      >
        <span class="status-dot" :class="{ err: logStore.errCount > 0, ok: logStore.errCount === 0 }"></span>
        <span>日志 {{ logStore.errCount > 0 ? `(${logStore.errCount} 异常)` : '' }}</span>
      </button>
    </div>
  </footer>
</template>

<style scoped>
.status-bar {
  height: 24px;
  background: var(--bg-card);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 11px;
  font-family: var(--mono);
  color: var(--text-3);
  flex-shrink: 0;
  user-select: none;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-center {
  flex: 1;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 16px;
}

.task-info {
  color: var(--text-2);
}

.status-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-3);
}

.status-dot.ok {
  background: var(--primary);
}

.status-dot.err {
  background: var(--error);
}

.status-sep {
  width: 1px;
  height: 10px;
  background: var(--border);
}

.status-btn {
  background: transparent;
  border: none;
  font-family: inherit;
  font-size: inherit;
  color: var(--text-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  border-radius: 3px;
  transition: background 0.12s;
}

.status-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}
</style>
