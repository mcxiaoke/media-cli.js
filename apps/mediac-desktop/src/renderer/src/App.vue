<script setup lang="ts">
import { onMounted, ref } from "vue"
import type { EnvironmentSummary } from "../../shared/contracts"

const version = ref("loading")
const environment = ref<EnvironmentSummary | null>(null)
const selectedFiles = ref<string[]>([])

onMounted(async () => {
  const [appVersion, env] = await Promise.all([
    window.api.getAppVersion(),
    window.api.getEnvironment(),
  ])
  version.value = appVersion
  environment.value = env
})

async function chooseFiles() {
  const result = await window.api.selectFiles({ mode: "file", multiple: true })
  selectedFiles.value = result.paths
}
</script>

<template>
  <main class="shell">
    <header>
      <p class="eyebrow">MEDIACLI DESKTOP</p>
      <h1>FFmpeg workspace</h1>
      <p class="muted">Electron shell is ready for the shared FFmpeg engine.</p>
    </header>

    <section class="card">
      <button type="button" @click="chooseFiles">Select media files</button>
      <p v-if="version">Desktop API version: {{ version }}</p>
      <p v-if="environment">FFmpeg: {{ environment.ffmpegPath || "not found" }}</p>
      <p v-if="environment">Presets: {{ environment.presets.length }}</p>
      <ul v-if="selectedFiles.length">
        <li v-for="file in selectedFiles" :key="file">{{ file }}</li>
      </ul>
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
  max-width: 960px;
  margin: 0 auto;
  padding: 64px 32px;
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

.muted {
  color: #94a3b8;
}

.card {
  margin-top: 32px;
  padding: 24px;
  border: 1px solid #263241;
  border-radius: 12px;
  background: #111827;
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

ul {
  padding-left: 20px;
  color: #cbd5e1;
}
</style>
