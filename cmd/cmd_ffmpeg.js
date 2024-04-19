/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import * as core from '../lib/core.js'
import { asyncFilter, asyncMap, compareSmartBy, countAndSort, formatArgs } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as enc from '../lib/encoding.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'

const LOG_TAG = "AVConv"

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
        // {width},{height},{dimension},{bitrate},{speed}
        // 然后模板解析替换字符串变量
        .option("prefix", {
            alias: "P",
            type: "string",
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
    const logTag = 'ffmpeg'
    log.info(logTag, argv)
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

    // 只包含视频文件或音频文件
    let files = await mf.walk(root, {
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
    files = files.sort(compareSmartBy('path'))
    files = files.map((f, i) => {
        return {
            ...f,
            // 参数透传
            argv,
            index: i,
            total: files.length,
            testMode: testMode
        }
    })
    const showFiles = files.slice(-20)
    for (const f of showFiles) {
        log.show(logTag, 'File:', helper.pathShort(f.path), helper.humanSize(f.size))
    }
    if (showFiles.length < files.length) {
        log.show(logTag, `Above lines are last 20 files, total ${files.length} files.`)
    }
    log.show(logTag, `Total ${files.length} files found in ${helper.humanTime(startMs)}`)
    log.show(logTag, argv)

    if (files.length === 0) {
        log.showYellow(logTag, 'Nothing to do, abrot.')
        return
    }

    files = files.slice(argv.start, argv.start + argv.count)

    testMode && log.showYellow('++++++++++ TEST MODE (DRY RUN) ++++++++++')
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'yes',
            default: false,
            message: chalk.bold.red(
                `Are you sure to process these ${files.length} files?`
            )
        }
    ])

    if (answer.yes) {
        return
    }
}



// ===========================================
// 数据类定义
// ===========================================

// ffmpeg命令参数预设类
class Preset {
    constructor(name, {
        description,
        namePrefix,
        nameSuffix,
        videoArgs,
        audioArgs,
        inputArgs,
        outputArgs,
        filters,
        complexFilter,
        extraArgs
    }) {
        this.name = name
        this.description = description
        this.namePrefix = namePrefix
        this.nameSuffix = nameSuffix
        this.videoArgs = videoArgs
        this.audioArgs = audioArgs
        this.inputArgs = inputArgs
        this.outputArgs = outputArgs
        this.filters = filters
        this.complexFilter = complexFilter
        this.extraArgs = extraArgs
    }
}

class Command {
    constructor(filepath, preset) {
        this.filepath = filepath
        this.preset = preset
    }
}


// videoArgs = { args,codec,quality,bitrate,filters}
// audioOptons = {args,codec, quality,bitrate,filters} 
// audioArgs = {prefix,suffix}

// HEVC基础参数
const HEVC_BASE = new Preset('hevc-base', {
    description: 'HEVC_BASE',
    namePrefix: '[SHANA] ',
    videoArgs: '-c:v hevc_nvenc -profile:v main -cq {quality} -tune:v hq -bufsize {bitrate} -maxrate {bitrate}',
    audioArgs: '-map a:0 -c:a libfdk_aac -b:a {bitrate}',
    // 快速读取和播放
    outputArgs: '-movflags +faststart -f mp4',
    filters: "scale='if(gt(iw,{dimension}),min({dimension},iw),-1)':'if(gt(ih,{dimension}),min({dimension},ih),-1)'",
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
            videoArgs: formatArgs(HEVC_BASE.videoArgs, { quality: 26, bitrate: '512k' }),
            audioArgs: '-c:a libfdk_aac -profile:a aac_he -b:a 48k',
            filters: '',
            complexFilter: "[0:v]setpts=PTS/{speed},scale=w=min(iw\,1920):h=min(ih\,1920)[v];[0:a]atempo={speed}[a]",
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
        console.log(key, preset.name)
        PRESET_NAMEs.push(preset.name)
        PRESET_MAP.set(preset.name, preset)
    }
    console.log(Object.entries(presets))
}

// 初始化调用
initializePresets()