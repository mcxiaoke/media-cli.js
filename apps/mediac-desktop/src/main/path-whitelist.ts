import path from "node:path"
import { readFile, rename, writeFile } from "node:fs/promises"

/**
 * 原生对话框已选根路径白名单（S-1 加固的一部分）。
 *
 * 纯配置/持久化辅助工具：由 main 注入存储文件路径，**不持有任何 session 状态**。
 * 复合判定 isKnownMediaPath 留在 ffmpeg-service.ts，由运行时状态（staged/currentPlan）
 * 与白名单组合，避免反向引用与职责倒挂。
 */
export class PathWhitelist {
  private readonly authorizedRoots = new Set<string>()
  private readonly storageFile: string

  constructor(storageFile: string) {
    this.storageFile = storageFile
  }

  /** 路径比对键：绝对路径 + win32 大小写不敏感 */
  normalizeForCompare(p: string) {
    const resolved = path.resolve(p)
    return process.platform === "win32" ? resolved.toLowerCase() : resolved
  }

  /** 登记用户通过原生对话框明确选择的路径（来源不可被渲染层伪造） */
  authorizePaths(paths: unknown) {
    if (!Array.isArray(paths)) return
    let changed = false
    for (const p of paths) {
      if (typeof p !== "string" || !p || !path.isAbsolute(p)) continue
      const key = this.normalizeForCompare(p)
      if (this.authorizedRoots.has(key)) continue
      this.authorizedRoots.add(key)
      changed = true
    }
    if (changed) {
      const tmp = `${this.storageFile}.tmp`
      writeFile(tmp, JSON.stringify([...this.authorizedRoots], null, 2), "utf8")
        .then(() => rename(tmp, this.storageFile))
        .catch(() => {
          // 授权持久化失败不阻塞主流程，本次会话内仍然有效
        })
    }
  }

  /** 启动时从本地 JSON 恢复历史授权 */
  async loadAuthorizedPaths() {
    try {
      const raw = await readFile(this.storageFile, "utf8")
      const list = JSON.parse(raw)
      if (Array.isArray(list)) this.authorizePaths(list)
    } catch {
      // 文件不存在或损坏时静默忽略，等价于无历史授权
    }
  }

  /** target 是否属于某个已授权根自身或其子路径 */
  isAuthorizedRoot(targetPath: string): boolean {
    const target = this.normalizeForCompare(targetPath)
    for (const root of this.authorizedRoots) {
      const prefix = root.endsWith(path.sep) ? root : root + path.sep
      if (target === root || target.startsWith(prefix)) return true
    }
    return false
  }
}
