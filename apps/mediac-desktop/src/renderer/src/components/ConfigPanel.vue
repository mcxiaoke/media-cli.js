<script setup lang="ts">
import { ref, computed, watch } from "vue"
import { useConfigStore } from "../stores/config"
import { usePlanStore } from "../stores/plan"
import { useEnvStore } from "../stores/env"
import { useLogStore } from "../stores/log"
import { useInputIngest } from "../composables/useInputIngest"

const emit = defineEmits<{
  (e: "collapse"): void
}>()

const config = useConfigStore()
const plan = usePlanStore()
const env = useEnvStore()
const logStore = useLogStore()
const { ingestPaths } = useInputIngest()

function formatPresetOption(p: any): string {
  const parts: string[] = []
  if (p.type === "audio") {
    parts.push(p.audioCodec ? p.audioCodec.toUpperCase() : "AUDIO")
    if (p.audioBitrate) {
      const br = p.audioBitrate >= 1000 ? Math.round(p.audioBitrate / 1000) : p.audioBitrate
      parts.push(`${br}k`)
    }
    if (p.format) parts.push(p.format)
    return `${p.name} [${parts.join(" · ")}]`
  }
  // video
  if (p.videoCodecFamily) parts.push(p.videoCodecFamily.toUpperCase())
  if (p.dimension) parts.push(`${p.dimension}p`)
  if (p.videoQuality) parts.push(`CRF${p.videoQuality}`)
  else if (p.videoBitrate) {
    const br = p.videoBitrate >= 1000 ? Math.round(p.videoBitrate / 1000) : p.videoBitrate
    parts.push(`${br}k`)
  }
  if (p.audioCodec || p.audioBitrate) {
    const br = p.audioBitrate ? (p.audioBitrate >= 1000 ? Math.round(p.audioBitrate / 1000) : p.audioBitrate) : null
    const a = [p.audioCodec?.toUpperCase(), br ? `${br}k` : ""].filter(Boolean).join(" ")
    if (a) parts.push(a)
  }
  return `${p.name} [${parts.join(" · ")}]`
}

// Accordion collapse state
const isVideoOpen = ref(false)
const isAudioOpen = ref(false)

// Manual input text
const manualPathInput = ref("")

// Watch for changes to mark plan STALE
watch(
  [
    () => config.preset,
    () => config.outputDir,
    () => config.outputMode,
    () => config.prefix,
    () => config.suffix,
    () => config.tune,
    () => config.adv,
  ],
  () => {
    plan.markStale()
  },
  { deep: true }
)

// Watch inputs array: if empty -> IDLE
watch(
  () => config.inputs.length,
  (len) => {
    if (len === 0) {
      plan.setPlan(null)
    } else {
      plan.markStale()
    }
  }
)

// Watch preset & tune parameters to record live audit logs
watch(
  () => config.preset,
  (newPreset, oldPreset) => {
    if (newPreset && oldPreset && newPreset !== oldPreset) {
      logStore.append({
        level: "INFO",
        message: `转码预设已切换: ${oldPreset} → ${newPreset}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }
)

watch(
  () => config.tune.dimension,
  (newVal, oldVal) => {
    if (newVal !== undefined && oldVal !== undefined && newVal !== oldVal) {
      logStore.append({
        level: "INFO",
        message: `修改视频分辨率: ${newVal === 0 ? "保持源分辨率" : newVal + "p"}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }
)

watch(
  () => config.tune.quality,
  (newVal, oldVal) => {
    if (newVal !== undefined && oldVal !== undefined && newVal !== oldVal) {
      logStore.append({
        level: "INFO",
        message: `修改视频质量 CRF: ${newVal === 0 ? "跟随预设" : newVal}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }
)

watch(
  () => config.tune.bitrate,
  (newVal, oldVal) => {
    if (newVal !== undefined && oldVal !== undefined && newVal !== oldVal) {
      logStore.append({
        level: "INFO",
        message: `修改视频码率: ${newVal || "跟随预设"}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }
)

watch(
  () => config.tune.audioCodec,
  (newVal, oldVal) => {
    if (newVal !== undefined && oldVal !== undefined && newVal !== oldVal) {
      logStore.append({
        level: "INFO",
        message: `修改音频编码: ${newVal || "跟随预设"}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }
)

watch(
  () => config.tune.audioBitrate,
  (newVal, oldVal) => {
    if (newVal !== undefined && oldVal !== undefined && newVal !== oldVal) {
      logStore.append({
        level: "INFO",
        message: `修改音频码率: ${newVal || "跟随预设"}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }
)

async function pickFiles() {
  try {
    const res = await window.api.selectFiles({ mode: "file", multiple: true })
    if (res.paths.length > 0) {
      logStore.append({
        level: "INFO",
        message: `已添加 ${res.paths.length} 个媒体文件`,
        timestamp: new Date().toLocaleTimeString(),
      })
      await ingestPaths(res.paths)
    }
  } catch (err) {
    console.error("selectFiles error:", err)
  }
}

async function pickDirectory() {
  try {
    const res = await window.api.selectFiles({ mode: "directory", multiple: false })
    if (res.paths.length > 0) {
      logStore.append({
        level: "INFO",
        message: `已添加媒体目录: ${res.paths.join(", ")}`,
        timestamp: new Date().toLocaleTimeString(),
      })
      await ingestPaths(res.paths)
    }
  } catch (err) {
    console.error("selectFiles directory error:", err)
  }
}

async function pickOutputDir() {
  try {
    const res = await window.api.selectFiles({ mode: "directory", multiple: false })
    if (res.paths.length > 0) {
      config.outputDir = res.paths[0]
      logStore.append({
        level: "INFO",
        message: `输出目录已设置为: ${res.paths[0]}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  } catch (err) {
    console.error("selectOutputDir error:", err)
  }
}

async function addManualPath() {
  const val = manualPathInput.value.trim()
  if (val) {
    manualPathInput.value = ""
    logStore.append({
      level: "INFO",
      message: `手动添加路径: ${val}`,
      timestamp: new Date().toLocaleTimeString(),
    })
    await ingestPaths([val])
  }
}

function removeInput(idx: number) {
  const item = config.inputs[idx]
  config.removeInput(idx)
  logStore.append({
    level: "INFO",
    message: `已移除输入项: ${item}`,
    timestamp: new Date().toLocaleTimeString(),
  })
}

async function handleDrop(event: DragEvent) {
  event.preventDefault()
  const files = Array.from(event.dataTransfer?.files || [])
  const paths = files
    .map((file) => {
      try {
        return window.api.getPathForFile(file)
      } catch {
        return ""
      }
    })
    .filter(Boolean)
  if (paths.length > 0) {
    logStore.append({
      level: "INFO",
      message: `拖拽添加了 ${paths.length} 项路径`,
      timestamp: new Date().toLocaleTimeString(),
    })
    await ingestPaths(paths)
  }
}

// Preset grouping & selection
const selectedPresetObj = computed(() => {
  return env.summary?.presets.find((p) => p.name === config.preset) || null
})

const presetGroups = computed(() => {
  const list = env.summary?.presets || []
  const groups: Record<string, typeof list> = {}
  for (const p of list) {
    const key = (p.type === "audio" ? "音频预设" : p.videoCodecFamily?.toUpperCase() || "通用视频")
    if (!groups[key]) groups[key] = []
    groups[key].push(p)
  }
  return groups
})

// Summaries
const videoSummary = computed(() => {
  const parts: string[] = []
  if (config.tune.dimension > 0) parts.push(`${config.tune.dimension}p`)
  else if (selectedPresetObj.value?.dimension) parts.push(`${selectedPresetObj.value.dimension}p`)

  if (config.tune.quality > 0) parts.push(`CRF ${config.tune.quality}`)
  else if (selectedPresetObj.value?.videoQuality) parts.push(`CRF ${selectedPresetObj.value.videoQuality}`)

  if (config.tune.fps > 0) parts.push(`${config.tune.fps} fps`)
  if (config.tune.speed > 0) parts.push(`${config.tune.speed}x`)
  if (config.tune.bitrate) parts.push(config.tune.bitrate)

  return parts.length > 0 ? parts.join(" · ") : "默认"
})

const audioSummary = computed(() => {
  const parts: string[] = []
  if (config.tune.audioCodec) parts.push(config.tune.audioCodec)
  else if (selectedPresetObj.value?.audioCodec) parts.push(selectedPresetObj.value.audioCodec)

  if (config.tune.audioBitrate) parts.push(config.tune.audioBitrate)
  else if (selectedPresetObj.value?.audioBitrate) {
    const br = selectedPresetObj.value.audioBitrate
    const brStr = String(br).endsWith("k") ? String(br) : (Number(br) >= 1000 ? Math.round(Number(br) / 1000) + "k" : `${br}k`)
    parts.push(brStr)
  }

  return parts.length > 0 ? parts.join(" · ") : "默认"
})
</script>

<template>
  <aside class="side-panel" data-testid="config-panel">
    <!-- 侧栏顶部收起栏 -->
    <div class="side-top-bar">
      <div class="side-top-title">
        <svg class="side-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <line x1="1" y1="14" x2="7" y2="14" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="17" y1="16" x2="23" y2="16" />
        </svg>
        <span>转码配置</span>
      </div>
      <button
        class="side-collapse-btn"
        data-testid="btn-sidebar-collapse"
        title="收起配置栏 (Ctrl+B)"
        @click="emit('collapse')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        <span>收起</span>
      </button>
    </div>

    <!-- 1 输入与输出 -->
    <section class="card" data-testid="card-input-output">
      <div class="card-title">
        <span>输入与输出</span>
        <span class="sub">文件 / 目录 / 命名</span>
      </div>
      <div class="card-body">
        <div
          class="dropzone"
          tabindex="0"
          role="button"
          aria-label="拖入或点击添加媒体目录"
          data-testid="side-dropzone"
          @dragover.prevent
          @drop.stop="handleDrop"
          @click="pickDirectory"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M3 16v2.5A2.5 2.5 0 0 0 5.5 21h13a2.5 2.5 0 0 0 2.5-2.5V16" />
            <path d="M12 3v13" />
            <path d="M7 8l5-5 5 5" />
          </svg>
          <span>拖入媒体文件或目录，或点击浏览目录</span>
        </div>

        <div class="btn-row">
          <button class="btn btn-secondary" data-testid="btn-add-files" @click="pickFiles">
            <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            添加文件
          </button>
          <button class="btn btn-secondary" data-testid="btn-add-dir" @click="pickDirectory">
            <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
              <path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            </svg>
            添加目录
          </button>
        </div>

        <div class="inline-row">
          <input
            v-model="manualPathInput"
            class="input grow"
            placeholder="粘贴文件/目录路径，回车添加"
            data-testid="input-manual-path"
            @keyup.enter="addManualPath"
          />
          <button class="btn btn-secondary" data-testid="btn-manual-add" @click="addManualPath">
            添加
          </button>
        </div>

        <!-- 输入路径清单 -->
        <div v-if="config.inputs.length > 0" class="chip-list" data-testid="chip-list">
          <div v-for="(item, idx) in config.inputs" :key="item" class="chip">
            <div class="chip-main">
              <div class="chip-name" :title="item">{{ item }}</div>
            </div>
            <button
              class="chip-x"
              title="移除该项"
              :data-testid="`btn-remove-input-${idx}`"
              @click="removeInput(idx)"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="divider"></div>

        <div class="field">
          <label class="lbl">输出目录 <span class="hint">留空 = 源文件同目录</span></label>
          <div class="inline-row">
            <input
              v-model="config.outputDir"
              class="input grow"
              placeholder="选择或输入输出目录"
              data-testid="input-output-dir"
            />
            <button class="btn btn-secondary" data-testid="btn-select-output-dir" @click="pickOutputDir">
              选择目录
            </button>
          </div>
        </div>

        <div class="field">
          <label class="lbl">输出模式</label>
          <select v-model="config.outputMode" class="select" data-testid="select-output-mode">
            <option value="dir">dir · 保留父目录名（推荐）</option>
            <option value="tree">tree · 保持完整目录树</option>
            <option value="file">file · 直接扁平写入输出目录</option>
          </select>
        </div>

        <div class="field-row two">
          <div class="field">
            <label class="lbl">前缀</label>
            <input v-model="config.prefix" class="input" placeholder="[SHANA] " data-testid="input-prefix" />
          </div>
          <div class="field">
            <label class="lbl">后缀</label>
            <input v-model="config.suffix" class="input" placeholder="_{preset}" data-testid="input-suffix" />
          </div>
        </div>
      </div>
    </section>

    <!-- 2 预设 -->
    <section class="card" data-testid="card-preset">
      <div class="card-title">
        <span>预设</span>
        <span class="sub">必选 · 决定输出编码与画质</span>
      </div>
      <div class="card-body">
        <div class="field">
          <label class="lbl">预设模板</label>
          <select v-model="config.preset" class="select" data-testid="select-preset">
            <optgroup v-for="(presets, group) in presetGroups" :key="group" :label="group">
              <option v-for="p in presets" :key="p.name" :value="p.name">
                {{ formatPresetOption(p) }}
              </option>
            </optgroup>
          </select>

          <!-- 预设徽章 -->
          <div v-if="selectedPresetObj" class="preset-badges" data-testid="preset-badges">
            <span class="badge k">{{ selectedPresetObj.videoCodecFamily?.toUpperCase() || 'VIDEO' }}</span>
            <span v-if="selectedPresetObj.dimension" class="badge">
              {{ selectedPresetObj.dimension }}p
            </span>
            <span v-if="selectedPresetObj.videoQuality" class="badge">
              CRF {{ selectedPresetObj.videoQuality }}
            </span>
            <span v-if="selectedPresetObj.audioCodec" class="badge a">
              {{ selectedPresetObj.audioCodec }} {{ selectedPresetObj.audioBitrate ? (String(selectedPresetObj.audioBitrate).endsWith('k') ? selectedPresetObj.audioBitrate : (selectedPresetObj.audioBitrate >= 1000 ? Math.round(selectedPresetObj.audioBitrate / 1000) + 'k' : selectedPresetObj.audioBitrate + 'k')) : '' }}
            </span>
          </div>
        </div>
      </div>
    </section>

    <!-- 3 视频参数 -->
    <section class="card" data-testid="card-video">
      <div class="card-title toggle" @click="isVideoOpen = !isVideoOpen">
        <span class="title-with-sum">
          视频参数
          <span class="sum" data-testid="video-summary">{{ videoSummary }}</span>
        </span>
        <div class="title-right">
          <a
            v-if="config.videoDirtyCount > 0"
            class="reset-link"
            data-testid="btn-reset-video"
            title="全部还原为预设默认"
            @click.stop="config.resetVideoTune()"
          >
            全部还原 ({{ config.videoDirtyCount }})
          </a>
          <svg class="chev i sm" :class="{ open: isVideoOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      <div v-show="isVideoOpen" class="card-body" data-testid="video-body">
        <!-- 长边尺寸 -->
        <div class="field">
          <div class="field-label-row">
            <label class="lbl">
              长边尺寸 <span class="hint">只缩不放大</span>
              <span v-if="config.isDimensionDirty" class="dot-dirty"></span>
            </label>
            <button
              v-if="config.isDimensionDirty"
              class="undo-btn"
              title="恢复预设默认"
              @click="config.resetParam('dimension')"
            >
              ↺
            </button>
          </div>
          <div class="inline-row">
            <select v-model.number="config.tune.dimension" class="select grow" data-testid="select-dimension">
              <option :value="0">0 · 保持源分辨率</option>
              <option :value="3840">3840 · 4K UHD</option>
              <option :value="2560">2560 · 2K QHD</option>
              <option :value="1920">1920 · 1080p FHD</option>
              <option :value="1280">1280 · 720p HD</option>
            </select>
            <input
              v-model.number="config.tune.dimension"
              class="input num"
              placeholder="像素"
              title="自定义长边像素"
              data-testid="input-dimension"
            />
          </div>
        </div>

        <!-- 视频质量 CRF -->
        <div class="field">
          <div class="field-label-row">
            <label class="lbl">
              视频质量 <span class="hint">CRF · 0-51 (0=跟随预设)</span>
              <span v-if="config.isQualityDirty" class="dot-dirty"></span>
            </label>
            <button
              v-if="config.isQualityDirty"
              class="undo-btn"
              title="恢复预设默认"
              @click="config.resetParam('quality')"
            >
              ↺
            </button>
          </div>
          <div class="quality-row">
            <input
              v-model.number="config.tune.quality"
              type="range"
              min="0"
              max="51"
              step="1"
              data-testid="slider-quality"
            />
            <input
              v-model.number="config.tune.quality"
              class="input num"
              data-testid="input-quality"
            />
          </div>
        </div>

        <!-- 视频码率 -->
        <div class="field">
          <div class="field-label-row">
            <label class="lbl">
              视频码率
              <span v-if="config.isBitrateDirty" class="dot-dirty"></span>
            </label>
            <button
              v-if="config.isBitrateDirty"
              class="undo-btn"
              title="恢复预设默认"
              @click="config.resetParam('bitrate')"
            >
              ↺
            </button>
          </div>
          <div class="inline-row">
            <select v-model="config.tune.bitrate" class="select grow" data-testid="select-bitrate">
              <option value="">留空 · 跟随预设</option>
              <option value="1500k">1500k · 低码率</option>
              <option value="2500k">2500k · 标准 1080p</option>
              <option value="4M">4M · 高清 1080p</option>
              <option value="8M">8M · 2K 优质</option>
              <option value="15M">15M · 4K 超清</option>
            </select>
            <input
              v-model="config.tune.bitrate"
              class="input num"
              placeholder="k/M"
              title="自定义码率，如 3.5M"
              data-testid="input-bitrate"
            />
          </div>
        </div>

        <div class="field-row two">
          <!-- 帧率 -->
          <div class="field">
            <div class="field-label-row">
              <label class="lbl">
                帧率
                <span v-if="config.isFpsDirty" class="dot-dirty"></span>
              </label>
              <button
                v-if="config.isFpsDirty"
                class="undo-btn"
                title="恢复预设默认"
                @click="config.resetParam('fps')"
              >
                ↺
              </button>
            </div>
            <select v-model.number="config.tune.fps" class="select" data-testid="select-fps">
              <option :value="0">0 · 保持源帧率</option>
              <option :value="23.976">23.976 fps</option>
              <option :value="24">24 fps · 电影</option>
              <option :value="25">25 fps · PAL</option>
              <option :value="29.97">29.97 fps</option>
              <option :value="30">30 fps</option>
              <option :value="60">60 fps · 高帧率</option>
            </select>
          </div>

          <!-- 倍速 -->
          <div class="field">
            <div class="field-label-row">
              <label class="lbl">
                倍速 <span class="hint">0.5-2.0</span>
                <span v-if="config.isSpeedDirty" class="dot-dirty"></span>
              </label>
              <button
                v-if="config.isSpeedDirty"
                class="undo-btn"
                title="恢复预设默认"
                @click="config.resetParam('speed')"
              >
                ↺
              </button>
            </div>
            <select v-model.number="config.tune.speed" class="select" data-testid="select-speed">
              <option :value="0">0 · 不变速</option>
              <option :value="0.5">0.5x · 慢速</option>
              <option :value="0.75">0.75x</option>
              <option :value="1.25">1.25x</option>
              <option :value="1.5">1.5x</option>
              <option :value="2.0">2.0x · 双倍速</option>
            </select>
          </div>
        </div>
      </div>
    </section>

    <!-- 4 音频参数 -->
    <section class="card" data-testid="card-audio">
      <div class="card-title toggle" @click="isAudioOpen = !isAudioOpen">
        <span class="title-with-sum">
          音频参数
          <span class="sum" data-testid="audio-summary">{{ audioSummary }}</span>
        </span>
        <div class="title-right">
          <a
            v-if="config.audioDirtyCount > 0"
            class="reset-link"
            data-testid="btn-reset-audio"
            title="全部还原为预设默认"
            @click.stop="config.resetAudioTune()"
          >
            全部还原 ({{ config.audioDirtyCount }})
          </a>
          <svg class="chev i sm" :class="{ open: isAudioOpen }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      <div v-show="isAudioOpen" class="card-body" data-testid="audio-body">
        <div class="field">
          <div class="field-label-row">
            <label class="lbl">
              音频编码
              <span v-if="config.isAudioCodecDirty" class="dot-dirty"></span>
            </label>
            <button
              v-if="config.isAudioCodecDirty"
              class="undo-btn"
              title="恢复预设默认"
              @click="config.resetParam('audioCodec')"
            >
              ↺
            </button>
          </div>
          <select v-model="config.tune.audioCodec" class="select" data-testid="select-audio-codec">
            <option value="">留空 · 跟随预设</option>
            <option value="copy">copy · 流复制（原音）</option>
            <option value="aac">aac · 标准通用</option>
            <option value="libopus">libopus · 高保真低码率</option>
            <option value="mp3">mp3 · 兼容旧设备</option>
            <option value="flac">flac · 无损音频</option>
          </select>
        </div>

        <div class="field">
          <div class="field-label-row">
            <label class="lbl">
              音频码率
              <span v-if="config.isAudioBitrateDirty" class="dot-dirty"></span>
            </label>
            <button
              v-if="config.isAudioBitrateDirty"
              class="undo-btn"
              title="恢复预设默认"
              @click="config.resetParam('audioBitrate')"
            >
              ↺
            </button>
          </div>
          <select v-model="config.tune.audioBitrate" class="select" data-testid="select-audio-bitrate">
            <option value="">留空 · 跟随预设</option>
            <option value="48k">48k · 极低码率 (Opus 语音推荐)</option>
            <option value="64k">64k · 低码率 (Opus 音乐推荐)</option>
            <option value="96k">96k · 语音/低码率</option>
            <option value="128k">128k · 标准清晰度</option>
            <option value="192k">192k · 高音质</option>
            <option value="256k">256k · 录音室级别</option>
            <option value="320k">320k · 极高码率</option>
          </select>
        </div>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.side-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  height: 100%;
}

.side-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  flex-shrink: 0;
}

.side-top-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-base);
}

.side-icon {
  width: 15px;
  height: 15px;
  color: var(--primary);
}

.side-collapse-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.side-collapse-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
  border-color: var(--border-strong);
}

.side-collapse-btn svg {
  width: 12px;
  height: 12px;
}

.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  flex: none;
}

.card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 600;
  border-bottom: 1px solid var(--divider);
}

.card-title .sub {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 400;
}

.card-title.toggle {
  cursor: pointer;
  user-select: none;
  transition: background-color 0.12s;
}

.card-title.toggle:hover {
  background: var(--bg-hover);
}

.title-with-sum {
  display: flex;
  align-items: center;
  gap: 6px;
}

.title-with-sum .sum {
  font-size: 11px;
  color: var(--text-3);
  font-weight: 400;
  font-family: var(--mono);
}

.title-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.reset-link {
  font-size: 11px;
  color: var(--primary-text);
  cursor: pointer;
  text-decoration: underline;
}

.reset-link:hover {
  color: var(--primary-hover);
}

.chev {
  transition: transform 0.15s ease;
}

.chev.open {
  transform: rotate(180deg);
}

.card-body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.divider {
  height: 1px;
  background: var(--divider);
  margin: 2px 0;
}

.dropzone {
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  padding: 10px;
  text-align: center;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  transition: border-color 0.15s, background-color 0.15s;
}

.dropzone:hover {
  border-color: var(--primary);
  color: var(--text-2);
}

.dropzone svg {
  width: 24px;
  height: 24px;
  opacity: 0.7;
}

.btn-row {
  display: flex;
  gap: 8px;
}

.btn-row > .btn {
  flex: 1;
  justify-content: center;
}

.inline-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.chip-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 140px;
  overflow-y: auto;
}

.chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 12px;
}

.chip-main {
  flex: 1;
  min-width: 0;
}

.chip-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: var(--mono);
  font-size: 11px;
  color: var(--text-2);
}

.chip-x {
  border: none;
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  width: 18px;
  height: 18px;
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

.chip-x:hover {
  background: var(--bg-hover);
  color: var(--error);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}

.field-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.field-row {
  display: flex;
  gap: 8px;
}

.field-row.two > .field {
  flex: 1;
}

.lbl {
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 4px;
}

.lbl.err {
  color: var(--error);
}

.hint {
  font-size: 11px;
  color: var(--text-3);
}

.dot-dirty {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  display: inline-block;
}

.undo-btn {
  border: none;
  background: transparent;
  color: var(--primary-text);
  cursor: pointer;
  font-size: 12px;
  padding: 0 4px;
  font-weight: 700;
}

.undo-btn:hover {
  color: var(--primary-hover);
}

.input,
.select {
  height: 30px;
  padding: 0 8px;
  font-size: 12px;
  font-family: var(--font);
  color: var(--text-base);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  outline: none;
  transition: border-color 0.12s;
}

.select {
  cursor: pointer;
}

.select optgroup {
  background: var(--bg-card);
  color: var(--text-3);
}

.select option {
  background: var(--bg-card);
  color: var(--text-base);
}

.input:focus,
.select:focus {
  border-color: var(--primary);
}

.input.grow,
.select.grow {
  flex: 1;
  min-width: 0;
}

.input.num {
  width: 64px;
  text-align: center;
  font-family: var(--mono);
}

.btn {
  height: 30px;
  padding: 0 12px;
  font-size: 12px;
  font-family: var(--font);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-base);
  background: var(--bg-input);
  transition: background 0.12s, border-color 0.12s;
  white-space: nowrap;
}

.btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.preset-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}

.badge {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 7px;
  border-radius: 3px;
  font-size: 11px;
  background: var(--bg-active);
  color: var(--text-2);
  white-space: nowrap;
}

.badge.k {
  background: var(--primary-soft);
  color: var(--primary-text);
  font-weight: 600;
}

.badge.a {
  background: var(--info-soft);
  color: var(--info);
}

.quality-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.quality-row input[type="range"] {
  flex: 1;
  accent-color: var(--primary);
  cursor: pointer;
}

.switches-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 0;
}

.sw {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--bg-active);
  border: 1px solid var(--border-strong);
  cursor: pointer;
  flex: none;
  transition: background 0.15s, border-color 0.15s;
}

.sw::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: left 0.15s;
}

.sw.on {
  background: var(--primary);
  border-color: var(--primary);
}

.sw.on::after {
  left: 18px;
}

.sw.err-sw.on {
  background: var(--error);
  border-color: var(--error);
}

svg.i {
  width: 14px;
  height: 14px;
}

svg.i.sm {
  width: 13px;
  height: 13px;
}
</style>
