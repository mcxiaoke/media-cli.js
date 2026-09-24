export const RUN_STATUS = Object.freeze({
    SUCCESS: "success",
    FAILED: "failed",
    SKIPPED: "skipped",
    CANCELLED: "cancelled",
})

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
            reason: entry.skipReason || (entry.dstExists ? "destination exists" : "skipped"),
            outputPath: entry.dstExistsPath || entry.fileDst,
        }
    }
    return {
        status: RUN_STATUS.FAILED,
        stage: entry.ffmpegError?.startsWith("plan:") ? "plan" : "execute",
        error: entry.ffmpegError || "Conversion failed",
    }
}
