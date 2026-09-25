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

export interface DesktopApi {
  getPathForFile(file: File): string
  selectFiles(options: SelectFileOptions): Promise<SelectFileResult>
  stageInputs(paths: string[]): Promise<StageInputsResult>
  getAppVersion(): Promise<string>
  getEnvironment(): Promise<EnvironmentSummary>
  createPlan(body: Record<string, unknown>): Promise<PublicPlanSnapshot>
  startExecution(taskIds?: string[]): Promise<{ runId: string }>
  stopExecution(): Promise<{ ok: boolean; message?: string }>
  onEngineEvent(callback: (event: Record<string, unknown>) => void): () => void
  showInFolder(fullPath: string): Promise<void>
  openPath(fullPath: string): Promise<string>
  copyText(text: string): Promise<boolean>
  notify(title: string, body: string): Promise<void>
  onMenuAction(callback: (action: string) => void): () => void
}
