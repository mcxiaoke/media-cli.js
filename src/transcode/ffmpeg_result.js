export const RUN_STATUS = Object.freeze({
    SUCCESS: "success",
    FAILED: "failed",
    SKIPPED: "skipped",
    CANCELLED: "cancelled",
})

export const SKIP_REASON = Object.freeze({
    BAD_FORMAT: "bad_format",
    INVALID_AUDIO: "invalid_audio",
    MISSING_AUDIO: "missing_audio",
    MISSING_VIDEO: "missing_video",
    DESTINATION_EXISTS: "destination_exists",
    SHORT_DURATION: "short_duration",
    STRICT_CODEC: "strict_codec",
    STRICT_MODE: "strict_mode",
    PREPARE_ERROR: "prepare_error",
})

function normalizeSkipReason(entry) {
    const reason = entry.skipReason || entry.reason
    if (Object.values(SKIP_REASON).includes(reason)) return reason
    return entry.dstExists ? SKIP_REASON.DESTINATION_EXISTS : SKIP_REASON.PREPARE_ERROR
}

/**
 * 将当前 runFFmpegCmd 的 entry 结果投影为稳定的适配层结果。
 * 底层执行器仍可在迁移期间保留旧字段；GUI/未来 Engine 不再直接依赖这些字段。
 */
export function toRunResult(entry) {
    if (!entry) {
        return {
            status: RUN_STATUS.FAILED,
            stage: "execute",
            error: "FFmpeg returned no result",
        }
    }
    if (Object.values(RUN_STATUS).includes(entry.status)) {
        return {
            status: entry.status,
            stage: entry.stage || "execute",
            outputPath: entry.outputPath || entry.dstExistsPath || entry.fileDst,
            reason: entry.status === RUN_STATUS.SKIPPED ? normalizeSkipReason(entry) : entry.reason,
            error: entry.error,
        }
    }
    if (entry.cancelled === true) {
        return {
            status: RUN_STATUS.CANCELLED,
            reason: entry.cancelReason || "cancelled",
        }
    }
    if (entry.ok === true) {
        return {
            status: RUN_STATUS.SUCCESS,
            outputPath: entry.fileDst,
        }
    }
    if (entry.skipped === true || entry.dstExists === true) {
        return {
            status: RUN_STATUS.SKIPPED,
            reason: normalizeSkipReason(entry),
            outputPath: entry.dstExistsPath || entry.fileDst,
        }
    }
    return {
        status: RUN_STATUS.FAILED,
        stage: entry.ffmpegError?.startsWith("plan:") ? "plan" : "execute",
        error: entry.ffmpegError || "Conversion failed",
    }
}

/**
 * Stable result for one execution attempt. The final task status may still be
 * represented by RunResult, while this object preserves attempt identity.
 */
export function createTaskAttemptResult({ taskId, attempt, result }) {
    const stable = toRunResult(result)
    return Object.freeze({
        schemaVersion: 1,
        taskId,
        attempt,
        status: stable.status,
        outputPath: stable.outputPath || null,
        reason: stable.reason || null,
        error: stable.error || null,
    })
}
