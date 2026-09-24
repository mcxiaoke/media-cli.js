import { contextBridge, ipcRenderer, webUtils } from "electron"
import { IPC_CHANNELS } from "../shared/ipc-channels.js"
import type { DesktopApi } from "../shared/contracts.js"

const api: DesktopApi = {
  getPathForFile(file: File) {
    return webUtils.getPathForFile(file)
  },
  selectFiles(options) {
    return ipcRenderer.invoke(IPC_CHANNELS.DIALOG_SELECT_FILES, options)
  },
  getAppVersion() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION)
  },
  getEnvironment() {
    return ipcRenderer.invoke(IPC_CHANNELS.ENV_GET)
  },
  createPlan(body) {
    return ipcRenderer.invoke(IPC_CHANNELS.PLAN_CREATE, body)
  },
  startExecution(taskIds) {
    return ipcRenderer.invoke(IPC_CHANNELS.EXECUTION_START, taskIds || [])
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
}

if (!process.contextIsolated) {
  throw new Error("MediaCli preload requires contextIsolation")
}

contextBridge.exposeInMainWorld("api", api)
