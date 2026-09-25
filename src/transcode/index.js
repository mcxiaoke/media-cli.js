/*
 * Public compatibility facade for the transcode domain.
 * CLI and desktop integrations must import transcode capabilities from this module.
 */
export { default as presets } from "./ffmpeg_presets.js"
export { createFFmpegArgs, flattenFFArgs } from "./ffmpeg_build.js"
export { createFFmpegEngine } from "./ffmpeg_engine.js"
export {
    normalizeCliOptions,
    normalizeDesktopOptions,
    toLegacyArgvOptions,
} from "./ffmpeg_options.js"
export { createPublicPlanSnapshot, createPublicTaskSnapshot } from "./ffmpeg_plan_snapshot.js"
export { deleteCompletedSources, prepareFFmpegPlan } from "./ffmpeg_planner.js"
export { SKIP_REASON } from "./ffmpeg_result.js"
export { LOG_TAG, runFFmpeg, setFFmpegPath } from "./ffmpeg_run.js"
export { collectInputFiles, scanDesktopInputFiles, scanFFmpegInputs } from "./ffmpeg_scan.js"
export { buildCliTask } from "./ffmpeg_task.js"
export { resolveFFmpegBinary, resolveFFprobeBinary } from "./ffmpeg_bin.js"
// 媒体元数据探测是转码前置能力，统一经 facade 暴露，避免宿主直连 legacy lib/
export { getMediaInfo } from "../../lib/mediainfo.js"
export { TIERS } from "./hwaccel.js"
export { detectHardwareCapabilities } from "./hwdetect.js"
