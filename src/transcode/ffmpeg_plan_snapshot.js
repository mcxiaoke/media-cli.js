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
        tasks: tasks.map((task, index) => {
            const info = task.mediaInfo || task.info || null
            return {
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
                mediaInfo: info || undefined,
                videoCodec: task.videoCodec || info?.video?.format || task.srcCodec || undefined,
                audioCodec: task.audioCodec || info?.audio?.format || undefined,
                width: Number.isFinite(task.width) ? task.width : info?.video?.width,
                height: Number.isFinite(task.height) ? task.height : info?.video?.height,
                fps: Number.isFinite(task.fps) ? task.fps : info?.video?.framerate,
                bitrate: Number.isFinite(task.bitrate)
                    ? task.bitrate
                    : info?.bitrate || info?.video?.bitrate,
                srcSize: Number.isFinite(task.srcSize) ? task.srcSize : Number(task.size || 0),
                srcDuration: Number.isFinite(task.srcDuration)
                    ? task.srcDuration
                    : Number(task.duration || 0),
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
                audioBitrate: Number.isFinite(task.audioBitrate)
                    ? task.audioBitrate
                    : info?.audio?.bitrate,
                progress: Number.isFinite(task.progress) ? task.progress : 0,
                speed: Number.isFinite(task.speed) ? task.speed : 0,
                rawMetadata: task.rawMetadata || (info ? JSON.stringify(info, null, 2) : undefined),
            }
        }),
    }
}
