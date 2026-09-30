import assert from "node:assert/strict"
import path from "node:path"
import test, { before } from "node:test"
import { fileURLToPath } from "node:url"

import { createFFmpegArgs, flattenFFArgs } from "../src/transcode/ffmpeg_build.js"
import { normalizeCliOptions, toLegacyArgvOptions } from "../src/transcode/ffmpeg_options.js"
import { prepareFFmpegPlan } from "../src/transcode/ffmpeg_planner.js"
import presets from "../src/transcode/ffmpeg_presets.js"
import { TIERS } from "../src/transcode/hwaccel.js"
import { DEFAULT_PRESET_PATH } from "../src/transcode/preset_loader.js"

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// ---------------------------------------------------------------------------
// 确定性 fixture：从 CLI 选项一路走到最终 ffmpeg 命令行，只注入外部依赖
// （文件系统 / 媒体探测 / 硬件探测），无需真实转码与真实素材。
// ---------------------------------------------------------------------------

const SYNTHETIC_SRC = path.join(PROJECT_ROOT, "temp", "parity-fixture", "sample.mp4")
const OUTPUT = path.join(PROJECT_ROOT, "temp", "parity-output")
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

async function prepareCli(mode = "plan") {
    const argv = buildCliArgv(mode)
    return prepareFFmpegPlan({
        entries: fixtureEntries(),
        preset: presets.createFromArgv(argv),
        argv,
        mode,
        buildTaskDeps: buildTaskDeps(),
    })
}

before(async () => {
    await presets.initPresetsAsync(DEFAULT_PRESET_PATH)
})

test("CLI plan preparation yields one ready task from a single input", async () => {
    const prepared = await prepareCli()

    assert.strictEqual(prepared.outcome, "ready")
    assert.strictEqual(prepared.plan.presetName, PRESET_NAME)
    assert.strictEqual(prepared.plan.mode, "plan")
    assert.strictEqual(prepared.plan.tasks.length, 1)
    assert.strictEqual(prepared.plan.tasks[0].path, SYNTHETIC_SRC)
    assert.strictEqual(prepared.plan.tasks[0].id, "task-0")
    // mode=plan 是 dry-run：绝不能出现删除源文件意图
    assert.notStrictEqual(prepared.plan.argv.deleteSourceFiles, true)
})

test("CLI dry-run renders the expected ffmpeg command", async () => {
    const prepared = await prepareCli()

    const cmd = flattenFFArgs(createFFmpegArgs(prepared.plan.tasks[0], HW_PLAN).args)
    // 防退化守卫：命令必须包含编码段与输入段，避免"命令为空的假阳性"
    assert.ok(cmd.includes("-c:v"), `命令缺少视频编码段: ${cmd}`)
    assert.ok(cmd.includes("-i "), `命令缺少输入段: ${cmd}`)
    assert.ok(cmd.includes(SYNTHETIC_SRC), `命令缺少输入路径: ${cmd}`)
})

test("dry-run and execute modes render the same core transcode arguments", async () => {
    const [dryRun, execute] = await Promise.all([prepareCli("plan"), prepareCli("execute")])

    assert.strictEqual(dryRun.plan.mode, "plan")
    assert.strictEqual(execute.plan.mode, "execute")

    const dryCmd = flattenFFArgs(createFFmpegArgs(dryRun.plan.tasks[0], HW_PLAN).args)
    const execCmd = flattenFFArgs(createFFmpegArgs(execute.plan.tasks[0], HW_PLAN).args)
    // mode 仅标记执行阶段，不改变核心转码参数
    assert.strictEqual(dryCmd, execCmd)
})
