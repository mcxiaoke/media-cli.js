/**
 * Create the internal execution plan envelope.
 * It may retain preset/runtime objects and is never sent directly to a renderer.
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

/**
 * Project an internal execution plan into a JSON-safe public snapshot.
 * Do not expose preset instances, argv, Stats, Set/Map, Error or temporary paths.
 */
export function createPublicPlanSnapshot(plan = {}) {
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
    return {
        schemaVersion: 1,
        id: plan.id || null,
        presetName: plan.presetName || "",
        mode: plan.mode || "plan",
        totalTasks: tasks.length,
        totalDuration: Number(plan.totalDuration || 0),
        totalSize: Number(plan.totalSize || 0),
        previewCmd: plan.previewCmd || "",
        tasks: tasks.map((task, index) => ({
            id: task.id || task.taskId || `task-${index}`,
            index: Number.isInteger(task.index) ? task.index : index,
            name: task.name || "",
            path: task.path || "",
            size: Number(task.size || 0),
            duration: Number(task.duration || 0),
            fileDst: task.fileDst || "",
            status: task.status || "pending",
            error: task.error || null,
            skipReason: task.skipReason || null,
        })),
    }
}
