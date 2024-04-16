/*
 * Project: mediac
 * Created: 2024-04-16 18:05:50
 * Modified: 2024-04-16 18:05:50
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chardet from 'chardet'
import fs from 'fs-extra'

class CueParser {
    constructor(filePath, encoding = 'utf8') {
        this.filePath = filePath
        this.encoding = encoding
        this.cueInfo = {
            REM: [],
            TITLE: '',
            CATALOG: '',
            FILE: '',
            TRACKS: []
        }
    }

    async parseTimeToSeconds(timeString) {
        const timeParts = timeString.split(':').map(part => parseFloat(part.replace(',', '.')))
        return parseFloat((timeParts[0] * 60 + timeParts[1] + (timeParts[2] ? timeParts[2] / 75 : 0)).toFixed(2))
    }

    removeQuotes(value) {
        return value.replace(/^"|"$/g, '').replace(/\\"/g, '"')
    }

    async parse() {
        try {
            const buffer = await fs.readFile(this.filePath)
            this.encoding = chardet.detect(buffer) || this.encoding
            const cueContent = buffer.toString(this.encoding)
            const lines = cueContent.split('\n')
            let currentTrack = null

            for (let line of lines) {
                // 去除开头和结尾的空格，并处理行注释
                const trimmedLine = line.trim().split(';')[0].trim()
                if (trimmedLine === '') continue // 跳过空行

                const tokens = trimmedLine.split(/\s+/)
                const keyword = tokens[0]
                const value = tokens.slice(1).join(' ')

                if (keyword === 'TRACK') {
                    const trackNo = parseInt(tokens[1])
                    const audioType = tokens.slice(2).join(' ') // 合并剩余的 tokens 作为 audioType
                    currentTrack = { trackNo: trackNo, AUDIO: { type: audioType }, START: 0, END: 0, REM: [] }
                    this.cueInfo.TRACKS.push(currentTrack)
                } else if (currentTrack) {
                    switch (keyword) {
                        case 'REM':
                            currentTrack.REM.push(this.removeQuotes(value))
                            break
                        case 'INDEX':
                            const indexTokens = value.split(/\s+/)
                            const indexNo = indexTokens[0]
                            const timeString = indexTokens.slice(1).join(' ')
                            const seconds = await this.parseTimeToSeconds(timeString)
                            if (indexNo === '00') {
                                currentTrack.START = seconds
                                currentTrack.START_STR = value
                            } else if (indexNo === '01') {
                                currentTrack.END = seconds
                                currentTrack.END_STR = value
                            }
                            break
                        case 'PERFORMER':
                        case 'ISRC':
                        case 'COMPOSER':
                            currentTrack[keyword] = this.removeQuotes(value)
                            break
                        default:
                            break
                    }
                }
            }

            return this.cueInfo
        } catch (error) {
            console.error('Error parsing CUE file:', error)
            return null
        }
    }
}

// 使用示例
(async () => {
    const cueFilePath = process.argv[2]
    const cueParser = new CueParser(cueFilePath)
    const cueInfo = await cueParser.parse()
    console.log(cueInfo)
})()
