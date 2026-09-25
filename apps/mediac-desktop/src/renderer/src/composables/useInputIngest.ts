import { useConfigStore } from "../stores/config"
import { usePlanStore } from "../stores/plan"
import { useLogStore } from "../stores/log"

/**
 * 统一 renderer 输入 ingestion：
 * 「保存输入 → IPC staging → 写入 Pinia → 日志/错误处理」只在唯一入口执行。
 *
 * 调用约定：
 * - 入参严格要求 string[]（本地绝对路径）；空值与非法类型在此过滤。
 * - DOM File 转换（window.api.getPathForFile）留在调用方（如 GlobalDropMask），
 *   解出绝对路径后再传给本函数。
 * - stageInputs 失败时统一记录错误日志并回退 STALE，防止 config/plan/log 三 store
 *   进入部分更新状态。
 */
export function useInputIngest() {
  const configStore = useConfigStore()
  const planStore = usePlanStore()
  const logStore = useLogStore()

  async function ingestPaths(paths: string[]) {
    const valid = (paths || []).filter(
      (p): p is string => typeof p === "string" && p.trim().length > 0
    )
    if (valid.length === 0) return

    // config store 是 UI 输入的事实源：以 addInputs 前后长度差计算本地去重数。
    // 不依赖主进程返回的 skippedDuplicates —— 并发触发时主进程 stagedEntries
    // 可能尚未登记上一次请求，其去重会被绕过，而本地计数总是即时的。
    const before = configStore.inputs.length
    configStore.addInputs(valid)
    const locallySkipped = valid.length - (configStore.inputs.length - before)

    try {
      const res = await window.api.stageInputs(valid)
      if (res.added && res.added.length > 0) {
        planStore.addStagedTasks(res.added)
      }
      // 本地去重与主进程去重取 max：顺序场景两者相等，并发场景主进程可能为 0，
      // 目录展开场景主进程可能识别出本地看不到的重复项。
      const skipped = Math.max(locallySkipped, res.skippedDuplicates || 0)
      if (skipped > 0) {
        logStore.append({
          level: "INFO",
          message: `跳过 ${skipped} 个重复添加的文件`,
          timestamp: new Date().toLocaleTimeString(),
        })
      }
    } catch (err) {
      console.error("stageInputs error:", err)
      planStore.markStale()
      logStore.append({
        level: "ERROR",
        message: `暂存输入失败: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: new Date().toLocaleTimeString(),
      })
    }
  }

  return { ingestPaths }
}
