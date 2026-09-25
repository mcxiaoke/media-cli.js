import assert from "assert"
import fs from "node:fs"
import path from "path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import {
    normalizeCliOptions,
    normalizeDesktopOptions,
    toLegacyArgvOptions,
} from "../src/transcode/ffmpeg_options.js"
import { prepareFFmpegPlan } from "../src/transcode/ffmpeg_planner.js"

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SAMPLE = path.join(PROJECT_ROOT, "data", "videos", "TEST2__mpeg4_avi_480.avi")
const OUTPUT = path.join(PROJECT_ROOT, "temp", "parity-output")
const HAS_VIDEO_FIXTURES = fs.existsSync(SAMPLE)

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

test(
    "CLI and desktop option adapters produce the same canonical task set",
    { skip: !HAS_VIDEO_FIXTURES },
    async () => {
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
        const desktopOptions = normalizeDesktopOptions({
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
        const desktopArgv = {
            ...toLegacyArgvOptions(desktopOptions),
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
        const desktopPrepared = await prepareFFmpegPlan({
            entries: [...entries],
            preset: { name: "h264_2k" },
            argv: desktopArgv,
            buildTask,
        })

        assert.deepStrictEqual(
            cliPrepared.tasks.map(canonicalTask),
            desktopPrepared.tasks.map(canonicalTask),
        )
        assert.strictEqual(cliPrepared.outcome, "ready")
        assert.strictEqual(desktopPrepared.outcome, "ready")
    },
)
