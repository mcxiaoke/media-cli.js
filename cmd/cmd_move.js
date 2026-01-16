/*
 * File: cmd_move.js
 * Created: 2024-03-15 20:57:59 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from 'chalk'
import dayjs from 'dayjs'
import timezone from "dayjs/plugin/timezone.js"
import utc from "dayjs/plugin/utc.js"
import fs from 'fs-extra'
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import * as log from '../lib/debug.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'
import { applyFileNameRules } from "./cmd_shared.js"

dayjs.extend(utc)
dayjs.extend(timezone)

// 按照文件名日期时间格式移动到对应目录，视频和图片分开，暂不支持其它格式
const filename_samples = [
    "VID_20241231_144423_C",
    "VID_20241231_144423",
    "ABC_20250115_103000_extra",
    "MP4_20250123_222540.mp4",
    "VID_20250401_091235_C.mp4",
    "VID_20250605_121258.mp4",
    "IMG_20231001_095313.HEIC",
    "IMG_20231001_095313_462.jpg",
    "MVIMG_20240508_203143.jpg",
    "PANO_20240507_132949.jpg",
    "CYMERA_20250225_075209.jpg",
    "ABC_20240101_100000.txt",
    "SHORT_20230101_123456.gif",
    "VID-20250401-091235.mp4",
    "[SHANA] VID_20250101_000620_4K.mp4",
    "[SHANA] VID_20250101_000620_img_02.png"
]


/**
 * 从文件名中提取日期时间（Asia/Shanghai）
 */
export function extractDate(filename) {
    const base = filename.split(/[\\/]/).pop()

    const regex =
        /(?:^|[^0-9])(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?:[_-].*)?\./

    const m = base.match(regex)
    if (!m) return null

    const [, year, month, day, hh, mm, ss] = m

    const d = dayjs.tz(
        `${year}-${month}-${day} ${hh}:${mm}:${ss}`,
        "Asia/Shanghai"
    )

    return {
        date: `${year}${month}${day}`,
        time: `${hh}${mm}${ss}`,
        monthStr: `${year}${month}`,
        iso: d.format("YYYY-MM-DDTHH:mm:ss"),
        tz: "Asia/Shanghai",
        jsDate: d.toDate(),
        dayjs: d
    }
}

/**
 * 附加 monthStr 属性
 */
function attachDate(entry) {
    const date = extractDate(entry.name)
    return {
        ...entry,
        date: date,
        monthStr: date?.monthStr
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
            count: list.length
        }))
}


export { aliases, builder, command, describe, handler }

const command = "move <input> [output]"
const aliases = ["md"]
const describe = "Move files to folders by filename date patterns"

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya// 仅处理符合指定条件的文件，包含文件名规则
        .positional('input', {
            describe: 'input directory',
            type: 'string',
        })
        // 输出目录，默认输出文件与原文件同目录
        .option("output", {
            alias: "o",
            describe: "Folder store ouput files",
            type: "string",
        })
        // 正则，包含文件名规则
        .option("include", {
            alias: "I",
            type: "string",
            description: "filename include pattern",
        })
        //字符串或正则，不包含文件名规则
        // 如果是正则的话需要转义
        .option("exclude", {
            alias: "E",
            type: "string",
            description: "filename exclude pattern ",
        })
        // 需要处理的扩展名列表，默认为视频和图片格式
        .option("extensions", {
            alias: "e",
            type: "string",
            describe: "include files by extensions (eg. .wav|.flac)",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = async function cmdMove(argv) {

    log.info(argv)
    const testMode = !argv.doit
    const logTag = testMode ? chalk.yellow("Move[DryRun]") : chalk.green("Move")
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        log.error(logTag, `Invalid Input: '${root}'`)
        throw new Error(`Invalid Input: ${argv.input}`)
    }

    const output = path.resolve(argv.output || root)

    const options = {
        needStats: true,
        withDirs: false,
        withFiles: true,
        maxDepth: 2,
        entryFilter: (f) =>
            f.isFile
            && helper.isMediaFile(f.path)
    }
    let entries = await mf.walk(root, options)
    if (entries.length === 0) {
        log.showYellow(logTag, `No files found, abort.`)
        return
    }
    log.show(logTag, argv)
    log.show(logTag, `Total ${entries.length} entries found`)
    // 应用文件名过滤规则
    entries = await applyFileNameRules(entries, argv)
    if (entries.length === 0) {
        log.showYellow(logTag, 'No files left after rules, nothing to do.')
        return
    }
    log.show(logTag, `Total ${entries.length} entries left after rules.`)

    entries = entries.map((f, i) => {
        return {
            ...f,
            index: i,
            argv: argv,
            total: entries.length,
        }
    })
    const fCount = entries.length
    // 纯字符串操作，支持高并发
    let tasks = await pMap(entries, attachDate, { concurrency: argv.jobs || cpus().length * 4 })
    for (const entry of tasks.slice(-20)) {
        log.debug(
            logTag,
            `[${entry.index + 1}/${entry.total}] ${entry.name} => ${entry.date}`
        )
    }
    // 无法提取日期的文件将被跳过
    tasks = tasks.filter(e => e && (e.monthStr))
    const taskGroups = groupByMonth(tasks)
    const tCount = tasks.length
    log.showYellow(
        logTag, `Total ${fCount - tCount} files are skipped.`
    )
    if (tasks.length > 0) {
        log.showGreen(logTag, `Total ${tasks.length} files ready to move.`
        )
    } else {
        log.showYellow(logTag, `Nothing to do, abort.`)
        return
    }

    for (const { monthStr, entries, count } of taskGroups) {
        log.show(logTag, `${count} files ==>> ${path.join(output, monthStr)}`)
    }

    if (testMode) {
        log.showYellow(logTag, `TEST MODE (DRY RUN), no files will be moved.`)
        // return
    }
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to move files to these folders?`
            ),
        },
    ])
    if (!answer.yes) {
        log.showYellow(logTag, "Will do nothing, aborted by user.")
        return
    }

    for (const { monthStr, entries, count } of taskGroups) {
        const destDir = path.join(output, monthStr)
        const toMove = entries.map(entry => {
            const fileSrc = entry.path
            const fileDst = path.join(destDir, entry.name)
            return { fileSrc, fileDst }
        })
        await fs.ensureDir(destDir)
        let movedCount = 0
        try {
            for (const { fileSrc, fileDst } of toMove) {
                if (await fs.pathExists(fileDst)) {
                    log.info(logTag, "File Exists:", fileDst)
                    continue
                }
                if (fileSrc === fileDst) {
                    log.info(logTag, "Same File, Skip:", fileDst)
                    continue
                }
                !testMode && await fs.move(fileSrc, fileDst)
                movedCount++
                log.info(logTag, "Moved:", fileSrc, "to", fileDst)
            }

        } catch (error) {
            log.error(logTag, "Failed:", error, "to", destDir)
        }
        const skippedCount = toMove.length - movedCount
        if (skippedCount > 0) {
            log.show(logTag, `${skippedCount} files are skipped in ${destDir}.`)
        }
        if (movedCount > 0) {
            log.show(logTag, `${movedCount} files are moved to ${destDir}`)
        }
    }

}