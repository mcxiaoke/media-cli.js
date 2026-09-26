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
  /**
   * 运行期配置变更的「待兑现」标记。
   *
   * 运行中不能把 status 直接改成 STALE（会让 UI 脱离正在跑的会话、终止按钮失效），
   * 但这次变更也绝不能丢弃：否则运行结束后状态直接收敛为 COMPLETED，
   * 用户点「开始转码」时 startExecution 的 STALE 判定不成立 → 复用主进程冻结的旧
   * currentPlan.argv，形成「界面显示配置已改、实际仍执行旧参数」的静默不一致。
   * 由 markStale() 置位、applyPendingStale() 在会话收敛时兑现、setPlan() 作废。
   */
  const pendingStale = ref(false)

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
    for (const t of trulyNew) {
      s.add(t.id)
      if (t.path) excludedPaths.value.delete(t.path)
    }
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
      tasks.value = []
      selectedIds.value = new Set()
      activeTaskId.value = null
      inspectedTask.value = null
      status.value = "IDLE"
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
      tasks.value = []
      selectedIds.value = new Set()
      activeTaskId.value = null
      inspectedTask.value = null
      status.value = "IDLE"
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
    // 新计划必然反映当前配置，运行期的待兑现变更随之作废
    pendingStale.value = false
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
    // 终态（COMPLETED/FAILED/STOPPED）之后配置变化同样必须标 STALE：
    // startExecution 只在 STALE / hasStaged / 无 planSnapshot 时才重推演，
    // 若终态下 markStale 是 no-op，旧计划里已确认的 deleteSourceFiles/
    // deleteSourceConfirmed 会在用户关闭删源开关后继续生效（数据风险）。
    // 忙碌态（RUNNING/PLANNING/STOPPING）保持不变，由执行流自行收敛。
    if (tasks.value.length > 0) {
      if (status.value === "RUNNING" || status.value === "PLANNING" || status.value === "STOPPING") {
        pendingStale.value = true
      } else {
        status.value = "STALE"
      }
    } else {
      status.value = "IDLE"
    }
  }

  /** 会话收敛时兑现运行期的配置变更：置 STALE，使下次执行必然重推演 */
  function applyPendingStale() {
    if (!pendingStale.value) return
    pendingStale.value = false
    if (tasks.value.length > 0) {
      status.value = "STALE"
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

  /**
   * 速度值归一化。
   * 主进程侧 ffmpeg -progress 的 speed 字段是 "1.5x" 这类字符串，执行层已在
   * runFFmpegCmd 内转成数字后再上报；这里同时接受字符串形式，避免任一侧回归时
   * 「实时速度/剩余时间」再次静默失效（此前正是字符串被 number 判定挡掉）。
   */
  function normalizeSpeed(speed: unknown): number | undefined {
    if (typeof speed === "number") {
      return Number.isFinite(speed) && speed > 0 ? speed : undefined
    }
    if (typeof speed === "string") {
      const parsed = Number.parseFloat(speed)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    }
    return undefined
  }

  function updateTaskProgress(taskId: string, percent: number, speed?: number | string) {
    const list = [...tasks.value]
    const idx = list.findIndex((t) => t.id === taskId)
    const speedValue = normalizeSpeed(speed)
    if (idx >= 0 && !TERMINAL_STATUSES.has(list[idx].status)) {
      list[idx] = {
        ...list[idx],
        status: "running",
        progress: percent,
        speed: speedValue ?? list[idx].speed,
      }
      tasks.value = list
    }
    if (speedValue !== undefined) currentSpeed.value = speedValue
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

  /**
   * 把 previewCmd（主进程按「计划内首个任务」生成）适配到指定任务。
   *
   * ⚠️ 基准任务必须按 path 反查，不能假定 tasks[0]：用户移除过首行后 tasks[0] 已偏移，
   *    字符串替换会失配，复制出的命令指向已移除的文件（L9）。
   *    反查不到基准（已被移除）时原样返回，宁可不替换也不做错误替换。
   *    空 from/to 一律跳过——`String.split("")` 会按字符切分，把命令彻底打碎。
   */
  function previewCmdFor(task: PlanTask | null): string {
    const base = planSnapshot.value?.previewCmd || ""
    if (!task) return base
    if (!base) {
      return `ffmpeg -i "${task.path}" "${task.fileDst || "output.mp4"}"`
    }
    // 取最长命中：/a/b.mp4 与 /a/b.mp4_2 互为子串时，长的那个才是真实基准
    const baseTask = tasks.value
      .filter((t) => t.path && base.includes(t.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (!baseTask) return base
    let out = base
    const replaceAll = (from: string, to: string) => {
      if (!from || !to || from === to) return
      out = out.split(`"${from}"`).join(`"${to}"`).split(from).join(to)
    }
    replaceAll(baseTask.path, task.path)
    replaceAll(baseTask.fileDst, task.fileDst)
    return out
  }

  return {
    status,
    planSnapshot,
    tasks,
    selectedIds,
    activeTaskId,
    inspectedTask,
    currentSpeed,
    pendingStale,
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
    applyPendingStale,
    previewCmdFor,
    toggleTask,
    toggleAll,
    selectAll,
    clearSelection,
    invertSelection,
    updateTaskProgress,
    updateTaskStatus,
  }
})
