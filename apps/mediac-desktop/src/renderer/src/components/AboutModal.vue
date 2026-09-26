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
const isRechecking = ref(false)

async function recheckEnvironment() {
  isRechecking.value = true
  try {
    await envStore.fetchEnv()
  } finally {
    isRechecking.value = false
  }
}

const sys = computed(() => envStore.summary?.system)
const gpus = computed(() => envStore.summary?.hardware.gpus || [])
const hwaccels = computed(() => envStore.summary?.hardware.hwaccels || [])
const encoders = computed(() => envStore.summary?.hardware.encoders || [])
const hwTier = computed(() => envStore.summary?.hardware.tier || "cpu")
</script>

<template>
  <div v-if="show" class="modal-mask" data-testid="about-modal-mask" @click.self="emit('close')">
    <div class="modal" data-testid="about-modal">
      <div class="modal-head">
        <div class="title-with-badge">
          <h3>关于与系统信息</h3>
          <span class="badge">v{{ envStore.version }}</span>
        </div>
        <button class="icon-btn" title="关闭 (Esc)" data-testid="btn-close-about" @click="emit('close')">
          <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- 应用基本信息 -->
        <div class="about-hero">
          <div class="app-icon-wrap">
            <svg class="app-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <rect x="2" y="2" width="20" height="20" rx="4" />
              <polygon points="10 8 16 12 10 16 10 8" />
            </svg>
          </div>
          <div class="app-meta">
            <div class="app-name">MediaCli Desktop</div>
            <div class="app-desc">基于 FFmpeg 的现代化高性能本地媒体处理工具</div>
          </div>
        </div>

        <!-- 处理器与系统内存 -->
        <div class="set-row">
          <span class="lbl">硬件平台</span>
          <div class="set-box">
            <div v-if="sys" class="kv">
              <span>处理器：</span>
              <b>{{ sys.cpuModel }} ({{ sys.cpuCores }} 逻辑核心)</b>
            </div>
            <div v-if="sys" class="kv">
              <span>物理内存：</span>
              <b>总计 {{ sys.totalMemGb }} GB · 空闲 {{ sys.freeMemGb }} GB (已用 {{ (sys.totalMemGb - sys.freeMemGb).toFixed(1) }} GB)</b>
            </div>
            <div v-else class="kv text-muted">正在探测系统硬件配置…</div>
          </div>
        </div>

        <!-- 显卡与硬件加速 -->
        <div class="set-row">
          <span class="lbl">图形与加速</span>
          <div class="set-box">
            <div v-if="gpus.length > 0" class="gpu-list">
              <div v-for="gpu in gpus" :key="gpu.model" class="kv">
                <span>GPU 设备：</span>
                <b>{{ gpu.vendor }} {{ gpu.model }} {{ gpu.generation ? `(${gpu.generation})` : '' }}</b>
              </div>
            </div>
            <div v-else class="kv">
              <span>GPU 设备：</span>
              <span class="hint">未探测到独显或通用核显</span>
            </div>
            <div class="kv">
              <span>加速分层：</span>
              <b class="tier-tag">{{ hwTier.toUpperCase() }} 硬件加速架构</b>
            </div>
            <div class="kv">
              <span>可用硬件层：</span>
              <b>{{ hwaccels.length > 0 ? hwaccels.join(" · ") : "纯 CPU 软解" }}</b>
            </div>
            <div v-if="encoders.length > 0" class="kv">
              <span>硬编支持：</span>
              <span class="encoders-text">{{ encoders.join(", ") }}</span>
            </div>
          </div>
        </div>

        <!-- FFmpeg 核心环境 -->
        <div class="set-row">
          <span class="lbl">FFmpeg 核心</span>
          <div class="set-box">
            <div class="kv">
              <span>可执行文件：</span>
              <b class="mono-path" :title="envStore.summary?.ffmpegPath || ''">
                {{ envStore.summary?.ffmpegPath || "未检测到 ffmpeg 二进制文件" }}
              </b>
            </div>
            <div class="kv">
              <span>探测工具：</span>
              <b class="mono-path" :title="envStore.summary?.ffprobePath || ''">
                {{ envStore.summary?.ffprobePath || "未检测到 ffprobe 二进制文件" }}
              </b>
            </div>
            <div class="kv">
              <span>兜底探测：</span>
              <b class="mono-path" :title="envStore.summary?.mediainfoPath || ''">
                {{ envStore.summary?.mediainfoPath || "mediainfo：使用系统 PATH（未自定义）" }}
              </b>
            </div>
            <div class="kv">
              <span>内置预设：</span>
              <b>已加载 {{ envStore.summary?.presets.length || 0 }} 个转码模板</b>
            </div>
            <div class="recheck-row">
              <button
                class="btn btn-sm btn-secondary"
                :disabled="isRechecking"
                data-testid="btn-about-recheck-env"
                @click="recheckEnvironment"
              >
                <svg v-if="isRechecking" class="i spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
                <span>{{ isRechecking ? "正在重新探测环境…" : "重新检测系统环境" }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-foot">
        <button class="btn btn-primary" data-testid="btn-about-ok" @click="emit('close')">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: var(--mask);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal {
  width: 580px;
  max-width: 92vw;
  max-height: 85vh;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--divider);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.modal-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-base);
}

.badge {
  font-size: 11px;
  font-family: var(--mono);
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--primary-soft);
  color: var(--primary);
  font-weight: 600;
}

.modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.about-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px;
  background: var(--bg-hover);
  border-radius: var(--radius);
  border: 1px solid var(--border-soft);
}

.app-icon-wrap {
  width: 44px;
  height: 44px;
  border-radius: var(--radius);
  background: var(--primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.app-icon {
  width: 24px;
  height: 24px;
}

.app-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.app-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-base);
}

.app-desc {
  font-size: 12px;
  color: var(--text-3);
}

.set-row {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.set-row > .lbl {
  width: 80px;
  flex: none;
  padding-top: 2px;
  font-size: 12px;
  color: var(--text-2);
  font-weight: 500;
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

.tier-tag {
  color: var(--primary) !important;
  font-weight: 600 !important;
}

.mono-path {
  font-size: 11px;
  word-break: break-all;
}

.encoders-text {
  font-size: 11px;
  font-family: var(--mono);
  color: var(--text-3);
}

.hint {
  font-size: 11px;
  color: var(--text-3);
}

.recheck-row {
  margin-top: 4px;
}

.modal-foot {
  padding: 10px 16px;
  border-top: 1px solid var(--divider);
  display: flex;
  justify-content: flex-end;
}

.btn {
  height: 28px;
  padding: 0 14px;
  font-size: 12px;
  font-family: var(--font);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.btn-primary {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
  font-weight: 500;
}

.btn-primary:hover {
  filter: brightness(1.08);
}

.btn-secondary {
  background: var(--bg-hover);
  color: var(--text-base);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-card);
  border-color: var(--primary);
}

.icon-btn {
  background: transparent;
  border: none;
  padding: 4px;
  color: var(--text-3);
  cursor: pointer;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

.i {
  width: 16px;
  height: 16px;
}

.i.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
