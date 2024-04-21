/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk'
import { $, execa } from 'execa'
import { fileTypeFromFile } from 'file-type'
import fs from 'fs-extra'
import inquirer from "inquirer"
import mm from 'music-metadata'
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import which from "which"
import * as core from '../lib/core.js'
import { formatArgs } from '../lib/core.js'
import * as log from '../lib/debug.js'
import { getMediaInfo } from '../lib/ffprobe.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'


const LOG_TAG = "FFConv"

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".wmv", ".avi", ".mkv", ".m4v", ".ts", ".flv", ".webm"]
const PRESET_NAMES = []
const PRESET_MAP = new Map()

// ===========================================
// 命令内容执行
// ===========================================


export { aliases, builder, command, describe, handler }

const command = "ffmpeg <input> [options]"
const aliases = ["transcode", "aconv", "vconv", "avconv"]
const describe = 'convert audio or video files using ffmpeg.'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya
        // 输入目录，根目录
        .positional("input", {
            describe: "Input folder that contains media files",
            type: "string",
        })
        // 输出目录，默认输出文件与原文件同目录
        .option("output", {
            alias: "o",
            describe: "Folder store ouput files, keep tree structure",
            type: "string",
        })
        // 需要处理的扩展名列表，默认为常见视频文件
        .option("extensions", {
            alias: "e",
            type: "string",
            describe: "include files by extensions (eg. .wav|.flac)",
        })
        // 选择预设，从预设列表中选一个，预设等于一堆预定义参数
        .option("preset", {
            type: "choices",
            choices: PRESET_NAMES,
            describe: "convert preset args for ffmpeg command",
        })
        // 强制解压，覆盖之前的文件
        .option('override', {
            alias: 'O',
            type: 'boolean',
            default: false,
            description: 'force to override existting files'
        })
        // 输出文件名前缀
        // 提供几个预定义变量
        // {width},{height},{dimension},{bitrate},{speed},{preset}
        // 然后模板解析替换字符串变量
        .option("prefix", {
            alias: "P",
            type: "string",
            describe: "add prefix to output filename",
        })
        // 输出文件名后缀
        // 同上支持模板替换
        .option("suffix", {
            alias: "S",
            type: "string",
            describe: "add suffix to filename",
        })
        // 视频尺寸，长边最大数值
        .option("dimension", {
            type: "number",
            default: 0,
            describe: "chang max side for video",
        })
        // 视频加速减速，默认不改动，范围0.25-4.0
        .option("speed", {
            type: "number",
            default: 0,
            describe: "chang speed for video and audio",
        })
        // 视频模式 默认模式
        // 等于 --preset hevc_2k
        .option("video-mode", {
            alias: "vm",
            type: "boolean",
            default: true,
            describe: "convert video with default preset:hevc_2k",
        })
        // 视频选项
        // video-args = video-encoder + video-quality 
        // 如果此选项存在，会忽略其它 video-xxx 参数
        .option("video-args", {
            alias: "va",
            type: "string",
            describe: "Set video args in ffmpeg command",
        })
        // 视频选项，指定码率
        .option("video-bitrate", {
            alias: "vb",
            type: "number",
            default: 0,
            describe: "Set video bitrate in ffmpeg command",
        })
        // 视频选项，指定视频质量参数
        .option("video-quality", {
            alias: "vq",
            type: "number",
            default: 0,
            describe: "Set video quality in ffmpeg command",
        })
        // 音频模式
        // 等于 --preset aac_medium
        .option("audio-mode", {
            alias: "am",
            type: "boolean",
            describe: "convert audio with default preset:aac_medium",
        })
        // 音频选项
        // audio-args = audio-encoder + audio-quality 
        // 如果此选项存在，会忽略其它 audio-xxx 参数
        .option("audio-args", {
            alias: "aa",
            type: "string",
            describe: "Set audio args in ffmpeg command",
        })
        // 音频选项，指定码率
        .option("audio-bitrate", {
            alias: "ab",
            type: "number",
            default: 0,
            describe: "Set audio bitrate in ffmpeg command",
        })
        // 音频选项，指定音频质量参数
        .option("audio-quality", {
            alias: "aq",
            type: "number",
            default: 0,
            describe: "Set audio quality in ffmpeg command",
        })
        // ffmpeg filter string
        .option("filters", {
            alias: "fs",
            type: "string",
            describe: "Set filters in ffmpeg command",
        })
        // ffmpeg complex filter string
        .option("filter-complex", {
            alias: "fc",
            type: "string",
            describe: "Set complex filters in ffmpeg command",
        })
        // 并行操作限制，并发数，默认为 CPU 核心数
        .option("jobs", {
            alias: "j",
            describe: "multi jobs running parallelly",
            type: "number",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}


const handler = cmdConvert

async function cmdConvert(argv) {
    const testMode = !argv.doit
    const logTag = chalk.green('FFConv')
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`)
    }
    let startMs = Date.now()
    log.show(logTag, `Input: ${root}`)
    const extensions = argv.extensions?.toLowerCase()
    if (extensions?.length > 0 && !/\.[a-z]{2,4}/.test(extensions)) {
        // 有扩展名参数，但是参数错误，报错
        throw new Error(`Invalid extensions argument: ${extensions}`)
    }

    if (!argv.videoMode && !argv.audioMode) {
        // 没有指定模式，报错
        throw new Error(`No mode specified, please use --video-mode or --audio-mode`)
    }

    // 解析Preset，根据argv参数修改preset，返回对象
    const preset = preparePreset(argv)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, 'FFConv')
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, 'FFConv')
        log.fileLog(`Preset: ${JSON.stringify(preset)}`, 'FFConv')
    }

    // 只包含视频文件或音频文件
    let fileEntries = await mf.walk(root, {
        withFiles: true,
        needStats: true,
        entryFilter: (e) => e.isFile && (argv.audioMode ? helper.isAudioFile(e.name) : helper.isVideoFile(e.name))
    })
    log.show(logTag, `Total ${fileEntries.length} files found in ${helper.humanTime(startMs)}`)
    if (extensions?.length > 0) {
        fileEntries = fileEntries.filter(entry => extensions.includes(helper.pathExt(entry.name)))
        log.show(logTag, `Total ${fileEntries.length} files left after filter by extensions`)
    }
    // 过滤掉压缩过的文件 关键词 shana tmp m4a 
    fileEntries = fileEntries.filter(entry => !/shana|tmp|\.m4a/i.test(entry.name))
    log.show(logTag, `Total ${fileEntries.length} files left after exclude shana|tmp|m4a filenames`)
    if (fileEntries.length === 0) {
        log.showYellow(logTag, 'No files left after filters, nothing to do.')
        return
    }
    if (fileEntries.length > 5000) {
        const continueAnswer = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'yes',
                default: false,
                message: chalk.bold.red(
                    `Are you sure to continue to process these ${fileEntries.length} files?`
                )
            }
        ])
        if (!continueAnswer.yes) {
            return
        }
    }
    startMs = Date.now()
    fileEntries = fileEntries.map((f, i) => {
        return {
            ...f,
            // argv,
            preset,
            startMs: startMs,
            index: i,
            total: fileEntries.length,
            testMode: testMode
        }
    })
    // todo udpate total and index
    // todo add progress bar
    log.showGreen(logTag, 'Now Preparing task files and ffmpeg cmd args...')
    let tasks = await pMap(fileEntries, prepareFFmpegCmd, { concurrency: argv.jobs || cpus().length * 2 })
    !testMode && log.fileLog(`ffmpegArgs:`, tasks.slice(-1)[0].ffmpegArgs, 'FFConv')
    tasks = tasks.filter(t => t && t.fileDst)
    if (tasks.length === 0) {
        log.showYellow(logTag, 'All tasks are skipped, nothing to do.')
        return
    }
    log.show('-----------------------------------------------------------')
    log.showYellow(logTag, 'PRESET:', core.pickTrueValues(preset))
    log.showYellow(logTag, 'CMD: ffmpeg', tasks.slice(-1)[0].ffmpegArgs.join(' '))
    log.show('-----------------------------------------------------------')
    testMode && log.showYellow('++++++++++ TEST MODE (DRY RUN) ++++++++++')
    log.showRed(logTag, 'Please CHECK task details BEFORE continue!')
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'yes',
            default: false,
            message: chalk.bold.red(
                `Are you sure to process these ${tasks.length} files?`
            )
        }
    ])
    // 检查ffmpeg可执行文件是否存在
    const ffmpegPath = await which("ffmpeg", { nothrow: true })
    if (!ffmpegPath) {
        throw new Error("ffmpeg executable not found in path")
    }
    if (!answer.yes) {
        return
    }
    // 记录开始时间
    startMs = Date.now()
    tasks.forEach((t, i) => {
        t.startMs = startMs
        t.index = i
        t.total = tasks.length
    })
    // 先写入一次LOG
    await log.flushFileLog()
    // 并发数视频1，音频4，或者参数指定
    const jobCount = argv.jobs || (argv.audioMode ? 4 : 1)
    const results = await pMap(tasks, runFFmpegCmd, { concurrency: jobCount })
    testMode && log.showYellow(logTag, 'NO file processed in TEST MODE.')
    const okResults = results.filter(r => r && r.ok)
    !testMode && log.showGreen(logTag, `Total ${okResults.length} files processed in ${helper.humanTime(startMs)}`)
}

async function runFFmpegCmd(entry) {
    const ipx = `${entry.index}/${entry.total}`
    const logTag = chalk.green('FFCMD')
    const ffmpegArgs = entry.ffmpegArgs
    log.show(logTag, `(${ipx}) ${entry.path} (${helper.humanSize(entry.size)}) (${entry.preset.name}) ${helper.humanTime(entry.startMs)}`)
    log.showGray(logTag, 'ffmpeg', ffmpegArgs.join(' '))
    const exePath = await which("ffmpeg")
    if (entry.testMode) {
        // 测试模式跳过
        log.show(logTag, `Skipped(${ipx}) ${entry.path} (${helper.humanSize(entry.size)}) [TestMode]`)
        return
    }
    try {
        await fs.remove(entry.fileDstTemp)
        // 此处 { shell: true } 必须，否则报错
        const ffmpegProcess = execa(exePath, ffmpegArgs, { shell: true })
        ffmpegProcess.pipeStdout(process.stdout)
        ffmpegProcess.pipeStderr(process.stderr)
        const { stdout, stderr } = await ffmpegProcess
        if (await fs.pathExists(entry.fileDstTemp)) {
            const dstSize = (await fs.stat(entry.fileDstTemp))?.size || 0
            if (dstSize > mf.FILE_SIZE_1K) {
                await fs.move(entry.fileDstTemp, entry.fileDst)
                log.showGreen(logTag, `(${ipx}) OK ${entry.fileDst} [${entry.dstBitrate || entry.preset.name}] (${helper.humanSize(dstSize)})`)
                log.fileLog(`OK(${ipx}) <${entry.fileDst}> [${entry.dstBitrate || entry.preset.name}] (${helper.humanSize(dstSize)})`, 'FFCMD')
                entry.ok = true
                return entry
            }
        }
        log.showYellow(logTag, `Failed(${ipx}) ${entry.path}`)
        log.fileLog(`Failed(${ipx}) <${entry.path}> [${entry.dstBitrate || entry.preset.name}]`, 'FFCMD')
    } catch (error) {
        const errMsg = error.message?.substring(0, 160) || error.message || '[unknown]'
        log.showRed(logTag, `Error(${ipx}) ${entry.path} ${errMsg}`)
        log.fileLog(`Error(${ipx}) <${entry.path}> [${entry.dstBitrate || entry.preset.name}] ${errMsg}`, 'FFCMD')
    } finally {
        await fs.remove(entry.fileDstTemp)
    }

}

async function prepareFFmpegCmd(entry) {
    const logTag = chalk.green('Prepare')
    const ipx = `${entry.index}/${entry.total}`
    log.info(logTag, `Processing(${ipx}) file: ${entry.path}`)
    const isAudio = helper.isAudioFile(entry.path)
    const fileSrc = entry.path
    const [srcDir, srcBase, srcExt] = helper.pathSplit(fileSrc)
    const preset = entry.preset
    const dstExt = preset.format || srcExt

    try {
        if (isAudio) {
            // 不带后缀只改扩展名的m4a文件，如果存在也需要首先忽略
            // 可能是其它压缩工具生成的文件，不需要重复压缩
            const fileDstSameDirNoSuffix = path.join(srcDir, `${srcBase}${dstExt}`)
            if (await fs.pathExists(fileDstSameDirNoSuffix)) {
                log.info(
                    logTag,
                    `(${ipx}) SkipDst0: ${helper.pathShort(fileSrc)} (${helper.humanSize(entry.size)})`)
                return false
            }
        }
        // 使用ffprobe读取媒体信息，速度较慢
        // 注意flac和ape格式的stream里没有bit_rate字段 format里有
        entry.info = await getMediaInfo(entry.path, { audio: isAudio })
        if (isAudio) {
            // 放前面，因为 dstBitrate 会用于前缀后缀参数
            // music-metadata 不支持tta和tak，需要修改
            const meta = await readMusicMeta(entry)
            entry.format = meta?.format
            entry.tags = meta?.tags
            // 如果ffprobe或music-metadata获取的数据中有比特率数据
            log.info(entry.name, preset.name)
            if (entry.format?.bitrate || entry.info?.bit_rate || entry.info?.format?.bit_rate) {
                const { srcBitrate, dstBitrate } = selectAudioBitrate(entry)
                // music-metada:bitrate, mediainfo:bit_rate
                log.info(logTag, `BitrateF:(FB,IB,IFB)`, (entry.format?.bitrate || 0).toFixed(2), entry.info?.bit_rate || 0, entry.info?.format.bit_rate || 0)
                log.info(logTag, `BitrateT:(SRC,DST,LOSELESS):`, srcBitrate.toFixed(2), dstBitrate, entry.format?.lossless ? "Loseless" : "Lossy")
                if (dstBitrate > 0) {
                    preset.audioBitrate = dstBitrate
                    entry.srcBitrate = srcBitrate
                    entry.dstBitrate = dstBitrate
                }
            } else {
                // 如果无法获取元数据，认为不是合法的音频文件，忽略
                log.showYellow('Prepare', `(${ipx}) SkipInvalid: ${entry.path} (${helper.humanSize(entry.size)})`)
                log.fileLog(`(${ipx}) SkipInvalid: <${entry.path}> (${helper.humanSize(entry.size)})`, 'Prepare')
                return false
            }
        } else {
            const ft = await fileTypeFromFile(fileSrc)
            // 忽略损坏的文件，记录日志
            if (!ft?.mime) {
                log.showYellow('Prepare', `(${ipx}) SkipCorrupted: ${fileSrc} (${helper.humanSize(entry.size)})`)
                log.fileLog(`(${ipx}) SkipCorrupted: <${entry.path}> (${helper.humanSize(entry.size)})`, 'Prepare')
                return false
            }
        }
        const replaceArgs = {
            ...preset,
            preset: preset.name,
            // audioBitrate: entry.dstBitrate || preset.audioBitrate
        }
        const prefix = helper.filenameSafe(formatArgs(preset.prefix || "", replaceArgs))
        const suffix = helper.filenameSafe(formatArgs(preset.suffix || "", replaceArgs))

        // 如果没有指定输出目录，直接输出在原文件同目录；否则使用指定输出目录
        const dstDir = preset.output ? helper.pathRewrite(srcDir, preset.output) : path.resolve(srcDir)
        const dstBase = `${prefix}${srcBase}${suffix}`
        const fileDst = path.join(dstDir, `${dstBase}${dstExt}`)
        // 临时文件后缀
        const tempSuffix = `_tmp@${helper.textHash(fileSrc)}@tmp_`
        // 临时文件名
        const fileDstTemp = path.join(dstDir, `${dstBase}${tempSuffix}${dstExt}`)
        const fileDstSameDir = path.join(srcDir, `${dstBase}${dstExt}`)

        if (await fs.pathExists(fileDst)) {
            log.info(
                logTag,
                `(${ipx}) SkipDst1: ${helper.pathShort(fileSrc)} (${helper.humanSize(entry.size)})`)
            return false
        }
        if (await fs.pathExists(fileDstSameDir)) {
            log.info(
                logTag,
                `(${ipx}) SkipDst2: ${helper.pathShort(fileSrc)} (${helper.humanSize(entry.size)})`)
            return false
        }
        if (await fs.pathExists(fileDstTemp)) {
            await fs.remove(fileDstTemp)
        }
        let entryInfo = ''
        if (entry.info?.codec_name) {
            const info = entry.info
            const infoSuffix = isAudio ? `${info.sample_rate}|${info.channels}` : `${info.width}x${info.height}`
            entryInfo = chalk.cyan(`[${info.codec_name},${Math.floor((info.format.bit_rate || info.bit_rate || 0) / 1000)}k,${infoSuffix}]`)
        }
        log.show(logTag, `(${ipx}) Task ${fileSrc} (${helper.humanSize(entry.size)}) ${entryInfo}`, chalk.yellow(isAudio ? entry.dstBitrate : entry.preset.name), helper.humanTime(entry.startMs))
        log.info(logTag, `(${ipx}) Task DST:${fileDst}`)
        // log.show(logTag, `Entry(${ipx})`, entry)
        const newEntry = {
            ...entry,
            fileDst,
            fileDstTemp,
        }
        const ffmpegArgs = createFFmpegArgs(newEntry)
        // log.info(logTag, 'ffmpeg', ffmpegArgs.join(' '))
        return Object.assign(newEntry, { ffmpegArgs })
    } catch (error) {
        log.warn(logTag, `(${ipx}) Error on ${fileSrc} ${error.message}`)
    }
}

// 读取单个音频文件的元数据
async function readMusicMeta(entry) {
    try {
        const mt = await mm.parseFile(entry.path, { skipCovers: true })
        if (mt?.format && mt.common) {
            // log.show('format', mt.format)
            // log.show('common', mt.common)
            log.info("Metadata", `Read(${entry.index}) ${entry.name} [${mt.format.codec}|${mt.format.duration}|${mt.format.bitrate}|${mt.format.lossless}, ${mt.common.artist},${mt.common.title},${mt.common.album}]`)
            return {
                format: mt.format,
                tags: mt.common
            }
        } else {
            log.info("Metadata", entry.index, "no tags found", helper.pathShort(entry.path))
        }
    } catch (error) {
        log.info("Metadata", entry.index, "no tags found", helper.pathShort(entry.path), error.message)
    }
}

function selectAudioBitrate(entry) {
    // eg. '-map a:0 -c:a libfdk_aac -b:a {bitrate}'
    let dstBitrate = 0
    const srcBitrate = entry.format?.bitrate
        || entry.info?.bit_rate
        || entry.info?.format?.bit_rate || 0
    if (
        srcBitrate > 320 * 1024
        || entry.format?.lossless
        || helper.isAudioLossless(entry.path)) {
        dstBitrate = 320
    } else if (srcBitrate > 256 * 1024) {
        dstBitrate = 256
    } else if (srcBitrate > 192 * 1024) {
        dstBitrate = 192
    } else {
        dstBitrate = 128
    }
    return { srcBitrate, dstBitrate }
}

function updateObject(target, source) {
    for (const key in source) {
        if (target.hasOwnProperty(key)) {
            target[key] = source[key]
        }
    }
    return target
}

// ===========================================
// 数据类定义
// ===========================================

// ffmpeg命令参数预设类
class Preset {
    constructor(name, {
        format,
        prefix,
        suffix,
        videoArgs,
        audioArgs,
        inputArgs,
        streamArgs,
        outputArgs,
        filters,
        complexFilter,
        output,
        videoBitrate = 0,
        videoQuality = 0,
        audioBitrate = 0,
        audioQuality = 0,
        dimension = 0,
        speed = 0
    }) {
        this.name = name
        this.format = format
        this.prefix = prefix
        this.suffix = suffix
        this.videoArgs = videoArgs
        this.audioArgs = audioArgs
        this.inputArgs = inputArgs
        this.streamArgs = streamArgs
        this.outputArgs = outputArgs
        this.filters = filters
        this.complexFilter = complexFilter
        // 输出目录
        this.output = output
        // 视频码率和质量
        this.videoBitrate = videoBitrate
        this.videoQuality = videoQuality
        // 音频码率和质量
        this.audioBitrate = audioBitrate
        this.audioQuality = audioQuality
        // 视频尺寸
        this.dimension = dimension
        // 视频加速
        this.speed = speed
    }

    update(options) {
        // return Object.assign(this, options)
        return updateObject(this, options)
    }

    getReplaceArgs() {
        return {
            prefix: this.prefix,
            suffix: this.suffix,
            audioBitrate: this.audioBitrate,
            audioQuality: this.audioQuality,
            videoBitrate: this.videoBitrate,
            videoQuality: this.videoQuality,
            dimension: this.dimension,
            speed: this.speed
        }
    }

    // 构造函数，参数为另一个 Preset 对象
    static fromPreset(preset) {
        return new Preset(preset.name, {
            format: preset.format,
            prefix: preset.prefix,
            suffix: preset.suffix,
            videoArgs: preset.videoArgs,
            audioArgs: preset.audioArgs,
            inputArgs: preset.inputArgs,
            streamArgs: preset.streamArgs,
            outputArgs: preset.outputArgs,
            filters: preset.filters,
            complexFilter: preset.complexFilter,
            output: preset.output,
            videoBitrate: preset.videoBitrate,
            videoQuality: preset.videoQuality,
            audioBitrate: preset.audioBitrate,
            audioQuality: preset.audioQuality,
            dimension: preset.dimension,
            speed: preset.speed
        })
    }

}

// videoArgs = { args,codec,quality,bitrate,filters}
// audioOptons = {args,codec, quality,bitrate,filters} 
// audioArgs = {prefix,suffix}

// HEVC基础参数
const HEVC_BASE = new Preset('hevc-base', {
    format: '.mp4',
    intro: 'hevc|hevc_nvenc|libfdk_aac',
    prefix: '[SHANA] ',
    suffix: '',
    description: 'HEVC_BASE',
    // 视频参数说明
    // video_codec block '-c:v hevc_nvenc -profile:v main -tune:v hq'
    // video_quality block '-cq {quality} -bufsize {bitrate} -maxrate {bitrate}'
    videoArgs: '-c:v hevc_nvenc -profile:v main -tune:v hq -cq {videoQuality} -bufsize {videoBitrate}k -maxrate {videoBitrate}k',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrate}'
    audioArgs: '-c:a libfdk_aac -b:a {audioBitrate}k',
    inputArgs: '',
    streamArgs: '',
    // 快速读取和播放
    outputArgs: '-movflags +faststart',
    filters: "scale='if(gte(iw,ih),min({dimension},iw),-2)':'if(lt(iw,ih),min({dimension},ih),-2)'",
    complexFilter: '',
})

// 音频AAC基础参数
const AAC_BASE = new Preset('aac_base', {
    format: '.m4a',
    intro: 'aac|libfdk_aac',
    prefix: '',
    suffix: '',
    // suffix: '_{audioBitrate}',
    description: 'AAC_BASE',
    videoArgs: '',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrate}'
    audioArgs: '-map a:0 -c:a libfdk_aac -b:a {audioBitrate}k',
    inputArgs: '',
    streamArgs: '',
    outputArgs: '-movflags +faststart',
    filters: '',
    complexFilter: '',
})

function initializePresets() {

    const PRESET_HEVC_ULTRA = Preset.fromPreset(HEVC_BASE).update({
        name: 'hevc_ultra',
        videoQuality: 20,
        videoBitrate: 20480,
        audioBitrate: 320,
        dimension: 3840
    })

    const PRESET_HEVC_4K = Preset.fromPreset(HEVC_BASE).update({
        name: 'hevc_4k',
        videoQuality: 23,
        videoBitrate: 10240,
        audioBitrate: 256,
        dimension: 3840
    })

    const PRESET_HEVC_2K = Preset.fromPreset(HEVC_BASE).update({
        name: 'hevc_2k',
        videoQuality: 23,
        videoBitrate: 4096,
        audioBitrate: 192,
        dimension: 1920
    })

    const PRESET_HEVC_LOW = Preset.fromPreset(HEVC_BASE).update({
        name: 'hevc_low',
        videoQuality: 26,
        videoBitrate: 2048,
        audioBitrate: 128,
        dimension: 1920
    })

    const PRESET_HEVC_LOWEST = Preset.fromPreset(HEVC_BASE).update({
        name: 'hevc_lowest',
        videoQuality: 26,
        videoBitrate: 512,
        audioBitrate: 128,
        dimension: 1920,
        streamArgs: '-map [v] -map [a]',
        // 音频参数说明
        // audio_codec block '-c:a libfdk_aac -profile:a aac_he'
        // audio_quality block '-b:a 48k'
        _audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a {audioBitrate}k',
        // 这里单引号必须，否则逗号需要转义，Windows太多坑
        complexFilter: formatArgs("[0:v]setpts=PTS/{speed},scale='if(gt(iw,1920),min(1920,iw),-2)':'if(gt(ih,1920),min(1920,ih),-2)'[v];[0:a]atempo={speed}[a]", { speed: 1.5 })
    })

    const presets = {
        //4K超高码率和质量
        PRESET_HEVC_ULTRA: PRESET_HEVC_ULTRA,
        //4k高码率和质量
        PRESET_HEVC_4K: PRESET_HEVC_4K,
        //2K高码率和质量
        PRESET_HEVC_2K: PRESET_HEVC_2K,
        // 2K低码率和质量
        PRESET_HEVC_LOW: PRESET_HEVC_LOW,
        // 极低画质和码率，适用于教程类视频
        PRESET_HEVC_LOWEST: PRESET_HEVC_LOWEST,
        //音频AAC最高码率
        PRESET_AAC_HIGH: {
            ...AAC_BASE,
            name: 'aac_high',
            audioBitrate: 320,
        },
        //音频AAC中码率
        PRESET_AAC_MEDIUM: {
            ...AAC_BASE,
            name: 'aac_medium',
            audioBitrate: 192,
        },
        // 音频AAC低码率
        PRESET_AAC_LOW: {
            ...AAC_BASE,
            name: 'aac_low',
            audioBitrate: 128,
        },
        // 音频AAC极低码率，适用人声
        PRESET_AAC_VOICE: {
            ...AAC_BASE,
            name: 'aac_voice',
            audioBitrate: 48,
            audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a {audioBitrate}k',
        }
    }

    core.modifyObjectWithKeyField(presets, 'description')
    for (const [key, preset] of Object.entries(presets)) {
        PRESET_NAMES.push(preset.name)
        PRESET_MAP.set(preset.name, preset)
    }
}

// 命令行参数示例
// ARGV: {
//     _: [ 'ffmpeg' ],
//     preset: 'hevc_lowest',
//     vm: true,
//     'video-mode': true,
//     videoMode: true,
//     speed: 2,
//     extensions: '.mp4|.mov|.wmv|.avi|.mkv|.m4v|.ts|.flv|.webm',
//     e: '.mp4|.mov|.wmv|.avi|.mkv|.m4v|.ts|.flv|.webm',
//     override: false,
//     O: false,
//     prefix: '[SHANA] ',
//     P: '[SHANA] ',
//     suffix: '',
//     S: '',
//     'video-codec': 'hevc_nvenc',
//     videoCodec: 'hevc_nvenc',
//     'video-quality': '0',
//     vq: '0',
//     videoQuality: '0',
//     'audio-codec': 'libfdk_aac',
//     audioCodec: 'libfdk_aac',
//     'audio-quality': '0',
//     aq: '0',
//     audioQuality: '0',
//     verbose: 0,
//     v: 0,
//     input: '.'
//   }
//
// 预设示例
// PRESET: {
//     name: 'hevc_lowest',
//     description: 'PRESET_HEVC_LOWEST',
//     videoArgs: '-c:v hevc_nvenc -profile:v main -tune:v hq -cq 26 -bufsize 512k -maxrate 512k',
//     audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a 48k',
//     inputArgs: '',
//     streamArgs: '-map [v] -map [a]',
//     extraArgs: '',
//     outputArgs: '-movflags +faststart',
//     filters: '',
//     complexFilter: "[0:v]setpts=PTS/1.5,scale='if(gt(iw,1920),min(1920,iw),-2)':'if(gt(ih,1920),min(1920,ih),-2)'[v];[0:a]atempo=1.5[a]"
//   }
//
function preparePreset(argv) {
    const defaultName = argv.audioMode ? "aac_medium" : "hevc_2k"
    let preset = PRESET_MAP.get(argv.preset || defaultName)
    // 克隆对象，不修改Map中的内容
    preset = structuredClone(preset)
    // 保存argv方便调试
    // preset.argv = JSON.stringify(argv)
    if (argv.prefix?.length > 0) {
        preset.prefix = argv.prefix
    }
    if (argv.suffix?.length > 0) {
        preset.suffix = argv.suffix
    }
    if (argv.videoArgs?.length > 0) {
        preset._videoArgs = argv.videoArgs
    }
    if (argv.audioArgs?.length > 0) {
        preset._audioArgs = argv.audioArgs
    }
    if (argv.filters?.length > 0) {
        preset.filters = argv.filters
    }
    if (argv.filterComplex?.length > 0) {
        preset.complexFilter = argv.filterComplex
    }
    // 输出目录
    if (argv.output?.length > 0) {
        preset.output = path.resolve(argv.output)
    }
    // 视频尺寸
    if (argv.dimension > 0) {
        preset.dimension = String(argv.dimension)
    }
    // 视频速度
    if (argv.speed > 0) {
        preset.speed = argv.speed
    }
    // 视频码率
    if (argv.videoBitrate > 0) {
        preset.videoBitrate = argv.videoBitrate
    }
    if (argv.videoQuality > 0) {
        preset.videoQuality = argv.videoQuality
    }
    // 音频码率
    if (argv.audioBitrate > 0) {
        preset.audioBitrate = argv.audioBitrate
    }
    if (argv.audioQuality > 0) {
        preset.audioQuality = argv.audioQuality
    }

    return preset
}



function createFFmpegArgs(entry) {
    const preset = entry.preset
    // 显示详细信息
    // let args = "-hide_banner -n -loglevel repeat+level+info -stats".split(" ")
    // 只显示进度和错误
    let args = "-hide_banner -n -v warning -stats".split(" ")
    // 输入参数在输入文件前面，顺序重要
    if (preset.inputArgs?.length > 0) {
        args = args.concat(this.preset.inputArgs.split(' '))
    }
    args.push('-i')
    args.push(`"${entry.path}"`)
    if (preset.filters?.length > 0) {
        args.push('-vf')
        args.push(formatArgs(preset.filters, preset))
    }
    // 在输入文件后面
    if (preset.complexFilter?.length > 0) {
        args.push('-filter_complex')
        args.push(`"${formatArgs(preset.complexFilter, preset)}"`)
    }
    // 在输入文件后面
    if (preset.streamArgs?.length > 0) {
        args = args.concat(preset.streamArgs.split(' '))
    }
    if (preset.videoArgs?.length > 0) {
        const va = formatArgs(preset.videoArgs, preset)
        args = args.concat(va.split(' '))
    }
    if (preset.audioArgs?.length > 0) {
        const aa = formatArgs(preset.audioArgs, {
            ...preset,
            audioBitrate: entry.dstBitrate || preset.audioBitrate
        })
        args = args.concat(aa.split(' '))
    }
    // 其它参数
    if (preset.extraArgs?.length > 0) {
        args = args.concat(preset.extraArgs.split(' '))
    }
    // 输出参数在最后，在输出文件前面，顺序重要
    if (preset.outputArgs?.length > 0) {
        args = args.concat(preset.outputArgs.split(' '))
    }
    args.push(`"${entry.fileDstTemp}"`)
    return args
}

// 初始化调用
initializePresets()