import { resolveFFmpegBinary } from "../../../../lib/ffmpeg_bin.js"
import presets from "../../../../lib/ffmpeg_presets.js"
import { runFFmpegCmd, setFFmpegPath } from "../../../../lib/ffmpeg_run.js"
import { detectHardwareCapabilities } from "../../../../lib/hwdetect.js"
import { normalizeWebOptions, toLegacyArgvOptions } from "../../../../lib/ffmpeg_options.js"
import { collectInputFiles } from "../../../../lib/ffmpeg_scan.js"
import { buildTask } from "../../../../lib/ffmpeg_task.js"
import {
  createInternalExecutionPlan,
  createPublicPlanSnapshot,
} from "../../../../lib/ffmpeg_plan_snapshot.js"
import { createFFmpegEngine } from "../../../../lib/ffmpeg_engine.js"
import type {
  EnvironmentSummary,
  PublicPlanSnapshot,
} from "../shared/contracts.js"

class FfmpegEnvironmentService {
  private ffmpegPath: string | null = null
  private hardware: any = null
  private currentPlan: any = null
  private status: "IDLE" | "PLANNING" | "READY" | "RUNNING" | "STOPPED" | "COMPLETED" | "FAILED" = "IDLE"
  private abortController: AbortController | null = null
  private eventSink: ((event: Record<string, unknown>) => void) | null = null
  private summary: Record<string, unknown> | null = null

  setEventSink(sink: ((event: Record<string, unknown>) => void) | null) {
    this.eventSink = sink
  }

  async getSummary(): Promise<EnvironmentSummary> {
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary()
      if (this.ffmpegPath) setFFmpegPath(this.ffmpegPath)
    }
    await presets.initPresetsAsync()
    if (this.ffmpegPath && !this.hardware) {
      this.hardware = await detectHardwareCapabilities({ ffmpegPath: this.ffmpegPath })
    }

    return {
      ffmpegPath: this.ffmpegPath,
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
        gpus: this.hardware?.gpus || [],
        encoders: Array.from(this.hardware?.encoders || []),
        hwaccels: Array.from(this.hardware?.hwaccels || []),
      },
    }
  }

  async createPlan(body: Record<string, unknown> = {}): Promise<PublicPlanSnapshot> {
    if (this.status === "RUNNING") throw new Error("An execution is already running")
    this.status = "PLANNING"
    try {
      const normalized = normalizeWebOptions(body)
      const files = await collectInputFiles(normalized.inputs)
      if (files.length === 0) throw new Error("No media files found in specified inputs")

      const argv = toLegacyArgvOptions(normalized)
      const activePreset = presets.createFromArgv({
        ...argv,
        output: normalized.output,
        preset: normalized.preset || "hevc_2k",
      })
      const tasks: any[] = []
      for (const file of files) {
        const task = await buildTask(file, {
          index: tasks.length,
          total: files.length,
          activePreset,
          argv,
          output: normalized.output,
        })
        if (task) tasks.push(task)
      }
      if (tasks.length === 0) throw new Error("No tasks can be built from the input")

      this.currentPlan = createInternalExecutionPlan({
        id: `plan_${Date.now()}`,
        presetName: activePreset.name,
        preset: activePreset,
        mode: "plan",
        argv: normalized,
        tasks: tasks as any,
        totalDuration: tasks.reduce((sum, task) => sum + (task.duration || 0), 0),
        totalSize: tasks.reduce((sum, task) => sum + (task.size || 0), 0),
      } as any)
      this.status = "READY"
      this.summary = null
      return createPublicPlanSnapshot(this.currentPlan)
    } catch (error) {
      this.status = "IDLE"
      throw error
    }
  }

  async startExecution(taskIds: string[] = []): Promise<{ runId: string }> {
    if (!this.currentPlan) throw new Error("No active plan to execute")
    if (this.status === "RUNNING") throw new Error("An execution is already running")
    const tasks = taskIds.length
      ? this.currentPlan.tasks.filter((task: any) => taskIds.includes(task.id))
      : this.currentPlan.tasks
    if (tasks.length === 0) throw new Error("No selected tasks to execute")

    this.status = "RUNNING"
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    const runId = this.currentPlan.id
    const engine = createFFmpegEngine({
      runTask: (task: any, context: any) =>
        runFFmpegCmd(task, {
          showBar: false,
          signal: context.signal,
          onProgress: context.onProgress,
          onLog: context.onLog,
        } as any),
      onEvent: (event: Record<string, unknown>) => this.eventSink?.(event),
    })
    void engine
      .execute(
        { ...this.currentPlan, tasks },
        {
          mode: "execute",
          signal,
          concurrency: 1,
          onSummary: (summary: Record<string, unknown>) => {
            this.summary = summary
            this.status = summary.isCancelled ? "STOPPED" : "COMPLETED"
          },
        },
      )
      .catch((error: unknown) => {
        this.summary = { status: "failed", error: error instanceof Error ? error.message : String(error) }
        this.status = "FAILED"
      })
      .finally(() => {
        this.abortController = null
      })
    return { runId }
  }

  stopExecution() {
    if (!this.abortController) return { ok: false, message: "No running task to stop" }
    this.abortController.abort()
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
    this.eventSink = null
  }
}

export const ffmpegEnvironment = new FfmpegEnvironmentService()
