import { computed } from "vue"
import { usePlanStore } from "../stores/plan"
import { useConfigStore } from "../stores/config"
import type { PlanTask } from "../../../shared/contracts"

/**
 * 任务表格多选与状态组合式函数
 *
 * 封装任务行选中、多选集合维护、批量移除与忙碌状态守卫。
 */
export function useTaskSelection() {
  const planStore = usePlanStore()
  const configStore = useConfigStore()

  const isAllSelected = computed(() => planStore.isAllSelected)
  const selectedCount = computed(() => planStore.selectedIds.size)

  function isSelected(id: string) {
    return planStore.selectedIds.has(id)
  }

  // 行点击：仅更新当前激活行（用于底部信息快速聚焦），绝不冲刷选项框多选集合
  function handleRowClick(task: PlanTask, event: MouseEvent) {
    if ((event.target as HTMLElement).closest(".ck, .ck-cell, .icon-btn, .t-ops")) return
    planStore.activeTaskId = task.id
  }

  // 选项框点击：仅鼠标左键点击选项框时切换勾选状态
  function handleCheckboxClick(task: PlanTask, event: MouseEvent) {
    event.stopPropagation()
    planStore.toggleTask(task.id)
  }

  function toggleAll() {
    planStore.toggleAll()
  }

  function selectAll() {
    planStore.selectAll()
  }

  function clearSelection() {
    planStore.clearSelection()
  }

  function invertSelection() {
    planStore.invertSelection()
  }

  // 与 App.vue 的 isBusy 同口径：菜单/右键操作与顶栏按钮共用状态守卫
  function isPlanBusy() {
    return (
      planStore.status === "RUNNING" ||
      planStore.status === "PLANNING" ||
      planStore.status === "STOPPING"
    )
  }

  /**
   * 批量移除所选任务的唯一实现（底栏按钮与右键菜单共用）。
   * 三处状态必须同步，缺一即产生用户可见的不一致：
   *   1) planStore  —— 表格行与勾选集合；
   *   2) configStore.inputs —— 左侧输入清单，否则已移除的文件仍显示在 chip 列表里；
   *   3) 主进程 stagedEntries —— 否则同一文件再次导入会被去重逻辑判为重复并静默丢弃。
   */
  function removeSelectedTasks() {
    if (isPlanBusy()) return
    const paths = planStore.tasks
      .filter((t) => planStore.selectedIds.has(t.id))
      .map((t) => t.path)
      .filter((p): p is string => Boolean(p))
    if (paths.length === 0) return
    planStore.removeSelectedTasks()
    configStore.removeInputs(paths)
    if (window.api?.removeStagedInputs) {
      void window.api.removeStagedInputs(paths)
    }
  }

  return {
    isAllSelected,
    selectedCount,
    isSelected,
    handleRowClick,
    handleCheckboxClick,
    toggleAll,
    selectAll,
    clearSelection,
    invertSelection,
    isPlanBusy,
    removeSelectedTasks,
  }
}
