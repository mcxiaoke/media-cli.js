/*
 * File: cmd_rollback.js
 * Created: 2026-10-11 14:13:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import fs from "fs-extra"
import path from "path"
import dayjs from "dayjs"
import { confirmDangerousAction, initAutoConfirm } from "../lib/command_utils.js"
import * as log from "../lib/debug.js"
import { ErrorTypes, createError } from "../lib/errors.js"
import { moveSafe } from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import {
    createJournal,
    findLatestManifest,
    getJournalDir,
    listManifests,
    resolveManifestPath,
} from "../lib/journal.js"

export { aliases, builder, command, describe, handler }

const command = "rollback [manifest]"
const aliases = ["undo", "rb"]
const describe = t("rollback.description")

const builder = function addOptions(ya) {
    return ya
        .positional("manifest", {
            describe: t("rollback.manifest"),
            type: "string",
            normalize: true,
        })
        .option("list", {
            alias: "l",
            type: "boolean",
            default: false,
            description: t("rollback.option.list"),
        })
        .option("limit", {
            alias: "n",
            type: "number",
            default: 15,
            description: t("rollback.option.limit"),
        })
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: t("option.common.doit"),
        })
        .option("auto-confirm", {
            alias: "A",
            type: "boolean",
            default: false,
            description: t("option.common.autoConfirm"),
        })
        .option("yes", {
            alias: "y",
            type: "boolean",
            default: false,
            description: t("option.common.yes"),
        })
        .option("force", {
            alias: "f",
            type: "boolean",
            default: false,
            description: "Force rollback even if target already exists",
        })
}

const handler = async function cmdRollback(argv) {
    initAutoConfirm(argv)
    const logTag = "Rollback"
    const testMode = !argv.doit

    const isListMode =
        Boolean(argv.list) ||
        argv.manifest === "list" ||
        (Array.isArray(argv._) && argv._.includes("list"))

    if (isListMode) {
        const journalDir = getJournalDir()
        log.show(chalk.cyan("=".repeat(70)))
        log.show(logTag, `Operation History (Directory: ${journalDir})`)
        log.show(chalk.cyan("=".repeat(70)))

        const items = await listManifests({ limit: argv.limit || 15 })
        if (items.length === 0) {
            log.showYellow(logTag, `No operation history found in ${journalDir}`)
            log.show(chalk.cyan("=".repeat(70)))
            return
        }

        items.forEach((item, idx) => {
            const num = chalk.bold.yellow(`#${idx + 1}`.padEnd(5))
            const time = chalk.gray(dayjs(item.startTime).format("YYYY-MM-DD HH:mm:ss"))
            const cmd = chalk.magenta(`[${item.command}]`.padEnd(10))
            const dry = item.dryRun ? chalk.yellow(" [DRY-RUN]") : ""
            const succ = item.summary.succeeded
            const total = item.summary.total || item.totalOperations
            const stats = chalk.green(`${succ}/${total} ops`.padEnd(12))
            const status =
                item.status === "success" ? chalk.green(item.status) : chalk.yellow(item.status)
            const file = chalk.cyan(path.basename(item.manifestPath))

            log.show(`${num} ${time}  ${cmd}${dry}  ${stats}  (${status})  ${file}`)
        })

        log.show(chalk.gray("-".repeat(70)))
        log.show(logTag, `To rollback an operation, run:`)
        log.show(chalk.cyan(`  mediac rollback <#index | manifest_file> [--doit]`))
        log.show(chalk.gray(`  Example: mediac rollback 1 --doit`))
        log.show(chalk.cyan("=".repeat(70)))
        return
    }

    let manifestPath
    if (argv.manifest) {
        manifestPath = await resolveManifestPath(argv.manifest)
        if (!manifestPath || !(await fs.pathExists(manifestPath))) {
            throw createError(
                ErrorTypes.FILE_NOT_FOUND,
                `Manifest not found for '${argv.manifest}'. Run 'mediac rollback --list' to see available history.`,
            )
        }
    } else {
        manifestPath = await findLatestManifest()
        if (!manifestPath) {
            throw createError(
                ErrorTypes.FILE_NOT_FOUND,
                `No history manifests found. Run 'mediac rollback --list' to check.`,
            )
        }
        log.show(
            logTag,
            chalk.yellow(
                `No manifest specified. Auto-selected latest operation: ${path.basename(manifestPath)}`,
            ),
        )
    }

    let manifestData
    try {
        manifestData = await fs.readJson(manifestPath)
    } catch (err) {
        throw createError(
            ErrorTypes.INVALID_ARGUMENT,
            `Failed to parse manifest JSON '${manifestPath}': ${err.message}`,
        )
    }

    if (!manifestData.operations || !Array.isArray(manifestData.operations)) {
        throw createError(
            ErrorTypes.INVALID_ARGUMENT,
            `Invalid manifest format: 'operations' array is missing`,
        )
    }

    log.show(chalk.cyan("=".repeat(70)))
    log.show(logTag, `Loaded manifest: ${manifestPath}`)
    log.show(
        logTag,
        `Original command: ${manifestData.command || "unknown"} (${manifestData.sessionId || "no-session"})`,
    )
    log.show(logTag, `Original time: ${manifestData.startTime || "unknown"}`)
    log.show(chalk.cyan("=".repeat(70)))

    // 筛选出成功的、可逆的操作
    const candidates = manifestData.operations.filter(
        (op) => op.status === "success" && op.reversible,
    )

    if (candidates.length === 0) {
        log.showYellow(logTag, "No reversible operations found in manifest.")
        return
    }

    // 严格倒序（LIFO / Reverse Order）回滚
    const rollbackQueue = [...candidates].reverse()

    log.show(logTag, `Total ${rollbackQueue.length} operation(s) ready to rollback:`)
    rollbackQueue.slice(0, 10).forEach((op, idx) => {
        const from = op.dst ? helper.pathShort(op.dst) : "unknown"
        const to = op.src ? helper.pathShort(op.src) : "unknown"
        log.show(logTag, `  #${idx + 1} [${op.action}] ${from} => ${to}`)
    })
    if (rollbackQueue.length > 10) {
        log.show(logTag, `  ... and ${rollbackQueue.length - 10} more operation(s)`)
    }

    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) +++++++++=")

    const answer = await confirmDangerousAction(
        t("rollback.confirm", { count: rollbackQueue.length }),
    )
    if (!answer) {
        log.showYellow(logTag, t("operation.cancelled"))
        return
    }

    const journal = createJournal({
        command: "rollback",
        argv,
        cwd: process.cwd(),
        input: manifestPath,
        dryRun: testMode,
    })

    let succeeded = 0
    let failed = 0
    let skipped = 0

    for (let i = 0; i < rollbackQueue.length; i++) {
        const op = rollbackQueue[i]
        const ipx = `[${i + 1}/${rollbackQueue.length}]`

        // 确定当前文件位置（原操作的目标 dst）与需恢复的位置（原操作的源 src）
        const currentFile = op.dst
        const restoreTarget = op.src

        if (!currentFile || !restoreTarget) {
            log.showYellow(logTag, `${ipx} Skip[MissingPath]: invalid operation entry #${op.id}`)
            skipped++
            journal.record({
                action: "MOVE",
                src: currentFile,
                dst: restoreTarget,
                status: "skipped",
                error: "Missing src or dst in manifest",
            })
            continue
        }

        // 前置安全校验 1：当前文件是否存在
        if (!(await fs.pathExists(currentFile))) {
            log.showYellow(
                logTag,
                `${ipx} Skip[CurrentNotFound]: <${helper.pathShort(currentFile)}>`,
            )
            skipped++
            journal.record({
                action: "MOVE",
                src: currentFile,
                dst: restoreTarget,
                status: "skipped",
                error: "Current file not found",
            })
            continue
        }

        // 前置安全校验 2：恢复目标是否已被占用
        if (await fs.pathExists(restoreTarget)) {
            if (!argv.force) {
                log.showRed(
                    logTag,
                    `${ipx} Conflict: restore target already exists! <${helper.pathShort(restoreTarget)}>`,
                )
                failed++
                journal.record({
                    action: "MOVE",
                    src: currentFile,
                    dst: restoreTarget,
                    status: "failed",
                    error: "Restore target already exists",
                })
                continue
            }
        }

        if (testMode) {
            log.show(
                logTag,
                `[DRY RUN] Will rollback: <${helper.pathShort(currentFile)}> => <${helper.pathShort(restoreTarget)}>`,
            )
            journal.record({
                action: "MOVE",
                src: currentFile,
                dst: restoreTarget,
                size: op.size,
                status: "dryrun",
            })
            succeeded++
            continue
        }

        try {
            await fs.ensureDir(path.dirname(restoreTarget))
            await moveSafe(currentFile, restoreTarget)
            log.show(
                logTag,
                chalk.green(`OK:`),
                `<${helper.pathShort(currentFile)}> => <${helper.pathShort(restoreTarget)}>`,
            )
            journal.record({
                action: "MOVE",
                src: currentFile,
                dst: restoreTarget,
                size: op.size,
                status: "success",
            })
            succeeded++
        } catch (error) {
            log.error(logTag, `Failed: <${currentFile}> => <${restoreTarget}> - ${error.message}`)
            journal.record({
                action: "MOVE",
                src: currentFile,
                dst: restoreTarget,
                size: op.size,
                status: "failed",
                error: error.message,
            })
            failed++
        }
    }

    await journal.save()
    journal.printSummary()

    log.show(chalk.cyan("=".repeat(70)))
    log.show(
        logTag,
        `Rollback finished: ${succeeded} restored${testMode ? " [DRY RUN]" : ""}, ${failed} failed, ${skipped} skipped.`,
    )
    log.show(chalk.cyan("=".repeat(70)))
}
