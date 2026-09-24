import { contextBridge, ipcRenderer, webUtils } from "electron"

const api = {
  getPathForFile(file: File) {
    return webUtils.getPathForFile(file)
  },
  selectFiles(options: { mode: "file" | "directory"; multiple?: boolean }) {
    return ipcRenderer.invoke("dialog:select-files", options)
  },
  getAppVersion() {
    return ipcRenderer.invoke("app:get-version")
  },
}

if (!process.contextIsolated) {
  throw new Error("MediaCli preload requires contextIsolation")
}

contextBridge.exposeInMainWorld("api", api)
