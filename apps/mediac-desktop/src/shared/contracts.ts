export type RunnerState =
  | "IDLE"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED"
  | "STALE"

export type TaskStatus =
  | "staged"
  | "pending"
  | "preparing"
  | "running"
  | "retrying"
  | "success"
  | "failed"
  | "skipped"
  | "cancelled"

export interface SelectFileOptions {
  mode: "file" | "directory"
  multiple?: boolean
}

export interface EnvironmentSummary {
  ffmpegPath: string | null
  ffprobePath: string | null
  /** ffmpeg 版本标识（`ffmpeg -version` 首行的 version 段），未探测到时为 null */
  ffmpegVersion?: string | null
  /** ffprobe 版本标识（`ffprobe -version` 首行的 version 段），未探测到时为 null */
  ffprobeVersion?: string | null
  /** 用户显式指定的 mediainfo（ffprobe 失败时的兜底探测工具）；null = 使用 PATH 中的 mediainfo */
  mediainfoPath?: string | null
  presets: Array<{
    name: string
    type: string
    format: string
    videoCodecFamily: string
    audioCodec: string
    videoQuality: number
    videoBitrate: number
    audioBitrate: number
    dimension: number
  }>
  hardware: {
    gpus: Array<{ vendor: string; model: string; generation?: string }>
    encoders: string[]
    hwaccels: string[]
    tier: "nvidia" | "intel" | "amd" | "cpu"
  }
  system?: {
    cpuModel: string
    cpuCores: number
    totalMemGb: number
    freeMemGb: number
  }
}

export interface MediaInfoPayload {
  provider?: string
  format?: string
  size?: number
  duration?: number
  bitrate?: number
  createdAt?: string
  video?: {
    type?: string
    format?: string
    codec?: string
    profile?: string
    level?: number | string
    width?: number
    height?: number
    aspectRatio?: string
    framerate?: number
    pixelFormat?: string
    bitDepth?: number
    bitrate?: number
    size?: number
    duration?: number
    tags?: Record<string, string>
    [key: string]: unknown
  }
  audio?: {
    type?: string
    format?: string
    codec?: string
    profile?: string
    bitrate?: number
    sampleRate?: number
    channels?: number
    language?: string
    tags?: Record<string, string>
    [key: string]: unknown
  }
  subtitles?: Array<Record<string, unknown>>
  raw?: unknown
  [key: string]: unknown
}

/**
 * 引擎事件（createFFmpegEngine 的 emit payload），经 IPC `execution:event` 送到渲染层。
 *
 * 用 type 别名而非 interface：别名带隐式索引签名，可直接赋给 `Record<string, unknown>`
 * （主进程的 eventSink 参数类型），interface 则不行。
 */
export type EngineEvent = {
  type?: string
  taskId?: string
  taskIndex?: number
  level?: string
  message?: string
  timestamp?: string
  percent?: number
  speed?: number | string
  reason?: string
  failed?: boolean
  result?: { status?: string; error?: string | null; outputPath?: string | null }
  summary?: {
    total?: number
    success?: number
    failed?: number
    skipped?: number
    cancelled?: number
    retryCount?: number
    isCancelled?: boolean
    elapsedMs?: number
  }
}

export interface MediaTargetSummary {
  container?: string
  videoEncoder?: string
  width?: number
  height?: number
  fps?: number
  quality?: number
  bitrate?: number
  audioCodec?: string
  audioBitrate?: number
}

export interface PlanTask {
  id: string
  index: number
  name: string
  path: string
  size: number
  duration: number
  fileDst: string
  status: TaskStatus
  error: string | null
  skipReason: string | null
  progress?: number
  speed?: number
  mediaInfo?: MediaInfoPayload
  videoCodec?: string
  audioCodec?: string
  width?: number
  height?: number
  fps?: number
  bitrate?: number
  srcSize?: number
  srcDuration?: number
  containerFormat?: string
  cmdPreview?: string
  bitDepth?: number
  pixelFormat?: string
  profile?: string
  level?: string
  aspectRatio?: string
  audioChannels?: number
  audioSampleRate?: number
  audioBitrate?: number
  rawMetadata?: string
  targetSummary?: MediaTargetSummary
}

export interface StageInputsResult {
  added: PlanTask[]
  skippedDuplicates: number
  totalCount: number
}

export interface PublicPlanSnapshot {
  schemaVersion: number
  id: string | null
  presetName: string
  mode: string
  totalTasks: number
  totalDuration: number
  totalSize: number
  previewCmd: string
  tasks: Array<PlanTask>
}

export interface SelectFileResult {
  paths: string[]
}

export interface CustomToolPaths {
  ffmpeg?: string
  ffprobe?: string
  mediainfo?: string
}

export interface DesktopApi {
  getPathForFile(file: File): string
  selectFiles(options: SelectFileOptions): Promise<SelectFileResult>
  stageInputs(paths: string[]): Promise<StageInputsResult>
  clearStagedInputs(): Promise<{ ok: boolean }>
  removeStagedInputs(paths: string[]): Promise<{ removed: number; totalCount: number }>
  getAppVersion(): Promise<string>
  getEnvironment(): Promise<EnvironmentSummary>
  setCustomToolPaths(paths: CustomToolPaths): Promise<EnvironmentSummary>
  createPlan(body: Record<string, unknown>): Promise<PublicPlanSnapshot>
  startExecution(taskIds?: string[]): Promise<{ runId: string }>
  stopExecution(): Promise<{ ok: boolean; message?: string }>
  onEngineEvent(callback: (event: EngineEvent) => void): () => void
  showInFolder(fullPath: string): Promise<void>
  openPath(fullPath: string): Promise<string>
  copyText(text: string): Promise<boolean>
  notify(title: string, body: string): Promise<void>
  onMenuAction(callback: (action: string) => void): () => void
}
