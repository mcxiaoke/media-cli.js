<script setup lang="ts">
import { ref, watch, nextTick } from "vue"
import { useLogStore } from "../stores/log"

const logStore = useLogStore()
const bodyRef = ref<HTMLElement | null>(null)

watch(
  () => logStore.filteredLogs.length,
  async () => {
    await nextTick()
    if (bodyRef.value) {
      bodyRef.value.scrollTop = bodyRef.value.scrollHeight
    }
  }
)

function close() {
  logStore.drawerOpen = false
}

async function copyAll() {
  const text = logStore.filteredLogs.map((l) => `[${l.ts}] [${l.level}] ${l.text}`).join("\n")
  try {
    await navigator.clipboard.writeText(text)
    alert("已复制日志内容到剪贴板！")
  } catch (err) {
    console.error("Clipboard copy failed:", err)
  }
}
</script>

<template>
  <div v-if="logStore.drawerOpen" class="log-mask" @click="close">
    <aside class="log-drawer" data-testid="log-drawer" @click.stop>
      <div class="log-head">
        <div class="log-title-zone">
          <span class="log-title">运行日志</span>
          <span class="log-count">{{ logStore.filteredLogs.length }} 条</span>
          <span
            v-if="logStore.focusedTaskId"
            class="focus-pill"
            title="点击取消聚焦过滤"
            @click="logStore.clearFocus"
          >
            已聚焦 [{{ logStore.focusedTaskId }}] ✕
          </span>
        </div>

        <div class="log-actions">
          <select v-model="logStore.filter" class="mini-select">
            <option value="ALL">全部</option>
            <option value="INFO">INFO</option>
            <option value="CMD">CMD</option>
            <option value="WARN">WARN</option>
            <option value="ERROR">ERROR</option>
          </select>

          <button class="btn btn-sm" @click="copyAll">复制</button>
          <button class="btn btn-sm" @click="logStore.clearLogs">清屏</button>
          <button class="close-btn" data-testid="btn-close-log" @click="close">✕</button>
        </div>
      </div>

      <div ref="bodyRef" class="log-body">
        <div
          v-for="(item, idx) in logStore.filteredLogs"
          :key="idx"
          class="log-line"
          :class="'l-' + item.level"
        >
          <span class="ts">{{ item.ts }}</span>
          <span class="txt">{{ item.text }}</span>
        </div>
        <div v-if="logStore.filteredLogs.length === 0" class="log-empty">
          暂无符合过滤条件的日志
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.log-mask {
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

.log-drawer {
  width: 540px;
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

.log-head {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.log-title-zone {
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-base);
}

.log-count {
  font-size: 11px;
  color: var(--text-3);
}

.focus-pill {
  font-size: 11px;
  background: var(--warning-soft);
  color: var(--warning);
  padding: 1px 6px;
  border-radius: var(--radius);
  cursor: pointer;
  border: 1px solid rgba(242, 201, 125, 0.3);
}
.focus-pill:hover {
  opacity: 0.8;
}

.log-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini-select {
  height: 24px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  color: var(--text-base);
  border-radius: var(--radius);
  font-size: 11px;
  padding: 0 4px;
}

.btn {
  height: 24px;
  padding: 0 8px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--bg-input);
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}
.btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

.close-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: var(--text-3);
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius);
}
.close-btn:hover {
  background: var(--bg-hover);
  color: var(--text-base);
}

.log-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  background: #0d1117;
  font-family: var(--mono);
  font-size: 11px;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 3px;
  color: #e6edf3;
}

.log-line {
  display: flex;
  gap: 8px;
  word-break: break-all;
}

.ts {
  color: #7d8590;
  flex-shrink: 0;
}

.l-INFO .txt { color: #e6edf3; }
.l-CMD .txt { color: #7ee787; font-weight: 500; }
.l-WARN .txt { color: #e3b341; }
.l-ERROR .txt { color: #f85149; font-weight: 600; }

.log-empty {
  color: #7d8590;
  text-align: center;
  padding: 40px 0;
}
</style>
