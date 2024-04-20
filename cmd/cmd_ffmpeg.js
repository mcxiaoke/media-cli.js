/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk'
import { $, execa } from 'execa'
import fs from 'fs-extra'
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import which from "which"
import * as core from '../lib/core.js'
import { formatArgs } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'


const LOG_TAG = "FFMPEG"

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
            default: VIDEO_EXTENSIONS.join('|'),
            describe: "include files by extensions (eg. .wav|.flac)",
        })
        // 选择预设，从预设列表中选一个，预设等于一堆预定义参数
        .option("preset", {
            type: "choices",
            choices: PRESET_NAMES,
            default: 'hevc_2k',
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
            aliases: ["va"],
            type: "string",
            describe: "Set video args in ffmpeg command",
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
            aliases: ["aa"],
            type: "string",
            describe: "Set audio args in ffmpeg command",
        })
        // ffmpeg filter string
        .option("filters", {
            aliases: ["fs"],
            type: "string",
            describe: "Set filters in ffmpeg command",
        })
        // ffmpeg complex filter string
        .option("filter-complex", {
            aliases: ["fc"],
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
    const logTag = 'FFConv'
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`)
    }
    const startMs = Date.now()
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
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
        log.fileLog(`Preset: ${JSON.stringify(preset)}`, logTag)
    }
    // 只包含视频文件或音频文件
    let fileEntries = await mf.walk(root, {
        needStats: true,
        entryFilter: (e) => {
            if (!e.isFile) { return false }
            const isMedia = (argv.videoMode ?
                helper.isVideoFile(e.name) :
                helper.isAudioFile(e.name))
            if (extensions?.length > 0) {
                // 如果有扩展名，则启用扩展名过滤
                return isMedia && extensions.includes(helper.pathExt(e.path))
            } else {
                return isMedia
            }
        }
    })
    // 过滤掉压缩过的文件
    fileEntries = fileEntries.filter(entry => !entry.name.toLowerCase().includes('shana'))
    fileEntries = fileEntries.map((f, i) => {
        return {
            ...f,
            argv,
            preset,
            index: i,
            total: fileEntries.length,
            testMode: testMode
        }
    })
    log.show(logTag, `Total ${fileEntries.length} files found in ${helper.humanTime(startMs)}`)
    if (fileEntries.length === 0) {
        log.showYellow(logTag, 'Nothing to do, abrot.')
        return
    }
    let tasks = await pMap(fileEntries, checkAndPrepare, { concurrency: cpus().length * 4 })
    tasks = tasks.filter(t => t && t.fileDst)
    log.showYellow('PRESET:', preset)
    testMode && log.showYellow('++++++++++ TEST MODE (DRY RUN) ++++++++++')
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'yes',
            default: false,
            message: chalk.bold.red(
                `Are you sure to process these ${fileEntries.length} files?`
            )
        }
    ])
    // 检查ffmpeg可执行文件是否存在
    const ffmpegPath = await which("ffmpeg", { nothrow: true })
    if (!ffmpegPath) {
        throw new Error("ffmpeg executable not found in path")
    }
    if (answer.yes) {
        const results = await core.asyncMap(tasks, runFFmpegCmd)
        log.showGreen(logTag, `Total ${results.length} files processed in ${helper.humanTime(startMs)}`)
    }
}

async function runFFmpegCmd(entry) {
    const logTag = 'FFCMD'
    const ffmpegArgs = createFFmpegArgs(entry, entry.preset)
    log.showYellow(logTag, `INPUT(${entry.index}) ${entry.path} (${helper.humanSize(entry.size)}) (${entry.preset.name})`)
    log.showGray(logTag, 'ffmpeg', ffmpegArgs.join(' '))
    const exePath = await which("ffmpeg")
    if (entry.testMode) {
        // 测试模式跳过
        log.show(logTag, `[TestMode]Skipped(${entry.index}) ${entry.path}`)
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
                log.showGreen(logTag, `OUTPUT(${entry.index}) ${entry.fileDst} (${helper.humanSize(dstSize)})`)
                log.fileLog(`OUTPUT(${entry.index}) <${entry.fileDst}>`, logTag)
                entry.done = true
                return entry
            }
        }
        log.showYellow(logTag, `Failed(${entry.index}) ${entry.path}`)
        log.fileLog(`Failed(${entry.index}) <${entry.path}>`, logTag)
    } catch (error) {
        log.showRed(logTag, `Error(${entry.index}) ${entry.path} ${error}`)
        log.fileLog(`Error(${entry.index}) <${entry.path}> ${error}`, logTag)
    }

}

async function checkAndPrepare(entry) {
    const logTag = 'Prepare'
    const preset = entry.preset
    const index = entry.index + 1
    const replaceArgs = {
        preset: `_${preset.name}`,
    }
    const prefix = formatArgs(preset.prefix || "", replaceArgs)
    const suffix = formatArgs(preset.suffix || "", replaceArgs)
    const fileSrc = entry.path
    const dstExt = preset.format || ext
    const [dir, base, ext] = helper.pathSplit(fileSrc)
    // 如果没有指定输出目录，直接输出在原文件同目录；否则使用指定输出目录
    const dstDir = preset.output ? helper.pathRewrite(dir, preset.output) : path.resolve(dir)
    const dstBase = `${prefix}${base}${suffix}`
    const fileDst = path.join(dstDir, `${dstBase}${dstExt}`)
    const fileDstTemp = path.join(dstDir, `${dstBase}_tmp@${Date.now()}${dstExt}`)
    const fileDstSameDir = path.join(dir, `${dstBase}${dstExt}`)

    if (await fs.pathExists(fileDstTemp)) {
        await fs.remove(fileDstTemp)
    }

    if (await fs.pathExists(fileDst)) {
        log.showGray(
            logTag,
            `SkipDst1(${index}): ${helper.pathShort(fileSrc)} (${helper.humanSize(entry.size)})`)
        return false
    }

    if (await fs.pathExists(fileDstSameDir)) {
        log.showGray(
            logTag,
            `SkipDst2(${index}): ${helper.pathShort(fileSrc)} (${helper.humanSize(entry.size)})`)
        return false
    }

    log.show(logTag, `AddTask(${index}) SRC: ${fileSrc} (${helper.humanSize(entry.size)})`)
    log.showGray(logTag, `AddTask(${index}) DST: ${fileDst}`)
    return {
        ...entry,
        fileDst,
        fileDstTemp,
    }
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
        complexFilter
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
        this.output = null
    }
}

// videoArgs = { args,codec,quality,bitrate,filters}
// audioOptons = {args,codec, quality,bitrate,filters} 
// audioArgs = {prefix,suffix}

// HEVC基础参数
const HEVC_BASE = new Preset('hevc-base', {
    format: '.mp4',
    prefix: '[SHANA] ',
    suffix: '',
    description: 'HEVC_BASE',
    // 视频参数说明
    // video_codec block '-c:v hevc_nvenc -profile:v main -tune:v hq'
    // video_quality block '-cq {quality} -bufsize {bitrate} -maxrate {bitrate}'
    videoArgs: '-c:v hevc_nvenc -profile:v main -tune:v hq -cq {quality} -bufsize {bitrate} -maxrate {bitrate}',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrate}'
    audioArgs: '-c:a libfdk_aac -b:a {bitrate}',
    inputArgs: '',
    streamArgs: '',
    // 快速读取和播放
    outputArgs: '-movflags +faststart',
    filters: "scale='if(gt(iw,{dimension}),min({dimension},iw),-2)':'if(gt(ih,{dimension}),min({dimension},ih),-2)'",
    complexFilter: '',
})

// 音频AAC基础参数
const AAC_BASE = new Preset('aac_base', {
    format: '.m4a',
    prefix: '',
    suffix: '',
    description: 'AAC_BASE',
    videoArgs: '',
    // 音频参数说明
    // audio_codec block '-c:a libfdk_aac'
    // audio_quality block '-b:a {bitrate}'
    audioArgs: '-map a:0 -c:a libfdk_aac -b:a {bitrate}',
    inputArgs: '',
    streamArgs: '',
    outputArgs: '-movflags +faststart',
    filters: '',
    complexFilter: '',
})

function initializePresets() {

    const presets = {
        //4K超高码率和质量
        PRESET_HEVC_ULTRA: {
            ...HEVC_BASE,
            name: 'hevc_ultra',
            videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 20, bitrate: '20480K' }),
            audioArgs: formatArgs(HEVC_BASE.audioArgs, { bitrate: '320k' }),
            filters: formatArgs(HEVC_BASE.filters, { dimension: '3840' })
        },
        //4k高码率和质量
        PRESET_HEVC_4K: {
            ...HEVC_BASE,
            name: 'hevc_4k',
            videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 23, bitrate: '10240K' }),
            audioArgs: formatArgs(HEVC_BASE.audioArgs, { bitrate: '256k' }),
            filters: formatArgs(HEVC_BASE.filters, { dimension: '3840' })
        },
        //2K高码率和质量
        PRESET_HEVC_2K: {
            ...HEVC_BASE,
            name: 'hevc_2k',
            videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 23, bitrate: '4096K' }),
            audioArgs: formatArgs(HEVC_BASE.audioArgs, { bitrate: '192k' }),
            filters: formatArgs(HEVC_BASE.filters, { dimension: '1920' }),
        },
        // 2K低码率和质量
        PRESET_HEVC_LOW: {
            ...HEVC_BASE,
            name: 'hevc_low',
            videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 26, bitrate: '2048K' }),
            audioArgs: formatArgs(HEVC_BASE.audioArgs, { bitrate: '128k' }),
            filters: formatArgs(HEVC_BASE.filters, { dimension: '1920' })
        },
        // 极低画质和码率，适用于教程类视频
        PRESET_HEVC_LOWEST: {
            ...HEVC_BASE,
            name: 'hevc_lowest',
            streamArgs: '-map [v] -map [a]',
            videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 26, bitrate: '512k' }),
            // 音频参数说明
            // audio_codec block '-c:a libfdk_aac -profile:a aac_he'
            // audio_quality block '-b:a 48k'
            audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a 48k',
            filters: '',
            // 这里单引号必须，否则逗号需要转义，Windows太多坑
            complexFilter: formatArgs("[0:v]setpts=PTS/{speed},scale='if(gt(iw,1920),min(1920,iw),-2)':'if(gt(ih,1920),min(1920,ih),-2)'[v];[0:a]atempo={speed}[a]", { speed: 1.5 })
        },
        //音频AAC最高码率
        PRESET_AAC_HIGH: {
            ...AAC_BASE,
            name: 'aac_high',
            audioArgs: formatArgs(AAC_BASE.audioArgs, { bitrate: '320k' }),
        },
        //音频AAC中码率
        PRESET_AAC_MEDIUM: {
            ...AAC_BASE,
            name: 'aac_medium',
            audioArgs: formatArgs(AAC_BASE.audioArgs, { bitrate: '192k' }),
        },
        // 音频AAC低码率
        PRESET_AAC_LOW: {
            ...AAC_BASE,
            name: 'aac_medium',
            audioArgs: formatArgs(AAC_BASE.audioArgs, { bitrate: '128k' }),
        },
        // 音频AAC极低码率，适用人声
        PRESET_AAC_VOICE: {
            ...AAC_BASE,
            name: 'aac_voice',
            audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a 48k',
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
    preset.argv = JSON.stringify(argv)
    if (argv.prefix?.length > 0) {
        preset.prefix = argv.prefix
    }
    if (argv.suffix?.length > 0) {
        preset.suffix = argv.suffix
    }
    // 输出目录
    if (argv.output?.length > 0) {
        preset.output = path.resolve(argv.output)
    }
    // 假设最小长度
    if (argv.videoArgs?.length > 5) {
        preset.videoArgs = argv.videoArgs
    }
    if (argv.audioArgs?.length > 5) {
        preset.audioArgs = argv.audioArgs
    }
    if (argv.filters?.length > 5) {
        preset.filters = argv.filters
    }
    if (argv.filterComplex?.length > 5) {
        preset.complexFilter = argv.filterComplex
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
        args.push(`${preset.filters}`)
    }
    // 在输入文件后面
    if (preset.complexFilter?.length > 0) {
        args.push('-filter_complex')
        args.push(`"${preset.complexFilter}"`)
    }
    // 在输入文件后面
    if (preset.streamArgs?.length > 0) {
        args = args.concat(preset.streamArgs.split(' '))
    }
    if (preset.videoArgs?.length > 0) {
        args = args.concat(preset.videoArgs.split(' '))
    }
    if (preset.audioArgs?.length > 0) {
        args = args.concat(preset.audioArgs.split(' '))
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