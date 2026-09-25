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
  const filter = ref<"ALL" | "INFO" | "CMD" | "WARN" | "ERROR">("ALL")
  const focusedTaskId = ref<string | null>(null)
  const drawerOpen = ref(false)
  /**
   * 单调递增的日志序号。日志缓冲区满 500 条后 push+shift 会让 length 恒为 500，
   * 以 length 作为 watch 源会导致长任务（日志最多）的自动滚动静默失效。
   */
  const seq = ref(0)

  /** 从缓冲区派生而非累加：滚动淘汰 ERROR 日志后计数同步收敛，不会与可见日志脱节 */
  const errCount = computed(() => logs.value.filter((l) => l.level === "ERROR").length)

  function nowTs(): string {
    const d = new Date()
    const p = (x: number) => (x < 10 ? "0" : "") + x
    return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds())
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
    seq.value++
    if (logs.value.length > 500) logs.value.shift()
  }

  function clearLogs() {
    logs.value = []
    seq.value++
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

  /**
   * taskId 匹配必须带词边界：taskId 形如 task_1695..._ab12cd，前缀相同的 id
   * （task_123 / task_1234）用裸 includes 会互相误匹配。
   */
  const focusPattern = computed(() => {
    const id = focusedTaskId.value
    if (!id) return null
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`\\b${escaped}\\b`)
  })

  const filteredLogs = computed(() => {
    return logs.value.filter((l) => {
      if (focusedTaskId.value) {
        const matchesTask = l.taskId === focusedTaskId.value || focusPattern.value?.test(l.text) === true
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
    seq,
    filteredLogs,
    append,
    clearLogs,
    viewTaskLog,
    focusTask,
    clearFocus,
  }
})
