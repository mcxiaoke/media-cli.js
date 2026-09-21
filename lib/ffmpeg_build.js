/**
 * FFmpeg 命令行参数构建模块
 *
 * 包含 ffmpeg 命令行参数的纯构建函数（输入/滤镜/视频/音频/元数据/输出）。
 * 所有函数保持纯函数特性：不修改 entry，不读写外部状态，参数数组只进不出。
 */

/**
 * 将三段 ffmpeg 参数数组展开为一行命令字符串
 *
 * createFFmpegArgs 产出 [inputArgs, middleArgs, outputArgs] 三段数组，
 * 日志与 comment 写回处需要扁平成一行命令，统一走本函数避免各处重复 flat/join。
 * @param {Array<string[]>} ffmpegArgs - [inputArgs, middleArgs, outputArgs]
 * @returns {string|undefined} 拼接后的命令字符串；参数缺失时返回 undefined
 */
export function flattenFFArgs(ffmpegArgs) {
    return ffmpegArgs?.flat()?.join(" ")
}
