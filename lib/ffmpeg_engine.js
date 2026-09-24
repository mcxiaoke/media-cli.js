import pMap from "p-map"
import { ENGINE_EVENT, createEventFactory } from "./ffmpeg_events.js"
import { RUN_STATUS, createTaskAttemptResult, toRunResult } from "./ffmpeg_result.js"

function invalidArgument(message) {
    const error = new Error(message)
    error.code = "INVALID_ARGUMENT"
    return error
}

function validatePositiveInteger(value, name, defaultValue) {
    const result = value === undefined ? defaultValue : Number(value)
    if (!Number.isSafeInteger(result) || result < 1) {
        throw invalidArgument(`${name} must be a positive safe integer`)
    }
    return result
}

function safeCall(fn, ...args) {
    if (typeof fn !== "function") return
    try {
        return fn(...args)
    } catch {
        // Adapter callbacks must not break the execution session.
    }
}

async function safeCallAsync(fn, ...args) {
    if (typeof fn !== "function") return undefined
    try {
        return await fn(...args)
    } catch {
        return undefined
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
                maxAttempts: requestedMaxAttempts,
                shouldRetry,
                confirmRetry,
                prepareAttempt,
                onTaskStart,
                onTaskProgress,
                onTaskLog,
                onTaskSpawn,
                onTaskExit,
                onTaskAttemptDone,
                onTaskDone,
                onSummary,
            } = options
            if (mode !== "execute") {
                throw invalidArgument("engine.execute requires mode=execute")
            }
            const concurrency = validatePositiveInteger(requestedConcurrency, "concurrency", 1)
            const maxAttempts = validatePositiveInteger(requestedMaxAttempts, "maxAttempts", 1)
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
                retryCount: 0,
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
                    if (
                        task.status === "skipped" ||
                        task.skipped === true ||
                        task.dstExists === true
                    ) {
                        const result = toRunResult(task)
                        task.status = "skipped"
                        task.skipReason = result.reason
                        summary.skipped++
                        emit(ENGINE_EVENT.TASK_SKIPPED, { taskId, taskIndex: index, result })
                        safeCall(onTaskDone, { task, taskId, index, result })
                        return
                    }
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
                    safeCall(onTaskStart, { task, taskId, index, total: tasks.length })

                    let currentTask = task
                    let result = null
                    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                        if (signal?.aborted) {
                            result = {
                                status: RUN_STATUS.CANCELLED,
                                reason: "cancelled before attempt",
                            }
                            break
                        }
                        if (attempt > 1) {
                            const preparedTask = await safeCallAsync(prepareAttempt, {
                                task: currentTask,
                                result,
                                attempt,
                            })
                            if (preparedTask) {
                                Object.assign(currentTask, preparedTask)
                            }
                        }

                        emit(ENGINE_EVENT.TASK_ATTEMPT_STARTED, {
                            taskId,
                            taskIndex: index,
                            attempt,
                        })
                        let rawResult
                        try {
                            rawResult = await runTask(currentTask, {
                                signal,
                                attempt,
                                onProgress(progress) {
                                    const safeProgress = { ...(progress || {}) }
                                    delete safeProgress.entry
                                    emit(ENGINE_EVENT.TASK_PROGRESS, {
                                        taskId,
                                        taskIndex: index,
                                        attempt,
                                        ...safeProgress,
                                    })
                                    safeCall(onTaskProgress, safeProgress, {
                                        task: currentTask,
                                        taskId,
                                        index,
                                        total: tasks.length,
                                    })
                                },
                                onLog(line) {
                                    emit(ENGINE_EVENT.TASK_LOG, {
                                        taskId,
                                        taskIndex: index,
                                        attempt,
                                        message: String(line || ""),
                                    })
                                    safeCall(onTaskLog, line, {
                                        task: currentTask,
                                        taskId,
                                        index,
                                        total: tasks.length,
                                    })
                                },
                                onSpawn(child, metadata) {
                                    safeCall(onTaskSpawn, child, {
                                        ...metadata,
                                        task: currentTask,
                                        taskId,
                                        index,
                                        total: tasks.length,
                                        attempt,
                                    })
                                },
                                onExit(metadata) {
                                    safeCall(onTaskExit, metadata, {
                                        task: currentTask,
                                        taskId,
                                        index,
                                        total: tasks.length,
                                        attempt,
                                    })
                                },
                            })
                        } catch (error) {
                            rawResult = {
                                ffmpegFailed: true,
                                ffmpegError: error?.message || String(error),
                            }
                        }
                        result = toRunResult(rawResult)
                        const attemptResult = createTaskAttemptResult({
                            taskId,
                            attempt,
                            result,
                        })
                        emit(ENGINE_EVENT.TASK_ATTEMPT_DONE, {
                            taskId,
                            taskIndex: index,
                            attempt,
                            result: attemptResult,
                        })
                        safeCall(onTaskAttemptDone, {
                            task: currentTask,
                            taskId,
                            index,
                            attempt,
                            result: attemptResult,
                        })

                        if (
                            result.status === RUN_STATUS.SUCCESS ||
                            result.status === RUN_STATUS.SKIPPED ||
                            result.status === RUN_STATUS.CANCELLED ||
                            attempt >= maxAttempts
                        ) {
                            break
                        }
                        const retryAllowed = await safeCallAsync(shouldRetry, {
                            task: currentTask,
                            result,
                            attempt,
                        })
                        if (!retryAllowed) break
                        const retryConfirmed = await safeCallAsync(confirmRetry, {
                            task: currentTask,
                            result,
                            attempt,
                        })
                        if (!retryConfirmed) break
                        summary.retryCount++
                    }

                    if (!result) {
                        result = toRunResult(currentTask)
                    }
                    if (signal?.aborted || result.status === RUN_STATUS.CANCELLED) {
                        currentTask.status = "cancelled"
                        currentTask.cancelReason = result.reason || "cancelled"
                        summary.cancelled++
                        emit(ENGINE_EVENT.TASK_CANCELLED, { taskId, taskIndex: index })
                    } else if (result.status === RUN_STATUS.SUCCESS) {
                        currentTask.status = "done"
                        currentTask.ok = true
                        summary.success++
                        emit(ENGINE_EVENT.TASK_DONE, { taskId, taskIndex: index, result })
                    } else if (result.status === RUN_STATUS.SKIPPED) {
                        currentTask.status = "skipped"
                        currentTask.skipReason = result.reason
                        summary.skipped++
                        emit(ENGINE_EVENT.TASK_SKIPPED, { taskId, taskIndex: index, result })
                    } else {
                        currentTask.status = "failed"
                        currentTask.error = result.error
                        currentTask.ffmpegFailed = true
                        currentTask.ffmpegError = result.error
                        summary.failed++
                        emit(ENGINE_EVENT.TASK_DONE, {
                            taskId,
                            taskIndex: index,
                            result,
                            failed: true,
                        })
                    }

                    safeCall(onTaskDone, { task: currentTask, taskId, index, result })
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
