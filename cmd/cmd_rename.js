#!/usr/bin/env node
/*
 * File: cmd_rename.js
 * Created: 2024-03-20 13:43:39
 * Modified: 2024-03-20 13:45:42
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from "inquirer";
import path from "path";

import { renameFiles } from "../lib/functions.js";

import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';

//// 文件重命名小工具
// 支持的模式：
// 按序号重命名
// 添加固定前缀
// 添加固定后缀
// 移除正则匹配的或指定的字符串
// 根据创建日期重命名
// 根据修改日期重命名
// 说明：
// 不涉及EXIF信息或文件内容

export { aliases, builder, command, describe, handler };

const command = "rename <input> [output]"
const aliases = ["rn", "ren"]
const describe = 'Rename files by mode or type or pattern'
const builder = function addOptions(ya, helpOrVersionSet) {
    // 文件名添加指定前缀字符串
    return ya.option("prefix", {
        alias: "p",
        type: "string",
        description: "filename prefix str for output ",
    })
        // 清理文件名中的特殊字符和非法字符
        .option("clean", {
            alias: "c",
            type: "boolean",
            description: "remove special chars in filename",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

// 正则：仅包含数字
const reOnlyNum = /^\d+$/gi;
const reNonChars = /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}\p{P}\uFF01-\uFF5E\u3001-\u3011\w\-_\.]/ugi;
// 匹配空白字符和特殊字符
const reUglyChars = /[《》【】\s_\-+=\.@#$%&\|]+/gi;
// 匹配开头和结尾的空白和特殊字符
const reStripUglyChars = /(^[\s_\-+=\.@#$%&\|]+)|([\s_\-+=\.@#$%&\|]+$)/gi;

// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set();

function createNewNameByMode(f, argv) {
    // 处理模式
    const [dir, base, ext] = helper.pathSplit(f.path);
    const dirParent = path.basename(path.dirname(dir));
    const dirName = path.basename(dir);
    const logTag = "Rename";
    log.info(logTag, `Processing ${f.path}`);
    let sep = "_";
    let prefix = argv.prefix;
    let oldBase = base;
    // 是否净化文件名，去掉各种特殊字符
    if (argv.clean) {
    }
    let fullBase = prefix + sep + oldBase;
    fullBase = fullBase.replaceAll(reStripUglyChars, "");
    const newName = `${fullBase}${ext}`;
    const newPath = path.join(dir, newName);
    if (fullBase === base) {
        log.showGray(logTag, `NoChange: ${helper.pathShort(newPath)}`);
        return;
    }
    if (fs.existsSync(newPath)) {
        log.showGray(logTag, `Exists: ${helper.pathShort(newPath)}`);
        return;
    }
    if (nameDuplicateSet.has(newPath)) {
        log.showGray(logTag, `Duplicate: ${helper.pathShort(newPath)}`);
        return;
    }
    f.outName = newName;
    nameDuplicateSet.add(newPath);
    log.show(logTag, `=> ${helper.pathShort(newPath)}`);
    return f;
}

const handler = async function cmdRename(argv) {
    log.info('Rename', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        log.error(`Invalid Input: ${root}`);
        throw new Error(`Invalid Input: ${root}`);
    }
    const testMode = !argv.doit;
    const mode = argv.mode || MODE_AUTO;
    const prefix = argv.prefix;
    const startMs = Date.now();
    log.show("Rename", `Input: ${root}`);

    if (mode === MODE_PREFIX && !prefix) {
        throw new Error(`No prefix value supplied!`);
    }

    let files = await mf.walk(root, {
        needStats: true,
        entryFilter: (entry) =>
            entry.stats.isFile() &&
            entry.stats.size > 1024
    });
    // process only image files
    // files = files.filter(x => helper.isImageFile(x.path));
    files.sort();
    log.show("Rename", `Total ${files.length} files found in ${helper.humanTime(startMs)}`);
    if (files.length == 0) {
        log.showYellow("Prefix", "Nothing to do, exit now.");
        return;
    }
    const tasks = files.map(f => createNewNameByMode(f, argv)).filter(f => f && f.outName)
    if (tasks.length > 0) {
        log.showGreen(
            "Rename",
            `Total ${tasks.length} media files ready to rename`
        );
    } else {
        log.showYellow(
            "Rename", `Nothing to do, abort.`
        );
        return;
    }
    log.info("Rename:", argv);
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to rename ${tasks.length} files?`
            ),
        },
    ]);
    if (answer.yes) {
        if (testMode) {
            log.showYellow("Rename", `All ${tasks.length} files, BUT NO file renamed in TEST MODE.`);
        }
        else {
            const results = await renameFiles(tasks);
            log.showGreen("Rename", `All ${tasks.length} file were renamed.`);
        }
    } else {
        log.showYellow("Rename", "Will do nothing, aborted by user.");
    }
}

