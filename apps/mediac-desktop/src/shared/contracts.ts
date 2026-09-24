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

export interface SelectFileResult {
  paths: string[]
}

export interface DesktopApi {
  getPathForFile(file: File): string
  selectFiles(options: SelectFileOptions): Promise<SelectFileResult>
  getAppVersion(): Promise<string>
  getEnvironment(): Promise<EnvironmentSummary>
}
