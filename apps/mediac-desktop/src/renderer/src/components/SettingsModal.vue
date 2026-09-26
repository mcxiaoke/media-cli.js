<script setup lang="ts">
import { ref, watch } from "vue"
import { useConfigStore } from "../stores/config"
import { useLogStore } from "../stores/log"
import { useEnvStore } from "../stores/env"

const props = defineProps<{
  show: boolean
}>()

const emit = defineEmits<{
  (e: "close"): void
}>()

const configStore = useConfigStore()
const logStore = useLogStore()
const envStore = useEnvStore()

const currentTheme = ref(document.documentElement.getAttribute("data-theme") || "light")

// 组件常驻挂载（仅内层 v-if 切换），切主题后再次打开需重读，否则显示旧值
watch(
  () => props.show,
  (visible) => {
    if (visible) {
      currentTheme.value = document.documentElement.getAttribute("data-theme") || "light"
    }
  },
)

function setTheme(theme: "dark" | "light") {
  currentTheme.value = theme
  document.documentElement.setAttribute("data-theme", theme)
  localStorage.setItem("mediac_theme", theme)
}

const customFfmpeg = ref(localStorage.getItem("mediac_tool_ffmpeg") || "")
const customFfprobe = ref(localStorage.getItem("mediac_tool_ffprobe") || "")
const customMediainfo = ref(localStorage.getItem("mediac_tool_mediainfo") || "")

async function pickToolPath(tool: "ffmpeg" | "ffprobe" | "mediainfo") {
  try {
    const res = await window.api.selectFiles({ mode: "file", multiple: false })
    if (res.paths && res.paths.length > 0) {
      if (tool === "ffmpeg") customFfmpeg.value = res.paths[0]
      else if (tool === "ffprobe") customFfprobe.value = res.paths[0]
      else if (tool === "mediainfo") customMediainfo.value = res.paths[0]
    }
  } catch (err) {
    console.error("pickToolPath error:", err)
  }
}

async function saveSettings() {
  const ffmpegVal = customFfmpeg.value.trim()
  const ffprobeVal = customFfprobe.value.trim()
  const mediainfoVal = customMediainfo.value.trim()

  if (ffmpegVal) {
    localStorage.setItem("mediac_tool_ffmpeg", ffmpegVal)
  } else {
    localStorage.removeItem("mediac_tool_ffmpeg")
  }

  if (ffprobeVal) {
    localStorage.setItem("mediac_tool_ffprobe", ffprobeVal)
  } else {
    localStorage.removeItem("mediac_tool_ffprobe")
  }

  if (mediainfoVal) {
    localStorage.setItem("mediac_tool_mediainfo", mediainfoVal)
  } else {
    localStorage.removeItem("mediac_tool_mediainfo")
  }

  try {
    if (window.api?.setCustomToolPaths) {
      await window.api.setCustomToolPaths({
        ffmpeg: ffmpegVal,
        ffprobe: ffprobeVal,
        mediainfo: mediainfoVal,
      })
      await envStore.fetchEnv()
    }
  } catch (err: unknown) {
    console.error("setCustomToolPaths error:", err)
    logStore.append({
      level: "WARN",
      message: `更新外部工具路径失败: ${err instanceof Error ? err.message : String(err)}`,
      timestamp: new Date().toLocaleTimeString(),
    })
  }

  emit("close")
}

/**
 * 普通开关（非高危项）的统一切换入口：鼠标点击与键盘（Space / Enter）共用。
 * 这些开关是 role="switch" + tabindex=0，只有 @click 时键盘用户无法操作。
 */
function toggleAdvSwitch(key: "override" | "anime" | "strict") {
  configStore.adv[key] = !configStore.adv[key]
}

function handleDeleteSourceToggle() {
  if (!configStore.adv.deleteSource) {
    const ok = window.confirm(
      "【高危确认】转码成功且产物校验通过后，源文件将被移入 Mediac 安全回收目录（~/.mediac/deleted/日期），可随时恢复。请确认是否开启？"
    )
    if (ok) {
      configStore.adv.deleteSource = true
      logStore.append({
        level: "WARN",
        message: "已启用高危选项：转码后自动删除源文件（移入安全回收目录）",
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  } else {
    configStore.adv.deleteSource = false
    logStore.append({
      level: "INFO",
      message: "已关闭转码后删除源文件选项",
      timestamp: new Date().toLocaleTimeString(),
    })
  }
}
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

        <!-- 转码引擎与高级策略 -->
        <div class="set-row">
          <span class="lbl">转码引擎</span>
          <div class="set-box" data-testid="advanced-settings-box">
            <div class="field-row two">
              <div class="field">
                <label class="sub-lbl">硬件加速方式</label>
                <select v-model="configStore.adv.hwaccel" class="select" data-testid="select-hwaccel">
                  <option value="auto">auto · 自动推荐</option>
                  <option value="cuda">cuda · NVIDIA NVENC</option>
                  <option value="qsv">qsv · Intel QuickSync</option>
                  <option value="amf">amf · AMD AMF</option>
                  <option value="d3d11va">d3d11va · Windows D3D</option>
                  <option value="cpu">cpu · 仅 CPU 软解软编</option>
                </select>
              </div>
              <div class="field">
                <label class="sub-lbl">解码模式</label>
                <select v-model="configStore.adv.decodeMode" class="select" data-testid="select-decode-mode">
                  <option value="auto">auto · 自动</option>
                  <option value="gpu">gpu · 硬件硬解优先</option>
                  <option value="cpu">cpu · CPU 软解</option>
                </select>
              </div>
            </div>

            <div class="field" style="margin-top: 6px">
              <label class="sub-lbl">
                并发任务数
                <span class="hint">1 = 串行，视频建议 1</span>
              </label>
              <input
                v-model.number="configStore.adv.jobs"
                type="number"
                min="1"
                max="8"
                class="input num"
                data-testid="input-jobs"
              />
            </div>

            <div class="switches-list" style="margin-top: 8px">
              <div class="sw-row">
                <span class="sw-lbl">覆盖已存在产物</span>
                <span
                  class="sw"
                  :class="{ on: configStore.adv.override }"
                  role="switch"
                  :aria-checked="configStore.adv.override"
                  data-testid="sw-override"
                  tabindex="0"
                  @click="toggleAdvSwitch('override')"
                  @keydown.space.prevent="toggleAdvSwitch('override')"
                  @keydown.enter.prevent="toggleAdvSwitch('override')"
                ></span>
              </div>

              <div class="sw-row">
                <span class="sw-lbl">
                  动漫调优模式 <span class="hint">保线条，收紧质量</span>
                </span>
                <span
                  class="sw"
                  :class="{ on: configStore.adv.anime }"
                  role="switch"
                  :aria-checked="configStore.adv.anime"
                  data-testid="sw-anime"
                  tabindex="0"
                  @click="toggleAdvSwitch('anime')"
                  @keydown.space.prevent="toggleAdvSwitch('anime')"
                  @keydown.enter.prevent="toggleAdvSwitch('anime')"
                ></span>
              </div>

              <div class="sw-row">
                <span class="sw-lbl">
                  严格模式 <span class="hint">禁用自动降级与重试</span>
                </span>
                <span
                  class="sw"
                  :class="{ on: configStore.adv.strict }"
                  role="switch"
                  :aria-checked="configStore.adv.strict"
                  data-testid="sw-strict"
                  tabindex="0"
                  @click="toggleAdvSwitch('strict')"
                  @keydown.space.prevent="toggleAdvSwitch('strict')"
                  @keydown.enter.prevent="toggleAdvSwitch('strict')"
                ></span>
              </div>

              <div class="sw-row">
                <span class="sw-lbl err">
                  转码后删除源文件 <span class="hint">移入安全回收目录</span>
                </span>
                <span
                  class="sw err-sw"
                  :class="{ on: configStore.adv.deleteSource }"
                  role="switch"
                  :aria-checked="configStore.adv.deleteSource"
                  data-testid="sw-delete-source"
                  tabindex="0"
                  @click="handleDeleteSourceToggle"
                  @keydown.space.prevent="handleDeleteSourceToggle"
                  @keydown.enter.prevent="handleDeleteSourceToggle"
                ></span>
              </div>
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
                data-testid="input-custom-ffmpeg"
                placeholder="留空使用系统默认探测路径"
              />
              <button class="btn btn-sm btn-secondary" title="浏览文件" @click="pickToolPath('ffmpeg')">浏览...</button>
              <button class="btn btn-sm" @click="customFfmpeg = ''">重置</button>
            </div>
            <div class="tool-row">
              <span class="tl">ffprobe</span>
              <input
                v-model="customFfprobe"
                class="input grow"
                data-testid="input-custom-ffprobe"
                placeholder="留空使用系统默认探测路径"
              />
              <button class="btn btn-sm btn-secondary" title="浏览文件" @click="pickToolPath('ffprobe')">浏览...</button>
              <button class="btn btn-sm" @click="customFfprobe = ''">重置</button>
            </div>
            <div class="tool-row">
              <span class="tl">mediainfo</span>
              <input
                v-model="customMediainfo"
                class="input grow"
                placeholder="留空使用系统默认探测路径"
              />
              <button class="btn btn-sm btn-secondary" title="浏览文件" @click="pickToolPath('mediainfo')">浏览...</button>
              <button class="btn btn-sm" @click="customMediainfo = ''">重置</button>
            </div>
            <div class="tool-hint">
              ffprobe 为主探测工具；mediainfo 仅在 ffprobe 失败时作为兜底（留空 = 使用系统 PATH）
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
  width: 580px;
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

.tool-hint {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
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

.field-row.two {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sub-lbl {
  font-size: 11px;
  color: var(--text-2);
}

.select {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  font-family: var(--font);
  color: var(--text-base);
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  outline: none;
}

.select:focus {
  border-color: var(--primary);
}

.input.num {
  width: 100px;
}

.switches-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sw-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
}

.sw-lbl {
  font-size: 12px;
  color: var(--text-base);
}

.sw-lbl.err {
  color: var(--error);
  font-weight: 500;
}

.sw {
  width: 32px;
  height: 18px;
  border-radius: 9px;
  background: var(--border-strong);
  position: relative;
  cursor: pointer;
  transition: background 0.15s ease;
  flex-shrink: 0;
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
  transition: transform 0.15s ease;
}

.sw.on {
  background: var(--primary);
}

.sw.on::after {
  transform: translateX(14px);
}

.sw.err-sw.on {
  background: var(--error);
}
</style>
