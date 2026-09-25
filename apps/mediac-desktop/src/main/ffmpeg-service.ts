import { app } from "electron"
import { execFileSync } from "node:child_process"
import path from "node:path"
import {
  collectInputFiles,
  createFFmpegArgs,
  createFFmpegEngine,
  createPublicPlanSnapshot,
  createPublicTaskSnapshot,
  deleteCompletedSources,
  getMediaInfo,
  normalizeDesktopOptions,
  presets,
  prepareFFmpegPlan,
  runFFmpeg,
  scanDesktopInputFiles,
  toLegacyArgvOptions,
} from "../../../../src/transcode/index.js"
import { FfmpegEnvironment } from "./ffmpeg-environment.js"
import { FfmpegManifest } from "./ffmpeg-manifest.js"
import { PathWhitelist } from "./path-whitelist.js"
import {
  startPreventSuspension,
  stopPreventSuspension,
  updateTaskbarProgress,
  setTaskbarProgressError,
} from "./native.js"
import type {
  EnvironmentSummary,
  PlanTask,
  PublicPlanSnapshot,
  RunnerState,
  StageInputsResult,
} from "../shared/contracts.js"

/** 并发上限：probe 与转码并发共用进程/内存预算，超过后收益递减且易触发 OOM */
const MAX_CONCURRENCY = 8
const DEFAULT_CONCURRENCY = 1

/**
 * Desktop 宿主转码服务：session/staging/plan/execute 协调与上下文组合。
 * 环境（二进制/预设/硬件）、路径白名单持久化、manifest 细节分别收敛到
 * ffmpeg-environment.ts / path-whitelist.ts / ffmpeg-manifest.ts，本类不内嵌。
 */
class DesktopTranscodeService {
  private readonly environment: FfmpegEnvironment
  private readonly whitelist: PathWhitelist
  private readonly manifest: FfmpegManifest
  private currentPlan: any = null
  private stagedEntries = new Map<string, { item: any; task: PlanTask; info: any }>()
  private status: RunnerState = "IDLE"
  /** 计划阶段解析出的并发数，执行阶段必须沿用，否则用户设置的 jobs 形同虚设 */
  private plannedConcurrency: number = DEFAULT_CONCURRENCY
  private abortController: AbortController | null = null
  private eventSink: ((event: Record<string, unknown>) => void) | null = null
  private summary: Record<string, unknown> | null = null
  private activePids = new Set<number>()

  constructor() {
    const userData = app.getPath("userData")
    this.environment = new FfmpegEnvironment({ getAppPath: () => app.getAppPath() })
    this.whitelist = new PathWhitelist(path.join(userData, "authorized-paths.json"))
    this.manifest = new FfmpegManifest(path.join(userData, "active-tasks.json"))
  }

  /**
   * S-1 加固：SYSTEM_OPEN_PATH / SYSTEM_SHOW_IN_FOLDER 只接受已知路径——
   * ① staged 输入与当前计划任务的源/产物；
   * ② 上述已知文件的直接父目录（「打开输出目录」传的是 dirname(fileDst)）；
   * ③ 原生对话框授权根自身或其子路径（PathWhitelist 提供）。
   * 渲染层即使被攻破，也无法让主进程打开任意外部路径。
   */
  isKnownMediaPath(fullPath: unknown): boolean {
    if (typeof fullPath !== "string" || !fullPath || !path.isAbsolute(fullPath)) return false
    const target = this.whitelist.normalizeForCompare(fullPath)

    const knownFiles = new Set<string>()
    for (const key of this.stagedEntries.keys()) knownFiles.add(this.whitelist.normalizeForCompare(key))
    for (const t of this.currentPlan?.tasks ?? []) {
      if (t?.path) knownFiles.add(this.whitelist.normalizeForCompare(t.path))
      if (t?.fileDst) knownFiles.add(this.whitelist.normalizeForCompare(t.fileDst))
    }
    if (knownFiles.has(target)) return true
    for (const f of knownFiles) {
      if (this.whitelist.normalizeForCompare(path.dirname(f)) === target) return true
    }
    return this.whitelist.isAuthorizedRoot(target)
  }

  /** 已解析到的 ffmpeg 路径（未解析时为 null），供「关于」等只读展示使用 */
  getFfmpegPath(): string | null {
    return this.environment.getFfmpegPath()
  }

  /** 环境摘要（二进制/预设/硬件/系统），IPC ENV_GET 使用 */
  getSummary(): Promise<EnvironmentSummary> {
    return this.environment.getSummary()
  }

  /** 登记用户通过原生对话框明确选择的路径（委托 PathWhitelist 持久化） */
  authorizePaths(paths: unknown) {
    this.whitelist.authorizePaths(paths)
  }

  setEventSink(sink: ((event: Record<string, unknown>) => void) | null) {
    this.eventSink = sink
  }

  async initialize() {
    await Promise.all([this.manifest.recoverStaleTasks(), this.whitelist.loadAuthorizedPaths()])
  }

  /** 将用户/配置传入的 jobs 规范化到 [1, MAX_CONCURRENCY] */
  private resolveConcurrency(jobs: unknown): number {
    const value = Number(jobs)
    if (!Number.isFinite(value) || value < 1) return DEFAULT_CONCURRENCY
    return Math.min(MAX_CONCURRENCY, Math.floor(value))
  }

  async stageInputs(paths: string[]): Promise<StageInputsResult> {
    if (!paths || paths.length === 0) {
      return { added: [], skippedDuplicates: 0, totalCount: this.stagedEntries.size }
    }
    await this.environment.getSummary()

    // 1. Collect files from paths
    const collected = (await (collectInputFiles as any)(paths)) as any[]
    if (!collected || collected.length === 0) {
      return { added: [], skippedDuplicates: 0, totalCount: this.stagedEntries.size }
    }

    // 2. Filter out already staged paths
    const newItems: any[] = []
    let skippedDuplicates = 0
    for (const item of collected) {
      const canonical = path.resolve(item.path)
      if (this.stagedEntries.has(canonical)) {
        skippedDuplicates++
      } else {
        newItems.push(item)
      }
    }

    if (newItems.length === 0) {
      if (skippedDuplicates > 0) {
        this.eventSink?.({
          type: "task.log",
          level: "INFO",
          message: `添加路径扫描完成：发现 ${collected.length} 个文件，全部已存在于列表中（已跳过 ${skippedDuplicates} 项）`,
          timestamp: new Date().toLocaleTimeString(),
        })
      }
      return { added: [], skippedDuplicates, totalCount: this.stagedEntries.size }
    }

    this.eventSink?.({
      type: "task.log",
      level: "INFO",
      message: `发现 ${newItems.length} 个新媒体文件，开始快速提取元数据...${skippedDuplicates > 0 ? ` (跳过 ${skippedDuplicates} 个重复项)` : ""}`,
      timestamp: new Date().toLocaleTimeString(),
    })

    // 3. Concurrently probe stream metadata
    const added: PlanTask[] = []
    const limit = MAX_CONCURRENCY
    let cursor = 0

    const probeWorker = async () => {
      while (cursor < newItems.length) {
        const idx = cursor++
        const item = newItems[idx]
        const canonical = path.resolve(item.path)
        let info: any = null
        try {
          info = await (getMediaInfo as any)(item.path, {
            useMediaInfo: false,
            ...(this.environment.resolvedFfprobePath
              ? { ffprobePath: this.environment.resolvedFfprobePath }
              : {}),
          })
        } catch {
          // ignore or fallback
        }

        const ext = path.extname(item.path).replace(/^\./, "").toUpperCase()
        // 统一经 createPublicTaskSnapshot 投影初始公开任务：元数据字段从 info 提取，
        // 无需在此手工逐一映射。staged 状态显式传入，缺失数值由投影回退 undefined。
        const task = createPublicTaskSnapshot(
          {
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: item.name,
            path: item.path,
            size: item.size || 0,
            duration: info?.duration || 0,
            fileDst: "",
            status: "staged",
            containerFormat: ext || "MEDIA",
            mediaInfo: info || undefined,
          },
          this.stagedEntries.size,
        ) as PlanTask

        this.stagedEntries.set(canonical, { item, task, info })
        added.push(task)
      }
    }

    const workers = Array.from({ length: Math.min(limit, newItems.length) }, () => probeWorker())
    await Promise.all(workers)

    this.eventSink?.({
      type: "task.log",
      level: "INFO",
      message: `媒体元数据提取完成：已就绪新增 ${added.length} 项（当前共导入 ${this.stagedEntries.size} 个视频）`,
      timestamp: new Date().toLocaleTimeString(),
    })

    return {
      added,
      skippedDuplicates,
      totalCount: this.stagedEntries.size,
    }
  }

  async createPlan(body: Record<string, unknown> = {}): Promise<PublicPlanSnapshot> {
    // RUNNING 期间不可重建；STOPPING 期间同理——此刻 abort 还在收尾，
    // 重建会清掉 currentPlan，与 stopExecution 的收尾写入互相踩踏。
    if (this.status === "RUNNING" || this.status === "STOPPING") {
      throw new Error(
        this.status === "RUNNING"
          ? "An execution is already running"
          : "An execution is stopping, wait for it to settle",
      )
    }
    this.status = "PLANNING"
    this.currentPlan = null
    this.summary = null
    try {
      await this.environment.getSummary()
      const normalized = normalizeDesktopOptions(body)
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
      // 记录用户选择的并发，执行阶段沿用（此前执行期硬编码 1，jobs 设置完全无效）
      this.plannedConcurrency = this.resolveConcurrency(normalized.jobs)

      const argv = {
        ...toLegacyArgvOptions(normalized),
        output: normalized.output,
        preset: presetObject.name,
      }
      const activePreset = presets.createFromArgv(argv)
      const files = (await (scanDesktopInputFiles as any)({
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
        concurrency: this.resolveConcurrency(normalized.jobs),
        buildTaskDeps: {
          getMediaInfo: async (file: string, options?: { signal?: AbortSignal }) => {
            const canonical = path.resolve(file)
            const cached = this.stagedEntries.get(canonical)?.info
            if (cached) return cached
            return getMediaInfo(file, {
              useMediaInfo: false,
              ...(this.environment.resolvedFfprobePath
                ? { ffprobePath: this.environment.resolvedFfprobePath }
                : {}),
              ...(options?.signal ? { signal: options.signal } : {}),
            })
          },
        },
      })) as any
      this.currentPlan = prepared.plan

      const taskCount = this.currentPlan?.tasks?.length || 0
      const totalSizeMb = ((this.currentPlan?.totalSize || 0) / 1e6).toFixed(1)
      const totalDurationSec = (this.currentPlan?.totalDuration || 0).toFixed(0)

      this.eventSink?.({
        type: "task.log",
        level: "INFO",
        message: `计划生成就绪：共编排 ${taskCount} 个转码任务，预估总大小 ${totalSizeMb} MB，预估总耗时 ${totalDurationSec} 秒`,
        timestamp: new Date().toLocaleTimeString(),
      })

      // Generate previewCmd for the first task if missing
      if (this.currentPlan?.tasks?.length > 0 && !this.currentPlan.previewCmd) {
        try {
          const firstTask = this.currentPlan.tasks[0]
          const buildResult = createFFmpegArgs(firstTask, this.environment.buildPreviewHwPlan())
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

      // 公开投影统一由 createPublicPlanSnapshot / createPublicTaskSnapshot 从 task.info
      // 提取元数据（buildTask 在任务构建期已填充 .info），此处不再手工补 metadata 字段；
      // 仅将 stagedEntries 重登记为编排后的 plan task，供执行期 isKnownMediaPath / 去重使用。
      if (this.currentPlan?.tasks) {
        for (const t of this.currentPlan.tasks) {
          const canonical = path.resolve(t.path)
          const staged = this.stagedEntries.get(canonical)
          const info = staged?.info || (t as any).info || null
          this.stagedEntries.set(canonical, { item: t, task: t, info })
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
    // 未解析到 ffmpeg 时不要裸调 "ffmpeg"：那会命中 PATH 里的另一个版本，
    // 与能力探测结果不一致（探测说有编码器 -> 执行时 Unknown encoder）。
    const ffmpegPath = await this.environment.ensureFfmpegPath()
    if (!ffmpegPath) {
      throw new Error(
        "未找到可用的 ffmpeg 可执行文件。请安装 ffmpeg 后重启应用，或在环境变量 FFMPEG_PATH 中指定其绝对路径。",
      )
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

    // Filter out tasks that are already completed or skipped
    const uncompletedTasks = selectedTasks.filter(
      (task: any) => task.status !== "success" && task.status !== "skipped"
    )

    if (uncompletedTasks.length === 0) {
      this.eventSink?.({
        type: "task.log",
        level: "INFO",
        message: "所选任务均已全部转码完成，无需重复执行。",
        timestamp: new Date().toLocaleTimeString(),
      })
      this.status = "COMPLETED"
      return { runId: this.currentPlan.id }
    }

    // Clean cloned uncompleted tasks to prevent previous run status contamination
    const tasks = uncompletedTasks.map((task: any) => ({
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

    await this.manifest.recoverStaleTasks()
    await this.manifest.writeTaskManifest(tasks, this.currentPlan.id)
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
        } else if (event.type === "task.started") {
          const pt = this.currentPlan?.tasks?.find((x: any) => x.id === event.taskId)
          if (pt) pt.status = "running"
        } else if (event.type === "task.cancelled") {
          // engine 取消任务发 task.cancelled；此前缺失该分支，取消后任务卡在 running
          const pt = this.currentPlan?.tasks?.find((x: any) => x.id === event.taskId)
          if (pt) pt.status = "cancelled"
        } else if (event.type === "task.skipped") {
          const pt = this.currentPlan?.tasks?.find((x: any) => x.id === event.taskId)
          if (pt) pt.status = "skipped"
        } else if (event.type === "task.done") {
          // 失败任务同样走 task.done，靠 failed 标记区分（engine 无 task.failed 事件）
          const pt = this.currentPlan?.tasks?.find((x: any) => x.id === event.taskId)
          if (pt) {
            pt.status = event.failed === true ? "failed" : "success"
            if (event.failed === true) {
              pt.ffmpegFailed = true
              pt.ffmpegError = (event.result as any)?.error || pt.ffmpegError
            }
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
          concurrency: this.plannedConcurrency,
          onSummary: async (summary: Record<string, unknown>) => {
            // engine 通过 safeCallAsync 调用 onSummary 并吞掉异常，
            // 这里必须自己兜底，否则状态会永久停在 RUNNING 并把后续操作全部锁死。
            try {
              stopPreventSuspension()
              const isCancelled = !!summary.isCancelled
              // summary.failed 是数字计数，不是数组（此前 Array.isArray 判断恒为 false）
              const failedCount = typeof summary.failed === "number" ? summary.failed : 0
              if (failedCount > 0) {
                setTaskbarProgressError()
              } else {
                updateTaskbarProgress(isCancelled ? -1 : 1)
              }

              let deletionStats = { deleted: 0, kept: 0, failed: 0 }
              try {
                const deletion = await (deleteCompletedSources as any)({
                  plan: executionPlan,
                  confirmDeleteSource: executionPlan.argv?.deleteSourceConfirmed === true,
                })
                deletionStats = {
                  deleted: deletion.deleted.length,
                  kept: deletion.kept.length,
                  failed: deletion.failed.length,
                }
              } catch (deletionError) {
                this.eventSink?.({
                  type: "task.log",
                  level: "ERROR",
                  message: `源文件清理失败: ${deletionError instanceof Error ? deletionError.message : String(deletionError)}`,
                  timestamp: new Date().toLocaleTimeString(),
                })
              }

              this.summary = { ...summary, deletion: deletionStats }

              const allFinished = this.currentPlan?.tasks?.every(
                (t: any) => t.status === "success" || t.status === "skipped"
              )
              if (isCancelled) {
                this.status = "STOPPED"
              } else if (failedCount > 0) {
                this.status = "FAILED"
              } else {
                this.status = allFinished ? "COMPLETED" : "STOPPED"
              }
            } catch (summaryError) {
              this.status = "FAILED"
              this.summary = {
                ...summary,
                error: summaryError instanceof Error ? summaryError.message : String(summaryError),
              }
            }
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
        await this.manifest.clearTaskManifest()
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

  dispose() {
    this.abortController?.abort()
    stopPreventSuspension()
    updateTaskbarProgress(-1)
    this.killTrackedProcessesSync()
    void this.manifest.clearTaskManifest()
    this.eventSink = null
  }
}

/** 主进程 IPC 统一入口；ffmpegEnvironment 为历史兼容名 */
export const transcodeService = new DesktopTranscodeService()
export const ffmpegEnvironment = transcodeService
