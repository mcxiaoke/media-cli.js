import assert from "assert"
import path from "path"
import test from "node:test"
import {
    normalizeCliOptions,
    normalizeWebOptions,
    toLegacyArgvOptions,
} from "../lib/ffmpeg_options.js"
import { prepareFFmpegPlan } from "../lib/ffmpeg_planner.js"

const SAMPLE = path.resolve("data/videos/TEST2__mpeg4_avi_480.avi")
const OUTPUT = path.resolve("temp/parity-output")

function canonicalTask(task) {
    return {
        path: task.path,
        name: task.name,
        size: task.size,
        status: task.status,
        fileDst: task.fileDst,
        outputMode: task.argv?.outputMode,
        decodeMode: task.argv?.decodeMode,
        override: task.argv?.override,
        deleteSourceFiles: task.argv?.deleteSourceFiles,
        strict: task.argv?.strict,
    }
}

test("CLI and ffweb option adapters produce the same canonical task set", async () => {
    const cliOptions = normalizeCliOptions({
        input: SAMPLE,
        output: OUTPUT,
        preset: "h264_2k",
        outputMode: "dir",
        decodeMode: "auto",
        override: true,
        strict: false,
        deleteSourceFiles: false,
        doit: false,
    })
    const webOptions = normalizeWebOptions({
        inputs: [SAMPLE],
        output: OUTPUT,
        preset: "h264_2k",
        options: {
            outputMode: "dir",
            decodeMode: "auto",
            override: true,
            strict: false,
            deleteSourceFiles: false,
        },
    })
    const cliArgv = {
        ...toLegacyArgvOptions(cliOptions),
        input: SAMPLE,
        output: OUTPUT,
        preset: "h264_2k",
    }
    const webArgv = {
        ...toLegacyArgvOptions(webOptions),
        output: OUTPUT,
        preset: "h264_2k",
    }
    const buildTask = async (entry) => ({
        ...entry,
        status: "pending",
        fileDst: path.join(OUTPUT, entry.name),
    })
    const entries = [
        { root: path.dirname(SAMPLE), path: SAMPLE, name: path.basename(SAMPLE), size: 123 },
    ]

    const cliPrepared = await prepareFFmpegPlan({
        entries,
        preset: { name: "h264_2k" },
        argv: cliArgv,
        buildTask,
    })
    const webPrepared = await prepareFFmpegPlan({
        entries: [...entries],
        preset: { name: "h264_2k" },
        argv: webArgv,
        buildTask,
    })

    assert.deepStrictEqual(
        cliPrepared.tasks.map(canonicalTask),
        webPrepared.tasks.map(canonicalTask),
    )
    assert.strictEqual(cliPrepared.outcome, "ready")
    assert.strictEqual(webPrepared.outcome, "ready")
})
