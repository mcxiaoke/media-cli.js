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

  function setPlan(plan: PublicPlanSnapshot | null) {
    planSnapshot.value = plan
    if (plan && plan.tasks) {
      tasks.value = [...plan.tasks]
      selectedIds.value = new Set(plan.tasks.map((t) => t.id))
      status.value = "READY"
    } else {
      tasks.value = []
      selectedIds.value = new Set()
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
    setPlan,
    markStale,
    toggleTask,
    toggleAll,
    updateTaskProgress,
    updateTaskStatus,
  }
})
