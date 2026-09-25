import fs from "fs-extra"
import path from "path"
import pMap from "p-map"
import { addEntryProps } from "../../lib/rename.js"
import { buildCliTask } from "./ffmpeg_task.js"
import { createInternalExecutionPlan } from "./ffmpeg_plan_snapshot.js"
import * as helper from "../../lib/helper.js"

export const PLAN_OUTCOME = Object.freeze({
    READY: "ready",
    EMPTY: "empty",
    ALL_SKIPPED: "all_skipped",
})

export const PLAN_ERROR_CODE = Object.freeze({
    NO_INPUTS: "FFMPEG_NO_INPUTS",
    STALE_PLAN: "FFMPEG_STALE_PLAN",
    DELETE_SOURCE_CONFIRMATION: "FFMPEG_DELETE_SOURCE_CONFIRMATION_REQUIRED",
})

export class FFmpegPlanError extends Error {
    constructor(code, message, details = {}) {
        super(message)
        this.name = "FFmpegPlanError"
        this.code = code
        Object.assign(this, details)
    }
}

/**
 * Shared plan preparation for CLI, WebUI and future adapters.
 * UI-specific confirmation, logging and transport stay outside this module.
 */
export async function buildFFmpegTasks({
    entries = [],
    preset,
    argv = {},
    testMode = false,
    concurrency = 1,
    buildTask = buildCliTask,
    buildTaskDeps = {},
    onTaskError = null,
    signal = null,
} = {}) {
    addEntryProps(entries)
    const prepared = entries.map((entry) => ({
        ...entry,
        preset,
        argv: structuredClone(argv),
        testMode,
        signal,
        errorFile: argv.errorFile,
    }))
    const results = await pMap(
        prepared,
        async (entry) => {
            try {
                return await buildTask(entry, buildTaskDeps)
            } catch (error) {
                if (typeof onTaskError === "function") {
                    onTaskError(entry, error)
                }
                return null
            }
        },
        { concurrency },
    )
    return results.filter(Boolean)
}

function taskDuration(task) {
    return task?.dstArgs?.srcDuration || task?.info?.duration || task?.duration || 0
}

export function isExecutableTask(task) {
    return Boolean(
        task &&
        task.status !== "skipped" &&
        task.skipped !== true &&
        task.dstExists !== true &&
        task.fileDst,
    )
}

/**
 * Build one internal execution plan and expose a stable preparation outcome.
 *
 * An empty task list and an all-skipped list are valid plans. Callers can
 * present them to the user or choose their transport-specific response without
 * rebuilding tasks or reimplementing skip detection.
 */
export async function prepareFFmpegPlan({
    entries = [],
    preset,
    argv = {},
    mode = "plan",
    testMode = false,
    concurrency = 1,
    buildTask = buildCliTask,
    buildTaskDeps = {},
    onTaskError = null,
    signal = null,
    id,
    previewCmd = "",
} = {}) {
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new FFmpegPlanError(
            PLAN_ERROR_CODE.NO_INPUTS,
            "No media files found in specified inputs",
        )
    }

    const tasks = await buildFFmpegTasks({
        entries,
        preset,
        argv,
        testMode,
        concurrency,
        buildTask,
        buildTaskDeps,
        onTaskError,
        signal,
    })
    const executableTasks = tasks.filter(isExecutableTask)
    const outcome =
        tasks.length === 0
            ? PLAN_OUTCOME.EMPTY
            : executableTasks.length === 0
              ? PLAN_OUTCOME.ALL_SKIPPED
              : PLAN_OUTCOME.READY
    const totalDuration = tasks.reduce((sum, task) => sum + taskDuration(task), 0)
    const totalSize = tasks.reduce((sum, task) => sum + (task.size || 0), 0)
    const plan = createFFmpegExecutionPlan({
        id,
        preset,
        argv,
        mode,
        tasks,
        totalDuration,
        totalSize,
        previewCmd,
    })

    return {
        entries,
        tasks,
        executableTasks,
        outcome,
        totalDuration,
        totalSize,
        plan,
    }
}

export function createFFmpegExecutionPlan({
    id,
    preset,
    argv = {},
    mode = "plan",
    tasks = [],
    totalDuration = 0,
    totalSize = 0,
    previewCmd = "",
} = {}) {
    return createInternalExecutionPlan({
        id,
        presetName: preset?.name || "",
        preset,
        mode,
        argv,
        tasks,
        totalDuration,
        totalSize,
        previewCmd,
    })
}

export function isPlanCurrent(expected, current) {
    return Boolean(expected && current && expected.id && current.id && expected.id === current.id)
}

export function assertPlanCurrent(expected, current) {
    if (!isPlanCurrent(expected, current)) {
        throw new FFmpegPlanError(
            PLAN_ERROR_CODE.STALE_PLAN,
            "The execution plan is stale and no longer matches the current plan",
            { expectedPlanId: expected?.id || null, currentPlanId: current?.id || null },
        )
    }
}

/**
 * Delete source files only after a successful output commit and only when the
 * caller supplied explicit confirmation. The same helper is used by CLI and
 * WebUI; dry-run never enters the deletion path.
 */
export async function deleteCompletedSources({
    plan,
    testMode = false,
    confirmDeleteSource = false,
    includeExisting = false,
    fsApi = fs,
    safeRemove = helper.safeRemove,
} = {}) {
    const requested = plan?.argv?.deleteSourceFiles === true
    const result = {
        requested,
        confirmed: false,
        deleted: [],
        kept: [],
        failed: [],
    }
    if (!requested) return result
    if (testMode) {
        result.kept.push(...(plan.tasks || []).map((task) => task.path).filter(Boolean))
        return result
    }

    const confirmation =
        typeof confirmDeleteSource === "function"
            ? await confirmDeleteSource({ plan })
            : confirmDeleteSource === true
    if (!confirmation) return result
    result.confirmed = true

    const completed = (plan.tasks || []).filter((task) => {
        const outputPath = task.fileDst || task.dstExistsPath
        const isCompleted = task.status === "done"
        const isExistingOutput =
            includeExisting && task.dstExists === true && (task.dstExistsSize || 0) > 0
        return (
            (isCompleted || isExistingOutput) &&
            outputPath &&
            task.path &&
            path.resolve(task.path) !== path.resolve(outputPath)
        )
    })
    for (const task of completed) {
        const outputPath = task.fileDst || task.dstExistsPath
        const outputStat = await fsApi.stat(outputPath).catch(() => null)
        if (!outputStat || outputStat.size <= 0) {
            result.kept.push(task.path)
            continue
        }
        let removed
        try {
            removed = await safeRemove(task.path)
        } catch {
            // Keep the source in place when the adapter unexpectedly throws.
        }
        if (removed) result.deleted.push(task.path)
        else result.failed.push(task.path)
    }
    return result
}
