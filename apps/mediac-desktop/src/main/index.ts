import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, type IpcMainInvokeEvent } from "electron"
import { appendFileSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { transcodeService } from "./ffmpeg-service.js"
import { toSerializable } from "./ipc-serializer.js"
import { openPath, showItemInFolder, showNotification } from "./native.js"
import { IPC_CHANNELS, MENU_ACTIONS, MENU_ACTION_CHANNEL } from "../shared/ipc-channels.js"

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

function summaryFfmpegPath() {
  return transcodeService.getFfmpegPath()
}

/** 菜单动作统一出口：字串取自共享常量，避免与渲染进程拼写漂移 */
function sendMenuAction(window: BrowserWindow, action: (typeof MENU_ACTIONS)[keyof typeof MENU_ACTIONS]) {
  window.webContents.send(MENU_ACTION_CHANNEL, action)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null

function getAppIconPath(): string | undefined {
  const candidates = [
    path.join(__dirname, "../../build/icon.ico"),
    path.join(__dirname, "../../resources/icon.ico"),
    path.join(process.resourcesPath, "icon.ico"),
    path.join(process.resourcesPath, "build/icon.ico"),
  ]
  return candidates.find((c) => existsSync(c))
}

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
  const normalized = frameUrl.replace(/\\/g, "/").toLowerCase()
  return normalized.startsWith("file://") && normalized.includes("/out/renderer/")
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
            sendMenuAction(window, MENU_ACTIONS.ADD_FILES)
          },
        },
        {
          label: "添加媒体目录 (&D)...",
          accelerator: "CmdOrCtrl+Shift+O",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.ADD_DIRECTORY)
          },
        },
        { type: "separator" },
        {
          label: "打开输出目录 (&P)",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.OPEN_OUTPUT_DIR)
          },
        },
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
            sendMenuAction(window, MENU_ACTIONS.CREATE_PLAN)
          },
        },
        {
          label: "开始转码",
          accelerator: "F5",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.START_EXECUTION)
          },
        },
        {
          label: "终止转码",
          accelerator: "Shift+F5",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.STOP_EXECUTION)
          },
        },
        { type: "separator" },
        {
          label: "清空任务清单",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.CLEAR_TASKS)
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
            sendMenuAction(window, MENU_ACTIONS.TOGGLE_SIDEBAR)
          },
        },
        {
          label: "运行日志面板",
          accelerator: "CmdOrCtrl+L",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.TOGGLE_LOG)
          },
        },
        {
          label: "切换界面主题 (暗黑 / 明亮)",
          click: () => {
            sendMenuAction(window, MENU_ACTIONS.TOGGLE_THEME)
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
            sendMenuAction(window, MENU_ACTIONS.OPEN_SETTINGS)
          },
        },
        { type: "separator" },
        {
          // 原实现硬编码开发机 data/videos 路径，打包后必然失效且无声
          label: "打开应用数据目录",
          click: () => {
            void shell.openPath(app.getPath("userData"))
          },
        },
        {
          label: "关于 mediac FFmpeg Studio",
          click: () => {
            void dialog
              .showMessageBox(window, {
                type: "info",
                title: "关于 mediac FFmpeg Studio",
                message: "mediac FFmpeg Studio",
                detail: [
                  `版本 ${app.getVersion()}`,
                  `Electron ${process.versions.electron} / Node ${process.versions.node}`,
                  `ffmpeg: ${summaryFfmpegPath() || "未检测到"}`,
                  "批量音视频转码工作台 · 基于 mediac CLI 的 ffmpeg 核心",
                ].join("\n"),
                buttons: ["确定"],
                defaultId: 0,
              })
              .catch(() => undefined)
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
    icon: getAppIconPath(),
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

  mainWindow.on("close", (event) => {
    if (transcodeService.isExecuting()) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: "warning",
        buttons: ["取消", "强行退出"],
        defaultId: 0,
        cancelId: 0,
        title: "退出确认",
        message: "当前有转码任务正在进行中！",
        detail: "如果现在退出，转码将被强行中止，正在写入的文件可能损坏。确定要退出吗？",
      })
      if (choice === 0) {
        event.preventDefault()
      }
    }
  })

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    startupLog(`preload-error ${preloadPath}: ${error.stack || error}`)
  })
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    startupLog(`did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`)
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  transcodeService.setEventSink((event) => {
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

app.on("second-instance", () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

handleTrusted(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())
handleTrusted(IPC_CHANNELS.ENV_GET, () => transcodeService.getSummary())
handleTrusted(IPC_CHANNELS.ENV_SET_CUSTOM_PATHS, async (payload: unknown) => {
  if (!payload || typeof payload !== "object") throw new Error("Invalid tool paths payload")
  return transcodeService.setCustomToolPaths(payload as { ffmpeg?: string; ffprobe?: string })
})
handleTrusted(IPC_CHANNELS.STAGE_INPUTS, async (paths: unknown) => {
  if (!Array.isArray(paths)) throw new Error("paths must be an array of strings")
  return transcodeService.stageInputs(paths as string[])
})
handleTrusted(IPC_CHANNELS.PLAN_CREATE, (body: Record<string, unknown>) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("plan body must be a plain object")
  }
  return transcodeService.createPlan(body)
})
handleTrusted(IPC_CHANNELS.EXECUTION_START, async (taskIds: unknown) => {
  if (taskIds !== undefined && (!Array.isArray(taskIds) || taskIds.some((id) => typeof id !== "string"))) {
    throw new Error("taskIds must be an array of strings")
  }
  return transcodeService.startExecution(taskIds as string[] | undefined)
})
handleTrusted(IPC_CHANNELS.EXECUTION_STOP, () => transcodeService.stopExecution())
// S-1 加固：SYSTEM_OPEN_PATH / SYSTEM_SHOW_IN_FOLDER 仅接受主进程已知的路径
// （staged 输入、计划产物、原生对话框授权根），防止被攻破的渲染层打开任意路径
handleTrusted(IPC_CHANNELS.SYSTEM_SHOW_IN_FOLDER, async (fullPath: unknown) => {
  if (typeof fullPath !== "string") throw new Error("fullPath must be a string")
  if (!transcodeService.isKnownMediaPath(fullPath)) {
    throw new Error("Path is not recognized by the main process")
  }
  showItemInFolder(fullPath)
})
handleTrusted(IPC_CHANNELS.SYSTEM_OPEN_PATH, async (fullPath: unknown) => {
  if (typeof fullPath !== "string") throw new Error("fullPath must be a string")
  if (!transcodeService.isKnownMediaPath(fullPath)) {
    throw new Error("Path is not recognized by the main process")
  }
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
    const picked = result.canceled ? [] : result.filePaths
    // 用户亲手选择的路径即视为授权（S-1 白名单的授权来源，主进程侧登记）
    transcodeService.authorizePaths(picked)
    return { paths: picked }
  },
)

app.whenReady()
  .then(async () => {
    startupLog("app ready")
    await transcodeService.initialize()
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
    transcodeService.dispose()
  } catch (error) {
    startupLog(`dispose error: ${error instanceof Error ? error.stack : String(error)}`)
  }
})
