import assert from "node:assert/strict"
import test from "node:test"
import { createProgressTracker, parseTimeToSeconds } from "../src/transcode/ffmpeg_progress.js"
import {
    extractFFmpegError,
    isCancellationError,
    serializeError,
} from "../src/transcode/ffmpeg_error.js"

test("parseTimeToSeconds parses standard and fractional time formats", () => {
    assert.strictEqual(parseTimeToSeconds(""), 0)
    assert.strictEqual(parseTimeToSeconds(null), 0)
    assert.strictEqual(parseTimeToSeconds("invalid"), 0)
    assert.strictEqual(parseTimeToSeconds("00:01:00"), 60)
    assert.strictEqual(parseTimeToSeconds("01:00:00"), 3600)
    assert.ok(Math.abs(parseTimeToSeconds("00:04:36.30") - 276.3) < 0.001)
    assert.ok(Math.abs(parseTimeToSeconds("00:00:04.633333") - 4.633333) < 0.0001)
})

test("createProgressTracker tracks speed and dispatches onProgress", () => {
    const progressEvents = []
    const tracker = createProgressTracker({
        srcDuration: 100,
        onProgress: (ev) => progressEvents.push(ev),
    })

    tracker.handleStdout("frame=120\nfps=60\nspeed= 2.5x\nout_time=00:00:10.000000\n")
    assert.strictEqual(tracker.currentSpeed, "2.5x")
    assert.strictEqual(tracker.currentSpeedValue, 2.5)
    assert.strictEqual(tracker.currentTime, 10)
    assert.strictEqual(progressEvents.length, 1)
    assert.strictEqual(progressEvents[0].percent, 10)
    assert.strictEqual(progressEvents[0].speed, 2.5)
})

test("extractFFmpegError ignores noise lines and extracts root cause error", () => {
    const errorWithContext = {
        stderr: [
            "[info] Input #0, matroska,webm, from 'sample.webm':",
            "[error] Link 'Parsed_scale_0:default' -> 'Parsed_format_1:default':",
            "[error]     src: yuv420p",
            "[error]     dst: cuda",
            "[error] Impossible to convert between the formats: yuv420p -> cuda",
            "[info] Conversion failed!",
        ].join("\n"),
    }
    const extracted = extractFFmpegError(errorWithContext)
    assert.strictEqual(extracted, "Impossible to convert between the formats: yuv420p -> cuda")

    const fallbackError = {
        stderr: "Some unknown prefix\nFailed to configure output stream\nconversion failed!",
    }
    assert.strictEqual(extractFFmpegError(fallbackError), "Failed to configure output stream")
})

test("serializeError serializes Error instance properties including stderr", () => {
    const err = new Error("Encoding failed")
    err.stderr = "CUDA out of memory"
    const obj = serializeError(err)
    assert.strictEqual(obj.name, "Error")
    assert.strictEqual(obj.message, "Encoding failed")
    assert.strictEqual(obj.stderr, "CUDA out of memory")
    assert.ok(obj.stack)

    assert.strictEqual(serializeError("plain string"), "plain string")
})

test("isCancellationError identifies abort, cancel, and termination states", () => {
    assert.strictEqual(isCancellationError(null), false)
    assert.strictEqual(isCancellationError({ name: "AbortError" }), true)
    assert.strictEqual(isCancellationError({ code: "ABORT_ERR" }), true)
    assert.strictEqual(isCancellationError({ isCanceled: true }), true)
    assert.strictEqual(isCancellationError({ isTerminated: true }), true)
    assert.strictEqual(isCancellationError(null, { aborted: true }), true)
})
