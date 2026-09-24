import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from "electron"
import { appendFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ffmpegEnvironment } from "./ffmpeg-service.js"
import { toSerializable } from "./ipc-serializer.js"
import { IPC_CHANNELS } from "../shared/ipc-channels.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

function startupLog(message: string) {
  try {
    const logDir = app.getPath("logs")
    mkdirSync(logDir, { recursive: true })
    appendFileSync(path.join(logDir, "mediac-desktop-startup.log"), `${new Date().toISOString()} ${message}\n`)
  } catch {
    // Logging must never mask the original startup error.
  }
}

process.on("uncaughtException", (error) => {
  startupLog(`uncaughtException: ${error.stack || error}`)
  console.error(error)
})

process.on("unhandledRejection", (error) => {
  startupLog(`unhandledRejection: ${String(error)}`)
  console.error(error)
})

function isTrustedSender(event: IpcMainInvokeEvent) {
  const frameUrl = event.senderFrame?.url || event.sender.getURL()
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) {
    try {
      return new URL(frameUrl).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return frameUrl.startsWith("file://") && frameUrl.includes("/out/renderer/")
}

function handleTrusted(channel: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) {
      throw new Error("Untrusted IPC sender")
    }
    return toSerializable(await handler(...args))
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    startupLog(`preload-error ${preloadPath}: ${error.stack || error}`)
  })
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    startupLog(`did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`)
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  ffmpegEnvironment.setEventSink((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.EXECUTION_EVENT, toSerializable(event))
    }
  })
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"))
  }
}

handleTrusted(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())
handleTrusted(IPC_CHANNELS.ENV_GET, () => ffmpegEnvironment.getSummary())
handleTrusted(IPC_CHANNELS.PLAN_CREATE, (body: Record<string, unknown>) => ffmpegEnvironment.createPlan(body))
handleTrusted(IPC_CHANNELS.EXECUTION_START, async (taskIds: unknown) => {
  if (taskIds !== undefined && (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== "string"))) {
    throw new Error("taskIds must be an array of strings")
  }
  return ffmpegEnvironment.startExecution((taskIds as string[] | undefined) || [])
})
handleTrusted(IPC_CHANNELS.EXECUTION_STOP, () => ffmpegEnvironment.stopExecution())
handleTrusted(IPC_CHANNELS.EXECUTION_SNAPSHOT, () => ffmpegEnvironment.getTaskSnapshot())
handleTrusted(
  IPC_CHANNELS.DIALOG_SELECT_FILES,
  async (options: { mode?: "file" | "directory"; multiple?: boolean }) => {
    if (!options || typeof options !== "object") {
      throw new Error("Invalid dialog options")
    }
    const mode = options.mode === "directory" ? "directory" : "file"
    const properties: Array<"openDirectory" | "openFile" | "multiSelections"> =
      mode === "directory"
        ? ["openDirectory"]
        : options.multiple === false
          ? ["openFile"]
          : ["openFile", "multiSelections"]
    const dialogOptions = { properties }
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    return { paths: result.canceled ? [] : result.filePaths }
  },
)

app.whenReady()
  .then(async () => {
    startupLog("app ready")
    await ffmpegEnvironment.initialize()
    startupLog("environment initialized")
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
    createWindow()
    startupLog("main window created")
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    startupLog(`whenReady failed: ${error.stack || error}`)
    dialog.showErrorBox("MediaCli startup failed", error.stack || String(error))
    app.exit(1)
  })

app.on("before-quit", () => {
  ffmpegEnvironment.dispose()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
