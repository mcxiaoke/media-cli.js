export type RunnerState =
  | "IDLE"
  | "PLANNING"
  | "READY"
  | "RUNNING"
  | "STOPPING"
  | "STOPPED"
  | "COMPLETED"
  | "FAILED"

export type TaskStatus =
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
    gpus: unknown[]
    encoders: string[]
    hwaccels: string[]
  }
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
  tasks: Array<{
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
  }>
}

export interface SelectFileResult {
  paths: string[]
}

export interface DesktopApi {
  getPathForFile(file: File): string
  selectFiles(options: SelectFileOptions): Promise<SelectFileResult>
  getAppVersion(): Promise<string>
  getEnvironment(): Promise<EnvironmentSummary>
  createPlan(body: Record<string, unknown>): Promise<PublicPlanSnapshot>
  startExecution(taskIds?: string[]): Promise<{ runId: string }>
  stopExecution(): Promise<{ ok: boolean; message?: string }>
  getTaskSnapshot(): Promise<Record<string, unknown>>
  onEngineEvent(callback: (event: Record<string, unknown>) => void): () => void
}
