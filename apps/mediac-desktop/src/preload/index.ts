import { contextBridge, ipcRenderer, webUtils, clipboard } from "electron"
import { IPC_CHANNELS } from "../shared/ipc-channels.js"
import type { DesktopApi, EngineEvent } from "../shared/contracts.js"

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
  stageInputs(paths) {
    return ipcRenderer.invoke(IPC_CHANNELS.STAGE_INPUTS, safeClone(paths))
  },
  clearStagedInputs() {
    return ipcRenderer.invoke(IPC_CHANNELS.STAGE_CLEAR)
  },
  removeStagedInputs(paths) {
    return ipcRenderer.invoke(IPC_CHANNELS.STAGE_REMOVE, safeClone(paths))
  },
  getAppVersion() {
    return ipcRenderer.invoke(IPC_CHANNELS.APP_GET_VERSION)
  },
  getEnvironment() {
    return ipcRenderer.invoke(IPC_CHANNELS.ENV_GET)
  },
  setCustomToolPaths(paths) {
    return ipcRenderer.invoke(IPC_CHANNELS.ENV_SET_CUSTOM_PATHS, safeClone(paths))
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
  onEngineEvent(callback) {
    const listener = (_event: unknown, data: EngineEvent) => callback(data)
    ipcRenderer.on(IPC_CHANNELS.EXECUTION_EVENT, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.EXECUTION_EVENT, listener)
  },
  showInFolder(fullPath) {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_SHOW_IN_FOLDER, fullPath)
  },
  openPath(fullPath) {
    return ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_PATH, fullPath)
  },
  copyText(text: string) {
    try {
      clipboard.writeText(text)
      return Promise.resolve(true)
    } catch {
      return Promise.resolve(false)
    }
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
