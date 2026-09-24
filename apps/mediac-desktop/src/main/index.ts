import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from "electron"
import { appendFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ffmpegEnvironment } from "./ffmpeg-service.js"
import { toSerializable } from "./ipc-serializer.js"
import { openPath, showItemInFolder, showNotification } from "./native.js"
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

function setupApplicationMenu(window: BrowserWindow) {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件 (&F)",
      submenu: [
        {
          label: "添加媒体文件 (&O)...",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            window.webContents.send("menu:action", "add-files")
          },
        },
        {
          label: "添加媒体目录 (&D)...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            window.webContents.send("menu:action", "add-directory")
          },
        },
        { type: "separator" },
        {
          label: "打开日志目录",
          click: () => {
            const logDir = app.getPath("logs")
            void shell.openPath(logDir)
          },
        },
        { type: "separator" },
        {
          label: "退出 (&X)",
          accelerator: process.platform === "darwin" ? "Cmd+Q" : "Alt+F4",
          click: () => {
            app.quit()
          },
        },
      ],
    },
    {
      label: "任务 (&T)",
      submenu: [
        {
          label: "生成 / 更新计划",
          accelerator: "CmdOrCtrl+Enter",
          click: () => {
            window.webContents.send("menu:action", "create-plan")
          },
        },
        {
          label: "开始转码",
          accelerator: "F5",
          click: () => {
            window.webContents.send("menu:action", "start-execution")
          },
        },
        {
          label: "终止转码",
          accelerator: "Shift+F5",
          click: () => {
            window.webContents.send("menu:action", "stop-execution")
          },
        },
        { type: "separator" },
        {
          label: "清空任务清单",
          click: () => {
            window.webContents.send("menu:action", "clear-tasks")
          },
        },
      ],
    },
    {
      label: "视图 (&V)",
      submenu: [
        {
          label: "收起 / 展开左侧配置栏",
          accelerator: "CmdOrCtrl+B",
          click: () => {
            window.webContents.send("menu:action", "toggle-sidebar")
          },
        },
        {
          label: "运行日志面板",
          accelerator: "CmdOrCtrl+L",
          click: () => {
            window.webContents.send("menu:action", "toggle-log")
          },
        },
        {
          label: "切换界面主题 (暗黑 / 明亮)",
          click: () => {
            window.webContents.send("menu:action", "toggle-theme")
          },
        },
        { type: "separator" },
        { role: "reload", label: "重新加载 (&R)" },
        { role: "forceReload", label: "强制重新加载" },
        { role: "toggleDevTools", label: "开发者工具 (&I)" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "切换全屏" },
      ],
    },
    {
      label: "帮助 (&H)",
      submenu: [
        {
          label: "偏好设置 (&S)...",
          accelerator: "CmdOrCtrl+,",
          click: () => {
            window.webContents.send("menu:action", "open-settings")
          },
        },
        { type: "separator" },
        {
          label: "打开媒体素材目录",
          click: () => {
            const dataDir = path.resolve(__dirname, "../../../../data/videos")
            if (existsSync(dataDir)) {
              void shell.openPath(dataDir)
            }
          },
        },
        {
          label: "关于 mediac FFmpeg Studio",
          click: () => {
            window.webContents.send("menu:action", "open-settings")
          },
        },
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "mediac FFmpeg Studio · 批量音视频转码工作台",
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

  setupApplicationMenu(mainWindow)

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
handleTrusted(IPC_CHANNELS.STAGE_INPUTS, async (paths: unknown) => {
  if (!Array.isArray(paths)) throw new Error("paths must be an array of strings")
  return ffmpegEnvironment.stageInputs(paths as string[])
})
handleTrusted(IPC_CHANNELS.PLAN_CREATE, (body: Record<string, unknown>) => ffmpegEnvironment.createPlan(body))
handleTrusted(IPC_CHANNELS.EXECUTION_START, async (taskIds: unknown) => {
  if (taskIds !== undefined && (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== "string"))) {
    throw new Error("taskIds must be an array of strings")
  }
  return ffmpegEnvironment.startExecution(taskIds as string[] | undefined)
})
handleTrusted(IPC_CHANNELS.EXECUTION_STOP, () => ffmpegEnvironment.stopExecution())
handleTrusted(IPC_CHANNELS.EXECUTION_SNAPSHOT, () => ffmpegEnvironment.getTaskSnapshot())
handleTrusted(IPC_CHANNELS.SYSTEM_SHOW_IN_FOLDER, async (fullPath: unknown) => {
  if (typeof fullPath !== "string") throw new Error("fullPath must be a string")
  showItemInFolder(fullPath)
})
handleTrusted(IPC_CHANNELS.SYSTEM_OPEN_PATH, async (fullPath: unknown) => {
  if (typeof fullPath !== "string") throw new Error("fullPath must be a string")
  return openPath(fullPath)
})
handleTrusted(IPC_CHANNELS.SYSTEM_NOTIFY, async (payload: unknown) => {
  const p = payload as { title?: string; body?: string }
  if (!p || typeof p !== "object") throw new Error("Invalid notify payload")
  showNotification(p.title || "mediac", p.body || "", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
})
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
    createWindow()
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false)
    })
  })
  .catch((error) => {
    startupLog(`app ready error: ${error.stack || error}`)
    console.error(error)
  })

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on("before-quit", () => {
  try {
    ffmpegEnvironment.dispose()
  } catch (error) {
    startupLog(`dispose error: ${error instanceof Error ? error.stack : String(error)}`)
  }
})
