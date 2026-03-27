/*
 * File: command_utils.js
 * Created: 2026-03-27
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * Command utilities - Common patterns extracted from command handlers
 */

import chalk from "chalk"
import * as cliProgress from "cli-progress"
import fs from "fs-extra"
import inquirer from "inquirer"
import { cpus } from "os"
import path from "path"
import pMap from "p-map"
import * as log from "./debug.js"
import { t } from "./i18n.js"

export const DEFAULT_CONCURRENCY = cpus().length

export async function confirmAction(message, defaultValue = false) {
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: defaultValue,
            message: typeof message === "string" ? chalk.bold.green(message) : message,
        },
    ])
    return answer.yes
}

export async function confirmDangerousAction(message, defaultValue = false) {
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: defaultValue,
            message: chalk.bold.red(message),
        },
    ])
    return answer.yes
}

export async function confirmContinue() {
    return await confirmAction(t("common.continue.processing"))
}

export function createProgressBar(options = {}) {
    const defaultOptions = {
        etaBuffer: 300,
        format: options.format || cliProgress.Presets.shades_classic,
    }
    return new cliProgress.SingleBar(defaultOptions, cliProgress.Presets.shades_classic)
}

export function shouldShowProgressBar(fileCount, threshold = 9999) {
    return fileCount > threshold && !log.isVerbose()
}

export function withProgressBar(files, processor, options = {}) {
    const { concurrency = DEFAULT_CONCURRENCY, onProgress } = options
    const needBar = shouldShowProgressBar(files.length)
    const bar = needBar ? createProgressBar() : null

    let lastUpdate = 0
    const updateInterval = options.updateInterval || 2000

    const wrappedProcessor = async (item, index) => {
        const result = await processor(item, index)

        if (needBar && bar) {
            const now = Date.now()
            if (now - lastUpdate > updateInterval) {
                bar.update(index + 1)
                lastUpdate = now
            }
        }

        onProgress?.(index, item, result)
        return result
    }

    if (needBar && bar) {
        bar.start(files.length, 0)
    }

    return pMap(files, wrappedProcessor, { concurrency })
        .then((results) => {
            if (needBar && bar) {
                bar.update(files.length)
                bar.stop()
            }
            return results
        })
        .catch((error) => {
            if (needBar && bar) {
                bar.stop()
            }
            throw error
        })
}

export function handleTestMode(testMode, logTag, message) {
    if (testMode) {
        log.logWarn(logTag, `++++++++++ ${message || t("mode.test")} ++++++++++`)
        return true
    }
    return false
}

export function checkTestMode(argv) {
    return !argv.doit
}

export async function validateInputPath(input) {
    if (!input) {
        throw new Error(t("input.path.empty"))
    }
    const resolved = path.resolve(input)
    if (!(await fs.pathExists(resolved))) {
        throw new Error(t("input.path.not.exists", { path: resolved }))
    }
    return resolved
}

export function createWalkOptions(filterOptions = {}) {
    const {
        needStats = true,
        entryFilter = null,
        withDirs = false,
        withFiles = true,
        maxDepth = 99,
    } = filterOptions

    return {
        needStats,
        withDirs,
        withFiles,
        maxDepth,
        entryFilter,
    }
}

export function buildFileFilter(include, exclude, regex = true) {
    return (filename) => {
        if (include) {
            const pattern = regex ? new RegExp(include, "i") : include
            if (regex ? !pattern.test(filename) : !filename.includes(include)) {
                return false
            }
        }
        if (exclude) {
            const pattern = regex ? new RegExp(exclude, "i") : exclude
            if (regex ? pattern.test(filename) : filename.includes(exclude)) {
                return false
            }
        }
        return true
    }
}

export function addEntryProps(files, startIndex = 0) {
    const total = files.length
    return files.map((f, i) => ({
        ...f,
        index: startIndex + i,
        total,
    }))
}

export async function writeJsonReport(data, outputDir, filename) {
    await fs.ensureDir(outputDir)
    const outputPath = path.join(outputDir, filename)
    await fs.writeJson(outputPath, data, { spaces: 2 })
    return outputPath
}

export function formatProgress(index, total) {
    return `${index + 1}/${total}`
}

export function getConcurrency(argv, defaultMultiplier = 1) {
    return argv.jobs || Math.max(1, Math.floor(DEFAULT_CONCURRENCY * defaultMultiplier))
}

export async function abortIfCancelled(confirmed, logTag) {
    if (!confirmed) {
        log.logWarn(logTag, t("common.aborted.by.user"))
        return true
    }
    return false
}

export async function withConfirmation(files, processor, options = {}) {
    const {
        logTag = "Command",
        confirmMessage = t("common.continue.processing"),
        isDangerous = false,
    } = options

    const confirmed = isDangerous
        ? await confirmDangerousAction(confirmMessage)
        : await confirmAction(confirmMessage)

    if (await abortIfCancelled(confirmed, logTag)) {
        return null
    }

    return processor(files)
}

export function logOperationStart(logTag, argv) {
    log.logInfo(logTag, argv)
    log.logInfo(logTag, `Start at: ${new Date().toISOString()}`)
}

export function logOperationEnd(logTag, startMs, successCount, errorCount = 0) {
    const duration = Date.now() - startMs
    log.logSuccess(
        logTag,
        t("operation.completed", {
            success: successCount,
            error: errorCount,
        }),
        `(${(duration / 1000).toFixed(2)}s)`,
    )
}
