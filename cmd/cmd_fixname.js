/*
 * File: cmd_fixname.js
 * Created: 2024-04-05 14:04:04
 * Modified: 2024-04-05 14:04:35
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from 'chalk';
import { sify } from 'chinese-conv';
import fs from 'fs-extra';
import inquirer from "inquirer";
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import * as core from '../lib/core.js';
import { asyncFilter } from '../lib/core.js';
import * as log from '../lib/debug.js';
import * as enc from '../lib/encoding.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';
import { renameFiles } from "./cmd_shared.js";

export { aliases, builder, command, describe, handler };
const command = "fixname <input> [output]"
const aliases = ["fn", "fxn"]
const describe = 'Fix filenames (fix messy, clean, convert tc to sc)'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya// 仅处理符合指定条件的文件，包含文件名规则
        .option("include", {
            alias: "I",
            type: "string",
            description: "include filename patterns ",
        })
        // 仅处理不符合指定条件的文件，例外文件名规则
        .option("exclude", {
            alias: "E",
            type: "string",
            description: "exclude filename patterns ",
        })
        // 清理文件名中的特殊字符和非法字符
        .option("clean", {
            alias: "c",
            type: "boolean",
            description: "remove special chars in filename",
        })
        // 使用正则表达式替换文件名中的特定字符，比如问号
        // 如果数组只有一项，就是替换这一项为空白，即删除模式字符串
        // 如果有两项，就是替换第一项匹配的字符串为第二项指定的字符
        .option("replace", {
            type: "array",
            description: "replace regex pattern in filename [from,to]",
        })
        // 修复文件名乱码
        .option("encoding", {
            alias: "e",
            type: "boolean",
            description: "fix filename with messy chars",
        })
        // 繁体转简体
        .option("tcsc", {
            alias: "t",
            type: "boolean",
            description: "convert Chinese from TC to SC",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = async function cmdFixName(argv) {
    const testMode = !argv.doit;
    const logTag = "cmdFixName";
    log.info(logTag, argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`);
    }
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag);
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag);
    }
    const startMs = Date.now();
    log.show(logTag, `Input: ${root}`);
    if (!(argv.clean || argv.encoding || argv.tcsc || argv.remove)) {
        log.error(`Error: replace|clean|encoding|tcsc,at least one is required`);
        throw new Error(`replace|clean|encoding|tcsc,at least one is required`);
    }
    let files = await mf.walk(root, {
        needStats: true,
        entryFilter: (entry) =>
            entry.stats.isFile() &&
            entry.stats.size > 1024
    });
    log.show(logTag, `Total ${files.length} files found in ${helper.humanTime(startMs)}`);
    if (argv.include?.length >= 3) {
        // 处理include规则
        const pattern = new RegExp(argv.include, "gi");
        log.showRed(pattern)

        files = await asyncFilter(files, x => x.path.match(pattern));
        log.show(logTag, `Total ${files.length} files left after include rules`);
    } else if (argv.exclude?.length >= 3) {
        // 处理exclude规则
        const pattern = new RegExp(argv.exclude, "gi");
        log.showRed(pattern)
        files = await asyncFilter(files, x => !x.path.match(pattern));
        log.show(logTag, `Total ${files.length} files left after exclude rules`);
    }
    files = files.map((f, i) => {
        return {
            ...f,
            index: i,
            argv: argv,
            total: files.length,
        }
    })
    const fCount = files.length;
    let tasks = await pMap(files, fixFileName, { concurrency: cpus().length * 4 })
    tasks = tasks.filter(f => f?.outName)
    const tCount = tasks.length;
    log.showYellow(
        logTag, `Total ${fCount - tCount} files are skipped.`
    );
    if (tasks.length > 0) {
        log.showGreen(
            logTag,
            `Total ${tasks.length} media files ready to rename`
        );
    } else {
        log.showYellow(
            logTag,
            `Nothing to do, abort.`);
        return;
    }
    log.show(logTag, argv);
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to rename these ${tasks.length} files?`
            ),
        },
    ]);
    if (answer.yes) {
        if (testMode) {
            log.showYellow(logTag, `All ${tasks.length} files, BUT NO file renamed in TEST MODE.`);
        }
        else {
            const results = await renameFiles(tasks);
            log.showGreen(logTag, `All ${results.length} file were renamed.`);
        }
    } else {
        log.showYellow(logTag, "Will do nothing, aborted by user.");
    }
}

let badCount = 0;
// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set();
async function fixFileName(f) {
    const logTag = `FixName`;
    const argv = f.argv;
    const ipx = f.index;
    const oldPath = f.path;
    const [oldDir, base, ext] = helper.pathSplit(oldPath);
    const oldDirName = path.basename(oldDir);
    const strPath = path.resolve(f.path).split(path.sep).join(' ')
    let oldBase = base;
    let newDir = oldDir;
    if (argv.replace?.[0]?.length > 0) {
        const rFrom = argv.replace[0];
        const rTo = argv.replace[1] || "";
        // 执行文件名字符替换操作
        // 按照正则表达式替换指定字符
        // 如果rTo为空则等于删除字符
        oldBase = oldBase.replaceAll(rFrom, rTo);
        oldBase = oldBase.replaceAll(new RegExp(rFrom, "gu"), rTo);
    }
    if (argv.encoding) {
        // 执行文件路径乱码修复操作
        // 对路径进行中日韩文字编码修复
        let [fs, ft] = enc.decodeText(oldBase);
        oldBase = fs.trim();
        // 将目录路径分割，并对每个部分进行编码修复
        const dirNamesFixed = oldDir.split(path.sep).map(s => {
            let [rs, rt] = enc.decodeText(s)
            return rs.trim();
        });
        // 重新组合修复后的目录路径
        newDir = path.join(...dirNamesFixed);
        if (core.isUNCPath(oldDir)) {
            newDir = "\\\\" + newDir;
        }
        // 显示有乱码的文件路径
        if (enc.hasBadUnicode(strPath)) {
            log.showGray(logTag, `BadEnc:${++badCount}`, oldPath)
            log.fileLog(`BadEnc: ${ipx} <${oldPath}>`, logTag);
        }
    }
    if (argv.clean) {
        // 执行净化文件名操作
        oldBase = oldBase;
    }
    if (argv.tcsc) {
        // 执行繁体转简体操作
        oldBase = sify(oldBase)
    }
    // 确保文件名不含有文件系统不允许的非法字符
    oldBase = helper.filenameSafe(oldBase);
    // 生成修复后的新路径，包括旧基础路径和文件扩展名
    const newName = `${oldBase}${ext}`
    const newPath = path.join(newDir, newName);
    if (newPath === oldPath) {
        log.info(logTag, `Ignore Same: ${ipx} ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    else if (await fs.pathExists(newPath)) {
        log.info(logTag, `Ignore Exists: ${ipx} ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    else if (nameDuplicateSet.has(newPath)) {
        log.info(logTag, `Ignore Dup: ${ipx} ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }

    if (f.skipped) {
        // log.fileLog(`Skip: ${ipx} ${oldPath}`, logTag);
        // log.showGray(logTag, `Skip: ${ipx} ${oldPath}`);
    } else {
        if (enc.hasBadUnicode(newDir)) {
            log.showGray(logTag, `BadEncFR:${++badCount}`, oldPath)
            log.show(logTag, `BadEncTO:${++badCount}`, newPath)
            log.fileLog(`BadEncFR: ${ipx} <${oldPath}>`, logTag);
            log.fileLog(`BadEncTO: ${ipx} <${newPath}>`, logTag);
        } else {
            f.skipped = false;
            f.outName = newName;
            f.outPath = newPath;
            log.show(logTag, `FR: ${ipx} ${oldPath}`);
            log.showGreen(logTag, `TO: ${ipx} ${newPath}`);
            log.fileLog(`Add: ${ipx} <${oldPath}> [FR]`, logTag);
            log.fileLog(`Add: ${ipx} <${newPath}> [TO]`, logTag);
            return f;
        }
    }
}