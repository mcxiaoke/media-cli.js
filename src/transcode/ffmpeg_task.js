import chalk from "chalk"
import fs from "fs-extra"
import path from "path"
import { createError, ErrorTypes } from "../../lib/errors.js"
import { SKIP_REASON } from "./ffmpeg_result.js"
import * as log from "../../lib/debug.js"
import {
    calculateDstArgs,
    createDstBaseName,
    getEntryShowInfo,
    readMusicMeta,
    selectPreferredSubtitle,
} from "./ffmpeg_plan.js"
import { getMediaInfo } from "../../lib/mediainfo.js"
import { detectHardwareCapabilities } from "./hwdetect.js"
import { t } from "../../lib/i18n.js"
import * as helper from "../../lib/helper.js"

/**
 * 构建单个 CLI 媒体任务条目：探测媒体信息 → 计算目标参数 → 决定目标路径与字幕。
 *
 * 这是原 cmd/cmd_ffmpeg.js 私有 prepareFFmpegCmd 的可注入实现：planner 注入
 * fs / 媒体探测 / 硬件探测 / 日志 / 翻译实现，测试与重试路径共用同一套业务。
 */
export async function buildCliTask(entry, deps = {}) {
    const fsApi = deps.fs || fs
    const mediaInfo = deps.getMediaInfo || getMediaInfo
    const readMusic = deps.readMusicMeta || readMusicMeta
    const calculate = deps.calculateDstArgs || calculateDstArgs
    const createBaseName = deps.createDstBaseName || createDstBaseName
    const chooseSubtitle = deps.selectPreferredSubtitle || selectPreferredSubtitle
    const detectCaps = deps.detectHardwareCapabilities || detectHardwareCapabilities
    const logger = deps.log || log
    const translate = deps.t || t
    const makeError = deps.createError || ((type, message) => createError(type, message))
    const signal = deps.signal || entry.signal || null
    const skipped = (reason, extra = {}) => ({
        ...entry,
        status: "skipped",
        skipReason: reason,
        ...extra,
    })

    const preset = entry.preset
    const argv = entry.argv || {}
    let logTag = chalk.green(`Prepare[${(argv.decodeMode || "auto").toUpperCase()}]`)
    if (entry.retryOnFailed) {
        logTag += chalk.red("(R)")
    }
    const ipx = `${entry.index + 1}/${entry.total}`
    logger.info(logTag, `Processing(${ipx}) file: ${entry.path}`)
    const isAudio = helper.isAudioFile(entry.path)
    const [srcDir, srcBase, srcExt] = helper.pathSplit(entry.path)
    const dstExt = preset.format || srcExt
    let fileDstDir

    if (argv.output) {
        switch (argv.outputMode || "dir") {
            case "tree":
                fileDstDir = helper.pathRewrite(entry.root, srcDir, preset.output)
                break
            case "file":
                fileDstDir = path.resolve(preset.output)
                break
            case "dir":
                fileDstDir = path.join(preset.output, path.basename(srcDir))
                break
            default:
                throw makeError(
                    ErrorTypes.INVALID_ARGUMENT,
                    translate("ffmpeg.error.unknownOutputMode", { mode: argv.outputMode }),
                )
        }
    } else {
        fileDstDir = path.resolve(srcDir)
    }

    try {
        entry.info = await mediaInfo(entry.path, { signal })

        if (!(entry.info?.duration && entry.info?.bitrate)) {
            logger.showYellow(
                logTag,
                `${ipx} Skip[BadFormat]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            logger.fileLog(
                `${ipx} Skip[BadFormat]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                "Prepare",
            )
            return skipped(SKIP_REASON.BAD_FORMAT)
        }

        const audioCodec = entry.info?.audio?.format
        const videoCodec = entry.info?.video?.format
        if (isAudio) {
            const meta = await readMusic(entry)
            entry.format = meta?.format
            entry.tags = meta?.tags
            logger.info(entry.name, preset.name)
            if (!(entry.format?.bitrate || entry.info?.audio?.bitrate || entry.info?.bitrate)) {
                logger.showYellow(
                    logTag,
                    `${ipx} Skip[Invalid]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                logger.fileLog(
                    `${ipx} Skip[Invalid]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                    "Prepare",
                )
                return skipped(SKIP_REASON.INVALID_AUDIO)
            }
        }

        const dstArgs = calculate(entry)
        let newEntry = { ...entry, dstArgs }
        logger.info(logTag, entry.path, dstArgs)

        if (entry.preset.type === "audio" && !audioCodec) {
            logger.showYellow(
                logTag,
                `${ipx} Skip[NoAudio]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            logger.fileLog(
                `${ipx} Skip[NoAudio]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                "Prepare",
            )
            return skipped(SKIP_REASON.MISSING_AUDIO)
        }
        if (entry.preset.type === "video" && !videoCodec) {
            logger.showYellow(
                logTag,
                `${ipx} Skip[NoVideo]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            logger.fileLog(
                `${ipx} Skip[NoVideo]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                "Prepare",
            )
            return skipped(SKIP_REASON.MISSING_VIDEO)
        }

        const [fileDstBase, prefix, suffix] = createBaseName(newEntry)
        const fileDstName = `${fileDstBase}${dstExt}`
        const fileDst = path.join(fileDstDir, fileDstName)
        const tempSuffix = `_tmp@${helper.textHash(entry.path)}@tmp_`
        const fileDstTemp = path.join(fileDstDir, `${fileDstBase}${tempSuffix}${dstExt}`)
        const fileDstSameDir = path.join(srcDir, fileDstName)

        if (await fsApi.pathExists(fileDst)) {
            const existSt = await fsApi.stat(fileDst).catch(() => null)
            const existSize = existSt?.size || 0
            if (!argv.override) {
                logger.showYellow(
                    logTag,
                    `${ipx} Skip[Dst1]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                return skipped(SKIP_REASON.DESTINATION_EXISTS, {
                    dstExists: true,
                    dstExistsPath: fileDst,
                    dstExistsSize: existSize,
                })
            }
            logger.showGray(logTag, `${ipx} Override: <${helper.pathShort(fileDst)}>`)
        }

        if (!argv.output && (prefix || suffix) && (await fsApi.pathExists(fileDstSameDir))) {
            const existSt = await fsApi.stat(fileDstSameDir).catch(() => null)
            const existSize = existSt?.size || 0
            if (!argv.override) {
                logger.showYellow(
                    logTag,
                    `${ipx} Skip[Dst2]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                return skipped(SKIP_REASON.DESTINATION_EXISTS, {
                    dstExists: true,
                    dstExistsPath: fileDstSameDir,
                    dstExistsSize: existSize,
                })
            }
            logger.showGray(logTag, `${ipx} Override: <${helper.pathShort(fileDstSameDir)}>`)
        }

        const ivideo = newEntry.info?.video
        const iaudio = newEntry.info?.audio
        const duration = newEntry.info?.duration || ivideo?.duration || iaudio?.duration || 0
        if (duration < 1) {
            logger.showYellow(
                logTag,
                `${ipx} Skip[Short]: ${entry.path} (${helper.humanSize(entry.size)}) Duration=${duration}s)`,
            )
            return skipped(SKIP_REASON.SHORT_DURATION)
        }

        const targetAudioCodec = preset.userArgs?.audioCodec || preset.audioCodec || "aac"
        if (argv.strict && targetAudioCodec && targetAudioCodec !== "copy") {
            try {
                const caps = await detectCaps({ signal })
                const encoders = caps?.encoders
                if (encoders && encoders.size > 0 && !encoders.has(targetAudioCodec)) {
                    const why = `audio encoder "${targetAudioCodec}" not available in this ffmpeg build`
                    logger.showYellow(logTag, `${ipx} Skip[StrictCodec] <${entry.path}> (${why})`)
                    logger.fileLog(
                        `${ipx} Skip[StrictCodec] <${entry.path}> [${preset.name}] ${why}`,
                        "Prepare",
                    )
                    return skipped(SKIP_REASON.STRICT_CODEC)
                }
            } catch (err) {
                logger.logWarn(logTag, `codec precheck skipped for ${entry.path}: ${err.message}`)
            }
        }

        const subExts = [".ass", ".ssa", ".srt"]
        const subtitles = []
        for (const ext of subExts) {
            const sub1 = path.join(srcDir, `${srcBase}${ext}`)
            const sub2 = path.join(srcDir, "subs", `${srcBase}${ext}`)
            if (await fsApi.pathExists(sub1)) subtitles.push(sub1)
            if (await fsApi.pathExists(sub2)) subtitles.push(sub2)
        }
        const selectedSubtitle = chooseSubtitle(subtitles)
        const codecInfo = isAudio
            ? `${iaudio?.format}(${iaudio?.sampleRate},${iaudio?.bitrate},${iaudio.duration})`
            : `${ivideo?.format}(${ivideo?.profile}@${ivideo?.level},${ivideo?.bitDepth})`
        logger.show(
            logTag,
            chalk.cyan(`${ipx} SRC`),
            chalk.yellow(argv.decodeMode === "cpu" ? `SW` : `HW`),
            `"${helper.pathShort(entry.path, 80)}"`,
            selectedSubtitle ? `(SUB:${path.basename(selectedSubtitle)})` : "",
            codecInfo,
            helper.humanSize(entry.size),
            chalk.yellow(entry.preset.name),
            helper.humanTime(entry.startMs),
        )
        logger.showGray(logTag, `${ipx} DST`, fileDst)
        logger.showGray(logTag, `${ipx}`, getEntryShowInfo(newEntry))
        newEntry = {
            ...newEntry,
            fileDstDir,
            fileDstBase,
            fileDst,
            fileDstTemp,
            subtitles,
            selectedSubtitle,
        }
        return newEntry
    } catch (error) {
        if (error?.name === "StrictModeError" || error?.code?.startsWith?.("STRICT_")) {
            logger.showYellow(
                logTag,
                `${ipx} Skip[Strict] <${entry.path}> (${error?.message || error})`,
            )
            logger.fileLog(
                `${ipx} Skip[Strict] <${entry.path}> [${preset?.name}] ${error?.message || error}`,
                "Prepare",
            )
            return skipped(SKIP_REASON.STRICT_MODE)
        }
        logger.error(logTag, `${ipx} Skip[Error]: ${entry.path}`, error?.message || error)
        logger.fileLog(`${ipx} Skip[Error]: <${entry.path}> ${error?.message || error}`, "Prepare")
        return skipped(SKIP_REASON.PREPARE_ERROR)
    }
}
