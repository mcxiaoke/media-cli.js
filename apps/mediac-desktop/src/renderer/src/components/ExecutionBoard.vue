<script setup lang="ts">
import { computed } from "vue"
import { usePlanStore } from "../stores/plan"
import { useConfigStore } from "../stores/config"
import { formatSize, formatDuration } from "../utils/format"

const planStore = usePlanStore()
const configStore = useConfigStore()

const isRunning = computed(() => planStore.status === "RUNNING" || planStore.status === "STOPPING")
const isDone = computed(() => planStore.status === "COMPLETED" || planStore.status === "STOPPED")

const currentRunningTask = computed(() => {
  return planStore.tasks.find((t) => t.status === "running") || null
})

const activeFileName = computed(() => {
  if (isRunning.value) {
    return currentRunningTask.value?.name || "正在处理任务…"
  }
  if (planStore.status === "COMPLETED") {
    return "全部任务转码完成"
  }
  if (planStore.status === "STOPPED") {
    return "转码任务已终止"
  }
  if (planStore.tasks.length > 0) {
    return `计划已就绪 · 共 ${planStore.tasks.length} 个任务`
  }
  return "等待添加媒体文件并生成计划"
})

const progressPercent = computed(() => {
  if (isRunning.value) {
    return Math.round(planStore.overallPercent)
  }
  if (planStore.status === "COMPLETED") return 100
  // STOPPED/FAILED 冻结在本轮实际达到的进度，与完成数口径一致（不再归零）
  if (planStore.status === "STOPPED" || planStore.status === "FAILED") {
    return Math.round(planStore.overallPercent)
  }
  return 0
})

const overallStat = computed(() => {
  // 分母用本轮实际执行的任务子集：部分执行时 "2 / 3" 而非误导性的 "2 / 10"
  const executed = planStore.executedTasks.length
  const denom = executed > 0 ? executed : planStore.tasks.length
  if (denom === 0) return "0 / 0"
  const done = planStore.tasks.filter((t) => t.status === "success" || t.status === "done").length
  return `${done} / ${denom}`
})

const speedStat = computed(() => {
  if (!isRunning.value || planStore.currentSpeed <= 0) return "—"
  return `${planStore.currentSpeed.toFixed(1)}x`
})

const etaStat = computed(() => {
  if (!isRunning.value || planStore.currentSpeed <= 0) return "—"
  // 只按本轮实际执行的任务时长折算：部分执行时 ETA 不再被未选中任务拉长
  const totalSec = planStore.executedDuration
  if (totalSec <= 0) return "—"
  const remainingSec = Math.max(0, (totalSec * (1 - planStore.overallPercent / 100)) / planStore.currentSpeed)
  return formatDuration(remainingSec)
})

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
</script>

<template>
  <div
    class="exec-bar"
    :class="{ compact: !isRunning && !isDone }"
    data-testid="execution-board"
  >
    <div class="exec-main">
      <div class="exec-top">
        <span class="fname" :title="activeFileName" data-testid="exec-file">
          {{ activeFileName }}
        </span>
        <span class="exec-pct" data-testid="exec-percent">{{ progressPercent }}%</span>
      </div>
      <div class="bar">
        <div
          class="bar-fill"
          data-testid="exec-bar-fill"
          :style="{ width: `${progressPercent}%` }"
        ></div>
      </div>
    </div>

    <div class="exec-stats">
      <div class="stat">
        <span class="stat-lbl">任务进度</span>
        <span class="stat-val" data-testid="stat-overall">{{ overallStat }}</span>
      </div>
      <div class="stat">
        <span class="stat-lbl">实时速度</span>
        <span class="stat-val" data-testid="stat-speed">{{ speedStat }}</span>
      </div>
      <div class="stat">
        <span class="stat-lbl">剩余时间</span>
        <span class="stat-val" data-testid="stat-eta">{{ etaStat }}</span>
      </div>
    </div>

    <div v-if="isDone" class="exec-actions">
      <button class="btn btn-secondary btn-sm" data-testid="btn-open-output" @click="openOutputDir">
        <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
        打开输出目录
      </button>
    </div>
  </div>
</template>

<style scoped>
.exec-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 10px 14px;
  border-top: 1px solid var(--divider);
  background: var(--bg-card);
  transition: padding 0.15s ease;
}

.exec-bar.compact {
  padding: 6px 14px;
  gap: 14px;
}

.exec-bar.compact .bar {
  height: 4px;
}

.exec-bar.compact .exec-top {
  font-size: 11px;
}

.exec-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.exec-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 12px;
  color: var(--text-2);
  white-space: nowrap;
}

.exec-top .fname {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 80%;
  font-weight: 500;
  color: var(--text-base);
}

.exec-pct {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--primary-text);
  font-size: 13px;
}

.bar {
  height: 6px;
  border-radius: 3px;
  background: var(--bg-active);
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.2s ease;
  border-radius: 3px;
}

.exec-stats {
  display: flex;
  gap: 16px;
  flex: none;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 52px;
}

.stat-lbl {
  font-size: 11px;
  color: var(--text-3);
}

.stat-val {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-base);
  font-family: var(--mono);
}

.exec-actions {
  flex: none;
  display: flex;
  align-items: center;
}

.btn {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
  font-family: var(--font);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-base);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

svg.i.sm {
  width: 13px;
  height: 13px;
}
</style>
