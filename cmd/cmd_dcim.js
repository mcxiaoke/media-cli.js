/*
 * File: cmd_dcim.js
 * Created: 2024-03-16 21:04:01
 * Modified: 2024-03-23 11:51:18
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from "inquirer"
import path from "path"

import { renameFiles } from "./cmd_shared.js"

import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as helper from '../lib/helper.js'

const LOG_TAG = "DcimR"

export { aliases, builder, command, describe, handler }

const command = "dcimr <input> [options]"
const aliases = ["dm", "dcim"]
const describe = 'Rename media files by exif metadata eg. date'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("backup", {
        // 备份原石文件
        alias: "b",
        type: "boolean",
        default: false,
        description: "backup original file before rename",
    })
        .option("fast", {
            // 快速模式，使用文件修改时间，不解析EXIF
            alias: "f",
            type: "boolean",
            description: "fast mode (use file modified time, no exif parse)",
        })
        .option("prefix", {
            // 重命名后的文件前缀
            alias: "p",
            type: "string",
            default: "IMG_/DSC_/VID_",
            description: "custom filename prefix for raw/image/video files'",
        })
        .option("suffix", {
            // 重命名后的后缀
            alias: "s",
            type: "string",
            default: "",
            description: "custom filename suffix",
        })
        .option("template", {
            // 文件名模板，使用dayjs日期格式
            alias: "t",
            type: "string",
            default: "YYYYMMDD_HHmmss",
            description:
                "filename date format template, see https://day.js.org/docs/en/display/format",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}


const handler = async function cmdRename(argv) {
    log.show(LOG_TAG, argv)
    const root = path.resolve(argv.input)
    if (!(await fs.pathExists(root))) {
        log.error(`Invalid Input: '${root}'`)
        throw new Error(`Invalid Input: '${root}'`)
    }
    const testMode = !argv.doit
    const fastMode = argv.fast || false
    // action: rename media file by exif date
    const startMs = Date.now()
    log.show(LOG_TAG, `Input: ${root}`)
    let files = await exif.listMedia(root)
    const fileCount = files.length
    log.show(LOG_TAG, `Total ${files.length} media files found`)

    const confirmFiles = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.green(`Press y to continue processing...`),
        },
    ])
    if (!confirmFiles.yes) {
        log.showYellow("Will do nothing, aborted by user.")
        return
    }
    log.show(LOG_TAG, `Processing files, reading EXIF data...`)
    files = await exif.parseFiles(files, { fastMode })
    log.show(
        LOG_TAG,
        `Total ${files.length} media files parsed`,
        fastMode ? "(FastMode)" : ""
    )
    files = exif.buildNames(files)
    const [validFiles, skippedBySize, skippedByDate] = exif.checkFiles(files)
    files = validFiles
    if (fileCount - files.length > 0) {
        log.warn(
            LOG_TAG,
            `Total ${fileCount - files.length} media files skipped`
        )
    }
    log.show(
        LOG_TAG,
        `Total ${fileCount} files processed in ${helper.humanTime(startMs)}`,
        fastMode ? "(FastMode)" : ""
    )
    if (skippedBySize.length > 0) {
        log.showYellow(
            LOG_TAG,
            `Total ${skippedBySize.length} media files are skipped by size`
        )
    }
    if (skippedByDate.length > 0) {
        log.showYellow(
            LOG_TAG,
            `Total ${skippedByDate.length} media files are skipped by date`
        )
    }
    if (files.length === 0) {
        log.showYellow(LOG_TAG, "Nothing to do, exit now.")
        return
    }
    log.show(
        LOG_TAG,
        `Total ${files.length} media files ready to rename by exif`,
        fastMode ? "(FastMode)" : ""
    )
    log.show(LOG_TAG, `task sample:`, files.slice(-2))
    log.info(LOG_TAG, argv)
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to rename ${files.length} files?` +
                (fastMode ? " (FastMode)" : "")
            ),
        },
    ])
    if (answer.yes) {
        if (testMode) {
            log.showYellow(LOG_TAG, `All ${files.length} files, NO file renamed in TEST MODE.`)
        }
        else {
            const results = await renameFiles(files, false)
            log.showGreen(LOG_TAG, `All ${results.length} file were renamed.`,)
        }
    } else {
        log.showYellow(LOG_TAG, "Will do nothing, aborted by user.")
    }
}