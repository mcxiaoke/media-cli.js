declare module "mediac/lib/ffmpeg_bin.js" {
  export function resolveFFmpegBinary(): Promise<string | null>
}

declare module "mediac/lib/ffmpeg_run.js" {
  export function setFFmpegPath(path: string | null): void
}

declare module "mediac/lib/ffmpeg_presets.js" {
  const presets: {
    initPresetsAsync(customPath?: string | null): Promise<void>
    getAllNames(): string[]
    getPreset(name: string): any
    getAllPresets(): Map<string, any>
  }
  export default presets
}

declare module "mediac/lib/hwdetect.js" {
  export function detectHardwareCapabilities(options?: {
    ffmpegPath?: string | null
  }): Promise<any>
}

declare module "mediac/lib/ffmpeg_options.js" {
  export function normalizeWebOptions(body?: any): any
  export function toLegacyArgvOptions(options?: any): Record<string, any>
}

declare module "mediac/lib/ffmpeg_scan.js" {
  export function collectInputFiles(inputs?: string[], deps?: any): Promise<any[]>
}

declare module "mediac/lib/ffmpeg_task.js" {
  export function buildTask(input: any, options: any): Promise<any | null>
}

declare module "mediac/lib/ffmpeg_plan_snapshot.js" {
  export function createInternalExecutionPlan(options?: any): any
  export function createPublicPlanSnapshot(plan?: any): any
}

declare module "mediac/lib/ffmpeg_engine.js" {
  export function createFFmpegEngine(options: any): {
    execute(plan: any, options?: any): Promise<any>
  }
}
