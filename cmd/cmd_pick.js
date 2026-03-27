/*
 * Project: mediacli.js
 * Created: 2026-02-13 17:16:15
 * Modified: 2026-03-24
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 * 模块：照片智能挑选 (Pick)
 *
 * 功能描述：
 * 从大量照片中，按照时间线和预设规则智能挑选出一部分照片，用于制作照片日记或精选集。
 *
 * 主要特性：
 * 1. 输入源支持：
 *    - 目录扫描：递归扫描指定目录，支持正则过滤和排除特定目录。
 *    - 文件列表：通过 --file-list 参数直接读取 JSON 或文本文件列表，跳过扫描过程。
 *
 * 2. 智能筛选规则：
 *    - 时间间隔：同一天内的照片，相邻照片至少间隔一定时间（根据当天照片总量动态调整，默认 5 分钟）。
 *    - 每日限制：根据当天照片总量动态计算保留比例（例如少于 100 张保留 1/2，多于 1000 张保留 1/5）。
 *    - 数量硬限制：每天最多保留 MAX_FILES_PER_DAY (默认 40) 张。
 *    - 每小时限制：防止某些时间段照片过于密集，每小时最多 MAX_PER_HOUR (20) 张。
 *    - 特定主题：如宠物照片，每天有限额 MAX_PET_PER_DAY (20)。
 *
 * 3. 采样策略：
 *    - 在理想的时间点附近，优先选择文件体积较大（通常质量更好）的照片。
 *    - 结合图像质量评估（对比度、清晰度）进行智能选择。
 *    - 事件聚类：识别不同拍摄事件，确保每个事件都有代表性照片。
 *
 * 4. 输出与操作：
 *    - 缓存：扫描模式下，自动将发现的所有文件保存为 filelist_YYYYMMDD_HHmmss.json 缓存。
 *    - 报告：生成 picked_YYYYMMDD_HHmmss.json 包含详细的挑选结果和统计信息。
 *    - 复制：支持将挑选出的文件复制到输出目录，自动按 YYYY/YYYYMM 结构整理。
 *
 * 用法示例：
 *   mediac pick /path/to/photos --output /path/to/output
 *   mediac pick . --file-list list.json --dry-run
 */

import dayjs from "dayjs"
import fs from "fs-extra"
import inquirer from "inquirer"
import os, { cpus } from "os"
import pFilter from "p-filter"
import pMap from "p-map"
import path from "path"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { applyFileNameRules } from "./cmd_shared.js"
import { ErrorTypes, MediaCliError } from "../lib/errors.js"
import {
    HASH_CONFIG,
    QUALITY_CONFIG,
    EVENT_CONFIG,
    CACHE_CONFIG,
    clusterByEvents,
    calculateQualityScores,
    computeHashDedup,
    loadHashCache,
    saveHashCache,
    computeImageFeaturesWithCache,
} from "../lib/image_hash.js"

const LOG_TAG = "Pick"

export { aliases, builder, command, describe, handler }

const command = "pick <input>"
const aliases = ["pk"]
const describe = t("pick.description")

/**
 * 配置常量 - 控制照片挑选的核心参数
 */
const CONFIG = {
    /**
     * 梯度比例配置 - 根据当天照片总量决定保留比例
     */
    RATIO_LEVELS: [
        { limit: 100, ratio: 1.5 },
        { limit: 500, ratio: 2 },
        { limit: 1000, ratio: 3 },
    ],

    MAX_RATIO: 4,
    MAX_FILES_PER_DAY: 50,
    MIN_FILES_KEEP_ALL: 10,
    MAX_PER_HOUR: 20,
    MIN_INTERVAL_MS: 5 * 60 * 1000,
    MAX_PET_PER_DAY: 20,

    /**
     * 连拍模式配置
     */
    BURST_MODE: {
        SECONDS_THRESHOLD: 2,
        SAMESEC_THRESHOLD: 3,
        KEEP_LARGEST: 2,
    },

    IMAGE_HASH: HASH_CONFIG,
    EVENT_CLUSTER: EVENT_CONFIG,
    IMAGE_QUALITY: QUALITY_CONFIG,
}

const builder = (ya) =>
    ya
        .option("output", { alias: "o", describe: t("option.common.output"), type: "string" })
        .option("include", { alias: "I", type: "string", description: t("option.common.include") })
        .option("exclude", { alias: "E", type: "string", description: t("option.common.exclude") })
        .option("exclude-dir", {
            type: "string",
            describe: t("option.pick.exclude.dir"),
        })
        .option("file-list", {
            alias: "l",
            type: "string",
            describe: t("option.pick.fileList"),
        })
        .option("extensions", {
            alias: "e",
            type: "string",
            describe: t("option.common.extensions"),
        })
        .option("day-limit", {
            alias: "d",
            type: "number",
            default: CONFIG.MAX_FILES_PER_DAY,
            describe: t("option.pick.dayLimit", { count: CONFIG.MAX_FILES_PER_DAY }),
        })
        .option("dry-run", {
            alias: "n",
            type: "boolean",
            default: false,
            describe: t("option.common.dryRun"),
        })
        .option("jobs", {
            alias: "j",
            type: "number",
            default: Math.max(1, Math.floor(os.cpus().length / 4)),
            describe: t("option.common.jobs"),
        })
        .option("burst-mode", {
            alias: "b",
            type: "string",
            choices: ["off", "auto", "aggressive"],
            default: "auto",
            describe: t("option.pick.burstMode"),
        })
        .option("hash-dedup", {
            alias: "H",
            type: "boolean",
            default: false,
            describe: t("option.pick.hashDedup"),
        })
        .option("hash-threshold", {
            type: "number",
            default: CONFIG.IMAGE_HASH.THRESHOLD,
            describe: t("option.pick.hashThreshold"),
        })
        .option("cache", {
            alias: "c",
            type: "boolean",
            default: true,
            describe: t("option.pick.cache"),
        })
        .option("cache-file", {
            type: "string",
            describe: t("option.pick.cacheFile"),
        })
        .option("no-cache", {
            type: "boolean",
            default: false,
            describe: t("option.pick.noCache"),
        })

const handler = cmdPick

const FILE_LIST_CACHE_DAYS = 3

function isFileListCacheValid(cacheData) {
    if (!cacheData || !cacheData.createdAt) return false
    const createdAt = dayjs(cacheData.createdAt)
    const expiresAt = createdAt.add(FILE_LIST_CACHE_DAYS, "day")
    return dayjs().isBefore(expiresAt)
}

async function findValidFileListCache(outputDir, rootPath) {
    try {
        if (!(await fs.pathExists(outputDir))) return null

        const files = await fs.readdir(outputDir)
        const cacheFiles = files
            .filter((f) => f.startsWith("filelist_") && f.endsWith(".json"))
            .sort()
            .reverse()

        for (const cacheFile of cacheFiles) {
            const cachePath = path.join(outputDir, cacheFile)
            try {
                const data = await fs.readJson(cachePath)
                if (isFileListCacheValid(data) && Array.isArray(data.files)) {
                    const cacheRoot = data.root || ""
                    if (cacheRoot && rootPath && !cacheRoot.includes(rootPath) && !rootPath.includes(cacheRoot)) {
                        continue
                    }
                    return { path: cachePath, data, fileCount: data.files.length }
                }
            } catch (e) {
                continue
            }
        }
        return null
    } catch (e) {
        return null
    }
}

export async function cmdPick(argv) {
    log.logInfo(LOG_TAG, argv)

    let entries = []
    let root = argv.input

    const outDir = argv.output || "output"

    if (argv.fileList) {
        log.logInfo(LOG_TAG, t("pick.using.file.list", { path: argv.fileList }))
        if (!(await fs.pathExists(argv.fileList))) {
            throw new MediaCliError(
                ErrorTypes.FILE_NOT_FOUND,
                t("pick.file.list.not.found", { path: argv.fileList })
            )
        }
        const fileListExt = helper.pathExt(argv.fileList, true)
        const content = await fs.readFile(argv.fileList, "utf8")
        let rawList = []

        if (fileListExt === ".json") {
            try {
                const jsonData = JSON.parse(content)
                if (Array.isArray(jsonData)) {
                    rawList = jsonData
                    for (const item of rawList) {
                        if (!item.path || typeof item.size === "undefined") {
                            throw new MediaCliError(
                                ErrorTypes.INVALID_JSON_INPUT,
                                t("pick.json.missing.field", { item: JSON.stringify(item) })
                            )
                        }
                    }
                } else {
                    throw new MediaCliError(
                        ErrorTypes.INVALID_JSON_INPUT,
                        t("pick.json.must.be.array")
                    )
                }
            } catch (e) {
                if (e instanceof MediaCliError) {
                    throw e
                }
                throw new MediaCliError(
                    ErrorTypes.INVALID_JSON_INPUT,
                    t("pick.json.parse.failed", { error: e.message }),
                    e
                )
            }
        } else if (fileListExt === ".txt") {
            rawList = content
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => ({ path: line, size: 0 }))
        } else {
            throw new MediaCliError(
                ErrorTypes.INVALID_ARGUMENT,
                t("pick.file.list.format.unknown", { ext: fileListExt })
            )
        }

        entries = rawList
            .map((item) => {
                const p = item.path
                if (!p) return null
                return {
                    path: p,
                    name: item.name || path.basename(p),
                    size: item.size,
                    isFile: true,
                    stats: { mtime: item.mtime ? new Date(item.mtime) : new Date() },
                }
            })
            .filter((e) => e !== null)

        log.logInfo(LOG_TAG, t("pick.loaded.entries", { count: entries.length }))
    } else {
        root = await helper.validateInput(argv.input)

        const validCache = await findValidFileListCache(outDir, root)
        if (validCache && !argv.noCache) {
            log.logInfo(
                LOG_TAG,
                `Found valid file-list cache: ${validCache.path} (${validCache.fileCount} files, ${FILE_LIST_CACHE_DAYS} days valid)`
            )
            entries = validCache.data.files.map((item) => ({
                path: item.path,
                name: item.name || path.basename(item.path),
                size: item.size,
                isFile: true,
                stats: { mtime: item.mtime ? new Date(item.mtime) : new Date() },
            }))
            log.logInfo(LOG_TAG, `Loaded ${entries.length} entries from cache`)
        } else {
            const ignoreRe = /delete|thumb|mvimg|feat|misc|shots|vsco|twit|p950|吃|喝|截|票|医/i
            const walkOpts = {
                needStats: true,
                entryFilter: (f) => {
                    if (!f.isFile) return false
                    if (f.size < 200 * 1024) return false
                    if (ignoreRe.test(f.path)) return false
                    return helper.isImageFile(f.name || f.path)
                },
            }
            entries = await log.measure(mf.walk)(root, walkOpts)

            const timestamp = dayjs().format("YYYYMMDD_HHmmss")
            const fileListName = `filelist_${timestamp}.json`
            await fs.ensureDir(outDir)
            const fileListOutput = path.join(outDir, fileListName)

            const cacheData = {
                version: 1,
                createdAt: new Date().toISOString(),
                root: root,
                validDays: FILE_LIST_CACHE_DAYS,
                files: entries.map((e) => ({
                    path: e.path,
                    name: e.name,
                    size: e.size,
                    ext: path.extname(e.path),
                    mtime: e.stats?.mtime,
                })),
            }

            try {
                await fs.writeJSON(fileListOutput, cacheData, { spaces: 2 })
                log.logInfo(LOG_TAG, `File list cached to: ${fileListOutput} (valid for ${FILE_LIST_CACHE_DAYS} days)`)
            } catch (err) {
                log.logWarn(LOG_TAG, `Failed to cache file list: ${err.message}`)
            }
        }
    }
    entries = await log.measure(applyFileNameRules)(entries, argv)

    log.logInfo(LOG_TAG, t("compress.total.files.found", { count: entries.length }))
    if (!entries || entries.length === 0) {
        log.logWarn(LOG_TAG, t("common.nothing.to.do"))
        return
    }

    const { validEntries, ignoredDirs } = await log.measure(filterIgnoredDirs)(entries, root)
    if (validEntries.length < entries.length) {
        for (const d of ignoredDirs) {
            log.logWarn(LOG_TAG, t("pick.dir.ignored", { name: d }))
        }
        log.logWarn(
            LOG_TAG,
            t("pick.entries.ignored", { count: entries.length - validEntries.length })
        )
        if (validEntries.length === 0) {
            log.logWarn(LOG_TAG, t("pick.no.files"))
            return
        }
    }

    const excludedFiles = new Set()

    if (argv.excludeDir && (await fs.pathExists(argv.excludeDir))) {
        try {
            const excludePath = path.resolve(argv.excludeDir)
            log.logInfo(LOG_TAG, `Loading exclude files from: ${excludePath}`)
            const items = await mf.walk(excludePath, {
                entryFilter: (f) => helper.isMediaFile(f.name),
            })
            for (const item of items) {
                excludedFiles.add(item.name)
            }
            log.logInfo(LOG_TAG, `Loaded ${excludedFiles.size} files to exclude.`)
        } catch (e) {
            log.logError(LOG_TAG, `Failed to load exclude dir: ${e.message}`)
        }
    }

    const parseFilesByNameMeasured = log.measure(parseFilesByName)
    const parsed = await parseFilesByNameMeasured(validEntries)
    if (!parsed.length) {
        log.logWarn(LOG_TAG, t("pick.no.dates"))
        return
    }
    parsed.sort((a, b) => a.date - b.date)

    const sourceStats = await log.measure(calculateSourceStats)(parsed)

    const burstMode = argv.burstMode || "auto"
    const hashDedup = argv.hashDedup || false

    let processedForBurst = parsed
    if (burstMode !== "off") {
        const burstResult = await log.measure(processBurstGroups)(parsed, burstMode)
        processedForBurst = burstResult.filtered
        if (burstResult.removedCount > 0) {
            log.logInfo(LOG_TAG, t("pick.burst.removed", { count: burstResult.removedCount }))
        }
    }

    const processDailySelectionsMeasured = log.measure(processDailySelections)
    let daySelections = await processDailySelectionsMeasured(processedForBurst, argv)

    const useCache = !argv.noCache && argv.cache !== false
    const cacheFile = argv.cacheFile || path.join(outDir, CACHE_CONFIG.FILENAME)

    let cache = null
    if (useCache && hashDedup) {
        cache = await loadHashCache(cacheFile, root)
        if (cache) {
            log.logInfo(LOG_TAG, `Loaded cache from: ${cacheFile}`)
        }
    }

    let cacheEntries = {}
    if (hashDedup) {
        const dedupResult = await log.measure(processImageHashDedup)(
            daySelections,
            argv.hashThreshold,
            { cache, rootPath: root, useCache }
        )
        cacheEntries = dedupResult.cacheEntries || {}
        if (dedupResult.removedCount > 0) {
            log.logInfo(LOG_TAG, t("pick.hash.removed", { count: dedupResult.removedCount }))
        }
    }

    if (useCache && hashDedup && Object.keys(cacheEntries).length > 0) {
        await saveHashCache(cacheFile, root, cacheEntries, {
            ahashSize: CONFIG.IMAGE_HASH.AHASH_SIZE,
            phashSize: CONFIG.IMAGE_HASH.PHASH_SIZE,
            sampleSize: CONFIG.IMAGE_QUALITY.SAMPLE_SIZE,
        })
        log.logInfo(LOG_TAG, `Saved cache to: ${cacheFile}`)
    }

    const pickedFiles = []
    const selectedStats = { days: new Map(), months: new Map(), years: new Map() }

    for (const day of Array.from(daySelections.keys()).sort()) {
        const arr = daySelections.get(day)
        arr.sort((a, b) => a.date - b.date)
        pickedFiles.push(...arr)

        if (arr.length > 0) {
            const date = dayjs(day)
            const m = date.format("YYYY-MM")
            const y = date.format("YYYY")

            selectedStats.days.set(day, arr.length)
            selectedStats.months.set(m, (selectedStats.months.get(m) || 0) + arr.length)
            selectedStats.years.set(y, (selectedStats.years.get(y) || 0) + arr.length)
        }
    }

    const buildJsonOutputMeasured = log.measure(buildJsonOutput)
    const outputData = await buildJsonOutputMeasured(daySelections, sourceStats, selectedStats)
    outputData.root = root

    const nowTag = dayjs().format("YYYYMMDD_HHmmss")
    const jsonName = path.join(outDir, `picked_${nowTag}.json`)
    await fs.writeJson(jsonName, outputData, { spaces: 2 })

    printConsoleStats(pickedFiles.length, selectedStats, sourceStats, jsonName)
    log.logSuccess(LOG_TAG, t("pick.result.saved", { path: jsonName }))

    if (pickedFiles.length === 0) {
        log.logWarn(LOG_TAG, t("pick.copy.no.files"))
        return
    }

    const filesAfterExclude = pickedFiles.filter((e) => !excludedFiles.has(e.name))
    if (filesAfterExclude.length < pickedFiles.length) {
        log.logWarn(
            LOG_TAG,
            t("pick.entries.excluded", {
                count: pickedFiles.length - filesAfterExclude.length,
            })
        )
    }

    const checkExistsFunc = async (f) => {
        const date = dayjs(f.date)
        const year = date.format("YYYY")
        const month = date.format("YYYYMM")
        const destRel = path.join(year, month, path.basename(f.path))
        const dest = path.join(outDir, destRel)
        return !(await fs.pathExists(dest))
    }

    const finalFiles = await pFilter(filesAfterExclude, checkExistsFunc, {
        concurrency: argv.jobs * 4,
    })

    if (finalFiles.length < filesAfterExclude.length) {
        log.logWarn(
            LOG_TAG,
            t("pick.copy.skip.exists.count", {
                count: filesAfterExclude.length - finalFiles.length,
            })
        )
    }

    if (finalFiles.length === 0) {
        log.logWarn(LOG_TAG, t("pick.copy.no.files"))
        return
    }

    await copyPickedFiles(finalFiles, root, argv)
}

/**
 * 复制选中的照片到输出目录
 */
async function copyPickedFiles(files, root, argv) {
    if (!argv.output) {
        log.logWarn(LOG_TAG, t("pick.skip.copy.no.output"))
        return
    }

    const outDir = argv.output

    let copyIndex = 0
    const copyTotal = files.length

    const questions = [
        {
            type: "confirm",
            name: "doCopy",
            message: t("pick.copy.confirm", { count: files.length, dir: outDir }),
            default: false,
        },
    ]

    const answers = await inquirer.prompt(questions)
    if (!answers.doCopy) {
        log.logWarn(LOG_TAG, t("common.aborted.by.user"))
        return
    }

    log.logSuccess(LOG_TAG, t("pick.copy.start", { dryRun: argv.dryRun }))

    const reportData = {}

    const mapper = async (f) => {
        const date = dayjs(f.date)
        const year = date.format("YYYY")
        const month = date.format("YYYYMM")

        const destRel = path.join(year, month, path.basename(f.path))
        const dest = path.join(outDir, destRel)

        const sizeStr = (f.size / 1024 / 1024).toFixed(2) + " MB"

        if (argv.dryRun) {
            log.logInfo(LOG_TAG, t("pick.copy.dryrun", { src: f.path, dest: dest, size: sizeStr }))
            return { status: "success" }
        } else {
            ++copyIndex
            try {
                if (await fs.pathExists(dest)) {
                    log.logSkip(
                        LOG_TAG,
                        t("pick.copy.skip.exists", {
                            index: `${copyIndex}/${copyTotal}`,
                            path: f.path,
                        })
                    )
                    return { status: "skipped", month: month, srcPath: f.path }
                }

                await fs.ensureDir(path.dirname(dest))
                await fs.copy(f.path, dest, { preserveTimestamps: true })

                log.logTask(
                    LOG_TAG,
                    copyIndex,
                    copyTotal,
                    t("pick.copy.done", {
                        name: helper.pathShort(f.path),
                        dest: path.dirname(destRel),
                        size: sizeStr,
                    })
                )
                return { status: "success", month: month, srcPath: f.path }
            } catch (err) {
                log.logError(LOG_TAG, t("pick.copy.error", { path: f.path }), err)
                return { status: "error", error: err }
            }
        }
    }

    const results = await pMap(files, mapper, { concurrency: cpus().length })

    const count = results.filter((r) => r.status === "success").length
    const skipCount = results.filter((r) => r.status === "skipped").length
    const errorCount = results.filter((r) => r.status === "error").length

    if (!argv.dryRun) {
        results.forEach((r) => {
            if ((r.status === "success" || r.status === "skipped") && r.month && r.srcPath) {
                if (!reportData[r.month]) reportData[r.month] = []
                reportData[r.month].push(r.srcPath)
            }
        })
    }

    log.logSuccess(LOG_TAG, t("pick.copy.finish", { count, skip: skipCount, error: errorCount }))

    if (!argv.dryRun && count > 0) {
        const nowTag = dayjs().format("YYYYMMDD_HHmmss")
        const reportName = path.join(outDir, `report_${nowTag}.json`)
        try {
            await fs.writeJson(reportName, reportData, { spaces: 2 })
            log.logSuccess(LOG_TAG, t("pick.report.saved", { path: reportName }))
        } catch (e) {
            log.logError(LOG_TAG, t("pick.report.failed", { error: e.message }))
        }
    }
}

/**
 * 计算源文件统计信息
 */
function calculateSourceStats(parsed) {
    const s = { days: new Map(), months: new Map(), years: new Map() }
    for (const p of parsed) {
        const d = p.dayKey
        const m = d.slice(0, 7)
        const y = d.slice(0, 4)
        s.days.set(d, (s.days.get(d) || 0) + 1)
        s.months.set(m, (s.months.get(m) || 0) + 1)
        s.years.set(y, (s.years.get(y) || 0) + 1)
    }
    return s
}

/**
 * 构建 JSON 输出数据结构
 */
function buildJsonOutput(daySelections, srcStats, selStats) {
    const filesByYear = new Map()
    const statsByYear = new Map()

    const allYears = Array.from(srcStats.years.keys()).sort()

    const outputFiles = []
    const outputStats = []

    for (const year of allYears) {
        const yearMonths = []
        const monthsInYear = Array.from(srcStats.months.keys())
            .filter((m) => m.startsWith(year))
            .sort()

        for (const m of monthsInYear) {
            const mFiles = []
            const daysInMonth = Array.from(daySelections.keys())
                .filter((d) => d.startsWith(m))
                .sort()

            for (const d of daysInMonth) {
                const arr = daySelections.get(d)
                if (arr) mFiles.push(...arr.map((f) => f.path))
            }

            const monthKey = m.replace("-", "")
            const mTotal = srcStats.months.get(m) || 0

            if (mFiles.length > 0) {
                yearMonths.push({
                    month: monthKey,
                    total: mTotal,
                    selected: mFiles.length,
                    files: mFiles,
                })
            }
        }

        if (yearMonths.length > 0) {
            outputFiles.push({
                year: year,
                months: yearMonths,
            })
        }

        const yStats = {
            total: srcStats.years.get(year) || 0,
            selected: selStats.years.get(year) || 0,
            months: {},
        }

        for (const m of monthsInYear) {
            const monthKey = m.replace("-", "")

            const daysData = {}
            const daysInMonth = Array.from(srcStats.days.keys())
                .filter((d) => d.startsWith(m))
                .sort()

            for (const d of daysInMonth) {
                const dayKey = d.replaceAll("-", "")
                daysData[dayKey] = {
                    total: srcStats.days.get(d) || 0,
                    selected: selStats.days.get(d) || 0,
                }
            }

            yStats.months[monthKey] = {
                total: srcStats.months.get(m) || 0,
                selected: selStats.months.get(m) || 0,
                days: daysData,
            }
        }

        outputStats.push({
            year: year,
            stats: yStats,
        })
    }

    return {
        generatedAt: dayjs().format("YYYY-MM-DD HH:mm:ss"),
        files: outputFiles,
        stats: outputStats,
    }
}

/**
 * 从文件名解析日期时间
 */
async function parseFilesByName(entries) {
    const mapper = async (e) => {
        const re = /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/
        const name = path.basename(e.path)
        const m = name.match(re)
        if (!m) return null

        const Y = parseInt(m[1], 10)
        const M = parseInt(m[2], 10)
        const D = parseInt(m[3], 10)
        const h = parseInt(m[4], 10)
        const m_ = parseInt(m[5], 10)
        const s = parseInt(m[6], 10)

        if (Y < 2000 || Y > 2050) return null
        if (M < 1 || M > 12) return null
        if (D < 1 || D > 31) return null
        if (h > 23) return null
        if (m_ > 59) return null
        if (s > 59) return null

        const dateStr = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
        const date = dayjs(dateStr)

        if (date.isValid()) {
            if (date.year() !== Y || date.month() + 1 !== M || date.date() !== D) {
                return null
            }
            return {
                name: e.name,
                path: e.path,
                size: e.size || (e.stats && e.stats.size) || 0,
                date: date.toDate(),
                dayKey: date.format("YYYY-MM-DD"),
            }
        }
        return null
    }

    const results = await pMap(entries, mapper, { concurrency: cpus().length })
    return results.filter((r) => r !== null)
}

/**
 * 按天分组并应用筛选规则
 */
async function processDailySelections(parsed, argv = {}) {
    const dayLimit = argv.dayLimit || CONFIG.MAX_FILES_PER_DAY
    const days = new Map()
    for (const it of parsed) {
        if (!days.has(it.dayKey)) days.set(it.dayKey, [])
        days.get(it.dayKey).push(it)
    }

    const selections = new Map()
    const dayKeys = Array.from(days.keys())

    const mapper = async (day) => {
        const files = days.get(day)
        files.sort((a, b) => a.date - b.date)

        const total = files.length
        let targetCount = 0

        if (total < CONFIG.MIN_FILES_KEEP_ALL) {
            targetCount = total
        } else {
            let ratio = CONFIG.MAX_RATIO
            for (const level of CONFIG.RATIO_LEVELS) {
                if (total < level.limit) {
                    ratio = level.ratio
                    break
                }
            }
            targetCount = Math.ceil(total / ratio)

            if (targetCount > dayLimit) {
                targetCount = dayLimit
            }
        }

        if (targetCount > total) targetCount = total

        const picked = await selectForDay(files, targetCount)
        return { day, picked }
    }

    const results = await pMap(dayKeys, mapper, { concurrency: cpus().length })

    for (const res of results) {
        selections.set(res.day, res.picked)
    }
    return selections
}

/**
 * 单日照片选择核心算法
 */
async function selectForDay(files, targetN) {
    if (targetN === 0) return []
    if (files.length < CONFIG.MIN_FILES_KEEP_ALL) return files.slice()

    const len = files.length

    let minIntervalMs = 4 * 60 * 1000
    if (len < 50) {
        minIntervalMs = 10 * 1000
    } else if (len < 100) {
        minIntervalMs = 30 * 1000
    } else if (len < 500) {
        minIntervalMs = 2 * 60 * 1000
    } else if (len < 1000) {
        minIntervalMs = 3 * 60 * 1000
    }

    const qualityScores = await calculateQualityScores(files, CONFIG.IMAGE_QUALITY)

    const events = clusterByEvents(files, CONFIG.EVENT_CLUSTER.GAP_THRESHOLD_MS)

    if (events.length <= 2) {
        return selectForDaySimple(files, targetN, minIntervalMs, qualityScores)
    }

    const picked = selectFromEventsWithQuality(
        events,
        targetN,
        minIntervalMs,
        CONFIG.MAX_PER_HOUR,
        CONFIG.MAX_PET_PER_DAY,
        qualityScores
    )

    return picked
}

/**
 * 简单均匀分布选择算法
 */
function selectForDaySimple(files, targetN, minIntervalMs, qualityScores) {
    const len = files.length

    const indices = []
    for (let i = 0; i < targetN; i++) {
        indices.push(Math.floor(((i + 0.5) * len) / targetN))
    }

    const picked = []
    const takenIndices = new Set()
    const hourCounts = new Map()

    const petRe = /猪|宠|猫|鸟|鱼|鹦鹉|cat|bird/i
    let petCount = 0

    const canPick = (idx) => {
        const candidate = files[idx]
        const candTime = candidate.date.getTime()
        const candHour = dayjs(candidate.date).format("YYYY-MM-DD-HH")

        if ((hourCounts.get(candHour) || 0) >= CONFIG.MAX_PER_HOUR) return false

        if (petRe.test(candidate.path)) {
            if (petCount >= CONFIG.MAX_PET_PER_DAY) return false
        }

        for (const p of picked) {
            if (Math.abs(candTime - p.date.getTime()) < minIntervalMs) return false
        }
        return true
    }

    const doPick = (idx) => {
        takenIndices.add(idx)
        const f = files[idx]
        picked.push(f)
        const hour = dayjs(f.date).format("YYYY-MM-DD-HH")
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1)

        if (petRe.test(f.path)) {
            petCount++
        }
    }

    const calculateScore = (idx) => {
        const file = files[idx]
        const sizeScore = (file.size || 0) / (10 * 1024 * 1024) * 50
        const qualityScore = qualityScores.get(file.path) || 0
        return sizeScore * 0.4 + qualityScore * 0.6
    }

    const SEARCH_RADIUS = Math.max(1, Math.floor(len / targetN / 2))

    for (const idealIdx of indices) {
        const start = Math.max(0, idealIdx - SEARCH_RADIUS)
        const end = Math.min(len - 1, idealIdx + SEARCH_RADIUS)

        let bestIdx = -1
        let maxScore = -1

        const candidates = []
        for (let i = start; i <= end; i++) {
            if (!takenIndices.has(i) && canPick(i)) {
                candidates.push(i)
            }
        }

        if (candidates.length === 0) continue

        for (const idx of candidates) {
            const score = calculateScore(idx)
            if (score > maxScore) {
                maxScore = score
                bestIdx = idx
            }
        }

        if (bestIdx !== -1) {
            doPick(bestIdx)
        }
    }

    picked.sort((a, b) => a.date - b.date)
    return picked
}

/**
 * 事件聚类选择算法
 */
function selectFromEventsWithQuality(
    events,
    targetCount,
    minIntervalMs,
    hourLimit,
    petLimit,
    qualityScores
) {
    if (events.length === 0 || targetCount === 0) {
        return []
    }

    const totalFiles = events.reduce((sum, e) => sum + e.length, 0)
    const picked = []
    const takenPaths = new Set()
    const hourCounts = new Map()
    const petRe = /猪|宠|猫|鸟|鱼|鹦鹉|cat|bird/i
    let petCount = 0

    const canPick = (file) => {
        if (takenPaths.has(file.path)) return false

        const hour = dayjs(file.date).format("YYYY-MM-DD-HH")
        if ((hourCounts.get(hour) || 0) >= hourLimit) return false

        if (petRe.test(file.path) && petCount >= petLimit) return false

        for (const p of picked) {
            if (Math.abs(file.date.getTime() - p.date.getTime()) < minIntervalMs) {
                return false
            }
        }

        return true
    }

    const doPick = (file) => {
        takenPaths.add(file.path)
        picked.push(file)
        const hour = dayjs(file.date).format("YYYY-MM-DD-HH")
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1)
        if (petRe.test(file.path)) {
            petCount++
        }
    }

    const calculateScore = (file) => {
        const sizeScore = (file.size || 0) / (10 * 1024 * 1024) * 50
        const qualityScore = qualityScores.get(file.path) || 0
        return sizeScore * 0.4 + qualityScore * 0.6
    }

    const eventQuotas = events.map((event) => {
        const ratio = event.length / totalFiles
        const quota = Math.max(1, Math.ceil(targetCount * ratio))
        return Math.min(quota, event.length)
    })

    const totalQuota = eventQuotas.reduce((sum, q) => sum + q, 0)
    if (totalQuota > targetCount) {
        const scale = targetCount / totalQuota
        for (let i = 0; i < eventQuotas.length; i++) {
            eventQuotas[i] = Math.max(1, Math.floor(eventQuotas[i] * scale))
        }
    }

    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        let quota = eventQuotas[i]

        const sortedByScore = [...event].sort((a, b) => calculateScore(b) - calculateScore(a))

        for (const file of sortedByScore) {
            if (quota <= 0) break
            if (canPick(file)) {
                doPick(file)
                quota--
            }
        }
    }

    if (picked.length < targetCount) {
        const remaining = events
            .flat()
            .filter((f) => canPick(f))
            .sort((a, b) => calculateScore(b) - calculateScore(a))

        for (const file of remaining) {
            if (picked.length >= targetCount) break
            if (canPick(file)) {
                doPick(file)
            }
        }
    }

    picked.sort((a, b) => a.date - b.date)
    return picked
}

/**
 * 连拍照片分组处理
 */
function processBurstGroups(files, mode) {
    if (!files || files.length === 0) {
        return { filtered: files, removedCount: 0 }
    }

    const burstConfig = CONFIG.BURST_MODE
    const sortedFiles = [...files].sort((a, b) => a.date - b.date)

    const groups = []
    let currentGroup = [sortedFiles[0]]
    let currentSecond = Math.floor(sortedFiles[0].date.getTime() / 1000)

    for (let i = 1; i < sortedFiles.length; i++) {
        const file = sortedFiles[i]
        const fileSecond = Math.floor(file.date.getTime() / 1000)
        const diff = fileSecond - currentSecond

        if (diff <= burstConfig.SECONDS_THRESHOLD) {
            currentGroup.push(file)
        } else {
            if (currentGroup.length >= burstConfig.SAMESEC_THRESHOLD) {
                groups.push([...currentGroup])
            } else {
                groups.push([...currentGroup])
            }
            currentGroup = [file]
            currentSecond = fileSecond
        }
    }

    if (currentGroup.length >= burstConfig.SAMESEC_THRESHOLD) {
        groups.push([...currentGroup])
    } else if (currentGroup.length > 0) {
        groups.push([...currentGroup])
    }

    const filtered = []
    let removedCount = 0

    for (const group of groups) {
        if (group.length >= burstConfig.SAMESEC_THRESHOLD) {
            const keepCount = mode === "aggressive" ? 1 : burstConfig.KEEP_LARGEST
            const sortedBySize = [...group].sort((a, b) => (b.size || 0) - (a.size || 0))
            filtered.push(...sortedBySize.slice(0, keepCount))
            removedCount += group.length - keepCount
        } else {
            filtered.push(...group)
        }
    }

    filtered.sort((a, b) => a.date - b.date)

    return { filtered, removedCount }
}

/**
 * 图像哈希去重处理（带缓存支持）
 *
 * @param {Map} daySelections - 每日选择结果
 * @param {number} threshold - 汉明距离阈值
 * @param {Object} options - 缓存选项
 * @returns {Object} { removedCount, cacheEntries }
 */
async function processImageHashDedup(daySelections, threshold = CONFIG.IMAGE_HASH.THRESHOLD, options = {}) {
    const allFiles = []
    const fileToDay = new Map()

    for (const [day, files] of daySelections) {
        for (const f of files) {
            allFiles.push(f)
            fileToDay.set(f.path, day)
        }
    }

    if (allFiles.length === 0) {
        return { removedCount: 0, cacheEntries: {} }
    }

    const { cache, rootPath, useCache } = options

    log.logInfo(LOG_TAG, `Computing perceptual hash for ${allFiles.length} files...`)

    let hashResults = []
    let qualityScores = new Map()
    let cacheEntries = {}

    if (useCache && cache && rootPath) {
        const result = await computeImageFeaturesWithCache(allFiles, cache, rootPath, {
            concurrency: CONFIG.IMAGE_HASH.PARALLEL,
            qualityConfig: CONFIG.IMAGE_QUALITY,
        })
        hashResults = result.hashResults
        qualityScores = result.qualityScores
        cacheEntries = result.cacheEntries

        log.logInfo(LOG_TAG, `Cache: ${result.cacheHits} hits, ${result.cacheMisses} misses`)
    } else {
        const results = await computeHashDedup(allFiles, threshold, {
            qualityScores: null,
        })
        hashResults = allFiles.map((f, i) => ({
            file: f,
            aHash: null,
            pHash: null,
        }))
    }

    const validHashes = hashResults.filter((r) => r.pHash !== null)
    const toRemove = new Set()

    for (let i = 0; i < validHashes.length; i++) {
        if (toRemove.has(validHashes[i].file.path)) continue

        for (let j = i + 1; j < validHashes.length; j++) {
            if (toRemove.has(validHashes[j].file.path)) continue

            const aHashDist = hammingDistance(validHashes[i].aHash, validHashes[j].aHash)
            if (aHashDist > threshold * 2) continue

            const pHashDist = hammingDistance(validHashes[i].pHash, validHashes[j].pHash)

            if (pHashDist <= threshold) {
                const scoreI = qualityScores.get(validHashes[i].file.path) || 0
                const scoreJ = qualityScores.get(validHashes[j].file.path) || 0

                const sizeI = validHashes[i].file.size || 0
                const sizeJ = validHashes[j].file.size || 0

                const keepI = scoreI > scoreJ || (scoreI === scoreJ && sizeI >= sizeJ)

                if (keepI) {
                    toRemove.add(validHashes[j].file.path)
                } else {
                    toRemove.add(validHashes[i].file.path)
                    break
                }
            }
        }
    }

    let removedCount = 0
    for (const [day, files] of daySelections) {
        const originalCount = files.length
        const filtered = files.filter((f) => !toRemove.has(f.path))
        daySelections.set(day, filtered)
        removedCount += originalCount - filtered.length
    }

    return { removedCount, cacheEntries }
}

/**
 * 计算汉明距离
 */
function hammingDistance(hash1, hash2) {
    if (!hash1 || !hash2) return 64

    const h1 = BigInt("0x" + hash1)
    const h2 = BigInt("0x" + hash2)
    const xor = h1 ^ h2

    let distance = 0
    let n = xor
    while (n) {
        distance += Number(n & BigInt(1))
        n >>= BigInt(1)
    }
    return distance
}

/**
 * 过滤包含 .nomedia 或 .gitignore 的目录
 */
async function filterIgnoredDirs(entries, root) {
    const dirCache = new Map()

    const allDirs = [...new Set(entries.map((e) => path.dirname(e.path)))]

    allDirs.sort((a, b) => a.length - b.length || a.localeCompare(b))

    const pendingCache = new Map()

    const checkDir = async (dir) => {
        if (dirCache.has(dir)) return dirCache.get(dir)
        if (pendingCache.has(dir)) return pendingCache.get(dir)

        const promise = (async () => {
            if (root && dir.length < root.length) return false
            if (dir === "." || dir === "/" || dir === "") return false

            const parent = path.dirname(dir)
            let parentIgnored = false

            if (parent && parent !== dir && parent.length >= root.length) {
                parentIgnored = await checkDir(parent)
            }

            if (parentIgnored) return true

            try {
                const [hasNomedia, hasGitignore] = await Promise.all([
                    fs.pathExists(path.join(dir, ".nomedia")),
                    fs.pathExists(path.join(dir, ".gitignore")),
                ])
                return hasNomedia || hasGitignore
            } catch (e) {
                return false
            }
        })()

        pendingCache.set(dir, promise)
        const result = await promise
        dirCache.set(dir, result)
        pendingCache.delete(dir)
        return result
    }

    await pMap(allDirs, checkDir, { concurrency: cpus().length })

    const validEntries = []
    const ignoredDirs = new Set()

    for (const e of entries) {
        const dir = path.dirname(e.path)
        if (dirCache.get(dir)) {
            ignoredDirs.add(dir)
        } else {
            validEntries.push(e)
        }
    }

    return {
        validEntries,
        ignoredDirs: Array.from(ignoredDirs),
    }
}

/**
 * 打印控制台统计信息
 */
function printConsoleStats(total, stats, srcStats, jsonFile) {
    console.log(`Total selected: ${total}`)

    console.log("By Year:")
    Array.from(stats.years.entries())
        .sort()
        .forEach(([k, v]) => {
            const t = srcStats.years.get(k) || 0
            console.log(`  ${k}: ${v}/${t}`)
        })

    console.log("By Month:")
    Array.from(stats.months.entries())
        .sort()
        .forEach(([k, v]) => {
            const t = srcStats.months.get(k) || 0
            const mk = k.replace("-", "")
            console.log(`  ${mk}: ${v}/${t}`)
        })

    const dayCount = stats.days.size
    console.log(`By Day: ${dayCount} days active (details in json file)`)

    const topDays = Array.from(stats.days.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)

    if (topDays.length > 0) {
        console.log("  Top days:")
        topDays.forEach(([d, c]) => {
            const t = srcStats.days.get(d) || 0
            const dayKey = d.replaceAll("-", "")
            console.log(`    ${dayKey}: ${c}/${t}`)
        })
    }

    if (dayCount <= 30) {
        const daysByMonth = new Map()
        const sortedDays = Array.from(stats.days.entries()).sort()
        for (const [d, c] of sortedDays) {
            const m = d.slice(0, 7)
            if (!daysByMonth.has(m)) daysByMonth.set(m, [])
            daysByMonth.get(m).push([d, c])
        }

        for (const [m, days] of daysByMonth.entries()) {
            console.log(`  ${m}:`)
            for (const [d, c] of days) {
                const t = srcStats.days.get(d) || 0
                const dayPart = d.slice(8)
                console.log(`    ${dayPart}: ${c}/${t}`)
            }
        }
    }
}
