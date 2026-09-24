import { defineStore } from "pinia"
import { ref, computed } from "vue"

export interface LogEntry {
  level: "INFO" | "CMD" | "WARN" | "ERROR"
  text: string
  ts: string
  taskId?: string
}

export interface AppendLogOptions {
  level: "INFO" | "CMD" | "WARN" | "ERROR" | string
  message: string
  taskId?: string
  timestamp?: string
}

export const useLogStore = defineStore("log", () => {
  const logs = ref<LogEntry[]>([])
  const errCount = ref(0)
  const filter = ref<"ALL" | "INFO" | "CMD" | "WARN" | "ERROR">("ALL")
  const focusedTaskId = ref<string | null>(null)
  const drawerOpen = ref(false)

  function nowTs(): string {
    const d = new Date()
    const p = (x: number) => (x < 10 ? "0" : "") + x
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
  }

  function addLog(level: "INFO" | "CMD" | "WARN" | "ERROR", text: string, taskId?: string) {
    logs.value.push({ level, text, ts: nowTs(), taskId })
    if (logs.value.length > 500) logs.value.shift()
    if (level === "ERROR") errCount.value++
  }

  function append(opts: AppendLogOptions) {
    let lvl: "INFO" | "CMD" | "WARN" | "ERROR" = "INFO"
    const upper = (opts.level || "INFO").toUpperCase()
    if (upper === "CMD" || upper === "WARN" || upper === "ERROR") {
      lvl = upper
    }
    logs.value.push({
      level: lvl,
      text: opts.message,
      ts: opts.timestamp || nowTs(),
      taskId: opts.taskId,
    })
    if (logs.value.length > 500) logs.value.shift()
    if (lvl === "ERROR") errCount.value++
  }

  function clearLogs() {
    logs.value = []
    errCount.value = 0
  }

  function viewTaskLog(taskId: string) {
    focusedTaskId.value = taskId
    filter.value = "ALL"
    drawerOpen.value = true
  }

  function focusTask(taskId: string) {
    viewTaskLog(taskId)
  }

  function clearFocus() {
    focusedTaskId.value = null
  }

  const filteredLogs = computed(() => {
    return logs.value.filter((l) => {
      if (focusedTaskId.value) {
        const matchesTask = l.taskId === focusedTaskId.value || l.text.includes(focusedTaskId.value)
        if (!matchesTask) return false
      }
      return filter.value === "ALL" || l.level === filter.value
    })
  })

  return {
    logs,
    errCount,
    filter,
    focusedTaskId,
    drawerOpen,
    filteredLogs,
    addLog,
    append,
    clearLogs,
    viewTaskLog,
    focusTask,
    clearFocus,
  }
})
