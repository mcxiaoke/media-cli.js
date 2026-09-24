import { app } from "electron"
import os from "node:os"
import { execFile, execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { resolveFFmpegBinary, resolveFFprobeBinary } from "../../../../lib/ffmpeg_bin.js"
import presets from "../../../../lib/ffmpeg_presets.js"
import { runFFmpeg, setFFmpegPath } from "../../../../lib/ffmpeg_run.js"
import { createFFmpegArgs, flattenFFArgs } from "../../../../lib/ffmpeg_build.js"
import { detectHardwareCapabilities } from "../../../../lib/hwdetect.js"
import { normalizeWebOptions, toLegacyArgvOptions } from "../../../../lib/ffmpeg_options.js"
import { scanWebInputFiles } from "../../../../lib/ffmpeg_scan.js"
import { getMediaInfo } from "../../../../lib/mediainfo.js"
import { deleteCompletedSources, prepareFFmpegPlan } from "../../../../lib/ffmpeg_planner.js"
import { createPublicPlanSnapshot } from "../../../../lib/ffmpeg_plan_snapshot.js"
import { createFFmpegEngine } from "../../../../lib/ffmpeg_engine.js"
import {
  startPreventSuspension,
  stopPreventSuspension,
  updateTaskbarProgress,
  setTaskbarProgressError,
} from "./native.js"
import type {
  EnvironmentSummary,
  PublicPlanSnapshot,
} from "../shared/contracts.js"

const execFileAsync = promisify(execFile)

class FfmpegEnvironmentService {
  private ffmpegPath: string | null = null
  private ffprobePath: string | null = null
  private hardware: any = null
  private currentPlan: any = null
  private status: "IDLE" | "PLANNING" | "READY" | "RUNNING" | "STOPPING" | "STOPPED" | "COMPLETED" | "FAILED" | "STALE" = "IDLE"
  private abortController: AbortController | null = null
  private eventSink: ((event: Record<string, unknown>) => void) | null = null
  private summary: Record<string, unknown> | null = null
  private activePids = new Set<number>()

  private get manifestPath() {
    return path.join(app.getPath("userData"), "active-tasks.json")
  }

  setEventSink(sink: ((event: Record<string, unknown>) => void) | null) {
    this.eventSink = sink
  }

  async initialize() {
    await this.recoverStaleTasks()
  }

  private async recoverStaleTasks() {
    try {
      const raw = await readFile(this.manifestPath, "utf8")
      const entries = JSON.parse(raw) as Array<{ tempPath?: string }>
      for (const entry of entries) {
        if (!entry.tempPath || !this.isManagedTempPath(entry.tempPath)) continue
        await rm(entry.tempPath, { force: true })
      }
      await rm(this.manifestPath, { force: true })
    } catch {
      // Do not block app startup on an unreadable manifest.
    }
  }

  private isManagedTempPath(filePath: string) {
    const name = path.basename(filePath)
    return name.includes("_tmp@") && name.includes("@tmp_")
  }

  private async writeTaskManifest(tasks: any[], runId: string) {
    const manifest = tasks.map((task) => ({
      runId,
      taskId: task.id,
      tempPath: task.fileDstTemp,
      outputPath: task.fileDst,
      createdAt: new Date().toISOString(),
    }))
    await mkdir(path.dirname(this.manifestPath), { recursive: true })
    const tempManifest = `${this.manifestPath}.tmp`
    await writeFile(tempManifest, JSON.stringify(manifest, null, 2), "utf8")
    await rename(tempManifest, this.manifestPath)
  }

  private async clearTaskManifest() {
    await rm(this.manifestPath, { force: true })
  }

  private resolvePresetPath() {
    const candidates = [
      path.join(process.resourcesPath, "presets", "default.yaml"),
      path.join(app.getAppPath(), "out", "presets", "default.yaml"),
      path.join(app.getAppPath(), "presets", "default.yaml"),
      path.join(app.getAppPath(), "..", "presets", "default.yaml"),
      path.join(app.getAppPath(), "..", "..", "presets", "default.yaml"),
      path.join(app.getAppPath(), "..", "..", "..", "..", "presets", "default.yaml"),
      path.resolve(process.cwd(), "out", "presets", "default.yaml"),
      path.resolve(process.cwd(), "presets", "default.yaml"),
      path.resolve(process.cwd(), "..", "..", "presets", "default.yaml"),
    ]
    return candidates.find((candidate) => existsSync(candidate)) || null
  }

  async getSummary(): Promise<EnvironmentSummary> {
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary()
      if (this.ffmpegPath) setFFmpegPath(this.ffmpegPath)
    }
    if (!this.ffprobePath) {
      this.ffprobePath = await resolveFFprobeBinary(this.ffmpegPath || undefined)
    }
    const presetPath = this.resolvePresetPath()
    if (!presetPath) throw new Error("Bundled FFmpeg preset file was not found")
    await presets.initPresetsAsync(presetPath)
    if (this.ffmpegPath && !this.hardware) {
      this.hardware = await detectHardwareCapabilities({ ffmpegPath: this.ffmpegPath })
    }

    const vendor = (this.hardware?.vendor || "").toLowerCase()
    const encoders = Array.from(this.hardware?.encoders || []) as string[]
    let tier: "nvidia" | "intel" | "amd" | "cpu" = "cpu"
    if (vendor.includes("nvidia") || encoders.some((e: string) => e.includes("nvenc"))) {
      tier = "nvidia"
    } else if (vendor.includes("intel") || encoders.some((e: string) => e.includes("qsv"))) {
      tier = "intel"
    } else if (vendor.includes("amd") || encoders.some((e: string) => e.includes("amf"))) {
      tier = "amd"
    }

    return {
      ffmpegPath: this.ffmpegPath,
      ffprobePath: this.ffprobePath,
      presets: presets.getAllNames().map((name: string) => {
        const preset = presets.getPreset(name)
        return {
          name,
          type: preset?.type || "video",
          format: preset?.format || ".mp4",
          videoCodecFamily: preset?.videoCodecFamily || "",
          audioCodec: preset?.audioCodec || "",
          videoQuality: preset?.videoQuality || 0,
          videoBitrate: preset?.videoBitrate || 0,
          audioBitrate: preset?.audioBitrate || 0,
          dimension: preset?.dimension || 0,
        }
      }),
      hardware: {
        gpus: (this.hardware?.gpus || []).map((g: any) => ({
          vendor: g.vendor || "Unknown",
          model: g.model || g.name || "Unknown GPU",
          generation: g.generation || undefined,
        })),
        encoders,
        hwaccels: Array.from(this.hardware?.hwaccels || []),
        tier,
      },
      system: {
        cpuModel: os.cpus()[0]?.model?.trim() || "CPU",
        cpuCores: os.cpus().length,
        totalMemGb: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
        freeMemGb: Math.round(os.freemem() / (1024 * 1024 * 1024)),
      },
    }
  }

  async createPlan(body: Record<string, unknown> = {}): Promise<PublicPlanSnapshot> {
    if (this.status === "RUNNING") throw new Error("An execution is already running")
    this.status = "PLANNING"
    this.currentPlan = null
    this.summary = null
    try {
      await this.getSummary()
      const normalized = normalizeWebOptions(body)
      const allPresetNames = presets.getAllNames()
      const presetName = normalized.preset || "hevc_2k"
      const presetObject =
        presets.getPreset(presetName) ||
        presets.getPreset("hevc_2k") ||
        presets.getPreset("h264_2k") ||
        presets.getPreset(allPresetNames[0])
      if (!presetObject) throw new Error("No FFmpeg presets are available")

      this.eventSink?.({
        type: "task.log",
        level: "INFO",
        message: `开始分析输入源并构建转码计划（预设模板: ${presetObject.name}）...`,
        timestamp: new Date().toLocaleTimeString(),
      })

      if (
        normalized.deleteSourceFiles &&
        !normalized.deleteSourceConfirmed &&
        !normalized.autoConfirm
      ) {
        throw new Error("deleteSourceFiles requires explicit confirmation")
      }
      const argv = {
        ...toLegacyArgvOptions(normalized),
        output: normalized.output,
        preset: presetObject.name,
      }
      const activePreset = presets.createFromArgv(argv)
      const files = (await (scanWebInputFiles as any)({
        inputs: normalized.inputs,
        argv: normalized,
        presetType: activePreset.type,
        isAudioExtract: presets.isAudioExtract(activePreset),
      })) as any[]
      if (files.length === 0) throw new Error("No media files found in specified inputs")

      this.eventSink?.({
        type: "task.log",
        level: "INFO",
        message: `输入扫描完成：匹配到 ${files.length} 个媒体文件，正在提取元数据与编排参数...`,
        timestamp: new Date().toLocaleTimeString(),
      })

      const prepared = (await (prepareFFmpegPlan as any)({
        entries: files,
        preset: activePreset,
        argv,
        mode: "plan",
        concurrency: normalized.jobs || 1,
        buildTaskDeps: {
          getMediaInfo: (file: string, options?: { signal?: AbortSignal }) =>
            getMediaInfo(file, {
              useMediaInfo: false,
              ...(this.ffprobePath ? { ffprobePath: this.ffprobePath } : {}),
              ...(options?.signal ? { signal: options.signal } : {}),
            }),
        },
      })) as any
      this.currentPlan = prepared.plan

      this.eventSink?.({
        type: "task.log",
        level: "INFO",
        message: `计划生成就绪：共编排 ${this.currentPlan.totalTasks} 个转码任务，预估总大小 ${(this.currentPlan.totalSize / 1e6).toFixed(1)} MB，预估总耗时 ${this.currentPlan.totalDuration.toFixed(0)} 秒`,
        timestamp: new Date().toLocaleTimeString(),
      })

      // Generate previewCmd for the first task if missing
      if (this.currentPlan?.tasks?.length > 0 && !this.currentPlan.previewCmd) {
        try {
          const firstTask = this.currentPlan.tasks[0]
          const buildResult = createFFmpegArgs(firstTask, firstTask.hwPlan || null)
          const rawArgs = buildResult?.args ? buildResult.args.flat() : []
          const flat = rawArgs
            .map((arg: any) => {
              const s = String(arg)
              if (s.length === 0) return '""'
              if (/[\s"']/.test(s)) {
                return `"${s.replace(/"/g, '\\"')}"`
              }
              return s
            })
            .join(" ")
          if (flat) this.currentPlan.previewCmd = `ffmpeg ${flat}`
        } catch {
          // Keep empty string fallback
        }
      }

      this.status = "READY"
      return createPublicPlanSnapshot(this.currentPlan)
    } catch (error) {
      this.status = "IDLE"
      throw error
    }
  }

  private killTrackedProcessesSync() {
    const pids = [...this.activePids]
    this.activePids.clear()
    for (const pid of pids) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
            timeout: 2000,
          })
        } else {
          process.kill(pid, "SIGKILL")
        }
      } catch {
        // Process may already have terminated or been killed
      }
    }
  }

  async startExecution(taskIds?: string[]): Promise<{ runId: string }> {
    if (!this.currentPlan) throw new Error("No active plan to execute")
    if (this.status === "RUNNING" || this.status === "PLANNING" || this.status === "STOPPING") {
      throw new Error(`Cannot start execution while in ${this.status} state`)
    }
    if (taskIds !== undefined && taskIds.length === 0) {
      throw new Error("No selected tasks to execute")
    }

    const selectedTasks = taskIds && taskIds.length > 0
      ? this.currentPlan.tasks.filter((task: any) => taskIds.includes(task.id))
      : this.currentPlan.tasks
    if (!selectedTasks || selectedTasks.length === 0) {
      throw new Error("No selected tasks to execute")
    }

    // Clean cloned tasks to prevent previous run status contamination
    const tasks = selectedTasks.map((task: any) => ({
      ...task,
      status: "pending",
      ok: undefined,
      ffmpegFailed: undefined,
      ffmpegError: undefined,
      error: null,
      skipReason: null,
      progress: 0,
      speed: 0,
    }))

    await this.recoverStaleTasks()
    await this.writeTaskManifest(tasks, this.currentPlan.id)
    this.status = "RUNNING"
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    const runId = this.currentPlan.id
    const executionPlan = { ...this.currentPlan, tasks }

    startPreventSuspension()
    updateTaskbarProgress(0)

    let lastProgressTime = 0

    const engine = createFFmpegEngine({
      runTask: (task: any, context: any) =>
        runFFmpeg(task, {
          showBar: false,
          signal: context.signal,
          onProgress: context.onProgress,
          onLog: context.onLog,
          onSpawn: (child: any) => {
            if (typeof child?.pid === "number") {
              this.activePids.add(child.pid)
              this.eventSink?.({ type: "process.spawn", pid: child.pid, taskId: task.id })
            }
          },
          onExit: (metadata: any) => {
            if (typeof metadata?.pid === "number") {
              this.activePids.delete(metadata.pid)
              this.eventSink?.({ type: "process.exit", ...metadata, taskId: task.id })
            }
          },
        } as any),
      onEvent: (event: Record<string, unknown>) => {
        if (event.type === "task.progress") {
          const now = Date.now()
          if (now - lastProgressTime < 100) return
          lastProgressTime = now
          if (typeof event.percent === "number") {
            updateTaskbarProgress(event.percent / 100)
          }
        }
        this.eventSink?.(event)
      },
    })

    void engine
      .execute(
        executionPlan,
        {
          mode: "execute",
          signal,
          concurrency: 1,
          onSummary: async (summary: Record<string, unknown>) => {
            stopPreventSuspension()
            const isCancelled = !!summary.isCancelled
            const failedCount = Array.isArray(summary.failed) ? summary.failed.length : 0
            if (failedCount > 0) {
              setTaskbarProgressError()
            } else {
              updateTaskbarProgress(isCancelled ? -1 : 1)
            }

            const deletion = await (deleteCompletedSources as any)({
              plan: executionPlan,
              confirmDeleteSource: executionPlan.argv?.deleteSourceConfirmed === true,
            })
            this.summary = {
              ...summary,
              deletion: {
                deleted: deletion.deleted.length,
                kept: deletion.kept.length,
                failed: deletion.failed.length,
              },
            }
            this.status = isCancelled ? "STOPPED" : "COMPLETED"
          },
        },
      )
      .catch((error: unknown) => {
        stopPreventSuspension()
        setTaskbarProgressError()
        this.summary = { status: "failed", error: error instanceof Error ? error.message : String(error) }
        this.status = "FAILED"
      })
      .finally(async () => {
        this.abortController = null
        await this.clearTaskManifest()
      })
    return { runId }
  }

  async stopExecution() {
    if (!this.abortController) return { ok: false, message: "No running task to stop" }
    this.status = "STOPPING"
    this.abortController.abort()
    this.killTrackedProcessesSync()
    stopPreventSuspension()
    updateTaskbarProgress(-1)
    return { ok: true, message: "Stop signal sent" }
  }

  getTaskSnapshot() {
    return {
      status: this.status,
      plan: this.currentPlan ? createPublicPlanSnapshot(this.currentPlan) : null,
      summary: this.summary,
    }
  }

  dispose() {
    this.abortController?.abort()
    stopPreventSuspension()
    updateTaskbarProgress(-1)
    this.killTrackedProcessesSync()
    void this.clearTaskManifest()
    this.eventSink = null
  }
}

export const ffmpegEnvironment = new FfmpegEnvironmentService()
