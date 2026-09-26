import os from "node:os"
import { existsSync } from "node:fs"
import path from "node:path"
import { execa } from "execa"
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
 * detectHardwareCapabilities 的返回形状。
 * JS 侧没有导出的类型，这里只声明桌面端**实际消费**的字段（其余走索引签名）。
 */
type HardwareCapabilities = {
  version?: string
  vendor?: string
  encoders?: Set<string> | string[]
  hwaccels?: string[]
  gpus?: Array<{ vendor?: string; model?: string; name?: string; generation?: number }>
  [key: string]: unknown
}

/**
 * ffmpeg/ffprobe 定位与缓存、bundled/preset 资源候选、硬件能力探测与
 * EnvironmentSummary 构造。依赖经 constructor 注入，不直接 import electron。
 */
export class FfmpegEnvironment {
  private ffmpegPath: string | null = null
  private ffprobePath: string | null = null
  private customFfmpegPath: string | null = null
  private customFfprobePath: string | null = null
  /** 用户显式指定的 mediainfo（ffprobe 失败时的兜底探测工具）；null = 用 PATH 中的 mediainfo */
  private customMediainfoPath: string | null = null
  /** ffprobe 版本标识（首行 `ffprobe version <x>`），只探测一次 */
  private ffprobeVersion: string | null = null
  private hardware: HardwareCapabilities | null = null
  private readonly getAppPath: () => string

  constructor(deps: FfmpegEnvironmentDeps) {
    this.getAppPath = deps.getAppPath
  }

  /** 已解析到的 ffprobe 路径（未解析时为 null），供 staging/plan 探针使用 */
  get resolvedFfprobePath(): string | null {
    return this.ffprobePath
  }

  /**
   * 用户显式指定的 mediainfo 路径（未指定时为 null）。
   * 供媒体探测作为 ffprobe 失败后的兜底工具使用 —— 此前该设置只被渲染层收集和持久化，
   * 主进程完全不消费，是纯粹的「死控件」。
   */
  get resolvedMediainfoPath(): string | null {
    return this.customMediainfoPath
  }

  /** 已解析到的 ffmpeg 路径（未解析时为 null），供「关于」等只读展示使用 */
  getFfmpegPath(): string | null {
    return this.ffmpegPath
  }

  async setCustomToolPaths(paths: {
    ffmpeg?: string
    ffprobe?: string
    mediainfo?: string
  }): Promise<EnvironmentSummary> {
    const rawFfmpeg = typeof paths?.ffmpeg === "string" ? paths.ffmpeg.trim() : ""
    const rawFfprobe = typeof paths?.ffprobe === "string" ? paths.ffprobe.trim() : ""
    const rawMediainfo = typeof paths?.mediainfo === "string" ? paths.mediainfo.trim() : ""

    let changed = false

    if (rawFfmpeg) {
      if (existsSync(rawFfmpeg)) {
        this.customFfmpegPath = rawFfmpeg
        this.ffmpegPath = rawFfmpeg
        setFFmpegPath(rawFfmpeg)
        this.hardware = null
        changed = true
      }
    } else if (this.customFfmpegPath) {
      this.customFfmpegPath = null
      this.ffmpegPath = null
      this.hardware = null
      changed = true
    }

    if (rawFfprobe) {
      if (existsSync(rawFfprobe)) {
        this.customFfprobePath = rawFfprobe
        this.ffprobePath = rawFfprobe
        // 换了二进制就要重新读版本，否则面板会显示旧版本
        this.ffprobeVersion = null
        changed = true
      }
    } else if (this.customFfprobePath) {
      this.customFfprobePath = null
      this.ffprobePath = null
      this.ffprobeVersion = null
      changed = true
    }

    // mediainfo 只作 ffprobe 失败后的兜底探测，不参与能力探测，故不置 changed
    if (rawMediainfo) {
      if (existsSync(rawMediainfo)) {
        this.customMediainfoPath = rawMediainfo
      }
    } else if (this.customMediainfoPath) {
      this.customMediainfoPath = null
    }

    if (changed || !this.ffmpegPath) {
      await this.ensureFfmpegPath()
    }
    return this.getSummary()
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
    const tiers: Array<{ name?: string }> = Array.isArray(TIERS) ? TIERS : []
    const cpuTier = tiers.find((tier) => tier?.name === "cpu")
    return { tier: cpuTier || { name: "cpu" }, caps: this.hardware }
  }

  /**
   * 读取 ffprobe 版本标识（首行 `ffprobe version <x> Copyright ...`）。
   * 只探测一次并缓存；失败返回 null —— 版本仅用于「关于」面板展示，不应影响任何能力。
   */
  private async resolveFfprobeVersion(): Promise<string | null> {
    if (this.ffprobeVersion) return this.ffprobeVersion
    if (!this.ffprobePath) return null
    try {
      const res = await execa(this.ffprobePath, ["-hide_banner", "-version"], {
        reject: false,
        timeout: 5000,
      })
      const matched = String(res.stdout || "").match(/^ffprobe version\s+(\S[^\r\n]*?)\s+Copyright/i)
      this.ffprobeVersion = matched ? matched[1].trim() : null
    } catch {
      this.ffprobeVersion = null
    }
    return this.ffprobeVersion
  }

  /** 兜底解析 ffmpeg（执行前置），未找到返回 null */
  async ensureFfmpegPath(): Promise<string | null> {
    if (this.customFfmpegPath && existsSync(this.customFfmpegPath)) {
      this.ffmpegPath = this.customFfmpegPath
      setFFmpegPath(this.ffmpegPath)
      return this.ffmpegPath
    }
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary({ extraCandidates: this.bundledFfmpegCandidates() })
      if (this.ffmpegPath) setFFmpegPath(this.ffmpegPath)
    }
    return this.ffmpegPath
  }

  /** 确保 ffmpeg/ffprobe 已定位并完成能力探测与预设加载，返回 EnvironmentSummary */
  async getSummary(): Promise<EnvironmentSummary> {
    await this.ensureFfmpegPath()
    if (this.customFfprobePath && existsSync(this.customFfprobePath)) {
      this.ffprobePath = this.customFfprobePath
    } else if (!this.ffprobePath) {
      this.ffprobePath = await resolveFFprobeBinary(this.ffmpegPath || undefined)
    }
    const presetPath = this.resolvePresetPath()
    if (!presetPath) throw new Error("Bundled FFmpeg preset file was not found")
    await presets.initPresetsAsync(presetPath)
    if (this.ffmpegPath && !this.hardware) {
      // detectHardwareCapabilities 的 JSDoc 只声明 `Promise<object>`，按其文档形状断言
      this.hardware = (await detectHardwareCapabilities({
        ffmpegPath: this.ffmpegPath,
      })) as HardwareCapabilities
    }
    const ffprobeVersion = await this.resolveFfprobeVersion()

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
      // ffmpeg 版本来自能力探测（同一进程内缓存），ffprobe 版本单独探测一次
      ffmpegVersion: this.hardware?.version || null,
      ffprobeVersion,
      mediainfoPath: this.customMediainfoPath,
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
        gpus: (this.hardware?.gpus || []).map((g) => ({
          vendor: g.vendor || "Unknown",
          model: g.model || g.name || "Unknown GPU",
          // 契约里 generation 是字符串；gpu.js 侧是数字代次（如 40），此处归一化
          generation: g.generation === undefined ? undefined : String(g.generation),
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
