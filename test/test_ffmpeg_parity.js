import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test, { before } from "node:test"
import { fileURLToPath } from "node:url"

import { createFFmpegArgs, flattenFFArgs } from "../src/transcode/ffmpeg_build.js"
import {
    normalizeCliOptions,
    normalizeDesktopOptions,
    toLegacyArgvOptions,
} from "../src/transcode/ffmpeg_options.js"
import {
    createPublicPlanSnapshot,
    createPublicTaskSnapshot,
} from "../src/transcode/ffmpeg_plan_snapshot.js"
import { prepareFFmpegPlan } from "../src/transcode/ffmpeg_planner.js"
import presets from "../src/transcode/ffmpeg_presets.js"
import { TIERS } from "../src/transcode/hwaccel.js"
import { DEFAULT_PRESET_PATH } from "../src/transcode/preset_loader.js"

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SAMPLE = path.join(PROJECT_ROOT, "data", "videos", "TEST2__mpeg4_avi_480.avi")
const OUTPUT = path.join(PROJECT_ROOT, "temp", "parity-output")
const HAS_VIDEO_FIXTURES = fs.existsSync(SAMPLE)

// ---------------------------------------------------------------------------
// 确定性 fixture：CLI 与 Desktop 两条适配路径必须产出同一份 plan / tasks / argv。
// 任务构建走真实 buildCliTask，仅注入外部依赖（文件系统 / 媒体探测 / 硬件探测），
// 以便在无真实转码的前提下对齐完整快照。
// ---------------------------------------------------------------------------

const SYNTHETIC_SRC = path.join(PROJECT_ROOT, "temp", "parity-fixture", "sample.mp4")
const PRESET_NAME = "h264_2k"

const CPU_TIER = TIERS.find((tier) => tier.name === "cpu")
const HW_PLAN = { tier: CPU_TIER, size: null, caps: {} }

const FIXTURE_INFO = {
    duration: 60,
    bitrate: 5_000_000,
    format: "mov,mp4,m4a,3gp,3g2,mj2",
    video: {
        format: "hevc",
        width: 3840,
        height: 2160,
        bitDepth: 10,
        framerate: 30,
        duration: 60,
        profile: "Main 10",
        pixelFormat: "yuv420p10le",
    },
    audio: { format: "aac", channels: 2, sampleRate: 48000, bitrate: 128_000, duration: 60 },
}

const FIXTURE_DST_ARGS = {
    scaled: false,
    srcDuration: 60,
    srcVideoCodec: "hevc",
    srcAudioCodec: "aac",
}

const noop = () => undefined
const SILENT_LOG = {
    info: noop,
    show: noop,
    showYellow: noop,
    showGray: noop,
    fileLog: noop,
    error: noop,
    logWarn: noop,
    debug: noop,
}

function buildTaskDeps() {
    return {
        fs: {
            pathExists: async () => false,
            stat: async () => ({ size: 4096 }),
        },
        getMediaInfo: async () => structuredClone(FIXTURE_INFO),
        readMusicMeta: async () => ({ format: {}, tags: {} }),
        calculateDstArgs: () => ({ ...FIXTURE_DST_ARGS }),
        createDstBaseName: () => ["sample_2k", "", ""],
        selectPreferredSubtitle: () => null,
        detectHardwareCapabilities: async () => ({ encoders: new Set() }),
        log: SILENT_LOG,
        t: (key) => key,
        createError: (type, message) => Object.assign(new Error(message), { code: type }),
    }
}

function fixtureEntries() {
    return [
        {
            root: path.dirname(SYNTHETIC_SRC),
            path: SYNTHETIC_SRC,
            name: path.basename(SYNTHETIC_SRC),
            size: 4096,
        },
    ]
}

/** CLI/yargs 侧：normalizeCliOptions → legacy argv 投影（与 cmd_ffmpeg 一致） */
function buildCliArgv(mode = "plan") {
    const options = normalizeCliOptions({
        input: SYNTHETIC_SRC,
        output: OUTPUT,
        preset: PRESET_NAME,
        outputMode: "dir",
        decodeMode: "auto",
        override: true,
        strict: false,
        deleteSourceFiles: false,
        doit: mode === "execute",
    })
    return {
        ...toLegacyArgvOptions(options),
        input: SYNTHETIC_SRC,
        output: OUTPUT,
        preset: PRESET_NAME,
    }
}

/** Desktop 侧：normalizeDesktopOptions → legacy argv 投影（与 ffmpeg-service 一致） */
function buildDesktopArgv(mode = "plan") {
    const options = normalizeDesktopOptions({
        inputs: [SYNTHETIC_SRC],
        output: OUTPUT,
        preset: PRESET_NAME,
        mode,
        options: {
            outputMode: "dir",
            decodeMode: "auto",
            override: true,
            strict: false,
            deleteSourceFiles: false,
        },
    })
    return {
        ...toLegacyArgvOptions(options),
        output: OUTPUT,
        preset: PRESET_NAME,
    }
}

/** 影响转码决策的核心 argv 键（排除 input/directories 等宿主 envelope 字段） */
const CORE_ARGV_KEYS = [
    "ffargs",
    "filelist",
    "extensions",
    "include",
    "exclude",
    "regex",
    "start",
    "count",
    "prefix",
    "suffix",
    "dimension",
    "framerate",
    "speed",
    "videoBitrate",
    "videoQuality",
    "videoCopy",
    "videoCodec",
    "audioBitrate",
    "audioQuality",
    "audioCopy",
    "audioCodec",
    "metadata",
    "filters",
    "filterComplex",
    "videoArgs",
    "audioArgs",
    "errorFile",
    "hwaccel",
    "decodeMode",
    "strict",
    "jobs",
    "override",
    "deleteSourceFiles",
    "deleteSourceConfirmed",
    "autoConfirm",
    "output",
    "outputMode",
    "debug",
    "anime",
]

function coreArgv(argv = {}) {
    const picked = {}
    for (const key of CORE_ARGV_KEYS) {
        if (argv[key] !== undefined) picked[key] = argv[key]
    }
    return picked
}

async function prepareBoth(cliMode = "plan", desktopMode = "plan") {
    const cliOptions = buildCliArgv(cliMode)
    const desktopOptions = buildDesktopArgv(desktopMode)
    const cli = await prepareFFmpegPlan({
        entries: fixtureEntries(),
        preset: presets.createFromArgv(cliOptions),
        argv: cliOptions,
        mode: cliMode,
        buildTaskDeps: buildTaskDeps(),
    })
    const desktop = await prepareFFmpegPlan({
        entries: fixtureEntries(),
        preset: presets.createFromArgv(desktopOptions),
        argv: desktopOptions,
        mode: desktopMode,
        buildTaskDeps: buildTaskDeps(),
    })
    return { cli, desktop }
}

before(async () => {
    await presets.initPresetsAsync(DEFAULT_PRESET_PATH)
})

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

test("CLI and desktop adapters produce identical public plan snapshots", async () => {
    const { cli, desktop } = await prepareBoth()

    assert.strictEqual(cli.outcome, "ready")
    assert.strictEqual(desktop.outcome, "ready")

    const cliSnapshot = createPublicPlanSnapshot(cli.plan)
    const desktopSnapshot = createPublicPlanSnapshot(desktop.plan)
    // plan id 由 Date.now() 生成，属于会话标识而非适配器差异，比较前剔除
    assert.deepStrictEqual({ ...cliSnapshot, id: null }, { ...desktopSnapshot, id: null })
    assert.strictEqual(cliSnapshot.totalTasks, 1)
    assert.strictEqual(cliSnapshot.presetName, PRESET_NAME)
    assert.strictEqual(cliSnapshot.mode, "plan")
})

test("CLI and desktop tasks project to identical public task snapshots", async () => {
    const { cli, desktop } = await prepareBoth()

    const project = (prepared) =>
        prepared.tasks.map((task, index) => createPublicTaskSnapshot(task, index))
    const cliTasks = project(cli)
    const desktopTasks = project(desktop)

    assert.strictEqual(cliTasks.length, 1)
    assert.deepStrictEqual(cliTasks, desktopTasks)
    // 内部字段不得经公共投影泄漏
    assert.strictEqual("argv" in cliTasks[0], false)
    assert.strictEqual("preset" in cliTasks[0], false)
    assert.strictEqual("fileDstTemp" in cliTasks[0], false)
})

test("CLI and desktop core argv keys stay structurally aligned", async () => {
    const { cli, desktop } = await prepareBoth()

    assert.deepStrictEqual(coreArgv(cli.tasks[0].argv), coreArgv(desktop.tasks[0].argv))
    // 适配器 envelope 差异应局限于 input 等 CLI 专用键，不得渗入核心参数
    assert.strictEqual(cli.tasks[0].argv.input, SYNTHETIC_SRC)
    assert.strictEqual(desktop.tasks[0].argv.input, undefined)
})

test("CLI dry-run and desktop execution render the same ffmpeg command", async () => {
    const { cli, desktop } = await prepareBoth("plan", "execute")

    const cliCmd = flattenFFArgs(createFFmpegArgs(cli.tasks[0], HW_PLAN).args)
    const desktopCmd = flattenFFArgs(createFFmpegArgs(desktop.tasks[0], HW_PLAN).args)

    assert.ok(cliCmd, "CLI 最终命令不应为空")
    // 防退化守卫：命令必须包含编码器与输入段，避免"两边同时为空的假阳性"
    assert.ok(cliCmd.includes("-c:v"), `命令缺少视频编码段: ${cliCmd}`)
    assert.ok(cliCmd.includes("-i "), `命令缺少输入段: ${cliCmd}`)
    assert.strictEqual(cliCmd, desktopCmd)
    assert.deepStrictEqual(coreArgv(cli.tasks[0].argv), coreArgv(desktop.tasks[0].argv))
    // mode 仅标记执行阶段，不改变核心转码参数
    assert.strictEqual(cli.plan.mode, "plan")
    assert.strictEqual(desktop.plan.mode, "execute")
})
