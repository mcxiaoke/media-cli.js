/*
 * File: cmd_move.js
 * Created: 2024-03-15 20:57:59 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import dayjs from "dayjs"
import timezone from "dayjs/plugin/timezone.js"
import utc from "dayjs/plugin/utc.js"
import fs from "fs-extra"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { isSameFileCached } from "../lib/tools.js"
import { applyFileNameRules } from "./cmd_shared.js"
import { t } from "../lib/i18n.js"

dayjs.extend(utc)
dayjs.extend(timezone)

// 按照文件名日期时间格式移动到对应目录，视频和图片分开，暂不支持其它格式
// const filename_samples = [
//     "VID_20241231_144423_C",
//     "VID_20241231_144423",
//     "ABC_20250115_103000_extra",
//     "MP4_20250123_222540.mp4",
//     "VID_20250401_091235_C.mp4",
//     "VID_20250605_121258.mp4",
//     "IMG_20231001_095313.HEIC",
//     "IMG_20231001_095313_462.jpg",
//     "MVIMG_20240508_203143.jpg",
//     "PANO_20240507_132949.jpg",
//     "CYMERA_20250225_075209.jpg",
//     "ABC_20240101_100000.txt",
//     "SHORT_20230101_123456.gif",
//     "VID-20250401-091235.mp4",
//     "[SHANA] VID_20250101_000620_4K.mp4",
//     "[SHANA] VID_20250101_000620_img_02.png"
// ]

/**
 * 从文件名中提取日期时间（带合法性校验，Asia/Shanghai）
 * @param {string} filename
 * @returns {null|{
 *   date: string,        // YYYYMMDD
 *   time: string,        // HHMMSS
 *   monthStr: string,    // YYYY-MM
 *   iso: string,         // YYYY-MM-DDTHH:mm:ss
 *   tz: string,          // Asia/Shanghai
 *   jsDate: Date,
 *   dayjs: dayjs.Dayjs
 * }}
 */
export function extractDate(filename) {
    const base = filename.split(/[\\/]/).pop()

    const regex = /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?:[_-].*)?\./

    const m = base.match(regex)
    if (!m) return null

    const [, yearStr, monthStr, dayStr, hh, mm, ss] = m

    const year = Number(yearStr)
    const month = Number(monthStr)
    const day = Number(dayStr)

    // 年份限制 2000-2050
    if (year < 2000 || year > 2050) return null
    if (month < 1 || month > 12) return null

    // 使用 dayjs 校验日是否合法（自动判断每月天数 + 闰年）
    const dateCheck = dayjs(`${year}-${month}-${day}`, "YYYY-M-D", true) // 严格模式
    if (!dateCheck.isValid()) return null

    // 时间部分不校验越界（默认 00-23, 00-59, 00-59）
    const d = dayjs.tz(`${year}-${monthStr}-${dayStr} ${hh}:${mm}:${ss}`, "Asia/Shanghai")

    return {
        date: `${yearStr}${monthStr}${dayStr}`,
        time: `${hh}${mm}${ss}`,
        monthStr: `${yearStr}${monthStr}`,
        iso: d.format("YYYY-MM-DDTHH:mm:ss"),
        tz: "Asia/Shanghai",
        jsDate: d.toDate(),
        dayjs: d,
    }
}

/**
 * 按 monthStr 分组，排序，并附带统计信息
 * @param {Array<{entry>} entries
 * @returns {Array<{monthStr:string, entries:Array, count:number}>}
 */
function groupByMonth(entries) {
    const map = new Map()

    // 分组
    for (const entry of entries) {
        const key = entry.monthStr
        if (!map.has(key)) {
            map.set(key, [])
        }
        map.get(key).push(entry)
    }

    // 排序 + 统计
    return Array.from(map.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([monthStr, list]) => ({
            monthStr,
            entries: list,
            count: list.length,
        }))
}

export { aliases, builder, command, describe, handler }

const command = "move <input> [output]"
const aliases = ["md"]
const describe = t("move.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya // 仅处理符合指定条件的文件，包含文件名规则
            .positional("input", {
                describe: t("option.common.input"),
                type: "string",
            })
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: t("option.common.output"),
                type: "string",
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            // 需要处理的扩展名列表，默认为视频和图片格式
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
            // 遍历目录层次深度限制，默认1
            .option("max-depth", {
                alias: "depth",
                type: "number",
                default: 1,
                description: t("option.common.max.depth"),
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: t("option.common.doit"),
            })
    )
}

const CheckStatus = Object.freeze({
    READY: "READY",
    NO_DATE: "NO_DATE",
    EXISTS: "EXISTS",
    DUP: "DUP",
    NULL: "NULL",
})

/**
 * 统计各种状态的数目
 * @param {*} entries
 * @param {*} fallback
 * @returns
 */
function countByStatus(entries, fallback = CheckStatus.NULL) {
    return entries.reduce((acc, entry) => {
        const status = entry.status || fallback
        acc[status] = (acc[status] || 0) + 1
        return acc
    }, {})
}

/**
 * 检查移动操作的可行性
 * @param {Object} entry - 文件条目对象
 * @param {string} entry.path - 文件路径
 * @param {string} entry.name - 文件名
 * @param {string} entry.output - 输出目录
 * @returns {Promise<Object>} 包含移动信息的结果对象
 */
async function checkMove(entry) {
    const logTag = chalk.green(t("operation.move"))
    const date = extractDate(entry.name)
    if (!date || !date.monthStr) {
        log.info(logTag, t("move.no.date.skip"), entry.path)
        entry.status = CheckStatus.NO_DATE
        return entry
    }
    entry.monthStr = date.monthStr
    // console.log(entry.name, entry.output, entry.monthStr)
    const destDir = path.join(entry.output, entry.monthStr)
    const fileSrc = path.resolve(entry.path)
    let fileDst = path.resolve(destDir, entry.name)
    if (fileSrc === fileDst) {
        log.info(logTag, t("move.duplicate.file.skip"), fileDst)
        entry.status = CheckStatus.EXISTS
        return entry
    }
    if (await fs.pathExists(fileDst)) {
        log.info(logTag, t("move.in.destination"), fileDst)
        // 检查是否为同一文件
        if (isSameFileCached(fileSrc, fileDst)) {
            log.info(logTag, t("move.same.file.skip"), fileDst)
            entry.status = CheckStatus.DUP
            return entry
        } else {
            // 同名的不同文件，重命名
            log.info(logTag, t("move.different.file.need.rename"), fileDst)
            const fn = helper.pathParts(entry.name)
            const newName = `${fn.name}_${date.time}${fn.ext}`
            fileDst = path.resolve(destDir, newName)
        }
    }
    entry.fileSrc = fileSrc
    entry.fileDst = fileDst
    entry.status = CheckStatus.READY
    return entry
}

/**
 * 准备移动任务
 * @param {Array<Object>} entries - 文件条目数组
 * @param {Object} argv - 命令行参数对象
 * @param {string} argv.output - 输出目录
 * @param {number} argv.jobs - 并发任务数
 * @returns {Promise<Array<Object>>} 准备好的任务数组
 */
async function prepareMove(entries, argv) {
    const output = path.resolve(argv.output || argv.input)
    let tasks = entries.map((f, i) => {
        return {
            ...f,
            index: i,
            // argv: argv,
            output: output,
            total: entries.length,
        }
    })
    // 纯字符串操作，解析日期，支持高并发
    // tasks = await pMap(tasks, attachDate, { concurrency: argv.jobs || cpus().length * 4 })
    // tasks.filter(e => e && (e.monthStr))
    // 检查文件路径，是否存在冲突
    tasks = await pMap(tasks, checkMove, { concurrency: argv.jobs || cpus().length })

    for (const [status, count] of Object.entries(countByStatus(tasks))) {
        log.show(chalk.green(t("operation.move") + "[Check]"), `${t("status")}: ${status} => ${count} ${t("files")}`)
    }

    // 无法提取日期的文件将被跳过
    return tasks.filter((e) => e && e.fileDst)
}

/**
 * 移动命令处理函数
 * 按照文件名中的日期时间将文件移动到对应月份目录
 * @param {Object} argv - 命令行参数对象
 * @param {string} argv.input - 输入目录路径
 * @param {string} argv.output - 输出目录路径
 * @param {string} argv.include - 包含文件名规则
 * @param {string} argv.exclude - 排除文件名规则
 * @param {string} argv.extensions - 扩展名列表
 * @param {number} argv.maxDepth - 遍历目录深度限制
 * @param {boolean} argv.doit - 是否执行实际操作
 * @returns {Promise<void>}
 */
const handler = async function cmdMove(argv) {
    log.info(argv)
    const testMode = !argv.doit
    const logTag = testMode ? chalk.yellow(t("operation.move") + "[DryRun]") : chalk.green(t("operation.move"))
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        log.error(logTag, `${t("input.invalid")}: '${root}'`)
        throw new Error(`${t("input.invalid")}: ${argv.input}`)
    }

    const output = path.resolve(argv.output || root)

    const options = {
        needStats: true,
        withDirs: false,
        withFiles: true,
        maxDepth: argv.maxDepth || 1,
        entryFilter: (f) => f.isFile && helper.isMediaFile(f.path),
    }
    let entries = await mf.walk(root, options)
    if (entries.length === 0) {
        log.showYellow(logTag, t("move.no.files.found"))
        return
    }
    log.show(logTag, argv)
    log.show(logTag, `${t("move.total.entries.found")} ${entries.length} ${t("files")}`)
    // 应用文件名过滤规则
    entries = await applyFileNameRules(entries, argv)
    if (entries.length === 0) {
        log.showYellow(logTag, t("move.no.files.left.after.rules"))
        return
    }
    log.show(logTag, `${t("move.total.entries.left.after.rules")} ${entries.length} ${t("files")}`)

    for (const e of entries) {
        log.info(logTag, `${t("move.found")}: ${e.path}`)
    }

    const tasks = await prepareMove(entries, argv)

    const taskGroups = groupByMonth(tasks)
    const fCount = entries.length
    const tCount = tasks.length
    log.showYellow(logTag, `${t("move.total.files.skipped")} ${fCount - tCount} ${t("files")}`)
    if (tasks.length > 0) {
        log.showGreen(logTag, `${t("move.total.files.ready.to.move")} ${tasks.length} ${t("files")}`)
    } else {
        log.showYellow(logTag, t("common.nothing.to.do"))
        return
    }

    for (const { monthStr, entries, count } of taskGroups) {
        const destDir = path.join(output, monthStr)
        log.show(logTag, `${destDir} <<== ${count} ${t("files")} | ${t("move.sample.files")}:`)
        for (const e of core.pickRandom(entries, 3)) {
            log.showGray(logTag, `--${e.fileSrc}`)
        }
    }

    if (testMode) {
        log.showYellow(logTag, `${t("mode.test")} (${t("mode.dryrun")}), ${t("move.no.files.will.be.moved")}`)
    }
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(t("move.confirm.move", { count: tCount })),
        },
    ])
    if (!answer.yes) {
        log.showYellow(logTag, t("operation.cancelled"))
        return
    }

    for (const { monthStr, entries, count } of taskGroups) {
        const destDir = path.join(output, monthStr)
        await fs.ensureDir(destDir)
        let movedCount = 0
        try {
            for (const { fileSrc, fileDst } of entries) {
                if (await fs.pathExists(fileDst)) {
                    log.showYellow(logTag, `${t("status.skipped")}:`, fileDst)
                    continue
                }
                !testMode && (await fs.move(fileSrc, fileDst))
                movedCount++
                log.info(logTag, `${t("file.moved")}:`, fileSrc, "to", fileDst)
            }
        } catch (error) {
            log.error(logTag, `${t("file.failed")}:`, error, "to", destDir)
        }
        const skippedCount = entries.length - movedCount
        if (skippedCount > 0) {
            log.show(logTag, `${t("move.files.skipped.in.dir", { count: skippedCount, dir: destDir })}`)
        }
        if (movedCount > 0) {
            log.show(logTag, `${t("move.files.moved.to.dir", { count: movedCount, dir: destDir })}`)
        }
    }
}
