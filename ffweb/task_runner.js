/**
 * WebUI 任务调度器与状态机
 *
 * 负责与 lib/ 底层模块协作：加载预设、探测硬件、生成转码计划、
 * 执行转码队列、解析进度、捕获日志、处理用户中断与临时清理。
 */
import fs from "fs-extra"
import path from "path"
import { resolveFFmpegBinary } from "../lib/ffmpeg_bin.js"
import { createFFmpegArgs, flattenFFArgs } from "../lib/ffmpeg_build.js"
import { calculateDstArgs, createDstBaseName, selectPreferredSubtitle } from "../lib/ffmpeg_plan.js"
import presets from "../lib/ffmpeg_presets.js"
import { runFFmpegCmd, setFFmpegPath } from "../lib/ffmpeg_run.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { TIERS } from "../lib/hwaccel.js"
import { detectHardwareCapabilities } from "../lib/hwdetect.js"
import { getMediaInfo } from "../lib/mediainfo.js"
import * as log from "../lib/debug.js"

class TaskRunner {
    constructor() {
        this.status = "IDLE" // IDLE | PLANNING | RUNNING | STOPPED | COMPLETED
        this.currentPlan = null
        this.currentTaskIndex = -1
        this.activeAbortController = null
        this.recentLogs = []
        this.maxLogs = 300
        this.hwCaps = null
        this.ffmpegBin = null
        this.listeners = new Set()
        this.currentProgress = null
        this.summary = null
    }

    /**
     * 广播事件给所有监听者（WebSocket）
     */
    emit(event, data) {
        for (const fn of this.listeners) {
            try {
                fn(event, data)
            } catch {
                // 忽略单个断开连接的异常
            }
        }
    }

    addListener(fn) {
        this.listeners.add(fn)
    }

    removeListener(fn) {
        this.listeners.delete(fn)
    }

    appendLog(level, tag, message) {
        const text = String(message).trim()
        const logItem = {
            id: Date.now() + Math.random(),
            time: new Date().toLocaleTimeString(),
            level,
            tag,
            message: text,
        }
        this.recentLogs.push(logItem)
        if (this.recentLogs.length > this.maxLogs) {
            this.recentLogs.shift()
        }
        this.emit("LOG", logItem)
        log.fileLog(`[${tag}] ${text}`, "WebUI")
    }

    /**
     * 获取当前状态快照（供前端新连接或刷新时无缝同步）
     */
    getSnapshot() {
        return {
            status: this.status,
            currentPlan: this.currentPlan
                ? {
                      id: this.currentPlan.id,
                      preset: this.currentPlan.presetName,
                      totalTasks: this.currentPlan.tasks.length,
                      tasks: this.currentPlan.tasks.map((t) => ({
                          index: t.index,
                          name: t.name,
                          size: t.size,
                          humanSize: helper.humanSize(t.size),
                          duration: t.duration,
                          humanDuration: helper.humanSeconds(t.duration),
                          fileDst: t.fileDst,
                          status: t.status || "pending",
                          error: t.error || null,
                      })),
                  }
                : null,
            currentTaskIndex: this.currentTaskIndex,
            currentProgress: this.currentProgress,
            recentLogs: this.recentLogs,
            summary: this.summary,
            hwCaps: this.hwCaps
                ? {
                      gpus: this.hwCaps.gpus || [],
                      encoders: Array.from(this.hwCaps.encoders || []),
                      hwaccels: Array.from(this.hwCaps.hwaccels || []),
                  }
                : null,
        }
    }

    /**
     * 初始化环境与预设
     */
    async init() {
        if (!this.ffmpegBin) {
            this.ffmpegBin = await resolveFFmpegBinary()
            if (this.ffmpegBin) {
                setFFmpegPath(this.ffmpegBin)
            }
        }
        try {
            await presets.initPresetsAsync()
        } catch (err) {
            this.appendLog("warn", "Init", `Failed to init presets: ${err.message}`)
        }
        try {
            if (this.ffmpegBin) {
                this.hwCaps = await detectHardwareCapabilities({ ffmpegPath: this.ffmpegBin })
            }
        } catch (err) {
            this.appendLog("warn", "Init", `Hardware detect failed: ${err.message}`)
        }
    }

    /**
     * 获取环境信息和预设列表
     */
    async getEnv() {
        await this.init()
        const allPresetNames = presets.getAllNames()
        const presetDetails = allPresetNames.map((name) => {
            const p = presets.getPreset(name)
            return {
                name,
                type: p.type || "video",
                desc: p.desc || p.description || "",
                format: p.format || ".mp4",
                videoCodecFamily: p.videoCodecFamily || "",
                audioCodec: p.audioCodec || "",
                videoQuality: p.videoQuality || 0,
                videoBitrate: p.videoBitrate || 0,
                maxBitrate: p.maxBitrate || 0,
                audioBitrate: p.audioBitrate || 0,
                dimension: p.dimension || 0,
                framerate: p.framerate || 0,
                speed: p.speed || 1,
            }
        })
        return {
            ffmpegBin: this.ffmpegBin,
            hwCaps: {
                gpus: this.hwCaps?.gpus || [],
                encoders: Array.from(this.hwCaps?.encoders || []),
                hwaccels: Array.from(this.hwCaps?.hwaccels || []),
            },
            presets: presetDetails,
        }
    }

    /**
     * 收集输入的媒体文件条目
     */
    async collectInputFiles(inputs) {
        const fileList = []
        for (const inputPath of inputs) {
            if (!inputPath || !(await fs.pathExists(inputPath))) continue
            const stat = await fs.stat(inputPath)
            if (stat.isFile()) {
                if (helper.isMediaFile(inputPath)) {
                    fileList.push({
                        path: inputPath,
                        name: path.basename(inputPath),
                        size: stat.size,
                    })
                }
            } else if (stat.isDirectory()) {
                const files = await mf.walk(inputPath, {
                    withFiles: true,
                    needStats: true,
                    entryFilter: (e) => e.isFile && helper.isMediaFile(e.name),
                })
                for (const f of files) {
                    fileList.push({
                        path: f.path,
                        name: f.name,
                        size: f.size,
                    })
                }
            }
        }
        // 去重
        const unique = []
        const seen = new Set()
        for (const item of fileList) {
            if (!seen.has(item.path)) {
                seen.add(item.path)
                unique.push(item)
            }
        }
        return unique
    }

    /**
     * 创建转码计划（Plan）
     */
    async createPlan({ inputs = [], output = "", preset = "hevc_2k", options = {} } = {}) {
        await this.init()
        this.status = "PLANNING"
        this.emit("STATUS_CHANGE", { status: this.status })

        try {
            const files = await this.collectInputFiles(inputs)
            if (files.length === 0) {
                this.status = "IDLE"
                this.emit("STATUS_CHANGE", { status: this.status })
                throw new Error("No media files found in specified inputs")
            }

            const allPresets = presets.getAllPresets()
            const presetObj =
                presets.getPreset(preset) ||
                presets.getPreset("hevc_2k") ||
                presets.getPreset("h264_2k") ||
                allPresets[0]
            const opt = { ...options }
            if (opt.fps > 0) {
                opt.framerate = opt.fps
            }
            if (opt.audioCodec === "copy") {
                opt.audioCopy = true
            }
            const mergedArgv = {
                output: output || "",
                preset: presetObj.name,
                ...opt,
            }
            const activePreset = presets.createFromArgv(mergedArgv)

            this.appendLog(
                "info",
                "Plan",
                `Analyzing ${files.length} file(s) for preset [${activePreset.name}]...`,
            )

            // 构建任务项
            const tasks = []
            for (let i = 0; i < files.length; i++) {
                const f = files[i]
                try {
                    const info = await getMediaInfo(f.path)
                    const isAudio = activePreset.type === "audio"
                    const ivideo = info?.video
                    const iaudio = info?.audio
                    const duration = info?.duration || ivideo?.duration || iaudio?.duration || 0

                    if (isAudio && !iaudio) continue
                    if (!isAudio && !ivideo) continue

                    const entry = {
                        index: i,
                        total: files.length,
                        path: f.path,
                        name: f.name,
                        size: f.size,
                        info,
                        preset: activePreset,
                        argv: mergedArgv,
                        duration,
                    }

                    const dstArgs = calculateDstArgs(entry)
                    entry.dstArgs = dstArgs

                    const srcDir = path.dirname(f.path)
                    const srcBase = path.parse(f.name).name
                    const dstDir = output ? path.resolve(output) : srcDir
                    const [fileDstBase] = createDstBaseName(entry)
                    const dstExt = activePreset.ext || path.extname(f.name) || ".mp4"
                    const fileDst = path.join(dstDir, `${fileDstBase}${dstExt}`)
                    const fileDstTemp = path.join(
                        dstDir,
                        `${fileDstBase}_tmp@${helper.textHash(f.path)}@tmp_${dstExt}`,
                    )

                    // 检索字幕
                    const subExts = [".ass", ".ssa", ".srt"]
                    const subtitles = []
                    for (const ext of subExts) {
                        const sub1 = path.join(srcDir, `${srcBase}${ext}`)
                        if (await fs.pathExists(sub1)) subtitles.push(sub1)
                    }
                    const selectedSubtitle = selectPreferredSubtitle(subtitles)

                    entry.fileDstDir = dstDir
                    entry.fileDst = fileDst
                    entry.fileDstTemp = fileDstTemp
                    entry.subtitles = subtitles
                    entry.selectedSubtitle = selectedSubtitle
                    entry.status = "pending"

                    tasks.push(entry)
                } catch (err) {
                    this.appendLog("warn", "Plan", `Skip ${f.name}: ${err.message}`)
                }
            }

            if (tasks.length === 0) {
                this.status = "IDLE"
                this.emit("STATUS_CHANGE", { status: this.status })
                throw new Error("None of the scanned files can be processed with current preset")
            }

            // 生成命令预览（以首个任务为例）
            const previewPlan = {
                tier: TIERS.find((t) => t.name === "cpu"),
                caps: this.hwCaps,
            }
            const sampleFFPlan = createFFmpegArgs(tasks[0], previewPlan)
            const previewCmd = `ffmpeg ${flattenFFArgs(sampleFFPlan.args)}`

            const totalDuration = tasks.reduce((acc, t) => acc + (t.duration || 0), 0)
            const totalSize = tasks.reduce((acc, t) => acc + (t.size || 0), 0)

            this.currentPlan = {
                id: `plan_${Date.now()}`,
                presetName: activePreset.name,
                preset: activePreset,
                argv: mergedArgv,
                tasks,
                totalDuration,
                totalSize,
                previewCmd,
            }

            this.status = "IDLE"
            this.emit("STATUS_CHANGE", { status: this.status })
            this.appendLog(
                "info",
                "Plan",
                `Plan ready: ${tasks.length} file(s), total ${helper.humanSeconds(totalDuration)}`,
            )
            this.appendLog("info", "Command", `Preview Command: ${previewCmd}`)

            return {
                ok: true,
                plan: {
                    id: this.currentPlan.id,
                    presetName: activePreset.name,
                    totalTasks: tasks.length,
                    totalDuration,
                    humanDuration: helper.humanSeconds(totalDuration),
                    totalSize,
                    humanSize: helper.humanSize(totalSize),
                    previewCmd,
                    tasks: tasks.map((t) => ({
                        index: t.index,
                        name: t.name,
                        path: t.path,
                        size: t.size,
                        humanSize: helper.humanSize(t.size),
                        duration: t.duration,
                        humanDuration: helper.humanSeconds(t.duration),
                        fileDst: t.fileDst,
                    })),
                },
            }
        } catch (error) {
            this.status = "IDLE"
            this.emit("STATUS_CHANGE", { status: this.status })
            throw error
        }
    }

    /**
     * 启动转码任务
     */
    async startExecution() {
        if (!this.currentPlan || this.currentPlan.tasks.length === 0) {
            throw new Error("No active plan to execute")
        }
        if (this.status === "RUNNING") {
            throw new Error("Another execution is already running")
        }

        this.status = "RUNNING"
        this.activeAbortController = new AbortController()
        const { signal } = this.activeAbortController
        this.emit("STATUS_CHANGE", { status: this.status })

        const plan = this.currentPlan
        const tasks = plan.tasks
        const startTime = Date.now()
        let successCount = 0
        let failedCount = 0

        this.appendLog("info", "Run", `Starting execution of ${tasks.length} task(s)...`)

        try {
            for (let i = 0; i < tasks.length; i++) {
                if (signal.aborted) {
                    break
                }
                this.currentTaskIndex = i
                const task = tasks[i]
                task.status = "running"
                this.emit("TASK_START", { index: i, taskName: task.name })
                this.appendLog("info", "Run", `[${i + 1}/${tasks.length}] Processing: ${task.name}`)

                try {
                    const res = await runFFmpegCmd(task, {
                        showBar: false,
                        signal,
                        onProgress: (p) => {
                            this.currentProgress = {
                                taskIndex: i,
                                totalTasks: tasks.length,
                                currentFile: task.name,
                                percent: p.percent,
                                speed: p.speed,
                                currentTime: p.currentTime,
                                srcDuration: p.srcDuration,
                            }
                            this.emit("PROGRESS", this.currentProgress)
                        },
                        onLog: (line) => {
                            const trimmed = String(line || "").trim()
                            if (trimmed.startsWith("[PREPARE]")) {
                                this.appendLog("info", "Prepare", trimmed.replace("[PREPARE] ", ""))
                            } else if (trimmed.startsWith("[CMD]")) {
                                this.appendLog("info", "Command", trimmed.replace("[CMD] ", ""))
                            } else if (trimmed.startsWith("[DONE]")) {
                                this.appendLog("info", "Done", trimmed.replace("[DONE] ", ""))
                            } else {
                                this.appendLog("debug", "FFmpeg", trimmed)
                            }
                        },
                    })

                    if (res && res.ok) {
                        task.status = "done"
                        successCount++
                        this.emit("FILE_DONE", { index: i, name: task.name, ok: true })
                        this.appendLog(
                            "info",
                            "Done",
                            `[${i + 1}/${tasks.length}] Done: ${task.name}`,
                        )
                    } else if (res && res.dstExists) {
                        task.status = "skipped"
                        this.emit("FILE_DONE", {
                            index: i,
                            name: task.name,
                            ok: true,
                            skipped: true,
                        })
                        this.appendLog(
                            "warn",
                            "Skip",
                            `[${i + 1}/${tasks.length}] Output already exists: ${task.name}`,
                        )
                    } else {
                        task.status = "failed"
                        task.error = res?.ffmpegError || "Conversion failed"
                        failedCount++
                        this.emit("FILE_DONE", {
                            index: i,
                            name: task.name,
                            ok: false,
                            error: task.error,
                        })
                        this.appendLog(
                            "error",
                            "Fail",
                            `[${i + 1}/${tasks.length}] Failed: ${task.name} - ${task.error}`,
                        )
                    }
                } catch (err) {
                    if (signal.aborted) {
                        task.status = "cancelled"
                        this.appendLog("warn", "Stop", `Task cancelled by user: ${task.name}`)
                        break
                    }
                    task.status = "failed"
                    task.error = err.message
                    failedCount++
                    this.emit("FILE_DONE", {
                        index: i,
                        name: task.name,
                        ok: false,
                        error: err.message,
                    })
                    this.appendLog(
                        "error",
                        "Fail",
                        `[${i + 1}/${tasks.length}] Error: ${err.message}`,
                    )
                }

                await log.flushFileLog()
            }
        } finally {
            const elapsedMs = Date.now() - startTime
            const isCancelled = signal.aborted
            this.status = isCancelled ? "STOPPED" : "COMPLETED"
            this.summary = {
                total: tasks.length,
                success: successCount,
                failed: failedCount,
                elapsedMs,
                humanElapsed: helper.humanTime(startTime),
                isCancelled,
            }

            this.currentProgress = null
            this.emit("STATUS_CHANGE", { status: this.status })
            this.emit("ALL_DONE", this.summary)
            this.appendLog(
                isCancelled ? "warn" : "info",
                "Summary",
                `Execution ${this.status}: Total=${tasks.length}, OK=${successCount}, Fail=${failedCount}, Time=${this.summary.humanElapsed}`,
            )
            await log.flushFileLog()
        }
    }

    /**
     * 中断正在执行的任务
     */
    stopExecution() {
        if (this.status !== "RUNNING" || !this.activeAbortController) {
            return { ok: false, message: "No running task to stop" }
        }
        this.activeAbortController.abort()
        this.appendLog("warn", "Stop", "Abort signal sent, killing ffmpeg process...")
        log.flushFileLog().catch(() => {})
        return { ok: true, message: "Stop signal sent" }
    }
}

export const taskRunner = new TaskRunner()
