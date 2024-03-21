#!/usr/bin/env node
import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from "inquirer";
import path from "path";

import { renameFiles } from "../lib/functions.js";

import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';

const MODE_AUTO = "auto";
const MODE_DIR = "dirname";
const MODE_PREFIX = "prefix";
const MODE_MEDIA = "media";

const NAME_LENGTH = 48;

export { aliases, builder, command, describe, handler };

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
            description: "filename prefix str for output ",
        })
        // 指定MODE，三种：自动，目录名，指定前缀
        .option("mode", {
            alias: "m",
            type: "string",
            default: MODE_AUTO,
            description: "filename prefix mode for output ",
            choices: [MODE_AUTO, MODE_DIR, MODE_PREFIX, MODE_MEDIA],
        })
        .option("auto", {
            type: "boolean",
            description: "mode auto",
        })
        .option("dirname", {
            type: "boolean",
            description: "mode dirname",
        })
        .option("mprefix", {
            type: "boolean",
            description: "mode prefix",
        })
        .option("media", {
            type: "boolean",
            description: "mode media",
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
const reVideoName = helper.combineRegexG(
    /HD1080P|2160p|1080p|720p|BDRip/,
    /H264|H265|X265|HEVC|AVC|8BIT|10bit/,
    /WEB-DL|SMURF|Web|AAC5\.1|Atmos/,
    /H\.264|DD5\.1|DDP5\.1|AAC/,
    /DJWEB|Play|VINEnc|DSNP|END/,
    /高清|特效|字幕组|公众号/,
    /\[.+?\]/,
)
// 图片文件名各种前后缀
const reImageName = /更新|合集|画师|图片|视频|插画|视图|订阅|限定|差分|R18|PSD|PIXIV|PIC|NO\.\d+|ZIP|RAR/gi
// 正则：匹配除 [中日韩俄英和中英文标点符号] 之外的特殊字符
// u flag is required
const reNonChars = /[^\p{sc=Hani}\p{sc=Hira}\p{sc=Kana}\p{sc=Hang}\p{sc=Cyrl}\p{P}\uFF01-\uFF5E\u3001-\u3011\w\-_\.]/ugi;
// 匹配空白字符和特殊字符
const reUglyChars = /[《》【】\s_\-+=\.@#$%&\|]+/gi;
// 匹配开头和结尾的空白和特殊字符
const reStripUglyChars = /(^[\s_\-+=\.@#$%&\|]+)|([\s_\-+=\.@#$%&\|]+$)/gi;
// 图片视频子文件夹名过滤
// 如果有表示，test() 会随机饭后true or false，是一个bug
// 使用 string.match 函数没有问题
// 参考 https://stackoverflow.com/questions/47060553
// The g modifier causes the regex object to maintain state. 
// It tracks the index after the last match.
const reMediaDirName = /^图片|视频|Image|Video|Thumbs$/gi;

// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set();

function cleanAlbumName(nameString) {
    let nameStr = nameString;
    // 去掉方括号 [xxx] 的内容
    nameStr = nameStr.replaceAll(/\[.+?\]/gi, "");
    // 去掉图片集说明文字
    nameStr = nameStr.replaceAll(reImageName, "");
    // 去掉日期字符串
    nameStr = nameStr.replaceAll(/\d+年\d+月/gi, "");
    nameStr = nameStr.replaceAll(/\d{4}-\d{2}-\d{2}/gi, "");
    nameStr = nameStr.replaceAll(/\d{4}\.\d{2}\.\d{2}/gi, "");
    // 括号改为下划线
    nameStr = nameStr.replaceAll(/[\(\)]/gi, "_");
    // 去掉 100P5V 这种图片集说明
    nameStr = nameStr.replaceAll(/\d+P(\d+V)?/gi, "");
    // 去掉所有特殊字符
    return nameStr.replaceAll(reNonChars, "");
}

function getAutoModePrefix(dir, sep) {
    const dirParts = dir.split(path.sep).slice(-2);
    return dirParts[1].includes(dirParts[0]) ? dirParts[1] : dirParts.join(sep);
}

function parseNameMode(argv) {
    let mode = argv.auto ? MODE_AUTO : argv.mode || MODE_AUTO;
    if (argv.mprefix) { mode = MODE_PREFIX; }
    if (argv.dirname) { mode = MODE_DIR; }
    if (argv.media) { mode = MODE_MEDIA; }
    return mode;
}

function createNewNameByMode(f, argv) {
    // 处理模式
    const mode = parseNameMode(argv);
    const nameLength = (mode == MODE_MEDIA) ? 200 : argv.length || NAME_LENGTH;
    const nameSlice = nameLength * -1;
    const [dir, base, ext] = helper.pathSplit(f.path);
    const oldName = path.basename(f.path);
    const dirParent = path.basename(path.dirname(dir));
    const dirName = path.basename(dir);
    const logTag = `Prefix::${mode.toUpperCase()[0]}`;
    // 忽略 . _ 开头的目录
    if (/^[\._]/.test(dirName)) {
        return;
    }
    log.info(logTag, `Processing ${f.path}`);
    let sep = "_";
    let prefix = argv.prefix;
    let oldBase = base;
    switch (mode) {
        case MODE_MEDIA:
            {
                sep = ".";
                prefix = path.basename(dir);
                if (prefix.match(reMediaDirName)) {
                    prefix = dirParent;
                }
                if (prefix.length < 4 && /^[A-Za-z0-9]+$/.test(prefix)) {
                    prefix = dirParent + sep + prefix;
                }
            }
            break;
        case MODE_PREFIX:
            {
                sep = "_";
                prefix = argv.prefix;
            }
            break;
        case MODE_DIR:
            {
                sep = "_";
                prefix = path.basename(dir);
                if (prefix.match(reMediaDirName)) {
                    prefix = dirParent;
                }
            }
            break;
        case MODE_AUTO:
        default:
            {
                sep = "_";
                prefix = getAutoModePrefix(dir, sep);
                const applyToAll = argv.all || false;
                if (!reOnlyNum.test(base) && !applyToAll) {
                    log.showYellow(logTag, `Ignore: ${helper.pathShort(f.path)}`);
                    return;
                }
            }
            break;
    }
    // 无有效前缀，报错退出
    if (!prefix || prefix.length == 0) {
        log.warn(logTag, `Invalid Prefix: ${helper.pathShort(f.path)} ${mode}`);
        throw new Error(`No prefix supplied!`);
    }
    // 是否净化文件名，去掉各种特殊字符
    if (argv.clean) {
        if (mode == MODE_MEDIA) {
            // 移除视频文件各种格式说明
            oldBase = oldBase.replaceAll(reVideoName, "");
        }
        // 净化原始文件名字符串
        oldBase = cleanAlbumName(oldBase)
        oldBase = oldBase.replaceAll(reUglyChars, sep);
        if (helper.isMediaFile(f.path)) {
            prefix = cleanAlbumName(prefix);
        }
    }
    // 不添加重复前缀
    if (oldBase.includes(prefix)) {
        log.info(logTag, `IgnorePrefix: ${helper.pathShort(f.path)}`);
        prefix = "";
    }
    let fullBase = prefix + sep + oldBase;
    fullBase = fullBase.replaceAll(reStripUglyChars, "");
    // 多余空白和字符替换为一个字符 _或.
    fullBase = fullBase.replaceAll(/[\-_\s\.]+/gi, sep);
    fullBase = unicodeStrLength(fullBase) > nameLength ? fullBase.slice(nameSlice) : fullBase;
    const newName = `${fullBase}${ext}`;
    const newPath = path.join(dir, newName);
    if (fullBase === base) {
        log.info(logTag, `NoChange: ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    else if (fs.existsSync(newPath)) {
        log.info(logTag, `Exists: ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    else if (nameDuplicateSet.has(newPath)) {
        log.info(logTag, `Duplicate: ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    nameDuplicateSet.add(newPath);
    if (f.skipped) {
        log.fileLog(`Skipped: ${f.path}`, logTag);
    } else {
        f.outName = newName;
        log.show(logTag, `${chalk.cyan(oldName)} => ${chalk.green(helper.pathShort(newPath, 32))}`);
        log.fileLog(`Prepared: ${newPath}`, logTag);
    }
    return f;
}

const handler = async function cmdPrefix(argv) {
    log.info('Prefix', argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`);
    }
    const testMode = !argv.doit;
    const mode = argv.mode || MODE_AUTO;
    const prefix = argv.prefix;
    const startMs = Date.now();
    log.show("Prefix", `Input: ${root}`);

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
    log.show("Prefix", `Total ${files.length} files found in ${helper.humanTime(startMs)}`);
    if (files.length == 0) {
        log.showYellow("Prefix", "Nothing to do, exit now.");
        return;
    }
    const fCount = files.length;
    const tasks = files.map(f => createNewNameByMode(f, argv)).filter(f => f?.outName)
    const tCount = tasks.length;
    log.showYellow(
        "Prefix", `Total ${fCount - tCount} files are skipped.`
    );
    if (tasks.length > 0) {
        log.showGreen(
            "Prefix",
            `Total ${tasks.length} media files ready to rename`
        );
    } else {
        log.showYellow(
            "Prefix",
            `Nothing to do, abort.`);
        return;
    }
    log.info("Prefix:", argv);
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



// 计算字符串长度，中文算2，英文算1
function unicodeStrLength(str) {
    var len = 0;
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        //单字节加1 
        if ((c >= 0x0001 && c <= 0x007e) || (0xff60 <= c && c <= 0xff9f)) {
            len++;
        }
        else {
            len += 2;
        }
    }
    return len;
}

function unicodeStrSlice(str, len) {
    var str_length = 0;
    var str_len = 0;
    str_cut = new String();
    str_len = str.length;
    for (var i = 0; i < str_len; i++) {
        a = str.charAt(i);
        str_length++;
        if (encodeURI(a).length > 4) {
            //中文字符的长度经编码之后大于4
            str_length++;
        }
        str_cut = str_cut.concat(a);
        if (str_length >= len) {
            // str_cut = str_cut.concat("...");
            return str_cut;
        }
    }
    //如果给定字符串小于指定长度，则返回源字符串；
    if (str_length < len) {
        return str;
    }
}