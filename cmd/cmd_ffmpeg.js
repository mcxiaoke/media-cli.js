/*
 * Project: mediac
 * Created: 2024-04-19 09:54:07
 * Modified: 2024-04-19 09:54:07
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from "chalk"
import fs from "fs-extra"
import pMap from "p-map"
import path from "path"
import argparser from "../lib/arg_parser.js"
import { abortIfCancelled, confirmDangerousAction, initAutoConfirm } from "../lib/command_utils.js"
import config from "../lib/config.js"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import { ErrorTypes, createError } from "../lib/errors.js"
import presets from "../lib/ffmpeg_presets.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { getMediaInfo } from "../lib/mediainfo.js"
import { addEntryProps, applyFileNameRules } from "../lib/rename.js"
import { TIERS } from "../lib/hwaccel.js"
import {
    calculateDstArgs,
    createDstBaseName,
    getEntryShowInfo,
    readMusicMeta,
    selectPreferredSubtitle,
} from "../lib/ffmpeg_plan.js"
import { createFFmpegArgs, flattenFFArgs } from "../lib/ffmpeg_build.js"
import { LOG_TAG, runFFmpegCmd, setFFmpegPath } from "../lib/ffmpeg_run.js"
import { resolveFFmpegBinary } from "../lib/ffmpeg_bin.js"
import { detectHardwareCapabilities } from "../lib/hwdetect.js"

// ===========================================
// 命令内容执行
// ===========================================

/**
 * 加载 YAML 预设（分层：包内 presets/default.yaml → ~/.mediac/presets.yaml → cwd/presets.yaml）
 *
 * P0-2 修复：本函数在模块顶层 await 执行（见下方调用），保证 yargs builder 的
 * `choices: presets.getAllNames()` 求值时已包含全部 YAML 预设。函数幂等：
 * 模块顶层调用后，plan 阶段再次调用直接返回。
 *
 * 预设唯一源就是 YAML：包内 presets/default.yaml 随包发布（内置层，总是存在）；
 * 用户层 ~/.mediac 与 cwd 仅作覆盖/新增层。加载失败（如用户文件写坏）只影响
 * 对应层，default.yaml 层仍可用，不阻断命令。
 */
let yamlPresetsLoaded = false
async function loadYamlPresets() {
    if (yamlPresetsLoaded) {
        return
    }
    yamlPresetsLoaded = true
    try {
        await presets.initPresetsAsync()
        const total = presets.getAllNames().length
        log.logInfo(LOG_TAG, `FFmpeg presets loaded: ${total} from YAML layers`)
    } catch (error) {
        // 用户的自定义 YAML 写坏时不应该让整个转码命令不可用
        log.logWarn(LOG_TAG, `YAML presets load failed: ${error?.message || error}`)
    }
}

// 必须在 builder 求值前完成：`--preset` 的 `choices: presets.getAllNames()` 在 yargs
// parse 时同步求值，若此时 YAML 预设未加载，YAML 新增的预设名会被 choices 校验直接
// 拒绝（P0-2）。ESM 顶层 await + index.js 的 `await import()` 保证命令注册前预设已就绪。
await loadYamlPresets()

export { aliases, builder, command, describe, handler }
// directories 表示额外输入文件，用于支持多个目录
const command = "ffmpeg <input>"
const aliases = ["transcode", "aconv", "vconv", "avconv"]
const describe = t("ffmpeg.description")

const builder = function addOptions(ya) {
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
            // 显式指定视频编码器（穿透硬件分层矩阵，如 h264_nvenc / libx264 / copy）
            .option("video-codec", {
                alias: "vc",
                type: "string",
                describe: t("ffmpeg.video.codec"),
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
            // 严格模式：禁用所有自动降级（硬件层回退、编码器降级、失败重试等）
            .option("strict", {
                type: "boolean",
                default: false,
                describe: t("ffmpeg.strict"),
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
            // 自动确认所有交互提示，跳过 y/N 询问，便于自动化测试
            .option("auto-confirm", {
                alias: "A",
                type: "boolean",
                default: false,
                description: t("option.common.autoConfirm"),
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
    const plan = await planFFmpegTasks(argv)
    if (!plan) return
    await runFFmpegTasks(plan)
}

/**
 * 计划阶段：校验参数、扫描文件、收集任务并确认。返回计划对象供 runFFmpegTasks 执行；
 * 取消确认、无文件或只展示信息时返回 null（调用方直接结束）。
 * @param {Object} argv - yargs 解析后的命令行参数
 * @returns {Promise<{tasks: Object[], testMode: boolean, preset: Object, jobs: number}|null>}
 */
async function planFFmpegTasks(argv) {
    log.logDebug(LOG_TAG, "ARGV:", argv)
    // 初始化全局自动确认开关（--auto-confirm / -A / MEDIAC_AUTO_CONFIRM）
    initAutoConfirm(argv)
    await loadYamlPresets()
    // 显示预设列表
    if (argv.showPresets) {
        for (const [, value] of presets.getAllPresets()) {
            const data = core.pick(value, "name", "type", "format", "videoBitrate", "dimension")
            log.show(JSON.stringify(data))
        }
        return null
    }
    // 参数验证
    if (!argv.preset || !presets.getPreset(argv.preset)) {
        log.error(LOG_TAG, t("ffmpeg.error.preset"))
        return null
    }
    if (argv.jobs !== undefined && argv.jobs <= 0) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, t("ffmpeg.error.jobs"))
    }
    if (argv.speed !== undefined && (argv.speed < 0 || argv.speed > 4.0)) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, t("ffmpeg.error.speed"))
    }
    if (argv.dimension !== undefined && argv.dimension < 0) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, t("ffmpeg.error.dimension"))
    }
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw createError(
            ErrorTypes.INVALID_ARGUMENT,
            t("ffmpeg.error.invalidInput", { path: root }),
        )
    }
    const testMode = !argv.doit
    let startMs = Date.now()
    log.logInfo(LOG_TAG, t("ffmpeg.input", { path: root }))
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
    const ffargs = argparser.parseArgs(argv.ffargs)
    log.logDebug(LOG_TAG, "FFARGS:", ffargs)
    // 合并 ffargs 到 argv (ffargs 优先级低于命令行单独参数)
    const mergedArgv = presets.applyFfargs(argv, ffargs)
    log.logDebug(LOG_TAG, "MERGED ARGV:", mergedArgv)
    // 解析Preset，根据argv参数修改preset，返回对象
    const preset = presets.createFromArgv(mergedArgv)
    // dry-run 也全量落盘，日志行统一带 [TestMode] 前缀以示区分
    const tmTag = testMode ? "[TestMode] " : ""
    log.fileLog(`${tmTag}Root: ${root}`, "FFConv")
    log.fileLog(`${tmTag}Argv: ${JSON.stringify(argv)}`, "FFConv")
    log.fileLog(`${tmTag}Preset: ${JSON.stringify(preset)}`, "FFConv")
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
                    log.logInfo(
                        LOG_TAG,
                        t("ffmpeg.add.files", { count: dirFiles.length, path: dirPath }),
                    )
                    fileEntries = fileEntries.concat(dirFiles)
                }
            }
        }
    }
    fileEntries = core.uniqueByFields(fileEntries, "path")
    log.logInfo(
        LOG_TAG,
        `Total ${fileEntries.length} files found [${preset.name}] (${helper.humanTime(startMs)})`,
    )
    if (preset.type === "video" || presets.isAudioExtract(preset)) {
        fileEntries = fileEntries.filter((e) => helper.isVideoFile(e.name))
    } else if (preset.type === "audio") {
        fileEntries = fileEntries.filter((e) => helper.isAudioFile(e.name))
    }
    log.logInfo(
        LOG_TAG,
        `Total ${fileEntries.length} files left [${preset.name}] (${helper.humanTime(startMs)})`,
    )
    fileEntries = await applyFileNameRules(fileEntries, argv)
    log.logWarn(LOG_TAG, t("ffmpeg.total.files", { count: fileEntries.length }))
    if (fileEntries.length === 0) {
        log.logWarn(LOG_TAG, t("ffmpeg.no.files.left"))
        return null
    }

    fileEntries = fileEntries.slice(argv.start, argv.start + argv.count)
    log.logInfo(
        LOG_TAG,
        `Total ${fileEntries.length} files left in (${argv.start}-${argv.start + argv.count})`,
    )

    if (argv.info) {
        for (const entry of fileEntries) {
            log.logSuccess(LOG_TAG, `${entry.path}`)
            const info = await getMediaInfo(entry.path)
            log.logInfo(LOG_TAG, info)
        }
        return null
    }
    if (fileEntries.length > 1000) {
        const continueAnswer = await confirmDangerousAction(
            t("ffmpeg.confirm.continue", { count: fileEntries.length }),
        )
        if (await abortIfCancelled(continueAnswer, LOG_TAG)) {
            return null
        }
    }
    addEntryProps(fileEntries)
    fileEntries = fileEntries.map((entry) => {
        return {
            ...entry,
            argv: structuredClone(argv),
            preset,
            errorFile: argv.errorFile,
            testMode: testMode,
        }
    })

    log.logInfo(LOG_TAG, "ARGV:", argv)
    log.logInfo(LOG_TAG, "PRESET:", preset)
    const prepareAnswer = await confirmDangerousAction(
        t("ffmpeg.confirm.check", { preset: preset.name }),
    )
    if (await abortIfCancelled(prepareAnswer, LOG_TAG)) {
        return null
    }
    log.logSuccess(LOG_TAG, t("ffmpeg.preparing.tasks"))
    let tasks = await pMap(fileEntries, prepareFFmpegCmd, {
        concurrency: argv.jobs || (core.isUNCPath(root) ? 4 : config.JOBS.externalTool()),
    })

    if (argv.deleteSourceFiles) {
        // 目标产物必须「存在且非空」才可删源：0 字节说明上次运行中断留下了坏文件，
        // 此时删源等于用坏产物换掉好源文件，不可逆
        const dstExitsTasks = tasks.filter(
            (t) => t && t.dstExists && !t.fileDst && t.dstExistsSize > 0,
        )
        const badDstTasks = tasks.filter(
            (t) => t && t.dstExists && !t.fileDst && !(t.dstExistsSize > 0),
        )
        if (badDstTasks.length > 0) {
            log.logWarn(
                LOG_TAG,
                `Skip[BadDst]: ${badDstTasks.length} source file(s) kept, existing output is empty/corrupt`,
            )
            for (const bt of badDstTasks) {
                log.logWarn(LOG_TAG, `  BadDst: ${helper.pathShort(bt.dstExistsPath || bt.path)}`)
            }
        }
        if (dstExitsTasks.length > 0) {
            // test 模式的契约是"只打印计划、不动文件"。
            // 此前这一支缺少 testMode 守卫，dry-run 也会把源文件真实移进回收站。
            if (testMode) {
                log.logWarn(
                    LOG_TAG,
                    `${t("ffmpeg.confirm.delete.source", { count: dstExitsTasks.length })} [TestMode]`,
                )
            } else {
                const answer = await confirmDangerousAction(
                    t("ffmpeg.confirm.delete.source", { count: dstExitsTasks.length }),
                )
                if (answer) {
                    addEntryProps(dstExitsTasks)
                    const delResults = await pMap(
                        dstExitsTasks,
                        async (entry) => {
                            // safeRemove 失败返回 null：源文件仍在原处，不能报 SafeDel
                            const dest = await helper.safeRemove(entry.path)
                            if (!dest) {
                                log.logError(
                                    LOG_TAG,
                                    `SafeDelFailed ${entry.index}/${entry.total} ${entry.path}`,
                                )
                                return false
                            }
                            log.logWarn(
                                LOG_TAG,
                                `SafeDel ${entry.index}/${entry.total} ${entry.path}`,
                            )
                            return true
                        },
                        { concurrency: config.JOBS.ioBound() },
                    )
                    const failedCount = delResults.filter((ok) => !ok).length
                    if (failedCount > 0) {
                        log.logWarn(
                            LOG_TAG,
                            `SafeDel: ${failedCount} source file(s) still in place`,
                        )
                    }
                }
            }
        }
    }

    tasks = tasks.filter((t) => t && t.fileDst)
    if (tasks.length === 0) {
        log.logWarn(LOG_TAG, t("ffmpeg.all.skipped"))
        return null
    }
    const lastTask = tasks.slice(-1)[0]
    // ffmpeg 二进制定位：环境变量（FFMPEG_PATH/FFMPEG_BINARY）优先，未设置时按 PATH 查找。
    // 提前到预览之前探测一次构建能力（进程内缓存，真实执行直接复用），
    // 一方面让预览命令结构与真实执行一致（如 libfdk_aac 缺失时的 aac 降级在日志即体现），
    // 另一方面随探测顺带打印软硬件环境信息（版本/构建/编码器/硬件加速栈）。
    const ffmpegBin = await resolveFFmpegBinary()
    if (!ffmpegBin) {
        throw createError(ErrorTypes.FFMPEG_ERROR, t("ffmpeg.not.found"))
    }
    setFFmpegPath(ffmpegBin)
    let hwCaps = null
    try {
        hwCaps = await detectHardwareCapabilities({ ffmpegPath: ffmpegBin })
    } catch (err) {
        log.logWarn(LOG_TAG, `hw capability detection failed: ${err.message}`)
    }
    // ⚠️ 此处 hwPlan 尚未生成（分层决策在 runFFmpegCmd 内按文件进行），
    // 传 null 会让 buildScaleFiltersFromPlan 走兜底分支返回 preset.filters，
    // 而 preset.filters 是 "{scaleFilter}" 占位符 → 日志里会打印未替换的字面量。
    // 修复：预览时用 buildLayerArgs 生成一份「示意参数」（cpu 层 + 该 preset 的
    // codec 族），让日志反映真实命令结构，而不是泄漏占位符。
    const previewPlan = {
        tier: TIERS.find((t) => t.name === "cpu"),
        size: null,
        caps: hwCaps, // 携带构建能力：预览命令与真实执行走同一降级/参数决策
    }
    const lastFFPlan = createFFmpegArgs(lastTask, previewPlan)
    // fileLog 签名是 (logText, logTag, logFileName)：此前把参数数组当成了 tag、
    // 把 LOG_TAG 当成了文件名，日志被写进独立的 FFConv_log_*.txt 且正文与标签颠倒。
    log.fileLog(`${tmTag}ffmpegArgs: ${flattenFFArgs(lastFFPlan.args)}`, LOG_TAG)
    log.info("-----------------------------------------------------------")
    log.info(LOG_TAG, chalk.cyan("PRESET:"), lastFFPlan.debugPreset)
    log.info(LOG_TAG, chalk.cyan("CMD:"), "ffmpeg", flattenFFArgs(lastFFPlan.args))
    // 注意运算符优先级：`acc + t.info?.duration || 0` 会因 + 高于 || 而
    // 在任一条 duration 缺失时把整个累计值清零，必须显式括号。
    // 取数口径与运行时进度条一致：dstArgs.srcDuration 是 calculateDstArgs 算出的
    // 实际源时长（container → video stream → audio stream 逐级兜底），
    // 只读 entry.info?.duration 会在容器缺 format 级时长时少报总时长。
    const totalDuration = tasks.reduce(
        (acc, t) => acc + (t.dstArgs?.srcDuration || t.info?.duration || 0),
        0,
    )
    log.info("-----------------------------------------------------------")
    testMode && log.logWarn(LOG_TAG, `++++++++++ ${t("ffmpeg.test.mode")} ++++++++++`)
    log.logWarn(LOG_TAG, t("ffmpeg.check.details"))
    const answer = await confirmDangerousAction(
        t("ffmpeg.confirm.process", {
            count: tasks.length,
            preset: preset.name,
            duration: helper.humanSeconds(totalDuration),
        }),
    )
    if (await abortIfCancelled(answer, LOG_TAG)) {
        return null
    }
    return { tasks, testMode, preset, jobs: argv.jobs }
}

/**
 * 执行阶段：逐文件转码、失败重试与汇总输出。
 * @param {{tasks: Object[], testMode: boolean, preset: Object, jobs: number}} plan - planFFmpegTasks 的产出
 */
async function runFFmpegTasks({ tasks, testMode, preset, jobs }) {
    let startMs = Date.now()
    const tmTag = testMode ? "[TestMode] " : ""
    addEntryProps(tasks)
    await log.flushFileLog()
    const jobCount = jobs || (preset.type === "video" ? 1 : 4)
    // 并发 > 1 时多个任务同时渲染进度条会与逐文件日志混写：
    // 改用每文件一行（Processing/Done/Failed 日志已有），串行才保留进度条。
    const showBar = jobCount <= 1
    if (testMode && tasks.length > 20) {
        const totalBefore = tasks.length
        const step = Math.floor(tasks.length / 10)
        tasks = core.takeEveryNth(tasks, step)
        // dry-run 大批量任务只抽样预览约 1/10，显著提示用户避免误解为全部处理
        log.logWarn(
            LOG_TAG,
            t("ffmpeg.test.sample", { total: totalBefore, count: tasks.length, step }),
        )
    }
    const results = await pMap(tasks, (entry) => runFFmpegCmd(entry, { showBar }), {
        concurrency: jobCount,
    })
    let failedTasks = results.filter((r) => r && r.ffmpegFailed && !r.retryOnFailed)
    let rOKCount = 0
    // 严格模式：跳过 CPU 降级重试（失败即失败，不允许自动降级）
    const strict = tasks[0]?.argv?.strict === true
    // testMode 下任务统一按 failed 收尾（见 runFFmpegCmd），但没有真正转码失败，
    // 重试/严格跳过提示只对真实执行有意义，dry-run 一律跳过
    if (failedTasks.length > 0 && !testMode && strict) {
        log.logWarn(LOG_TAG, t("ffmpeg.strict.retry"))
        log.fileLog(t("ffmpeg.strict.retry"), "FFConv")
    } else if (failedTasks.length > 0 && !testMode) {
        const answer = await confirmDangerousAction(
            t("ffmpeg.confirm.retry", { count: failedTasks.length }),
        )
        if (answer) {
            for (const ft of failedTasks) {
                log.logWarn(LOG_TAG, `Retrying task: ${ft.path}`)
                log.fileLog(
                    `Retry <${ft.path}> [${ft.preset.name}] ${ft.ffmpegError || ""}`,
                    "FFConv",
                )
                let newFT = core.omit(ft, "ffmpegArgs", "info")
                newFT.argv.decodeMode = "cpu"
                newFT.retryOnFailed = true
                const task = await prepareFFmpegCmd(newFT)
                // 重试是顺序逐个执行，可以正常显示进度条
                const rt = await runFFmpegCmd(task, { showBar: true })
                if (rt && rt.ok) {
                    rOKCount++
                }
            }
        }
    }

    testMode && log.logWarn(LOG_TAG, t("common.test.mode.note", { count: tasks.length }))
    const okResults = results.filter((r) => r && r.ok)
    // 严格模式跳过的文件：不进失败名单（未标记 ffmpegFailed）、不重试，仅汇总提示
    const skippedResults = results.filter((r) => r && r.skipped === true)
    // 结束汇总落盘：哪些文件失败、失败原因是什么，此前只打印到控制台。
    // dry-run 也全量落盘，带 [TestMode] 前缀区分（此时全部任务都按 failed 收尾）
    const failedResults = results.filter((r) => r && r.ffmpegFailed && !r.ok)
    const totalOK = okResults.length + rOKCount
    log.fileLog(
        `${tmTag}Summary: total=${tasks.length} ok=${totalOK} error=${failedResults.length}` +
            (skippedResults.length > 0 ? ` skipped=${skippedResults.length}` : ""),
        "FFConv",
    )
    for (const fr of failedResults) {
        log.fileLog(`${tmTag}Fail <${fr.path}> ${fr.ffmpegError || ""}`, "FFConv")
    }
    for (const sk of skippedResults) {
        log.fileLog(`${tmTag}Skip[Strict] <${sk.path}> ${sk.skipReason || ""}`, "FFConv")
    }
    if (skippedResults.length > 0) {
        log.showYellow(LOG_TAG, t("ffmpeg.strict.skip.count", { count: skippedResults.length }))
    }
    !testMode &&
        log.logSuccess(
            LOG_TAG,
            t("ffmpeg.total.processed", {
                count: okResults.length + rOKCount,
                time: helper.humanTime(startMs),
            }),
        )
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
                    t("ffmpeg.error.unknownOutputMode", { mode: argv.outputMode }),
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
            // 如果无法获取任何比特率信息，认为不是合法的音频文件，忽略
            // （注意 audio 流可能缺失，需使用 ?. 避免 TypeError，原写法会抛异常）
            if (!(entry.format?.bitrate || entry.info?.audio?.bitrate || entry.info?.bitrate)) {
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
            // 记录已存在产物的体积供 --delete-source-files 判定。
            // 仅凭 pathExists 就删源是危险的：上次 Ctrl+C 中断残留的 0 字节/半截文件
            // 同样满足存在性判断，会导致「源文件已删、产物却是坏的」的不可逆损失。
            const existSt = await fs.stat(fileDst).catch(() => null)
            const existSize = existSt?.size || 0
            // --override 此前在 builder 中声明却从未被读取：目标存在时一律跳过，
            // 用户加 --override 期望覆盖却拿到 Skip[Dst1]，属"参数撒谎"。
            if (!argv.override) {
                log.showYellow(
                    logTag,
                    `${ipx} Skip[Dst1]: ${entry.path} (${helper.humanSize(entry.size)})`,
                )
                return {
                    ...entry,
                    dstExists: true,
                    dstExistsPath: fileDst,
                    dstExistsSize: existSize,
                }
            }
            log.showGray(logTag, `${ipx} Override: <${helper.pathShort(fileDst)}>`)
        }
        // 文件名变了，带有前缀或后缀
        // 才需要判断同目录的文件是否存在
        if (prefix || suffix) {
            if (await fs.pathExists(fileDstSameDir)) {
                if (!argv.override) {
                    log.showYellow(
                        logTag,
                        `${ipx} Skip[Dst2]: ${entry.path} (${helper.humanSize(entry.size)})`,
                    )
                    return {
                        ...entry,
                        dstExists: true,
                    }
                }
                log.showGray(logTag, `${ipx} Override: <${helper.pathShort(fileDstSameDir)}>`)
            }
        }

        // 提前定义 ivideo 和 iaudio，避免在后续引用时 undefined
        const ivideo = newEntry.info?.video
        const iaudio = newEntry.info?.audio
        const duration = newEntry.info?.duration || ivideo?.duration || iaudio?.duration || 0
        // 跳过过短的文件，比如短于1秒的
        if (duration < 1) {
            log.showYellow(
                logTag,
                `${ipx} Skip[Short]: ${entry.path} (${helper.humanSize(entry.size)}) Duration=${duration}s)`,
            )
            return false
        }

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
                        if (isH264 && ivideo?.bitDepth === 10) {
                            // 严格模式：H264 10bit 无任何硬解支持（Nvidia/Intel 均不支持），
                            // 不自动软解降级，warn 并跳过该文件，其余文件继续
                            if (argv.strict) {
                                log.showYellow(
                                    logTag,
                                    `${ipx} Skip[Strict10bit] <${entry.path}> ` +
                                        `(${ivideo?.format} ${ivideo?.bitDepth}bit has no hw decode)`,
                                )
                                log.fileLog(
                                    `${ipx} Skip[Strict10bit] <${entry.path}> ` +
                                        `[${preset.name}] ${ivideo?.format} ${ivideo?.bitDepth}bit has no hw decode`,
                                    "Prepare",
                                )
                                return false
                            }
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

        // 严格模式：音频编码器预检。预设里指定了本机构建不支持的编码器
        // （如缺 libfdk_aac 的 ffmpeg 用到 -c:a libfdk_aac）时，不降级、不报错，
        // warn 并跳过该文件，避免在 confirm/run 阶段才发现。
        if (argv.strict && preset.audioArgs?.length > 0) {
            const am = String(preset.audioArgs).match(/-c:a(?::\d+)?\s+(\S+)/)
            if (am && am[1] !== "copy") {
                const codec = am[1]
                try {
                    // 进程内缓存 + in-flight 去重：并发 prepare 只实际探测一次
                    const caps = await detectHardwareCapabilities()
                    const encoders = caps?.encoders
                    if (encoders && encoders.size > 0 && !encoders.has(codec)) {
                        const why = `audio encoder "${codec}" not available in this ffmpeg build`
                        log.showYellow(logTag, `${ipx} Skip[StrictCodec] <${entry.path}> (${why})`)
                        log.fileLog(
                            `${ipx} Skip[StrictCodec] <${entry.path}> [${preset.name}] ${why}`,
                            "Prepare",
                        )
                        return false
                    }
                } catch (err) {
                    // 探测失败不拦截：留给 run 阶段按真实结果处理
                    log.logWarn(logTag, `codec precheck skipped for ${entry.path}: ${err.message}`)
                }
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
        // 从字幕列表中优先选择中文字幕，不行就选第一个
        const selectedSubtitle = selectPreferredSubtitle(subtitles)
        const codecInfo = isAudio
            ? `${iaudio?.format}(${iaudio?.sampleRate},${iaudio?.bitrate},${iaudio.duration})`
            : `${ivideo?.format}(${ivideo?.profile}@${ivideo?.level},${ivideo?.bitDepth})`
        log.show(
            logTag,
            chalk.cyan(`${ipx} SRC`),
            chalk.yellow(newEntry.useCPUDecode ? `SW` : `HW`),
            `"${helper.pathShort(entry.path, 80)}"`,
            selectedSubtitle ? `(SUB:${path.basename(selectedSubtitle)})` : "",
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
            selectedSubtitle,
        }
        return newEntry
    } catch (error) {
        // 严格模式错误：探测到软硬件不支持（如 H264 10bit 无硬解）时，
        // warn 并跳过该文件，其余文件继续；不再整体报错退出。
        if (error?.name === "StrictModeError" || error?.code?.startsWith?.("STRICT_")) {
            log.showYellow(
                logTag,
                `${ipx} Skip[Strict] <${entry.path}> (${error?.message || error})`,
            )
            log.fileLog(
                `${ipx} Skip[Strict] <${entry.path}> [${preset?.name}] ${error?.message || error}`,
                "Prepare",
            )
            return false
        }
        // 单个文件解析失败不应中断整批任务：目录里混入一个坏文件时，
        // 旧实现会 rethrow 导致 pMap 整体失败，几十个正常文件全部不处理。
        // 这里改为记录后跳过（与日志文案 "Skip[Error]" 的意图一致）。
        log.error(logTag, `${ipx} Skip[Error]: ${entry.path}`, error?.message || error)
        log.fileLog(`${ipx} Skip[Error]: <${entry.path}> ${error?.message || error}`, "Prepare")
        return false
    }
}
