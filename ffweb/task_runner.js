/**
 * WebUI 任务调度器与状态机
 *
 * 负责与 lib/ 底层模块协作：加载预设、探测硬件、生成转码计划、
 * 执行转码队列、解析进度、捕获日志、处理用户中断与临时清理。
 */
import { resolveFFmpegBinary } from "../lib/ffmpeg_bin.js"
import { createFFmpegArgs, flattenFFArgs } from "../lib/ffmpeg_build.js"
import {
    deleteCompletedSources as deleteSourcesFromPlan,
    isPlanCurrent,
    PLAN_ERROR_CODE,
    prepareFFmpegPlan,
} from "../lib/ffmpeg_planner.js"
import { buildCliTask } from "../lib/ffmpeg_task.js"
import { createFFmpegEngine } from "../lib/ffmpeg_engine.js"
import { createPublicPlanSnapshot } from "../lib/ffmpeg_plan_snapshot.js"
import { normalizeWebOptions, toLegacyArgvOptions } from "../lib/ffmpeg_options.js"
import presets from "../lib/ffmpeg_presets.js"
import { runFFmpeg, setFFmpegPath } from "../lib/ffmpeg_run.js"
import { RUN_STATUS } from "../lib/ffmpeg_result.js"
import { scanWebInputFiles } from "../lib/ffmpeg_scan.js"
import * as helper from "../lib/helper.js"
import { TIERS } from "../lib/hwaccel.js"
import { detectHardwareCapabilities } from "../lib/hwdetect.js"
import * as log from "../lib/debug.js"

export class TaskRunner {
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
     * 收集输入的媒体文件条目。
     * 具体扫描实现位于 lib/ffmpeg_scan.js，便于后续 CLI/Engine 复用和测试。
     */
    async collectInputFiles(inputs, options = {}) {
        return scanWebInputFiles({ inputs, ...options })
    }

    /**
     * 创建转码计划（Plan）
     */
    async createPlan(body = {}) {
        if (this.status === "RUNNING") {
            throw new Error("Cannot create a new plan while execution is running")
        }
        const normalized = normalizeWebOptions(body)
        const inputs = normalized.inputs
        const output = normalized.output
        const requestedPreset = normalized.preset || "hevc_2k"
        await this.init()
        this.status = "PLANNING"
        this.emit("STATUS_CHANGE", { status: this.status })

        try {
            const allPresetNames = presets.getAllNames()
            const presetObj =
                presets.getPreset(requestedPreset) ||
                presets.getPreset("hevc_2k") ||
                presets.getPreset("h264_2k") ||
                presets.getPreset(allPresetNames[0])
            const legacyOptions = toLegacyArgvOptions(normalized)
            const mergedArgv = {
                output: output || "",
                decodeMode: normalized.decodeMode,
                preset: presetObj.name,
                ...legacyOptions,
            }
            if (
                mergedArgv.deleteSourceFiles === true &&
                mergedArgv.deleteSourceConfirmed !== true &&
                mergedArgv.autoConfirm !== true
            ) {
                const error = new Error(
                    "deleteSourceFiles requires explicit deleteSourceConfirmed or autoConfirm",
                )
                error.code = PLAN_ERROR_CODE.DELETE_SOURCE_CONFIRMATION
                throw error
            }
            const activePreset = presets.createFromArgv(mergedArgv)
            const files = await this.collectInputFiles(inputs, {
                argv: normalized,
                presetType: activePreset.type,
                isAudioExtract: presets.isAudioExtract(activePreset),
            })
            if (files.length === 0) {
                this.status = "IDLE"
                this.emit("STATUS_CHANGE", { status: this.status })
                const error = new Error("No media files found in specified inputs")
                error.code = PLAN_ERROR_CODE.NO_INPUTS
                throw error
            }

            this.appendLog(
                "info",
                "Plan",
                `Analyzing ${files.length} file(s) for preset [${activePreset.name}]...`,
            )

            const prepared = await prepareFFmpegPlan({
                entries: files,
                preset: activePreset,
                argv: mergedArgv,
                mode: normalized.mode,
                concurrency: 1,
                onTaskError: (entry, error) => {
                    this.appendLog("warn", "Plan", `Skip ${entry.name}: ${error.message}`)
                },
            })

            // 生成命令预览（以首个可执行任务为例）。空计划/全跳过计划仍然
            // 可以被查看和执行，Engine 会给出统一的空/skipped summary。
            const previewPlan = {
                tier: TIERS.find((t) => t.name === "cpu"),
                caps: this.hwCaps,
            }
            const previewTask =
                prepared.executableTasks[0] || prepared.tasks.find((task) => task.fileDst)
            let previewCmd = ""
            if (previewTask) {
                const sampleFFPlan = createFFmpegArgs(previewTask, previewPlan)
                previewCmd = `ffmpeg ${flattenFFArgs(sampleFFPlan.args)}`
            }
            prepared.plan.previewCmd = previewCmd
            this.currentPlan = prepared.plan
            this.summary = null
            this.currentProgress = null
            const { tasks, totalDuration, totalSize } = prepared

            this.status = "IDLE"
            this.emit("STATUS_CHANGE", { status: this.status })
            this.appendLog(
                "info",
                "Plan",
                `Plan ready: ${tasks.length} file(s), total ${helper.humanSeconds(totalDuration)}`,
            )
            this.appendLog("info", "Command", `Preview Command: ${previewCmd}`)

            const publicPlan = createPublicPlanSnapshot({
                ...this.currentPlan,
                mode: normalized.mode,
            })
            publicPlan.humanDuration = helper.humanSeconds(totalDuration)
            publicPlan.humanSize = helper.humanSize(totalSize)
            publicPlan.tasks = publicPlan.tasks.map((task) => ({
                ...task,
                humanSize: helper.humanSize(task.size),
                humanDuration: helper.humanSeconds(task.duration),
            }))

            return {
                ok: true,
                plan: publicPlan,
            }
        } catch (error) {
            this.status = "IDLE"
            this.emit("STATUS_CHANGE", { status: this.status })
            throw error
        }
    }

    async deleteCompletedSources(plan = this.currentPlan) {
        const deletion = await deleteSourcesFromPlan({
            plan,
            confirmDeleteSource: true,
        })
        if (deletion.requested) {
            this.appendLog(
                "info",
                "DeleteSource",
                `deleted=${deletion.deleted.length}, kept=${deletion.kept.length}, failed=${deletion.failed.length}`,
            )
            for (const failedPath of deletion.failed) {
                this.appendLog("error", "DeleteSource", `Failed to remove source: ${failedPath}`)
            }
        }
        return deletion
    }

    /**
     * 启动转码任务
     */
    async startExecution() {
        if (!this.currentPlan) {
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
        this.appendLog("info", "Run", `Starting execution of ${tasks.length} task(s)...`)

        const engine = createFFmpegEngine({
            onEvent: (event) => this.emit("ENGINE_EVENT", event),
            runTask: (task, context) =>
                runFFmpeg(task, {
                    showBar: false,
                    signal: context.signal,
                    onProgress: context.onProgress,
                    onLog: context.onLog,
                }),
        })

        try {
            const summary = await engine.execute(plan, {
                mode: "execute",
                signal,
                concurrency: 1,
                maxAttempts: plan.argv?.strict === true || plan.argv?.autoConfirm !== true ? 1 : 2,
                shouldRetry: ({ result }) => result.status === "failed",
                confirmRetry: async () => plan.argv?.autoConfirm === true,
                prepareAttempt: async ({ task, attempt, signal }) => {
                    if (attempt === 1) return task
                    this.appendLog("warn", "Retry", `Retrying on CPU: ${task.name}`)
                    return buildCliTask({
                        ...task,
                        argv: { ...(task.argv || {}), decodeMode: "cpu" },
                        retryOnFailed: true,
                        signal,
                    })
                },
                onTaskStart: ({ task, index, total }) => {
                    this.currentTaskIndex = index
                    this.emit("TASK_START", { index, taskName: task.name })
                    this.appendLog(
                        "info",
                        "Run",
                        `[${index + 1}/${total}] Processing: ${task.name}`,
                    )
                },
                onTaskProgress: (progress, { task, index, total }) => {
                    this.currentProgress = {
                        taskIndex: index,
                        totalTasks: total,
                        currentFile: task.name,
                        ...progress,
                    }
                    this.emit("PROGRESS", this.currentProgress)
                },
                onTaskLog: (line) => {
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
                onTaskDone: ({ task, index, result }) => {
                    if (result.status === RUN_STATUS.CANCELLED) {
                        this.emit("FILE_DONE", {
                            index,
                            name: task.name,
                            ok: false,
                            cancelled: true,
                            status: result.status,
                        })
                        this.appendLog("warn", "Stop", `Task cancelled by user: ${task.name}`)
                    } else if (result.status === RUN_STATUS.SUCCESS) {
                        this.emit("FILE_DONE", {
                            index,
                            name: task.name,
                            ok: true,
                            status: result.status,
                        })
                        this.appendLog("info", "Done", `Done: ${task.name}`)
                    } else if (result.status === RUN_STATUS.SKIPPED) {
                        this.emit("FILE_DONE", {
                            index,
                            name: task.name,
                            ok: true,
                            skipped: true,
                            status: result.status,
                            reason: result.reason,
                        })
                        this.appendLog(
                            "warn",
                            "Skip",
                            `Skipped ${task.name}: ${result.reason || task.skipReason || "unknown reason"}`,
                        )
                    } else {
                        this.emit("FILE_DONE", {
                            index,
                            name: task.name,
                            ok: false,
                            status: result.status,
                            error: result.error,
                        })
                        this.appendLog("error", "Fail", `Failed: ${task.name} - ${result.error}`)
                    }
                },
                onSummary: async (summary) => {
                    if (isPlanCurrent(plan, this.currentPlan)) {
                        await this.deleteCompletedSources(plan)
                    }
                    const isCancelled = summary.isCancelled
                    this.status = isCancelled ? "STOPPED" : "COMPLETED"
                    this.summary = {
                        ...summary,
                        humanElapsed: helper.humanTime(startTime),
                    }
                    this.currentProgress = null
                    this.activeAbortController = null
                    this.currentTaskIndex = -1
                    this.emit("STATUS_CHANGE", { status: this.status })
                    this.emit("ALL_DONE", this.summary)
                    this.appendLog(
                        isCancelled ? "warn" : "info",
                        "Summary",
                        `Execution ${this.status}: Total=${summary.total}, OK=${summary.success}, Fail=${summary.failed}, Cancelled=${summary.cancelled}, Time=${this.summary.humanElapsed}`,
                    )
                },
            })
            await log.flushFileLog()
            return summary
        } catch (error) {
            const isCancelled = signal.aborted
            this.status = isCancelled ? "STOPPED" : "COMPLETED"
            this.summary = {
                runId: plan.id,
                total: tasks.length,
                success: 0,
                failed: tasks.filter((task) => task.status === "failed").length,
                skipped: tasks.filter((task) => task.status === "skipped").length,
                cancelled: tasks.filter((task) => task.status === "cancelled").length,
                elapsedMs: Date.now() - startTime,
                humanElapsed: helper.humanTime(startTime),
                isCancelled,
                error: error?.message || String(error),
            }
            this.currentProgress = null
            this.activeAbortController = null
            this.currentTaskIndex = -1
            this.emit("STATUS_CHANGE", { status: this.status })
            this.emit("ALL_DONE", this.summary)
            this.appendLog("error", "Summary", `Execution error: ${this.summary.error}`)
            await log.flushFileLog()
            return this.summary
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
