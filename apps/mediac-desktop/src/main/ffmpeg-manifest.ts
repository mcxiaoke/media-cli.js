import path from "node:path"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"

/**
 * 活动任务 manifest 管理：原子写入/清理与崩溃残留临时文件恢复。
 * 由 main 注入 manifest 文件路径，不持有 session 状态。
 * manifest 格式保持不变（runId/taskId/tempPath/outputPath/createdAt），避免数据迁移。
 */
export class FfmpegManifest {
  private readonly manifestPath: string

  constructor(manifestPath: string) {
    this.manifestPath = manifestPath
  }

  /**
   * Manifest 临时产物可信性校验（S-2 加固）。
   *
   * 临时产物由 src/transcode/ffmpeg_task.js 生成在**最终产物同目录**（并无统一 temp 根目录），
   * 因此可强校验的结构约束是：tempPath 与 outputPath 同目录、同扩展名，
   * 且文件名严格形如 `xxx_tmp@<hash>@tmp_.ext`（hash 为 xxHash32 十进制/十六进制数字）。
   * 任一条件不满足即视为不可信、跳过删除——宁残留垃圾文件，勿误删用户文件。
   */
  isManagedTempEntry(entry: { tempPath?: string; outputPath?: string }) {
    const { tempPath, outputPath } = entry
    if (!tempPath || !outputPath) return false
    if (!path.isAbsolute(tempPath) || !path.isAbsolute(outputPath)) return false
    if (path.extname(tempPath) !== path.extname(outputPath)) return false
    const sameDir = (a: string, b: string) => {
      const da = path.dirname(a)
      const db = path.dirname(b)
      return process.platform === "win32" ? da.toLowerCase() === db.toLowerCase() : da === db
    }
    if (!sameDir(tempPath, outputPath)) return false
    return /^.+_tmp@[a-f0-9]+@tmp_(\.[^.]+)?$/.test(path.basename(tempPath))
  }

  async writeTaskManifest(
    tasks: ReadonlyArray<{ id?: string; fileDstTemp?: string; fileDst?: string }>,
    runId: string,
  ) {
    const manifest = tasks.map((task) => ({
      runId,
      taskId: task.id,
      tempPath: task.fileDstTemp,
      outputPath: task.fileDst,
      createdAt: new Date().toISOString(),
    }))
    await mkdir(path.dirname(this.manifestPath), { recursive: true })
    const tempManifest = `${this.manifestPath}.tmp`
    await writeFile(tempManifest, JSON.stringify(manifest, null, 2), "utf8")
    await rename(tempManifest, this.manifestPath)
  }

  async clearTaskManifest() {
    await rm(this.manifestPath, { force: true })
  }

  /** 崩溃残留清理：仅删除通过结构校验的 temp 产物，随后清除 manifest 自身 */
  async recoverStaleTasks() {
    try {
      const raw = await readFile(this.manifestPath, "utf8")
      const entries = JSON.parse(raw) as Array<{ tempPath?: string; outputPath?: string }>
      for (const entry of entries) {
        if (!this.isManagedTempEntry(entry)) continue
        await rm(entry.tempPath as string, { force: true })
      }
      await rm(this.manifestPath, { force: true })
    } catch {
      // Do not block app startup on an unreadable manifest.
    }
  }
}
