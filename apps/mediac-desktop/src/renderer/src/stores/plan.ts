import { defineStore } from "pinia"
import { ref, shallowRef, computed } from "vue"
import type { PublicPlanSnapshot, PlanTask, RunnerState } from "../../../shared/contracts"

// RunnerState 的唯一事实源在 shared/contracts.ts；渲染层不再各自声明同名类型，
// 否则主进程新增状态（如 STALE）时两边会静默漂移。
export type { RunnerState }

export const usePlanStore = defineStore("plan", () => {
  const status = ref<RunnerState>("IDLE")
  const planSnapshot = ref<PublicPlanSnapshot | null>(null)
  // Use shallowRef for tasks array to avoid Proxy overhead on large task lists
  const tasks = shallowRef<PlanTask[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const activeTaskId = ref<string | null>(null)
  const inspectedTask = ref<PlanTask | null>(null)
  const currentSpeed = ref(0)

  // 终态集合：迟到的事件（乱序 task.progress/task.started）不得复活终态任务。
  // public 状态协议统一 success（内部 done 由投影映射），不再双兼容。
  const TERMINAL_STATUSES = new Set(["success", "failed", "skipped", "cancelled"])
  const FINISHED_STATUSES = new Set(["success", "skipped"])
  // 本轮实际参与执行的任务子集：执行可只选部分任务，未选中的保持 pending/staged，
  // 进度/ETA/完成数都应按该子集口径统计，而不是全量计划
  const EXECUTED_STATUSES = new Set(["running", "success", "failed", "skipped", "cancelled"])

  const allTasksCompleted = computed(() => {
    return (
      tasks.value.length > 0 &&
      tasks.value.every((t) => FINISHED_STATUSES.has(t.status))
    )
  })

  const executedTasks = computed(() => tasks.value.filter((t) => EXECUTED_STATUSES.has(t.status)))
  const executedDuration = computed(() =>
    executedTasks.value.reduce((acc, t) => acc + (t.duration || 0), 0)
  )

  /**
   * 本轮执行的总体进度（0-100）。
   * 优先按时长加权（长任务权重更大，避免 10s 短片和 2h 长片各占一格的失真）；
   * 无时长信息（probe 失败）时退化为按任务个数。
   */
  const overallPercent = computed(() => {
    const executed = executedTasks.value
    if (executed.length === 0) return 0
    const totalWeight = executed.reduce((acc, t) => acc + (t.duration || 0), 0)
    const finishedWeight = executed
      .filter((t) => FINISHED_STATUSES.has(t.status))
      .reduce((acc, t) => acc + (t.duration || 0), 0)
    const runningWeight = executed
      .filter((t) => t.status === "running")
      .reduce((acc, t) => acc + (t.duration || 0) * ((t.progress || 0) / 100), 0)
    if (totalWeight > 0) {
      return Math.min(100, Math.round(((finishedWeight + runningWeight) / totalWeight) * 100))
    }
    const finishedCount = executed.filter((t) => FINISHED_STATUSES.has(t.status)).length
    const runningCount = executed
      .filter((t) => t.status === "running")
      .reduce((acc, t) => acc + (t.progress || 0) / 100, 0)
    return Math.min(100, Math.round(((finishedCount + runningCount) / executed.length) * 100))
  })

  const isAllSelected = computed(() => {
    return tasks.value.length > 0 && tasks.value.every((t) => selectedIds.value.has(t.id))
  })

  const totalDuration = computed(() => {
    return tasks.value.reduce((acc, t) => acc + (t.duration || 0), 0)
  })

  const totalSize = computed(() => {
    return tasks.value.reduce((acc, t) => acc + (t.size || 0), 0)
  })

  const stagedCount = computed(() => {
    return tasks.value.filter((t) => t.status === "staged").length
  })

  const hasStaged = computed(() => stagedCount.value > 0)

  function addStagedTasks(newTasks: PlanTask[]) {
    if (!newTasks || newTasks.length === 0) return
    const current = [...tasks.value]
    const seen = new Set(current.map((t) => t.path))
    const trulyNew = newTasks.filter((t) => !seen.has(t.path))
    if (trulyNew.length === 0) return

    tasks.value = [...current, ...trulyNew]
    const s = new Set(selectedIds.value)
    for (const t of trulyNew) s.add(t.id)
    selectedIds.value = s

    if (status.value === "IDLE" || status.value === "READY") {
      status.value = "STALE"
    }
  }

  const excludedPaths = ref<Set<string>>(new Set())

  function removeTask(id: string) {
    const target = tasks.value.find((t) => t.id === id)
    if (target?.path) {
      excludedPaths.value.add(target.path)
    }
    tasks.value = tasks.value.filter((t) => t.id !== id)
    const s = new Set(selectedIds.value)
    s.delete(id)
    selectedIds.value = s
    if (inspectedTask.value?.id === id) {
      inspectedTask.value = null
    }
    if (activeTaskId.value === id) {
      activeTaskId.value = tasks.value[0]?.id || null
    }
    if (tasks.value.length === 0) {
      setPlan(null)
    } else {
      markStale()
    }
  }

  function removeSelectedTasks() {
    if (selectedIds.value.size === 0) return
    for (const t of tasks.value) {
      if (selectedIds.value.has(t.id) && t.path) {
        excludedPaths.value.add(t.path)
      }
    }
    tasks.value = tasks.value.filter((t) => !selectedIds.value.has(t.id))
    if (inspectedTask.value && selectedIds.value.has(inspectedTask.value.id)) {
      inspectedTask.value = null
    }
    if (activeTaskId.value && selectedIds.value.has(activeTaskId.value)) {
      activeTaskId.value = tasks.value[0]?.id || null
    }
    selectedIds.value = new Set()
    if (tasks.value.length === 0) {
      setPlan(null)
    } else {
      markStale()
    }
  }

  function restoreSelectionByPaths(knownPreviousPaths: Set<string>, selectedPaths: Set<string>) {
    const s = new Set<string>()
    for (const t of tasks.value) {
      if (knownPreviousPaths.size > 0 && knownPreviousPaths.has(t.path)) {
        if (selectedPaths.has(t.path)) {
          s.add(t.id)
        }
      } else {
        // Newly added task or fresh batch
        s.add(t.id)
      }
    }
    selectedIds.value = s
  }

  function setPlan(plan: PublicPlanSnapshot | null) {
    planSnapshot.value = plan
    if (plan && plan.tasks) {
      const activeTasks = excludedPaths.value.size > 0
        ? plan.tasks.filter((t) => !excludedPaths.value.has(t.path))
        : plan.tasks
      tasks.value = [...activeTasks]
      selectedIds.value = new Set(activeTasks.map((t) => t.id))
      activeTaskId.value = activeTasks[0]?.id || null
      status.value = "READY"
    } else {
      tasks.value = []
      selectedIds.value = new Set()
      activeTaskId.value = null
      inspectedTask.value = null
      excludedPaths.value = new Set()
      status.value = "IDLE"
    }
  }

  function markStale() {
    if (tasks.value.length > 0 && (status.value === "READY" || status.value === "STALE")) {
      status.value = "STALE"
    } else if (tasks.value.length === 0) {
      status.value = "IDLE"
    }
  }

  function toggleTask(id: string) {
    const s = new Set(selectedIds.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    selectedIds.value = s
  }

  function toggleAll() {
    if (isAllSelected.value) {
      selectedIds.value = new Set()
    } else {
      selectedIds.value = new Set(tasks.value.map((t) => t.id))
    }
  }

  function selectAll() {
    selectedIds.value = new Set(tasks.value.map((t) => t.id))
  }

  function clearSelection() {
    selectedIds.value = new Set()
  }

  function invertSelection() {
    const s = new Set<string>()
    for (const t of tasks.value) {
      if (!selectedIds.value.has(t.id)) {
        s.add(t.id)
      }
    }
    selectedIds.value = s
  }

  function updateTaskProgress(taskId: string, percent: number, speed?: number) {
    const list = [...tasks.value]
    const idx = list.findIndex((t) => t.id === taskId)
    if (idx >= 0 && !TERMINAL_STATUSES.has(list[idx].status)) {
      list[idx] = {
        ...list[idx],
        status: "running",
        progress: percent,
        speed: speed || list[idx].speed,
      }
      tasks.value = list
    }
    if (typeof speed === "number") currentSpeed.value = speed
  }

  function updateTaskStatus(taskId: string, newStatus: any, error?: string | null) {
    const list = [...tasks.value]
    const idx = list.findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      // 迟到的 task.started 不得把终态任务拉回 running
      if (TERMINAL_STATUSES.has(list[idx].status) && newStatus === "running") return
      list[idx] = {
        ...list[idx],
        status: newStatus,
        error: error || list[idx].error,
        progress: newStatus === "success" ? 100 : list[idx].progress,
      }
      tasks.value = list
    }
  }

  return {
    status,
    planSnapshot,
    tasks,
    selectedIds,
    activeTaskId,
    inspectedTask,
    currentSpeed,
    overallPercent,
    executedTasks,
    executedDuration,
    allTasksCompleted,
    isAllSelected,
    totalDuration,
    totalSize,
    stagedCount,
    hasStaged,
    addStagedTasks,
    excludedPaths,
    removeTask,
    removeSelectedTasks,
    restoreSelectionByPaths,
    setPlan,
    markStale,
    toggleTask,
    toggleAll,
    selectAll,
    clearSelection,
    invertSelection,
    updateTaskProgress,
    updateTaskStatus,
  }
})
