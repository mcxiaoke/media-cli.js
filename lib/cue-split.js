/*
 * Project: mediac
 * Created: 2024-04-16 19:15:41
 * Modified: 2024-04-16 19:15:41
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
// cue-splitter.mjs

import dayjs from "dayjs" // 使用 Day.js 库来获取当前日期和时间
import { execa } from "execa"
import fs from "fs-extra"
import path from "path"
import { CueParser } from "./cue-parse.js"
import * as log from "./debug.js"

const forbiddenCharsRegex = /[<>:"\/\\|?*\x00-\x1F]/g

export async function splitAudioByCue(cueFilePath, audioFilePath, outputDir) {
    let logStream
    const cueInfo = {
        REM: [],
        TITLE: "",
        CATALOG: "",
        FILE: "",
        TRACKS: [],
    }

    try {
        // 验证输入文件
        if (!(await fs.pathExists(cueFilePath))) {
            const { createError } = await import("./errors.js")
            throw createError("FILE_NOT_FOUND", `CUE 文件不存在: ${cueFilePath}`)
        }

        if (!(await fs.pathExists(audioFilePath))) {
            const { createError } = await import("./errors.js")
            throw createError("FILE_NOT_FOUND", `音频文件不存在: ${audioFilePath}`)
        }

        const cueParser = new CueParser(cueFilePath)
        Object.assign(cueInfo, await cueParser.parse())

        const logFileName = `cue-splitter-log-${dayjs().format("YYYYMMDDTHHmmss")}.txt`
        const logFilePath = path.join(path.dirname(cueFilePath), logFileName)
        logStream = fs.createWriteStream(logFilePath, { flags: "a" })

        for (let i = 0; i < cueInfo.TRACKS.length; i++) {
            const track = cueInfo.TRACKS[i]
            const startTime = i === 0 ? 0 : track.START
            const endTime = i === 0 ? cueInfo.TRACKS[i + 1].START : track.END
            const duration = endTime - startTime
            const sanitizedTitle = sanitizeFileName(
                `${track.PERFORMER} - ${track.TITLE} (${cueInfo.TITLE})`,
            )
            // todo 检测文件是否存在，跳过
            const outputFileName = `${outputDir}/${sanitizedTitle}.${path.extname(audioFilePath)}`
            const tempOutputFileName = `${outputDir}/tmp_${sanitizedTitle}.${path.extname(audioFilePath)}`
            const metadata = `-metadata title="${track.TITLE}" -metadata artist="${track.PERFORMER}" -metadata album="${cueInfo.TITLE}" -metadata track="${track.trackNo}"`

            // 使用 execa 安全地执行 FFmpeg 命令，避免命令注入风险
            const ffmpegArgs = [
                "-i",
                audioFilePath,
                "-ss",
                startTime.toString(),
                "-t",
                duration.toString(),
            ]

            // 添加元数据
            if (track.TITLE) ffmpegArgs.push("-metadata", `title=${track.TITLE}`)
            if (track.PERFORMER) ffmpegArgs.push("-metadata", `artist=${track.PERFORMER}`)
            if (cueInfo.TITLE) ffmpegArgs.push("-metadata", `album=${cueInfo.TITLE}`)
            if (track.trackNo) ffmpegArgs.push("-metadata", `track=${track.trackNo}`)

            // 如果原始格式是 WAV，则保持为 PCM 格式
            if (path.extname(audioFilePath).toLowerCase() === ".wav") {
                ffmpegArgs.push("-c:a", "pcm_s16le")
            }

            ffmpegArgs.push(tempOutputFileName)

            try {
                await executeCommand("ffmpeg", ffmpegArgs)

                await fs.rename(tempOutputFileName, outputFileName)

                const trackFileStats = await fs.stat(outputFileName)
                cueInfo.TRACKS[i].FILE_PATH = outputFileName
                cueInfo.TRACKS[i].FILE_SIZE = trackFileStats.size
            } catch (error) {
                // 使用新的错误处理系统
                const { handleError } = await import("./errors.js")
                const result = await handleError(error, {
                    trackNo: track.trackNo,
                    trackTitle: track.TITLE,
                    operation: "split_audio",
                })

                const errorMessage = `Error splitting track ${track.trackNo}: ${error.message}`
                log.error(errorMessage)
                logStream.write(`${errorMessage}\n`)
                cueInfo.TRACKS[i].ERROR = errorMessage

                // 如果错误不可恢复，跳过当前轨道继续处理
                if (!result.recoverable || result.action === "skip") {
                    continue
                }
            }
        }

        return cueInfo
    } catch (error) {
        // 使用新的错误处理系统
        const { handleError } = await import("./errors.js")
        await handleError(error, {
            cueFilePath,
            audioFilePath,
            outputDir,
            operation: "split_audio_by_cue",
        })

        log.error("Error splitting audio by CUE:", error)
        cueInfo.ERROR = error.message || "Unknown error occurred"
        return cueInfo
    } finally {
        if (logStream) {
            logStream.end()
        }
    }
}

async function executeCommand(command, args = []) {
    try {
        const result = await execa(command, args, {
            shell: false, // 禁用 shell 模式，提高安全性
            cleanup: true,
        })
        return result.stdout
    } catch (error) {
        // 使用新的错误处理系统
        const { createError } = await import("./errors.js")
        throw createError("FFMPEG_ERROR", `FFmpeg 执行失败: ${error.message}`, error, "ERROR")
    }
}

function sanitizeFileName(fileName) {
    return fileName.replace(forbiddenCharsRegex, "")
}
