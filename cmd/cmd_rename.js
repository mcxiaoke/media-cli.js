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
import { cleanFileName, renameFiles } from "./cmd_shared.js";

const TYPE_LIST = ['a', 'f', 'd']

export { aliases, builder, command, describe, handler };
const command = "rename <input>"
const aliases = ["fn", "fxn"]
const describe = 'Reanme files: fix encoding, replace by regex, clean chars, fro tc to sc.'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya// 仅处理符合指定条件的文件，包含文件名规则
        .positional('input', {
            describe: 'input directory',
            type: 'string',
        })
        .option("include", {
            alias: "I",
            type: "string",
            description: " filename include pattern",
        })
        // 仅处理不符合指定条件的文件，例外文件名规则
        .option("exclude", {
            alias: "E",
            type: "string",
            description: "filename exclude pattern ",
        })
        // 要处理的文件类型 文件或目录或所有，默认只处理文件
        .option("type", {
            type: "choices",
            choices: TYPE_LIST,
            default: 'f',
            description: "applied to file type (a=all,f=file,d=dir)",
        })
        // 清理文件名中的特殊字符和非法字符
        .option("clean", {
            alias: "c",
            type: "boolean",
            description: "remove ugly and special chars in filename",
        })
        // 使用正则表达式替换文件名中的特定字符，比如问号
        // 如果数组只有一项，就是替换这一项为空白，即删除模式字符串
        // 如果有两项，就是替换第一项匹配的字符串为第二项指定的字符
        // 只匹配文件名，不包含扩展名
        .option("replace", {
            type: "array",
            description: "replace filename chars by regex pattern [from,to]",
        })
        // 修复文件名乱码
        .option("fixenc", {
            alias: ['fixenocidng', 'e'],
            type: "boolean",
            description: "fix filenames by guess encoding",
        })
        // 繁体转简体
        .option("tcsc", {
            alias: "t",
            type: "boolean",
            description: "convert from tc to sc for Chinese chars",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = async function cmdRename(argv) {
    const testMode = !argv.doit;
    const logTag = "cmdRename";
    log.show(logTag, argv);
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
    if (!(argv.clean || argv.fixenc || argv.tcsc || argv.replace)) {
        log.error(`Error: replace|clean|encoding|tcsc, one is required`);
        throw new Error(`replace|clean|encoding|tcsc, one is required`);
    }
    const type = (argv.type || 'f').toLowerCase();
    if (!TYPE_LIST.includes(type)) {
        throw new Error(`Error: type must be one of ${TYPE_LIST}`);
    }
    const options = {
        needStats: true, withDirs: type === 'd', withFiles: type === 'a' || type === 'f'
    }
    let entries = await mf.walk(root, options);
    log.show(logTag, `Total ${entries.length} entries found (type=${type})`);

    const predicate = (fpath, pattern) => {
        const name = path.basename(fpath);
        return name.includes(pattern) || new RegExp(argv.include, "i").test(name);
    };
    if (argv.include?.length > 0) {
        // 处理include规则
        entries = await asyncFilter(entries, x => predicate(x.path, argv.include));
    } else if (argv.exclude?.length >= 3) {
        // 处理exclude规则
        entries = await asyncFilter(entries, x => !predicate(x.path, argv.exclude));
    }
    log.show(logTag, `Total ${entries.length} files after include/exclude rules`);
    entries = entries.map((f, i) => {
        return {
            ...f,
            index: i,
            argv: argv,
            total: entries.length,
        }
    })
    const fCount = entries.length;
    let tasks = await pMap(entries, PreRename, { concurrency: cpus().length * 4 })
    tasks = tasks.filter(f => f?.outName)
    const tCount = tasks.length;
    log.showYellow(
        logTag, `Total ${fCount - tCount} files are skipped. (type=${type})`
    );
    if (tasks.length > 0) {
        log.showGreen(
            logTag,
            `Total ${tasks.length} files ready to rename. (type=${type})`
        );
    } else {
        log.showYellow(
            logTag,
            `Nothing to do, abort. (type=${type})`);
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
                `Are you sure to rename these ${tasks.length} files (type=${type})? `
            ),
        },
    ]);
    if (answer.yes) {
        if (testMode) {
            log.showYellow(logTag, `${tasks.length} files, NO file renamed in TEST MODE. (type=${type})`);
        }
        else {
            const results = await renameFiles(tasks, false);
            log.showGreen(logTag, `All ${results.length} file were renamed. (type=${type})`);
        }
    } else {
        log.showYellow(logTag, "Will do nothing, aborted by user. ");
    }
}

let badCount = 0;
// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set();
async function PreRename(f) {
    const logTag = `PreRename`;
    const argv = f.argv;
    const ipx = f.index;
    const oldPath = path.resolve(f.path);
    const flag = f.stats?.isDirectory() ? "D" : "F";
    const oldName = path.basename(oldPath)
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
    if (argv.fixenc) {
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
            log.showGray(logTag, `BadEnc:${++badCount} `, oldPath)
            log.fileLog(`BadEnc: ${ipx} <${oldPath}>`, logTag);
        }
    }
    if (argv.replace) {
        // 替换不涉及扩展名和目录路径，只处理文件名部分
        const strFrom = argv.replace[0];
        const strTo = argv.replace[1] || "";

        if (strFrom?.length > 0) {
            const pattern = new RegExp(strFrom, "ugi");
            const tempBase = oldBase.replaceAll(pattern, strTo);
            if (tempBase !== oldBase) {
                log.show(logTag, 'Replace:', `${oldBase}${ext}`, `${tempBase}${ext}`,
                    strFrom, strTo, flag)
                oldBase = tempBase;
            }
        }
    }
    if (argv.clean) {
        // 执行净化文件名操作
        oldBase = cleanFileName(oldBase, { separator: "", keepDateStr: true, tc2sc: false })
    }
    if (argv.tcsc) {
        // 执行繁体转简体操作
        oldBase = sify(oldBase)
    }
    // 确保文件名不含有文件系统不允许的非法字符
    oldBase = helper.filenameSafe(oldBase);
    // 生成修复后的新路径，包括旧基础路径和文件扩展名
    const newName = `${oldBase}${ext}`
    const newPath = path.resolve(path.join(newDir, newName));
    if (newPath === oldPath) {
        log.info(logTag, `Skip Same: ${ipx} ${helper.pathShort(oldPath)} ${flag}`);
        f.skipped = true;
    }
    else if (!f.skipped && await fs.pathExists(newPath)) {
        log.info(logTag, `Skip DstExists: ${ipx} ${helper.pathShort(newPath)} ${flag}`);
        f.skipped = true;
    }
    else if (!f.skipped && nameDuplicateSet.has(newPath)) {
        log.info(logTag, `Skip DstDup: ${ipx} ${helper.pathShort(newPath)} ${flag}`);
        f.skipped = true;
    }

    if (f.skipped) {
        // log.fileLog(`Skip: ${ipx} ${oldPath}`, logTag);
        // log.info(logTag, `Skip: ${ipx} ${oldPath}`);
        return;
    }
    if (f.fixenc && enc.hasBadUnicode(newDir)) {
        log.showGray(logTag, `BadEncFR:${++badCount}`, oldPath)
        log.show(logTag, `BadEncTO:${++badCount}`, newPath)
        log.fileLog(`BadEncFR: ${ipx} <${oldPath}>`, logTag);
        log.fileLog(`BadEncTO: ${ipx} <${newPath}>`, logTag);
    }
    else {
        const pathDepth = oldPath.split(path.sep).length
        f.skipped = false;
        f.outName = newName;
        f.outPath = newPath;
        log.showGray(logTag, `SRC: ${ipx} <${helper.pathShort(oldPath)}> ${flag} ${pathDepth}`);
        log.show(logTag, `DST: ${ipx} <${helper.pathShort(newPath)}> ${flag} ${pathDepth}`);
        log.fileLog(`Add: ${ipx} <${oldPath}> [SRC] ${flag}`, logTag);
        log.fileLog(`Add: ${ipx} <${newPath}> [DST] ${flag}`, logTag);
        return f;
    }

}