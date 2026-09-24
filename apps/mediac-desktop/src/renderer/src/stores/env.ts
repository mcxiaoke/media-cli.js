import { defineStore } from "pinia"
import { ref } from "vue"
import type { EnvironmentSummary } from "../../../shared/contracts"

export const useEnvStore = defineStore("env", () => {
  const version = ref("0.1.0")
  const summary = ref<EnvironmentSummary | null>(null)
  const loading = ref(false)

  async function fetchEnv() {
    try {
      loading.value = true
      version.value = await window.api.getAppVersion()
      summary.value = await window.api.getEnvironment()
    } catch (err) {
      console.error("Failed to load environment:", err)
    } finally {
      loading.value = false
    }
  }

  return { version, summary, loading, fetchEnv }
})
