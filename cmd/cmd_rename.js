#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from "inquirer";
import path from "path";

import { renameFiles } from "../lib/functions.js";

import * as log from '../lib/debug.js';
import * as exif from '../lib/exif.js';
import * as helper from '../lib/helper.js';

export { aliases, builder, command, describe, handler };

const command = "rename <input> [options]"
const aliases = ["rn", "exifrename"]
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
    log.show('cmdRename', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        log.error(`Invalid Input: '${root}'`);
        throw new Error(`Invalid Input: '${root}'`)
    }
    const testMode = !argv.doit;
    const fastMode = argv.fast || false;
    // action: rename media file by exif date
    const startMs = Date.now();
    log.show("Rename", `Input: ${root}`, fastMode ? "(FastMode)" : "");
    let files = await exif.listMedia(root);
    const fileCount = files.length;
    log.show("Rename", `Total ${files.length} media files found`);

    const confirmFiles = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.green(`Press y to continue processing...`),
        },
    ]);
    if (!confirmFiles.yes) {
        log.showYellow("Will do nothing, aborted by user.");
        return;
    }
    log.show("Rename", `Processing files, reading EXIF data...`);
    files = await exif.parseFiles(files, { fastMode: fastMode });
    log.show(
        "Rename",
        `Total ${files.length} media files parsed`,
        fastMode ? "(FastMode)" : ""
    );
    files = exif.buildNames(files);
    const [validFiles, skippedBySize, skippedByDate] = exif.checkFiles(files);
    files = validFiles;
    if (fileCount - files.length > 0) {
        log.warn(
            "Rename",
            `Total ${fileCount - files.length} media files skipped`
        );
    }
    log.show(
        "Rename",
        `Total ${fileCount} files processed in ${helper.humanTime(startMs)}`,
        fastMode ? "(FastMode)" : ""
    );
    if (skippedBySize.length > 0) {
        log.showYellow(
            "Rename",
            `Total ${skippedBySize.length} media files are skipped by size`
        );
    }
    if (skippedByDate.length > 0) {
        log.showYellow(
            "Rename",
            `Total ${skippedByDate.length} media files are skipped by date`
        );
    }
    if (files.length == 0) {
        log.showYellow("Rename", "Nothing to do, exit now.");
        return;
    }
    log.show(
        "Rename",
        `Total ${files.length} media files ready to rename by exif`,
        fastMode ? "(FastMode)" : ""
    );
    log.show(`Rename`, `task sample:`, files.slice(-2))
    log.info("Rename:", argv);
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
    ]);
    if (answer.yes) {
        if (testMode) {
            log.showYellow("Rename", `All ${files.length} files, NO file renamed in TEST MODE.`);
        }
        else {
            const results = await renameFiles(files);
            log.showGreen("Rename", `All ${files.length} file were renamed.`);
        }
    } else {
        log.showYellow("Rename", "Will do nothing, aborted by user.");
    }
}