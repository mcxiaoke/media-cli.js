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
}

if (!process.contextIsolated) {
  throw new Error("MediaCli preload requires contextIsolation")
}

contextBridge.exposeInMainWorld("api", api)
