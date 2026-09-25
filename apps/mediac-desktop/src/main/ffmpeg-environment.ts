import os from "node:os"
import { existsSync } from "node:fs"
import path from "node:path"
import {
  detectHardwareCapabilities,
  presets,
  resolveFFmpegBinary,
  resolveFFprobeBinary,
  setFFmpegPath,
  TIERS,
} from "../../../../src/transcode/index.js"
import type { EnvironmentSummary } from "../shared/contracts.js"

export interface FfmpegEnvironmentDeps {
  /** 注入 Electron app 的应用路径（打包/开发两种布局的候选回退需要） */
  getAppPath: () => string
}

/**
 * ffmpeg/ffprobe 定位与缓存、bundled/preset 资源候选、硬件能力探测与
 * EnvironmentSummary 构造。依赖经 constructor 注入，不直接 import electron。
 */
export class FfmpegEnvironment {
  private ffmpegPath: string | null = null
  private ffprobePath: string | null = null
  private hardware: any = null
  private readonly getAppPath: () => string

  constructor(deps: FfmpegEnvironmentDeps) {
    this.getAppPath = deps.getAppPath
  }

  /** 已解析到的 ffprobe 路径（未解析时为 null），供 staging/plan 探针使用 */
  get resolvedFfprobePath(): string | null {
    return this.ffprobePath
  }

  /** 已解析到的 ffmpeg 路径（未解析时为 null），供「关于」等只读展示使用 */
  getFfmpegPath(): string | null {
    return this.ffmpegPath
  }

  private resolvePresetPath() {
    const candidates = [
      path.join(process.resourcesPath, "presets", "default.yaml"),
      path.join(this.getAppPath(), "out", "presets", "default.yaml"),
      path.join(this.getAppPath(), "presets", "default.yaml"),
      path.join(this.getAppPath(), "..", "presets", "default.yaml"),
      path.join(this.getAppPath(), "..", "..", "presets", "default.yaml"),
      path.join(this.getAppPath(), "..", "..", "..", "..", "presets", "default.yaml"),
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
    const roots = [process.resourcesPath, path.join(this.getAppPath(), "resources")].filter(
      (root): root is string => typeof root === "string" && root.length > 0,
    )
    return roots.flatMap((root) => [
      path.join(root, "ffmpeg", "bin", binary),
      path.join(root, "ffmpeg", binary),
      path.join(root, "bin", binary),
    ])
  }

  /**
   * 计划阶段的示意硬件分层。
   * 任务真正的 hwPlan 要到执行期才由 runFFmpegCmd 注入，计划期传 null 会让
   * createFFmpegArgs 直接返回空参数（无 -c:v、无缩放），预览命令与实际执行严重不符。
   * 这里用 CPU 分层 + 本机已探测能力构造一份示意计划，保证预览至少含编码器与缩放段。
   */
  buildPreviewHwPlan() {
    const cpuTier = Array.isArray(TIERS)
      ? (TIERS as any[]).find((tier: any) => tier?.name === "cpu")
      : null
    return { tier: cpuTier || { name: "cpu" }, caps: this.hardware }
  }

  /** 兜底解析 ffmpeg（执行前置），未找到返回 null */
  async ensureFfmpegPath(): Promise<string | null> {
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary({ extraCandidates: this.bundledFfmpegCandidates() })
      if (this.ffmpegPath) setFFmpegPath(this.ffmpegPath)
    }
    return this.ffmpegPath
  }

  /** 确保 ffmpeg/ffprobe 已定位并完成能力探测与预设加载，返回 EnvironmentSummary */
  async getSummary(): Promise<EnvironmentSummary> {
    await this.ensureFfmpegPath()
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
}
