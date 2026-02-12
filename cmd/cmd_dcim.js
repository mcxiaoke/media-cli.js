/*
 * File: cmd_dcim.js
 * Created: 2024-03-20 13:43:17 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import fs from "fs-extra"
import inquirer from "inquirer"
import path from "path"

import { addEntryProps, renameFiles } from "./cmd_shared.js"

import * as log from "../lib/debug.js"
import * as exif from "../lib/exif.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

const LOG_TAG = "DcimR"

export { aliases, builder, command, describe, handler }

const command = "dcimr <input> [options]"
const aliases = ["dm", "dcim"]
const describe = t("dcim.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .option("backup", {
                alias: "b",
                type: "boolean",
                default: false,
                description: t("option.dcim.backup"),
            })
            .option("fast", {
                alias: "f",
                type: "boolean",
                description: t("option.dcim.fast"),
            })
            .option("prefix", {
                alias: "p",
                type: "string",
                default: "IMG_/DSC_/VID_",
                description: t("option.dcim.prefix"),
            })
            .option("suffix", {
                alias: "s",
                type: "string",
                default: "",
                description: t("option.dcim.suffix"),
            })
            .option("template", {
                alias: "t",
                type: "string",
                default: "YYYYMMDD_HHmmss",
                description: t("option.dcim.template"),
            })
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: t("option.dcim.doit"),
            })
    )
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
    log.show(LOG_TAG, `${t('path.input')}: ${root}`)
    let files = await exif.listMedia(root)
    const fileCount = files.length
    log.show(LOG_TAG, t("dcim.total.files.found", { count: files.length }))
    if (files.length === 0) {
        log.showYellow(LOG_TAG, t("dcim.no.files.found"))
        return
    }
    const confirmFiles = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.green(t("dcim.continue.processing")),
        },
    ])
    if (!confirmFiles.yes) {
        log.showYellow(t("dcim.aborted.by.user"))
        return
    }
    log.show(LOG_TAG, t("dcim.processing.exif"))
    files = await exif.parseFiles(files, { fastMode })
    log.show(LOG_TAG, t("dcim.files.parsed", { count: files.length }), fastMode ? "(" + t("mode.fast") + ")" : "")
    files = files.map((f) => {
        // add naming options
        f.namePrefix = argv.prefix
        f.nameSuffix = argv.suffix
        f.nameTemplate = argv.template
        return f
    })
    files = exif.buildNames(files)
    const [validFiles, skippedBySize, skippedByDate] = exif.checkFiles(files)
    files = validFiles
    if (fileCount - files.length > 0) {
        log.warn(LOG_TAG, t("dcim.files.skipped", { count: fileCount - files.length }))
    }
    log.show(
        LOG_TAG,
        t("dcim.files.processed", { count: fileCount, time: helper.humanTime(startMs) }),
        fastMode ? "(" + t("mode.fast") + ")" : "",
    )
    if (skippedBySize.length > 0) {
        log.showYellow(LOG_TAG, t("dcim.files.skipped.by.size", { count: skippedBySize.length }))
    }
    if (skippedByDate.length > 0) {
        log.showYellow(LOG_TAG, t("dcim.files.skipped.by.date", { count: skippedByDate.length }))
    }
    if (files.length === 0) {
        log.showYellow(LOG_TAG, t("dcim.nothing.to.do"))
        return
    }
    files = addEntryProps(files)
    log.show(
        LOG_TAG,
        t("dcim.files.ready", { count: files.length }),
        fastMode ? "(" + t("mode.fast") + ")" : "",
    )

    log.show(LOG_TAG, t("dcim.task.sample"))
    for (const f of files.slice(-10)) {
        log.show(path.basename(f.path), f.outName, f.date)
    }
    log.info(LOG_TAG, argv)
    testMode && log.showYellow("++++++++++ " + t("ffmpeg.test.mode") + " ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("dcim.rename.confirm", { count: files.length }) + (fastMode ? " (" + t("mode.fast") + ")" : ""),
            ),
        },
    ])
    if (answer.yes) {
        if (testMode) {
            log.showYellow(LOG_TAG, t("dcim.test.mode.note", { count: files.length }))
        } else {
            const results = await renameFiles(files, false)
            log.showGreen(LOG_TAG, t("dcim.files.renamed", { count: results.length }))
        }
    } else {
        log.showYellow(LOG_TAG, t("dcim.aborted.by.user"))
    }
}
