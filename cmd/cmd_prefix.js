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
    return ya.option("length", {
        alias: "l",
        type: "number",
        default: 24,
        description: "max length of prefix string",
    })
        // 仅用于PREFIX模式，文件名添加指定前缀字符串
        .option("prefix", {
            alias: "p",
            type: "string",
            description: "filename prefix for output ",
        })
        // 指定MODE，三种：自动，目录名，指定前缀
        .option("mode", {
            alias: "m",
            type: "string",
            default: "auto",
            description: "filename prefix for output ",
            choices: ['auto', 'dirname', 'prefix'],
        })
        // 清理文件名中的特殊字符和非法字符
        .option("clean", {
            alias: "c",
            type: "boolean",
            description: "remove special chars in filename",
        })
        // 全选模式，强制处理所有文件
        .option("all", {
            alias: "a",
            type: "boolean",
            description: "force rename all files",
        })
        // 测试模式，不执行实际操作，如删除和重命名和移动操作
        .option("test", {
            alias: "t",
            type: "boolean",
            description: "enable dry run/test mode, no real operations",
        })
}

const MODE_AUTO = "auto";
const MODE_DIR = "dirname";
const MODE_PREFIX = "prefix";

// 正则：仅包含数字
const reOnlyNum = /^\d+$/;
// 正则：匹配除 中日韩俄英 之外的特殊字符
const reNonChars = /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}\w_]/ugi;

function createNewNameByAuto(f, argv) {
    const forceAll = argv.all || false;
    const nameLength = argv.length || 24;
    const [dir, base, ext] = helper.pathSplit(f.path);
    if (!reOnlyNum.test(base) && !forceAll) {
        log.showYellow("Prefix[AUTO]", `Ignore: ${helper.pathShort(f.path)}`);
        return;
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
    const nameSlice = nameLength * -1;
    // 是否去掉所有特殊字符
    const oldBase = argv.clean ? base.replaceAll(reNonChars, "") : base;
    //oldBase = oldBase.replaceAll(/\s/gi, "").slice(nameSlice);
    let fPrefix = (dirStr + "_" + oldBase).slice(nameSlice);
    fPrefix = fPrefix.replaceAll(/[-_]+/gi, "_");
    const newName = `${fPrefix}${ext}`;
    const newPath = path.join(dir, newName);
    f.outName = newName;
    log.show("Prefix[AUTO]", `=> ${helper.pathShort(newPath)}`);
    return f;
}

function createNewNameByDir(f, argv) {
    const nameLength = argv.length || 24;
    const [dir, base, ext] = helper.pathSplit(f.path);
    const prefix = path.basename(dir);
    const nameSlice = nameLength * -10;
    // 不添加重复前缀
    if (base.startsWith(prefix)) {
        log.showGray("Prefix[DIR]", `Ignore: ${helper.pathShort(f.path)}`);
        return;
    }
    // 是否去掉所有特殊字符
    const oldBase = argv.clean ? base.replaceAll(reNonChars, "") : base;
    const fPrefix = (prefix + "_" + oldBase).slice(nameSlice);
    const newName = `${fPrefix}${ext}`;
    const newPath = path.join(dir, newName);
    f.outName = newName;
    log.show("Prefix[DIR]", `=> ${helper.pathShort(newPath)}`);
    return f;
}

function createNewNameByPrefix(f, argv) {
    const nameLength = argv.length || 24;
    const [dir, base, ext] = helper.pathSplit(f.path);
    const prefix = argv.prefix;
    if (!prefix || prefix.length == 0) {
        log.showYellow("Prefix", `Ignore: ${helper.pathShort(f.path)}`);
        return;
    }
    const nameSlice = nameLength * -10;
    // 不添加重复前缀
    if (base.startsWith(prefix)) {
        log.showGray("Prefix[PREFIX]", `Skip: ${helper.pathShort(f.path)}`);
        return;
    }
    // 是否去掉所有特殊字符
    const oldBase = argv.clean ? base.replaceAll(reNonChars, "") : base;
    const fPrefix = (prefix + "_" + oldBase).slice(nameSlice);
    const newName = `${fPrefix}${ext}`;
    const newPath = path.join(dir, newName);
    f.outName = newName;
    log.show("Prefix[PREFIX]", `=> ${helper.pathShort(newPath)}`);
    return f;
}

const handler = async function cmdPrefix(argv) {
    log.show('cmdPrefix', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        yargs.showHelp();
        log.error(`Invalid Input: '${root}'`);
        return;
    }
    const forceAll = argv.all || false;
    const mode = argv.mode || MODE_AUTO;
    const prefix = argv.prefix;
    const startMs = Date.now();
    log.show("Prefix", `Input: ${root}`, forceAll ? "(force all)" : "");
    let files = await mf.walk(root, {
        entryFilter: (entry) =>
            entry.stats.isFile() &&
            entry.stats.size > 1024
    });
    // process only image files
    // files = files.filter(x => helper.isImageFile(x.path));
    files.sort();
    log.show("Prefix", `Total ${files.length} files found in ${helper.humanTime(startMs)}`);
    if (files.length == 0) {
        log.showYellow("Prefix", "Nothing to do, exit now.");
        return;
    }
    const nameFuncMap = new Map([
        [MODE_DIR, createNewNameByDir],
        [MODE_PREFIX, createNewNameByPrefix],
        [MODE_AUTO, createNewNameByAuto]
    ])
    const createNameFunc = nameFuncMap.get(mode) || createNewNameByAuto;
    const tasks = files.map(f => createNameFunc(f, argv)).filter(Boolean)
    if (tasks.length > 0) {
        log.showGreen(
            "Prefix",
            `Total ${files.length} media files ready to rename`,
            forceAll ? "(forceAll)" : ""
        );
    } else {
        log.showYellow(
            "Prefix",
            `Nothing to do, abort.`,
            forceAll ? "(forceAll)" : ""
        );
        return;
    }
    log.info("Argments:", JSON.stringify(argv));
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to rename ${tasks.length} files?` +
                (forceAll ? " (forceAll)" : "")
            ),
        },
    ]);
    if (answer.yes) {
        if (argv.test) {
            log.showYellow("Prefix", `All ${tasks.length} files, BUT NO file renamed in TEST MODE.`);
        }
        else {
            const results = await renameFiles(tasks);
            log.showGreen("Prefix", `All ${tasks.length} file were renamed.`);
        }
    } else {
        log.showYellow("Prefix", "Will do nothing, aborted by user.");
    }
}