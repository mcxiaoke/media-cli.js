<script setup lang="ts">
import { ref, computed } from "vue"
import { useEnvStore } from "../stores/env"

defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

const envStore = useEnvStore()

const currentTheme = ref(document.documentElement.getAttribute("data-theme") || "dark")

function setTheme(theme: "dark" | "light") {
  currentTheme.value = theme
  document.documentElement.setAttribute("data-theme", theme)
  localStorage.setItem("mediac_theme", theme)
}

const customFfmpeg = ref(localStorage.getItem("mediac_tool_ffmpeg") || "")
const customFfprobe = ref(localStorage.getItem("mediac_tool_ffprobe") || "")
const customMediainfo = ref(localStorage.getItem("mediac_tool_mediainfo") || "")

const isRechecking = ref(false)

async function recheckEnvironment() {
  isRechecking.value = true
  try {
    await envStore.fetchEnv()
  } finally {
    isRechecking.value = false
  }
}

function saveSettings() {
  if (customFfmpeg.value.trim()) {
    localStorage.setItem("mediac_tool_ffmpeg", customFfmpeg.value.trim())
  } else {
    localStorage.removeItem("mediac_tool_ffmpeg")
  }

  if (customFfprobe.value.trim()) {
    localStorage.setItem("mediac_tool_ffprobe", customFfprobe.value.trim())
  } else {
    localStorage.removeItem("mediac_tool_ffprobe")
  }

  if (customMediainfo.value.trim()) {
    localStorage.setItem("mediac_tool_mediainfo", customMediainfo.value.trim())
  } else {
    localStorage.removeItem("mediac_tool_mediainfo")
  }

  emit("close")
}

const gpuList = computed(() => {
  return envStore.summary?.hardware.gpus || []
})

const hwaccelsText = computed(() => {
  return envStore.summary?.hardware.hwaccels?.join(" · ") || "未探测到可用硬件加速"
})
</script>

<template>
  <div v-if="show" class="modal-mask" data-testid="settings-modal-mask" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="应用设置" data-testid="settings-modal">
      <div class="modal-title">
        <span>应用设置</span>
        <button class="icon-btn" title="关闭 (Esc)" @click="emit('close')">
          <svg class="i sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- 主题切换 -->
        <div class="set-row">
          <span class="lbl">界面主题</span>
          <div class="set-box">
            <div class="seg" data-testid="theme-selector">
              <button
                :class="{ on: currentTheme === 'dark' }"
                @click="setTheme('dark')"
              >
                暗黑主题
              </button>
              <button
                :class="{ on: currentTheme === 'light' }"
                @click="setTheme('light')"
              >
                明亮主题
              </button>
            </div>
          </div>
        </div>

        <!-- FFmpeg 环境 -->
        <div class="set-row">
          <span class="lbl">FFmpeg 核心</span>
          <div class="set-box">
            <div class="kv">
              <span>路径：</span>
              <b>{{ envStore.summary?.ffmpegPath || "未检测到 ffmpeg 二进制" }}</b>
            </div>
            <div class="kv">
              <span>已加载预设：</span>
              <b>{{ envStore.summary?.presets.length || 0 }} 个</b>
            </div>
            <button
              class="btn btn-sm btn-secondary"
              :disabled="isRechecking"
              data-testid="btn-recheck-env"
              style="align-self: flex-start; margin-top: 4px"
              @click="recheckEnvironment"
            >
              {{ isRechecking ? "正在检测…" : "重新检测" }}
            </button>
          </div>
        </div>

        <!-- 硬件加速 -->
        <div class="set-row">
          <span class="lbl">硬件加速</span>
          <div class="set-box">
            <div v-for="gpu in gpuList" :key="gpu.model" class="kv">
              <span>GPU：</span>
              <b>{{ gpu.vendor }} {{ gpu.model }}</b>
            </div>
            <div class="kv">
              <span>加速器：</span>
              <b>{{ hwaccelsText }}</b>
            </div>
          </div>
        </div>

        <!-- 自定义工具路径 -->
        <div class="set-row">
          <span class="lbl">工具路径</span>
          <div class="set-box">
            <div class="tool-row">
              <span class="tl">ffmpeg</span>
              <input
                v-model="customFfmpeg"
                class="input grow"
                :placeholder="envStore.summary?.ffmpegPath || '留空使用默认探测路径'"
              />
              <button class="btn btn-sm" @click="customFfmpeg = ''">重置</button>
            </div>
            <div class="tool-row">
              <span class="tl">ffprobe</span>
              <input
                v-model="customFfprobe"
                class="input grow"
                :placeholder="envStore.summary?.ffprobePath || '留空使用默认探测路径'"
              />
              <button class="btn btn-sm" @click="customFfprobe = ''">重置</button>
            </div>
          </div>
        </div>

        <!-- 关于 -->
        <div class="set-row">
          <span class="lbl">关于软件</span>
          <div class="set-box">
            <div class="kv">
              <span>mediac-desktop</span>
              <b>v{{ envStore.version }}</b>
            </div>
            <div class="kv hint">
              底层共享 MediaCli 核心编排引擎与硬件探测矩阵
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn btn-secondary" @click="emit('close')">取消</button>
        <button class="btn btn-primary" data-testid="btn-save-settings" @click="saveSettings">
          保存设置
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal {
  width: 520px;
  max-width: calc(100vw - 32px);
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
}

.modal-title {
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-height: 70vh;
  overflow-y: auto;
}

.set-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.set-row > .lbl {
  width: 80px;
  flex: none;
  padding-top: 4px;
  font-size: 12px;
  color: var(--text-2);
}

.set-box {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.set-box .kv {
  font-size: 12px;
  color: var(--text-2);
  display: flex;
  gap: 6px;
  align-items: baseline;
  word-break: break-all;
}

.set-box .kv b {
  color: var(--text-base);
  font-family: var(--mono);
  font-weight: 500;
}

.hint {
  font-size: 11px;
  color: var(--text-3);
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  align-self: flex-start;
}

.seg button {
  padding: 5px 14px;
  font-size: 12px;
  font-family: var(--font);
  background: transparent;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}

.seg button.on {
  background: var(--primary-soft);
  color: var(--primary-text);
  font-weight: 600;
}

.tool-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.tool-row .tl {
  width: 60px;
  flex: none;
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text-2);
}

.input {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  font-family: var(--mono);
  color: var(--text-base);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.input.grow {
  flex: 1;
  min-width: 0;
}

.input:focus {
  outline: none;
  border-color: var(--primary);
}

.modal-foot {
  padding: 12px 16px;
  border-top: 1px solid var(--divider);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  height: 28px;
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
}

.btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn-sm {
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
}

.btn-primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #101014;
  font-weight: 600;
}

.btn-primary:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
}

[data-theme="light"] .btn-primary {
  color: #fff;
}

.icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

svg.i.sm {
  width: 14px;
  height: 14px;
}
</style>
