/**
 * FFmpeg 单文件执行模块
 *
 * 单文件转码执行、进度解析、失败恢复、错误日志、硬件分层决策与临时文件清理。
 * 不包含任务编排与参数计算（分别在 cmd_ffmpeg.js / ffmpeg_plan.js / ffmpeg_build.js）。
 */
import chalk from "chalk"
import * as cliProgress from "cli-progress"
import dayjs from "dayjs"
import { execa } from "execa"
import fs from "fs-extra"
import path from "path"

import * as helper from "./helper.js"
import * as log from "./debug.js"
import * as mf from "./file.js"
import { t } from "./i18n.js"
import { createFFmpegArgs, flattenFFArgs, tierName } from "./ffmpeg_build.js"
import { getEntryShowInfo } from "./ffmpeg_plan.js"
import { detectHardwareCapabilities } from "./hwdetect.js"
import { DecodeMode, TIERS, codecFamilyOfPreset, selectTier } from "./hwaccel.js"

export const LOG_TAG = "FFConv"
// ffmpeg 可执行文件路径（模块级缓存，供硬件探测复用）
let ffmpegPath = null
export function setFFmpegPath(p) {
    ffmpegPath = p
}

/**
 * ---------------------------------------------------------------------------
 * 临时产物注册表 + 中断清理
 * ---------------------------------------------------------------------------
 * ffmpeg 的中间产物形如 `xxx_tmp@hash@tmp_.mp4`。此前只在 try/finally 里清理：
 * Ctrl+C（SIGINT）或外部终止（SIGTERM）时 finally 不会执行，半截临时文件会永久
 * 留在输出目录里。这里登记在途临时文件，并在信号与 exit 时统一清理
 * （execa 已用 cleanup:true 负责杀死子进程，这里只负责文件）。
 */
const activeTempFiles = new Set()
let tempCleanupHooked = false

/**
 * 层标签（日志用）：区分「硬解」「软解+硬编」「全软」
 *
 * swdec 层（T7 新增）解码走 CPU、编码走硬件，用 [SW+HW] 单列，
 * 以免日志把「有硬件编码」误报成 [SW]（也避免误报成全程硬件 [HW]）。
 */
function tierBadge(hwPlan) {
    const n = tierName(hwPlan)
    if (n === "swdec") return "[SW+HW]"
    return n === "cpu" ? "[SW]" : "[HW]"
}

function cleanupTempFiles(reason) {
    if (activeTempFiles.size === 0) {
        return
    }
    let removed = 0
    for (const file of activeTempFiles) {
        try {
            fs.removeSync(file)
            removed++
        } catch {
            // 退出阶段不因单个文件失败而中断其余清理
        }
    }
    log.logWarn(LOG_TAG, `Cleaned ${removed} temp file(s) [${reason}]`)
    activeTempFiles.clear()
}

function installTempCleanupHooks() {
    if (tempCleanupHooked) {
        return
    }
    tempCleanupHooked = true
    for (const sig of ["SIGINT", "SIGTERM"]) {
        process.on(sig, () => {
            cleanupTempFiles(sig)
            process.exit(130)
        })
    }
    process.on("exit", () => cleanupTempFiles("exit"))
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
async function runFFmpegCmd(entry, { showBar = true } = {}) {
    const ipx = `${entry.index + 1}/${entry.total}`

    // ================================================================
    // 硬件加速分层决策（S-4 方案）
    //
    // 双层决策：
    //   第一层 硬件检测 —— detectHardwareCapabilities() 回答「这台机器有哪些层」
    //                      （进程内缓存，只跑一次）
    //   第二层 文件探测 —— selectTier() 逐层干跑，回答「哪个层能吃下这个文件」
    //                      （按 层|编码|位深|像素格式|尺寸 缓存）
    //
    // 决策顺序由 decodeMode 决定：
    //   auto（默认）: 厂商专属层 → d3d → cpu，逐层降级
    //   gpu（手动）  : 只用 --hwaccel 指定的层，失败即硬失败（不降级）
    //   cpu         : 直接 cpu 层，不探测
    //
    // 历史缺陷修复：
    //   1) 旧 canUseCUDADecoder 探测只覆盖解码，真实命令还含滤镜与编码器
    //      → ffv1 等无硬解素材被漏判（探测 rc=0，真实命令 rc≠0）
    //   2) 旧判定只匹配两个错误串，其它错误串一律算「可用」
    //   3) 旧缓存按 inputPath，1000 个文件 = 1000 次探测
    // ================================================================
    // ⚠️ logTag 必须在 try 之外定义：catch 块要用它记录错误日志
    let logTag = chalk.green("FFCMD") + chalk.cyanBright("[SW]")
    if (entry.retryOnFailed) {
        logTag += chalk.red("(R)")
    }
    // dry-run 日志标识：testMode 下所有落盘行统一带 [TestMode] 前缀，与非 testMode 显著区分
    const tmTag = entry.testMode ? "[TestMode] " : ""

    try {
        // 分层决策必须在 try 内：否则单文件异常会冒泡到 pMap，
        // 导致整体中断且日志不落盘（曾发生，见下方 catch 说明）
        const hwPlan = await resolveHwPlan(entry)
        entry.hwPlan = hwPlan
        entry.useCUDA = hwPlan.tier.name === "cuda"
        entry.ffmpegArgs = createFFmpegArgs(entry, hwPlan).args
        // ⚠️ 分层决策与真实命令必须落盘：此前只在控制台输出，日志里无法判断
        // 「某个文件走了哪一层、实际执行了什么命令」，排查困难（曾发生）。
        log.fileLog(
            `${tmTag}${ipx} Plan <${entry.path}> [${entry.preset.name}] ` +
                `tier=${hwPlan.tier.name} tried=[${(hwPlan.tried || []).join(",")}] ${hwPlan.reason || ""}`,
            "FFCMD",
        )
        log.fileLog(
            `${tmTag}${ipx} CMD <${entry.path}> ffmpeg ${flattenFFArgs(entry.ffmpegArgs)}`,
            "FFCMD",
        )
        logTag = chalk.green("FFCMD") + chalk.cyanBright(tierBadge(hwPlan))
        if (entry.retryOnFailed) {
            logTag += chalk.red("(R)")
        }
    } catch (error) {
        // 分层决策失败也要走正常失败流程，不能让整体中断
        const errMsg = extractFFmpegError(error, 200)
        log.showRed(logTag, `Plan(${ipx}) <${entry.path}>`, errMsg)
        log.fileLog(
            `${tmTag}Plan(${ipx}) <${entry.path}> [${entry.preset.name}] ${errMsg}`,
            "FFCMD",
        )
        // 严格模式：探测到软硬件不支持（硬件层不可用/编码器缺失等）时，
        // warn 并跳过该文件：不标记 ffmpegFailed（不进 confirm 重试名单）、
        // 不真正执行 ffmpeg，其余文件继续。
        if (entry.argv?.strict === true || error?.name === "StrictModeError") {
            log.showYellow(logTag, `Plan(${ipx}) Skip[Strict] <${entry.path}> ${errMsg}`)
            log.fileLog(
                `${tmTag}Plan(${ipx}) Skip[Strict] <${entry.path}> [${entry.preset.name}] ${errMsg}`,
                "FFCMD",
            )
            entry.skipped = true
            entry.skipReason = errMsg
            return entry
        }
        entry.ffmpegFailed = true
        entry.ffmpegError = `plan: ${errMsg}`
        await writeErrorFile(entry, error).catch(() => {})
        return entry
    }

    log.logTask(
        LOG_TAG,
        entry.index + 1,
        entry.total,
        chalk.cyan(`Processing`),
        `${helper.pathShort(entry.path, 72)}`,
        helper.humanSize(entry.size),
        chalk.yellow(helper.humanSeconds(entry.dstArgs.srcDuration)),
        entry.preset.name,
        helper.humanTime(entry.startMs),
    )

    log.logDebug(LOG_TAG, ipx, getEntryShowInfo(entry))
    log.logDebug(LOG_TAG, ipx, `ffmpeg`, flattenFFArgs(entry.ffmpegArgs))
    if (entry.testMode) {
        // dry-run 契约：前面参与真实执行相同路径（分层决策+参数构建+日志落盘），
        // 只在真正转码前停下。统一按 failed 收尾（不设置 ok），
        // 使 Summary 落盘能看到每一路；重试确认在 runFFmpegTasks 里按 !testMode 跳过。
        log.logInfo(
            LOG_TAG,
            `${ipx} Skipped ${entry.path} (${helper.humanSize(entry.size)}) [TestMode]`,
        )
        entry.ffmpegFailed = true
        entry.ffmpegError = t("ffmpeg.test.mode.skip")
        return entry
    }

    // 创建输出目录
    await fs.mkdirp(entry.fileDstDir)
    await fs.remove(entry.fileDstTemp)
    // 登记临时产物，确保 Ctrl+C / 外部终止时也会被清理
    installTempCleanupHooks()
    activeTempFiles.add(entry.fileDstTemp)
    const ffmpegStartMs = Date.now()

    const [inputArgs, middleArgs, outputArgs] = entry.ffmpegArgs
    const metaComment = getCommentArgs(entry)
    const ffmpegArgs = [...inputArgs, ...middleArgs, ...metaComment, ...outputArgs]

    // 创建进度条：并发任务不渲染进度条（会与逐文件日志混写），只走日志；串行/重试才显示
    const srcDuration = entry.dstArgs?.srcDuration || entry.info?.duration || 0
    let progressBar = null

    if (showBar && srcDuration > 0) {
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
            // 判定「产物异常小」需同时满足：源文件 >1MB 且产物 <=20KB。
            // 小源文件（测试片/短视频）产物天然很小（如 four-colors 12KB），
            // 单独用 20KB 阈值会把它们误判为失败。大源文件出 20KB 以内产物
            // 才说明 ffmpeg 退出 0 但实际没编出东西（空/截断输出）。
            const dstTooSmall = dstSize <= 20 * mf.FILE_SIZE_1K
            const srcBigEnough = entry.size > mf.FILE_SIZE_1M
            if (!dstTooSmall || !srcBigEnough) {
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
            }
            // 转换失败，删除临时文件
        }
        log.showYellow(
            logTag,
            `${ipx} Failed ${entry.path}`,
            entry.preset.name,
            helper.humanSize(entry.size),
        )
        log.fileLog(
            `${ipx} Failed <${entry.path}> [${entry.dstArgs?.dstAudioBitrate || entry.preset.name}]`,
            "FFCMD",
        )
    } catch (error) {
        const errMsg = extractFFmpegError(error, 160)
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
        activeTempFiles.delete(entry.fileDstTemp)
        await fs.remove(entry.fileDstTemp)
    }
}

/**
 * 从 ffmpeg 的 stderr 中提取「有意义的错误行」
 *
 * ⚠️ 直接取 stderr 前 N 字符是错的：`--debug` 时 -v 级别是 `repeat+level+info`，
 * stderr 开头是 "Input #0, matroska,webm, from ..." 这类正常 info 输出，
 * 真正的错误被挤到后面 → 用户看到的错误信息毫无价值（曾发生）。
 *
 * ffmpeg 在 `-v repeat+level+info` 下会给每行加级别前缀：
 *   [info]  ...                                   ← 正常输出
 *   [error] Impossible to convert between ...      ← 真正的错误（第一条最有信息量）
 *   [error] Link 'xxx' -> 'yyy':                   ← 后续是上下文/像素格式清单
 *   [error]     dst: cuda
 *   [info] Conversion failed!                      ← 尾部总结（无信息量）
 *
 * 策略：**从前往后**找第一条 `[error]` 行（错误块的头部才是根因）。
 * 取最后一条会抓到 "dst: cuda" 这类清单噪声。
 *
 * @param {Error|string} error
 * @param {number} maxLen
 * @returns {string}
 */
function extractFFmpegError(error, maxLen = 200) {
    const raw = (error && (error.stderr || error.message)) || ""
    if (!raw) return "[Unknown]"
    const lines = String(raw)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
    if (lines.length === 0) return "[Unknown]"

    const strip = (s) => s.replace(/^\[[a-z]+\]\s*/i, "")

    // 1) 从前往后找第一条 [error] 行（错误块头部 = 根因）
    for (let i = 0; i < lines.length; i++) {
        if (/\[error\]/i.test(lines[i])) {
            const body = strip(lines[i])
            // 跳过纯上下文的噪声行（"Link '...'", "Pixel formats:", "src:", "dst:"）
            if (/^(link\s|pixel formats|src:|dst:)/i.test(body)) continue
            return body.substring(0, maxLen)
        }
    }
    // 2) 无 [error] 标记时，找含错误特征词的行（排除无信息量的尾部总结）
    const errRe =
        /error|invalid|failed|cannot|could not|unable|unsupported|not supported|no such|denied|corrupt|missing|out of range|exceed|truncat/i
    const noise = /^conversion failed!?$/i
    for (let i = 0; i < lines.length; i++) {
        const body = strip(lines[i])
        if (noise.test(body)) continue
        if (errRe.test(body)) return body.substring(0, maxLen)
    }
    // 3) 兜底：最后一条（去掉级别前缀）
    return strip(lines[lines.length - 1]).substring(0, maxLen)
}

/**
 * 生成FFmpeg元数据注释参数
 *
 * comment 写入实际转码完整命令行，保证可从元数据精确追溯真实参数。
 * 基于 prepare 阶段已定稿的 entry.ffmpegArgs（三段数组）拼接，
 * createFFmpegArgs 为纯函数，固定输出同一命令，不会因调用时机不同导致不一致。
 * @param {Object} entry - 文件对象
 * @returns {string[]} FFmpeg元数据参数数组
 */
function getCommentArgs(entry) {
    const MAX_COMMENT_LEN = 1000
    const command = flattenFFArgs(entry.ffmpegArgs)
    if (!command) {
        return ["-metadata", "comment=mediac"]
    }
    // 引号清洗：避免 comment 值内的引号破坏 -metadata 参数形态
    const clean = command.replaceAll(/['"]/gi, " ")
    const commentText = `mediac ${clean}`.substring(0, MAX_COMMENT_LEN)
    return ["-metadata", `comment=${commentText}`]
}

/**
 * 在输出目录写入错误日志文件
 * @param {Object} entry - 文件对象
 * @param {Error} error - 错误对象
 * @returns {Promise<void>}
 */
async function writeErrorFile(entry, error) {
    if (entry.errorFile) {
        try {
            const useJson = entry.errorFile === "json"
            const fileExt = useJson ? ".json" : ".txt"
            const nowStr = dayjs().format("YYYYMMDDHHmmss")
            // 确保输出目录存在，避免写入错误日志失败
            await fs.ensureDir(entry.fileDstDir)
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
        } catch (e) {
            log.error("writeErrorFile", "Failed to write error file", e.message)
        }
    }
}

/**
 * 执行FFmpeg命令
 * @param {Array} args - FFmpeg命令参数
 * @param {Object} entry - 文件对象
 * @param {Object} progressBar - 进度条对象
 * @returns {Promise<void>}
 */
async function executeFFmpeg(args, entry, progressBar = null) {
    const logTag = chalk.green("FFCMD") + chalk.cyanBright(tierBadge(entry.hwPlan))
    const srcDuration = entry.dstArgs?.srcDuration || entry.info?.duration || 0

    // 1. 创建控制器
    const controller = new AbortController()
    const { signal } = controller

    // 2. 启动子进程
    //
    // 不使用 shell:true。原因（已用含中日韩/空格/&/全角符号的真实视频实测）：
    //   - shell:true 会把参数拼成命令行交给 cmd.exe，含空格或 & ! % 等元字符的
    //     文件名会被截断或触发变量展开，导致 "No such file or directory"；
    //   - 参数本身以数组形式传递时，ffmpeg 能正确解析含空格、逗号、引号的值
    //     （滤镜里的单引号由 ffmpeg 自己处理，与 shell 无关）。
    // 同时已移除所有手工嵌入的引号（路径、滤镜、元数据值），
    // 改为数组直传，避免引号被当作字面值写入元数据。
    //
    // 执行二进制必须与能力探测（detectHardwareCapabilities）用的是同一个：
    // 探测读 FFMPEG_PATH/FFMPEG_BINARY 环境变量优先，这里若退回裸 "ffmpeg"
    // 会命中 PATH 中另一个版本（例如 essentials 无 libfdk_aac），
    // 导致「探测说有 fdk → 不降级 → 执行时 Unknown encoder」的不一致。
    const subprocess = execa(ffmpegPath || "ffmpeg", args, {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        shell: false,
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
        // 进度完成，确保换行（并发模式无进度条时无需补空行）
        progressBar?.stop()
        progressBar && log.show()
    } catch (error) {
        progressBar?.stop()
        progressBar && log.show()
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
    if (!timeStr) return 0
    const parts = timeStr.split(":")
    if (parts.length === 3) {
        const [hours, minutes, seconds] = parts
        // 只取小数点前两位，忽略微秒
        const secondsNum = parseFloat(seconds)
        // out_time=N/A 或时间字段含非数字时 parseFloat 返回 NaN，
        // 不能让它传播到进度条 update(NaN)
        if (!Number.isFinite(secondsNum)) return 0
        const hoursNum = parseFloat(hours)
        const minutesNum = parseFloat(minutes)
        if (!Number.isFinite(hoursNum) || !Number.isFinite(minutesNum)) return 0
        return hoursNum * 3600 + minutesNum * 60 + secondsNum
    }
    return 0
}

/**
 * 硬件加速分层决策（S-4 方案核心）
 *
 * 双层：
 *   第一层 硬件检测 —— detectHardwareCapabilities()（进程内缓存，只跑一次）
 *                     回答「这台机器有哪些可用的层」
 *   第二层 文件探测 —— selectTier() 逐层干跑（按组合缓存）
 *                     回答「哪个层能吃下这个文件」
 *
 * @param {object} entry 文件条目（需 info.video / dstArgs）
 * @returns {Promise<object>} { tier, size, degraded, tried, reason, caps }
 */
async function resolveHwPlan(entry) {
    const argv = entry.argv || {}
    const ivideo = entry.info?.video
    const iaudio = entry.info?.audio

    // 音频文件不做视频分层，直接给 cpu 层占位
    if (helper.isAudioFile(entry.path)) {
        const cpuTier = TIERS.find((t) => t.name === "cpu")
        return { tier: cpuTier, size: null, degraded: false, tried: ["cpu"], reason: "audio file" }
    }

    // ---- 第一层：硬件检测（进程内缓存）----
    const caps = await detectHardwareCapabilities({ ffmpegPath: ffmpegPath })

    // 失败重试（retryOnFailed）会把 decodeMode 置为 cpu，这里必须真正生效
    const decodeMode = argv.decodeMode || DecodeMode.AUTO

    // ---- 第二层：文件探测 ----
    const srcW = ivideo?.width || 0
    const srcH = ivideo?.height || 0
    const pixFmt = ivideo?.pixelFormat || ""
    const codec = ivideo?.format || ""
    // 用户显式指定编码器（--video-codec / ffargs vc）：探测必须用同一编码器
    const forcedEncoder = entry.preset?.userArgs?.videoCodec

    // --video-copy / vc=copy：流复制不重新编码，无需硬件分层探测，直走 cpu 层占位
    if (forcedEncoder === "copy") {
        const cpuTier = TIERS.find((t) => t.name === "cpu")
        return {
            tier: cpuTier,
            size: null,
            degraded: false,
            tried: ["cpu"],
            reason: "video copy (no re-encode)",
            caps,
            decodeMode,
            forcedEncoder,
        }
    }

    // 输出 codec 族（决定探测时用什么编码器，必须与真实命令一致）
    // T4 优先级：显式 encoder 解析出的族 > preset.videoCodecFamily > videoArgs 推断
    const codecFamily = codecFamilyOfPreset(entry.preset)

    // 尺寸由 selectTier 内部按长边规则计算（禁止放大 + 偶数对齐）
    const dimension = entry.dstArgs?.dimension || entry.preset?.dimension || 0

    try {
        const plan = await selectTier({
            caps,
            ffmpegPath: ffmpegPath,
            inputPath: entry.path,
            srcW,
            srcH,
            pixFmt,
            // ⚠️ 必须传显式位深：mediainfo 的 pixelFormat 不含位深，
            // 缺了它 8bit/10bit 同键，10bit 源会误复用 8bit 的探测结果选错层
            bitDepth: ivideo?.bitDepth,
            codec,
            codecFamily,
            dimension: dimension || Math.max(srcW, srcH),
            speed: entry.dstArgs?.speed,
            framerate: entry.dstArgs?.framerate,
            hasAudio: !!iaudio,
            quality: entry.dstArgs?.videoQuality || entry.preset?.videoQuality || 24,
            // ⚠️ bitrate 必须进探测（T5）：探测命令与真实命令同构，
            //    真实转码带 -b:v/-maxrate 时探测也必须带，否则码控参数会改变编码行为。
            //    传 bps 纯数字（dstVideoBitrate，已按分辨率 scale），与真实命令走同一 buildEncoderArgs。
            bitrate: entry.dstArgs?.dstVideoBitrate,
            forcedEncoder,
            decodeMode,
            hwaccel: argv.hwaccel,
            strict: argv.strict === true,
        })
        return { ...plan, caps, decodeMode }
    } catch (err) {
        // gpu 模式硬失败：直接抛出，让上层报错（符合「手动模式必须硬失败」）
        if (decodeMode === DecodeMode.GPU) {
            throw err
        }
        // auto 模式下连 cpu 都失败属异常，也抛出
        throw err
    }
}
export { runFFmpegCmd }
