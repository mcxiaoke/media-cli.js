import pMap from "p-map"
import { ENGINE_EVENT, createEventFactory } from "./ffmpeg_events.js"
import { RUN_STATUS, toRunResult } from "./ffmpeg_result.js"

function invalidArgument(message) {
    const error = new Error(message)
    error.code = "INVALID_ARGUMENT"
    return error
}

function validateConcurrency(value) {
    const concurrency = value === undefined ? 1 : Number(value)
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
        throw invalidArgument("concurrency must be a positive safe integer")
    }
    return concurrency
}

function safeCall(fn, ...args) {
    if (typeof fn !== "function") return
    try {
        return fn(...args)
    } catch {
        // Adapter callbacks must not break the execution session.
    }
}

function taskIdOf(task, index) {
    return task.id || task.taskId || `task-${index}`
}

/**
 * Shared execution session for FFmpeg tasks.
 *
 * Planning and task construction are supplied by the caller. This module owns
 * queueing, cancellation, status transitions, result normalization and events.
 * It deliberately does not know about CLI, HTTP or Electron transports.
 */
export function createFFmpegEngine({ runTask, onEvent } = {}) {
    if (typeof runTask !== "function") {
        throw invalidArgument("runTask is required")
    }

    return {
        async execute(plan, options = {}) {
            const {
                mode = "execute",
                signal = null,
                concurrency: requestedConcurrency,
                onTaskStart,
                onTaskProgress,
                onTaskLog,
                onTaskDone,
                onSummary,
            } = options
            if (mode !== "execute") {
                throw invalidArgument("engine.execute requires mode=execute")
            }
            const concurrency = validateConcurrency(requestedConcurrency)
            const tasks = Array.isArray(plan?.tasks) ? plan.tasks : []
            const runId = plan?.id || `run_${Date.now()}`
            const createEvent = createEventFactory(runId)
            const startedAt = Date.now()
            const summary = {
                runId,
                total: tasks.length,
                success: 0,
                failed: 0,
                skipped: 0,
                cancelled: 0,
                elapsedMs: 0,
                isCancelled: false,
            }

            const emit = (type, payload = {}) => {
                const event = createEvent(type, payload)
                safeCall(onEvent, event)
                return event
            }

            if (tasks.length === 0) {
                summary.elapsedMs = Date.now() - startedAt
                emit(ENGINE_EVENT.SESSION_SUMMARY, { summary })
                safeCall(onSummary, summary)
                return summary
            }

            await pMap(
                tasks,
                async (task, index) => {
                    const taskId = taskIdOf(task, index)
                    if (signal?.aborted) {
                        task.status = "cancelled"
                        task.cancelReason = "cancelled before start"
                        summary.cancelled++
                        emit(ENGINE_EVENT.TASK_CANCELLED, { taskId, taskIndex: index })
                        safeCall(onTaskDone, { task, taskId, index, result: toRunResult(task) })
                        return
                    }

                    task.status = "running"
                    emit(ENGINE_EVENT.TASK_STARTED, {
                        taskId,
                        taskIndex: index,
                        total: tasks.length,
                    })
                    emit(ENGINE_EVENT.TASK_ATTEMPT_STARTED, {
                        taskId,
                        taskIndex: index,
                        attempt: 1,
                    })
                    safeCall(onTaskStart, { task, taskId, index, total: tasks.length })

                    let rawResult
                    try {
                        rawResult = await runTask(task, {
                            signal,
                            attempt: 1,
                            onProgress(progress) {
                                const safeProgress = { ...(progress || {}) }
                                delete safeProgress.entry
                                emit(ENGINE_EVENT.TASK_PROGRESS, {
                                    taskId,
                                    taskIndex: index,
                                    ...safeProgress,
                                })
                                safeCall(onTaskProgress, safeProgress, {
                                    task,
                                    taskId,
                                    index,
                                    total: tasks.length,
                                })
                            },
                            onLog(line) {
                                emit(ENGINE_EVENT.TASK_LOG, {
                                    taskId,
                                    taskIndex: index,
                                    message: String(line || ""),
                                })
                                safeCall(onTaskLog, line, {
                                    task,
                                    taskId,
                                    index,
                                    total: tasks.length,
                                })
                            },
                        })
                    } catch (error) {
                        rawResult = {
                            ffmpegFailed: true,
                            ffmpegError: error?.message || String(error),
                        }
                    }

                    const result = toRunResult(rawResult)
                    if (signal?.aborted || result.status === RUN_STATUS.CANCELLED) {
                        task.status = "cancelled"
                        task.cancelReason = result.reason || "cancelled"
                        summary.cancelled++
                        emit(ENGINE_EVENT.TASK_CANCELLED, { taskId, taskIndex: index })
                    } else if (result.status === RUN_STATUS.SUCCESS) {
                        task.status = "done"
                        task.ok = true
                        summary.success++
                        emit(ENGINE_EVENT.TASK_DONE, { taskId, taskIndex: index, result })
                    } else if (result.status === RUN_STATUS.SKIPPED) {
                        task.status = "skipped"
                        task.skipReason = result.reason
                        summary.skipped++
                        emit(ENGINE_EVENT.TASK_SKIPPED, { taskId, taskIndex: index, result })
                    } else {
                        task.status = "failed"
                        task.error = result.error
                        task.ffmpegFailed = true
                        task.ffmpegError = result.error
                        summary.failed++
                        emit(ENGINE_EVENT.TASK_DONE, {
                            taskId,
                            taskIndex: index,
                            result,
                            failed: true,
                        })
                    }

                    emit(ENGINE_EVENT.TASK_ATTEMPT_DONE, {
                        taskId,
                        taskIndex: index,
                        attempt: 1,
                        result,
                    })
                    safeCall(onTaskDone, { task, taskId, index, result })
                },
                { concurrency },
            )

            summary.isCancelled = Boolean(signal?.aborted) || summary.cancelled > 0
            summary.elapsedMs = Date.now() - startedAt
            emit(ENGINE_EVENT.SESSION_SUMMARY, { summary })
            safeCall(onSummary, summary)
            return summary
        },
    }
}
