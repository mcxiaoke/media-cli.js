/*
 * Project: mediac
 * Created: 2024-04-16 19:15:41
 * Modified: 2024-04-16 19:15:41
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
// cue-splitter.mjs

import { exec } from 'child_process'
import dayjs from 'dayjs' // 使用 Day.js 库来获取当前日期和时间
import fs from 'fs-extra'
import path from 'path'
import { CueParser } from './cue-parse.js'

const forbiddenCharsRegex = /[<>:"\/\\|?*\x00-\x1F]/g

export async function splitAudioByCue(cueFilePath, audioFilePath, outputDir) {
    let logStream
    const cueInfo = {
        REM: [],
        TITLE: '',
        CATALOG: '',
        FILE: '',
        TRACKS: []
    }
    try {
        const cueParser = new CueParser(cueFilePath)
        Object.assign(cueInfo, await cueParser.parse())

        if (!await fs.pathExists(audioFilePath)) {
            throw new Error('Audio file does not exist.')
        }

        const logFileName = `cue-splitter-log-${dayjs().format('YYYYMMDDTHHmmss')}.txt`
        const logFilePath = path.join(path.dirname(cueFilePath), logFileName)
        logStream = fs.createWriteStream(logFilePath, { flags: 'a' })

        for (let i = 0; i < cueInfo.TRACKS.length; i++) {
            const track = cueInfo.TRACKS[i]
            const startTime = i === 0 ? 0 : track.START
            const endTime = i === 0 ? cueInfo.TRACKS[i + 1].START : track.END
            const duration = endTime - startTime
            const sanitizedTitle = sanitizeFileName(`${track.PERFORMER} - ${track.TITLE} (${cueInfo.TITLE})`)
            // todo 检测文件是否存在，跳过
            const outputFileName = `${outputDir}/${sanitizedTitle}.${path.extname(audioFilePath)}`
            const tempOutputFileName = `${outputDir}/tmp_${sanitizedTitle}.${path.extname(audioFilePath)}`
            const metadata = `-metadata title="${track.TITLE}" -metadata artist="${track.PERFORMER}" -metadata album="${cueInfo.TITLE}" -metadata track="${track.trackNo}"`

            let ffmpegCommand = `ffmpeg -i "${audioFilePath}" -ss ${startTime} -t ${duration} ${metadata} "${tempOutputFileName}"`
            if (path.extname(audioFilePath).toLowerCase() === '.wav') {
                ffmpegCommand += ' -c:a pcm_s16le' // 如果原始格式是 WAV，则保持为 PCM 格式
            }

            try {
                await executeCommand(ffmpegCommand)

                await fs.rename(tempOutputFileName, outputFileName)

                const trackFileStats = await fs.stat(outputFileName)
                cueInfo.TRACKS[i].FILE_PATH = outputFileName
                cueInfo.TRACKS[i].FILE_SIZE = trackFileStats.size
            } catch (error) {
                const errorMessage = `Error splitting track ${track.trackNo}: ${error.message}`
                console.error(errorMessage)
                logStream.write(`${errorMessage}\n`)
                cueInfo.TRACKS[i].ERROR = errorMessage
            }
        }

        return cueInfo
    } catch (error) {
        console.error('Error splitting audio by CUE:', error)
        cueInfo.ERROR = error.message || 'Unknown error occurred'
        return cueInfo
    } finally {
        if (logStream) {
            logStream.end()
        }
    }
}

function executeCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error)
                return
            }
            if (stderr) {
                console.error(stderr)
            }
            resolve(stdout)
        })
    })
}

function sanitizeFileName(fileName) {
    return fileName.replace(forbiddenCharsRegex, '')
}
