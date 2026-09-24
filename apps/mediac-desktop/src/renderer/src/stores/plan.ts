import { defineStore } from "pinia"
import { ref, shallowRef, computed } from "vue"
import type { PublicPlanSnapshot, PlanTask } from "../../../shared/contracts"

export type RunnerState =
  | "IDLE"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED"
  | "STALE"

export const usePlanStore = defineStore("plan", () => {
  const status = ref<RunnerState>("IDLE")
  const planSnapshot = ref<PublicPlanSnapshot | null>(null)
  // Use shallowRef for tasks array to avoid Proxy overhead on large task lists
  const tasks = shallowRef<PlanTask[]>([])
  const selectedIds = ref<Set<string>>(new Set())
  const inspectedTask = ref<PlanTask | null>(null)
  const currentSpeed = ref(0)
  const overallPercent = ref(0)
  const completedCount = ref(0)

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

  function removeTask(id: string) {
    tasks.value = tasks.value.filter((t) => t.id !== id)
    const s = new Set(selectedIds.value)
    s.delete(id)
    selectedIds.value = s
    if (inspectedTask.value?.id === id) {
      inspectedTask.value = null
    }
    if (tasks.value.length === 0) {
      setPlan(null)
    } else {
      markStale()
    }
  }

  function removeSelectedTasks() {
    if (selectedIds.value.size === 0) return
    tasks.value = tasks.value.filter((t) => !selectedIds.value.has(t.id))
    if (inspectedTask.value && selectedIds.value.has(inspectedTask.value.id)) {
      inspectedTask.value = null
    }
    selectedIds.value = new Set()
    if (tasks.value.length === 0) {
      setPlan(null)
    } else {
      markStale()
    }
  }

  function setPlan(plan: PublicPlanSnapshot | null) {
    planSnapshot.value = plan
    if (plan && plan.tasks) {
      tasks.value = [...plan.tasks]
      selectedIds.value = new Set(plan.tasks.map((t) => t.id))
      status.value = "READY"
    } else {
      tasks.value = []
      selectedIds.value = new Set()
      inspectedTask.value = null
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

  function updateTaskProgress(taskId: string, percent: number, speed?: number) {
    const list = [...tasks.value]
    const idx = list.findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        status: "running",
      }
      tasks.value = list
    }
    if (typeof speed === "number") currentSpeed.value = speed
  }

  function updateTaskStatus(taskId: string, newStatus: any, error?: string | null) {
    const list = [...tasks.value]
    const idx = list.findIndex((t) => t.id === taskId)
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        status: newStatus,
        error: error || list[idx].error,
      }
      tasks.value = list
    }
  }

  return {
    status,
    planSnapshot,
    tasks,
    selectedIds,
    inspectedTask,
    currentSpeed,
    overallPercent,
    completedCount,
    isAllSelected,
    totalDuration,
    totalSize,
    stagedCount,
    hasStaged,
    addStagedTasks,
    removeTask,
    removeSelectedTasks,
    setPlan,
    markStale,
    toggleTask,
    toggleAll,
    updateTaskProgress,
    updateTaskStatus,
  }
})
