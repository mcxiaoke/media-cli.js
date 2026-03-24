/*
 * File: cmd_remove.js
 * Created: 2024-03-15 20:34:17 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import assert from "assert"
import chalk from "chalk"
import dayjs from "dayjs"
import { fileTypeFromFile } from "file-type"
import fs from "fs-extra"
import imageSizeOfSync from "image-size"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import { argv } from "process"
import { promisify } from "util"
import cliProgress from "cli-progress"
import * as mm from "music-metadata"
import { comparePathSmartBy, uniqueByFields } from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as enc from "../lib/encoding.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { getMediaInfo, getVideoInfo } from "../lib/mediainfo.js"
import { addEntryProps, applyFileNameRules } from "./cmd_shared.js"

const LOG_TAG = "Remove"

/**
 * 缓存对象，用于存储文件类型、媒体信息、图片尺寸、视频信息和音频信息
 */
const caches = {
    /** @type {Map<string, import('file-type').FileExtensionAndMimeType>} */
    fileType: new Map(),
    /** @type {Map<string, any>} */
    mediaInfo: new Map(),
    /** @type {Map<string, import('image-size').ISizeCalculationResult>} */
    imageSize: new Map(),
    /** @type {Map<string, any>} */
    videoInfo: new Map()
    // audioInfo 会在首次使用时动态添加
}

/**
 * 清理所有缓存，避免内存泄漏
 */
function clearCaches() {
    caches.fileType.clear()
    caches.mediaInfo.clear()
    caches.imageSize.clear()
    caches.videoInfo.clear()
    if (caches.audioInfo) {
        caches.audioInfo.clear()
    }
}

/**
 * 错误处理函数，用于收集和记录错误信息
 * @param {Error} error - 错误对象
 * @param {string} fileSrc - 文件路径
 * @param {Object} errorStats - 错误统计对象
 * @param {number} errorStats.total - 错误总数
 * @param {Object} errorStats.byType - 按错误类型统计
 * @param {Array} errorStats.details - 错误详情列表
 * @returns {Object} 错误信息对象
 */
function handleTaskError(error, fileSrc, errorStats) {
    const errorType = error.name || 'UnknownError'
    const errorMessage = error.message || 'No error message provided'
    
    // 统计错误
    errorStats.total++
    if (!errorStats.byType[errorType]) {
        errorStats.byType[errorType] = 0
    }
    errorStats.byType[errorType]++
    
    // 记录错误详情
    errorStats.details.push({
        file: fileSrc,
        error: errorType,
        message: errorMessage
    })
    
    // 记录错误日志
    log.error(
        "TaskError",
        `Error processing ${fileSrc}: ${errorType} - ${errorMessage}`,
        error.stack
    )
    
    // 返回错误对象，便于上层处理
    return {
        error: errorType,
        message: errorMessage,
        file: fileSrc
    }
}

/**
 * 根据文件大小获取合适的并发度
 * @param {number} fileSize - 文件大小（字节）
 * @returns {number} 推荐的并发度
 */
function getConcurrencyByFileSize(fileSize) {
    // 小文件（< 1MB）使用高并发
    if (fileSize < 1024 * 1024) {
        return cpus().length * 4
    }
    // 中等文件（1MB - 10MB）使用中等并发
    else if (fileSize < 10 * 1024 * 1024) {
        return cpus().length * 2
    }
    // 大文件（> 10MB）使用低并发
    else {
        return cpus().length
    }
}

// 获取文件类型（带缓存）
async function getCachedFileType(filePath) {
    if (caches.fileType.has(filePath)) {
        return caches.fileType.get(filePath)
    }
    
    try {
        const fileType = await fileTypeFromFile(filePath)
        caches.fileType.set(filePath, fileType)
        return fileType
    } catch (error) {
        caches.fileType.set(filePath, null)
        return null
    }
}

// 获取媒体信息（带缓存）
async function getCachedMediaInfo(filePath) {
    if (caches.mediaInfo.has(filePath)) {
        return caches.mediaInfo.get(filePath)
    }
    
    try {
        const mediaInfo = await getMediaInfo(filePath)
        caches.mediaInfo.set(filePath, mediaInfo)
        return mediaInfo
    } catch (error) {
        caches.mediaInfo.set(filePath, null)
        return null
    }
}

// 获取图片尺寸（带缓存）
async function getCachedImageSize(filePath) {
    if (caches.imageSize.has(filePath)) {
        return caches.imageSize.get(filePath)
    }
    
    try {
        const imageSizeOf = promisify(imageSizeOfSync)
        const dimension = await imageSizeOf(filePath)
        caches.imageSize.set(filePath, dimension)
        return dimension
    } catch (error) {
        caches.imageSize.set(filePath, null)
        return null
    }
}

// 获取视频信息（带缓存）
async function getCachedVideoInfo(filePath) {
    if (caches.videoInfo.has(filePath)) {
        return caches.videoInfo.get(filePath)
    }
    
    try {
        const videoInfo = await getVideoInfo(filePath)
        caches.videoInfo.set(filePath, videoInfo)
        return videoInfo
    } catch (error) {
        caches.videoInfo.set(filePath, null)
        return null
    }
}

// 获取音频信息（带缓存）
async function getCachedAudioInfo(filePath) {
    if (caches.audioInfo) {
        if (caches.audioInfo.has(filePath)) {
            return caches.audioInfo.get(filePath)
        }
    } else {
        caches.audioInfo = new Map()
    }
    
    try {
        const audioInfo = await mm.parseFile(filePath)
        caches.audioInfo.set(filePath, audioInfo)
        return audioInfo
    } catch (error) {
        caches.audioInfo.set(filePath, null)
        return null
    }
}

// 检查音频文件参数
async function checkAudioParams(fileSrc, audioParams, ipx, fileName) {
    if (!Object.keys(audioParams).length) {
        return { matches: false, description: "" }
    }
    
    try {
        const audioInfo = await getCachedAudioInfo(fileSrc)
        if (!audioInfo) {
            return { matches: false, description: " Audio=Invalid" }
        }
        
        const format = audioInfo.format
        const hasDuration = 'duration' in audioParams
        const hasBitrate = 'bitrate' in audioParams
        const hasSampleRate = 'samplerate' in audioParams
        const hasChannels = 'channels' in audioParams
        
        let matches = true
        let description = " Audio="
        
        if (hasDuration) {
            const duration = format.duration || 0
            matches = matches && duration <= audioParams.duration
            description += `D=${duration.toFixed(1)}s`
        }
        
        if (hasBitrate) {
            const bitrate = format.bitrate || 0
            matches = matches && bitrate <= audioParams.bitrate
            description += `B=${bitrate}kbps`
        }
        
        if (hasSampleRate) {
            const sampleRate = format.sampleRate || 0
            matches = matches && sampleRate <= audioParams.samplerate
            description += `SR=${sampleRate}Hz`
        }
        
        if (hasChannels) {
            const channels = format.numberOfChannels || 0
            matches = matches && channels <= audioParams.channels
            description += `CH=${channels}`
        }
        
        if (matches) {
            log.info(
                "preRemove[Audio]:",
                `${ipx} ${fileName} ${description} [${JSON.stringify(audioParams)}]`,
            )
        }
        
        return { matches, description }
    } catch (error) {
        log.logWarn(LOG_TAG, `preRemove[AudioCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
        return { matches: false, description: " Audio=Error" }
    }
}

// 检查文件时间参数
function checkTimeParams(fileSrc, mtimeDiff, ctimeDiff, ipx, fileName) {
    if (!mtimeDiff && !ctimeDiff) {
        return { matches: false, description: "" }
    }
    
    try {
        const stats = fs.statSync(fileSrc)
        const now = Date.now()
        const mtime = stats.mtime.getTime()
        const ctime = stats.ctime.getTime()
        
        let matches = true
        let description = " Time="
        
        if (mtimeDiff) {
            const mtimeOk = now - mtime <= mtimeDiff
            matches = matches && mtimeOk
            description += `M=${dayjs(mtime).format('YYYY-MM-DD')}`
        }
        
        if (ctimeDiff) {
            const ctimeOk = now - ctime <= ctimeDiff
            matches = matches && ctimeOk
            description += `C=${dayjs(ctime).format('YYYY-MM-DD')}`
        }
        
        if (matches) {
            log.info(
                "preRemove[Time]:",
                `${ipx} ${fileName} ${description} [mtime=${mtimeDiff ? 'Y' : 'N'}, ctime=${ctimeDiff ? 'Y' : 'N'}]`,
            )
        }
        
        return { matches, description }
    } catch (error) {
        log.logWarn(LOG_TAG, `preRemove[TimeCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
        return { matches: false, description: " Time=Error" }
    }
}

// a = all, f = files, d = directories
const TYPE_LIST = ["a", "f", "d"]

export { aliases, builder, command, describe, handler }

const command = "remove <input>"
const aliases = ["rm", "rmf"]
const describe = t("remove.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .option("loose", {
                alias: "l",
                type: "boolean",
                default: false,
                // 宽松模式，默认不开启，宽松模式条件或，默认严格模式条件与
                description: t("remove.loose"),
            })
            // 输出目录，如果存在，就是移动到这个目录，否则是删除
            .option("output", {
                alias: "o",
                type: "string",
                description: t("option.remove.output"),
            })
            // 保持源文件目录结构
            .option("output-tree", {
                alias: "otree",
                describe: t("remove.output.tree"),
                type: "boolean",
                default: false,
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            // 默认启用正则模式，禁用则为字符串模式
            .option("regex", {
                alias: "re",
                type: "boolean",
                default: true,
                description: t("option.common.regex"),
            })
            // 需要处理的扩展名列表，默认为常见视频文件
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
            .option("width", {
                type: "number",
                default: 0,
                // 图片文件的最大宽度
                description: t("remove.width"),
            })
            .option("height", {
                type: "number",
                default: 0,
                // 图片文件的最大高度
                description: t("remove.height"),
            })
            .option("measure", {
                alias: "m",
                type: "string",
                default: "",
                // 图片文件的长宽字符串形式
                description: t("remove.measure"),
            })
            .option("sizel", {
                alias: "sl",
                type: "number",
                default: 0,
                // 图片文件的文件大小，最小值，大于，单位为k
                description: t("remove.sizel"),
            })
            .option("sizer", {
                alias: "sr",
                type: "number",
                default: 0,
                // size 的 别名
                // 图片文件的文件大小，最大值，小于，单位为k
                description: t("remove.sizer"),
            })
            .option("pattern", {
                alias: "p",
                type: "string",
                default: "",
                // 文件名匹配，字符串或正则表达式
                description: t("remove.pattern"),
            })
            // 启用反转匹配模式
            .option("not-match", {
                alias: "n",
                type: "boolean",
                default: false,
                description: t("remove.not.match"),
            })
            .option("list", {
                type: "string",
                default: null,
                // 文件名列表文本文件，或者一个目录，里面包含的文件作为文件名列表来源
                description: t("remove.list"),
            })
            // 视频模式，按照视频文件的元数据删除
            // duration,dimension(width,height),bitrate
            // 参数格式 缩写 du=xx,w=xx,h=xx,dm=xx,bit=xx
            // duration=xx,width=xx,height=xx,bitrate=xx
            .option("video", {
                alias: "vdm",
                type: "string",
                description: t("remove.video"),
            })
            // 音频模式，按照音频文件的元数据删除
            // duration,bitrate,samplerate,channels
            // 参数格式 缩写 du=xx,bit=xx,sr=xx,ch=xx
            // duration=xx,bitrate=xx,samplerate=xx,channels=xx
            .option("audio", {
                alias: "adm",
                type: "string",
                description: t("remove.audio"),
            })
            // 要处理的文件类型 文件或目录或所有，默认只处理文件
            .option("type", {
                type: "choices",
                choices: TYPE_LIST,
                default: "f",
                description: t("remove.type"),
            })
            .option("reverse", {
                alias: "r",
                type: "boolean",
                default: false,
                // 文件名列表反转，默认为否，即删除列表中的文件，反转则删除不在列表中的文件
                description: t("remove.reverse"),
            })
            .option("corrupted", {
                alias: "c",
                type: "boolean",
                default: false,
                // 移除损坏的文件
                description: t("remove.corrupted"),
            })
            .option("badchars", {
                alias: "b",
                type: "boolean",
                default: false,
                // 移除文件名含乱码的文件
                description: t("remove.badchars"),
            })
            .option("delete-permanently", {
                type: "boolean",
                default: false,
                // 直接删除文件，不使用安全删除
                description: t("remove.delete.permanently"),
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: t("option.common.doit"),
            })
            // 时间筛选，基于文件修改时间
            // 格式: 1d (1天内), 1w (1周内), 1m (1月内), 1y (1年内)
            .option("mtime", {
                alias: "mt",
                type: "string",
                description: t("remove.mtime"),
            })
            // 时间筛选，基于文件创建时间
            // 格式: 1d (1天内), 1w (1周内), 1m (1月内), 1y (1年内)
            .option("ctime", {
                alias: "ct",
                type: "string",
                description: t("remove.ctime"),
            })
    )
}

const handler = cmdRemove
async function cmdRemove(argv) {
    log.logInfo(LOG_TAG, argv)
    const testMode = !argv.doit
    const root = path.resolve(argv.input)
    
    const errorStats = {
        total: 0,
        byType: {},
        details: []
    }
    
    const operationLog = []
    
    if (!root || !(await fs.pathExists(root))) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, `Invalid Input: ${root} - Path does not exist or is not accessible`)
    }
    const reMeasure = /^\d+[x*,|]\d+$/
    if (
        argv.width == 0 &&
        argv.height == 0 &&
        argv.sizel == 0 &&
        argv.sizer == 0 &&
        !(argv.measure && reMeasure.test(argv.measure)) &&
        !argv.pattern &&
        !argv.list &&
        !argv.corrupted &&
        !argv.badchars
    ) {
        log.logInfo(LOG_TAG, argv)
        log.logError(LOG_TAG, t("remove.required.conditions"))
        throw createError(ErrorTypes.MISSING_REQUIRED_ARGUMENT, t("remove.required.conditions"))
    }

    const type = (argv.type || "f").toLowerCase()
    if (!TYPE_LIST.includes(type)) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, `Error: type must be one of ${TYPE_LIST}`)
    }

    let cWidth = 0
    let cHeight = 0
    if (argv.width > 0 && argv.height > 0) {
        cWidth = argv.width
        cHeight = argv.height
    } else if (argv.measure && argv.measure.length > 0) {
        const [x, y] = argv.measure.split(/[x*,|]/).map(Number)
        log.logError(LOG_TAG, `Measure: ${x} x ${y}`)
        if (x > 0 && y > 0) {
            cWidth = x
            cHeight = y
        }
    }

    const cList = argv.list || "-not-exists"

    let cNames = []
    if (await fs.pathExists(path.resolve(cList))) {
        try {
            const list = path.resolve(cList)
            const listStat = await fs.stat(list)
            if (listStat.isFile()) {
                cNames = (await readNameList(list)) || new Set()
            } else if (listStat.isDirectory()) {
                const dirFiles = (await fs.readdir(list)) || []
                cNames = new Set(dirFiles.map((x) => path.parse(x).name.trim()))
            } else {
                log.logError(LOG_TAG, `invalid arguments: list file invalid 1`)
                return
            }
        } catch (error) {
            log.logError(LOG_TAG, `invalid arguments: list file invalid 2`)
            return
        }
    }

    cNames = cNames || new Set()

    log.logInfo(LOG_TAG, `${t("path.input")}: ${root}`)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, LOG_TAG)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, LOG_TAG)
    }

    const walkOpts = {
        needStats: true,
        withDirs: type === "d",
        withFiles: type === "a" || type === "f",
        withIndex: true,
    }
    log.logProgress(LOG_TAG, `${t("remove.scanning")}... (${type})`)
    let fileEntries = await mf.walk(root, walkOpts)
    log.logInfo(LOG_TAG, `${t("remove.found.files", { count: fileEntries.length })}: ${root}`)
    if (argv.directories?.length > 0) {
        const extraDirs = new Set(argv.directories.map((d) => path.resolve(d)))
        for (const dirPath of extraDirs) {
            const st = await fs.stat(dirPath)
            if (st.isDirectory()) {
                const dirFiles = await mf.walk(dirPath, walkOpts)
                if (dirFiles.length > 0) {
                    log.logInfo(
                        LOG_TAG,
                        t("ffmpeg.add.files", { count: dirFiles.length, path: dirPath }),
                    )
                    fileEntries = fileEntries.concat(dirFiles)
                }
            }
        }
    }
    fileEntries = uniqueByFields(fileEntries, "path")
    fileEntries = await applyFileNameRules(fileEntries, argv)
    fileEntries = fileEntries.sort(comparePathSmartBy("path"))
    log.logInfo(LOG_TAG, `${t("remove.found.files", { count: fileEntries.length })} (${type})`)

    let audioParams = {}
    if (argv.audio) {
        const audioArgs = argv.audio.split(',').map(arg => arg.trim())
        for (const arg of audioArgs) {
            const [key, value] = arg.split('=').map(item => item.trim())
            if (key && value) {
                switch (key) {
                    case 'du':
                    case 'duration':
                        audioParams.duration = parseFloat(value)
                        break
                    case 'bit':
                    case 'bitrate':
                        audioParams.bitrate = parseFloat(value)
                        break
                    case 'sr':
                    case 'samplerate':
                        audioParams.samplerate = parseFloat(value)
                        break
                    case 'ch':
                    case 'channels':
                        audioParams.channels = parseInt(value)
                        break
                }
            }
        }
    }

    function parseTimeParam(timeStr) {
        if (!timeStr) return null
        const timeRegex = /^(\d+)([dwmy])$/
        const match = timeStr.match(timeRegex)
        if (!match) return null
        const [, value, unit] = match
        const valueNum = parseInt(value)
        let maxDiff
        switch (unit) {
            case 'd': maxDiff = valueNum * 24 * 60 * 60 * 1000; break
            case 'w': maxDiff = valueNum * 7 * 24 * 60 * 60 * 1000; break
            case 'm': maxDiff = valueNum * 30 * 24 * 60 * 60 * 1000; break
            case 'y': maxDiff = valueNum * 365 * 24 * 60 * 60 * 1000; break
            default: return null
        }
        return maxDiff
    }

    const mtimeDiff = parseTimeParam(argv.mtime)
    const ctimeDiff = parseTimeParam(argv.ctime)

    const conditions = {
        total: fileEntries.length,
        loose: argv.loose,
        corrupted: argv.corrupted,
        badchars: argv.badchars,
        width: cWidth,
        height: cHeight,
        sizeLeft: argv.sizel || 0,
        sizeRight: argv.sizer || 0,
        pattern: argv.pattern,
        notMatch: argv.notMatch,
        names: cNames || new Set(),
        reverse: argv.reverse || false,
        purge: argv.deletePermanently || false,
        testMode,
        audio: audioParams,
        mtime: mtimeDiff,
        ctime: ctimeDiff,
    }

    fileEntries = fileEntries.map((f, i) => {
        return {
            ...f,
            index: i,
            argv: argv,
            total: fileEntries.length,
            conditions: conditions,
        }
    })
    
    const totalSize = fileEntries.reduce((acc, f) => acc + f.size, 0)
    const avgSize = fileEntries.length > 0 ? totalSize / fileEntries.length : 0
    const concurrency = getConcurrencyByFileSize(avgSize)
    
    log.logSuccess(LOG_TAG, `Using concurrency: ${concurrency} (based on average file size: ${helper.humanSize(avgSize)})`)
    let tasks = await pMap(fileEntries, preRemoveArgs, { concurrency })

    conditions.names = Array.from(cNames).slice(-5)
    const total = tasks.length
    tasks = tasks.filter((t) => t?.shouldRemove)
    const skipped = total - tasks.length
    if (skipped > 0) {
        log.logWarn(LOG_TAG, t("remove.files.skipped", { count: skipped }))
    }
    if (tasks.length === 0) {
        log.logInfo(LOG_TAG, conditions)
        log.logWarn(LOG_TAG, t("remove.nothing.to.do"))
        return
    }
    log.logWarn(LOG_TAG, t("remove.files.to.remove", { count: tasks.length, type: type }))
    log.logWarn(LOG_TAG, conditions)
    if (cNames && cNames.size > 0) {
        log.logWarn(LOG_TAG, `Attention: use file name list, ignore all other conditions`)
        log.logError(
            LOG_TAG,
            `Attention: Will DELETE all files ${conditions.reverse ? "NOT IN" : "IN"} the name list!`,
        )
    }
    log.fileLog(`Conditions: ${JSON.stringify(conditions)}`, LOG_TAG)
    testMode && log.logWarn(LOG_TAG, `++++++++++ TEST MODE (DRY RUN) ++++++++++`)
    const tasksTotalSize = tasks.reduce((acc, file) => acc + file.size, 0)
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("remove.confirm.delete", {
                    count: tasks.length,
                    size: helper.humanSize(tasksTotalSize),
                    type: type,
                }),
            ),
        },
    ])

    if (!answer.yes) {
        log.logWarn(LOG_TAG, t("operation.cancelled"))
        return
    }

    const startMs = Date.now()
    log.logSuccess(LOG_TAG, "task startAt", dayjs().format())
    let removedCount = 0
    let index = 0
    
    // 创建进度条
    const progressBar = new cliProgress.SingleBar({
        format: 'Processing [{bar}] {percentage}% | ETA: {eta}s | {value}/{total} | {file}',
        barCompleteChar: '█',
        barIncompleteChar: '░',
        hideCursor: true,
        clearOnComplete: false
    })
    
    if (testMode) {
        log.logWarn(LOG_TAG, t("common.test.mode.note", { count: tasks.length }))
    } else {
        progressBar.start(tasks.length, 0, { file: 'Starting...' })
        
        for (const task of tasks) {
            const flag = task.isDir ? "D" : "F"
            const shortPath = helper.pathShort(task.src, 40)
            
            try {
                progressBar.update(index, { file: shortPath })
                
                const originalPath = task.src
                const timestamp = Date.now()
                
                if (conditions.purge) {
                    operationLog.push({
                        type: 'delete',
                        path: originalPath,
                        size: task.size,
                        timestamp,
                        flag
                    })
                    
                    await fs.remove(task.src)
                    log.logTask(
                        LOG_TAG,
                        ++index,
                        tasks.length,
                        `${t("operation.delete")} ${shortPath} ${helper.humanSize(task.size)} ${flag}`,
                    )
                    log.fileLog(
                        `${t("operation.delete")}: ${task.index} <${task.src}> ${helper.humanSize(task.size)} ${flag}`,
                        LOG_TAG,
                    )
                } else {
                    const destPath = await helper.safeRemove(task.src)
                    
                    operationLog.push({
                        type: 'move',
                        src: originalPath,
                        dest: destPath,
                        size: task.size,
                        timestamp,
                        flag
                    })
                    
                    log.logTask(
                        LOG_TAG,
                        ++index,
                        tasks.length,
                        `${t("operation.move")} ${shortPath} ${helper.humanSize(task.size)} ${flag}`,
                    )
                    log.fileLog(
                        `${t("operation.move")}: ${task.index} <${task.src}> ${helper.humanSize(task.size)} ${flag}`,
                        LOG_TAG,
                    )
                }
                ++removedCount
            } catch (error) {
                handleTaskError(error, task.src, errorStats)
                log.logError(
                    LOG_TAG,
                    `${t("remove.failed")}: ${shortPath} ${helper.humanSize(task.size)} ${flag} - ${error.message}`,
                )
                index++
            }
            
            progressBar.update(index, { file: shortPath })
        }
        
        progressBar.update(tasks.length, { file: 'Completed' })
        progressBar.stop()
    }
    
    log.show(chalk.cyan('='.repeat(80)))
    log.show(chalk.cyan(`Operation Summary:`))
    log.show(chalk.cyan(`- Total files to process: ${tasks.length}`))
    log.show(chalk.cyan(`- Successfully processed: ${removedCount}`))
    log.show(chalk.cyan(`- Failed: ${tasks.length - removedCount}`))
    if (errorStats.total > 0) {
        log.show(chalk.cyan(`- Errors encountered: ${errorStats.total}`))
    }
    log.show(chalk.cyan(`- Duration: ${helper.humanTime(startMs)}`))
    log.show(chalk.cyan('='.repeat(80)))
    
    if (errorStats.total > 0) {
        log.logError(LOG_TAG, `Encountered ${errorStats.total} error(s) during operation:`)
        for (const [errorType, count] of Object.entries(errorStats.byType)) {
            log.logWarn(LOG_TAG, `  - ${errorType}: ${count} occurrence(s)`)
        }
        
        const errorLogPath = path.join(process.cwd(), `remove_errors_${Date.now()}.log`)
        await fs.writeFile(errorLogPath, JSON.stringify(errorStats, null, 2))
        log.logWarn(LOG_TAG, `Detailed error log saved to: ${errorLogPath}`)
    }
    
    if (operationLog.length > 0) {
        const logPath = path.join(process.cwd(), `remove_operation_${Date.now()}.log`)
        await fs.writeFile(logPath, JSON.stringify(operationLog, null, 2))
        log.logSuccess(LOG_TAG, `Operation log saved to: ${logPath}`)
        log.logWarn(LOG_TAG, `To undo this operation, use: mediac undo --log ${logPath}`)
    }
    
    log.logSuccess(LOG_TAG, "task endAt", dayjs().format())
    log.logSuccess(
        LOG_TAG,
        t("remove.summary", { count: removedCount, time: helper.humanTime(startMs), type: type }),
    )
    
    clearCaches()
    log.logDebug(LOG_TAG, "Caches cleared")
}

/**
 * 从文件中读取文件名列表
 * @param {string} list - 文件名列表文件路径
 * @returns {Promise<Set<string>>} 文件名集合
 */
async function readNameList(list) {
    const listContent = (await fs.readFile(list, "utf-8")) || ""
    const nameList = listContent
        .split(/\r?\n/)
        .map((x) => path.parse(x).name.trim())
        .filter(Boolean)
    return new Set(nameList)
}

/**
 * 构建删除任务参数
 * @param {number} index - 文件索引
 * @param {string} desc - 任务描述
 * @param {boolean} shouldRemove - 是否应该删除
 * @param {string} src - 文件路径
 * @param {number} size - 文件大小
 * @returns {Object} 删除任务参数对象
 */
function buildRemoveArgs(index, desc, shouldRemove, src, size) {
    return {
        index,
        desc,
        shouldRemove,
        src,
        size,
    }
}

/**
 * 处理文件名列表规则
 * @param {string} fileSrc - 文件路径
 * @param {string} base - 文件名（不含扩展名）
 * @param {Set<string>} cNames - 文件名集合
 * @param {boolean} cReverse - 是否反转匹配
 * @param {number} index - 文件索引
 * @param {number} size - 文件大小
 * @param {string} ipx - 索引/总数字符串
 * @param {string} flag - 文件类型标记
 * @returns {Object} 删除任务参数对象
 */
function handleNameListRule(fileSrc, base, cNames, cReverse, index, size, ipx, flag) {
    const nameInList = cNames.has(base.trim())
    const shouldRemove = cReverse ? !nameInList : nameInList
    const itemDesc = `IN=${nameInList} R=${cReverse}`
    log.logInfo(LOG_TAG, `preRemove[List] add:${ipx} ${helper.pathShort(fileSrc)} ${itemDesc} ${flag}`)
    return buildRemoveArgs(index, itemDesc, shouldRemove, fileSrc, size)
}

/**
 * 检查文件是否损坏
 * @param {string} fileSrc - 文件路径
 * @param {string} fileName - 文件名
 * @param {string} ipx - 索引/总数字符串
 * @returns {Promise<{isCorrupted: boolean, description: string}>}
 */
async function checkCorruptedFile(fileSrc, fileName, ipx) {
    const isAudioExt = helper.isAudioFile(fileName)
    const isVideoExt = helper.isVideoFile(fileSrc)
    const isImageExt = helper.isImageFile(fileSrc)
    const isRawExt = helper.isRawFile(fileName)
    const isArchiveExt = helper.isArchiveFile(fileName)
    const fileSize = (await fs.stat(fileSrc)).size
    
    let isCorrupted = false
    let description = ""
    
    if (isAudioExt || isVideoExt) {
        if (fileSize < 5 * 1024) {
            log.logDebug(LOG_TAG, `preRemove[BadSizeM]: ${ipx} ${fileSrc}`)
            description += " BadSizeM"
            isCorrupted = true
        } else {
            try {
                const info = await getCachedMediaInfo(fileSrc)
                const validMediaFile = info?.duration && info?.bitrate
                if (!validMediaFile) {
                    log.logDebug(
                        LOG_TAG,
                        `preRemove[CorruptedMedia]: ${ipx} ${fileSrc} ${info?.format || "unknown format"}`,
                    )
                    description += " Corrupted"
                    isCorrupted = true
                }
            } catch (error) {
                log.logDebug(LOG_TAG, `preRemove[CorruptedMediaError]: ${ipx} ${fileSrc} ${error.message}`)
                description += " Corrupted"
                isCorrupted = true
            }
        }
    } else if (isImageExt || isRawExt || isArchiveExt) {
        if (fileSize < 5 * 1024) {
            log.logDebug(LOG_TAG, `preRemove[BadSizeF]: ${ipx} ${fileSrc}`)
            description += " BadSizeF"
            isCorrupted = true
        } else {
            try {
                const ft = await getCachedFileType(fileSrc)
                if (!ft?.mime) {
                    log.logDebug(LOG_TAG, `preRemove[CorruptedFormat]: ${ipx} ${fileSrc}`)
                    description += " Corrupted"
                    isCorrupted = true
                }
            } catch (error) {
                log.logDebug(LOG_TAG, `preRemove[CorruptedFormatError]: ${ipx} ${fileSrc} ${error.message}`)
                description += " Corrupted"
                isCorrupted = true
            }
        }
    }
    
    if (!isCorrupted) {
        log.info("preRemove[Good]:", `${ipx} ${fileSrc}`)
    }
    
    return { isCorrupted, description }
}

/**
 * 检查文件名是否有乱码
 * @param {string} fileName - 文件名
 * @param {string} ipx - 索引/总数字符串
 * @param {string} fileSrc - 文件路径
 * @param {number} itemSize - 文件大小
 * @returns {Promise<{hasBadChars: boolean, description: string}>}
 */
function checkBadCharsInFileName(fileName, ipx, fileSrc, itemSize) {
    const itemCount = 1
    const hasBadChars = enc.hasBadCJKChar(fileName) || enc.hasBadUnicode(fileName, true)
    
    if (hasBadChars) {
        log.logDebug(
            LOG_TAG,
            `preRemove[BadChars]: ${ipx} ${fileSrc} (${helper.humanSize(itemSize)},${itemCount})`,
        )
    }
    
    return { hasBadChars, description: hasBadChars ? " BadChars" : "" }
}

/**
 * 检查文件名匹配
 * @param {string} fileName - 文件名
 * @param {string} cPattern - 匹配模式
 * @param {boolean} cNotMatch - 是否反向匹配
 * @param {string} ipx - 索引/总数字符串
 * @param {string} fileSrc - 文件路径
 * @param {number} itemSize - 文件大小
 * @returns {Promise<{matches: boolean, description: string}>}
 */
function checkNamePattern(fileName, cPattern, cNotMatch, ipx, fileSrc, itemSize) {
    const itemCount = 1
    const fName = fileName.toLowerCase()
    const rp = new RegExp(cPattern, "ui")
    const description = ` P=${cPattern}`
    
    // 开头匹配，或末尾匹配，或正则匹配
    const pMatched = fName.startsWith(cPattern) || fName.endsWith(cPattern) || rp.test(fName)
    // 条件反转判断
    const matches = cNotMatch ? !pMatched : pMatched
    
    if (matches) {
        log.info(
            "preRemove[Name]:",
            `${ipx} ${helper.pathShort(fileSrc)} [P=${rp}] (${helper.humanSize(itemSize)},${itemCount})`,
        )
    } else {
        log.debug("preRemove[Name]:", `${ipx} ${fileName} [P=${rp}]`)
    }
    
    return { matches, description }
}

/**
 * 检查文件大小
 * @param {number} fileSize - 文件大小
 * @param {number} sizeLeft - 最小大小（K）
 * @param {number} sizeRight - 最大大小（K）
 * @param {string} fileName - 文件名
 * @param {string} ipx - 索引/总数字符串
 * @returns {Promise<{matches: boolean, description: string}>}
 */
function checkFileSize(fileSize, sizeLeft, sizeRight, fileName, ipx) {
    // 命令行参数单位为K，这里修正为字节
    const sizeLeftBytes = sizeLeft * 1000
    const sizeRightBytes = sizeRight * 1000
    const description = ` S=${helper.humanSize(fileSize)} (${sizeLeft}K,${sizeRight}K)`
    
    let matches = false
    if (sizeRight > 0) {
        matches = fileSize > sizeLeftBytes && fileSize < sizeRightBytes
    } else {
        matches = fileSize > sizeLeftBytes
    }
    
    log.info(
        "preRemove[Size]:",
        `${ipx} ${fileName} [${helper.humanSize(fileSize)}] Size=(${sizeLeft}K,${sizeRight}K)`,
    )
    
    return { matches, description }
}

/**
 * 检查文件宽高
 * @param {string} fileSrc - 文件路径
 * @param {boolean} isImageExt - 是否为图片文件
 * @param {boolean} isVideoExt - 是否为视频文件
 * @param {number} maxWidth - 最大宽度
 * @param {number} maxHeight - 最大高度
 * @param {string} fileName - 文件名
 * @param {string} ipx - 索引/总数字符串
 * @returns {Promise<{matches: boolean, description: string}>}
 */
async function checkFileDimensions(fileSrc, isImageExt, isVideoExt, maxWidth, maxHeight, fileName, ipx) {
    let fWidth = 0
    let fHeight = 0
    
    try {
        if (isImageExt) {
            // 获取图片宽高（带缓存）
            const dimension = await getCachedImageSize(fileSrc)
            fWidth = dimension?.width || 0
            fHeight = dimension?.height || 0
        } else if (isVideoExt) {
            // 获取视频宽高（带缓存）
            const vi = await getCachedVideoInfo(fileSrc)
            fWidth = vi?.width || 0
            fHeight = vi?.height || 0
        }
    } catch (error) {
        log.info("preRemove[M]:", `${ipx} InvalidImage: ${fileName} ${error.message}`)
        return { matches: false, description: " M=Invalid" }
    }
    
    const description = ` M=${fWidth}x${fHeight}`
    let matches = false
    
    if (maxWidth > 0 && maxHeight > 0) {
        // 宽高都提供时，要求都满足才能删除
        if (fWidth <= maxWidth && fHeight <= maxHeight) {
            log.info(
                "preRemove[M]:",
                `${ipx} ${fileName} ${fWidth}x${fHeight} [${maxWidth}x${maxHeight}]`,
            )
            matches = true
        }
    } else if (maxWidth > 0 && fWidth <= maxWidth) {
        // 只提供宽要求
        log.info(
            "preRemove[M]:",
            `${ipx} ${fileName} ${fWidth}x${fHeight} [W=${maxWidth}]`,
        )
        matches = true
    } else if (maxHeight > 0 && fHeight <= maxHeight) {
        // 只提供高要求
        log.info(
            "preRemove[M]:",
            `${ipx} ${fileName} ${fWidth}x${fHeight} [H=${maxHeight}]`,
        )
        matches = true
    }
    
    return { matches, description }
}

/**
 * 检查删除条件
 * @param {boolean} hasName - 是否有名称匹配条件
 * @param {boolean} hasSize - 是否有大小匹配条件
 * @param {boolean} hasMeasure - 是否有宽高匹配条件
 * @param {boolean} hasAudio - 是否有音频参数条件
 * @param {boolean} hasTime - 是否有时间参数条件
 * @param {boolean} testPattern - 名称匹配结果
 * @param {boolean} testSize - 大小匹配结果
 * @param {boolean} testMeasure - 宽高匹配结果
 * @param {boolean} testAudio - 音频参数匹配结果
 * @param {boolean} testTime - 时间参数匹配结果
 * @returns {boolean} 是否满足删除条件
 */
function checkConditions(hasName, hasSize, hasMeasure, hasAudio, hasTime, testPattern, testSize, testMeasure, testAudio, testTime) {
    // 当所有条件都为真时
    if (hasName && hasSize && hasMeasure && hasAudio && hasTime) {
        return testPattern && testSize && testMeasure && testAudio && testTime
    }
    // 四个条件为真时
    else if (hasName && hasSize && hasMeasure && hasAudio && !hasTime) {
        return testPattern && testSize && testMeasure && testAudio
    }
    else if (hasName && hasSize && hasMeasure && !hasAudio && hasTime) {
        return testPattern && testSize && testMeasure && testTime
    }
    else if (hasName && hasSize && !hasMeasure && hasAudio && hasTime) {
        return testPattern && testSize && testAudio && testTime
    }
    else if (hasName && !hasSize && hasMeasure && hasAudio && hasTime) {
        return testPattern && testMeasure && testAudio && testTime
    }
    else if (!hasName && hasSize && hasMeasure && hasAudio && hasTime) {
        return testSize && testMeasure && testAudio && testTime
    }
    // 三个条件为真时
    else if (hasName && hasSize && hasMeasure && !hasAudio && !hasTime) {
        return testPattern && testSize && testMeasure
    }
    else if (hasName && hasSize && !hasMeasure && hasAudio && !hasTime) {
        return testPattern && testSize && testAudio
    }
    else if (hasName && hasSize && !hasMeasure && !hasAudio && hasTime) {
        return testPattern && testSize && testTime
    }
    else if (hasName && !hasSize && hasMeasure && hasAudio && !hasTime) {
        return testPattern && testMeasure && testAudio
    }
    else if (hasName && !hasSize && hasMeasure && !hasAudio && hasTime) {
        return testPattern && testMeasure && testTime
    }
    else if (hasName && !hasSize && !hasMeasure && hasAudio && hasTime) {
        return testPattern && testAudio && testTime
    }
    else if (!hasName && hasSize && hasMeasure && hasAudio && !hasTime) {
        return testSize && testMeasure && testAudio
    }
    else if (!hasName && hasSize && hasMeasure && !hasAudio && hasTime) {
        return testSize && testMeasure && testTime
    }
    else if (!hasName && hasSize && !hasMeasure && hasAudio && hasTime) {
        return testSize && testAudio && testTime
    }
    else if (!hasName && !hasSize && hasMeasure && hasAudio && hasTime) {
        return testMeasure && testAudio && testTime
    }
    // 两个条件为真时
    else if (hasName && hasSize && !hasMeasure && !hasAudio && !hasTime) {
        return testPattern && testSize
    }
    else if (hasName && !hasSize && hasMeasure && !hasAudio && !hasTime) {
        return testPattern && testMeasure
    }
    else if (hasName && !hasSize && !hasMeasure && hasAudio && !hasTime) {
        return testPattern && testAudio
    }
    else if (hasName && !hasSize && !hasMeasure && !hasAudio && hasTime) {
        return testPattern && testTime
    }
    else if (!hasName && hasSize && hasMeasure && !hasAudio && !hasTime) {
        return testSize && testMeasure
    }
    else if (!hasName && hasSize && !hasMeasure && hasAudio && !hasTime) {
        return testSize && testAudio
    }
    else if (!hasName && hasSize && !hasMeasure && !hasAudio && hasTime) {
        return testSize && testTime
    }
    else if (!hasName && !hasSize && hasMeasure && hasAudio && !hasTime) {
        return testMeasure && testAudio
    }
    else if (!hasName && !hasSize && hasMeasure && !hasAudio && hasTime) {
        return testMeasure && testTime
    }
    else if (!hasName && !hasSize && !hasMeasure && hasAudio && hasTime) {
        return testAudio && testTime
    }
    // 只有一个条件为真时
    else if (hasName) {
        return testPattern
    }
    else if (hasSize) {
        return testSize
    }
    else if (hasMeasure) {
        return testMeasure
    }
    else if (hasAudio) {
        return testAudio
    }
    else if (hasTime) {
        return testTime
    }
    // 没有条件时
    else {
        return false
    }
}

/**
 * 构建项目描述
 * @param {boolean} testCorrupted - 是否损坏
 * @param {boolean} testBadChars - 是否有乱码
 * @param {boolean} testPattern - 名称匹配结果
 * @param {boolean} testSize - 大小匹配结果
 * @param {boolean} testMeasure - 宽高匹配结果
 * @param {boolean} testAudio - 音频参数匹配结果
 * @param {boolean} testTime - 时间参数匹配结果
 * @param {Object} c - 条件对象
 * @returns {string} 项目描述
 */
function buildItemDescription(testCorrupted, testBadChars, testPattern, testSize, testMeasure, testAudio, testTime, c) {
    let itemDesc = ""
    
    if (testCorrupted) {
        itemDesc += " Corrupted"
    }
    
    if (testBadChars) {
        itemDesc += " BadChars"
    }
    
    if (testPattern && c.pattern) {
        itemDesc += ` P=${c.pattern.toLowerCase()}`
    }
    
    if (testSize && (c.sizeLeft > 0 || c.sizeRight > 0)) {
        itemDesc += ` S=${helper.humanSize(c.size || 0)} (${c.sizeLeft}K,${c.sizeRight}K)`
    }
    
    if (testAudio && c.audio) {
        itemDesc += " Audio=Y"
    }
    
    if (testTime && (c.mtime || c.ctime)) {
        itemDesc += " Time=Y"
    }
    
    return itemDesc
}

/**
 * 记录删除状态
 * @param {boolean} shouldRemove - 是否应该删除
 * @param {string} fileSrc - 文件路径
 * @param {number} itemSize - 文件大小
 * @param {string} flag - 文件类型标记
 * @param {string} ipx - 索引/总数字符串
 * @param {boolean} testCorrupted - 是否损坏
 * @param {string} itemDesc - 项目描述
 * @param {number} itemCount - 项目数量
 */
function logRemoveStatus(shouldRemove, fileSrc, itemSize, flag, ipx, testCorrupted, itemDesc, itemCount = 1) {
    if (shouldRemove) {
        if (itemSize > mf.FILE_SIZE_1M * 200 || (flag === "D" && itemCount > 100)) {
            log.logWarn(
                LOG_TAG,
                `PreRemove[Large]: ${ipx} ${helper.pathShort(fileSrc)} (${helper.humanSize(itemSize)},${itemCount})  ${flag}`,
            )
        }
        log.logInfo(
            LOG_TAG,
            chalk.yellow("ADD"),
            `${helper.pathShort(fileSrc, 48)} ${itemDesc} ${testCorrupted ? "Corrupted" : ""} (${helper.humanSize(itemSize)})`,
            ipx,
        )
        log.fileLog(
            `add: ${ipx} <${fileSrc}> ${itemDesc} ${flag} (${helper.humanSize(itemSize)},${itemCount})`,
            LOG_TAG,
        )
    } else {
        log.info(
            "PreRemove ignore:",
            `${ipx} ${helper.pathShort(fileSrc)} [${itemDesc}] ${flag}`,
        )
    }
}

/**
 * 准备删除任务参数
 * @param {Object} f - 文件对象
 * @param {string} f.path - 文件路径
 * @param {boolean} f.isDir - 是否为目录
 * @param {number} f.index - 文件索引
 * @param {number} f.total - 总文件数
 * @param {number} f.size - 文件大小
 * @param {Object} f.conditions - 条件对象
 * @returns {Promise<Object>} 删除任务参数对象
 */
async function preRemoveArgs(f) {
    const fileSrc = path.resolve(f.path)
    const fileName = path.basename(fileSrc)
    const [dir, base, ext] = helper.pathSplit(fileSrc)
    const flag = f.isDir ? "D" : "F"
    const c = f.conditions || {}
    const ipx = `${f.index}/${f.total}`
    // 文件名列表规则
    const cNames = c.names || new Set()
    // 是否反转文件名列表
    const cReverse = c.reverse
    const hasList = cNames && cNames.size > 0

    // 文件名列表是单独规则，优先级最高，如果存在，直接返回，忽略其它条件
    if (hasList) {
        return handleNameListRule(fileSrc, base, cNames, cReverse, f.index, f.size, ipx, flag)
    }

    // three args group
    // name pattern top1
    // width && height top2
    // size top3
    // 宽松模式，采用 OR 匹配条件，默认是 AND
    const hasLoose = c.loose || false
    // 删除损坏文件
    const hasCorrupted = c.corrupted || false
    // 移除乱码文件名的文件
    const hasBadChars = c.badchars || false
    // 最大宽度
    const cWidth = c.width || 0
    // 最大高度
    const cHeight = c.height || 0
    // 文件名匹配文本
    const cPattern = (c.pattern || "").toLowerCase()
    // 启用反向匹配
    const cNotMatch = c.notMatch || false

    const hasName = cPattern?.length > 0
    const hasSize = c.sizeLeft > 0 || c.sizeRight > 0
    const hasMeasure = cWidth > 0 || cHeight > 0

    let testCorrupted = false
    let testBadChars = false
    let testPattern = false
    let testSize = false
    let testMeasure = false
    let itemDesc = ""

    const isImageExt = helper.isImageFile(fileSrc)
    const isVideoExt = helper.isVideoFile(fileSrc)
    const itemSize = f.size
    const itemCount = 1

    try {
        if (hasCorrupted && f.isFile) {
            try {
                const { isCorrupted, description } = await checkCorruptedFile(fileSrc, fileName, ipx)
                testCorrupted = isCorrupted
                itemDesc += description
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[CorruptedCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        if (hasBadChars) {
            try {
                const { hasBadChars: badChars, description } = checkBadCharsInFileName(fileName, ipx, fileSrc, itemSize)
                testBadChars = badChars
                itemDesc += description
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[BadCharsCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        if (!testCorrupted && hasName) {
            try {
                const { matches, description } = checkNamePattern(fileName, cPattern, cNotMatch, ipx, fileSrc, itemSize)
                testPattern = matches
                itemDesc += description
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[NameCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        if (!testCorrupted && hasSize && f.isFile) {
            try {
                const { matches, description } = checkFileSize(f.size, c.sizeLeft, c.sizeRight, fileName, ipx)
                testSize = matches
                itemDesc += description
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[SizeCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        if (!testCorrupted && hasMeasure && f.isFile) {
            try {
                const { matches, description } = await checkFileDimensions(fileSrc, isImageExt, isVideoExt, cWidth, cHeight, fileName, ipx)
                testMeasure = matches
                itemDesc += description
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[DimensionsCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        const hasAudio = Object.keys(c.audio || {}).length > 0
        let testAudio = false
        if (!testCorrupted && hasAudio && f.isFile) {
            try {
                const isAudioExt = helper.isAudioFile(fileName)
                if (isAudioExt) {
                    const { matches, description } = await checkAudioParams(fileSrc, c.audio, ipx, fileName)
                    testAudio = matches
                    itemDesc += description
                }
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[AudioCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        const hasTime = c.mtime || c.ctime
        let testTime = false
        if (!testCorrupted && hasTime) {
            try {
                const { matches, description } = checkTimeParams(fileSrc, c.mtime, c.ctime, ipx, fileName)
                testTime = matches
                itemDesc += description
            } catch (error) {
                log.logWarn(LOG_TAG, `preRemove[TimeCheckError]: ${ipx} ${fileSrc} - ${error.message}`)
            }
        }

        let shouldRemove = false

        if (testCorrupted || testBadChars) {
            shouldRemove = true
        } else {
            if (hasLoose) {
                // 宽松模式：满足任一条件
                shouldRemove = testPattern || testSize || testMeasure || testAudio || testTime
            } else {
                // 严格模式：满足所有条件
                log.debug(
                    "PreRemove ",
                    `${ipx} ${helper.pathShort(fileSrc)} hasName=${hasName}-${testPattern} hasSize=${hasSize}-${testSize} hasMeasure=${hasMeasure}-${testMeasure} hasAudio=${hasAudio}-${testAudio} hasTime=${hasTime}-${testTime} testCorrupted=${testCorrupted},testBadChars=${testBadChars},flag=${flag}`,
                )
                shouldRemove = checkConditions(hasName, hasSize, hasMeasure, hasAudio, hasTime, testPattern, testSize, testMeasure, testAudio, testTime)
            }
        }

        // 构建项目描述
        const fullItemDesc = buildItemDescription(testCorrupted, testBadChars, testPattern, testSize, testMeasure, testAudio, testTime, c)
        
        logRemoveStatus(shouldRemove, fileSrc, itemSize, flag, ipx, testCorrupted, fullItemDesc, itemCount)
        return buildRemoveArgs(f.index, fullItemDesc, shouldRemove, fileSrc, itemSize)
    } catch (error) {
        log.error(`PreRemove ${ipx} error:`, error, fileSrc, flag)
        log.fileLog(`Error: ${f.index} <${fileSrc}> ${flag}`, "PreRemove")
        // 出错时返回一个安全的默认值，避免整个任务失败
        return buildRemoveArgs(f.index, `Error: ${error.message}`, false, fileSrc, itemSize)
    }
}
