import chalk from "chalk"
import fs from "fs-extra"
import path from "path"
import { createError, ErrorTypes } from "./errors.js"
import * as log from "./debug.js"
import {
    calculateDstArgs,
    createDstBaseName,
    getEntryShowInfo,
    readMusicMeta,
    selectPreferredSubtitle,
} from "./ffmpeg_plan.js"
import { getMediaInfo } from "./mediainfo.js"
import { detectHardwareCapabilities } from "./hwdetect.js"
import { t } from "./i18n.js"
import * as helper from "./helper.js"

/**
 * 构建一个 WebUI/共享任务层使用的媒体任务条目。
 *
 * 这是第一阶段的最小可测试 seam：只移动任务构建，不改变 CLI 的
 * prepareFFmpegCmd 业务。后续 Engine 会在此基础上统一 CLI 与 GUI。
 *
 * @param {object} input
 * @param {object} options
 * @returns {Promise<object|null>}
 */
export async function buildTask(
    input,
    {
        index,
        total,
        activePreset,
        argv,
        output = "",
        fsApi = fs,
        getMediaInfo: mediaInfo = getMediaInfo,
        calculate = calculateDstArgs,
        createBaseName = createDstBaseName,
        chooseSubtitle = selectPreferredSubtitle,
        textHash = helper.textHash,
        signal = null,
    },
) {
    const info = await mediaInfo(input.path, { signal })
    const isAudio = activePreset.type === "audio"
    const ivideo = info?.video
    const iaudio = info?.audio
    const duration = info?.duration || ivideo?.duration || iaudio?.duration || 0

    if (isAudio && !iaudio) return null
    if (!isAudio && !ivideo) return null

    const entry = {
        index,
        total,
        path: input.path,
        name: input.name,
        size: input.size,
        info,
        preset: activePreset,
        argv,
        duration,
    }

    entry.dstArgs = calculate(entry)

    const srcDir = path.dirname(input.path)
    const srcBase = path.parse(input.name).name
    const dstDir = output ? path.resolve(output) : srcDir
    const [fileDstBase] = createBaseName(entry)
    const dstExt = activePreset.format || path.extname(input.name) || ".mp4"
    const fileDst = path.join(dstDir, `${fileDstBase}${dstExt}`)
    const fileDstTemp = path.join(
        dstDir,
        `${fileDstBase}_tmp@${textHash(input.path)}@tmp_${dstExt}`,
    )

    const subExts = [".ass", ".ssa", ".srt"]
    const subtitles = []
    for (const ext of subExts) {
        const subPath = path.join(srcDir, `${srcBase}${ext}`)
        if (await fsApi.pathExists(subPath)) subtitles.push(subPath)
    }

    return {
        ...entry,
        fileDstDir: dstDir,
        fileDst,
        fileDstTemp,
        subtitles,
        selectedSubtitle: chooseSubtitle(subtitles),
        status: "pending",
    }
}

/**
 * Build one CLI task. This is the injectable equivalent of the former
 * private prepareFFmpegCmd implementation in cmd/cmd_ffmpeg.js.
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
            return false
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
                return false
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
            return false
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
            return false
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
                return {
                    ...entry,
                    dstExists: true,
                    dstExistsPath: fileDst,
                    dstExistsSize: existSize,
                }
            }
            logger.showGray(logTag, `${ipx} Override: <${helper.pathShort(fileDst)}>`)
        }

        if (!argv.output && (prefix || suffix) && (await fsApi.pathExists(fileDstSameDir))) {
            if (!argv.override) {
                logger.showYellow(
                    logTag,
                    `${ipx} Skip[Dst2]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                return { ...entry, dstExists: true }
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
            return false
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
                    return false
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
            return false
        }
        logger.error(logTag, `${ipx} Skip[Error]: ${entry.path}`, error?.message || error)
        logger.fileLog(`${ipx} Skip[Error]: <${entry.path}> ${error?.message || error}`, "Prepare")
        return false
    }
}
