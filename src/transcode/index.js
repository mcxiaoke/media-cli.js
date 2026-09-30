/*
 * Public facade for the transcode domain.
 *
 * CLI 只能经本模块访问转码能力（见 test/test_architecture_boundaries.js）；
 * 内部模块之间可以互相深导入。
 */
export { default as presets } from "./ffmpeg_presets.js"
export { createFFmpegArgs, flattenFFArgs } from "./ffmpeg_build.js"
export { createFFmpegEngine } from "./ffmpeg_engine.js"
export { normalizeCliOptions, toLegacyArgvOptions } from "./ffmpeg_options.js"
export { deleteCompletedSources, prepareFFmpegPlan } from "./ffmpeg_planner.js"
export { SKIP_REASON } from "./ffmpeg_result.js"
export { LOG_TAG, runFFmpeg, setFFmpegPath } from "./ffmpeg_run.js"
export { scanFFmpegInputs } from "./ffmpeg_scan.js"
export { buildCliTask } from "./ffmpeg_task.js"
export { resolveFFmpegBinary } from "./ffmpeg_bin.js"
export { TIERS } from "./hwaccel.js"
export { detectHardwareCapabilities } from "./hwdetect.js"
