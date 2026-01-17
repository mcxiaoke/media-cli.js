/*
 * Project: mediac
 * Created: 2024-04-16 18:05:50
 * Modified: 2024-04-16 18:05:50
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// cue-parser.js

import chardet from "chardet"
import fs from "fs-extra"

function parseTimeToSeconds(timeString) {
    const timeParts = timeString.split(":").map((part) => parseFloat(part.replace(",", ".")))
    return parseFloat(
        (timeParts[0] * 60 + timeParts[1] + (timeParts[2] ? timeParts[2] / 75 : 0)).toFixed(2),
    )
}

function removeQuotes(value) {
    return value.replace(/^"|"$/g, "").replace(/\\"/g, '"')
}

// 匹配空格分割三部分的字符串
// 后两部分可能引号包裹
// 引号里可能有空格
function splitThree(inputString) {
    const regex = /(\w+)\s(".*?"|.*?)\s(.*)$/
    const matches = inputString.match(regex)
    if (matches) {
        return [matches[1], matches[2].replace(/"/g, ""), matches[3]]
    }
}

// 匹配空格分割两部分的字符串
// 后两部分可能引号包裹
// 引号里可能有空格
function splitTwo(inputString) {
    const regex = /(".*?"|.*?)\s(.*)$/
    const matches = inputString.match(regex)
    if (matches) {
        return [matches[1].replace(/"/g, ""), matches[2]]
    }
}

// 合并Map的键值到Object上，可选覆盖原有键值对
// 不修改原对象，返回修改后的对象
function mergeMapToObjectNew(map, obj, overwrite = false) {
    const mergedObject = { ...obj }
    map.forEach((value, key) => {
        if (overwrite || !(key in obj)) {
            mergedObject[key] = value
        }
    })
    return mergedObject
}

// 直接修改原对象
function mergeMapToObject(map, obj, overwrite = false) {
    map.forEach((value, key) => {
        if (overwrite || !(key in obj)) {
            obj[key] = value
        }
    })
}

// 不修改原对象，返回修改后的对象
function omitFieldsNew(obj, fieldsToOmit) {
    const { [fieldsToOmit[0]]: omit, ...rest } = obj
    return fieldsToOmit.length === 1 ? rest : omitFields(rest, fieldsToOmit.slice(1))
}

// 直接修改原对象
function omitFields(obj, fieldsToOmit) {
    fieldsToOmit.forEach((field) => delete obj[field])
}

class CueParser {
    constructor(filePath, encoding = "utf8") {
        this.filePath = filePath
        this.encoding = encoding
        this.cueInfo = {
            REM: new Map(),
            TITLE: "",
            PERFORMER: "",
            CATALOG: "",
            FILE: "",
            FORMAT: "",
            TRACKS: [],
        }
        this.currentTrackInfo = {
            TITLE: "",
            PERFORMER: "",
            REM: new Map(),
        }
    }

    async parse() {
        try {
            const buffer = await fs.readFile(this.filePath)
            this.encoding = chardet.detect(buffer) || this.encoding
            const cueContent = buffer.toString(this.encoding)
            const lines = cueContent.split("\n")
            let currentTrack = null

            for (let line of lines) {
                // 去除开头和结尾的空格，并处理行注释
                const trimmedLine = line.trim().split(";")[0].trim()
                if (trimmedLine === "") continue // 跳过空行

                const tokens = trimmedLine.split(/\s+/)
                const keyword = tokens[0]
                const value = tokens.slice(1).join(" ")

                switch (keyword) {
                    case "FILE":
                        const fileParts = splitTwo(value)
                        if (fileParts && fileParts.length == 2) {
                            this.cueInfo.FILE = removeQuotes(fileParts[0])
                            this.cueInfo.FORMAT = removeQuotes(fileParts[1])
                        } else {
                            throw new Error("Invalid FILE Entry in cue file")
                        }
                        break
                    case "REM":
                        const remParts = splitTwo(value)
                        if (remParts && remParts.length == 2) {
                            if (currentTrack) {
                                currentTrack.REM.set(
                                    removeQuotes(remParts[0]),
                                    removeQuotes(remParts[1]),
                                )
                            } else {
                                this.cueInfo.REM.set(
                                    removeQuotes(remParts[0]),
                                    removeQuotes(remParts[1]),
                                )
                            }
                        }
                        break
                    case "CATALOG":
                        this.cueInfo[keyword] = removeQuotes(value)
                        break
                    case "TRACK":
                        const trackNo = parseInt(tokens[1])
                        const audioType = tokens.slice(2).join(" ") // 合并剩余的 tokens 作为 audioType
                        currentTrack = {
                            TRACK_NO: trackNo,
                            TYPE: audioType,
                            START: 0,
                            END: 0,
                            START_STR: "",
                            END_STR: "",
                            REM: new Map(),
                            TITLE: this.currentTrackInfo.TITLE,
                            PERFORMER: this.currentTrackInfo.PERFORMER,
                        }
                        this.cueInfo.TRACKS.push(currentTrack)
                        break
                    case "INDEX":
                        if (currentTrack) {
                            const indexNo = tokens[1]
                            const timeString = tokens.slice(2).join(" ")
                            const seconds = parseTimeToSeconds(timeString)
                            if (indexNo === "00") {
                                currentTrack.START = seconds
                                currentTrack.START_STR = value
                            } else if (indexNo === "01") {
                                currentTrack.END = seconds
                                currentTrack.END_STR = value
                            }
                        }
                        break
                    case "TITLE":

                    case "ISRC":
                    case "COMPOSER":
                    case "PERFORMER":
                        if (currentTrack) {
                            currentTrack[keyword] = removeQuotes(value)
                        } else {
                            this.cueInfo[keyword] = removeQuotes(value)
                        }
                        break
                    default:
                        break
                }
            }
            this.cueInfo.TRACKS.forEach((track) => {
                mergeMapToObject(track.REM, track, false)
                omitFields(track, ["REM"])
            })
            return mergeMapToObjectNew(this.cueInfo.REM, this.cueInfo, false)
            // return omitFieldsNew(cueInfoTweaked, ['REM'])
        } catch (error) {
            console.error("Error parsing CUE file:", error)
            return null
        }
    }
}

export default CueParser

await testParse()

// 使用示例
async function testParse() {
    const cueFilePath = process.argv[2]
    const cueParser = new CueParser(cueFilePath)
    const cueInfo = await cueParser.parse()
    const tracks = cueInfo.TRACKS
    cueInfo.TRACKS = []
    console.log(cueInfo)
    for (const track of tracks) {
        console.log(track)
    }
}

function testSplitFunc() {
    // 测试函数
    let lines = [
        "REM GENRE Game",
        "REM DATE 2020",
        "REM DISCID 4A07DB06",
        'REM COMMENT "ExactAudioCopy v1.3"',
        'REM COMPOSER "BNSI(佐藤貴文)"',
        'FILE "THE IDOLM@! - なんどでも笑おう【765PRO ALLSTARS盤】.wav" WAVE',
    ]
    lines.forEach((line, index) => {
        const result = splitThree(line)
        console.log("Line", index + 1 + ":", result)
    })
    lines = ["GENRE Game", "DATE 2020", '"DISCID OK" 4A07DB06', 'COMMENT "ExactAudioCopy v1.3"']
    lines.forEach((line, index) => {
        const result = splitTwo(line)
        console.log("Line", index + 1 + ":", result)
    })
}

function testMergeMapToObject() {
    // 测试函数
    const map = new Map([
        ["key1", "value1"],
        ["key2", "value2"],
        ["key3", "value3"],
    ])

    // 不覆盖原有字段
    const mergedObject1 = mergeMapToObject(map, {
        key2: "originalValue",
        key4: "originalValue",
    })
    console.log("Merged Object (without overwrite):", mergedObject1)

    // 覆盖原有字段
    const mergedObject2 = mergeMapToObject(
        map,
        {
            key2: "originalValue",
            key4: "originalValue",
        },
        true,
    )
    console.log("Merged Object (with overwrite):", mergedObject2)
}
