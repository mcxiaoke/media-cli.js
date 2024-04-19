/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk'
import { spawn, spawnSync } from 'child_process'
import { $, execa } from 'execa'
import fs from 'fs-extra'
import iconv from "iconv-lite"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import { argv } from 'process'
import which from "which"
import * as core from '../lib/core.js'
import { asyncFilter, asyncMap, compareSmartBy, formatArgs } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as enc from '../lib/encoding.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'


const LOG_TAG = "FFMPEG"

const PRESET_NAMEs = []
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
            default: helper.VIDEO_FORMATS.join('|'),
            describe: "include files by extensions (eg. .wav|.flac)",
        })
        // 选择预设，从预设列表中选一个，预设等于一堆预定义参数
        .option("preset", {
            type: "choices",
            choices: PRESET_NAMEs,
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
            default: '[SHANA] ',
            describe: "add prefix to output filename",
        })
        // 输出文件名后缀
        // 同上
        .option("suffix", {
            alias: "S",
            type: "string",
            describe: "add suffix to filename",
        })
        // 视频模式
        // 等于 --preset hevc_2k
        .option("video-mode", {
            alias: "vm",
            type: "boolean",
            describe: "convert video with default preset:hevc_2k",
        })
        // 视频选项
        // video-args = video-encoder + video-quality 
        // 如果此选项存在，会忽略其它 video-xxx 参数
        .option("video-args", {
            aliases: ["vo"],
            type: "string",
            describe: "Set video args in ffmpeg command",
        })
        // 视频编码器，例如 hevc_nvenc
        .option("video-encoder", {
            aliases: ["ve"],
            type: "string",
            default: "hevc_nvenc",
            describe: "Set video encoder (eg. hevc_nvenc) in ffmpeg command",
        })
        // 视频质量，例如 -cq 23 -maxrate 1000K
        .option("video-quality", {
            alias: "vq",
            type: "string",
            default: "0",
            describe: "video quality, cq cr qp or max bitrate in kbytes",
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
            aliases: ["ao"],
            type: "string",
            describe: "Set audio args in ffmpeg command",
        })
        // 音频编码器，例如 libfdk_aac 
        .option("audio-encoder", {
            aliases: ["ae"],
            type: "string",
            default: "libfdk_aac",
            describe: "Set auduo encoder (eg. libfdk_aac) in ffmpeg command",
        })
        // 音频质量，例如 -vbr 5 -b:a 128k
        .option("audio-quality", {
            alias: "aq",
            type: "string",
            default: "0",
            describe: "audio quality, vbr or bitrate, eg. 128/192/256/320 in kbytes",
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
            description: "execute os operations in real mode, not dry run",
        })
}


const handler = cmdConvert

async function cmdConvert(argv) {
    const testMode = !argv.doit
    const logTag = 'FFMPEG'
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`)
    }

    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
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
    const preset = PRESET_MAP.get(argv.preset)
    log.showGreen('PRESET:', preset)
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
    fileEntries = fileEntries.filter(entry => !entry.name.toLowerCase().includes('shana'))
    fileEntries = fileEntries.sort(compareSmartBy('path'))
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
    const showFiles = fileEntries.slice(-20)
    for (const f of showFiles) {
        log.show(logTag, 'File:', helper.pathShort(f.path), helper.humanSize(f.size))
    }
    if (showFiles.length < fileEntries.length) {
        log.show(logTag, `Above lines are last 20 files, total ${fileEntries.length} files.`)
    }
    log.show(logTag, `Total ${fileEntries.length} files found in ${helper.humanTime(startMs)}`)
    log.show(logTag, argv)

    if (fileEntries.length === 0) {
        log.showYellow(logTag, 'Nothing to do, abrot.')
        return
    }
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

    const ffmpegPath = await which("ffmpeg", { nothrow: true })
    if (!ffmpegPath) {
        throw new Error("ffmpeg executable not found in path")
    }

    if (answer.yes) {
        let tasks = await pMap(fileEntries, checkOneFile, { concurrency: cpus().length * 4 })
        tasks = tasks.filter(t => t?.fileDstTemp)
        for (const task of tasks) {
            await processOneFile(task)
            // 测试模式仅运行一次
            if (testMode) {
                return
            }
        }
    }
}

function fixEncoding(str = '') {
    return iconv.decode(Buffer.from(str, 'binary'), 'cp936')
}

async function processOneFile(task) {
    const logTag = 'processOneFile'
    log.showGreen('Processing ', task.fileSrc)
    const exePath = await which("ffmpeg", { nothrow: true })
    // try {
    const testArgs = [
        '-hide_banner',
        '-i',
        `${task.fileSrc}`,
        '-vf',
        "scale='if(gt(iw,1920),min(1920,iw),-2)':'if(gt(ih,1920),min(1920,ih),-2)'",
        '-c:v',
        "hevc_nvenc",
        "-maxrate",
        "4096k",
        `${task.fileDstTemp}`

    ]
    // 留存一个ffmpeg可以正常解析的参数列表
    const taskArgsWorked = [
        '-hide_banner',
        '-n',
        '-loglevel',
        'repeat+level+info',
        '-i',
        `${task.fileSrc}`,
        '-vf',
        "scale='if(gt(iw,1920),min(1920,iw),-2)':'if(gt(ih,1920),min(1920,ih),-2)'",
        '-c:v',
        'hevc_nvenc',
        '-profile:v',
        'main',
        '-cq',
        '23',
        '-tune:v',
        'hq',
        '-bufsize',
        '4096K',
        '-maxrate',
        '4096K',
        '-c:a',
        'libfdk_aac',
        '-b:a',
        '192k',
        '-movflags',
        '+faststart',
        `${task.fileDstTemp}`
    ]

    // 这个也可以正常解析
    const gptArgs = [
        '-hide_banner',
        '-n',
        '-loglevel', 'repeat+level+info',
        '-i',
        `${task.fileSrc}`,
        '-filter_complex',
        '[0:v]setpts=PTS/1.5,scale=w=min(iw\\,1920):h=min(ih\\,1920)[v];[0:a]atempo=1.5[a]',
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'hevc_nvenc',
        '-profile:v', 'main',
        '-cq', '26',
        '-tune:v', 'hq',
        '-bufsize', '512k',
        '-maxrate', '512k',
        '-c:a', 'libfdk_aac',
        '-profile:a', 'aac_he',
        '-b:a', '48k',
        '-movflags', '+faststart',
        `"${task.fileDstTemp}"`
    ]
    log.showGreen('==', task.getCommdArgs().join(' '))
    log.showYellow('==', gptArgs.join(' '))

    const ffmpegProcessPromise = execa(exePath, task.getCommdArgs(), { shell: true })
    ffmpegProcessPromise.stdout.pipe(process.stdout)
    const { stdout, stderr } = await ffmpegProcessPromise
    log.show(logTag, stdout, process.pid)
    log.showYellow(logTag, stderr, process.pid)

    throw new Error('Abort')
    // const sOut = fixEncoding(stdout || "NULL")
    // const sErr = fixEncoding(stderr || "NULL")
    // log.show(logTag, "stdout", sOut)
    // log.show(logTag, "stderr", sErr)
    // } catch (error) {
    //     log.warn(logTag, fileSrc, error)
    // }
}

async function checkOneFile(fileEntry) {
    const logTag = 'checkOneFile'
    const argv = fileEntry.argv
    const index = fileEntry.index + 1
    const prefix = argv.prefix || ""
    const suffix = argv.suffix || ""
    const dstExt = argv.videoMode ? ".mp4" : ".m4a"
    const [dir, base, ext] = helper.pathSplit(fileEntry.path)
    // 如果没有指定输出目录，直接输出在原文件同目录；否则使用指定输出目录
    const dstDir = argv.output ? helper.pathRewrite(dir, task.output) : path.resolve(dir)

    const dstNameBase = `${prefix}${base}${suffix}`
    const fileDst = path.join(dstDir, `${dstNameBase}${dstExt}`)
    const fileDstTemp = path.join(dstDir, `TMP_FFMPEG_OUT_${dstNameBase}${dstExt}`)
    const fileDstSameDir = path.join(dir, `${dstNameBase}${dstExt}`)
    log.info(logTag, `SRC (${index}): ${helper.pathShort(fileEntry.path)}`)
    log.info(logTag, `DST (${index}): ${helper.pathShort(fileDst)}`)

    const task = new ConvertTask(fileEntry.preset, fileEntry, fileDst, fileDstTemp)

    if (await fs.pathExists(fileDstTemp)) {
        await fs.remove(fileDstTemp)
    }

    if (await fs.pathExists(fileDst)) {
        log.showGray(
            logTag,
            `Exists1(${index}): ${helper.pathShort(fileDst)}`, index
        )
        return false
    }

    if (await fs.pathExists(fileDstSameDir)) {
        log.showGray(
            logTag,
            `Exists2(${index}): ${helper.pathShort(fileDstSameDir)}`, index
        )
        return false
    }

    log.show(logTag, `OK(${index}): ${helper.pathShort(fileDst)}`)
    // log.showYellow(task.getCommdArgs().join(' '))
    return task

}

// ===========================================
// 数据类定义
// ===========================================

// ffmpeg命令参数预设类
class Preset {
    constructor(name, {
        description,
        videoArgs,
        audioArgs,
        inputArgs,
        streamArgs,
        outputArgs,
        filters,
        complexFilter,
        extraArgs
    }) {
        this.name = name
        this.description = description
        this.videoArgs = videoArgs
        this.audioArgs = audioArgs
        this.inputArgs = inputArgs
        this.streamArgs = streamArgs
        this.outputArgs = outputArgs
        this.filters = filters
        this.complexFilter = complexFilter
        this.extraArgs = extraArgs
    }
}

class ConvertTask {
    constructor(preset, entry, fileDst, fileDstTemp) {
        this.preset = preset
        this.entry = entry
        this.fileSrc = entry.path
        this.fileDstDir = path.dirname(fileDst)
        this.fileDst = fileDst
        this.fileDstTemp = fileDstTemp
    }

    getCommdArgs() {
        // let args = "-hide_banner -n -loglevel repeat+level+info".split(" ")
        let args = "-hide_banner -n -v error".split(" ")
        // 输入参数在输入文件前面，顺序重要
        if (this.preset.inputArgs?.length > 0) {
            args = args.concat(this.preset.inputArgs.split(' '))
        }
        args.push('-i')
        args.push(`${this.fileSrc}`)
        if (this.preset.filters?.length > 0) {
            args.push('-vf')
            args.push(`${this.preset.filters}`)
        }
        // 在输入文件后面
        if (this.preset.complexFilter?.length > 0) {
            args.push('-filter_complex')
            args.push(`"${this.preset.complexFilter}"`)
        }
        // 在输入文件后面
        if (this.preset.streamArgs?.length > 0) {
            args = args.concat(this.preset.streamArgs.split(' '))
        }
        if (this.preset.videoArgs?.length > 0) {
            args = args.concat(this.preset.videoArgs.split(' '))
        }
        if (this.preset.audioArgs?.length > 0) {
            args = args.concat(this.preset.audioArgs.split(' '))
        }
        // 其它参数
        if (this.preset.extraArgs?.length > 0) {
            args = args.concat(this.preset.extraArgs.split(' '))
        }
        // 输出参数在最后，在输出文件前面，顺序重要
        if (this.preset.outputArgs?.length > 0) {
            args = args.concat(this.preset.outputArgs.split(' '))
        }
        args.push(`"${this.fileDstTemp}"`)
        return args
    }
}


// videoArgs = { args,codec,quality,bitrate,filters}
// audioOptons = {args,codec, quality,bitrate,filters} 
// audioArgs = {prefix,suffix}

// HEVC基础参数
const HEVC_BASE = new Preset('hevc-base', {
    description: 'HEVC_BASE',
    namePrefix: '[SHANA] ',
    streamArgs: '',
    videoArgs: '-c:v hevc_nvenc -profile:v main -cq {quality} -tune:v hq -bufsize {bitrate} -maxrate {bitrate}',
    audioArgs: '-c:a libfdk_aac -b:a {bitrate}',
    extraArgs: '',
    // 快速读取和播放
    outputArgs: '-movflags +faststart',
    filters: "scale='if(gt(iw,{dimension}),min({dimension},iw),-2)':'if(gt(ih,{dimension}),min({dimension},ih),-2)'",
})

// 音频AAC基础参数
const AAC_BASE = new Preset('aac_base', {
    description: 'AAC_BASE',
    namePrefix: '',
    nameSuffix: '',
    videoArgs: '',
    audioArgs: '-map a:0 -c:a libfdk_aac -b:a {bitrate}',
    inputArgs: '',
    outputArgs: '',
    filters: '',
    complexFilter: '',
    extraArgs: ''
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
            filters: formatArgs(HEVC_BASE.filters, { dimension: '1920' })
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
            audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a 48k',
            filters: '',
            // 这里单引号必须，否则逗号需要转义，Windows太多坑
            complexFilterOK: "[0:v]setpts=PTS/1.5,scale='if(gt(iw,1920),min(1920,iw),-2)':'if(gt(ih,1920),min(1920,ih),-2)'[v];[0:a]atempo=1.5[a]",
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
            name: 'aac_high',
            audioArgs: formatArgs(AAC_BASE.audioArgs, { bitrate: '192k' }),
        },
        // 音频AAC低码率
        PRESET_AAC_LOW: {
            ...AAC_BASE,
            name: 'aac_high',
            audioArgs: formatArgs(AAC_BASE.audioArgs, { bitrate: '128k' }),
        }
    }

    core.modifyObjectWithKeyField(presets, 'description')
    for (const [key, preset] of Object.entries(presets)) {
        // console.log(key, preset.name)
        PRESET_NAMEs.push(preset.name)
        PRESET_MAP.set(preset.name, preset)
    }
    // console.log(Object.entries(presets))
}

// 初始化调用
initializePresets()