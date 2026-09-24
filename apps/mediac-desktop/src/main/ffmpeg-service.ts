import { resolveFFmpegBinary } from "mediac/lib/ffmpeg_bin.js"
import presets from "mediac/lib/ffmpeg_presets.js"
import { setFFmpegPath } from "mediac/lib/ffmpeg_run.js"
import { detectHardwareCapabilities } from "mediac/lib/hwdetect.js"
import type { EnvironmentSummary } from "../shared/contracts"

class FfmpegEnvironmentService {
  private ffmpegPath: string | null = null
  private hardware: any = null

  async getSummary(): Promise<EnvironmentSummary> {
    if (!this.ffmpegPath) {
      this.ffmpegPath = await resolveFFmpegBinary()
      if (this.ffmpegPath) setFFmpegPath(this.ffmpegPath)
    }
    await presets.initPresetsAsync()
    if (this.ffmpegPath && !this.hardware) {
      this.hardware = await detectHardwareCapabilities({ ffmpegPath: this.ffmpegPath })
    }

    return {
      ffmpegPath: this.ffmpegPath,
      presets: presets.getAllNames().map((name) => {
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
        gpus: this.hardware?.gpus || [],
        encoders: Array.from(this.hardware?.encoders || []),
        hwaccels: Array.from(this.hardware?.hwaccels || []),
      },
    }
  }
}

export const ffmpegEnvironment = new FfmpegEnvironmentService()
