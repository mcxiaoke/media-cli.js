/*
 * Project: mediac
 * Created: 2026-02-13 17:16:15
 * Modified: 2026-02-13 17:16:15
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

/**
 *
 * 项目计划和要求：
 *
 * 我有很多照片，目录结构如下
 *
 * 手机照片
 *  2021
 *   2021-01
 *   2021-02
 *   2021-03
 *  2022
 *   2022-01
 *   2022-02 宠物
 *   2022-03 人像
 *  2023
 *
 * 照片的文件名都包含日期和时间，例如：IMG_20210101_120000.heic
 *
 * 按年份分类，可能有多级子目录
 *
 * 我想按照时间线，每天挑出一些照片，组成照片日记
 * 规则如下：
 *
 * 小时限制：挑选的照片之间至少间隔5分钟；每小时最多10张
 * 每天限制：从每天的照片里挑选五分之一，最多50张；如果当天照片少于5张，则全部挑选
 * 确定每天的数目后，按时间顺序排序，平均分布
 * 月度限制：每月最多1000张，如果超过，从照片最多的那天开始按比例削减
 *
 *
 *
 * 在input目录生成两个文件 stats_{datetime}.txt 和 picked_{datetime}.txt
 * 命令行同时输出按天和按月和按年统计信息，
 * 如果按天信息过多，命令行就不给出，但 stats 文件里还是要有，
 * 按天信息可以精简不用每个一行，可以合并
 *
 */

import dayjs from "dayjs"
import fs from "fs-extra"
import inquirer from "inquirer"
import os from "os"
import pMap from "p-map"
import path from "path"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

export { aliases, builder, command, describe, handler }

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
        { limit: 100, ratio: 2 },
        { limit: 500, ratio: 3 },
        { limit: 1000, ratio: 4 },
    ],
    MAX_RATIO: 5, // > 1000

    // 如果当天照片极其少 (< MIN_FILES_KEEP_ALL)，则全部保留
    MIN_FILES_KEEP_ALL: 5,

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
        .option("extensions", {
            alias: "e",
            type: "string",
            describe: t("option.common.extensions"),
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

// 主命令：按文件名提取时间，挑选照片并输出 picked/stats 文件与控制台汇总
export async function cmdPick(argv) {
    const logTag = "cmdPick"
    log.show(logTag, argv)

    // 1. 扫描文件
    const root = await helper.validateInput(argv.input)
    const ignoreRe = /delete|thumb|MVIMG/i
    const walkOpts = {
        needStats: true,
        entryFilter: (f) => {
            if (!f.isFile) return false
            if (ignoreRe.test(f.path)) return false
            return helper.isImageFile(f.name || f.path)
        },
    }
    const entries = await mf.walk(root, walkOpts)
    if (!entries.length) {
        log.showYellow(logTag, t("pick.no.files"))
        return
    }

    // 2. 提取日期
    const parsed = parseFilesByName(entries)
    if (!parsed.length) {
        log.showYellow(logTag, t("pick.no.dates"))
        return
    }
    // 初始排序
    parsed.sort((a, b) => a.date - b.date)

    // 3. 统计原始数据（筛选前）
    const sourceStats = calculateSourceStats(parsed)

    // 4. 应用挑选规则
    const daySelections = processDailySelections(parsed)
    // Monthly limit logic removed as per request
    // applyMonthlyLimit(daySelections, 1000)

    // 5. 汇总结果与构建JSON
    // 聚合 selected
    const finalList = []
    const selectedStats = { days: new Map(), months: new Map(), years: new Map() }

    for (const day of Array.from(daySelections.keys()).sort()) {
        const arr = daySelections.get(day)
        arr.sort((a, b) => a.date - b.date)
        finalList.push(...arr)

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

    const outputData = buildJsonOutput(daySelections, sourceStats, selectedStats)
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
    printConsoleStats(finalList.length, selectedStats, sourceStats, jsonName)
    log.showGreen(logTag, t("pick.result.saved", { path: jsonName }))

    // 8. 复制文件到输出目录
    if (finalList.length > 0) {
        await copyPickedFiles(finalList, root, argv)
    }
}

async function copyPickedFiles(files, root, argv) {
    const logTag = "cmdPick"
    if (!argv.output) {
        log.showYellow(logTag, t("pick.skip.copy.no.output"))
        return
    }

    const outDir = argv.output
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
            try {
                // 检查目标是否存在
                if (await fs.pathExists(dest)) {
                    log.show(logTag, t("pick.copy.skip.exists", { path: f.path }))
                    return { status: "skipped", month: month, srcPath: f.path }
                }

                await fs.ensureDir(path.dirname(dest))
                await fs.copy(f.path, dest, { preserveTimestamps: true })

                log.show(
                    logTag,
                    t("pick.copy.done", {
                        name: path.basename(f.path),
                        dest: destRel,
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

    const results = await pMap(files, mapper, { concurrency: argv.jobs })

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

function buildJsonOutput(daySelections, srcStats, selStats) {
    // Structure:
    // files: [ { year, months: [ { month, files: [] } ] } ]
    // stats: [ { year, stats: { total, selected, months: {}, days: {} } } ]

    const filesByYear = new Map()
    const statsByYear = new Map()

    // Iterate all known years/months from source or selected?
    // Usually source contains all years.
    const allYears = Array.from(srcStats.years.keys()).sort()

    const outputFiles = []
    const outputStats = []

    for (const year of allYears) {
        // Build Files Section
        const yearMonths = []
        // Find months in this year
        const monthsInYear = Array.from(srcStats.months.keys())
            .filter((m) => m.startsWith(year))
            .sort()

        for (const m of monthsInYear) {
            const mFiles = []
            // Collect files for this month
            // Need to scan days in this month
            const daysInMonth = Array.from(daySelections.keys())
                .filter((d) => d.startsWith(m))
                .sort()

            for (const d of daysInMonth) {
                const arr = daySelections.get(d)
                if (arr) mFiles.push(...arr.map((f) => f.path))
            }

            const monthKey = m.replace("-", "") // 2025-01 -> 202501
            const mTotal = srcStats.months.get(m) || 0

            // Only add to files list if selected > 0
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

        // Build Stats Section
        const yStats = {
            total: srcStats.years.get(year) || 0,
            selected: selStats.years.get(year) || 0,
            months: {},
            // days: {}, // moved to under months
        }

        for (const m of monthsInYear) {
            const monthKey = m.replace("-", "") // 2025-01 -> 202501

            // Days in this month
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
function parseFilesByName(entries) {
    const out = []
    // Regex: YYYY MM DD [_-]? HH mm ss
    const re = /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/
    for (const e of entries) {
        const name = path.basename(e.path)
        const m = name.match(re)
        if (!m) continue

        const Y = parseInt(m[1], 10)
        const M = parseInt(m[2], 10)
        const D = parseInt(m[3], 10)
        const h = parseInt(m[4], 10)
        const m_ = parseInt(m[5], 10)
        const s = parseInt(m[6], 10)

        // Basic Range Check
        if (Y < 2000 || Y > 2050) continue
        if (M < 1 || M > 12) continue
        if (D < 1 || D > 31) continue
        if (h > 23) continue
        if (m_ > 59) continue
        if (s > 59) continue

        const dateStr = `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`
        const date = dayjs(dateStr)

        if (date.isValid()) {
            // Strict check to prevent auto-correction (e.g. Feb 30 -> Mar 2)
            if (date.year() !== Y || date.month() + 1 !== M || date.date() !== D) {
                continue
            }
            out.push({
                path: e.path,
                // 保留 size 用于智能选择策略（优先选大图）
                size: e.size || (e.stats && e.stats.size) || 0,
                date: date.toDate(),
                dayKey: date.format("YYYY-MM-DD"),
            })
        }
    }
    return out
}

// 按天分组并应用日常挑选规则
function processDailySelections(parsed) {
    // Group by day
    const days = new Map()
    for (const it of parsed) {
        if (!days.has(it.dayKey)) days.set(it.dayKey, [])
        days.get(it.dayKey).push(it)
    }

    const selections = new Map()
    for (const [day, files] of days.entries()) {
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
        }

        // 确保不超过总数
        if (targetCount > total) targetCount = total

        const picked = selectForDay(files, targetCount)
        selections.set(day, picked)
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
    // < 1000 张: 4 分钟
    // >= 1000 张: 6 分钟 (维持原状)
    let minIntervalMs = 6 * 60 * 1000
    if (len < 50) {
        minIntervalMs = 10 * 1000
    } else if (len < 100) {
        minIntervalMs = 30 * 1000
    } else if (len < 500) {
        minIntervalMs = 2 * 60 * 1000
    } else if (len < 1000) {
        minIntervalMs = 4 * 60 * 1000
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
    const petRe = /猪|宠|猫|鸟|鱼|cat|bird/i
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
    if (dayCount <= 30) {
        console.log("By Day:")
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
    } else {
        console.log(`By Day: ${dayCount} days active (details in json file)`)
    }
}
