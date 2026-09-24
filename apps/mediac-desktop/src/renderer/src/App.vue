<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue"
import type {
  EnvironmentSummary,
  PublicPlanSnapshot,
} from "../../shared/contracts"

const version = ref("loading")
const environment = ref<EnvironmentSummary | null>(null)
const selectedFiles = ref<string[]>([])
const outputDirectory = ref("")
const plan = ref<PublicPlanSnapshot | null>(null)
const status = ref("IDLE")
const progress = ref<Record<string, unknown> | null>(null)
const events = ref<Array<Record<string, unknown>>>([])
let unsubscribe: (() => void) | null = null

onMounted(async () => {
  const [appVersion, env] = await Promise.all([
    window.api.getAppVersion(),
    window.api.getEnvironment(),
  ])
  version.value = appVersion
  environment.value = env
  unsubscribe = window.api.onEngineEvent((event) => {
    events.value = [...events.value.slice(-99), event]
    if (event.type === "task.progress") progress.value = event
    if (typeof event.type === "string" && event.type.startsWith("session.")) {
      status.value = event.type
    }
    void refreshSnapshot()
  })
  await refreshSnapshot()
})

onUnmounted(() => unsubscribe?.())

async function refreshSnapshot() {
  const snapshot = await window.api.getTaskSnapshot()
  status.value = String(snapshot.status || "IDLE")
  plan.value = (snapshot.plan as PublicPlanSnapshot | null) || null
}

function addFiles(paths: string[]) {
  selectedFiles.value = [...new Set([...selectedFiles.value, ...paths])]
}

async function chooseFiles() {
  const result = await window.api.selectFiles({ mode: "file", multiple: true })
  addFiles(result.paths)
}

function handleDrop(event: DragEvent) {
  const files = Array.from(event.dataTransfer?.files || [])
  addFiles(files.map((file) => window.api.getPathForFile(file)).filter(Boolean))
}

async function chooseOutput() {
  const result = await window.api.selectFiles({ mode: "directory", multiple: false })
  outputDirectory.value = result.paths[0] || ""
}

async function createPlan() {
  if (selectedFiles.value.length === 0) return
  status.value = "PLANNING"
  try {
    plan.value = await window.api.createPlan({
      inputs: selectedFiles.value,
      output: outputDirectory.value,
      preset: "hevc_2k",
      options: { override: false },
    })
    status.value = "READY"
  } catch (error) {
    status.value = "FAILED"
    events.value = [...events.value, { type: "error", message: String(error) }]
  }
}

async function startExecution() {
  if (!plan.value) return
  status.value = "RUNNING"
  await window.api.startExecution()
}

async function stopExecution() {
  await window.api.stopExecution()
}
</script>

<template>
  <main class="shell">
    <header>
      <p class="eyebrow">MEDIACLI DESKTOP</p>
      <h1>FFmpeg workspace</h1>
      <p class="muted">Shared FFmpeg Engine · {{ version }} · {{ status }}</p>
    </header>

    <section
      class="dropzone"
      @dragover.prevent
      @drop.prevent="handleDrop"
      @click="chooseFiles"
    >
      <strong>Drop media files here</strong>
      <span>or click to select files</span>
    </section>

    <section class="card">
      <div class="toolbar">
        <button type="button" @click="chooseFiles">Select media files</button>
        <button type="button" @click="chooseOutput">Choose output folder</button>
        <button type="button" :disabled="selectedFiles.length === 0" @click="createPlan">
          Analyze
        </button>
        <button type="button" :disabled="!plan" @click="startExecution">Start</button>
        <button type="button" :disabled="status !== 'RUNNING'" @click="stopExecution">
          Stop
        </button>
      </div>

      <p v-if="environment">FFmpeg: {{ environment.ffmpegPath || "not found" }}</p>
      <p v-if="environment">Presets: {{ environment.presets.length }}</p>
      <p v-if="selectedFiles.length">Selected: {{ selectedFiles.length }}</p>
      <p v-if="outputDirectory">Output: {{ outputDirectory }}</p>
      <div v-if="progress" class="progress">
        <div :style="{ width: `${Number(progress.percent || 0)}%` }" />
      </div>
    </section>

    <section v-if="plan" class="card">
      <h2>Plan · {{ plan.totalTasks }} task(s)</h2>
      <p class="muted">{{ plan.presetName }} · {{ plan.totalDuration.toFixed(1) }}s</p>
      <ul>
        <li v-for="task in plan.tasks" :key="task.id">
          {{ task.name }} → {{ task.fileDst }} ({{ task.status }})
        </li>
      </ul>
    </section>

    <section class="card">
      <h2>Events</h2>
      <pre>{{ events.slice(-12).map((event) => JSON.stringify(event)).join("\n") }}</pre>
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
  max-width: 1100px;
  margin: 0 auto;
  padding: 48px 32px;
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

.dropzone {
  display: flex;
  flex-direction: column;
  gap: 6px;
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
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

button:disabled {
  cursor: not-allowed;
  opacity: 0.4;
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
  margin: 6px 0;
  word-break: break-all;
}

pre {
  max-height: 260px;
  overflow: auto;
  white-space: pre-wrap;
  color: #a7f3d0;
}
</style>
