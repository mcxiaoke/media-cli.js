import { BrowserWindow, Notification, powerSaveBlocker, shell } from "electron"
import { existsSync, statSync } from "node:fs"

let powerSaveBlockerId: number | null = null

export async function openPath(fullPath: string): Promise<string> {
  return shell.openPath(fullPath)
}

export function showItemInFolder(fullPath: string): void {
  try {
    if (existsSync(fullPath)) {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        void shell.openPath(fullPath)
        return
      }
    }
  } catch {
    // fallback to showItemInFolder
  }
  shell.showItemInFolder(fullPath)
}

export function showNotification(title: string, body: string, onClick?: () => void): void {
  if (Notification.isSupported()) {
    const notification = new Notification({ title, body })
    if (onClick) {
      notification.on("click", onClick)
    }
    notification.show()
  }
}

export function startPreventSuspension(): void {
  if (powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension")
  }
}

export function stopPreventSuspension(): void {
  if (powerSaveBlockerId !== null) {
    if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId)
    }
    powerSaveBlockerId = null
  }
}

export function updateTaskbarProgress(progress: number, window?: BrowserWindow | null): void {
  const win = window || BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return

  if (progress < 0) {
    win.setProgressBar(-1)
  } else {
    win.setProgressBar(Math.max(0, Math.min(1, progress)))
  }
}

export function setTaskbarProgressError(window?: BrowserWindow | null): void {
  const win = window || BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return
  win.setProgressBar(1, { mode: "error" })
}
