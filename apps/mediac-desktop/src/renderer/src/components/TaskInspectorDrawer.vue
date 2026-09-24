<script setup lang="ts">
import { computed } from "vue"
import { usePlanStore } from "../stores/plan"
import { useConfigStore } from "../stores/config"
import { formatSize, formatDuration, highlightFfmpegCmd } from "../utils/format"

const plan = usePlanStore()
const config = useConfigStore()

const task = computed(() => plan.inspectedTask)

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
  return `ffmpeg -i "${task.value.path}" -c:v libx265 -crf 23 -c:a aac -b:a 192k "${task.value.fileDst}"`
})

const highlightedCmd = computed(() => {
  return highlightFfmpegCmd(cmdString.value)
})

function close() {
  plan.inspectedTask = null
}

async function copyCmd() {
  try {
    await navigator.clipboard.writeText(cmdString.value)
    alert("已复制完整 FFmpeg 命令行到剪贴板！")
  } catch (err) {
    console.error("Clipboard copy failed:", err)
  }
}

function locateFile() {
  if (task.value?.path) {
    window.api.showInFolder(task.value.path)
  }
}
</script>

<template>
  <div v-if="task" class="inspector-mask" data-testid="inspector-mask" @click="close">
    <aside class="inspector-drawer" @click.stop>
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
            <span>媒体规格对比</span>
            <span class="tag ok">GPU 硬件加速</span>
          </div>
          <div class="insp-grid">
            <div class="insp-kv">
              <span class="k">源视频流</span>
              <span class="v">{{ task.videoCodec || "H.264" }} · {{ task.width || 3840 }}×{{ task.height || 2160 }} · {{ task.fps || 29.97 }}fps</span>
            </div>
            <div class="insp-kv">
              <span class="k">目标编码</span>
              <span class="v primary-text">{{ config.preset.toUpperCase() }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">源文件大小</span>
              <span class="v">{{ formatSize(task.size) }} ({{ formatDuration(task.duration) }})</span>
            </div>
            <div class="insp-kv">
              <span class="k">目标质量</span>
              <span class="v">CRF {{ config.tune.quality > 0 ? config.tune.quality : 23 }}</span>
            </div>
            <div class="insp-kv">
              <span class="k">音频格式</span>
              <span class="v">内置音轨 · AAC</span>
            </div>
            <div class="insp-kv">
              <span class="k">目标音频</span>
              <span class="v">{{ config.tune.audioCodec || "aac" }} · {{ config.tune.audioBitrate || "192k" }}</span>
            </div>
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
              复制命令
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
  width: 480px;
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border-strong);
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.4);
  animation: slideLeft 0.2s cubic-bezier(0.16, 1, 0.3, 1);
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
</style>
