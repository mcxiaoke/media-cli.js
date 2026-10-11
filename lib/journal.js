/*
 * File: journal.js
 * Created: 2026-10-11 14:05:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import dayjs from "dayjs"
import fs from "fs-extra"
import path from "path"
import { randomString } from "./core.js"
import { copyLogTo, getLogRootDir, show, showGreen, showYellow } from "./debug.js"

const activeJournals = new Set()

/**
 * 获取 Journal Manifest 存储根目录
 * @returns {string} 目录绝对路径
 */
export function getJournalDir() {
    return path.join(getLogRootDir(), "journals")
}

/**
 * 列出历史操作清单
 * @param {Object} [options={}]
 * @param {number} [options.limit=20] - 最大返回条数
 * @param {string} [options.dir] - 自定义目录
 * @param {string} [options.command] - 命令名称过滤
 * @returns {Promise<Array<Object>>}
 */
export async function listManifests(options = {}) {
    const targetDir = options.dir || getJournalDir()
    const manifests = []

    if (!(await fs.pathExists(targetDir))) {
        return []
    }

    try {
        const files = await fs.readdir(targetDir)
        for (const file of files) {
            if (!file.endsWith(".json")) continue
            const fullPath = path.join(targetDir, file)

            try {
                const stat = await fs.stat(fullPath)
                if (!stat.isFile()) continue
                const data = await fs.readJson(fullPath)
                if (!data.operations || !Array.isArray(data.operations)) continue

                if (options.command && data.command !== options.command) {
                    continue
                }

                manifests.push({
                    manifestPath: fullPath,
                    fileName: file,
                    sessionId: data.sessionId || path.basename(file, ".json"),
                    command: data.command || "unknown",
                    startTime: data.startTime || stat.mtime.toISOString(),
                    endTime: data.endTime,
                    status: data.status || "unknown",
                    dryRun: Boolean(data.dryRun),
                    summary: data.summary || {
                        total: data.operations.length,
                        succeeded: data.operations.filter(
                            (o) => o.status === "success" || o.status === "dryrun",
                        ).length,
                        failed: data.operations.filter((o) => o.status === "failed").length,
                        skipped: data.operations.filter((o) => o.status === "skipped").length,
                    },
                    totalOperations: data.operations.length,
                    mtime: stat.mtime,
                })
            } catch {
                // 忽略无效或损坏的 json 文件
            }
        }
    } catch {
        // 忽略读取目录异常
    }

    // 按 startTime 倒序排序（最新的在最前）
    manifests.sort((a, b) => {
        const timeA = new Date(a.startTime).getTime() || a.mtime.getTime()
        const timeB = new Date(b.startTime).getTime() || b.mtime.getTime()
        return timeB - timeA
    })

    const limit = options.limit && options.limit > 0 ? options.limit : 20
    return manifests.slice(0, limit)
}

/**
 * 查找最近一次操作的 Manifest 文件路径
 * @param {Object} [options={}]
 * @returns {Promise<string|null>}
 */
export async function findLatestManifest(options = {}) {
    const list = await listManifests({ ...options, limit: 1 })
    return list[0]?.manifestPath || null
}

/**
 * 解析用户输入的 manifest 引用（支持绝对/相对路径、历史编号 #1、文件名或 session ID）
 * @param {string|number} input - 用户输入
 * @returns {Promise<string|null>}
 */
export async function resolveManifestPath(input) {
    if (!input) return null

    // 1. 若直接是已存在的文件路径
    const directPath = path.resolve(String(input))
    if (await fs.pathExists(directPath)) {
        return directPath
    }

    const journalDir = getJournalDir()
    // 2. 检查是否在 journal 目录下的文件名（带或不带 .json）
    const candidateInJournal = path.join(
        journalDir,
        String(input).endsWith(".json") ? String(input) : `${input}.json`,
    )
    if (await fs.pathExists(candidateInJournal)) {
        return candidateInJournal
    }

    // 3. 检查是否是历史记录序号（例如 "1", 1, "#1"）
    const cleanNum = String(input).replace(/^#/, "").trim()
    const num = parseInt(cleanNum, 10)
    if (!isNaN(num) && num > 0) {
        const list = await listManifests({ limit: Math.max(num, 50) })
        if (num <= list.length) {
            return list[num - 1].manifestPath
        }
    }

    // 4. 检查是否按 session id 前缀匹配
    const all = await listManifests({ limit: 100 })
    const matched = all.find(
        (m) => m.sessionId === String(input) || m.fileName.startsWith(String(input)),
    )
    if (matched) {
        return matched.manifestPath
    }

    return null
}

/**
 * 过滤 argv 中的内部属性或敏感字段，得到干净的参数快照
 * @param {Object} [argv={}]
 * @returns {Object}
 */
function sanitizeArgv(argv = {}) {
    const clean = {}
    for (const [key, value] of Object.entries(argv)) {
        if (key === "$0" || key === "_") continue
        clean[key] = value
    }
    return clean
}

/**
 * 创建一个操作事务记账实例
 *
 * @param {Object} options
 * @param {string} options.command - 命令名称（如 moveup, rename, prefix, remove）
 * @param {Object} [options.argv={}] - 命令行参数
 * @param {string} [options.cwd=process.cwd()] - 工作目录
 * @param {string} [options.input] - 输入路径
 * @param {string} [options.output] - 输出路径
 * @param {boolean} [options.dryRun=false] - 是否测试模式
 * @returns {OperationJournal}
 */
export function createJournal(options = {}) {
    const journal = new OperationJournal(options)
    activeJournals.add(journal)
    return journal
}

export class OperationJournal {
    constructor(options = {}) {
        this.version = "1.0"
        this.command = options.command || "unknown"
        const now = dayjs()
        this.nowDateStr = now.format("YYYYMMDD_HHmmss")
        this.sessionId = `${this.command}_${this.nowDateStr}_${randomString(4).toLowerCase()}`
        this.commandArgs = sanitizeArgv(options.argv)
        this.cwd = options.cwd || process.cwd()
        this.input = options.input ? path.resolve(options.input) : undefined
        this.output = options.output ? path.resolve(options.output) : undefined
        this.dryRun = Boolean(options.dryRun)
        this.startTime = now.toISOString()
        this.endTime = null
        this.status = "pending"
        this.summary = {
            total: 0,
            succeeded: 0,
            failed: 0,
            skipped: 0,
        }
        this.operations = []
        this.saved = false
        this.manifestPath = path.join(getJournalDir(), `${this.sessionId}.json`)
    }

    /**
     * 获取清单文件路径
     * @returns {string}
     */
    getManifestPath() {
        return this.manifestPath
    }

    /**
     * 记录一条文件系统变更操作
     *
     * @param {Object} op
     * @param {"MOVE"|"RENAME"|"TRASH"|"DELETE"|"MKDIR"} op.action - 操作类型
     * @param {string} op.src - 源文件/目录绝对路径
     * @param {string} [op.dst] - 目标文件/目录绝对路径
     * @param {boolean} [op.isDir=false] - 是否为目录
     * @param {number} [op.size=0] - 文件大小（字节）
     * @param {"success"|"failed"|"skipped"|"dryrun"} [op.status="success"] - 执行状态
     * @param {string} [op.error] - 错误信息（若失败）
     * @param {boolean} [op.reversible] - 是否可自动反向回滚
     * @param {Object} [op.meta] - 附加元数据
     * @returns {Object} 记录的操作项
     */
    record(op) {
        this.summary.total++

        const isDryRun = op.status === "dryrun" || (this.dryRun && !op.error)
        const isSkipped = op.status === "skipped"
        const isFailed = op.status === "failed" || Boolean(op.error)

        let resolvedStatus = "success"
        if (isDryRun) resolvedStatus = "dryrun"
        else if (isSkipped) resolvedStatus = "skipped"
        else if (isFailed) resolvedStatus = "failed"

        if (resolvedStatus === "success" || resolvedStatus === "dryrun") {
            this.summary.succeeded++
        } else if (resolvedStatus === "failed") {
            this.summary.failed++
        } else if (resolvedStatus === "skipped") {
            this.summary.skipped++
        }

        let reversible = op.reversible
        if (reversible === undefined) {
            // DELETE 默认不可逆，MOVE/RENAME/TRASH 默认可逆
            reversible = op.action !== "DELETE"
        }

        const entry = {
            id: this.operations.length + 1,
            timestamp: new Date().toISOString(),
            action: op.action,
            src: op.src ? path.resolve(op.src) : undefined,
            dst: op.dst ? path.resolve(op.dst) : undefined,
            isDir: Boolean(op.isDir),
            size: typeof op.size === "number" ? op.size : 0,
            status: resolvedStatus,
            reversible: Boolean(reversible),
            error: op.error || undefined,
            meta: op.meta || undefined,
        }

        this.operations.push(entry)
        return entry
    }

    /**
     * 将当前数据序列化为 JSON 对象
     * @returns {Object}
     */
    toJSON() {
        return {
            version: this.version,
            sessionId: this.sessionId,
            command: this.command,
            commandArgs: this.commandArgs,
            cwd: this.cwd,
            input: this.input,
            output: this.output,
            dryRun: this.dryRun,
            startTime: this.startTime,
            endTime: this.endTime || new Date().toISOString(),
            status: this.status,
            summary: this.summary,
            operations: this.operations,
        }
    }

    /**
     * 保存 Manifest 到 AppData 目录
     * @param {string} [finalStatus] - 最终状态（"success"|"partial"|"failed"）
     * @returns {Promise<string>} 清单文件路径
     */
    async save(finalStatus) {
        this.endTime = new Date().toISOString()
        if (finalStatus) {
            this.status = finalStatus
        } else if (this.summary.failed > 0 && this.summary.succeeded > 0) {
            this.status = "partial"
        } else if (this.summary.failed > 0 && this.summary.succeeded === 0) {
            this.status = "failed"
        } else {
            this.status = "success"
        }

        await fs.ensureDir(getJournalDir())
        const content = JSON.stringify(this.toJSON(), null, 2)
        await fs.writeFile(this.manifestPath, content, "utf8")
        this.saved = true
        activeJournals.delete(this)
        return this.manifestPath
    }

    /**
     * 同步保存（在进程意外退出或异常中断时兜底落盘）
     */
    saveSync() {
        if (this.saved || this.operations.length === 0) return
        this.endTime = new Date().toISOString()
        this.status = "interrupted"
        try {
            fs.ensureDirSync(getJournalDir())
            const content = JSON.stringify(this.toJSON(), null, 2)
            fs.writeFileSync(this.manifestPath, content, "utf8")
            this.saved = true
        } catch {
            // 忽略退出异常
        }
    }

    /**
     * 复制 Journal 和当前日志到指定目标目录（例如 output 目录或 deleted 目录）
     *
     * @param {string|string[]} targetDirs - 目标目录或目录数组
     * @returns {Promise<string[]>} 已复制的目标路径列表
     */
    async copyTo(targetDirs) {
        if (!targetDirs) return []
        const dirs = (Array.isArray(targetDirs) ? targetDirs : [targetDirs]).filter(Boolean)
        const copied = []

        // 先确保主文件已落盘
        if (!this.saved) {
            await this.save()
        }

        for (const dir of dirs) {
            try {
                const resolvedDir = path.resolve(dir)
                await fs.ensureDir(resolvedDir)
                // 1. 复制 journal
                const manifestName = path.basename(this.manifestPath)
                const targetManifest = path.join(resolvedDir, manifestName)
                await fs.copy(this.manifestPath, targetManifest, { overwrite: true })
                copied.push(targetManifest)

                // 2. 复制 log 文件
                await copyLogTo(resolvedDir)
            } catch {
                // 静默容错
            }
        }
        return copied
    }

    /**
     * 终端打印操作与 Manifest 摘要
     */
    printSummary() {
        if (this.operations.length === 0) return

        show(chalk.gray("-".repeat(70)))
        const tag = "Journal"
        if (this.dryRun) {
            showYellow(
                tag,
                `[DRY RUN] ${this.summary.succeeded} operation(s) planned, ${this.summary.failed} failed.`,
            )
        } else {
            showGreen(
                tag,
                `Completed: ${this.summary.succeeded} succeeded, ${this.summary.failed} failed, ${this.summary.skipped} skipped.`,
            )
        }

        const manifestUri = this.manifestPath.split(path.sep).join("/")
        show(tag, `Manifest saved to: file:///${manifestUri}`)

        if (!this.dryRun && this.summary.succeeded > 0) {
            showYellow(tag, `To rollback this operation, run:`)
            show(chalk.cyan(`  mediac rollback "${this.manifestPath}"`))
        }
        show(chalk.gray("-".repeat(70)))
    }
}

// 统一退出兜底：若进程中途中断且有未落盘 Journal，同步写盘
process.on("exit", () => {
    for (const j of activeJournals) {
        j.saveSync()
    }
})
