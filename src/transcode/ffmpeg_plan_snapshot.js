/**
 * Create the internal execution plan envelope.
 *
 * 内部计划保留 preset 实例、argv 与任务全量字段（含 fileDstTemp、hwPlan 等
 * 临时路径与能力对象），只在本进程内流转，不做对外投影。
 */
export function createInternalExecutionPlan({
    id,
    presetName,
    preset,
    mode = "plan",
    argv,
    tasks = [],
    totalDuration = 0,
    totalSize = 0,
    previewCmd = "",
} = {}) {
    return {
        schemaVersion: 1,
        id: id || `plan_${Date.now()}`,
        presetName: presetName || preset?.name || "",
        preset,
        mode,
        argv,
        tasks: tasks.map((task, index) => ({
            ...task,
            id: task.id || task.taskId || `task-${index}`,
            taskId: task.id || task.taskId || `task-${index}`,
            index: Number.isInteger(task.index) ? task.index : index,
            status: task.status || "pending",
        })),
        totalDuration: Number(totalDuration || 0),
        totalSize: Number(totalSize || 0),
        previewCmd: previewCmd || "",
    }
}
