import { app } from "electron"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  collectInputFiles,
  createFFmpegArgs,
  createFFmpegEngine,
  createPublicPlanSnapshot,
  createPublicTaskSnapshot,
  deleteCompletedSources,
  detectHardwareCapabilities,
  getMediaInfo,
  normalizeDesktopOptions,
  presets,
  prepareFFmpegPlan,
  resolveFFmpegBinary,
  resolveFFprobeBinary,
  runFFmpeg,
  scanDesktopInputFiles,
  setFFmpegPath,
  TIERS,
  toLegacyArgvOptions,
} from "../../../../src/transcode/index.js"
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

class FfmpegEnvironmentService {
  private ffmpegPath: string | null = null
  private ffprobePath: string | null = null
  private hardware: any = null
  private currentPlan: any = null
  private stagedEntries = new Map<string, { item: any; task: PlanTask; info: any }>()
  private status: RunnerState = "IDLE"
  /** 计划阶段解析出的并发数，执行阶段必须沿用，否则用户设置的 jobs 形同虚设 */
  private plannedConcurrency: number = DEFAULT_CONCURRENCY
  private abortController: AbortController | null = null
  private eventSink: ((event: Record<string, unknown>) => void) | null = null
  private summary: Record<string, unknown> | null = null
  private activePids = new Set<number>()

  private get manifestPath() {
    return path.join(app.getPath("userData"), "active-tasks.json")
  }

  /** 经原生对话框由用户亲手选过的路径（文件/目录），持久化到 userData，跨会话有效 */
  private authorizedRoots = new Set<string>()
  private static readonly AUTHORIZED_PATHS_FILE = "authorized-paths.json"

  private get authorizedPathsFile() {
    return path.join(app.getPath("userData"), FfmpegEnvironmentService.AUTHORIZED_PATHS_FILE)
  }

  private normalizeForCompare(p: string) {
    const resolved = path.resolve(p)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }

  /** 登记用户通过原生对话框明确选择的路径（来源不可被渲染层伪造） */
  authorizePaths(paths: unknown) {
    if (!Array.isArray(paths)) return
    let changed = false
    for (const p of paths) {
      if (typeof p !== "string" || !p || !path.isAbsolute(p)) continue
      const key = this.normalizeForCompare(p)
      if (this.authorizedRoots.has(key)) continue
      this.authorizedRoots.add(key)
      changed = true
    }
    if (changed) {
      const tmp = `${this.authorizedPathsFile}.tmp`
      writeFile(tmp, JSON.stringify([...this.authorizedRoots], null, 2), "utf8")
        .then(() => rename(tmp, this.authorizedPathsFile))
        .catch(() => {
          // 授权持久化失败不阻塞主流程，本次会话内仍然有效
        })
    }
  }

  private async loadAuthorizedPaths() {
    try {
      const raw = await readFile(this.authorizedPathsFile, "utf8")
      const list = JSON.parse(raw)
      if (Array.isArray(list)) this.authorizePaths(list)
    } catch {
      // 文件不存在或损坏时静默忽略，等价于无历史授权
    }
  }

  /**
   * S-1 加固：SYSTEM_OPEN_PATH / SYSTEM_SHOW_IN_FOLDER 只接受已知路径——
   * ① staged 输入与当前计划任务的源/产物；
   * ② 上述已知文件的直接父目录（「打开输出目录」传的是 dirname(fileDst)）；
   * ③ 原生对话框授权根自身或其子路径。
   * 渲染层即使被攻破，也无法让主进程打开任意外部路径。
   */
  isKnownMediaPath(fullPath: unknown): boolean {
    if (typeof fullPath !== "string" || !fullPath || !path.isAbsolute(fullPath)) return false
    const target = this.normalizeForCompare(fullPath)

    const knownFiles = new Set<string>()
    for (const key of this.stagedEntries.keys()) knownFiles.add(this.normalizeForCompare(key))
    for (const t of this.currentPlan?.tasks ?? []) {
      if (t?.path) knownFiles.add(this.normalizeForCompare(t.path))
      if (t?.fileDst) knownFiles.add(this.normalizeForCompare(t.fileDst))
    }
    if (knownFiles.has(target)) return true
    for (const f of knownFiles) {
      if (this.normalizeForCompare(path.dirname(f)) === target) return true
    }
    for (const root of this.authorizedRoots) {
      if (target === root || target.startsWith(root + path.sep)) return true
    }
    return false
  }

  setEventSink(sink: ((event: Record<string, unknown>) => void) | null) {
    this.eventSink = sink
  }

  async initialize() {
    await Promise.all([this.recoverStaleTasks(), this.loadAuthorizedPaths()])
  }

  private async recoverStaleTasks() {
    try {
      const raw = await readFile(this.manifestPath, "utf8")
      const entries = JSON.parse(raw) as Array<{ tempPath?: string; outputPath?: string }>
      for (const entry of entries) {
        if (!this.isManagedTempEntry(entry)) continue
        await rm(entry.tempPath as string, { force: true })
      }
      await rm(this.manifestPath, { force: true })
    } catch {
      // Do not block app startup on an unreadable manifest.
    }
  }

  /** 将用户/配置传入的 jobs 规范化到 [1, MAX_CONCURRENCY] */
  private resolveConcurrency(jobs: unknown): number {
    const value = Number(jobs)
    if (!Number.isFinite(value) || value < 1) return DEFAULT_CONCURRENCY
    return Math.min(MAX_CONCURRENCY, Math.floor(value))
  }

  /**
   * Manifest 临时产物可信性校验（S-2 加固）。
   *
   * 临时产物由 src/transcode/ffmpeg_task.js 生成在**最终产物同目录**（并无统一 temp 根目录），
   * 因此可强校验的结构约束是：tempPath 与 outputPath 同目录、同扩展名，
   * 且文件名严格形如 `xxx_tmp@<hash>@tmp_.ext`（hash 为 xxHash32 十进制/十六进制数字）。
   * 任一条件不满足即视为不可信、跳过删除——宁残留垃圾文件，勿误删用户文件。
   */
  private isManagedTempEntry(entry: { tempPath?: string; outputPath?: string }) {
    const { tempPath, outputPath } = entry
    if (!tempPath || !outputPath) return false
    if (!path.isAbsolute(tempPath) || !path.isAbsolute(outputPath)) return false
    if (path.extname(tempPath) !== path.extname(outputPath)) return false
    const sameDir = (a: string, b: string) => {
      const da = path.dirname(a)
      const db = path.dirname(b)
      return process.platform === "win32" ? da.toLowerCase() === db.toLowerCase() : da === db
    }
    if (!sameDir(tempPath, outputPath)) return false
    return /^.+_tmp@[a-f0-9]+@tmp_(\.[^.]+)?$/.test(path.basename(tempPath))
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

  /**
   * 打包后的 ffmpeg 候选位置（electron-builder extraResources / resources）。
   * 与预设文件的 resourcesPath 回退对称，避免「预设能找到、ffmpeg 找不到」。
   */
  private bundledFfmpegCandidates(): string[] {
    const binary = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    const roots = [process.resourcesPath, path.join(app.getAppPath(), "resources")].filter(
      (root): root is string => typeof root === "string" && root.length > 0,
    )
    return roots.flatMap((root) => [
      path.join(root, "ffmpeg", "bin", binary),
      path.join(root, "ffmpeg", binary),
      path.join(root, "bin", binary),
    ])
  }

  /** 已解析到的 ffmpeg 路径（未解析时为 null），供「关于」等只读展示使用 */
  getFfmpegPath(): string | null {
    return this.ffmpegPath
  }

  /**
   * 计划阶段的示意硬件分层。
   * 任务真正的 hwPlan 要到执行期才由 runFFmpegCmd 注入，计划期传 null 会让
   * createFFmpegArgs 直接返回空参数（无 -c:v、无缩放），预览命令与实际执行严重不符。
   * 这里用 CPU 分层 + 本机已探测能力构造一份示意计划，保证预览至少含编码器与缩放段。
   */
  private buildPreviewHwPlan() {
    const cpuTier = Array.isArray(TIERS)
      ? (TIERS as any[]).find((tier: any) => tier?.name === "cpu")
      : null
    return { tier: cpuTier || { name: "cpu" }, caps: this.hardware }
  }

  async getSummary(): Promise<EnvironmentSummary> {
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary({ extraCandidates: this.bundledFfmpegCandidates() })
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

  async stageInputs(paths: string[]): Promise<StageInputsResult> {
    if (!paths || paths.length === 0) {
      return { added: [], skippedDuplicates: 0, totalCount: this.stagedEntries.size }
    }
    await this.getSummary()

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
            ...(this.ffprobePath ? { ffprobePath: this.ffprobePath } : {}),
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
      await this.getSummary()
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
              ...(this.ffprobePath ? { ffprobePath: this.ffprobePath } : {}),
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
          const buildResult = createFFmpegArgs(firstTask, this.buildPreviewHwPlan())
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
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary({ extraCandidates: this.bundledFfmpegCandidates() })
    }
    if (!this.ffmpegPath) {
      throw new Error(
        "未找到可用的 ffmpeg 可执行文件。请安装 ffmpeg 后重启应用，或在环境变量 FFMPEG_PATH 中指定其绝对路径。",
      )
    }
    setFFmpegPath(this.ffmpegPath)
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
      (task: any) => task.status !== "success" && task.status !== "done" && task.status !== "skipped"
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
                (t: any) => t.status === "success" || t.status === "done" || t.status === "skipped"
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
