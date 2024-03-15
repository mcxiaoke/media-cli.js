#!/usr/bin/env node
import inquirer from "inquirer";
import path from "path";
import fs from 'fs-extra';
import chalk from 'chalk';
import yargs from "yargs";

import { renameFiles } from "../lib/functions.js";

import * as log from '../lib/debug.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'

export { command, aliases, describe, builder, handler }

const command = "prefix <input> [output]"
const aliases = ["pf", "px"]
const describe = 'Rename files by append dir name or string'
const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("size", {
        alias: "s",
        type: "number",
        default: 24,
        description: "size[length] of prefix of dir name",
    })
        .option("ignore", {
            alias: "i",
            type: "string",
            description: "ignore string of prefix of dir name",
        })
        .option("prefix", {
            alias: "p",
            type: "string",
            description: "filename prefix for output ",
        })
        .option("all", {
            alias: "a",
            type: "boolean",
            description: "force rename all files ",
        })
}

const handler = async function cmdPrefix(argv) {
    log.show('cmdPrefix', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        yargs.showHelp();
        log.error(`Invalid Input: '${root}'`);
        return;
    }
    const size = argv.size || 24;
    const allMode = argv.all || false;
    const startMs = Date.now();
    log.show("Prefix", `Input: ${root}`, allMode ? "(force all)" : "");
    let files = await mf.walk(root, {
        entryFilter: (entry) =>
            entry.stats.isFile() &&
            entry.stats.size > 1024
    });
    // process only image files
    // files = files.filter(x => helper.isImageFile(x.path));
    files.sort();
    log.show("Prefix", `Total ${files.length} files found`);
    if (files.length == 0) {
        log.showYellow("Prefix", "Nothing to do, exit now.");
        return;
    }
    //let nameIndex = 0;
    // 正则：仅包含数字
    const reOnlyNum = /^\d+$/;
    // 正则：匹配除 中日韩俄英 之外的特殊字符
    const reNonChars = /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}\w_]/ugi;
    const tasks = [];
    for (const f of files) {
        const [dir, base, ext] = helper.pathSplit(f.path);
        if (!reOnlyNum.test(base) && !allMode) {
            log.showYellow("Prefix", `Ignore: ${helper.pathShort(f.path)}`);
            continue;
        }
        // 取目录项的最后两级目录名
        let dirFix = dir.split(path.sep).slice(-2).join("_");
        // 去掉目录名中的年月日
        let dirStr = dirFix.replaceAll(/\d{4}-\d{2}-\d{2}/gi, "");
        dirStr = dirStr.replaceAll(/\d+年\d+月/gi, "");
        // 去掉附加说明
        dirStr = dirStr.replaceAll(/\[.+\]/gi, "");
        dirStr = dirStr.replaceAll(/\(.+\)/gi, "");
        dirStr = dirStr.replaceAll(/\d+P(\d+V)?/gi, "");
        // 去掉所有特殊字符
        dirStr = dirStr.replaceAll(reNonChars, "");
        if (argv.ignore && argv.ignore.length >= 2) {
            dirStr = dirStr.replaceAll(argv.ignore, "");
        } else {
            dirStr = dirStr.replaceAll(/更新|合集|画师|图片|视频|插画|视图|订阅|限定|差分|R18|PSD|PIXIV|PIC|NO|ZIP|RAR/gi, "");
        }
        const nameSlice = size * -1;
        // 去掉所有特殊字符
        let oldBase = base.replaceAll(reNonChars, "");
        //oldBase = oldBase.replaceAll(/\s/gi, "").slice(nameSlice);
        const fPrefix = (dirStr + "_" + oldBase).slice(nameSlice);
        const newName = `${fPrefix}${ext}`;
        const newPath = path.join(dir, newName);
        f.outName = newName;
        log.show("Prefix", `Output: ${helper.pathShort(newPath)}`);
        tasks.push(f);
    }
    if (tasks.length > 0) {
        log.showGreen(
            "Prefix",
            `Total ${files.length} media files ready to rename`,
            allMode ? "(allMode)" : ""
        );
    } else {
        log.showYellow(
            "Prefix",
            `Nothing to do, abort.`,
            allMode ? "(allMode)" : ""
        );
        return;
    }

    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to rename ${tasks.length} files?` +
                (allMode ? " (allMode)" : "")
            ),
        },
    ]);
    if (answer.yes) {
        renameFiles(tasks).then((tasks) => {
            log.showGreen("Prefix", `There ${tasks.length} file were renamed.`);
        });
    } else {
        log.showYellow("Prefix", "Will do nothing, aborted by user.");
    }
}