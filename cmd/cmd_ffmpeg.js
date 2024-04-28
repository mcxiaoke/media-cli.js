/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk'
import dayjs from 'dayjs'
import { execa } from 'execa'
import fs from 'fs-extra'
import iconv from "iconv-lite"
import inquirer from "inquirer"
import mm from 'music-metadata'
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import which from "which"
import * as core from '../lib/core.js'
import { asyncFilter, formatArgs } from '../lib/core.js'
import * as log from '../lib/debug.js'
import * as enc from '../lib/encoding.js'
import presets from '../lib/ffmpeg_presets.js'
import { getMediaInfo } from '../lib/ffprobe.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'
import { FFMPEG_BINARY } from '../lib/shared.js'
import { addEntryProps, applyFileNameRules } from './cmd_shared.js'

const LOG_TAG = "FFConv"
// ===========================================
// 命令内容执行
// ===========================================


export { aliases, builder, command, describe, handler }
// directories 表示额外输入文件，用于支持多个目录
const command = "ffmpeg <input> [directories...]"
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
            describe: "Folder store ouput files",
            type: "string",
        })
        // 复杂字符串参数，单独解析
        .option("params", {
            describe: "complex combined string parameters for parse",
            type: "string",
        })
        // 保持源文件目录结构
        .option("output-tree", {
            alias: 'otree',
            describe: "keep folder tree structure in output folder",
            type: "boolean",
            default: true,
        })
        // 正则，包含文件名规则
        .option("include", {
            alias: "I",
            type: "string",
            description: "filename include pattern",
        })
        //字符串或正则，不包含文件名规则
        // 如果是正则的话需要转义
        // 默认排除含shana的文件和.m4a文件
        .option("exclude", {
            alias: "E",
            type: "string",
            default: 'shana|.m4a',
            description: "filename exclude pattern ",
        })
        // 默认启用正则模式，禁用则为字符串模式
        .option("regex", {
            alias: 're',
            type: "boolean",
            default: true,
            description: "match filenames by regex pattern",
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
            choices: presets.getAllNames(),
            default: 'hevc_2k',
            describe: "convert preset args for ffmpeg command",
        })
        // 显示预设列表
        .option("show-presets", {
            type: "boolean",
            description: "show presets details list",
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
        // 视频帧率，FPS
        .option("fps", {
            alias: 'framerate',
            type: "number",
            default: 0,
            describe: "output framerate value",
        })
        // 视频加速减速，默认不改动，范围0.25-4.0
        .option("speed", {
            type: "number",
            default: 0,
            describe: "chang speed for video and audio",
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
        // 记录日志到文件
        // 可选text文件或json文件
        .option("error-file", {
            describe: "Write error logs to file [json or text]",
            type: "string",
        })
        // 硬件加速方式
        .option("hwaccel", {
            alias: "hw",
            describe: "hardware acceleration for video decode and encode",
            type: "string",
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

//todo 实现一种更方便的传参数的方法，比如逗号分割 -preset ab=128,aq=3,ac=aac,ap=aac_he;vb=1536,vq=23,vc=hevc_nvenc,vs=1280*720,vw=1280,vh=720;vf=xxx,cf=xxx,

const handler = cmdConvert

async function cmdConvert(argv) {
    // 显示预设列表
    if (argv.showPresets) {
        for (const [key, value] of presets.getAllPresets()) {
            log.show(key, core.pickTrueValues(value))
        }
        return
    }
    const testMode = !argv.doit
    const logTag = chalk.green('FFConv')
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`)
    }
    let startMs = Date.now()
    log.show(logTag, `Input: ${root}`)
    // 解析Preset，根据argv参数修改preset，返回对象
    const preset = preparePreset(argv)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, 'FFConv')
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, 'FFConv')
        log.fileLog(`Preset: ${JSON.stringify(preset)}`, 'FFConv')
    }
    // 首先找到所有的视频和音频文件
    const walkOpts = {
        withFiles: true,
        needStats: true,
        entryFilter: (e) => e.isFile && helper.isMediaFile(e.name)
    }
    let fileEntries = await mf.walk(root, walkOpts)
    // 处理额外目录参数
    if (argv.directories?.length > 0) {
        const extraDirs = new Set(argv.directories.map(d => path.resolve(d)))
        for (const dirPath of extraDirs) {
            const st = await fs.stat(dirPath)
            if (st.isDirectory()) {
                const dirFiles = await mf.walk(dirPath, walkOpts)
                if (dirFiles.length > 0) {
                    log.show(logTag, `Add ${dirFiles.length} extra files from ${dirPath}`)
                    fileEntries = fileEntries.concat(dirFiles)
                }
            }
        }
    }
    // 根据完整路径去重
    fileEntries = core.uniqueByFields(fileEntries, 'path')
    log.show(logTag, `Total ${fileEntries.length} files found [${preset.name}] (${helper.humanTime(startMs)})`)
    // 再根据preset过滤找到的文件
    if (preset.type === 'video' || presets.isAudioExtract(preset)) {
        // 视频转换模式，保留视频文件
        // 提取音频模式，保留视频文件
        fileEntries = fileEntries.filter(e => helper.isVideoFile(e.name))
    } else if (preset.type === 'audio') {
        // 音频转换模式，保留音频文件
        fileEntries = fileEntries.filter(e => helper.isAudioFile(e.name))
    }
    log.show(logTag, `Total ${fileEntries.length} files left [${preset.name}] (${helper.humanTime(startMs)})`)
    // 应用文件名过滤规则
    fileEntries = await applyFileNameRules(fileEntries, argv)
    // 提取音频时不判断文件名
    if (!presets.isAudioExtract(preset)) {
        // 过滤掉压缩过的文件 关键词 shana tmp m4a 
        fileEntries = fileEntries.filter(entry => !/tmp|\.m4a/i.test(entry.name))
    }
    log.showYellow(logTag, `Total ${fileEntries.length} files left after filename rules.`)
    if (fileEntries.length === 0) {
        log.showYellow(logTag, 'No files left after rules, nothing to do.')
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
            log.showYellow("Will do nothing, aborted by user.")
            return
        }
    }
    startMs = Date.now()
    addEntryProps(fileEntries)
    fileEntries = fileEntries.map((entry, index) => {
        return {
            ...entry,
            argv,
            preset,
            // startMs: startMs,
            // index: index,
            // total: fileEntries.length,
            errorFile: argv.errorFile,
            testMode: testMode
        }
    })
    log.showYellow(logTag, 'ARGV:', core.pickTrueValues(argv))
    log.showYellow(logTag, 'PRESET:', core.pickTrueValues(preset))
    const prepareAnswer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'yes',
            default: false,
            message: chalk.bold.red(
                `Please check above values, press y/yes to continue. [${preset.name}]`
            )
        }
    ])
    if (!prepareAnswer.yes) {
        log.showYellow("Will do nothing, aborted by user.")
        return
    }
    log.showGreen(logTag, 'Now Preparing task files and ffmpeg cmd args...')
    let tasks = await pMap(fileEntries, prepareFFmpegCmd, { concurrency: argv.jobs || (core.isUNCPath(root) ? 4 : cpus().length) })
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
    log.showYellow(logTag, 'Please CHECK above details BEFORE continue!')
    const answer = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'yes',
            default: false,
            message: chalk.bold.red(
                `Are you sure to process these ${tasks.length} files? [${preset.name}]`
            )
        }
    ])
    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.")
        return
    }
    // 检查ffmpeg可执行文件是否存在
    const ffmpegPath = await which("ffmpeg", { nothrow: true })
    if (!ffmpegPath) {
        throw new Error("ffmpeg executable not found in path")
    }
    // 记录开始时间
    startMs = Date.now()
    addEntryProps(tasks)
    // 先写入一次LOG
    await log.flushFileLog()
    // 并发数视频1，音频4，或者参数指定
    const jobCount = argv.jobs || (preset.type === 'video' ? 1 : 4)
    const results = await pMap(tasks, runFFmpegCmd, { concurrency: jobCount })
    // const results = await core.asyncMapGroup(tasks, runFFmpegCmd, jobCount)
    testMode && log.showYellow(logTag, 'NO file processed in TEST MODE.')
    const okResults = results.filter(r => r && r.ok)
    !testMode && log.showGreen(logTag, `Total ${okResults.length} files processed in ${helper.humanTime(startMs)}`)
}

function fixEncoding(str = '') {
    return iconv.decode(Buffer.from(str, 'binary'), 'cp936')
}

async function runFFmpegCmd(entry) {
    const ipx = `${entry.index + 1}/${entry.total}`
    const logTag = chalk.green('FFCMD')
    const ffmpegArgs = entry.ffmpegArgs

    log.show(logTag, `${ipx} Processing ${helper.pathShort(entry.path, 72)}`, helper.humanSize(entry.size), chalk.yellow(getDurationInfo(entry)), helper.humanTime(entry.startMs))

    // 每10个输出一次ffmpeg详细信息，避免干扰
    if (entry.index % 10 === 0) {
        log.showGray(logTag, `${ipx} streams`, getEntryShowInfo(entry), chalk.yellow(entry.preset.name), helper.humanSize(entry.size))
        log.showGray(logTag, `${ipx} ffmpeg`, createFFmpegArgs(entry, true).join(' '))
    }
    const exePath = await which(FFMPEG_BINARY)
    if (entry.testMode) {
        // 测试模式跳过
        log.show(logTag, `${ipx} Skipped ${entry.path} (${helper.humanSize(entry.size)}) [TestMode]`)
        return
    }

    // 创建输出目录
    await fs.mkdirp(entry.fileDstDir)
    await fs.remove(entry.fileDstTemp)
    const ffmpegStartMs = Date.now()
    try {
        // https://2ality.com/2022/07/nodejs-child-process.html
        // Windows下 { shell: true } 必须，否则报错
        const ffmpegProcess = execa(exePath, ffmpegArgs, { shell: true, encoding: 'binary' })
        ffmpegProcess.pipeStdout(process.stdout)
        ffmpegProcess.pipeStderr(process.stderr)
        const { stdout, stderr } = await ffmpegProcess
        // const stdoutFixed = fixEncoding(stdout || "")
        // const stderrFixed = fixEncoding(stderr || "")
        if (await fs.pathExists(entry.fileDst)) {
            log.showYellow(logTag, `${ipx} DstExists ${entry.fileDst}`, helper.humanSize(entry.size), chalk.yellow(entry.preset.name), helper.humanTime(ffmpegStartMs))
            await fs.remove(entry.fileDstTemp)
            return
        }
        if (await fs.pathExists(entry.fileDstTemp)) {
            const dstSize = (await fs.stat(entry.fileDstTemp))?.size || 0
            if (dstSize > 20 * mf.FILE_SIZE_1K) {
                await fs.move(entry.fileDstTemp, entry.fileDst)
                log.showGreen(logTag, `${ipx} Done ${entry.fileDst}`, chalk.cyan(`${helper.humanSize(entry.size)}=>${helper.humanSize(dstSize)}`), chalk.yellow(entry.preset.name), helper.humanTime(ffmpegStartMs))
                log.fileLog(`${ipx} Done <${entry.fileDst}> [${entry.preset.name}] (${helper.humanSize(dstSize)})`, 'FFCMD')
                entry.ok = true
                return entry
            } else {
                // 转换失败，删除临时文件
            }
        }
        log.showYellow(logTag, `${ipx} Failed ${entry.path}`, entry.preset.name, helper.humanSize(dstSize))
        log.fileLog(`${ipx} Failed <${entry.path}> [${entry.dstAudioBitrate || entry.preset.name}]`, 'FFCMD')
    } catch (error) {
        const errMsg = (error.stderr || error.message || '[Unknown]').substring(0, 240)
        log.showRed(logTag, `Error(${ipx}) ${errMsg}`)
        log.fileLog(`Error(${ipx}) <${entry.path}> [${entry.preset.name}] ${errMsg}`, 'FFCMD')
        await writeErrorFile(entry, error)
    } finally {
        await fs.remove(entry.fileDstTemp)
    }

}

// 失败了在输出目录写一个Error文件
async function writeErrorFile(entry, error) {
    if (entry.errorFile) {
        const useJson = entry.errorFile === 'json'
        const fileExt = useJson ? '.json' : '.txt'
        const nowStr = dayjs().format('YYYYMMDDHHmmss')
        const errorFile = path.join(entry.fileDstDir, `${path.parse(entry.name).name}_${entry.preset.name}_error_${nowStr}${fileExt}`)
        const errorObj = {
            ...entry,
            error: error,
            date: Date.now(),
        }
        const errData = Object.entries(errorObj).map(([key, value]) => `${key} =: ${value}`).join('\n')
        await fs.writeFile(errorFile, useJson ? JSON.stringify(errorObj, null, 4) : errData)
    }
}

async function prepareFFmpegCmd(entry) {
    const logTag = chalk.green('Prepare')
    const ipx = `${entry.index + 1}/${entry.total}`
    log.info(logTag, `Processing(${ipx}) file: ${entry.path}`)
    const isAudio = helper.isAudioFile(entry.path)
    const [srcDir, srcBase, srcExt] = helper.pathSplit(entry.path)
    const preset = entry.preset
    const argv = entry.argv
    const dstExt = preset.format || srcExt
    let fileDstDir
    // 命令行参数指定输出目录
    if (argv.output) {
        // 默认true 保留目录结构，可以防止文件名冲突
        if (argv.outputTree) {
            // 如果要保持源文件目录结构
            fileDstDir = helper.pathRewrite(srcDir, preset.output)
        } else {
            // 不保留源文件目录结构，只保留源文件父目录
            fileDstDir = path.join(preset.output, path.basename(srcDir))
        }
    } else {
        // 如果没有指定输出目录，直接输出在原文件同目录
        fileDstDir = path.resolve(srcDir)
    }
    if (isAudio || presets.isAudioExtract(preset)) {
        // 不带后缀只改扩展名的m4a文件，如果存在也需要首先忽略
        // 可能是其它压缩工具生成的文件，不需要重复压缩
        // 检查输出目录
        // const fileDstNoSuffix = path.join(fileDstDir, `${srcBase}${dstExt}`)
        // if (await fs.pathExists(fileDstNoSuffix)) {
        //     log.info(
        //         logTag,
        //         `${ipx} Skip[DstM4A]: ${helper.pathShort(entry.path)} (${helper.humanSize(entry.size)})`)
        //     return false
        // }
        // 检查源文件同目录
        // const fileDstSameDirNoSuffix = path.join(srcDir, `${srcBase}${dstExt}`)
        // if (await fs.pathExists(fileDstSameDirNoSuffix)) {
        //     log.info(
        //         logTag,
        //         `${ipx} Skip[DstSame]: ${helper.pathShort(entry.path)} (${helper.humanSize(entry.size)})`)
        //     return false
        // }
    }
    try {
        // 使用ffprobe读取媒体信息，速度较慢
        // 注意flac和ape格式的stream里没有bit_rate字段 format里有
        entry.info = await getMediaInfo(entry.path, { audio: isAudio })

        // ffprobe无法读取时长和比特率，可以认为文件损坏，或不支持的格式，跳过
        if (!(entry.info?.format?.duration || entry.info?.format?.bit_rate)) {
            log.showYellow(logTag, `${ipx} Skip[Corrupted]: ${entry.path} (${helper.humanSize(entry.size)})`)
            log.fileLog(`${ipx} Skip[Corrupted]: <${entry.path}> (${helper.humanSize(entry.size)})`, 'Prepare')
            return false
        }
        const audioCodec = entry.info?.audio?.codec_name
        const videoCodec = entry.info?.video?.codec_name
        if (isAudio) {
            // 检查音频文件
            // 放前面，因为 dstAudioBitrate 会用于前缀后缀参数
            // music-metadata 不支持tta和tak，需要修改
            const meta = await readMusicMeta(entry)
            entry.format = meta?.format
            entry.tags = meta?.tags
            // 如果ffprobe或music-metadata获取的数据中有比特率数据
            log.info(entry.name, preset.name)
            if (entry.format?.bitrate || entry.info?.audio.bit_rate || entry.info?.format?.bit_rate) {
                // 可以读取码率，文件未损坏
            } else {
                // 如果无法获取元数据，认为不是合法的音频或视频文件，忽略
                log.showYellow(logTag, `${ipx} Skip[Invalid]: ${entry.path} (${helper.humanSize(entry.size)})`)
                log.fileLog(`${ipx} Skip[Invalid]: <${entry.path}> (${helper.humanSize(entry.size)})`, 'Prepare')
                return false
            }
        }
        // 获取原始音频码率，计算目标音频码率
        // vp9视频和opus音频无法获取码率
        const mediaBitrate = calculateBitrate(entry)
        // 计算后的视频和音频码率，关联文件
        // 与预设独立，优先级高于预设
        // srcXX单位为bytes dstXXX单位为kbytes
        Object.assign(entry, mediaBitrate)
        log.info(logTag, entry.path, mediaBitrate)
        // 如果转换目标是音频，但是源文件不含音频流，忽略
        if (entry.preset.type === 'audio' && !audioCodec) {
            log.showYellow(logTag, `${ipx} Skip[NoAudio]: ${entry.path}`, getEntryShowInfo(entry), helper.humanSize(entry.size))
            log.fileLog(`${ipx} Skip[NoAudio]: <${entry.path}> (${helper.humanSize(entry.size)})`, 'Prepare')
            return false
        }
        // 如果转换目标是视频，但是源文件不含视频流，忽略
        if (entry.preset.type === 'video' && !videoCodec) {
            log.showYellow(logTag, `${ipx} Skip[NoVideo]: ${entry.path}`, getEntryShowInfo(entry), helper.humanSize(entry.size))
            log.fileLog(`${ipx} Skip[NoVideo]: <${entry.path}> (${helper.humanSize(entry.size)})`, 'Prepare')
            return false
        }
        // 输出文件名基本名，含前后缀，不含扩展名
        const fileDstBase = createDstBaseName(entry)
        const fileDst = path.join(fileDstDir, `${fileDstBase}${dstExt}`)
        // 临时文件后缀
        const tempSuffix = `_tmp@${helper.textHash(entry.path)}@tmp_`
        // 临时文件名
        const fileDstTemp = path.join(fileDstDir, `${fileDstBase}${tempSuffix}${dstExt}`)
        const fileDstSameDir = path.join(srcDir, `${fileDstBase}${dstExt}`)

        if (await fs.pathExists(fileDst)) {
            log.info(
                logTag,
                `${ipx} Skip[Dst1]: ${helper.pathShort(entry.path)} (${helper.humanSize(entry.size)})`)
            return false
        }
        if (await fs.pathExists(fileDstSameDir)) {
            log.info(
                logTag,
                `${ipx} Skip[Dst2]: ${helper.pathShort(entry.path)} (${helper.humanSize(entry.size)})`)
            return false
        }
        if (await fs.pathExists(fileDstTemp)) {
            await fs.remove(fileDstTemp)
        }
        log.show(logTag, `${ipx} TaskSRC: ${helper.pathShort(entry.path, 72)}`, helper.humanTime(entry.startMs))
        log.info(logTag, `${ipx} TaskDST:`, `${fileDst}`)
        log.showGray(logTag, `${ipx} Streams:`, getEntryShowInfo(entry), chalk.yellow(entry.preset.name), helper.humanSize(entry.size))
        // log.show(logTag, `Entry(${ipx})`, entry)
        const newEntry = {
            ...entry,
            fileDstDir,
            fileDstBase,
            fileDst,
            fileDstTemp,
        }
        newEntry.ffmpegArgs = createFFmpegArgs(newEntry)
        // log.info(logTag, 'ffmpeg', ffmpegArgs.join(' '))
        return newEntry
    } catch (error) {
        log.warn(logTag, `${ipx} Skip[Error]: ${entry.path}`, error)
    }
}

// 创建目标文件名基本名，不包含路径和扩展名
function createDstBaseName(entry) {
    const srcBase = path.parse(entry.name).name
    // 模板参数变量，除了Preset的字段，有些需要替换
    const replaceArgs = {
        ...entry.preset,
        preset: entry.preset.name,
        audioBitrate: getBestAudioBitrate(entry),
        videoBitrate: getBestVideoBitrate(entry),
        audioQuality: getBestAudioQuality(entry),
        videoQuality: getBestVideoQuality(entry),
        srcAudioBitrate: entry.srcAudioBitrate,
        srcVideoBitrate: entry.srcVideoBitrate,
    }
    // log.show(entry.preset)
    // 应用模板参数到前缀和后缀字符串模板
    const prefix = helper.filenameSafe(formatArgs(entry.preset.prefix || "", replaceArgs))
    const suffix = helper.filenameSafe(formatArgs(entry.preset.suffix || "", replaceArgs))
    // return { prefix, suffix }
    return `${prefix}${srcBase}${suffix}`
}

// 显示媒体编码和码率信息，调试用
function getEntryShowInfo(entry) {
    const ac = entry.info?.audio?.codec_name
    const vc = entry.info?.video?.codec_name
    const duration = entry?.info?.audio?.duration
        || entry?.info?.video?.duration
        || entry?.info?.format?.duration || 0
    const fps = entry.info?.video?.r_frame_rate || 0
    const showInfo = []
    if (ac) showInfo.push(`audio|${ac}|${Math.round(entry.srcAudioBitrate / 1000)}K=>${getBestAudioBitrate(entry)}K|${helper.humanDuration(duration * 1000)}|${entry.preset.audioQuality}`)
    if (vc) showInfo.push(`video|${vc}|${Math.round(entry.srcVideoBitrate / 1000)}K=>${getBestVideoBitrate(entry)}K|${helper.humanDuration(duration * 1000)}|${fps}`,)
    return showInfo.join(', ')
}

function getDurationInfo(entry) {
    return helper.humanDuration((entry?.info?.audio?.duration || entry?.info?.video?.duration || entry?.info?.format?.duration || 0) * 1000)
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

// 音频码率映射表
// 只有存储设备如内存和硬盘用1K=1024，其它时候都是1K=1000
const bitrateMap = [
    { threshold: 320 * 1000, value: 320 },
    { threshold: 256 * 1000, value: 256 },
    { threshold: 192 * 1000, value: 192 },
    { threshold: 128 * 1000, value: 128 },
    { threshold: 96 * 1000, value: 96 },
    { threshold: 64 * 1000, value: 64 },
    { threshold: 0, value: 48 } // 默认值
]

// 计算视频和音频码率
function calculateBitrate(entry) {
    // eg. '-map a:0 -c:a libfdk_aac -b:a {bitrate}'
    // 这个是文件整体码率，如果是是视频文件，等于是视频和音频的码率相加
    const fileBitrate = entry.info?.format?.bit_rate || 0
    let srcAudioBitrate = 0
    let dstAudioBitrate = 0
    let srcVideoBitrate = 0
    let dstVideoBitrate = 0
    if (helper.isAudioFile(entry.path)) {
        // 对于音频文件，音频格式转换
        if (entry.format?.lossless || helper.isAudioLossless(entry.path)) {
            // 无损音频，设置默认值
            srcAudioBitrate = srcAudioBitrate > 320 ? srcAudioBitrate : 999 * 1000
        }
        // audio file
        srcAudioBitrate = entry.format?.bitrate
            || entry.info?.audio?.bit_rate
            || fileBitrate || 0
        // 有的文件无法获取音频码率，如opus，此时srcAudioBitrate=0
        // opus用于极低码率音频，此时 dstAudioBitrate=48 可以接受
        dstAudioBitrate = bitrateMap.find(br => srcAudioBitrate > br.threshold)?.value || 48
        // 忽略计算结果，直接使用预设数值
        if (!entry.preset.smartBitrate) {
            dstAudioBitrate = entry.preset.audioBitrate
        }
    } else {
        // 对于视频文件
        // 计算码率原则
        // 计算出的音频码率不高于源文件的音频码率
        // 计算出的音频码率不高于预设指定的码率
        srcAudioBitrate = entry.info?.audio?.bit_rate || 0
        dstAudioBitrate = Math.min(Math.round(srcAudioBitrate / 1000), entry.preset.audioBitrate)

        // 计算出的视频码率不高于源文件的视频码率
        // 减去音频的码率，估算为48k
        srcVideoBitrate = entry.info?.video?.bit_rate
            || fileBitrate - 48 * 1000 || 0
        // 压缩后的视频比特率不能高于源文件比特率
        dstVideoBitrate = Math.min(Math.round(srcVideoBitrate / 1000), entry.preset.videoBitrate)
        // 忽略计算结果，直接使用预设数值
        if (!entry.preset.smartBitrate) {
            dstAudioBitrate = entry.preset.audioBitrate
            dstVideoBitrate = entry.preset.videoBitrate
        }
    }

    return { srcAudioBitrate, dstAudioBitrate, srcVideoBitrate, dstVideoBitrate }
}

// 选择最佳视频码率
// 优先级
// 用户指定参数 > 计算出的参数 > 预设里的参数
// entry.preset.userVideoBitrate 用户指定，命令行参数，优先级最高
// entry.dstVideoBitrate 计算出来的目标文件码率
// entry.preset.videoBitrate 预设里指定的码率，优先级最低
// 后面几种同上
function getBestVideoBitrate(entry) {
    return entry.preset.userVideoBitrate
        || entry.dstVideoBitrate
        || entry.preset.videoBitrate
}
// 选择最佳视频质量
function getBestVideoQuality(entry) {
    return entry.preset.userVideoQuality
        || entry.dstVideoQuality
        || entry.preset.videoQuality
}

// 选择最佳音频码率
function getBestAudioBitrate(entry) {
    return entry.preset.userAudioBitrate
        || entry.dstAudioBitrate
        || entry.preset.audioBitrate
}
// 选择最佳音频质量
function getBestAudioQuality(entry) {
    return entry.preset.userAudioQuality
        || entry.dstAudioQuality
        || entry.preset.audioQuality
}

// 组合各种参数，替换模板参数，输出最终的ffmpeg命令行参数
// 此函数仅读取参数，不修改preset对象
function createFFmpegArgs(entry, forDisplay = false) {
    const preset = entry.preset
    // 用于模板字符串的模板参数，针对当前文件
    const entryPreset = {
        ...preset,
        // 这几个会覆盖preset的预设数值
        videoBitrate: getBestVideoBitrate(entry),
        videoQuality: getBestVideoQuality(entry),
        audioBitrate: getBestAudioBitrate(entry),
        audioQuality: getBestAudioQuality(entry),
        // 下面的是源文件参数
        srcAudioBitrate: entry.srcAudioBitrate,
        srcVideoBitrate: entry.srcVideoBitrate,
        srcWidth: entry.info.video?.width || 0,
        srcHeight: entry.info.video?.height || 0,
        srcFrameRate: entry.info.video?.r_frame_rate || 0,
        srcDuration: entry.info.format?.duration || 0,
        srcSize: entry.info.format?.size || 0,
        srcVideoCodec: entry.info.video?.codec_name,
        srcAudioCodec: entry.info.audio?.codec_name,
        srcFormat: entry.info.format?.format_name,
    }
    // 几种ffmpeg参数设置的时间和功耗
    // ffmpeg -hide_banner -n -v error -stats -i 
    // 32s 110w
    // ffmpeg -hide_banner -n -v error -stats -hwaccel auto -i
    // 34s 56w
    // ffmpeg -hide_banner -n -v error -stats  -hwaccel d3d11va -hwaccel_output_format d3d11 
    // 27s 45w rm格式死机蓝屏
    // ffmpeg -hide_banner -n -v error -stats -hwaccel cuda -hwaccel_output_format cuda 
    // 27s 41w
    // ffmpeg -hide_banner -n -v error -stats -hwaccel cuda -i
    // 31s 60w
    // 显示详细信息
    // let args = "-hide_banner -n -loglevel repeat+level+info -stats".split(" ")
    // 只显示进度和错误
    let args = "-hide_banner -n -v error".split(" ")
    // 输出视频时才需要cuda加速，音频用cpu就行
    if (preset.type === 'video') {
        // -hwaccel cuda -hwaccel_output_format cuda
        args = args.concat(["-stats", "-hwaccel", "cuda", "-hwaccel_output_format", "cuda"])
    }
    // 输入参数在输入文件前面，顺序重要
    if (preset.inputArgs?.length > 0) {
        args = args.concat(this.preset.inputArgs.split(' '))
    }
    args.push('-i')
    args.push(`"${entry.path}"`)

    // 在输入文件后面
    // complexFilter 和 filters 不能同时存在
    if (preset.complexFilter?.length > 0) {
        args.push('-filter_complex')
        args.push(`"${formatArgs(preset.complexFilter, preset)}"`)
    } else if (preset.filters?.length > 0) {
        args.push('-vf')
        args.push(formatArgs(preset.filters, preset))
    }

    if (preset.videoArgs?.length > 0) {
        const va = formatArgs(preset.videoArgs, entryPreset)
        args = args.concat(va.split(' '))
    }
    if (preset.audioArgs?.length > 0) {
        // extract_audio模式下智能选择编码器
        // 直接复制音频流或者重新编码
        // audioArgsCopy: '-c:a copy',
        // audioArgsEncode: '-c:a libfdk_aac -b:a {audioBitrate}k',
        let audioArgsFixed = preset.audioArgs
        if (presets.isAudioExtract(preset)) {
            if (entry.info?.audio?.codec_name === 'aac') {
                audioArgsFixed = '-c:a copy'
            } else {
                audioArgsFixed = '-c:a libfdk_aac -b:a {audioBitrate}k'
            }
        } else {
            audioArgsFixed = preset.audioArgs
        }
        const aa = formatArgs(audioArgsFixed, entryPreset)
        args = args.concat(aa.split(' '))
    }
    // 在输入文件后面
    if (preset.streamArgs?.length > 0) {
        args = args.concat(preset.streamArgs.split(' '))
    }
    // 其它参数
    // metadata 参数放这里
    let extraArgsArray = []
    // 添加自定义metadata字段
    //description, comment, copyright

    extraArgsArray.push(`-metadata`, `description="encoder=mediac-ffmpeg"`)
    extraArgsArray.push(`-metadata`, `copyright="name=${entry.name}"`)
    extraArgsArray.push(`-metadata`, `comment="preset=${preset.name},vargs=${formatArgs(preset.videoArgs, entryPreset)},aargs=${formatArgs(preset.audioArgs, entryPreset)}"`)
    // 检查源文件元数据
    if (entry.tags?.title) {
        const KEY_LIST = ['title', 'artist', 'album', 'albumartist', 'year']
        // 验证 非空值，无乱码，值为字符串或数字
        const validTags = core.filterFields(entry.tags, (key, value) => {
            return KEY_LIST.includes(key)
                && Boolean(value)
                && ((typeof value === 'string' && value.length > 0)
                    || typeof value === 'number')
                && !enc.hasBadCJKChar(value)
                && !enc.hasBadUnicode(value)
        })
        extraArgsArray = extraArgsArray.concat(...Object.entries(validTags)
            .map(([key, value]) => [`-metadata`, `${key}="${value}"`]))
        // log.show(extraArgsArray)
    } else {
        extraArgsArray.push(`-metadata`, `title="${entry.name}"`)
    }
    // 不要漏掉本来的extraArgs
    if (preset.extraArgs?.length > 0) {
        extraArgsArray = extraArgs.concat(preset.extraArgs.split(' '))
    }
    if (extraArgsArray.length > 0) {
        args = args.concat(extraArgsArray)
    }
    // 输出参数在最后，在输出文件前面，顺序重要
    if (preset.outputArgs?.length > 0) {
        args = args.concat(preset.outputArgs.split(' '))
    }
    // 显示数据时用最终路径，实际使用时用临时文件路径
    args.push(`"${forDisplay ? entry.fileDst : entry.fileDstTemp}"`)


    return args
}

function preparePreset(argv) {
    // 参数中指定的preset
    let preset = presets.getPreset(argv.preset)

    // log.show('ARGV', argv)
    // log.show('P1', preset)
    // 克隆对象，不修改Map中的内容
    preset = structuredClone(preset)
    // 保存argv方便调试
    // preset.argv = JSON.stringify(argv)
    // 前缀可以为空字符串
    if (typeof argv.prefix === 'string') {
        preset.prefix = argv.prefix
    }
    // 后缀可以为空字符串
    if (typeof argv.suffix === 'string') {
        preset.suffix = argv.suffix
    }
    if (argv.videoArgs?.length > 0) {
        preset.videoArgs = argv.videoArgs
    }
    if (argv.audioArgs?.length > 0) {
        preset.audioArgs = argv.audioArgs
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
    // 视频帧率
    if (argv.framerate > 0) {
        preset.framerate = argv.framerate
    }
    if (preset.framerate > 0) {
        if (preset.filters?.length > 0) {
            preset.filters += ',fps={framerate}'
        } else {
            preset.filters = 'fps={framerate}'
        }
    }
    // 视频码率，用户指定，优先级最高
    if (argv.videoBitrate > 0) {
        preset.userVideoBitrate = argv.videoBitrate
    }
    if (argv.videoQuality > 0) {
        preset.userVideoQuality = argv.videoQuality
    }
    // 音频码率，用户指定，优先级最高
    if (argv.audioBitrate > 0) {
        preset.userAudioBitrate = argv.audioBitrate
    }
    if (argv.audioQuality > 0) {
        preset.userAudioQuality = argv.audioQuality
    }
    // log.show('P2', preset)
    return preset
}