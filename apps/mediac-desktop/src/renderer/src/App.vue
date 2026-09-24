<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import type {
  EnvironmentSummary,
  PublicPlanSnapshot,
} from "../../shared/contracts"

const version = ref("loading")
const environment = ref<EnvironmentSummary | null>(null)
const selectedInputs = ref<string[]>([])
const outputDirectory = ref("")
const presetName = ref("hevc_2k")
const outputMode = ref<"tree" | "dir" | "file">("dir")
const override = ref(false)
const strict = ref(false)
const deleteSource = ref(false)
const plan = ref<PublicPlanSnapshot | null>(null)
const status = ref("IDLE")
const progress = ref<Record<string, unknown> | null>(null)
const events = ref<Array<Record<string, unknown>>>([])
const errorMessage = ref("")
const busy = ref(false)
let unsubscribe: (() => void) | null = null

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function addInputs(paths: string[]) {
  selectedInputs.value = [...new Set([...selectedInputs.value, ...paths.filter(Boolean)])]
  errorMessage.value = ""
}

function removeInput(index: number) {
  selectedInputs.value.splice(index, 1)
  if (selectedInputs.value.length === 0) {
    plan.value = null
    status.value = "IDLE"
  }
}

async function chooseInputs(mode: "file" | "directory") {
  try {
    const result = await window.api.selectFiles({ mode, multiple: mode === "file" })
    addInputs(result.paths)
  } catch (error) {
    errorMessage.value = errorText(error)
  }
}

function handleDrop(event: DragEvent) {
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
  addInputs(paths)
}

async function chooseOutput() {
  try {
    const result = await window.api.selectFiles({ mode: "directory", multiple: false })
    outputDirectory.value = result.paths[0] || ""
  } catch (error) {
    errorMessage.value = errorText(error)
  }
}

async function refreshSnapshot() {
  try {
    const snapshot = await window.api.getTaskSnapshot()
    status.value = String(snapshot.status || "IDLE")
    plan.value = (snapshot.plan as PublicPlanSnapshot | null) || null
  } catch (error) {
    errorMessage.value = errorText(error)
  }
}

async function createPlan() {
  if (selectedInputs.value.length === 0) {
    errorMessage.value = "请先选择至少一个文件或目录"
    return
  }
  if (deleteSource.value && !window.confirm("转码成功后要删除源文件，确定继续吗？")) {
    return
  }

  busy.value = true
  errorMessage.value = ""
  status.value = "PLANNING"
  try {
    plan.value = await window.api.createPlan({
      inputs: selectedInputs.value,
      output: outputDirectory.value,
      preset: presetName.value,
      options: {
        outputMode: outputMode.value,
        override: override.value,
        strict: strict.value,
        deleteSourceFiles: deleteSource.value,
        ...(deleteSource.value ? { deleteSourceConfirmed: true } : {}),
      },
    })
    status.value = "READY"
  } catch (error) {
    status.value = "FAILED"
    errorMessage.value = errorText(error)
    events.value = [
      ...events.value,
      { type: "error", message: errorMessage.value, timestamp: new Date().toISOString() },
    ]
  } finally {
    busy.value = false
  }
}

async function startExecution() {
  if (!plan.value) return
  busy.value = true
  errorMessage.value = ""
  status.value = "RUNNING"
  try {
    await window.api.startExecution()
  } catch (error) {
    status.value = "FAILED"
    errorMessage.value = errorText(error)
  } finally {
    busy.value = false
  }
}

async function stopExecution() {
  try {
    await window.api.stopExecution()
  } catch (error) {
    errorMessage.value = errorText(error)
  }
}

onMounted(async () => {
  unsubscribe = window.api.onEngineEvent((event) => {
    events.value = [...events.value.slice(-99), event]
    if (event.type === "task.progress") progress.value = event
    if (event.type === "session.summary") {
      const summary = event.summary as Record<string, unknown> | undefined
      status.value = summary?.isCancelled ? "STOPPED" : "COMPLETED"
      void refreshSnapshot()
    }
  })

  try {
    const [appVersion, env] = await Promise.all([
      window.api.getAppVersion(),
      window.api.getEnvironment(),
    ])
    version.value = appVersion
    environment.value = env
    if (env.presets.length > 0 && !env.presets.some((preset) => preset.name === presetName.value)) {
      presetName.value = env.presets[0].name
    }
    await refreshSnapshot()
  } catch (error) {
    status.value = "FAILED"
    errorMessage.value = errorText(error)
  }
})

onUnmounted(() => unsubscribe?.())
</script>

<template>
  <main class="shell">
    <header class="header">
      <div>
        <p class="eyebrow">MEDIACLI DESKTOP</p>
        <h1>FFmpeg workspace</h1>
        <p class="muted">Shared FFmpeg Engine · v{{ version }}</p>
      </div>
      <span class="status" :class="`status-${status.toLowerCase()}`">{{ status }}</span>
    </header>

    <p v-if="errorMessage" class="error-banner">{{ errorMessage }}</p>

    <section
      class="dropzone"
      @dragover.prevent
      @drop.prevent="handleDrop"
      @click="chooseInputs('file')"
    >
      <strong>拖放媒体文件或目录到这里</strong>
      <span>也可以点击选择文件</span>
    </section>

    <section class="card">
      <div class="toolbar">
        <button type="button" @click="chooseInputs('file')">选择媒体文件</button>
        <button type="button" @click="chooseInputs('directory')">选择输入目录</button>
        <button type="button" @click="chooseOutput">选择输出目录</button>
      </div>

      <div v-if="selectedInputs.length" class="input-list">
        <div v-for="(input, index) in selectedInputs" :key="input" class="input-row">
          <span :title="input">{{ input }}</span>
          <button type="button" class="link-button" @click="removeInput(index)">移除</button>
        </div>
      </div>

      <div class="form-grid">
        <label>
          Preset
          <select v-model="presetName">
            <option v-for="preset in environment?.presets || []" :key="preset.name" :value="preset.name">
              {{ preset.name }} · {{ preset.type }} · {{ preset.format }}
            </option>
          </select>
        </label>
        <label>
          输出模式
          <select v-model="outputMode">
            <option value="tree">tree · 保持目录树</option>
            <option value="dir">dir · 保留父目录名</option>
            <option value="file">file · 直接写入输出目录</option>
          </select>
        </label>
      </div>

      <div class="options">
        <label><input v-model="override" type="checkbox" /> 覆盖已有目标</label>
        <label><input v-model="strict" type="checkbox" /> 严格模式</label>
        <label><input v-model="deleteSource" type="checkbox" /> 成功后删除源文件</label>
      </div>

      <div class="toolbar action-toolbar">
        <button type="button" :disabled="busy || selectedInputs.length === 0" @click="createPlan">
          {{ busy && status === "PLANNING" ? "分析中…" : "Analyze" }}
        </button>
        <button type="button" :disabled="busy || !plan" @click="startExecution">Start</button>
        <button type="button" class="danger" :disabled="status !== 'RUNNING'" @click="stopExecution">
          Stop
        </button>
      </div>

      <p v-if="environment" class="muted environment-line">
        FFmpeg: {{ environment.ffmpegPath || "not found" }} · FFprobe:
        {{ environment.ffprobePath || "not found" }} · Presets: {{ environment.presets.length }}
      </p>
      <p v-if="outputDirectory" class="muted">输出目录：{{ outputDirectory }}</p>
      <div v-if="progress" class="progress">
        <div :style="{ width: `${Number(progress.percent || 0)}%` }" />
      </div>
    </section>

    <section v-if="plan" class="card">
      <h2>Plan · {{ plan.totalTasks }} task(s)</h2>
      <p class="muted">
        {{ plan.presetName }} · {{ plan.totalDuration.toFixed(1) }}s · {{ plan.totalSize }} bytes
      </p>
      <pre class="command-preview">{{ plan.previewCmd || "（当前计划没有可执行任务）" }}</pre>
      <ul>
        <li v-for="task in plan.tasks" :key="task.id">
          <strong>{{ task.name }}</strong>
          <span>{{ task.status }} → {{ task.fileDst || "—" }}</span>
          <small v-if="task.skipReason"> ({{ task.skipReason }})</small>
        </li>
      </ul>
    </section>

    <section class="card">
      <div class="section-header">
        <h2>Events</h2>
        <button type="button" class="link-button" @click="events = []">清空</button>
      </div>
      <pre>{{ events.slice(-12).map((event) => JSON.stringify(event, null, 2)).join("\n") }}</pre>
    </section>
  </main>
</template>

<style>
:root {
  color-scheme: dark;
  font-family: Inter, system-ui, sans-serif;
  background: #0b0f14;
  color: #e5e7eb;
}

body {
  margin: 0;
}

.shell {
  max-width: 1180px;
  margin: 0 auto;
  padding: 36px 32px 64px;
}

.header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.eyebrow {
  color: #6ee7b7;
  font-size: 12px;
  letter-spacing: 0.18em;
}

h1 {
  margin: 8px 0 12px;
  font-size: 36px;
}

h2 {
  margin-top: 0;
  font-size: 18px;
}

.muted {
  color: #94a3b8;
}

.status {
  border: 1px solid #334155;
  border-radius: 999px;
  padding: 8px 14px;
  color: #cbd5e1;
  background: #111827;
}

.status-running,
.status-planning {
  color: #6ee7b7;
  border-color: #10b981;
}

.status-failed {
  color: #fda4af;
  border-color: #f43f5e;
}

.error-banner {
  padding: 12px 16px;
  border: 1px solid #f43f5e;
  border-radius: 8px;
  color: #fecdd3;
  background: #2b1118;
}

.dropzone {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 24px;
  padding: 28px;
  border: 1px dashed #34d399;
  border-radius: 12px;
  background: #0f1b1b;
  color: #a7f3d0;
  cursor: pointer;
}

.dropzone span {
  color: #64748b;
  font-size: 13px;
}

.card {
  margin-top: 20px;
  padding: 20px;
  border: 1px solid #263241;
  border-radius: 12px;
  background: #111827;
}

.toolbar,
.options,
.form-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.action-toolbar {
  margin-top: 20px;
}

.form-grid {
  align-items: end;
  margin-top: 18px;
}

.form-grid label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
  color: #cbd5e1;
  font-size: 13px;
}

select {
  padding: 10px 12px;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #e5e7eb;
  background: #0f172a;
}

.options {
  margin-top: 16px;
  color: #cbd5e1;
  font-size: 14px;
}

.options label {
  display: flex;
  align-items: center;
  gap: 6px;
}

button {
  border: 0;
  border-radius: 8px;
  padding: 10px 16px;
  background: #34d399;
  color: #052e16;
  font-weight: 700;
  cursor: pointer;
}

button.danger {
  color: #fff1f2;
  background: #be123c;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.link-button {
  padding: 2px 6px;
  color: #93c5fd;
  background: transparent;
  font-size: 12px;
}

.input-list {
  margin-top: 18px;
  border: 1px solid #263241;
  border-radius: 8px;
  overflow: hidden;
}

.input-row,
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.input-row {
  padding: 8px 12px;
  color: #cbd5e1;
  background: #0f172a;
  font-size: 13px;
}

.input-row span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-header {
  margin-bottom: 10px;
}

.section-header h2 {
  margin: 0;
}

.environment-line {
  margin-top: 18px;
  overflow-wrap: anywhere;
}

.progress {
  height: 8px;
  margin-top: 12px;
  overflow: hidden;
  border-radius: 999px;
  background: #1f2937;
}

.progress div {
  height: 100%;
  background: #34d399;
  transition: width 120ms ease;
}

ul {
  padding-left: 20px;
  color: #cbd5e1;
}

li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 8px 0;
  word-break: break-all;
}

li span {
  color: #94a3b8;
}

pre {
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #a7f3d0;
}

.command-preview {
  padding: 12px;
  border-radius: 8px;
  background: #0f172a;
}
</style>
