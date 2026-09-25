import assert from "assert"
import test from "node:test"
import {
    createInternalExecutionPlan,
    createPublicPlanSnapshot,
    createPublicTaskSnapshot,
} from "../src/transcode/ffmpeg_plan_snapshot.js"

const MEDIA_INFO = {
    format: "mp4",
    duration: 10.5,
    bitrate: 1583002,
    video: {
        format: "hevc",
        codec: "hevc",
        profile: "Main 10",
        level: "123",
        width: 1920,
        height: 1080,
        aspectRatio: "16:9",
        framerate: 23.976,
        pixelFormat: "yuv420p10le",
        bitDepth: 10,
        bitrate: 1500000,
    },
    audio: {
        format: "aac",
        channels: 2,
        sampleRate: 48000,
        bitrate: 128000,
    },
}

const STAGED_ENTRY = {
    id: "task_abc123",
    name: "movie.mp4",
    path: "C:/media/movie.mp4",
    size: 1024,
    duration: 10.5,
    fileDst: "",
    status: "staged",
    containerFormat: "MP4",
    mediaInfo: MEDIA_INFO,
}

test("createPublicTaskSnapshot projects a complete staged entry snapshot", () => {
    const snap = createPublicTaskSnapshot(STAGED_ENTRY, 0)
    assert.strictEqual(snap.id, "task_abc123")
    assert.strictEqual(snap.index, 0)
    assert.strictEqual(snap.name, "movie.mp4")
    assert.strictEqual(snap.path, "C:/media/movie.mp4")
    assert.strictEqual(snap.size, 1024)
    assert.strictEqual(snap.duration, 10.5)
    assert.strictEqual(snap.fileDst, "")
    assert.strictEqual(snap.status, "staged")
    assert.strictEqual(snap.error, null)
    assert.strictEqual(snap.skipReason, null)
    assert.strictEqual(snap.containerFormat, "MP4")
    assert.strictEqual(snap.videoCodec, "hevc")
    assert.strictEqual(snap.audioCodec, "aac")
    assert.strictEqual(snap.width, 1920)
    assert.strictEqual(snap.height, 1080)
    assert.strictEqual(snap.fps, 23.976)
    assert.strictEqual(snap.bitrate, 1583002)
    assert.strictEqual(snap.srcSize, 1024)
    assert.strictEqual(snap.srcDuration, 10.5)
    assert.strictEqual(snap.bitDepth, 10)
    assert.strictEqual(snap.pixelFormat, "yuv420p10le")
    assert.strictEqual(snap.profile, "Main 10")
    assert.strictEqual(snap.level, "123")
    assert.strictEqual(snap.aspectRatio, "16:9")
    assert.strictEqual(snap.audioChannels, 2)
    assert.strictEqual(snap.audioSampleRate, 48000)
    assert.strictEqual(snap.audioBitrate, 128000)
    assert.strictEqual(snap.progress, 0)
    assert.strictEqual(snap.speed, 0)
    assert.strictEqual(snap.rawMetadata, JSON.stringify(MEDIA_INFO, null, 2))
})

test("public task snapshot never leaks internal fields", () => {
    const snap = createPublicTaskSnapshot(
        {
            ...STAGED_ENTRY,
            argv: { videoQuality: 23 },
            preset: { name: "hevc_2k" },
            fileDstTemp: "C:/media/movie_tmp@123@tmp_.mp4",
            hwPlan: { tier: "nvidia" },
            dstArgs: ["-c:v", "libx265"],
            subtitles: ["C:/media/movie.srt"],
        },
        1,
    )
    for (const key of ["argv", "preset", "fileDstTemp", "hwPlan", "dstArgs", "subtitles", "info"]) {
        assert.ok(!(key in snap), `must not leak ${key}`)
    }
})

test("default status falls back to pending unless explicitly provided", () => {
    const pending = createPublicTaskSnapshot({ name: "a.mp4", path: "C:/a.mp4" }, 0, "pending")
    assert.strictEqual(pending.status, "pending")
    const staged = createPublicTaskSnapshot(
        { name: "a.mp4", path: "C:/a.mp4", status: "staged" },
        1,
        "pending",
    )
    assert.strictEqual(staged.status, "staged")
})

test("staged entry and plan task project identical metadata", () => {
    const fromStaged = createPublicTaskSnapshot(STAGED_ENTRY, 0)
    const planTask = {
        id: "task_plan1",
        name: "movie.mp4",
        path: "C:/media/movie.mp4",
        size: 1024,
        duration: 10.5,
        fileDst: "C:/out/movie.mp4",
        status: "pending",
        info: MEDIA_INFO,
    }
    const fromPlan = createPublicTaskSnapshot(planTask, 0)
    for (const field of [
        "videoCodec",
        "audioCodec",
        "width",
        "height",
        "fps",
        "bitrate",
        "srcSize",
        "srcDuration",
        "bitDepth",
        "pixelFormat",
        "profile",
        "level",
        "aspectRatio",
        "audioChannels",
        "audioSampleRate",
        "audioBitrate",
    ]) {
        assert.strictEqual(fromPlan[field], fromStaged[field], `field ${field} mismatch`)
    }
    assert.strictEqual(fromPlan.rawMetadata, fromStaged.rawMetadata)
})

test("internal done always projects to public success", () => {
    const done = createPublicTaskSnapshot({ ...STAGED_ENTRY, status: "done" }, 0, "pending")
    assert.strictEqual(done.status, "success")
    const plan = createPublicPlanSnapshot(
        createInternalExecutionPlan({
            tasks: [{ ...STAGED_ENTRY, status: "done" }],
        }),
    )
    assert.strictEqual(plan.tasks[0].status, "success")
})

test("createPublicPlanSnapshot reuses the unified task projection", () => {
    const internal = createInternalExecutionPlan({
        id: "plan_x",
        presetName: "hevc_2k",
        mode: "plan",
        tasks: [{ ...STAGED_ENTRY, status: "pending" }],
        totalDuration: 10.5,
        totalSize: 1024,
    })
    const publicPlan = createPublicPlanSnapshot(internal)
    assert.strictEqual(publicPlan.totalTasks, 1)
    assert.strictEqual(publicPlan.tasks[0].id, "task_abc123")
    assert.strictEqual(publicPlan.tasks[0].videoCodec, "hevc")
    assert.strictEqual(publicPlan.tasks[0].status, "pending")
    assert.ok(!("argv" in publicPlan))
    assert.ok(!("preset" in publicPlan))
    assert.ok(!("fileDstTemp" in publicPlan.tasks[0]))
})
