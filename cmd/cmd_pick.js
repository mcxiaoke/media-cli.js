/*
 * Project: mediac
 * Created: 2026-02-13 17:16:15
 * Modified: 2026-02-17 10:16:15
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
export { aliases, builder, command, describe, handler }

import { ErrorTypes, MediaCliError } from "../lib/errors.js"

const command = "pick <input>"
const aliases = ["pk"]
const describe = t("pick.description")

// 配置常量
const CONFIG = {
    // 每日挑选规则 (数量 -> 分母):
    // < 100 -> 1/2
    // < 500 -> 1/3
    // < 1000 -> 1/4
    // > 1000 -> 1/5
    RATIO_LEVELS: [
        { limit: 100, ratio: 1.5 },
        { limit: 500, ratio: 2 },
        { limit: 1000, ratio: 3 },
    ],
    MAX_RATIO: 4, // > 1000

    // 每日最大挑选数量 (硬限制)
    MAX_FILES_PER_DAY: 50,

    // 如果当天照片极其少 (< MIN_FILES_KEEP_ALL)，则全部保留
    MIN_FILES_KEEP_ALL: 10,

    // 每小时限制 (20 张)
    MAX_PER_HOUR: 20,

    // 最小间隔 (默认 5 分钟 = 300000 ms) - 具体值会在 selectForDay 中根据当天照片数量动态计算
    MIN_INTERVAL_MS: 5 * 60 * 1000,

    // 宠物/特定主题每日最大数量
    MAX_PET_PER_DAY: 20,
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

const handler = cmdPick

// 主命令入口：负责参数处理、文件加载、逻辑调用与结果输出
export async function cmdPick(argv) {
    const logTag = "cmdPick"
    log.show(logTag, argv)

    // 1. 文件源加载
    let entries = []
    let root = argv.input

    if (argv.fileList) {
        // 模式 1: 直接读取文件列表
        // 适用于已通过其他手段获取文件清单，直接进行挑选的场景
        log.show(logTag, t("pick.using.file.list", { path: argv.fileList }))
        if (!(await fs.pathExists(argv.fileList))) {
            throw new MediaCliError(
                ErrorTypes.FILE_NOT_FOUND,
                t("pick.file.list.not.found", { path: argv.fileList }),
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
                    // 严格校验 JSON 结构，避免后续逻辑出错
                    for (const item of rawList) {
                        if (!item.path || typeof item.size === "undefined") {
                            throw new MediaCliError(
                                ErrorTypes.INVALID_JSON_INPUT,
                                t("pick.json.missing.field", { item: JSON.stringify(item) }),
                            )
                        }
                    }
                } else {
                    throw new MediaCliError(
                        ErrorTypes.INVALID_JSON_INPUT,
                        t("pick.json.must.be.array"),
                    )
                }
            } catch (e) {
                // 如果已经是 MediaCliError，直接抛出
                if (e instanceof MediaCliError) {
                    throw e
                }
                throw new MediaCliError(
                    ErrorTypes.INVALID_JSON_INPUT,
                    t("pick.json.parse.failed", { error: e.message }),
                    e,
                )
            }
        } else if (fileListExt === ".txt") {
            rawList = content
                .split(/\r?\n/)
                .map((line) => line.trim()) // 去除行首尾空白
                .filter((line) => line.length > 0)
                .map((line) => ({ path: line, size: 0 })) // 文本列表默认无大小信息
        } else {
            throw new MediaCliError(
                ErrorTypes.INVALID_ARGUMENT,
                t("pick.file.list.format.unknown", { ext: fileListExt }),
            )
        }

        // 统一转换为标准 Entry 结构
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

        log.show(logTag, t("pick.loaded.entries", { count: entries.length }))
    } else {
        // 模式 2: 扫描目录
        // 递归扫描指定目录，应用正则过滤
        root = await helper.validateInput(argv.input)
        const ignoreRe = /delete|thumb|mvimg|feat|misc|shots|vsco|twit|p950|吃|喝|截|票|医/i
        const walkOpts = {
            needStats: true,
            entryFilter: (f) => {
                if (!f.isFile) return false
                if (f.size < 200 * 1024) return false // 过滤掉小于 200KB 的小文件/缩略图
                if (ignoreRe.test(f.path)) return false
                return helper.isImageFile(f.name || f.path)
            },
        }
        entries = await log.measure(mf.walk)(root, walkOpts)

        // 自动缓存文件列表供后续使用或调试
        const timestamp = dayjs().format("YYYYMMDD_HHmmss")
        const fileListName = `filelist_${timestamp}.json`
        const outputDir = argv.output || "output" // 优先使用 argv.output 或默认为 ./output
        await fs.ensureDir(outputDir)
        const fileListOutput = path.join(outputDir, fileListName)

        const cachedList = entries.map((e) => ({
            path: e.path,
            name: e.name,
            size: e.size,
            ext: path.extname(e.path),
            mtime: e.stats?.mtime,
        }))

        try {
            await fs.writeJSON(fileListOutput, cachedList, { spaces: 2 })
            log.show(logTag, `File list cached to: ${fileListOutput}`)
        } catch (err) {
            log.showYellow(logTag, `Failed to cache file list: ${err.message}`)
        }
    }
    entries = await log.measure(applyFileNameRules)(entries, argv)

    log.show(logTag, t("compress.total.files.found", { count: entries.length }))
    if (!entries || entries.length === 0) {
        log.showYellow(t("common.nothing.to.do"))
        return
    }
    const { validEntries, ignoredDirs } = await log.measure(filterIgnoredDirs)(entries, root)
    if (validEntries.length < entries.length) {
        for (const d of ignoredDirs) {
            log.showYellow(logTag, t("pick.dir.ignored", { name: d }))
        }
        log.showYellow(
            logTag,
            t("pick.entries.ignored", { count: entries.length - validEntries.length }),
        )
        if (validEntries.length === 0) {
            log.showYellow(logTag, t("pick.no.files"))
            return
        }
    }

    // Load exclude list
    const excludedFiles = new Set()
    if (argv.excludeDir && (await fs.pathExists(argv.excludeDir))) {
        try {
            const excludePath = path.resolve(argv.excludeDir)
            log.show(logTag, `Loading exclude files from: ${excludePath}`)
            const items = await mf.walk(excludePath, {
                entryFilter: (f) => helper.isMediaFile(f.name),
            })
            for (const item of items) {
                excludedFiles.add(item.name)
            }
            log.show(logTag, `Loaded ${excludedFiles.size} files to exclude.`)
        } catch (e) {
            log.showRed(logTag, `Failed to load exclude dir: ${e.message}`)
        }
    }

    // 2. 提取日期
    const parseFilesByNameMeasured = log.measure(parseFilesByName)
    const parsed = await parseFilesByNameMeasured(validEntries)
    if (!parsed.length) {
        log.showYellow(logTag, t("pick.no.dates"))
        return
    }
    // 初始排序
    parsed.sort((a, b) => a.date - b.date)

    // 3. 统计原始数据（筛选前）
    const sourceStats = await log.measure(calculateSourceStats)(parsed)

    // 4. 应用挑选规则
    const processDailySelectionsMeasured = log.measure(processDailySelections)
    const daySelections = await processDailySelectionsMeasured(parsed, argv)
    // Monthly limit logic removed as per request
    // applyMonthlyLimit(daySelections, 1000)

    // 5. 汇总结果与构建JSON
    // 聚合 selected
    const pickedFiles = []
    const selectedStats = { days: new Map(), months: new Map(), years: new Map() }

    for (const day of Array.from(daySelections.keys()).sort()) {
        const arr = daySelections.get(day)
        arr.sort((a, b) => a.date - b.date)
        pickedFiles.push(...arr)

        // Stats counting
        if (arr.length > 0) {
            const date = dayjs(day) // day is YYYY-MM-DD
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

    // 6. 输出文件
    const nowTag = dayjs().format("YYYYMMDD_HHmmss")
    // 如果指定了 output，则 output 作为输出目录，否则使用系统临时目录
    // 改动：如果没有output，不保存到输入目录，而是保存到临时目录
    const outDir = argv.output ? argv.output : os.tmpdir()
    // 确保是目录
    await fs.ensureDir(outDir)

    const jsonName = path.join(outDir, `picked_${nowTag}.json`)
    await fs.writeJson(jsonName, outputData, { spaces: 2 })

    // 7. 控制台输出
    printConsoleStats(pickedFiles.length, selectedStats, sourceStats, jsonName)
    log.showGreen(logTag, t("pick.result.saved", { path: jsonName }))

    if (pickedFiles.length === 0) {
        log.showYellow(logTag, t("pick.copy.no.files"))
        return
    }
    // 8. 检查文件是否在排除目录中

    const filesAfterExclude = pickedFiles.filter((e) => !excludedFiles.has(e.name))
    if (filesAfterExclude.length < pickedFiles.length) {
        log.showYellow(
            logTag,
            t("pick.entries.excluded", {
                count: pickedFiles.length - filesAfterExclude.length,
            }),
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

    // 9. 检查输出目录，过滤掉已存在的文件
    const finalFiles = await pFilter(filesAfterExclude, checkExistsFunc, {
        concurrency: argv.jobs * 4,
    })

    if (finalFiles.length < filesAfterExclude.length) {
        log.showYellow(
            logTag,
            t("pick.copy.skip.exists.count", {
                count: filesAfterExclude.length - finalFiles.length,
            }),
        )
    }

    if (finalFiles.length === 0) {
        log.showYellow(logTag, t("pick.copy.no.files"))
        return
    }

    // 10. 复制文件
    await copyPickedFiles(finalFiles, root, argv)
}

async function copyPickedFiles(files, root, argv) {
    const logTag = "cmdPick"
    if (!argv.output) {
        log.showYellow(logTag, t("pick.skip.copy.no.output"))
        return
    }

    const outDir = argv.output

    let copyIndex = 0
    const copyTotal = files.length
    // 不要在输入目录里创建副本，除非用户真的想这么做（通常不会）
    // outDir 已在前面通过 ensureDir 创建

    // 提示用户
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
        log.showYellow(logTag, t("common.aborted.by.user"))
        return
    }

    log.showGreen(logTag, t("pick.copy.start", { dryRun: argv.dryRun }))

    // 用于生成报告
    const reportData = {} // { "202401": ["name1.jpg", "name2.jpg"] }

    const mapper = async (f) => {
        // 计算目标路径结构：Year/YearMonth/Filename
        // f.date 已经在 parseFilesByName 中解析为 Date 对象
        const date = dayjs(f.date)
        const year = date.format("YYYY")
        const month = date.format("YYYYMM")

        // 目标相对路径：2024\202401\IMG_001.jpg
        const destRel = path.join(year, month, path.basename(f.path))
        const dest = path.join(outDir, destRel)

        // 文件大小格式化
        const sizeStr = (f.size / 1024 / 1024).toFixed(2) + " MB"

        if (argv.dryRun) {
            log.show(logTag, t("pick.copy.dryrun", { src: f.path, dest: dest, size: sizeStr }))
            return { status: "success" }
        } else {
            ++copyIndex
            try {
                // 检查目标是否存在
                if (await fs.pathExists(dest)) {
                    log.showGray(
                        logTag,
                        t("pick.copy.skip.exists", {
                            index: `${copyIndex}/${copyTotal}`,
                            path: f.path,
                        }),
                    )
                    return { status: "skipped", month: month, srcPath: f.path }
                }

                await fs.ensureDir(path.dirname(dest))
                await fs.copy(f.path, dest, { preserveTimestamps: true })

                log.show(
                    logTag,
                    t("pick.copy.done", {
                        index: `${copyIndex}/${copyTotal}`,
                        name: helper.pathShort(f.path),
                        dest: path.dirname(destRel),
                        size: sizeStr,
                    }),
                )
                // 返回成功信息以便后续统计
                return { status: "success", month: month, srcPath: f.path }
            } catch (err) {
                log.showRed(logTag, t("pick.copy.error", { path: f.path }), err)
                return { status: "error", error: err }
            }
        }
    }

    const results = await pMap(files, mapper, { concurrency: cpus().length })

    // 统一统计结果
    const count = results.filter((r) => r.status === "success").length
    const skipCount = results.filter((r) => r.status === "skipped").length
    const errorCount = results.filter((r) => r.status === "error").length

    // 构建报告数据
    if (!argv.dryRun) {
        results.forEach((r) => {
            if ((r.status === "success" || r.status === "skipped") && r.month && r.srcPath) {
                if (!reportData[r.month]) reportData[r.month] = []
                reportData[r.month].push(r.srcPath)
            }
        })
    }

    log.showGreen(logTag, t("pick.copy.finish", { count, skip: skipCount, error: errorCount }))

    if (!argv.dryRun && count > 0) {
        const nowTag = dayjs().format("YYYYMMDD_HHmmss")
        const reportName = path.join(outDir, `report_${nowTag}.json`)
        try {
            await fs.writeJson(reportName, reportData, { spaces: 2 })
            log.showGreen(logTag, t("pick.report.saved", { path: reportName }))
        } catch (e) {
            log.showRed(logTag, t("pick.report.failed", { error: e.message }))
        }
    }
}

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

// 构建最终的 JSON 输出对象
function buildJsonOutput(daySelections, srcStats, selStats) {
    // 输出 JSON 结构说明:
    // {
    //   generatedAt: "2026-02-17 12:00:00",
    //   files: [ // 被选中的文件列表，按年-月层级组织
    //     {
    //       year: "2024",
    //       months: [
    //         {
    //           month: "202401",
    //           total: 100,      // 该月原始总数
    //           selected: 20,    // 该月选中总数
    //           files: ["path/to/img1.jpg", ...] // 选中的文件路径列表
    //         }
    //       ]
    //     }
    //   ],
    //   stats: [ // 详细统计信息
    //     {
    //       year: "2024",
    //       stats: {
    //         total: 1000,
    //         selected: 200,
    //         months: {
    //           "202401": { total: 100, selected: 20, days: { "20240101": { total: 10, selected: 2 } } }
    //         }
    //       }
    //     }
    //   ]
    // }

    const filesByYear = new Map()
    const statsByYear = new Map()

    // 遍历所有年份（以源数据为准，覆盖所有年份）
    const allYears = Array.from(srcStats.years.keys()).sort()

    const outputFiles = []
    const outputStats = []

    for (const year of allYears) {
        // --- 构建文件部分 (Files Section) ---
        const yearMonths = []
        // 查找属于该年的所有月份
        const monthsInYear = Array.from(srcStats.months.keys())
            .filter((m) => m.startsWith(year))
            .sort()

        for (const m of monthsInYear) {
            const mFiles = []
            // 收集该月份被选中的文件
            // 需要遍历该月包含的所有日期
            const daysInMonth = Array.from(daySelections.keys())
                .filter((d) => d.startsWith(m))
                .sort()

            for (const d of daysInMonth) {
                const arr = daySelections.get(d)
                if (arr) mFiles.push(...arr.map((f) => f.path))
            }

            const monthKey = m.replace("-", "") // 格式化: 2025-01 -> 202501
            const mTotal = srcStats.months.get(m) || 0

            // 仅当该月有选中文件时才添加到输出列表
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

        // --- 构建统计部分 (Stats Section) ---
        const yStats = {
            total: srcStats.years.get(year) || 0,
            selected: selStats.years.get(year) || 0,
            months: {},
            // days: {}, // 每日统计已移动到 months 节点下
        }

        for (const m of monthsInYear) {
            const monthKey = m.replace("-", "") // 2025-01 -> 202501

            // 收集该月内的每日统计数据
            const daysData = {}
            const daysInMonth = Array.from(srcStats.days.keys())
                .filter((d) => d.startsWith(m))
                .sort()

            for (const d of daysInMonth) {
                const dayKey = d.replaceAll("-", "") // 2025-01-01 -> 20250101
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

// ----------------------------------------------------------------------------
// 逻辑实现
// ----------------------------------------------------------------------------

// 从文件名提取日期时间
async function parseFilesByName(entries) {
    const mapper = async (e) => {
        // Regex: YYYY MM DD [_-]? HH mm ss
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

        // Basic Range Check
        if (Y < 2000 || Y > 2050) return null
        if (M < 1 || M > 12) return null
        if (D < 1 || D > 31) return null
        if (h > 23) return null
        if (m_ > 59) return null
        if (s > 59) return null

        const dateStr = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
        const date = dayjs(dateStr)

        if (date.isValid()) {
            // Strict check to prevent auto-correction (e.g. Feb 30 -> Mar 2)
            if (date.year() !== Y || date.month() + 1 !== M || date.date() !== D) {
                return null
            }
            return {
                name: e.name,
                path: e.path,
                // 保留 size 用于智能选择策略（优先选大图）
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

// 按天分组并应用日常挑选规则
async function processDailySelections(parsed, argv = {}) {
    const dayLimit = argv.dayLimit || CONFIG.MAX_FILES_PER_DAY
    // Group by day
    const days = new Map()
    for (const it of parsed) {
        if (!days.has(it.dayKey)) days.set(it.dayKey, [])
        days.get(it.dayKey).push(it)
    }

    const selections = new Map()
    const dayKeys = Array.from(days.keys())

    const mapper = async (day) => {
        const files = days.get(day) // 这一天的所有文件
        files.sort((a, b) => a.date - b.date) // 确保按时间排序，虽然 parseFilesByName 已经排过，但为了安全

        const total = files.length
        let targetCount = 0

        if (total < CONFIG.MIN_FILES_KEEP_ALL) {
            targetCount = total
        } else {
            // Gradient ratios
            let ratio = CONFIG.MAX_RATIO
            for (const level of CONFIG.RATIO_LEVELS) {
                if (total < level.limit) {
                    ratio = level.ratio
                    break
                }
            }
            targetCount = Math.ceil(total / ratio)

            // 每日最大数量限制
            if (targetCount > dayLimit) {
                targetCount = dayLimit
            }
        }

        // 确保不超过总数
        if (targetCount > total) targetCount = total

        // selectForDay 是纯 CPU 计算
        const picked = selectForDay(files, targetCount)
        return { day, picked }
    }

    // 虽然是同步计算，使用 pMap 可以避免长时间阻塞事件循环（如果每步稍微 yield 一下）
    // 但目前 selectForDay 没有 yield。
    // 如果想要利用多核，必须用 Worker Threads，但在 JS 单线程模型下，这里主要是为了代码结构一致性
    // 并且如果列表很大，分批处理比一个大循环稍微好一点点（GC 友好？）
    const results = await pMap(dayKeys, mapper, { concurrency: cpus().length })

    for (const res of results) {
        selections.set(res.day, res.picked)
    }
    return selections
}

// 针对单天的具体挑选逻辑
// 规则：使用配置常量控制间隔和数量
function selectForDay(files, targetN) {
    if (targetN === 0) return []
    // 少量照片全选
    if (files.length < CONFIG.MIN_FILES_KEEP_ALL) return files.slice()

    // 准备文件大小信息（如果没有size属性，尝试使用mock或fallback）
    // entries 来自 walk 结果，应该有 size (fs.Stats)
    // 之前解析时 parseFilesByName 没带 size，这里需要修正 parseFilesByName 或在此处读取
    // 实际上 parseFilesByName 里注掉了 size。我们需要回去把 size 加上。
    // 假设 files 里现在有了 size (见下文修正)

    const len = files.length

    // 动态计算最小间隔 (依据当天总照片数)
    // < 50 张: 10秒
    // < 100 张: 30秒
    // < 500 张: 2 分钟
    // < 1000 张: 3 分钟
    // >= 1000 张: 4 分钟 (维持原状)
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

    // 生成目标索引：平均分布
    const indices = []
    for (let i = 0; i < targetN; i++) {
        indices.push(Math.floor(((i + 0.5) * len) / targetN))
    }

    const picked = []
    const takenIndices = new Set()
    const hourCounts = new Map() // 'YYYY-MM-DD-HH' -> count

    // Pet limit
    const petRe = /猪|宠|猫|鸟|鱼|鹦鹉|cat|bird/i
    let petCount = 0

    // 检查是否可被选中
    const canPick = (idx) => {
        const candidate = files[idx]
        const candTime = candidate.date.getTime()
        const candHour = dayjs(candidate.date).format("YYYY-MM-DD-HH")

        // 1. 每小时限制
        if ((hourCounts.get(candHour) || 0) >= CONFIG.MAX_PER_HOUR) return false

        // 2. 宠物照片限制
        if (petRe.test(candidate.path)) {
            if (petCount >= CONFIG.MAX_PET_PER_DAY) return false
        }

        // 3. 间隔限制
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

    // 智能选择策略：在 idealIdx 附近寻找“最好”的一张
    // 最好 = 满足约束 && (位于中间 OR 文件最大)
    // 根据需求：优化采样策略：不仅仅是“取第一个”，用中间或体积大的那个
    // 我们定义一个窗口 WINDOW_SIZE，在 idealIdx 前后寻找最佳候选者
    const SEARCH_RADIUS = Math.max(1, Math.floor(len / targetN / 2)) // 动态搜索半径

    for (const idealIdx of indices) {
        // 定义搜索范围 [start, end]
        const start = Math.max(0, idealIdx - SEARCH_RADIUS)
        const end = Math.min(len - 1, idealIdx + SEARCH_RADIUS)

        let bestIdx = -1
        let maxScore = -1

        // 寻找该范围内所有尚未被选且满足条件的候选者
        const candidates = []
        for (let i = start; i <= end; i++) {
            if (!takenIndices.has(i) && canPick(i)) {
                candidates.push(i)
            }
        }

        if (candidates.length === 0) continue // 该范围内无可用照片（可能被间隔或小时限制卡死）

        // 评分：体积优先
        for (const idx of candidates) {
            // files[idx] 必须有 size 属性，如果没有视为 0
            const score = files[idx].size || 0
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
// 删除 applyMonthlyLimit 实现，因为不再使用
// function applyMonthlyLimit...

// 统计与输出
// ----------------------------------------------------------------------------

// Unused legacy text stats functions removed
// function buildStats(list) ...
// function formatStatsText(stats) ...

async function filterIgnoredDirs(entries, root) {
    const dirCache = new Map() // dir -> Boolean

    // 1. 获取所有涉及的唯一目录
    const allDirs = [...new Set(entries.map((e) => path.dirname(e.path)))]

    // 2. 排序：按路径长度（短的在前），确保先处理父目录
    // 这样能够最大程度利用缓存，减少不必要的 FS 检查
    allDirs.sort((a, b) => a.length - b.length || a.localeCompare(b))

    // 3. 检查逻辑
    // 为了防止递归造成的重复 Promise，我们需要一个 pendingCache
    const pendingCache = new Map()

    const checkDir = async (dir) => {
        if (dirCache.has(dir)) return dirCache.get(dir)
        if (pendingCache.has(dir)) return pendingCache.get(dir)

        const promise = (async () => {
            // 边界情况：如果超出 root 范围
            if (root && dir.length < root.length) return false
            if (dir === "." || dir === "/" || dir === "") return false

            // 先检查父目录
            const parent = path.dirname(dir)
            let parentIgnored = false

            if (parent && parent !== dir && parent.length >= root.length) {
                // 递归调用，由于有 pendingCache，不会死循环也不会重复执行
                parentIgnored = await checkDir(parent)
            }

            if (parentIgnored) return true

            // 父目录未忽略，检查当前目录是否有标记文件
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

    // 4. 执行检查（使用 pMap 控制并发）
    // 虽然我们有 pendingCache，但为了避免深度递归导致的栈溢出（虽然 async 不太会），
    // 或者过多的 Promise 创建，我们依然使用 pMap。
    // 由于父目录已排在前面，父目录的 Promise 会先被创建和执行。
    await pMap(allDirs, checkDir, { concurrency: cpus().length })

    // 5. 过滤文件
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

    // Show top 20 days overall
    const topDays = Array.from(stats.days.entries())
        .sort((a, b) => b[1] - a[1]) // Sort by count desc
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
        // Group by month
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
                // Extract just the day part? Or keep full date?
                // User example: 202412: 844/3456 -> Implicitly "Month: ..."
                // If displaying days under month, maybe only show day part "01: 5/20"
                const dayPart = d.slice(8)
                console.log(`    ${dayPart}: ${c}/${t}`)
            }
        }
    }
}
