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

// 主命令：按文件名提取时间，挑选照片并输出 files/stats 文件与控制台汇总
export async function cmdPick(argv) {
    const logTag = "cmdPick"
    log.show(logTag, argv)

    const root = await helper.validateInput(argv.input)
    const walkOpts = {
        needStats: true,
        entryFilter: (f) => f.isFile && helper.isImageFile(f.name || f.path),
    }
    const entries = await mf.walk(root, walkOpts)
    if (!entries || entries.length === 0) {
        log.showYellow(logTag, "no files found, abort.")
        return
    }

    // 从文件名提取日期
    const parsed = parseFilesByName(entries)
    if (!parsed.length) {
        log.showYellow(logTag, "未从文件名中提取到日期时间，已中止。")
        return
    }

    parsed.sort((a, b) => new Date(a.date) - new Date(b.date))

    // 按日分组并挑选
    const days = new Map()
    for (const it of parsed) {
        const key = dayjs(it.date).format("YYYY-MM-DD")
        if (!days.has(key)) days.set(key, [])
        days.get(key).push(it)
    }

    const daySelections = new Map()
    for (const [day, files] of days.entries()) {
        const total = files.length
        const pickCount = total < 5 ? total : Math.min(50, Math.ceil(total / 5))
        daySelections.set(day, selectForDay(files, pickCount))
    }

    applyMonthlyLimit(daySelections, 1000)

    const finalList = []
    for (const day of Array.from(daySelections.keys()).sort()) {
        const arr = daySelections.get(day) || []
        arr.sort((a, b) => new Date(a.date) - new Date(b.date))
        finalList.push(...arr)
    }

    // 输出 files 和 stats
    const nowTag = dayjs().format("YYYYMMDD_HHmmss")
    const outDir = argv.output ? path.dirname(path.resolve(argv.output)) : process.cwd()
    const filesName = path.join(outDir, `files_${nowTag}.txt`)
    const statsName = path.join(outDir, `stats_${nowTag}.txt`)

    await fs.outputFile(filesName, finalList.map((f) => f.path).join("\n"), "utf8")
    if (argv.output)
        await fs.outputFile(argv.output, finalList.map((f) => f.path).join("\n"), "utf8")

    const stats = buildStats(finalList)
    await fs.outputFile(statsName, formatStatsText(stats), "utf8")

    // 控制台输出（年/月，天数过多则省略）
    console.log(`Total selected: ${finalList.length}`)
    for (const [y, c] of Array.from(stats.years.entries()).sort()) console.log(`  ${y}: ${c}`)
    for (const [m, c] of Array.from(stats.months.entries()).sort()) console.log(`  ${m}: ${c}`)

    if (stats.days.size <= 50) {
        for (const [d, c] of Array.from(stats.days.entries()).sort()) console.log(`  ${d}: ${c}`)
    } else {
        console.log(
            `By day: too many days (${stats.days.size}), omitted in console. See ${statsName}`,
        )
    }

    log.showGreen(logTag, `Wrote files to ${filesName} and stats to ${statsName}`)
}

// 从文件名提取日期时间，返回 {path, root, size, date}
function parseFilesByName(entries) {
    const out = []
    const re = /(\d{8})[_-]?(\d{6})/
    for (const e of entries) {
        const name = path.basename(e.path || e.name || "")
        const m = name.match(re)
        if (!m) continue
        const ds = `${m[1]}${m[2]}`
        const dt = dayjs(ds, "YYYYMMDDHHmmss")
        if (!dt.isValid()) continue
        out.push({
            path: e.path,
            root: e.root,
            size: e.size || e.stats?.size || 0,
            date: dt.toDate(),
        })
    }
    return out
}

// 按天挑选：5 分钟最小间隔、每小时最多 10 张，尽量平均分布
function selectForDay(files, targetN) {
    if (!files.length) return []
    if (targetN >= files.length) return files.slice()
    const picked = []
    const taken = new Set()
    const hourCount = new Map()
    const minMs = 5 * 60 * 1000
    const len = files.length
    const indices = new Set()
    for (let i = 0; i < targetN; i++)
        indices.add(Math.min(Math.floor(((i + 0.5) * len) / targetN), len - 1))

    const can = (cand) => {
        if (picked.length) {
            const last = picked[picked.length - 1]
            if (Math.abs(new Date(cand.date) - new Date(last.date)) < minMs) return false
        }
        const hr = dayjs(cand.date).format("YYYY-MM-DD-HH")
        if ((hourCount.get(hr) || 0) >= 10) return false
        return true
    }

    const tryAt = (i) => {
        if (taken.has(i)) return false
        const c = files[i]
        if (can(c)) {
            taken.add(i)
            picked.push(c)
            const hr = dayjs(c.date).format("YYYY-MM-DD-HH")
            hourCount.set(hr, (hourCount.get(hr) || 0) + 1)
            return true
        }
        return false
    }

    for (const i of indices) {
        if (tryAt(i)) continue
        let found = false
        for (let j = i + 1; j < len && !found; j++) if (tryAt(j)) found = true
        for (let j = i - 1; j >= 0 && !found; j--) if (tryAt(j)) found = true
    }

    for (let i = 0; i < len && picked.length < targetN; i++) if (!taken.has(i)) tryAt(i)

    picked.sort((a, b) => new Date(a.date) - new Date(b.date))
    return picked.slice(0, targetN)
}

// 月度限制：每月最多 monthLimit，超出从日最多的天开始逐日减少
function applyMonthlyLimit(daySelections, monthLimit = 1000) {
    const monthMap = new Map()
    for (const [day, arr] of daySelections.entries()) {
        const month = day.slice(0, 7)
        if (!monthMap.has(month)) monthMap.set(month, [])
        monthMap.get(month).push({ day, count: arr.length })
    }
    for (const [month, list] of monthMap.entries()) {
        let total = list.reduce((s, it) => s + it.count, 0)
        if (total <= monthLimit) continue
        while (total > monthLimit) {
            list.sort((a, b) => b.count - a.count)
            const top = list[0]
            if (!top || top.count <= 1) break
            const arr = daySelections.get(top.day)
            if (arr && arr.length > 0) {
                arr.pop()
                top.count = arr.length
                total -= 1
            } else break
        }
    }
}

function buildStats(list) {
    const days = new Map(),
        months = new Map(),
        years = new Map()
    for (const it of list) {
        const d = dayjs(it.date)
        const day = d.format("YYYY-MM-DD"),
            month = d.format("YYYY-MM"),
            year = d.format("YYYY")
        days.set(day, (days.get(day) || 0) + 1)
        months.set(month, (months.get(month) || 0) + 1)
        years.set(year, (years.get(year) || 0) + 1)
    }
    return { days, months, years }
}

function formatStatsText(stats) {
    const lines = []
    const total = Array.from(stats.days.values()).reduce((s, v) => s + v, 0)
    lines.push(`Total selected: ${total}`)
    lines.push("")
    lines.push("By year:")
    for (const [y, c] of Array.from(stats.years.entries()).sort()) lines.push(`${y}: ${c}`)
    lines.push("")
    lines.push("By month:")
    for (const [m, c] of Array.from(stats.months.entries()).sort()) lines.push(`${m}: ${c}`)
    lines.push("")
    lines.push("By day (grouped by month):")
    const monthToDays = new Map()
    for (const [day, count] of stats.days.entries()) {
        const month = day.slice(0, 7)
        if (!monthToDays.has(month)) monthToDays.set(month, [])
        monthToDays.get(month).push([day, count])
    }
    for (const [month, arr] of Array.from(monthToDays.entries()).sort()) {
        const parts = arr
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map((it) => `${it[0].slice(8)}:${it[1]}`)
        lines.push(`${month}: ${parts.join(", ")}`)
    }
    return lines.join("\n")
}
