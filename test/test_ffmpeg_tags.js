import assert from "node:assert/strict"
import test from "node:test"
import {
    appendSubtitleArgs,
    buildMetaArgs,
    hasMkvStatistics,
    isBitmapSubtitle,
} from "../src/transcode/ffmpeg_tags.js"

test("isBitmapSubtitle detects bitmap subtitle formats", () => {
    assert.strictEqual(isBitmapSubtitle({ format: "hdmv_pgs_subtitle" }), true)
    assert.strictEqual(isBitmapSubtitle({ codec: "pgs" }), true)
    assert.strictEqual(isBitmapSubtitle({ format: "dvd_subtitle" }), true)
    assert.strictEqual(isBitmapSubtitle({ format: "subrip" }), false)
    assert.strictEqual(isBitmapSubtitle({ codec: "ass" }), false)
    assert.strictEqual(isBitmapSubtitle(null), false)
})

test("appendSubtitleArgs handles mkv, mp4 and webm subtitle strategies", () => {
    // 1. MKV uses copy
    const mkvArgs = []
    appendSubtitleArgs({ path: "movie.mkv", fileDst: "out.mkv" }, mkvArgs, { type: "video" })
    assert.ok(mkvArgs.includes("-c:s"))
    assert.ok(mkvArgs.includes("copy"))

    // 2. MP4 with bitmap subtitle drops subtitles with -sn
    const mp4DropArgs = []
    appendSubtitleArgs(
        {
            path: "movie.mp4",
            fileDst: "out.mp4",
            info: { subtitles: [{ codec: "pgs" }] },
        },
        mp4DropArgs,
        { type: "video" },
    )
    assert.ok(mp4DropArgs.includes("-sn"))

    // 3. MP4 with text subtitle uses mov_text
    const mp4TextArgs = []
    appendSubtitleArgs(
        {
            path: "movie.mp4",
            fileDst: "out.mp4",
            info: { subtitles: [{ codec: "subrip" }] },
        },
        mp4TextArgs,
        { type: "video" },
    )
    assert.ok(mp4TextArgs.includes("-c:s"))
    assert.ok(mp4TextArgs.includes("mov_text"))

    // 4. WebM container drops subtitles with -sn
    const webmArgs = []
    appendSubtitleArgs(
        {
            path: "movie.webm",
            fileDst: "out.webm",
            info: { subtitles: [{ codec: "subrip" }] },
        },
        webmArgs,
        { type: "video" },
    )
    assert.ok(webmArgs.includes("-sn"))

    // 5. External subtitle file
    const extArgs = []
    appendSubtitleArgs(
        {
            path: "movie.mkv",
            fileDst: "out.mkv",
            selectedSubtitle: "movie.chi.srt",
        },
        extArgs,
        { type: "video" },
    )
    assert.ok(extArgs.includes("-i"))
    assert.ok(extArgs.includes("movie.chi.srt"))
})

test("hasMkvStatistics detects mkvmerge statistics tags", () => {
    assert.strictEqual(hasMkvStatistics(null), false)
    assert.strictEqual(hasMkvStatistics({ path: "test.mp4" }), false)
    assert.strictEqual(
        hasMkvStatistics({
            path: "test.mkv",
            info: { tags: { _STATISTICS_TAGS: "BPS" } },
        }),
        true,
    )
    assert.strictEqual(
        hasMkvStatistics({
            path: "test.mkv",
            info: { video: { tags: { BPS: "123456" } } },
        }),
        true,
    )
    assert.strictEqual(hasMkvStatistics({ path: "clean.mkv", info: {} }), false)
})

test("buildMetaArgs generates clean title and strips mkv stats when needed", () => {
    // Regular MP4
    const args1 = buildMetaArgs(
        { name: "My.Movie.2026.mp4", path: "My.Movie.2026.mp4" },
        { type: "video" },
    )
    assert.ok(args1.includes("-metadata"))
    assert.ok(args1.includes("title=My.Movie.2026"))
    assert.strictEqual(args1.includes("BPS="), false)

    // MKV with stats
    const args2 = buildMetaArgs(
        {
            name: "sample.mkv",
            path: "sample.mkv",
            hasMkvStats: true,
        },
        { type: "video", audioCopy: true },
    )
    assert.ok(args2.includes("BPS="))
    assert.ok(args2.includes("_STATISTICS_TAGS="))
})
