import assert from "assert"
import test from "node:test"
import {
    createTaskAttemptResult,
    RUN_STATUS,
    SKIP_REASON,
    toRunResult,
} from "../src/transcode/ffmpeg_result.js"

test("ffmpeg result adapter distinguishes success, skip, cancel, and failure", () => {
    assert.deepStrictEqual(toRunResult({ ok: true, fileDst: "out.mp4" }), {
        status: RUN_STATUS.SUCCESS,
        outputPath: "out.mp4",
    })
    assert.deepStrictEqual(
        toRunResult({ dstExists: true, fileDst: "out.mp4", dstExistsPath: "old.mp4" }),
        {
            status: RUN_STATUS.SKIPPED,
            reason: SKIP_REASON.DESTINATION_EXISTS,
            outputPath: "old.mp4",
        },
    )
    assert.deepStrictEqual(toRunResult({ cancelled: true, cancelReason: "user stop" }), {
        status: RUN_STATUS.CANCELLED,
        reason: "user stop",
    })
    assert.deepStrictEqual(
        toRunResult({ status: RUN_STATUS.SKIPPED, skipReason: SKIP_REASON.MISSING_VIDEO }),
        {
            status: RUN_STATUS.SKIPPED,
            stage: "execute",
            outputPath: undefined,
            reason: SKIP_REASON.MISSING_VIDEO,
            error: undefined,
        },
    )
    assert.deepStrictEqual(toRunResult({ ffmpegFailed: true, ffmpegError: "plan: bad" }), {
        status: RUN_STATUS.FAILED,
        stage: "plan",
        error: "plan: bad",
    })
    assert.deepStrictEqual(toRunResult(undefined), {
        status: RUN_STATUS.FAILED,
        stage: "execute",
        error: "FFmpeg returned no result",
    })
    assert.deepStrictEqual(
        createTaskAttemptResult({
            taskId: "task-0",
            attempt: 2,
            result: { ok: true, fileDst: "out.mp4" },
        }),
        {
            schemaVersion: 1,
            taskId: "task-0",
            attempt: 2,
            status: RUN_STATUS.SUCCESS,
            outputPath: "out.mp4",
            reason: null,
            error: null,
        },
    )
})
