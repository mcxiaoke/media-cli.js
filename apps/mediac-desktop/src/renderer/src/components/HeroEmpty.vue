<script setup lang="ts">
import { useInputIngest } from "../composables/useInputIngest"

const { ingestPaths } = useInputIngest()

async function pickFiles() {
  try {
    const res = await window.api.selectFiles({ mode: "file", multiple: true })
    if (res.paths.length > 0) {
      await ingestPaths(res.paths)
    }
  } catch (err) {
    console.error("pickFiles error:", err)
  }
}

async function pickDirectory() {
  try {
    const res = await window.api.selectFiles({ mode: "directory", multiple: false })
    if (res.paths.length > 0) {
      await ingestPaths(res.paths)
    }
  } catch (err) {
    console.error("pickDirectory error:", err)
  }
}
</script>

<template>
  <div class="hero-empty" data-testid="hero-empty">
    <div class="hero-target">
      <div class="icon-circle">
        <svg class="hero-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>

      <div class="hero-title">拖入媒体文件或目录开始转码</div>
      <div class="hero-desc">支持全域拖拽投放或点击下方按钮添加。预设自动按硬件优化分层推演。</div>

      <div class="hero-actions">
        <button class="btn btn-secondary" @click="pickFiles">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
          选择文件
        </button>
        <button class="btn btn-secondary" @click="pickDirectory">
          <svg class="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          选择目录
        </button>
      </div>

      <div class="hero-badges">
        <span class="badge">MP4 / MKV / MOV</span>
        <span class="badge">HEVC / H.264 / AV1</span>
        <span class="badge">音频提取 / 压制</span>
        <span class="badge">硬件加速分层</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
}

.hero-target {
  max-width: 520px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 16px;
}

.icon-circle {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  box-shadow: var(--shadow);
}

.hero-icon {
  width: 28px;
  height: 28px;
}

.hero-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--text-base);
}

.hero-desc {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}

.btn {
  height: 32px;
  padding: 0 16px;
  border-radius: var(--radius);
  font-size: 12px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid var(--border);
  background: var(--bg-card);
  color: var(--text-base);
}

.btn:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.btn-icon {
  width: 14px;
  height: 14px;
}

.hero-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
}

.badge {
  font-size: 11px;
  color: var(--text-3);
  background: var(--bg-card);
  border: 1px solid var(--border);
  padding: 2px 8px;
  border-radius: 10px;
}
</style>
