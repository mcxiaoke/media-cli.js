import assert from "assert"
import test from "node:test"
import { RUN_STATUS, toRunResult } from "../lib/ffmpeg_result.js"

test("ffmpeg result adapter distinguishes success, skip, cancel, and failure", () => {
    assert.deepStrictEqual(toRunResult({ ok: true, fileDst: "out.mp4" }), {
        status: RUN_STATUS.SUCCESS,
        outputPath: "out.mp4",
    })
    assert.deepStrictEqual(
        toRunResult({ dstExists: true, fileDst: "out.mp4", dstExistsPath: "old.mp4" }),
        {
            status: RUN_STATUS.SKIPPED,
            reason: "destination exists",
            outputPath: "old.mp4",
        },
    )
    assert.deepStrictEqual(toRunResult({ cancelled: true, cancelReason: "user stop" }), {
        status: RUN_STATUS.CANCELLED,
        reason: "user stop",
    })
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
})
