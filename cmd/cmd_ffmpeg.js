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
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { getMediaInfo } from "../lib/mediainfo.js"
import { addEntryProps } from "../lib/rename.js"
import { scanFFmpegInputs } from "../lib/ffmpeg_scan.js"
import { buildCliTask } from "../lib/ffmpeg_task.js"
import { TIERS } from "../lib/hwaccel.js"
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
            // 输入目录 / 文件（命令串 "ffmpeg <input>" 的位置参数）
            // 显式声明，供 .strictOptions() 识别——否则会被误判为未知参数
            .positional("input", {
                describe: "Input folder or media file (输入目录或媒体文件)",
                type: "string",
            })
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
            // 输出元数据（独立追加通道，值可含空格）：--metadata "title=X;comment=Y"
            .option("metadata", {
                describe: t("ffmpeg.metadata"),
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
            // 文件清单：从文本文件读取要处理的媒体文件路径（一行一个，支持 # 注释），
            // 命中时跳过目录遍历，直接以清单为输入集（便于对指定样本做参数矩阵测试）
            .option("filelist", {
                type: "string",
                describe: t("ffmpeg.filelist"),
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
            // 视频加速减速，默认不改动（0），范围 0.5–2.0（与 hwaccel validateSpeed 一致）
            .option("speed", {
                type: "number",
                default: 0,
                describe: t("ffmpeg.speed"),
            })
            // 视频选项，指定码率
            .option("video-bitrate", {
                alias: "vb",
                type: "string",
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
            // 动漫/动画调优模式（保线条与平涂色块，收紧默认质量，注入 x265/x264/svtav1/nvenc 专属参数）
            .option("anime", {
                type: "boolean",
                default: false,
                describe: "Anime/animation tuning mode (动漫调优模式，收紧质量并注入线条保护参数)",
            })
            // 音频选项，指定码率
            .option("audio-bitrate", {
                alias: "ab",
                type: "string",
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
            // 严格校验选项：未知/拼错的选项直接报错，而非静默收进 argv 后被忽略。
            // 典型场景：把 ffmpeg 的 --tune / -c:v 裸传给 mediac（应放进 --video-args），
            // 或把 --video-args 拼成 --vide-args。用 strictOptions（放过多余位置参数）。
            .strictOptions()
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
 * @param {string} argv.metadata - 输出元数据 "key=value;key2=value2"（追加，值可含空格）
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
 * @param {number} argv.videoBitrate - 视频码率
 * @param {boolean} argv.videoCopy - 是否直接复制视频流
 * @param {number} argv.videoQuality - 视频质量
 * @param {number} argv.audioBitrate - 音频码率
 * @param {boolean} argv.audioCopy - 是否直接复制音频流
 * @param {number} argv.audioQuality - 音频质量
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
    // speed 域收敛 0.5–2.0（D1，与 hwaccel validateSpeed 一致）；0 = 未变速（默认）
    if (argv.speed !== undefined && argv.speed !== 0 && (argv.speed < 0.5 || argv.speed > 2.0)) {
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
    let fileEntries = await scanFFmpegInputs({
        argv,
        root,
        walkOpts,
        presetType: preset.type,
        isAudioExtract: presets.isAudioExtract(preset),
    })
    log.logInfo(
        LOG_TAG,
        `Total ${fileEntries.length} files left [${preset.name}] (${helper.humanTime(startMs)})`,
    )
    log.logWarn(LOG_TAG, t("ffmpeg.total.files", { count: fileEntries.length }))
    if (fileEntries.length === 0) {
        log.logWarn(LOG_TAG, t("ffmpeg.no.files.left"))
        return null
    }
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
    let tasks = await pMap(fileEntries, buildCliTask, {
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
    const retryOKTasks = []
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
                const task = await buildCliTask(newFT)
                // 重试是顺序逐个执行，可以正常显示进度条
                const rt = await runFFmpegCmd(task, { showBar: true })
                if (rt && rt.ok) {
                    rOKCount++
                    retryOKTasks.push(rt)
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

    // 转换成功后删除源文件：对转码成功且目标文件非空的文件执行安全删除
    if (!testMode && tasks[0]?.argv?.deleteSourceFiles) {
        const allSuccess = [...okResults, ...retryOKTasks].filter((r) => r && r.fileDst)
        if (allSuccess.length > 0) {
            log.logInfo(
                LOG_TAG,
                `DeleteSource: removing ${allSuccess.length} converted source file(s)...`,
            )
            await pMap(
                allSuccess,
                async (entry) => {
                    const st = await fs.stat(entry.fileDst).catch(() => null)
                    if (st && st.size > 0) {
                        const dest = await helper.safeRemove(entry.path)
                        if (dest) {
                            log.logWarn(
                                LOG_TAG,
                                `SafeDel ${entry.index + 1}/${entry.total} ${entry.path}`,
                            )
                        } else {
                            log.logError(
                                LOG_TAG,
                                `SafeDelFailed ${entry.index + 1}/${entry.total} ${entry.path}`,
                            )
                        }
                    }
                },
                { concurrency: config.JOBS.ioBound() },
            )
        }
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
