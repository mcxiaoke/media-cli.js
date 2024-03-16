#!/usr/bin/env node
import inquirer from "inquirer";
import path from "path";
import fs from 'fs-extra';
import chalk from 'chalk';

import { renameFiles } from "../lib/functions.js";

import * as log from '../lib/debug.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'

const MODE_AUTO = "auto";
const MODE_DIR = "dirname";
const MODE_PREFIX = "prefix";

const NAME_LENGTH = 24;

export { command, aliases, describe, builder, handler }

const command = "prefix <input> [output]"
const aliases = ["pf", "px"]
const describe = 'Rename files by append dir name or string'
const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("length", {
        alias: "l",
        type: "number",
        default: NAME_LENGTH,
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
// 视频文件名各种前后缀
const reVideoName = /HD1080P|2160p|1080p|720p|BDRip|H264|H265|X265|HEVC|AVC|8BIT|10bit|WEB-DL|SMURF|Web|AAC5\.1|Atmos|H\.264|DD5\.1|DDP5\.1|AAC|DJWEB|Play|VINEnc|DSNP|END|高清|特效|字幕组|公众号|\[.+\]/gi;
// 图片文件名各种前后缀
const reImageName = /更新|合集|画师|图片|视频|插画|视图|订阅|限定|差分|R18|PSD|PIXIV|PIC|NO\.\d+|ZIP|RAR/gi
// 正则：匹配除 中日韩俄英 之外的特殊字符
const reNonChars = /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}\w_\.]/ugi;
// 匹配空白字符和特殊字符
const reUglyChars = /[《》【】\s_\-+=\.@#$%&\|]+/gi;
// 匹配开头的空白和特殊字符
const reStripUglyChars = /(^[\s_\-+=\.@#$%&\|]+)|([\s_\-+=\.@#$%&\|]+$)/gi;

// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set();

function cleanAlbumPicName(nameString, ext) {
    let nameStr = nameString;
    nameStr = nameStr.replaceAll(/\d{4}-\d{2}-\d{2}/gi, "");
    // 括号改为下划线
    nameStr = nameStr.replaceAll(/[\(\)]/gi, "_");
    nameStr = nameStr.replaceAll(/\d+年\d+月/gi, "");
    // 去掉附加说明
    nameStr = nameStr.replaceAll(/\[.+\]/gi, "");
    nameStr = nameStr.replaceAll(/\d+P(\d+V)?/gi, "");
    // 去掉所有特殊字符
    nameStr = nameStr.replaceAll(reNonChars, "");
    nameStr = nameStr.replaceAll(reImageName, "");

    return nameStr;
}

function createNewNameByAuto(f, argv) {
    const forceAll = argv.all || false;
    const nameLength = argv.length || NAME_LENGTH;
    const [dir, base, ext] = helper.pathSplit(f.path);
    const logTag = "Prefix[A]";
    if (!reOnlyNum.test(base) && !forceAll) {
        log.showYellow(logTag, `Ignore: ${helper.pathShort(f.path)}`);
        return;
    }
    const sep = helper.isVideoFile(f.path) || helper.isSubtitleFile(f.path) ? "." : "_";
    // 原始文件名是否去掉所有特殊字符
    const oldBase = argv.clean ? cleanAlbumPicName(base) : base;
    // 取目录项的最后两级目录名
    let dirParts = dir.split(path.sep).slice(-2);
    // 两侧目录名重复则取最深层目录名
    let dirFix = dirParts[1].includes(dirParts[0]) ? dirParts[1] : dirParts.join(sep);
    // 去掉目录名中的年月日
    let prefix = cleanAlbumPicName(dirFix);
    if (argv.ignore && argv.ignore.length >= 2) {
        prefix = prefix.replaceAll(argv.ignore, "");
    }
    const nameSlice = nameLength * -1;

    let fullBase = prefix + "_" + oldBase;
    fullBase = fullBase.replaceAll(reStripUglyChars, "");
    fullBase = fullBase.replaceAll(/[-_\s\.]+/gi, sep);
    fullBase = fullBase.slice(nameSlice);

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
    log.show(logTag, `=> ${newPath}`);
    return f;
}

function createNewNameCommon(f, argv, useDirName) {
    const nameLength = argv.length || NAME_LENGTH;
    const [dir, base, ext] = helper.pathSplit(f.path);
    const logTag = useDirName ? "Prefix[D]" : "Prefix[P]";
    if (path.basename(dir).startsWith("_")) {
        return;
    }

    const sep = helper.isVideoFile(f.path) || helper.isSubtitleFile(f.path) ? "." : "_";
    log.info(logTag, `Processing ${f.path}`);
    let prefix = argv.prefix;
    if (useDirName) {
        prefix = path.basename(dir);
        // 忽略深层文件夹如 S1 S2
        if (prefix.length < 8 && /^[A-Za-z0-9 ]+$/.test(prefix)) {
            prefix = path.basename(path.dirname(dir));
        }
    }
    if (!prefix || prefix.length == 0) {
        log.warn(logTag, `Invalid Prefix: ${helper.pathShort(f.path)}`);
        throw new Error(`Invalid Prefix`);
    }
    const nameSlice = nameLength * -10;
    // 不添加重复前缀
    if (base.includes(prefix)) {
        log.info(logTag, `IgnorePrefix: ${helper.pathShort(f.path)}`);
        prefix = "";
    }


    // 原始文件名是否去掉所有特殊字符
    let oldBase = argv.clean ? cleanAlbumPicName(base) : base;
    // 去掉所有视频文件描述前缀后缀等，
    // 是否去掉所有特殊字符
    if (argv.clean) {
        if (helper.isVideoFile(f.path) || helper.isSubtitleFile(f.path)) {
            oldBase = oldBase.replaceAll(reVideoName, "");
        }
        oldBase = oldBase.replaceAll(reUglyChars, sep);
    }
    let fullBase = prefix + sep + oldBase;
    if (helper.isImageFile(f.path)) {
        fullBase = cleanAlbumPicName(fullBase);
    }

    fullBase = fullBase.replaceAll(reStripUglyChars, "");
    // 多余空白和字符替换为一个字符 _或.
    fullBase = fullBase.replaceAll(/[-_\s\.]+/gi, sep);
    fullBase = fullBase.slice(nameSlice);

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
    log.show(logTag, `=> ${newPath}`);
    return f;
}

function createNewNameByDir(f, argv) {
    return createNewNameCommon(f, argv, true)
}

function createNewNameByPrefix(f, argv) {
    return createNewNameCommon(f, argv, false)
}

const handler = async function cmdPrefix(argv) {
    log.info('cmdPrefix', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        log.error("Invalid Input: " + root);
        throw new Error("Invalid Input: " + root);
    }
    const testMode = !argv.doit;
    const forceAll = argv.all || false;
    const mode = argv.mode || MODE_AUTO;
    const prefix = argv.prefix;
    const startMs = Date.now();
    log.show("Prefix", `Input: ${root}`, forceAll ? "(force all)" : "");

    if (mode === MODE_PREFIX && !prefix) {
        throw new Error(`No prefix value supplied!`);
    }

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
    const tasks = files.map(f => createNameFunc(f, argv)).filter(f => f && f.outName)
    if (tasks.length > 0) {
        log.showGreen(
            "Prefix",
            `Total ${tasks.length} media files ready to rename`,
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
    log.showYellow("Prefix:", argv);
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
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
        if (testMode) {
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