/*
 * Public compatibility facade for the transcode domain.
 * CLI and desktop integrations must import transcode capabilities from this module.
 */
export { default as presets } from "./ffmpeg_presets.js"
export { createFFmpegArgs, flattenFFArgs } from "./ffmpeg_build.js"
export { createFFmpegEngine } from "./ffmpeg_engine.js"
export { normalizeCliOptions, normalizeWebOptions, toLegacyArgvOptions } from "./ffmpeg_options.js"
export { createPublicPlanSnapshot } from "./ffmpeg_plan_snapshot.js"
export { deleteCompletedSources, prepareFFmpegPlan } from "./ffmpeg_planner.js"
export { SKIP_REASON } from "./ffmpeg_result.js"
export { LOG_TAG, runFFmpeg, setFFmpegPath } from "./ffmpeg_run.js"
export { collectInputFiles, scanFFmpegInputs, scanWebInputFiles } from "./ffmpeg_scan.js"
export { buildCliTask } from "./ffmpeg_task.js"
export { resolveFFmpegBinary, resolveFFprobeBinary } from "./ffmpeg_bin.js"
export { TIERS } from "./hwaccel.js"
export { detectHardwareCapabilities } from "./hwdetect.js"
