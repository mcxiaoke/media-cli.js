/**
 * 已知 FFmpeg 参数词表
 *
 * - KNOWN_FFMPEG_ARGS：常见参数名，作参考/未来可选的未知参数提示（当前不强制拦截）。
 * - ENCODER_SPECIFIC_ARGS：编码器专属参数，用于 --video-args 追加时的启发式告警（见文件末尾）。
 *
 * 定稿（2026-09-22）：--arg 位置标记机制已整体移除，改由 --video-args/--audio-args/
 * --filters 追加语义 + --metadata 承载高级自定义；原 parseArgOptions/validateArgMarker 已删除。
 */

export const KNOWN_FFMPEG_ARGS = new Set([
    // 全局选项
    "-y",
    "-n",
    "-nostats",
    "-benchmark",
    "-hide_banner",
    "-loglevel",
    "-report",
    "-init_hw_device",
    "-filter_hw_device",
    // 输入选项
    "-ss",
    "-t",
    "-to",
    "-f",
    "-r",
    "-ar",
    "-ac",
    "-hwaccel",
    "-hwaccel_device",
    "-itsoffset",
    "-stream_loop",
    "-thread_queue_size",
    // 输出-流级
    "-c:v",
    "-c:a",
    "-c:s",
    "-b:v",
    "-b:a",
    "-crf",
    "-preset",
    "-tune",
    "-g",
    "-bf",
    "-pix_fmt",
    "-q",
    "-q:a",
    "-vcodec",
    "-acodec",
    "-scodec",
    "-profile:v",
    "-level",
    "-rc",
    "-rc_lookahead",
    // 输出-容器级
    "-movflags",
    "-metadata",
    "-tag:v",
    "-tag:a",
    "-disposition",
    "-shortest",
    "-dn",
    // 滤镜
    "-vf",
    "-af",
    "-filter_complex",
    "-filter:v",
    "-filter:a",
    "-lavfi",
    // 高级
    "-map",
    "-map_metadata",
    "-codec",
    "-vbsf",
    "-absf",
    "-pass",
    "-passlogfile",
    // 硬件加速（NVENC）
    "-spatial_aq",
    "-temporal_aq",
    "-cbr",
    "-constqp",
    "-cq",
    "-qp",
    "-b_ref_mode",
    "-surfaces",
    // 硬件加速（QSV）
    "-look_ahead",
    "-extbrc",
    "-rdo",
    "-mbbrc",
    "-adaptive_i",
    "-adaptive_b",
    "-async_depth",
    // 硬件加速（AMF）
    "-quality",
    "-header_insertion_spacing",
    "-vbaq",
    "-preanalysis",
    "-enforce_hrd",
    "-max_au_size",
    // 音频
    "-vol",
    "-sample_fmt",
    "-channel_layout",
    "-afade",
    "-atrim",
    // 字幕
    "-sn",
    "-fix_sub_duration",
    "-canvas_size",
    // 其他常用
    "-maxrate",
    "-bufsize",
    "-minrate",
    "-x264opts",
    "-x265opts",
    "-svtav1-params",
    "-svt_vp9_params",
])

/**
 * 编码器专属参数（启发式告警词表，非穷举）
 *
 * 用途：用户通过 `--video-args` 追加这些 token 时，若处于 `auto` 分层，
 * 提示"这些参数只有特定编码器实现才认（NVENC/QSV/AMF/x264 语义与取值域各异），
 * 换到其它层可能导致真实编码报错、或被失败重试静默拽回 CPU"。
 * 只用于 warn，不阻断执行——"用户自己加，自己负责"（定稿 §4）。
 *
 * 注意：`-preset` 三家编码器都存在但取值域不同（x264=ultrafast~placebo，
 * NVENC=p1~p7，QSV 另有其值），同样纳入告警。
 */
export const ENCODER_SPECIFIC_ARGS = new Set([
    "-tune",
    "-spatial_aq",
    "-temporal_aq",
    "-global_quality",
    "-cq",
    "-qp",
    "-qp_i",
    "-qp_p",
    "-constqp",
    "-cbr",
    "-rc",
    "-rc_lookahead",
    "-extbrc",
    "-look_ahead",
    "-look_ahead_depth",
    "-b_ref_mode",
    "-surfaces",
    "-weighted_pred",
    "-quality",
    "-vbaq",
    "-preset",
])
