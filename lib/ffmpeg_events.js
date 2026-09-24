export const ENGINE_EVENT = Object.freeze({
    PLAN_READY: "plan.ready",
    TASK_STARTED: "task.started",
    TASK_ATTEMPT_STARTED: "task.attempt.started",
    TASK_PROGRESS: "task.progress",
    TASK_LOG: "task.log",
    TASK_ATTEMPT_DONE: "task.attempt.done",
    TASK_DONE: "task.done",
    TASK_SKIPPED: "task.skipped",
    TASK_CANCELLED: "task.cancelled",
    SESSION_SUMMARY: "session.summary",
    SESSION_ERROR: "session.error",
})

/**
 * Create a monotonic event sequence for one engine run.
 * The returned function is intentionally transport-agnostic.
 */
export function createEventFactory(runId, now = () => new Date()) {
    let sequence = 0
    return function createEvent(type, payload = {}) {
        sequence += 1
        return Object.freeze({
            ...payload,
            schemaVersion: 1,
            seq: sequence,
            runId,
            timestamp: now().toISOString(),
            type,
        })
    }
}
