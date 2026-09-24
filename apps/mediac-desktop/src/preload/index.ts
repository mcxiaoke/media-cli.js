import { contextBridge, ipcRenderer, webUtils } from "electron"
import { IPC_CHANNELS } from "../shared/ipc-channels.js"
import type { DesktopApi } from "../shared/contracts.js"

function safeClone<T>(val: T): T {
  if (val === undefined || val === null) return val
  try {
    return JSON.parse(JSON.stringify(val))
  } catch {
    return val
  }
}

const api: DesktopApi = {
  getPathForFile(file: File) {
    return webUtils.getPathForFile(file)
  },
  selectFiles(options) {
    return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILES, safeClone(options))
  },
  getAppVersion() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION)
  },
  getEnvironment() {
    return ipcRenderer.invoke(IPC_CHANNELS.ENV_GET)
  },
  createPlan(body) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLAN_CREATE, safeClone(body))
  },
  startExecution(taskIds) {
    return ipcRenderer.invoke(IPC_CHANNELS.EXECUTION_START, safeClone(taskIds))
  },
  stopExecution() {
    return ipcRenderer.invoke(IPC_CHANNELS.EXECUTION_STOP)
  },
  getTaskSnapshot() {
    return ipcRenderer.invoke(IPC_CHANNELS.EXECUTION_SNAPSHOT)
  },
  onEngineEvent(callback) {
    const listener = (_event: unknown, data: Record<string, unknown>) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.EXECUTION_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXECUTION_EVENT, listener)
  },
  showInFolder(fullPath) {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_IN_FOLDER, fullPath)
  },
  openPath(fullPath) {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_PATH, fullPath)
  },
  notify(title, body) {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_NOTIFY, safeClone({ title, body }))
  },
  onMenuAction(callback) {
    const listener = (_event: unknown, action: string) => callback(action)
    ipcRenderer.on("menu:action", listener)
    return () => ipcRenderer.removeListener("menu:action", listener)
  },
}

if (!process.contextIsolated) {
  throw new Error("MediaCli preload requires contextIsolation")
}

contextBridge.exposeInMainWorld("api", api)
