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
 * Project a single task/entry into a JSON-safe public task snapshot.
 *
 * 双阶段兼容：
 * - Staged Entry：仅 { name, path, size, info } 的初步输入，无目标路径，status 显式为 "staged"；
 * - Plan Task：已编排完整字段（fileDst/dstArgs 等），status 为内部状态。
 *
 * 状态继承：显式使用 `task.status || defaultStatus`，staging 阶段传入时稳定保留
 * `"staged"`，plan 阶段缺省兜底为内部状态。
 * 内部字段隔离：不暴露 argv、preset 实例、fileDstTemp、hwPlan 等内部路径与能力对象；
 * rawMetadata 保持 JSON 字符串。数值缺失统一回退 undefined（与 PlanTask optional 契约一致）。
 *
 * @param {object} taskOrEntry
 * @param {number} [index=0]
 * @param {string} [defaultStatus="pending"] 仅当 taskOrEntry.status 缺失时兜底
 * @returns {object}
 */
export function createPublicTaskSnapshot(taskOrEntry = {}, index = 0, defaultStatus = "pending") {
    const task = taskOrEntry || {}
    const info = task.mediaInfo || task.info || null
    const size = Number(task.size || 0)
    const duration = Number(task.duration || 0)
    return {
        id: task.id || task.taskId || `task-${index}`,
        index: Number.isInteger(task.index) ? task.index : index,
        name: task.name || "",
        path: task.path || "",
        size,
        duration,
        fileDst: task.fileDst || "",
        // 状态协议：内部 Engine 使用 done，public 契约统一为 success（唯一映射）。
        status: task.status === "done" ? "success" : task.status || defaultStatus,
        error: task.error || null,
        skipReason: task.skipReason || null,
        mediaInfo: info || undefined,
        videoCodec: task.videoCodec || info?.video?.format || task.srcCodec || undefined,
        audioCodec: task.audioCodec || info?.audio?.format || undefined,
        width: Number.isFinite(task.width) ? task.width : info?.video?.width,
        height: Number.isFinite(task.height) ? task.height : info?.video?.height,
        fps: Number.isFinite(task.fps) ? task.fps : info?.video?.framerate,
        bitrate: Number.isFinite(task.bitrate)
            ? task.bitrate
            : info?.bitrate || info?.video?.bitrate,
        srcSize: Number.isFinite(task.srcSize) ? task.srcSize : size,
        srcDuration: Number.isFinite(task.srcDuration) ? task.srcDuration : duration,
        containerFormat: task.containerFormat || undefined,
        cmdPreview: task.cmdPreview || undefined,
        bitDepth: Number.isFinite(task.bitDepth) ? task.bitDepth : info?.video?.bitDepth,
        pixelFormat: task.pixelFormat || info?.video?.pixelFormat || undefined,
        profile: task.profile || info?.video?.profile || undefined,
        level: task.level || (info?.video?.level ? String(info.video.level) : undefined),
        aspectRatio: task.aspectRatio || info?.video?.aspectRatio || undefined,
        audioChannels: Number.isFinite(task.audioChannels)
            ? task.audioChannels
            : info?.audio?.channels,
        audioSampleRate: Number.isFinite(task.audioSampleRate)
            ? task.audioSampleRate
            : info?.audio?.sampleRate,
        audioBitrate: Number.isFinite(task.audioBitrate) ? task.audioBitrate : info?.audio?.bitrate,
        progress: Number.isFinite(task.progress) ? task.progress : 0,
        speed: Number.isFinite(task.speed) ? task.speed : 0,
        rawMetadata: task.rawMetadata || (info ? JSON.stringify(info, null, 2) : undefined),
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
        tasks: tasks.map((task, index) => createPublicTaskSnapshot(task, index)),
    }
}
