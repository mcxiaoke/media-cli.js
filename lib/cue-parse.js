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

/**
 * 将CUE时间字符串转换为秒数
 * CUE时间格式: MM:SS:FF 或 MM:SS.FF，其中FF为帧数（75帧/秒）
 *
 * @param {string} timeString - CUE时间字符串
 * @returns {number} 转换后的秒数
 */
function parseTimeToSeconds(timeString) {
    const timeParts = timeString.split(":").map((part) => parseFloat(part.replace(",", ".")))
    return parseFloat(
        (timeParts[0] * 60 + timeParts[1] + (timeParts[2] ? timeParts[2] / 75 : 0)).toFixed(2),
    )
}

/**
 * 移除字符串两端的引号
 *
 * @param {string} value - 要处理的字符串
 * @returns {string} 移除引号后的字符串
 */
function removeQuotes(value) {
    return value.replace(/^"|"$/g, "").replace(/\\"/g, '"')
}

/**
 * 分割由空格分隔的三部分字符串
 * 后两部分可能被引号包裹，引号内可能包含空格
 *
 * @param {string} inputString - 输入字符串
 * @returns {Array<string>|undefined} 分割后的数组，不匹配则返回undefined
 */
function splitThree(inputString) {
    const regex = /(\w+)\s(".*?"|.*?)\s(.*)$/
    const matches = inputString.match(regex)
    if (matches) {
        return [matches[1], matches[2].replace(/"/g, ""), matches[3]]
    }
}

/**
 * 分割由空格分隔的两部分字符串
 * 第二部分可能被引号包裹，引号内可能包含空格
 *
 * @param {string} inputString - 输入字符串
 * @returns {Array<string>|undefined} 分割后的数组，不匹配则返回undefined
 */
function splitTwo(inputString) {
    const regex = /(".*?"|.*?)\s(.*)$/
    const matches = inputString.match(regex)
    if (matches) {
        return [matches[1].replace(/"/g, ""), matches[2]]
    }
}

/**
 * 合并Map的键值到Object上，可选择覆盖原有键值对
 * 不修改原对象，返回修改后的对象
 *
 * @param {Map} map - 源Map
 * @param {Object} obj - 目标对象
 * @param {boolean} overwrite - 是否覆盖已存在的键，默认false
 * @returns {Object} 合并后的新对象
 */
function mergeMapToObjectNew(map, obj, overwrite = false) {
    const mergedObject = { ...obj }
    map.forEach((value, key) => {
        if (overwrite || !(key in obj)) {
            mergedObject[key] = value
        }
    })
    return mergedObject
}

/**
 * 直接修改原对象，将Map的键值合并到Object上
 *
 * @param {Map} map - 源Map
 * @param {Object} obj - 目标对象（将被直接修改）
 * @param {boolean} overwrite - 是否覆盖已存在的键，默认false
 */
function mergeMapToObject(map, obj, overwrite = false) {
    map.forEach((value, key) => {
        if (overwrite || !(key in obj)) {
            obj[key] = value
        }
    })
}

/**
 * 从对象中移除指定字段，返回新对象
 * 不修改原对象
 *
 * @param {Object} obj - 源对象
 * @param {Array<string>} fieldsToOmit - 要移除的字段名数组
 * @returns {Object} 移除指定字段后的新对象
 */
function omitFieldsNew(obj, fieldsToOmit) {
    const { [fieldsToOmit[0]]: omit, ...rest } = obj
    return fieldsToOmit.length === 1 ? rest : omitFields(rest, fieldsToOmit.slice(1))
}

/**
 * 直接修改原对象，删除指定的字段
 *
 * @param {Object} obj - 要修改的对象（将被直接修改）
 * @param {Array<string>} fieldsToOmit - 要删除的字段名数组
 */
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

/**
 * 测试分割函数的辅助函数
 * 用于验证splitThree和splitTwo函数的正确性
 */
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

/**
 * 测试Map合并到Object函数的辅助函数
 * 用于验证mergeMapToObject函数的正确性
 */
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
