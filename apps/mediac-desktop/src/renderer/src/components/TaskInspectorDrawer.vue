<script setup lang="ts">
import { computed, ref } from "vue"
import { usePlanStore } from "../stores/plan"
import { useConfigStore } from "../stores/config"
import { formatSize, formatDuration, highlightFfmpegCmd } from "../utils/format"

const plan = usePlanStore()
const config = useConfigStore()

const task = computed(() => plan.inspectedTask)
const copiedCmd = ref(false)
const copiedRaw = ref(false)
const showRawMeta = ref(false)

const cmdString = computed(() => {
  if (!task.value) return ""
  if (plan.planSnapshot?.previewCmd) {
    const base = plan.planSnapshot.previewCmd
    const firstTask = plan.tasks[0]
    if (firstTask && task.value.id !== firstTask.id) {
      return base
        .split(`"${firstTask.path}"`).join(`"${task.value.path}"`)
        .split(firstTask.path).join(task.value.path)
        .split(`"${firstTask.fileDst}"`).join(`"${task.value.fileDst}"`)
        .split(firstTask.fileDst).join(task.value.fileDst)
    }
    return base
  }

  // 动态根据当前配置与预设生成推演命令预览
  const presetLower = (config.preset || "").toLowerCase()
  let vcodec = "libx264"
  let defaultCrf = "23"

  if (presetLower.includes("hevc") || presetLower.includes("h265") || presetLower.includes("x265") || presetLower.includes("265")) {
    vcodec = "libx265"
    defaultCrf = "28"
  } else if (presetLower.includes("av1") || presetLower.includes("svtav1")) {
    vcodec = "libsvtav1"
    defaultCrf = "30"
  } else if (presetLower.includes("vp9")) {
    vcodec = "libvpx-vp9"
    defaultCrf = "30"
  } else if (presetLower.includes("copy")) {
    vcodec = "copy"
  }

  const parts: string[] = ["ffmpeg", "-hide_banner", "-i", `"${task.value.path}"`]

  if (vcodec === "copy") {
    parts.push("-c:v", "copy")
  } else {
    parts.push("-c:v", vcodec)
    if (config.tune.bitrate.trim()) {
      parts.push("-b:v", config.tune.bitrate.trim())
    } else {
      parts.push("-crf", config.tune.quality > 0 ? String(config.tune.quality) : defaultCrf)
    }
  }

  if (config.tune.fps > 0) {
    parts.push("-r", String(config.tune.fps))
  }
  if (config.tune.dimension > 0) {
    parts.push("-vf", `"scale=-2:${config.tune.dimension}"`)
  }

  const acodec = config.tune.audioCodec || "aac"
  parts.push("-c:a", acodec)
  if (acodec !== "copy") {
    parts.push("-b:a", config.tune.audioBitrate || "192k")
  }

  const outDst = task.value.fileDst || (task.value.path ? task.value.path.replace(/\.[^.]+$/, "_output.mp4") : "output.mp4")
  parts.push(`"${outDst}"`)

  return parts.join(" ")
})

const highlightedCmd = computed(() => {
  return highlightFfmpegCmd(cmdString.value)
})

const rawMetadataText = computed(() => {
  if (!task.value) return ""
  if (task.value.mediaInfo) {
    return JSON.stringify(task.value.mediaInfo, null, 2)
  }
  if (task.value.rawMetadata) return task.value.rawMetadata
  return JSON.stringify({
    name: task.value.name,
    path: task.value.path,
    size: task.value.size,
    duration: task.value.duration,
    videoCodec: task.value.videoCodec,
    profile: task.value.profile,
    level: task.value.level,
    width: task.value.width,
    height: task.value.height,
    aspectRatio: task.value.aspectRatio,
    fps: task.value.fps,
    pixelFormat: task.value.pixelFormat,
    bitDepth: task.value.bitDepth,
    audioCodec: task.value.audioCodec,
    audioChannels: task.value.audioChannels,
    audioSampleRate: task.value.audioSampleRate,
    audioBitrate: task.value.audioBitrate
  }, null, 2)
})

function close() {
  plan.inspectedTask = null
}

async function copyCmd() {
  if (!cmdString.value) return
  if (window.api?.copyText) {
    await window.api.copyText(cmdString.value)
  } else {
    await navigator.clipboard.writeText(cmdString.value)
  }
  copiedCmd.value = true
  setTimeout(() => { copiedCmd.value = false }, 2000)
}

async function copyRaw() {
  if (!rawMetadataText.value) return
  if (window.api?.copyText) {
    await window.api.copyText(rawMetadataText.value)
  } else {
    await navigator.clipboard.writeText(rawMetadataText.value)
  }
  copiedRaw.value = true
  setTimeout(() => { copiedRaw.value = false }, 2000)
}

function locateFile() {
  if (task.value?.path) {
    window.api.showInFolder(task.value.path)
  }
}

// 默认 560px，支持读取上次拖拽偏好
const savedInspW = Number(localStorage.getItem("mediac_inspector_width"))
const drawerWidth = ref(savedInspW && savedInspW >= 420 ? savedInspW : 560)
const isResizing = ref(false)

function startResizing(e: MouseEvent) {
  isResizing.value = true
  const startX = e.clientX
  const startW = drawerWidth.value

  function onMouseMove(moveEvent: MouseEvent) {
    const delta = startX - moveEvent.clientX
    const maxW = Math.round(window.innerWidth * 0.94)
    const newW = Math.max(420, Math.min(maxW, startW + delta))
    drawerWidth.value = newW
  }

  function onMouseUp() {
    isResizing.value = false
    localStorage.setItem("mediac_inspector_width", String(drawerWidth.value))
    window.removeEventListener("mousemove", onMouseMove)
    window.removeEventListener("mouseup", onMouseUp)
  }

  window.addEventListener("mousemove", onMouseMove)
  window.addEventListener("mouseup", onMouseUp)
}
</script>

<template>
  <div v-if="task" class="inspector-mask" data-testid="inspector-mask" @click="close">
    <aside
      class="inspector-drawer"
      :class="{ 'no-transition': isResizing }"
      :style="{ width: `${drawerWidth}px` }"
      @click.stop
    >
      <!-- 左边缘宽度拖拽手柄 -->
      <div
        class="drawer-resizer"
        :class="{ dragging: isResizing }"
        data-testid="inspector-drawer-resizer"
        title="拖动调整面板宽度"
        @mousedown.stop="startResizing"
      ></div>

      <div class="insp-head">
        <div class="insp-title-zone">
          <span class="insp-title" :title="task.name">{{ task.name }}</span>
          <span class="tag" :class="task.status">{{ task.status }}</span>
        </div>
        <button class="close-btn" data-testid="btn-close-inspector" title="关闭 (Esc)" @click="close">✕</button>
      </div>

      <div class="insp-body">
        <!-- 规格对比卡片 -->
        <div class="insp-card">
          <div class="insp-card-title">
            <span>媒体规格详细解析</span>
            <span v-if="task.bitDepth && task.bitDepth > 8" class="tag ok">{{ task.bitDepth }}bit HDR/Wide</span>
            <span v-else class="tag ok">规格已解析</span>
          </div>
          <div class="insp-grid">
            <div class="insp-kv">
              <span class="k">源视频编码</span>
              <span class="v">{{ (task.videoCodec || "未知").toUpperCase() }} {{ task.profile ? `(${task.profile}${task.level ? '@' + task.level : ''})` : '' }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">目标编码预设</span>
              <span class="v primary-text">{{ plan.planSnapshot?.presetName || config.preset.toUpperCase() }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">分辨率 / 宽高比</span>
              <span class="v">{{ task.width && task.height ? `${task.width}×${task.height}` : '—' }} {{ task.aspectRatio ? `(${task.aspectRatio})` : '' }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">帧率 / 像素格式</span>
              <span class="v">{{ task.fps ? `${task.fps} fps` : '—' }} · {{ task.pixelFormat || '—' }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">源文件大小 / 时长</span>
              <span class="v">{{ formatSize(task.size) }} ({{ formatDuration(task.duration) }})</span>
            </div>
            <div class="insp-kv">
              <span class="k">色彩位深</span>
              <span class="v">{{ task.bitDepth ? `${task.bitDepth} bit` : '8 bit' }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">源音频规格</span>
              <span class="v">{{ task.audioCodec ? task.audioCodec.toUpperCase() : '无音频' }} {{ task.audioChannels ? `· ${task.audioChannels}声道` : '' }} {{ task.audioSampleRate ? `· ${task.audioSampleRate}Hz` : '' }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">目标音频参数</span>
              <span class="v">{{ config.tune.audioCodec || "aac" }} · {{ config.tune.audioBitrate || "192k" }}</span>
            </div>
          </div>
        </div>

        <!-- 原始元数据 (纯文本 / JSON) 卡片 -->
        <div class="insp-card">
          <div class="insp-card-title">
            <span>原始元数据 (ffprobe)</span>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm" data-testid="btn-toggle-raw-meta" @click="showRawMeta = !showRawMeta">
                {{ showRawMeta ? '收起' : '展开' }}
              </button>
              <button class="btn btn-sm" data-testid="btn-copy-raw-meta" @click="copyRaw">
                {{ copiedRaw ? '已复制 ✓' : '复制元数据' }}
              </button>
            </div>
          </div>
          <div v-show="showRawMeta" class="raw-meta-box" data-testid="insp-raw-meta-box">
            <pre class="raw-meta-pre">{{ rawMetadataText }}</pre>
          </div>
        </div>

        <!-- FFmpeg 命令行推演卡片 -->
        <div class="insp-card">
          <div class="insp-card-title">
            <span>FFmpeg 命令行（完整推演）</span>
            <button class="btn btn-sm" data-testid="btn-copy-cmd" @click="copyCmd">
              <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <rect x="9" y="9" width="13" height="13" rx="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {{ copiedCmd ? '已复制 ✓' : '复制命令' }}
            </button>
          </div>
          <div class="cmd-box" data-testid="insp-cmd-box" v-html="highlightedCmd"></div>
        </div>

        <!-- 路径卡片 -->
        <div class="insp-card">
          <div class="insp-card-title">
            <span>文件路径</span>
            <button class="btn btn-sm" @click="locateFile">定位源文件</button>
          </div>
          <div class="paths-box">
            <div class="path-item">
              <span class="path-label">源文件：</span>
              <span class="path-val">{{ task.path }}</span>
            </div>
            <div class="path-item">
              <span class="path-label">输出产物：</span>
              <span class="path-val primary-text">{{ task.fileDst }}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.inspector-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: flex-end;
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.inspector-drawer {
  position: relative;
  min-width: 420px;
  max-width: 95vw;
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.4);
  animation: slideLeft 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.inspector-drawer.no-transition {
  animation: none !important;
  transition: none !important;
}

.drawer-resizer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  background: transparent;
  z-index: 20;
  transition: background 0.15s;
}

.drawer-resizer:hover,
.drawer-resizer.dragging {
  background: var(--primary);
}

@keyframes slideLeft {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.insp-head {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.insp-title-zone {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.insp-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 320px;
}

.tag {
  font-size: 11px;
  padding: 2px 6px;
  border-radius: var(--radius);
  background: var(--bg-hover);
  color: var(--text-2);
}
.tag.ok { background: var(--primary-soft); color: var(--primary-text); }
.tag.running { background: var(--info-soft); color: var(--info); }
.tag.failed { background: var(--error-soft); color: var(--error); }

.close-btn {
  width: 24px;
  height: 24px;
  border-radius: var(--radius);
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

.insp-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.insp-card {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.insp-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-base);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.insp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.insp-kv {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.insp-kv .k {
  font-size: 11px;
  color: var(--text-3);
}

.insp-kv .v {
  font-size: 12px;
  color: var(--text-base);
  word-break: break-all;
}

.primary-text {
  color: var(--primary-text) !important;
}

.btn {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-2);
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
  border-color: var(--border-strong);
}

.btn-icon {
  width: 12px;
  height: 12px;
}

.cmd-box {
  background: #0d1117;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.6;
  color: #e6edf3;
  word-break: break-all;
  white-space: pre-wrap;
  max-height: 220px;
  overflow-y: auto;
}

:deep(.fl) {
  color: #7ee787;
  font-weight: 600;
}

:deep(.path) {
  color: #79c0ff;
}

.paths-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 11px;
}

.path-item {
  word-break: break-all;
}

.path-label {
  color: var(--text-3);
}

.raw-meta-box {
  background: #0d1117;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  padding: 8px 10px;
  max-height: 240px;
  overflow-y: auto;
  user-select: text;
}

.raw-meta-pre {
  margin: 0;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}
</style>
