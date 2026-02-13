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
import path from "path"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

export { aliases, builder, command, describe, handler }

const command = "pick <input>"
const aliases = ["pk"]
const describe = t("pick.description")

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

const handler = cmdPick

// 主命令：按文件名提取时间，挑选照片并输出 picked/stats 文件与控制台汇总
export async function cmdPick(argv) {
    const logTag = "cmdPick"
    log.show(logTag, argv)

    // 1. 扫描文件
    const root = await helper.validateInput(argv.input)
    const ignoreRe = /delete|thumb/i
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
        log.showYellow(logTag, "No files found, abort.")
        return
    }

    // 2. 提取日期
    const parsed = parseFilesByName(entries)
    if (!parsed.length) {
        log.showYellow(logTag, "No valid dates found in filenames, abort.")
        return
    }
    // 初始排序
    parsed.sort((a, b) => a.date - b.date)

    // 3. 应用挑选规则
    const daySelections = processDailySelections(parsed)
    applyMonthlyLimit(daySelections, 1000)

    // 4. 汇总结果
    const finalList = []
    for (const day of Array.from(daySelections.keys()).sort()) {
        const arr = daySelections.get(day)
        arr.sort((a, b) => a.date - b.date)
        finalList.push(...arr)
    }

    // 5. 输出文件
    const nowTag = dayjs().format("YYYYMMDD_HHmmss")
    // 如果指定了 output，则 output 作为输出目录，否则使用 input 目录
    const outDir = argv.output ? argv.output : root
    // 确保是目录
    await fs.ensureDir(outDir)

    const pickedName = path.join(outDir, `picked_${nowTag}.txt`)
    const statsName = path.join(outDir, `stats_${nowTag}.txt`)

    await fs.writeFile(pickedName, finalList.map((f) => f.path).join("\n"), "utf8")

    const stats = buildStats(finalList)
    await fs.writeFile(statsName, formatStatsText(stats), "utf8")

    // 6. 控制台输出
    printConsoleStats(finalList.length, stats, statsName)
    log.showGreen(logTag, `Results saved to:\n  ${pickedName}\n  ${statsName}`)
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
        // 规则：每天挑 1/5，最多 50；<5 则全选
        const total = files.length
        let targetCount = total < 5 ? total : Math.ceil(total / 5)
        if (targetCount > 50) targetCount = 50

        const picked = selectForDay(files, targetCount)
        selections.set(day, picked)
    }
    return selections
}

// 针对单天的具体挑选逻辑
// 规则：间隔 >= 5分钟，每小时 <= 10张，平均分布
function selectForDay(files, targetN) {
    if (targetN === 0) return []
    // 如果当天照片少于5张，则全部挑选
    // 假设这里的“少于5张”是特例，不受间隔限制
    if (files.length < 5) return files.slice()

    // 对于普通情况，需满足约束
    const len = files.length
    // 生成目标索引：平均分布
    const indices = []
    for (let i = 0; i < targetN; i++) {
        indices.push(Math.floor(((i + 0.5) * len) / targetN))
    }

    const picked = []
    const takenIndices = new Set()
    const hourCounts = new Map() // 'YYYY-MM-DD-HH' -> count

    // Pet limit
    const petRe = /荷兰猪|宠物|猫|鸟|cat|bird/i
    let petCount = 0

    const minInterval = 5 * 60 * 1000 // 5 minutes

    // 检查是否可被选中
    const canPick = (idx) => {
        const candidate = files[idx]
        const candTime = candidate.date.getTime()
        const candHour = dayjs(candidate.date).format("YYYY-MM-DD-HH")

        // 1. 每小时限制
        if ((hourCounts.get(candHour) || 0) >= 10) return false

        // 2. 宠物照片限制 (每天最多 10 张)
        if (petRe.test(candidate.path)) {
            if (petCount >= 10) return false
        }

        // 3. 间隔限制
        for (const p of picked) {
            if (Math.abs(candTime - p.date.getTime()) < minInterval) return false
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

    // 尝试在理想位置附近寻找可用照片
    for (const idealIdx of indices) {
        if (canPick(idealIdx)) {
            doPick(idealIdx)
        } else {
            // 向两边搜索
            let left = idealIdx - 1
            let right = idealIdx + 1
            let found = false
            while ((left >= 0 || right < len) && !found) {
                if (right < len && !takenIndices.has(right) && canPick(right)) {
                    doPick(right)
                    found = true
                } else if (left >= 0 && !takenIndices.has(left) && canPick(left)) {
                    doPick(left)
                    found = true
                }
                left--
                right++
            }
        }
    }

    picked.sort((a, b) => a.date - b.date)
    return picked
}

// 应用月度限制：每月最多 monthLimit，超出则从照片最多的那天削减
function applyMonthlyLimit(daySelections, monthLimit) {
    const monthMap = new Map()
    for (const [day, list] of daySelections.entries()) {
        const m = day.slice(0, 7) // YYYY-MM
        if (!monthMap.has(m)) monthMap.set(m, [])
        monthMap.get(m).push({ day, list }) // list is reference
    }

    for (const [m, days] of monthMap.entries()) {
        let currentTotal = days.reduce((sum, d) => sum + d.list.length, 0)

        // 循环直到满足限制
        while (currentTotal > monthLimit) {
            // 找出照片最多的那天
            // 排序：数量降序
            days.sort((a, b) => b.list.length - a.list.length)
            const topDay = days[0]

            // 如果最多的那天也没照片了，跳出
            if (!topDay || topDay.list.length === 0) break

            // 削减：从该天移除一张
            topDay.list.pop()
            currentTotal--
        }
    }
}

// ----------------------------------------------------------------------------
// 统计与输出
// ----------------------------------------------------------------------------

function buildStats(list) {
    const days = new Map()
    const months = new Map()
    const years = new Map()

    for (const it of list) {
        const d = dayjs(it.date)
        const dayKey = d.format("YYYY-MM-DD")
        const monKey = d.format("YYYY-MM")
        const yearKey = d.format("YYYY")

        days.set(dayKey, (days.get(dayKey) || 0) + 1)
        months.set(monKey, (months.get(monKey) || 0) + 1)
        years.set(yearKey, (years.get(yearKey) || 0) + 1)
    }
    return { days, months, years }
}

function formatStatsText(stats) {
    const lines = []
    const total = Array.from(stats.days.values()).reduce((a, b) => a + b, 0)
    lines.push(`Total selected: ${total}`)
    lines.push("")

    lines.push("[By Year]")
    const sortedYears = Array.from(stats.years.entries()).sort()
    for (const [k, v] of sortedYears) lines.push(`${k}: ${v}`)

    lines.push("")
    lines.push("[By Month]")
    const sortedMonths = Array.from(stats.months.entries()).sort()
    for (const [k, v] of sortedMonths) lines.push(`${k}: ${v}`)

    lines.push("")
    lines.push("[By Day] (Grouped by Month)")
    // Group days by month for compact display
    const daysByMonth = new Map()
    for (const [day, count] of stats.days.entries()) {
        const m = day.slice(0, 7)
        if (!daysByMonth.has(m)) daysByMonth.set(m, [])
        daysByMonth.get(m).push({ day, count })
    }

    const monthKeys = Array.from(daysByMonth.keys()).sort()
    for (const m of monthKeys) {
        const ds = daysByMonth.get(m)
        ds.sort((a, b) => (a.day < b.day ? -1 : 1))
        // "按天信息可以精简不用每个一行，可以合并"
        // Format: 2021-01: 01(5), 02(10), 05(3)...
        const dailyStr = ds.map((d) => `${d.day.slice(8)}(${d.count})`).join(", ")
        lines.push(`${m}: ${dailyStr}`)
    }

    return lines.join("\n")
}

function printConsoleStats(total, stats, statsFile) {
    console.log(`Total selected: ${total}`)

    console.log("By Year:")
    Array.from(stats.years.entries())
        .sort()
        .forEach(([k, v]) => console.log(`  ${k}: ${v}`))

    console.log("By Month:")
    Array.from(stats.months.entries())
        .sort()
        .forEach(([k, v]) => console.log(`  ${k}: ${v}`))

    if (stats.days.size <= 30) {
        // Less days, show parsed list
        console.log("By Day:")
        const sortedDays = Array.from(stats.days.entries()).sort()
        for (const [d, c] of sortedDays) {
            console.log(`  ${d}: ${c}`)
        }
    } else {
        console.log(
            `By Day: ${stats.days.size} days active (details omitted in console, see stats file)`,
        )
    }
}
