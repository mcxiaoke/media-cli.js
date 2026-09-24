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
  | "done"
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
  videoCodec?: string
  width?: number
  height?: number
  fps?: number
  srcSize?: number
  srcDuration?: number
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
  getAppVersion(): Promise<string>
  getEnvironment(): Promise<EnvironmentSummary>
  createPlan(body: Record<string, unknown>): Promise<PublicPlanSnapshot>
  startExecution(taskIds?: string[]): Promise<{ runId: string }>
  stopExecution(): Promise<{ ok: boolean; message?: string }>
  getTaskSnapshot(): Promise<Record<string, unknown>>
  onEngineEvent(callback: (event: Record<string, unknown>) => void): () => void
  showInFolder(fullPath: string): Promise<void>
  openPath(fullPath: string): Promise<string>
  notify(title: string, body: string): Promise<void>
  onMenuAction(callback: (action: string) => void): () => void
}
