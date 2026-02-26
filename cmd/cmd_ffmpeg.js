/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from "chalk"
import * as cliProgress from "cli-progress"
import dayjs from "dayjs"
import { execa } from "execa"
import fs from "fs-extra"
import iconv from "iconv-lite"
import inquirer from "inquirer"
import mm from "music-metadata"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import which from "which"
import argparser from "../lib/argparser.js"
import * as core from "../lib/core.js"
import { asyncFilter, formatArgs } from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as enc from "../lib/encoding.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import presets from "../lib/ffmpeg_presets.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { getMediaInfo, getSimpleInfo } from "../lib/mediainfo.js"
import { addEntryProps, applyFileNameRules, calculateScale } from "./cmd_shared.js"

const LOG_TAG = "FFConv"
// ===========================================
// 命令内容执行
// ===========================================

export { aliases, builder, command, describe, handler }
// directories 表示额外输入文件，用于支持多个目录
const command = "ffmpeg <input>"
const aliases = ["transcode", "aconv", "vconv", "avconv"]
const describe = t("ffmpeg.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            // 输入目录，根目录
            // .positional("input", {
            //     describe: "Input folder that contains media files",
            //     type: "string",
            // })
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: t("option.common.output"),
                type: "string",
            })
            // 复杂字符串参数，单独解析
            .option("ffargs", {
                describe: t("ffmpeg.ffargs"),
                type: "string",
            })
            // 保持源文件目录结构
            .option("output-mode", {
                alias: "om",
                type: "choices",
                choices: ["tree", "dir", "file"],
                default: "dir",
                describe: t("ffmpeg.output.mode"),
            })
            // 列表处理，起始索引
            .option("start", {
                type: "number",
                default: 0,
                description: t("ffmpeg.start"),
            })
            // 列表处理，每次数目
            .option("count", {
                type: "number",
                default: 99999,
                description: t("ffmpeg.count"),
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            // 默认排除含shana的文件和.m4a文件
            .option("exclude", {
                alias: "E",
                type: "string",
                default: "shana|.m4a",
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
            // 选择预设，从预设列表中选一个，预设等于一堆预定义参数
            .option("preset", {
                type: "choices",
                choices: presets.getAllNames(),
                default: "hevc_2k",
                describe: t("ffmpeg.preset"),
            })
            // 显示预设名字列表
            .option("show-presets", {
                type: "boolean",
                description: t("ffmpeg.show.presets"),
            })
            // 强制解压，覆盖之前的文件
            .option("override", {
                alias: "O",
                type: "boolean",
                default: false,
                description: t("ffmpeg.override"),
            })
            // 输出文件名前缀
            // 提供几个预定义变量
            // {width},{height},{dimension},{bitrate},{speed},{preset}
            // 然后模板解析替换字符串变量
            .option("prefix", {
                alias: "P",
                type: "string",
                describe: t("ffmpeg.prefix"),
            })
            // 输出文件名后缀
            // 同上支持模板替换
            .option("suffix", {
                alias: "S",
                type: "string",
                describe: t("ffmpeg.suffix"),
            })
            // 视频尺寸，长边最大数值
            .option("dimension", {
                type: "number",
                default: 0,
                describe: t("ffmpeg.dimension"),
            })
            // 视频帧率，FPS
            .option("fps", {
                alias: "framerate",
                type: "number",
                default: 0,
                describe: t("ffmpeg.fps"),
            })
            // 视频加速减速，默认不改动，范围0.25-4.0
            .option("speed", {
                type: "number",
                default: 0,
                describe: t("ffmpeg.speed"),
            })
            // 视频选项
            // video-args = video-encoder + video-quality
            // 如果此选项存在，会忽略其它 video-xxx 参数
            .option("video-args", {
                alias: "va",
                type: "string",
                describe: t("ffmpeg.video.args"),
            })
            // 视频选项，指定码率
            .option("video-bitrate", {
                alias: "vb",
                type: "number",
                default: 0,
                describe: t("ffmpeg.video.bitrate"),
            })
            // 直接复制视频流，不重新编码
            .option("video-copy", {
                type: "boolean",
                default: false,
                describe: t("ffmpeg.video.copy"),
            })
            // 视频选项，指定视频质量参数
            .option("video-quality", {
                alias: "vq",
                type: "number",
                default: 0,
                describe: t("ffmpeg.video.quality"),
            })
            // 音频选项
            // audio-args = audio-encoder + audio-quality
            // 如果此选项存在，会忽略其它 audio-xxx 参数
            .option("audio-args", {
                alias: "aa",
                type: "string",
                describe: t("ffmpeg.audio.args"),
            })
            // 音频选项，指定码率
            .option("audio-bitrate", {
                alias: "ab",
                type: "number",
                default: 0,
                describe: t("ffmpeg.audio.bitrate"),
            })
            // 直接复制音频流，不重新编码
            .option("audio-copy", {
                type: "boolean",
                default: false,
                describe: t("ffmpeg.audio.copy"),
            })
            // 音频选项，指定音频质量参数
            .option("audio-quality", {
                alias: "aq",
                type: "number",
                default: 0,
                describe: t("ffmpeg.audio.quality"),
            })
            // ffmpeg filter string
            .option("filters", {
                alias: "fs",
                type: "string",
                describe: t("ffmpeg.filters"),
            })
            // ffmpeg complex filter string
            .option("filter-complex", {
                alias: "fc",
                type: "string",
                describe: t("ffmpeg.filter.complex"),
            })
            // 记录日志到文件
            // 可选text文件或json文件
            .option("error-file", {
                describe: t("ffmpeg.error.file"),
                type: "string",
            })
            // 硬件加速方式
            .option("hwaccel", {
                alias: "hw",
                describe: t("ffmpeg.hwaccel"),
                type: "string",
            })
            // 仅使用硬件解码
            .option("decode-mode", {
                type: "choices",
                choices: ["auto", "gpu", "cpu"],
                default: "auto",
                describe: t("ffmpeg.decode.mode"),
            })
            // 并行操作限制，并发数，默认为 CPU 核心数
            .option("jobs", {
                alias: "j",
                describe: t("option.common.jobs"),
                type: "number",
            })
            // 如果目标文件已存在或转换成功，删除源文件
            .option("delete-source-files", {
                type: "boolean",
                default: false,
                description: t("ffmpeg.delete.source"),
            })
            // 显示视频参数
            .option("info", {
                type: "boolean",
                default: false,
                description: t("ffmpeg.info"),
            })
            // 启用调试参数
            .option("debug", {
                type: "boolean",
                default: false,
                description: t("ffmpeg.debug"),
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: t("option.common.doit"),
            })
    )
}

const handler = cmdConvert

/**
 * FFmpeg转换命令处理函数
 * 处理媒体文件的转码、压缩、格式转换等操作
 * @param {Object} argv - 命令行参数对象
 * @param {string} argv.input - 输入目录路径
 * @param {string[]} argv.directories - 额外输入目录列表
 * @param {string} argv.output - 输出目录路径
 * @param {string} argv.ffargs - 复合参数
 * @param {string} argv.outputMode - 输出模式 (tree|dir|file)
 * @param {number} argv.start - 起始索引
 * @param {number} argv.count - 处理文件数量
 * @param {string} argv.include - 包含文件名规则
 * @param {string} argv.exclude - 排除文件名规则
 * @param {boolean} argv.regex - 是否使用正则模式
 * @param {string} argv.extensions - 需要处理的扩展名列表
 * @param {string} argv.preset - 预设配置名称
 * @param {boolean} argv.showPresets - 是否显示预设列表
 * @param {boolean} argv.override - 是否覆盖已存在的文件
 * @param {string} argv.prefix - 输出文件名前缀
 * @param {string} argv.suffix - 输出文件名后缀
 * @param {number} argv.dimension - 视频尺寸，长边最大数值
 * @param {number} argv.fps - 视频帧率
 * @param {number} argv.speed - 视频速度调整
 * @param {string} argv.videoArgs - 视频参数
 * @param {number} argv.videoBitrate - 视频码率
 * @param {boolean} argv.videoCopy - 是否直接复制视频流
 * @param {number} argv.videoQuality - 视频质量
 * @param {string} argv.audioArgs - 音频参数
 * @param {number} argv.audioBitrate - 音频码率
 * @param {boolean} argv.audioCopy - 是否直接复制音频流
 * @param {number} argv.audioQuality - 音频质量
 * @param {string} argv.filters - FFmpeg滤镜字符串
 * @param {string} argv.filterComplex - FFmpeg复杂滤镜字符串
 * @param {string} argv.errorFile - 错误日志文件
 * @param {string} argv.hwaccel - 硬件加速方式
 * @param {string} argv.decodeMode - 解码模式 (auto|gpu|cpu)
 * @param {number} argv.jobs - 并行操作限制
 * @param {boolean} argv.deleteSourceFiles - 是否删除源文件
 * @param {boolean} argv.info - 是否仅显示信息
 * @param {boolean} argv.debug - 是否启用调试
 * @param {boolean} argv.doit - 是否执行实际操作
 * @returns {Promise<void>}
 */
async function cmdConvert(argv) {
    // 显示预设列表
    if (argv.showPresets) {
        for (const [key, value] of presets.getAllPresets()) {
            const data = core.pick(value, "name", "type", "format", "videoBitrate", "dimension")
            log.show(JSON.stringify(data))
        }
        return
    }
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, `Invalid Input: ${root}`)
    }
    const testMode = !argv.doit
    const logTag = chalk.green("FFConv")
    let startMs = Date.now()
    log.show(logTag, t("ffmpeg.input", { path: root }))
    // 解析单参数复合参数 ffargs
    // 简写 名称 等价别名
    // vb=video bitrate vbit vbk vbitrate
    // vq=video quality vquality
    // vc = video codec vcodec
    // ab=audio bitrate abit abk abitrate
    // aq=audio quality aquality
    // ac = audio codec acodec
    // px = prefix
    // sx = suffix
    // sp = speed
    // dm = dimension
    // fps = framerate
    argv.ffargs = argparser.parseArgs(argv.ffargs)
    log.info(logTag, `ffargs:`, argv.ffargs)
    // 解析Preset，根据argv参数修改preset，返回对象
    const preset = presets.createFromArgv(argv)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, "FFConv")
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, "FFConv")
        log.fileLog(`Preset: ${JSON.stringify(preset)}`, "FFConv")
    }
    // 首先找到所有的视频和音频文件
    const walkOpts = {
        withFiles: true,
        needStats: true,
        entryFilter: (e) => e.isFile && helper.isMediaFile(e.name),
    }
    let fileEntries = await mf.walk(root, walkOpts)
    // 处理额外目录参数
    if (argv.directories?.length > 0) {
        const extraDirs = new Set(argv.directories.map((d) => path.resolve(d)))
        for (const dirPath of extraDirs) {
            const st = await fs.stat(dirPath)
            if (st.isDirectory()) {
                const dirFiles = await mf.walk(dirPath, walkOpts)
                if (dirFiles.length > 0) {
                    log.show(
                        logTag,
                        t("ffmpeg.add.files", { count: dirFiles.length, path: dirPath }),
                    )
                    fileEntries = fileEntries.concat(dirFiles)
                }
            }
        }
    }
    // 根据完整路径去重
    fileEntries = core.uniqueByFields(fileEntries, "path")
    log.show(
        logTag,
        `Total ${fileEntries.length} files found [${preset.name}] (${helper.humanTime(startMs)})`,
    )
    // 再根据preset过滤找到的文件
    if (preset.type === "video" || presets.isAudioExtract(preset)) {
        // 视频转换模式，保留视频文件
        // 提取音频模式，保留视频文件
        fileEntries = fileEntries.filter((e) => helper.isVideoFile(e.name))
    } else if (preset.type === "audio") {
        // 音频转换模式，保留音频文件
        fileEntries = fileEntries.filter((e) => helper.isAudioFile(e.name))
    }
    log.show(
        logTag,
        `Total ${fileEntries.length} files left [${preset.name}] (${helper.humanTime(startMs)})`,
    )
    // 应用文件名过滤规则
    fileEntries = await applyFileNameRules(fileEntries, argv)
    log.showYellow(logTag, t("ffmpeg.total.files", { count: fileEntries.length }))
    if (fileEntries.length === 0) {
        log.showYellow(logTag, t("ffmpeg.no.files.left"))
        return
    }

    // 如果指定了start和count，截取列表部分
    fileEntries = fileEntries.slice(argv.start, argv.start + argv.count)
    log.show(
        logTag,
        `Total ${fileEntries.length} files left in (${argv.start}-${argv.start + argv.count})`,
    )

    // 仅显示视频文件参数，不进行转换操作
    if (argv.info) {
        for (const entry of fileEntries) {
            log.showGreen(logTag, `${entry.path}`)
            const info = await getMediaInfo(entry.path)
            log.show(logTag, info)
        }
        return
    }
    if (fileEntries.length > 1000) {
        const continueAnswer = await inquirer.prompt([
            {
                type: "confirm",
                name: "yes",
                default: false,
                message: chalk.bold.red(
                    t("ffmpeg.confirm.continue", { count: fileEntries.length }),
                ),
            },
        ])
        if (!continueAnswer.yes) {
            log.showYellow(t("common.aborted.by.user"))
            return
        }
    }
    startMs = Date.now()
    addEntryProps(fileEntries)
    fileEntries = fileEntries.map((entry, index) => {
        return {
            ...entry,
            argv: structuredClone(argv),
            preset: structuredClone(preset),
            // startMs: startMs,
            // index: index,
            // total: fileEntries.length,
            errorFile: argv.errorFile,
            testMode: testMode,
        }
    })

    log.show(logTag, "ARGV:", argv)
    log.show(logTag, "PRESET:", preset)
    const prepareAnswer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(t("ffmpeg.confirm.check", { preset: preset.name })),
        },
    ])
    if (!prepareAnswer.yes) {
        log.showYellow(t("common.aborted.by.user"))
        return
    }
    log.showGreen(logTag, t("ffmpeg.preparing.tasks"))
    let tasks = await pMap(fileEntries, prepareFFmpegCmd, {
        concurrency: argv.jobs || (core.isUNCPath(root) ? 4 : cpus().length - 2),
    })

    // 如果选择了清理源文件
    if (argv.deleteSourceFiles) {
        // 删除目标文件已存在的源文件
        let dstExitsTasks = tasks.filter((t) => t && t.dstExists && !t.fileDst)
        if (dstExitsTasks.length > 0) {
            const answer = await inquirer.prompt([
                {
                    type: "confirm",
                    name: "yes",
                    default: false,
                    message: chalk.bold.red(
                        t("ffmpeg.confirm.delete.source", { count: dstExitsTasks.length }),
                    ),
                },
            ])
            if (answer.yes) {
                addEntryProps(dstExitsTasks)
                await pMap(
                    dstExitsTasks,
                    async (entry) => {
                        await helper.safeRemove(entry.path)
                        log.showYellow(
                            logTag,
                            `SafeDel ${entry.index}/${entry.total} ${entry.path}`,
                        )
                    },
                    { concurrency: cpus().length * 2 },
                )
            }
        }
    }

    tasks = tasks.filter((t) => t && t.fileDst)
    if (tasks.length === 0) {
        log.showYellow(logTag, t("ffmpeg.all.skipped"))
        return
    }
    const lastTask = tasks.slice(-1)[0]
    const lastFFArgs = createFFmpegArgs(lastTask, true, false)
    !testMode && log.fileLog(`ffmpegArgs:`, lastFFArgs?.flat(), "FFConv")
    log.info("-----------------------------------------------------------")
    log.info(logTag, chalk.cyan("PRESET:"), lastTask.debugPreset)
    log.info(logTag, chalk.cyan("CMD:"), "ffmpeg", lastFFArgs?.flat().join(" "))
    const totalDuration = tasks.reduce((acc, t) => acc + t.info?.duration || 0, 0)
    log.info("-----------------------------------------------------------")
    testMode && log.showYellow("++++++++++ " + t("ffmpeg.test.mode") + " ++++++++++")
    log.showYellow(logTag, t("ffmpeg.check.details"))
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("ffmpeg.confirm.process", {
                    count: tasks.length,
                    preset: preset.name,
                    duration: helper.humanSeconds(totalDuration),
                }),
            ),
        },
    ])
    if (!answer.yes) {
        log.showYellow(t("common.aborted.by.user"))
        return
    }
    // 检查ffmpeg可执行文件是否存在
    const ffmpegPath = await which("ffmpeg", { nothrow: true })
    if (!ffmpegPath) {
        throw createError(ErrorTypes.FFMPEG_ERROR, t("ffmpeg.not.found"))
    }
    // 记录开始时间
    startMs = Date.now()
    addEntryProps(tasks)
    // 先写入一次LOG
    await log.flushFileLog()
    // 并发数视频1，音频4，或者参数指定
    const jobCount = argv.jobs || (preset.type === "video" ? 1 : 4)
    // 测试模式只取若干样本数据展示
    if (testMode && tasks.length > 20) {
        tasks = core.takeEveryNth(tasks, Math.floor(tasks.length / 10))
    }
    const results = await pMap(tasks, runFFmpegCmd, { concurrency: jobCount })
    let failedTasks = results.filter((r) => r && r.ffmpegFailed && !r.retryOnFailed)
    let rOKCount = 0
    if (failedTasks.length > 0) {
        const answer = await inquirer.prompt([
            {
                type: "confirm",
                name: "yes",
                default: false,
                message: chalk.bold.red(t("ffmpeg.confirm.retry", { count: failedTasks.length })),
            },
        ])
        if (answer.yes) {
            for (const ft of failedTasks) {
                log.showYellow(logTag, `Retrying task: ${ft.path}`)
                let newFT = core.omit(ft, "ffmpegArgs", "info")
                // 强制使用CPU解码f
                newFT.argv.decodeMode = "cpu"
                newFT.retryOnFailed = true
                const task = await prepareFFmpegCmd(newFT)
                const rt = await runFFmpegCmd(task)
                if (rt && rt.ok) {
                    rOKCount++
                }
            }
        }
    }

    // const results = await core.asyncMapGroup(tasks, runFFmpegCmd, jobCount)
    testMode && log.showYellow(logTag, t("common.test.mode.note"))
    const okResults = results.filter((r) => r && r.ok)
    !testMode &&
        log.showGreen(
            logTag,
            t("ffmpeg.total.processed", {
                count: okResults.length + rOKCount,
                time: helper.humanTime(startMs),
            }),
        )
}

/**
 * 执行FFmpeg命令处理单个媒体文件
 * @param {Object} entry - 文件对象
 * @param {string} entry.path - 文件路径
 * @param {number} entry.size - 文件大小
 * @param {number} entry.index - 文件索引
 * @param {number} entry.total - 总文件数
 * @param {Object} entry.preset - 预设配置
 * @param {Object} entry.dstArgs - 目标参数
 * @param {Object} entry.info - 媒体信息
 * @param {boolean} entry.testMode - 是否为测试模式
 * @param {boolean} entry.retryOnFailed - 是否为重试操作
 * @param {string} entry.fileDst - 目标文件路径
 * @param {string} entry.fileDstDir - 目标文件目录
 * @param {string} entry.fileDstTemp - 临时文件路径
 * @param {string} entry.errorFile - 错误日志文件
 * @returns {Promise<Object|null>} 处理结果对象
 */
async function runFFmpegCmd(entry) {
    const ipx = `${entry.index + 1}/${entry.total}`

    // 检测CUDA解码器，可能耗时1秒左右
    const useCUDA = await canUseCUDADecoder(entry.path)
    entry.useCUDA = useCUDA
    entry.ffmpegArgs = createFFmpegArgs(entry, useCUDA, false)

    let logTag = chalk.green("FFCMD") + chalk.cyanBright(useCUDA ? "[HW]" : "[SW]")
    if (entry.retryOnFailed) {
        logTag += chalk.red("(R)")
    }
    log.show(
        logTag,
        chalk.yellow(ipx),
        chalk.cyan(`Processing`),
        `${helper.pathShort(entry.path, 72)}`,
        helper.humanSize(entry.size),
        chalk.yellow(helper.humanSeconds(entry.dstArgs.srcDuration)),
        entry.preset.name,
        helper.humanTime(entry.startMs),
    )

    // 每10个输出一次ffmpeg详细信息，避免干扰
    // if (entry.index % 10 === 0) {
    log.showGray(logTag, ipx, getEntryShowInfo(entry))
    log.showGray(logTag, ipx, `ffmpeg`, entry.ffmpegArgs.flat().join(" "))
    // }
    const exePath = await which("ffmpeg")
    if (entry.testMode) {
        // 测试模式跳过
        log.show(
            logTag,
            `${ipx} Skipped ${entry.path} (${helper.humanSize(entry.size)}) [TestMode]`,
        )
        return
    }

    // 创建输出目录
    await fs.mkdirp(entry.fileDstDir)
    await fs.remove(entry.fileDstTemp)
    const ffmpegStartMs = Date.now()

    const [inputArgs, middleArgs, outputArgs] = entry.ffmpegArgs
    const metaComment = getCommentArgs(entry)
    const ffmpegArgs = [...inputArgs, ...middleArgs, ...metaComment, ...outputArgs]

    // 创建进度条
    const srcDuration = entry.dstArgs?.srcDuration || entry.info?.duration || 0
    let progressBar = null

    if (srcDuration > 0) {
        progressBar = new cliProgress.SingleBar(
            {
                format: "{bar} | {percentage}% | {filename}",
                barCompleteChar: "█",
                barIncompleteChar: "░",
                hideCursor: true,
                clearOnComplete: false,
                stopOnComplete: true,
                etaBuffer: 10,
                etaAsynchronous: true,
            },
            cliProgress.Presets.shades_classic,
        )

        const fileName = path.parse(entry.path).name
        const shortFileName = fileName.length > 30 ? fileName.substring(0, 27) + "..." : fileName

        progressBar.start(100, 0, {
            filename: shortFileName,
        })
    }

    try {
        await executeFFmpeg(ffmpegArgs, entry, progressBar)

        if (await fs.pathExists(entry.fileDst)) {
            log.showYellow(
                logTag,
                `${ipx} DstExists ${entry.fileDst}`,
                helper.humanSize(entry.size),
                entry.preset.name,
                helper.humanTime(ffmpegStartMs),
            )
            await fs.remove(entry.fileDstTemp)
            return
        }
        if (await fs.pathExists(entry.fileDstTemp)) {
            const dstSize = (await fs.stat(entry.fileDstTemp))?.size || 0
            if (dstSize > 20 * mf.FILE_SIZE_1K) {
                await fs.move(entry.fileDstTemp, entry.fileDst)
                log.show(
                    logTag,
                    chalk.yellow(ipx),
                    chalk.green("Done"),
                    `${entry.fileDst}`,
                    chalk.cyan(`${helper.humanSize(entry.size)}=>${helper.humanSize(dstSize)}`),
                    entry.preset.name,
                    helper.humanTime(ffmpegStartMs),
                )
                log.fileLog(
                    `${ipx} Done <${entry.fileDst}> [${entry.preset.name}] (${helper.humanSize(dstSize)})`,
                    "FFCMD",
                )
                entry.ok = true
                return entry
            } else {
                // 转换失败，删除临时文件
            }
        }
        log.showYellow(
            logTag,
            `${ipx} Failed ${entry.path}`,
            entry.preset.name,
            helper.humanSize(entry.size),
        )
        log.fileLog(
            `${ipx} Failed <${entry.path}> [${entry.dstAudioBitrate || entry.preset.name}]`,
            "FFCMD",
        )
    } catch (error) {
        const errMsg = (error.stderr || error.message || "[Unknown]").substring(0, 160)
        log.showRed(logTag, `Error(${ipx}) <${entry.path}>`, errMsg)
        log.showYellow(
            logTag,
            `Media(${ipx}) <${entry.path}>`,
            JSON.stringify(entry.info?.video || entry.info?.audio),
        )
        log.fileLog(`Error(${ipx}) <${entry.path}> [${entry.preset.name}] ${errMsg}`, "FFCMD")
        await writeErrorFile(entry, error)
        // 转换失败需要重试，使用CPUDecode
        entry.ffmpegFailed = true
        entry.ffmpegError = errMsg
        return entry
    } finally {
        // 确保进度条被正确停止
        progressBar?.stop()
        await fs.remove(entry.fileDstTemp)
    }
}

/**
 * 生成FFmpeg元数据注释参数
 * @param {Object} entry - 文件对象
 * @returns {string[]} FFmpeg元数据参数数组
 */
function getCommentArgs(entry) {
    // 将所有ffmpeg参数放到comment
    const ffmpegArgsText = createFFmpegArgs(entry, entry.useCUDA, true)
        .flat()
        .join(" ")
        .replaceAll(/['"]/gi, " ")
    return ["-metadata", `comment="${ffmpegArgsText}"`]
}

/**
 * 在输出目录写入错误日志文件
 * @param {Object} entry - 文件对象
 * @param {Error} error - 错误对象
 * @returns {Promise<void>}
 */
async function writeErrorFile(entry, error) {
    if (entry.errorFile) {
        const useJson = entry.errorFile === "json"
        const fileExt = useJson ? ".json" : ".txt"
        const nowStr = dayjs().format("YYYYMMDDHHmmss")
        const errorFile = path.join(
            entry.fileDstDir,
            `${path.parse(entry.name).name}_${entry.preset.name}_error_${nowStr}${fileExt}`,
        )
        const errorObj = {
            ...entry,
            error: error,
            date: Date.now(),
        }
        const errData = Object.entries(errorObj)
            .map(([key, value]) => `${key} =: ${value}`)
            .join("\n")
        await fs.writeFile(errorFile, useJson ? JSON.stringify(errorObj, null, 4) : errData)
    }
}

/**
 * 准备FFmpeg命令参数
 * 处理文件路径、媒体信息、目标参数等
 * @param {Object} entry - 文件对象
 * @param {string} entry.path - 文件路径
 * @param {string} entry.name - 文件名
 * @param {number} entry.size - 文件大小
 * @param {number} entry.index - 文件索引
 * @param {number} entry.total - 总文件数
 * @param {Object} entry.preset - 预设配置
 * @param {Object} entry.argv - 命令行参数
 * @param {string} entry.root - 根目录路径
 * @returns {Promise<Object|boolean>} 处理后的文件对象或false（跳过）
 */
async function prepareFFmpegCmd(entry) {
    const preset = entry.preset
    const argv = entry.argv
    let logTag = chalk.green(`Prepare[${entry.argv.decodeMode.toUpperCase()}]`)
    if (entry.retryOnFailed) {
        logTag += chalk.red("(R)")
    }
    const ipx = `${entry.index + 1}/${entry.total}`
    log.info(logTag, `Processing(${ipx}) file: ${entry.path}`)
    const isAudio = helper.isAudioFile(entry.path)
    const isVideo = helper.isVideoFile(entry.path)
    const [srcDir, srcBase, srcExt] = helper.pathSplit(entry.path)
    const dstExt = preset.format || srcExt
    let fileDstDir
    // 命令行参数指定输出目录
    if (argv.output) {
        switch (argv.outputMode) {
            case "tree":
                // 如果要保持源文件目录结构
                fileDstDir = helper.pathRewrite(entry.root, srcDir, preset.output)
                break
            case "file":
                // 不保留目录结构，直接输出文件
                fileDstDir = path.resolve(preset.output)
                break
            // 不保留源文件目录结构，只保留源文件父目录
            case "dir":
                fileDstDir = path.join(preset.output, path.basename(srcDir))
                break
            default:
                throw createError(
                    ErrorTypes.INVALID_ARGUMENT,
                    `Unknown output mode: ${argv.outputMode}`,
                )
        }
    } else {
        // 如果没有指定输出目录，直接输出在原文件同目录
        fileDstDir = path.resolve(srcDir)
    }
    try {
        // 使用ffprobe读取媒体信息，速度较慢
        // 注意flac和ape格式的stream里没有bitrate字段 format里有
        entry.info = await getMediaInfo(entry.path)

        // ffprobe无法读取时长和比特率，可以认为文件损坏，或不支持的格式，跳过
        if (!(entry.info?.duration && entry.info?.bitrate)) {
            log.showYellow(
                logTag,
                `${ipx} Skip[BadFormat]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            log.fileLog(
                `${ipx} Skip[BadFormat]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                "Prepare",
            )
            return false
        }
        const audioCodec = entry.info?.audio?.format
        const videoCodec = entry.info?.video?.format
        if (isAudio) {
            // 检查音频文件
            // 放前面，因为 dstAudioBitrate 会用于前缀后缀参数
            // music-metadata 不支持tta和tak，需要修改
            const meta = await readMusicMeta(entry)
            entry.format = meta?.format
            entry.tags = meta?.tags
            // 如果ffprobe或music-metadata获取的数据中有比特率数据
            log.info(entry.name, preset.name)
            if (entry.format?.bitrate || entry.info?.audio.bitrate || entry.info?.bitrate) {
                // 可以读取码率，文件未损坏
            } else {
                // 如果无法获取元数据，认为不是合法的音频或视频文件，忽略
                log.showYellow(
                    logTag,
                    `${ipx} Skip[Invalid]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                log.fileLog(
                    `${ipx} Skip[Invalid]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                    "Prepare",
                )
                return false
            }
        } else {
            // 检查目标宽高和原始文件宽高，不放大
            const reqDimension = argv.dimension || preset.dimension
            const sw = entry.info?.video?.width || 0
            const sh = entry.info?.video?.height || 0
            // if (sw < reqDimension && sh < reqDimension) {
            //     // 忽略
            //     log.showYellow(logTag, `${ipx} Skip[Dimension]: (${sw}x${sh},${reqDimension}) ${entry.path}`)
            //     log.fileLog(`${ipx} Skip[Dimension]: (${sw}x${sh}) <${entry.path}>`, 'Prepare')
            //     return false
            // }
        }
        // 获取原始音频码率，计算目标音频码率
        // vp9视频和opus音频无法获取码率
        const dstArgs = calculateDstArgs(entry)

        // 计算后的视频和音频码率，关联文件
        // 与预设独立，优先级高于预设
        // srcXX单位为bytes dstXXX单位为kbytes
        let newEntry = {
            ...entry,
            dstArgs,
        }
        log.info(logTag, entry.path, dstArgs)
        // 如果转换目标是音频，但是源文件不含音频流，忽略
        if (entry.preset.type === "audio" && !audioCodec) {
            log.showYellow(
                logTag,
                `${ipx} Skip[NoAudio]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            log.fileLog(
                `${ipx} Skip[NoAudio]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                "Prepare",
            )
            return false
        }
        // 如果转换目标是视频，但是源文件不含视频流，忽略
        if (entry.preset.type === "video" && !videoCodec) {
            log.showYellow(
                logTag,
                `${ipx} Skip[NoVideo]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            log.fileLog(
                `${ipx} Skip[NoVideo]: <${entry.path}> (${helper.humanSize(entry.size)})`,
                "Prepare",
            )
            return false
        }
        // 输出文件名基本名，含前后缀，不含扩展名
        const [fileDstBase, prefix, suffix] = createDstBaseName(newEntry)
        const fileDstName = `${fileDstBase}${dstExt}`
        const fileDst = path.join(fileDstDir, `${fileDstName}`)
        // 临时文件后缀
        const tempSuffix = `_tmp@${helper.textHash(entry.path)}@tmp_`
        // 临时文件名

        const fileDstTemp = path.join(fileDstDir, `${fileDstBase}${tempSuffix}${dstExt}`)
        const fileDstSameDir = path.join(srcDir, `${fileDstName}`)

        if (await fs.pathExists(fileDst)) {
            log.showYellow(
                logTag,
                `${ipx} Skip[Dst1]: ${entry.path} (${helper.humanSize(entry.size)})`,
            )
            return {
                ...entry,
                dstExists: true,
            }
        }
        // 文件名变了，带有前缀或后缀
        // 才需要判断同目录的文件是否存在
        if (prefix || suffix) {
            // if (fileDstName !== entry.name) {
            if (await fs.pathExists(fileDstSameDir)) {
                log.showYellow(
                    logTag,
                    `${ipx} Skip[Dst2]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                return {
                    ...entry,
                    dstExists: true,
                }
            }
        }

        const duration = newEntry.info?.duration || ivideo?.duration || iaudio?.duration || 0
        // 跳过过短的文件
        if (duration < 4) {
            log.showYellow(
                logTag,
                `${ipx} Skip[Short]: ${entry.path} (${helper.humanSize(entry.size)}) Duration=${duration}s)`,
            )
            return false
        }

        const ivideo = newEntry.info?.video
        const iaudio = newEntry.info?.audio
        if (isVideo) {
            switch (argv.decodeMode) {
                case "cpu":
                    newEntry.useCPUDecode = true
                    break
                case "gpu":
                    newEntry.useCPUDecode = false
                    break
                case "auto":
                default:
                    {
                        // https://developer.nvidia.com/video-encode-and-decode-gpu-support-matrix-new
                        // H264 10Bit Nvidia和Intel都不支持硬解，直接跳过
                        // H264 High L5以上可能也不支持
                        const isH264 = ivideo?.format === "h264" || ivideo?.format === "avc"
                        const isHigh50 = ivideo?.profile?.includes("High") && ivideo?.level > 4.2
                        if (isH264 && ivideo?.bitDepth === 10) {
                            // 添加标志，使用软解，替换解码参数
                            // 在组装ffmpeg参数时判断和替换
                            // 解码和滤镜参数都需要修改
                            // 尝试使用CPU解码
                            newEntry.useCPUDecode = true
                        }
                    }
                    break
            }
        }

        // 找到并添加字幕文件，当前目录和subs子目录
        const subExts = [".ass", ".ssa", ".srt"]
        const subtitles = []
        for (const ext of subExts) {
            const sub1 = path.join(srcDir, `${srcBase}${ext}`)
            const sub2 = path.join(srcDir, "subs", `${srcBase}${ext}`)
            if (await fs.pathExists(sub1)) {
                subtitles.push(sub1)
            }
            if (await fs.pathExists(sub2)) {
                subtitles.push(sub2)
            }
        }
        const codecInfo = isAudio
            ? `${iaudio?.format}(${iaudio?.sampleRate},${iaudio?.bitrate},${iaudio.duration})`
            : `${ivideo?.format}(${ivideo?.profile}@${ivideo?.level},${ivideo?.bitDepth})`
        log.show(
            logTag,
            chalk.cyan(`${ipx} SRC`),
            chalk.yellow(newEntry.useCPUDecode ? `SW` : `HW`),
            `"${helper.pathShort(entry.path, 80)}"`,
            subtitles.length > 0 ? "(SUBS)" : "",
            codecInfo,
            helper.humanSize(entry.size),
            chalk.yellow(entry.preset.name),
            helper.humanTime(entry.startMs),
        )
        log.showGray(logTag, `${ipx} DST`, fileDst)
        log.showGray(logTag, `${ipx}`, getEntryShowInfo(newEntry))
        newEntry = {
            ...newEntry,
            fileDstDir,
            fileDstBase,
            fileDst,
            fileDstTemp,
            subtitles,
        }
        // newEntry.ffmpegArgs = createFFmpegArgs(newEntry)
        // log.info(logTag, "ffmpeg", newEntry.ffmpegArgs.flat().join(" "))
        return newEntry
    } catch (error) {
        log.error(logTag, `${ipx} Skip[Error]: ${entry.path}`, error)
        throw error
    }
}

/**
 * 创建目标文件名基本名，不包含路径和扩展名
 * @param {Object} entry - 文件对象
 * @param {string} entry.name - 原始文件名
 * @param {Object} entry.preset - 预设配置
 * @param {string} entry.preset.name - 预设名称
 * @param {string} entry.preset.prefix - 前缀模板
 * @param {string} entry.preset.suffix - 后缀模板
 * @param {Object} entry.dstValues - 目标值
 * @param {number} entry.audioBitrate - 音频码率
 * @param {number} entry.videoBitrate - 视频码率
 * @returns {Array} [fileDstBase, prefix, suffix] - 目标文件名基本名、前缀、后缀
 */
function createDstBaseName(entry) {
    const srcBase = path.parse(entry.name).name
    // 模板参数变量，除了Preset的字段，有些需要替换
    const replaceArgs = {
        preset: entry.preset.name,
        ...entry.preset,
        ...entry.dstValues,
        // 兼容字符串模板展示
        audioBitrate: entry.audioBitrate,
        videoBitrate: entry.videoBitrate,
    }
    // log.show(entry.preset)
    // 应用模板参数到前缀和后缀字符串模板
    const prefix = helper.filenameSafe(formatArgs(entry.preset.prefix || "", replaceArgs))
    const suffix = helper.filenameSafe(formatArgs(entry.preset.suffix || "", replaceArgs))
    // return { prefix, suffix }
    return [`${prefix}${srcBase}${suffix}`, prefix, suffix]
}

/**
 * 将数值转换为K为单位的字符串
 * @param {number} value - 原始数值
 * @returns {string} 转换后的字符串
 */
function kNum(value) {
    return `${Math.round(value / 1000)}K`
}

/**
 * 显示媒体编码和码率信息，调试用
 * @param {Object} entry - 文件对象
 * @param {Object} entry.info - 媒体信息
 * @param {Object} entry.info.audio - 音频信息
 * @param {Object} entry.info.video - 视频信息
 * @param {Object} entry.info.subtitles - 字幕信息
 * @param {Object} entry.dstArgs - 目标参数
 * @param {string} entry.dstArgs.srcAudioCodec - 原始音频编码
 * @param {string} entry.dstArgs.srcVideoCodec - 原始视频编码
 * @param {number} entry.dstArgs.srcAudioBitrate - 原始音频码率
 * @param {number} entry.dstArgs.dstAudioBitrate - 目标音频码率
 * @param {number} entry.dstArgs.srcVideoBitrate - 原始视频码率
 * @param {number} entry.dstArgs.dstVideoBitrate - 目标视频码率
 * @param {number} entry.dstArgs.dstAudioQuality - 目标音频质量
 * @param {number} entry.dstArgs.dstFrameRate - 目标视频帧率
 * @param {number} entry.dstArgs.srcFrameRate - 原始视频帧率
 * @param {number} entry.dstArgs.speed - 速度
 * @param {number} entry.dstArgs.srcWidth - 原始视频宽度
 * @param {number} entry.dstArgs.dstWidth - 目标视频宽度
 * @param {number} entry.dstArgs.srcHeight - 原始视频高度
 * @param {number} entry.dstArgs.dstHeight - 目标视频高度
 * @param {number} entry.size - 文件大小
 * @param {number} entry.dstArgs.srcDuration - 视频时长
 * @returns {string} 格式化的媒体信息字符串
 */
function getEntryShowInfo(entry) {
    const ia = entry.info?.audio
    const iv = entry.info?.video
    const is = entry.info?.subtitles
    const args = { ...entry, ...entry.dstArgs }
    const ac = args.srcAudioCodec
    const vc = args.srcVideoCodec
    const showText = []
    // showText.push(`pt:${entry.preset.name}`)
    showText.push(`sz:${helper.humanSize(args.size)}`)
    showText.push(`ts:${helper.humanSeconds(args.srcDuration)}`)
    if (ia?.duration) {
        showText.push(`a:${ac}`)
        if (args.dstAudioBitrate !== args.srcAudioBitrate) {
            showText.push(`ab:${kNum(args.srcAudioBitrate)}=>${kNum(args.dstAudioBitrate)}`)
        } else {
            showText.push(`ab:${kNum(args.srcAudioBitrate)}`)
        }
        if (args.dstAudioQuality > 0) {
            showText.push(`aq:${args.dstAudioQuality}`)
        }
    }
    if (iv?.duration) {
        showText.push(`v:${vc}(${iv.profile}@${iv.level})`)
        if (args.dstVideoBitrate !== args.srcVideoBitrate) {
            showText.push(`vb:${kNum(args.srcVideoBitrate)}=>${kNum(args.dstVideoBitrate)}`)
        } else {
            showText.push(`vb:${kNum(args.srcVideoBitrate)}`)
        }
        if (args.dstFrameRate > 0 && args.dstFrameRate !== args.srcFrameRate) {
            showText.push(`fps:${args.srcFrameRate}=>${args.dstFrameRate}`)
        } else {
            showText.push(`fps:${args.srcFrameRate}`)
        }
        if (args.speed > 0) {
            showText.push(`sp:${args.speed}`)
        }
        if (args.srcWidth !== args.dstWidth || args.srcHeight !== args.dstHeight) {
            showText.push(`${args.srcWidth}x${args.srcHeight}=>${args.dstWidth}x${args.dstHeight}`)
        } else {
            showText.push(`${args.srcWidth}x${args.srcHeight}`)
        }
    }
    if (is?.length > 0) {
        showText.push(is.map((s) => `${s.format}-${s.language}`).join("|"))
    }
    return showText.join(",")
}

/**
 * 读取单个音频文件的元数据
 * @param {Object} entry - 文件对象
 * @param {string} entry.path - 文件路径
 * @param {string} entry.name - 文件名
 * @param {number} entry.index - 文件索引
 * @returns {Promise<Object|null>} 包含格式和标签信息的对象或null
 */
async function readMusicMeta(entry) {
    try {
        const mt = await mm.parseFile(entry.path, { skipCovers: true })
        if (mt?.format && mt.common) {
            // log.show('format', mt.format)
            // log.show('common', mt.common)
            log.info(
                "Metadata",
                `Read(${entry.index}) ${entry.name} [${mt.format.codec}|${mt.format.duration}|${mt.format.bitrate}|${mt.format.lossless}, ${mt.common.artist},${mt.common.title},${mt.common.album}]`,
            )
            return {
                format: mt.format,
                tags: mt.common,
            }
        } else {
            log.info("Metadata", entry.index, "no tags found", helper.pathShort(entry.path))
        }
    } catch (error) {
        log.info(
            "Metadata",
            entry.index,
            "no tags found",
            helper.pathShort(entry.path),
            error.message,
        )
    }
}

// 音频码率映射表
// 只有存储设备如内存和硬盘用1K=1024，其它时候都是1K=1000
const bitrateMap = [
    { threshold: 320 * 1000, value: 320 * 1000 },
    { threshold: 256 * 1000, value: 256 * 1000 },
    { threshold: 192 * 1000, value: 192 * 1000 },
    { threshold: 128 * 1000, value: 128 * 1000 },
    { threshold: 96 * 1000, value: 96 * 1000 },
    { threshold: 64 * 1000, value: 64 * 1000 },
    { threshold: 0, value: 48 * 1000 }, // 默认值
]

/**
 * 获取非零最小值
 * @param {number[]} numbers - 数字数组
 * @returns {number} 非零最小值
 */
function minNoZero(...numbers) {
    const fNumbers = numbers.filter((n) => n > 0)
    return Math.min(...fNumbers)
}

/**
 * 计算视频和音频码率等各种目标文件数据
 * @param {Object} entry - 文件对象
 * @param {string} entry.path - 文件路径
 * @param {string} entry.name - 文件名
 * @param {Object} entry.preset - 预设配置
 * @param {Object} entry.preset.userArgs - 用户参数
 * @param {number} entry.preset.userArgs.audioBitrate - 用户指定的音频码率
 * @param {number} entry.preset.userArgs.videoBitrate - 用户指定的视频码率
 * @param {number} entry.preset.userArgs.audioQuality - 用户指定的音频质量
 * @param {number} entry.preset.userArgs.videoQuality - 用户指定的视频质量
 * @param {number} entry.preset.userArgs.speed - 用户指定的速度
 * @param {number} entry.preset.userArgs.dimension - 用户指定的分辨率
 * @param {number} entry.preset.audioBitrate - 预设的音频码率
 * @param {number} entry.preset.videoBitrate - 预设的视频码率
 * @param {number} entry.preset.audioQuality - 预设的音频质量
 * @param {number} entry.preset.videoQuality - 预设的视频质量
 * @param {number} entry.preset.speed - 预设的速度
 * @param {number} entry.preset.dimension - 预设的分辨率
 * @param {boolean} entry.preset.smartBitrate - 是否启用智能码率
 * @param {Object} entry.info - 媒体信息
 * @param {Object} entry.info.video - 视频信息
 * @param {Object} entry.info.audio - 音频信息
 * @param {Object} entry.format - 格式信息
 * @returns {Object} 目标参数对象
 */
function calculateDstArgs(entry) {
    const ep = entry.preset
    const info = entry.info
    const ivideo = entry.info?.video
    const iaudio = entry.info?.audio

    // eg. '-map a:0 -c:a libfdk_aac -b:a {bitrate}'
    let srcAudioBitrate = 0
    let dstAudioBitrate = 0
    let srcVideoBitrate = 0
    let dstVideoBitrate = 0

    let srcFrameRate = 0
    let dstFrameRate = 0
    let dstWidth = 0
    let dstHeight = 0

    // 源文件时长
    const srcDuration = info?.duration || ivideo?.duration || iaudio?.duration || 0

    const srcWidth = ivideo?.width || 0
    const srcHeight = ivideo?.height || 0

    const reqAudioBitrate = ep.userArgs.audioBitrate || ep.audioBitrate
    const reqVideoBitrate = ep.userArgs.videoBitrate || ep.videoBitrate

    const dstAudioQuality = ep.userArgs.audioQuality || ep.audioQuality
    const dstVideoQuality = ep.userArgs.videoQuality || ep.videoQuality

    const dstSpeed = ep.userArgs.speed || ep.speed
    const dstDimension = ep.userArgs.dimension || ep.dimension

    // 只有目标长边小于原视频长边时才需要缩放，才需要加sclae filter
    // 避免加不必要的ffmpeg参数拖累性能
    const dstScaleNeeded = srcWidth > dstDimension || srcHeight > dstDimension

    if (helper.isAudioFile(entry.path)) {
        // 音频文件
        // 文件信息中的码率值
        const fileBitrate = entry.format?.bitrate || info?.bitrate || iaudio?.bitrate || 0
        if (fileBitrate > 0) {
            srcAudioBitrate = fileBitrate
        } else {
            // 对于无法读取码率的音频文件
            if (entry.format?.lossless || helper.isAudioLossless(entry.path)) {
                // 无损音频，设置默认值
                srcAudioBitrate = srcAudioBitrate > 320 * 1000 ? srcAudioBitrate : 999 * 1000
            } else {
                // 非无损音频，也无法读取码率的话，应该是文件损坏

                srcAudioBitrate = 0
            }
        }
        if (srcAudioBitrate > 0) {
            // 如果启用了智能码率
            if (ep.smartBitrate) {
                dstAudioBitrate =
                    bitrateMap.find((br) => srcAudioBitrate > br.threshold)?.value || 48 * 1000
            } else {
                // 智能码率关闭，直接使用用户值或预设值
                dstAudioBitrate = reqAudioBitrate
            }
        } else {
            // 有的文件无法获取音频码率，如opus，此时srcAudioBitrate=0
            // opus用于极低码率音频，此时 dstAudioBitrate=48 可以接受
            dstAudioBitrate = 48 * 1000
        }
        // 转换后的码率不能高于源文件码率
        dstAudioBitrate = minNoZero(dstAudioBitrate, srcAudioBitrate)
    } else {
        // 视频文件
        const dstWH = calculateScale(srcWidth, srcHeight, dstDimension)
        dstWidth = dstWH.dstWidth
        dstHeight = dstWH.dstHeight
        const bigSideDst = Math.max(dstWidth, dstHeight)
        const bigSideSrc = Math.max(srcWidth, srcHeight)
        const srcPixels = srcWidth * srcHeight
        const dstPixels = dstWidth * dstHeight
        // 这个是文件整体码率，如果是是视频文件，等于是视频和音频的码率相加
        const fileBitrate = info?.bitrate || 0
        srcAudioBitrate = iaudio?.bitrate || 0
        // 计算出的视频码率不高于源文件的视频码率
        // 减去音频的码率，估算为48k
        srcVideoBitrate = ivideo?.bitrate || fileBitrate - 48 * 1000 || 0

        // 音频和视频码率 用户指定>预设
        // 音频和视频码率都不能高于原码率
        dstAudioBitrate = minNoZero(srcAudioBitrate, reqAudioBitrate)
        // 如果源文件不是1080p，这里码率需要考虑分辨率
        let pixelsScale = 1
        if (dstDimension > bigSideDst) {
            // 如果使用4KPreset压缩1080P视频，需要缩放码率
            // 4K60 ~= 1080P60 * (1.5,2)
            pixelsScale = (bigSideDst / dstDimension) * 1.1
        } else if (dstDimension < bigSideDst) {
            // 其它情况按长边比例就差不多
            pixelsScale = bigSideDst / bigSideSrc
        } else {
            pixelsScale = 1
        }
        dstVideoBitrate = reqVideoBitrate * pixelsScale

        log.info(
            "calculateDstArgs",
            entry.name,
            "fileBitrate",
            fileBitrate,
            "srcVideoBitrate",
            srcVideoBitrate,
            "reqVideoBitrate",
            reqVideoBitrate,
            "dstVideoBitrate",
            dstVideoBitrate,
            "pixelsScale",
            pixelsScale,
            "bigSide",
            bigSideDst,
            "dstDimension",
            dstDimension,
            "scaled",
            dstScaleNeeded,
        )
        const PIXELS_1080P = 1920 * 1080
        // 小于1080p分辨率，码率也需要缩放
        if (bigSideDst < 1920) {
            let scaleFactor = dstPixels / PIXELS_1080P
            // 如果目标码率是4K，暂时不考虑
            // 如果目标码率不是1080p，根据分辨率智能缩放
            // 示例 辨率1920*1080的目标码率是 1600k
            // 1280*720码率 960k
            // scaleFactor = Math.sqrt(scaleFactor)
            // 缩放码率，平滑系数
            scaleFactor = core.smoothChange(scaleFactor, 1, 0.3)
            // log.info('scaleFactor', scaleFactor)
            dstVideoBitrate = Math.round(dstVideoBitrate * scaleFactor)
        }
        // 目标分辨率，不能大于源文件分辨率
        dstVideoBitrate = minNoZero(dstVideoBitrate, srcVideoBitrate)
        // 取整
        // dstVideoBitrate = Math.floor(dstVideoBitrate / 1000) * 1000
    }

    // 如果目标帧率大于原帧率，就将目标帧率设置为0，即让ffmpeg自动处理，不添加帧率参数
    // 源文件帧率
    srcFrameRate = ivideo?.framerate || 0
    // 预设或用户帧率，用户指定>预设
    const reqFrameRate = ep.userArgs.framerate || ep.framerate
    // 计算出的目标帧率
    dstFrameRate = reqFrameRate < srcFrameRate ? reqFrameRate : 0

    // 用于模板字符串的模板参数，针对当前文件
    // 额外模板参数
    // videoBitrateK audioBitrateK用于ffmpeg参数
    return {
        // 源文件参数
        srcAudioBitrate,
        srcVideoBitrate,
        srcFrameRate,
        srcDuration,
        srcWidth: srcWidth,
        srcHeight: srcHeight,
        srcSize: info?.size || 0,
        srcVideoCodec: ivideo?.format,
        srcAudioCodec: iaudio?.format,
        srcFormat: info?.format,
        // 计算出来的参数
        dstAudioBitrate,
        dstVideoBitrate,
        dstAudioQuality,
        dstVideoQuality,
        dstFrameRate,
        dstWidth,
        dstHeight,
        dstSpeed,
        // 码率智能缩放
        audioBitScale: core.roundNum(dstAudioBitrate / srcAudioBitrate),
        videoBitScale: core.roundNum(dstVideoBitrate / srcVideoBitrate),
        // 会覆盖preset的同名预设值
        // videoBitrate: dstVideoBitrate,
        videoBitrateK: `${Math.round(dstVideoBitrate / 1000)}K`,
        videoQuality: dstVideoQuality,
        // audioBitrate: dstAudioBitrate,
        audioBitrateK: `${Math.round(dstAudioBitrate / 1000)}K`,
        audioQuality: dstAudioQuality,
        framerate: dstFrameRate,
        dimension: dstDimension,
        speed: dstSpeed,
        // needs scale
        scaled: dstScaleNeeded,
    }
}

/**
 * 组合各种参数，替换模板参数，输出最终的ffmpeg命令行参数
 * @param {Object} entry - 文件对象
 * @param {boolean} useCUDA - 是否使用CUDA加速
 * @param {boolean} forDisplay - 是否仅用于显示
 * @returns {Array} [inputArgs, middleArgs, outputArgs] - 输入参数、中间参数、输出参数
 */
function createFFmpegArgs(entry, useCUDA = false, forDisplay = false) {
    // 不要使用 entry.perset，下面复制一份针对每个entry
    const tempPreset = { ...entry.preset, ...entry.dstArgs }

    log.info(">>>>", entry.name)
    log.info(tempPreset)

    // 输入参数
    let inputArgs = []

    // 是否需要添加fps filter
    if (tempPreset.framerate > 0) {
        if (tempPreset.filters?.length > 0) {
            tempPreset.filters += ",fps={framerate}"
        } else {
            tempPreset.filters = "fps={framerate}"
        }
    }

    log.info("createFFmpegArgs", "tempPreset", entry.name, tempPreset)

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
    //
    //===============================================================
    // 输入参数部分，在 -i input 前面
    //===============================================================
    //
    inputArgs.push("-hide_banner", "-n")
    // 是否启用调试参数
    inputArgs.push("-v", entry.argv.debug ? "repeat+level+info" : "error")
    // 输出视频时才需要cuda加速，音频用cpu就行
    if (tempPreset.type === "video") {
        inputArgs.push("-progress", "-", "-nostats")
        // 只能使用cuda缩放
        if (useCUDA) {
            // 使用cuda硬件解码
            inputArgs.push("-hwaccel", "cuda", "-hwaccel_output_format", "cuda")
        } else {
            // 系统自动选择
            inputArgs.push("-hwaccel", "auto")
        }
    } else {
        inputArgs.push("-stats")
    }
    // 输入参数在输入文件前面，顺序重要
    if (tempPreset.inputArgs?.length > 0) {
        inputArgs = inputArgs.concat(tempPreset.inputArgs.split(" "))
    }
    inputArgs.push("-i")
    inputArgs.push(forDisplay ? "input.mkv" : `"${entry.path}"`)
    // 添加MP4内嵌字幕文件，支持多个字幕文件
    if (entry.subtitles?.length > 0) {
        // 用于显示和调试
        tempPreset.subtitles = entry.subtitles.map((item) => path.basename(item))
        entry.subtitles.forEach((item) => {
            inputArgs.push("-i")
            inputArgs.push(`"${item}"`)
        })
        const subArgs = "-c:s mov_text -metadata:s:s:0 language=chi -disposition:s:0 default"
        inputArgs = inputArgs.concat(subArgs.split(" "))
        // 使用提供的字幕，忽略MKV内置字幕文件
        inputArgs = inputArgs.concat("-map 0:v -map 0:a -map 1".split(" "))
    } else {
        // MP4格式仅支持tx3g格式字幕
        const subs = entry.info?.subtitles
        if (subs?.length > 0) {
            const isAllTextSubs = subs?.every((e) => e.codec === "tx3g")
            if (isAllTextSubs) {
                inputArgs = inputArgs.concat("-c:s mov_text".split(" "))
            } else {
                // 不支持的字幕直接忽略
                inputArgs.push("-sn")
            }
        }
    }
    //
    //===============================================================
    // 中间参数部分，在 -i input 后面
    // 顺序建议 filters codec stream metadata
    //===============================================================
    //
    // 中间参数
    let middleArgs = []

    // 添加MP4硬字幕
    // if (entry.fileSubtitle) {
    //     entryPreset.filters = `-subtitles="${entry.fileSubtitle}"`
    // }

    // 滤镜参数
    // complexFilter 和 filters 不能同时存在
    if (tempPreset.complexFilter?.length > 0) {
        middleArgs.push("-filter_complex")
        middleArgs.push(`"${formatArgs(tempPreset.complexFilter, tempPreset)}"`)
    } else if (tempPreset.filters?.length > 0) {
        // 只有需要缩放时才加 scale filter
        if (entry.dstArgs.scaled) {
            let tempFilters = tempPreset.filters
            // 使用软解时，需要传输数据道GPU
            if (!useCUDA) {
                tempFilters = "hwupload_cuda," + tempFilters
            }
            middleArgs.push("-vf")
            middleArgs.push(formatArgs(tempFilters, tempPreset))
        }
    }
    // 视频参数
    if (tempPreset.videoArgs?.length > 0) {
        const va = formatArgs(tempPreset.videoArgs, tempPreset)
        middleArgs = middleArgs.concat(va.split(" "))
    }
    // 音频参数
    if (tempPreset.audioArgs?.length > 0) {
        // extract_audio模式下智能选择编码器
        // 直接复制音频流或者重新编码
        // audioArgsCopy: '-c:a copy',
        // audioArgsEncode: '-c:a libfdk_aac -b:a {audioBitrate}k',
        let audioArgsPreset = tempPreset.audioArgs
        if (presets.isAudioExtract(tempPreset)) {
            if (entry.srcAudioCodec === "aac") {
                tempPreset.audioArgs = "-c:a copy"
            }
        } else {
            // 针对视频文件
            if (helper.isVideoFile(entry.path)) {
                // 如果目标码率大于源文件码率，则不重新编码，考虑误差
                const shouldCopy =
                    tempPreset.srcAudioBitrate > 0 &&
                    tempPreset.dstAudioBitrate + 2000 > tempPreset.srcAudioBitrate
                // 如果用户指定不重新编码
                if (shouldCopy || tempPreset.userArgs.audioCopy) {
                    tempPreset.audioArgs = "-c:a copy"
                }
            }
        }
        const aa = formatArgs(tempPreset.audioArgs, tempPreset)
        middleArgs = middleArgs.concat(aa.split(" "))
    }
    // 其它参数
    // metadata 参数放这里
    let metaArgs = []
    // 添加自定义metadata字段
    //description, comment, copyright
    const descArgs = []
    descArgs.push(getEntryShowInfo(entry))
    const dateText = dayjs().format("YYYY-MM-DD hh:mm:ss.SSS Z")
    const descArgsText = descArgs.join("|")
    metaArgs.push(`-metadata`, `description="${descArgsText}"`)
    metaArgs.push(
        `-metadata`,
        `copyright="mediac ffmpeg --preset ${tempPreset.name} --date ${dateText}"`,
    )
    // 音频文件才添加元数据
    // 检查源文件元数据
    if (helper.isAudioFile(entry.path) && entry.tags?.title) {
        const KEY_LIST = ["title", "artist", "album", "albumartist", "year"]
        // 验证 非空值，无乱码，值为字符串或数字
        const validTags = core.filterFields(entry.tags, (key, value) => {
            return (
                KEY_LIST.includes(key) &&
                Boolean(value) &&
                ((typeof value === "string" && value.length > 0) || typeof value === "number") &&
                !enc.hasBadCJKChar(value) &&
                !enc.hasBadUnicode(value)
            )
        })
        // 去掉值字符串中的单双引号，避免参数解析错误
        for (const [key, value] of Object.entries(validTags)) {
            if (typeof value === "string") {
                validTags[key] = value.replaceAll(/['"]/gi, " ")
            }
        }
        metaArgs = metaArgs.concat(
            ...Object.entries(validTags).map(([key, value]) => [`-metadata`, `${key}="${value}"`]),
        )
    } else {
        metaArgs.push(`-metadata`, `title="${entry.name}"`)
    }
    // 显示console信息时，不需要这些
    // 元数据放到 extraArgs 这里
    if (!forDisplay) {
        tempPreset.extraArgs = metaArgs.join(" ")
    }
    // 不要漏掉 extraArgs
    if (tempPreset.extraArgs?.length > 0) {
        middleArgs = middleArgs.concat(tempPreset.extraArgs.split(" "))
    }
    // 流参数 streamArgs -map xxx 等
    if (tempPreset.streamArgs?.length > 0) {
        middleArgs = middleArgs.concat(tempPreset.streamArgs.split(" "))
    }
    // 输出参数在最后，在输出文件前面，顺序重要
    if (tempPreset.outputArgs?.length > 0) {
        middleArgs = middleArgs.concat(tempPreset.outputArgs.split(" "))
    }
    //===============================================================
    // 输出参数部分，只有一个输出文件路径
    //===============================================================
    // 显示数据时用最终路径，实际使用时用临时文件路径
    const outputArgs = [forDisplay ? "output.mp4" : `"${entry.fileDstTemp}"`]

    // 仅用于展示
    entry.debugPreset = core.formatObjectArgs(tempPreset, tempPreset)
    entry.debugArgs = [...inputArgs, ...middleArgs, ...outputArgs]

    // 返回三种参数，方便后面组合保存ffmpeg参数到元数据
    return [inputArgs, middleArgs, outputArgs]
}

/**
 * 执行FFmpeg命令
 * @param {Array} args - FFmpeg命令参数
 * @param {Object} entry - 文件对象
 * @param {Object} progressBar - 进度条对象
 * @returns {Promise<void>}
 */
async function executeFFmpeg(args, entry, progressBar = null) {
    const ipx = `${entry.index + 1}/${entry.total}`
    const logTag = chalk.green("FFCMD") + chalk.cyanBright(entry.useCUDA ? "[HW]" : "[SW]")
    const srcDuration = entry.dstArgs?.srcDuration || entry.info?.duration || 0

    // 1. 创建控制器
    const controller = new AbortController()
    const { signal } = controller

    // 2. 启动子进程
    // shell: true 是必须的，因为参数包含复杂引号
    const subprocess = execa("ffmpeg", args, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        shell: true,
        encoding: "latin1",
        cancelSignal: signal,
        forceKillAfterDelay: 1000,
        cleanup: true,
    })

    // 解析进度信息
    let currentTime = 0

    // 监听 stdout
    subprocess.stdout.on("data", (data) => {
        const lines = data.toString().split("\n")
        for (const line of lines) {
            const trimmedLine = line.trim()
            // 解析 out_time= 字段（-progress 输出的是 out_time）
            const timeMatch = trimmedLine.match(/^out_time=(.*)$/)
            if (timeMatch) {
                const timeStr = timeMatch[1].trim()
                currentTime = parseTimeToSeconds(timeStr)

                // 计算进度百分比
                if (srcDuration > 0 && progressBar) {
                    const progress = Math.min(100, Math.round((currentTime / srcDuration) * 100))
                    progressBar.update(progress)
                }
            }
        }
    })

    // 监听 stderr
    subprocess.stderr.on("data", (data) => {
        const line = data.toString()
        // 如果包含错误关键字，记录到日志
        if (line.includes("Error") || line.includes("error")) {
            progressBar?.stop()
            log.showRed(logTag, "FFmpeg Error:", line.trim().substring(0, 200))
        }
    })

    try {
        await subprocess
        // 进度完成，确保换行
        progressBar?.stop()
        log.show() // 添加换行符
    } catch (error) {
        progressBar?.stop()
        log.show() // 添加换行符
        throw error
    }
}

/**
 * 将 ffmpeg 时间格式 HH:MM:SS.ms 转换为秒数
 * @param {string} timeStr - 时间字符串
 * @returns {number} 秒数
 */
function parseTimeToSeconds(timeStr) {
    // timeStr 格式可能是:
    // 1. "00:00:04.633333" (out_time, 有6位小数)
    // 2. "00:04:36.30" (time, 有2位小数)
    // 3. "00:04:36" (无小数)
    const parts = timeStr.split(":")
    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts
        // 只取小数点前两位，忽略微秒
        const secondsNum = parseFloat(seconds)
        return parseFloat(hours) * 3600 + parseFloat(minutes) * 60 + secondsNum
    }
    return 0
}

/**
 * 检测CUDA解码器支持情况
 * @param {string} inputPath - 输入文件路径
 * @returns {Promise<boolean>} 是否支持CUDA解码
 */
async function canUseCUDADecoder(inputPath) {
    try {
        // 探测命令
        const { stderr } = await execa(
            "ffmpeg",
            [
                "-v",
                "error",
                "-hwaccel",
                "cuda",
                "-hwaccel_output_format",
                "cuda",
                "-i",
                inputPath,
                "-frames:v",
                "1",
                "-f",
                "null",
                "-",
            ],
            {
                // shell: true,
                // encoding: "latin1",
                cleanup: true,
            },
        )
        // console.error("stderr", stderr)
        if (!stderr) {
            return true
        }
        // 只要 stderr 包含这些关键字，就判定为硬件解码无法处理
        return !(
            stderr.includes("CUDA_ERROR_INVALID_VALUE") ||
            stderr.includes("Failed setup for format cuda")
        )
    } catch (error) {
        // console.error("catch error", error)
        return false
    }
}
