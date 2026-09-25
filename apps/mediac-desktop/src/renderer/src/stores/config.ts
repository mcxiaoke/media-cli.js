import { defineStore } from "pinia"
import { ref, computed } from "vue"

export interface TuneConfig {
  dimension: number
  quality: number
  bitrate: string
  fps: number
  speed: number
  audioCodec: string
  audioBitrate: string
}

export interface AdvConfig {
  hwaccel: string
  decodeMode: string
  jobs: number
  override: boolean
  anime: boolean
  strict: boolean
  deleteSource: boolean
}

export const useConfigStore = defineStore("config", () => {
  const inputs = ref<string[]>([])
  const outputDir = ref("")
  const outputBesideSource = ref(!outputDir.value)
  const savedCustomOutputDir = ref(outputDir.value || "")
  const outputMode = ref<"tree" | "dir" | "file">("dir")
  const prefix = ref("")
  const suffix = ref("")
  const preset = ref("hevc_2k")

  function setOutputBesideSource(val: boolean) {
    outputBesideSource.value = val
    if (val) {
      if (outputDir.value) {
        savedCustomOutputDir.value = outputDir.value
      }
      outputDir.value = ""
    } else {
      outputDir.value = savedCustomOutputDir.value || ""
    }
  }

  function setCustomOutputDir(dir: string) {
    savedCustomOutputDir.value = dir
    outputDir.value = dir
    outputBesideSource.value = !dir
  }

  const tune = ref<TuneConfig>({
    dimension: 0,
    quality: 0,
    bitrate: "",
    fps: 0,
    speed: 0,
    audioCodec: "",
    audioBitrate: "",
  })

  const adv = ref<AdvConfig>({
    hwaccel: "auto",
    decodeMode: "auto",
    jobs: 1,
    override: false,
    anime: false,
    strict: false,
    deleteSource: false,
  })

  // Dirty indicators for video/audio tune
  const isDimensionDirty = computed(() => tune.value.dimension !== 0)
  const isQualityDirty = computed(() => tune.value.quality !== 0)
  const isBitrateDirty = computed(() => tune.value.bitrate !== "")
  const isFpsDirty = computed(() => tune.value.fps !== 0)
  const isSpeedDirty = computed(() => tune.value.speed !== 0)
  const isAudioCodecDirty = computed(() => tune.value.audioCodec !== "")
  const isAudioBitrateDirty = computed(() => tune.value.audioBitrate !== "")

  const videoDirtyCount = computed(() => {
    return (
      (isDimensionDirty.value ? 1 : 0) +
      (isQualityDirty.value ? 1 : 0) +
      (isBitrateDirty.value ? 1 : 0) +
      (isFpsDirty.value ? 1 : 0) +
      (isSpeedDirty.value ? 1 : 0)
    )
  })

  const audioDirtyCount = computed(() => {
    return (
      (isAudioCodecDirty.value ? 1 : 0) +
      (isAudioBitrateDirty.value ? 1 : 0)
    )
  })

  function resetParam(key: keyof TuneConfig) {
    if (key === "dimension" || key === "quality" || key === "fps" || key === "speed") {
      tune.value[key] = 0
    } else {
      tune.value[key] = ""
    }
  }

  function resetVideoTune() {
    tune.value.dimension = 0
    tune.value.quality = 0
    tune.value.bitrate = ""
    tune.value.fps = 0
    tune.value.speed = 0
  }

  function resetAudioTune() {
    tune.value.audioCodec = ""
    tune.value.audioBitrate = ""
  }

  function addInputs(paths: string[]) {
    const set = new Set([...inputs.value, ...paths.filter(Boolean)])
    inputs.value = Array.from(set)
  }

  function removeInput(index: number) {
    inputs.value.splice(index, 1)
  }

  function removeInputs(paths: string[]) {
    if (!paths || paths.length === 0) return
    const toRemove = new Set(paths)
    inputs.value = inputs.value.filter((p) => !toRemove.has(p))
  }

  function clearInputs() {
    inputs.value = []
  }

  return {
    inputs,
    outputDir,
    outputBesideSource,
    savedCustomOutputDir,
    setOutputBesideSource,
    setCustomOutputDir,
    outputMode,
    prefix,
    suffix,
    preset,
    tune,
    adv,
    isDimensionDirty,
    isQualityDirty,
    isBitrateDirty,
    isFpsDirty,
    isSpeedDirty,
    isAudioCodecDirty,
    isAudioBitrateDirty,
    videoDirtyCount,
    audioDirtyCount,
    resetParam,
    resetVideoTune,
    resetAudioTune,
    addInputs,
    removeInput,
    removeInputs,
    clearInputs,
  }
})
