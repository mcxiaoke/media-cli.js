/*
 * File: cmd_prefix.js
 * Created: 2024-03-15 15:58:54
 * Modified: 2024-03-23 11:51:42
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */


import chalk from 'chalk';
import { sify } from 'chinese-conv';
import fs from 'fs-extra';
import inquirer from "inquirer";
import path from "path";


import { renameFiles } from "./cmd_shared.js";

import { asyncFilter } from '../lib/core.js';
import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';

const MODE_AUTO = "auto";
const MODE_DIR = "dirname";
const MODE_PREFIX = "prefix";
const MODE_MEDIA = "media";

const NAME_LENGTH = 32;

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
        // 仅处理符合指定条件的文件，包含文件名规则
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
            alias: 'D',
            type: "boolean",
            description: "mode dirname",
        })
        .option("prefix", {
            alias: 'P',
            type: "boolean",
            description: "mode prefix",
        })
        .option("media", {
            alias: 'M',
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
const reImageName = /更新|合集|画师|图片|视频|插画|视图|作品|订阅|限定|差分|拷贝|自购|付费|内容|R18|PSD|PIXIV|PIC|ZIP|RAR/gi
// Unicode Symbols
// https://en.wikipedia.org/wiki/Script_%28Unicode%29
// https://www.regular-expressions.info/unicode.html
// https://symbl.cc/cn/unicode/blocks/halfwidth-and-fullwidth-forms/
// https://www.unicode.org/reports/tr18/
// https://ayaka.shn.hk/hanregex/
// 特例字符	中英	全半角	unicode范围	unicode码表名
// 单双引号	中文	全/半	0x2018-0x201F	常用标点
// 句号、顿号	中文	全/半	0x300x-0x303F	中日韩符号和标点
// 空格	中/英	全角	0x3000	中日韩符号和标点
// -	英	半角	0x0021~0x007E	半角符号
// -	英	全角	0xFF01~0xFF5E	全角符号
// -	中	全/半	0xFF01~0xFF5E	全角符号
// 正则：匹配除 [中文日文标点符号] 之外的特殊字符
// u flag is required
// \p{sc=Han} CJK全部汉字 比 \u4E00-\u9FFF = \p{InCJK_Unified_Ideographs} 范围大
// 匹配汉字还可以使用 \p{Unified_Ideograph}
// \p{sc=Hira} 日文平假名
// \p{P} 拼写符号
// \p{ASCII} ASCII字符
// \uFE10-\uFE1F 中文全角标点
// \uFF01-\uFF11 中文全角标点
const reNonChars = /[^\p{Unified_Ideograph}\p{P}\p{sc=Hira}0-z]/ugi;
// 匹配空白字符和特殊字符
// https://www.unicode.org/charts/PDF/U3000.pdf
// https://www.asciitable.com/
const reUglyChars = /[\s\x00-\x1F\x21-\x2F\x3A-\x40\x5B-\x60\x7b-\xFF]+/gi;
// 匹配开头和结尾的空白和特殊字符
const reStripUglyChars = /(^[\s\x21-\x2F\x3A-\x40\x5B-\x60\x7b-\xFF\p{P}]+)|([\s\x21-\x2F\x3A-\x40\x5B-\x60\x7b-\xFF\p{P}]+$)/gi;
// 图片视频子文件夹名过滤
// 如果有表示，test() 会随机饭后true or false，是一个bug
// 使用 string.match 函数没有问题
// 参考 https://stackoverflow.com/questions/47060553
// The g modifier causes the regex object to maintain state. 
// It tracks the index after the last match.
const reMediaDirName = /^图片|视频|Image|Video|Thumbs$/gi;
// 可以考虑将日文和韩文罗马化处理
// https://github.com/lovell/hepburn
// https://github.com/fujaru/aromanize-js
// https://www.npmjs.com/package/aromanize
// https://www.npmjs.com/package/@lazy-cjk/japanese
function cleanAlbumName(nameString, sep, filename) {
    let nameStr = nameString;
    // 去掉方括号 [xxx] 的内容
    // nameStr = nameStr.replaceAll(/\[.+?\]/gi, "");
    // 去掉图片集说明文字
    nameStr = nameStr.replaceAll(reImageName, sep);
    // 去掉视频说明文字
    nameStr = nameStr.replaceAll(reVideoName, "");
    // 去掉日期字符串
    nameStr = nameStr.replaceAll(/\d+年\d+月/gi, "");
    nameStr = nameStr.replaceAll(/\d{4}-\d{2}-\d{2}/gi, "");
    // 去掉 [100P5V 2.25GB] No.46 这种图片集说明
    nameStr = nameStr.replaceAll(/\[\d+P.*(\d+V)?.*?\]/gi, "");
    nameStr = nameStr.replaceAll(/No\.\d+|\d+\.?\d+GB?|\d+P|\d+V|NO\.(\d+)/gi, "$1");
    if (helper.isImageFile(filename)) {
        // 去掉 2024.03.22 这种格式的日期
        nameStr = nameStr.replaceAll(/\d{4}\.\d{2}\.\d{2}/gi, "");
    }
    // 去掉中文标点特殊符号
    nameStr = nameStr.replaceAll(/[\u3000-\u303F\uFE10-\uFE1F\uFF01-\uFF11]/gi, "");
    // () [] {} <> . - 改为下划线
    nameStr = nameStr.replaceAll(/[\(\)\[\]{}<>\.\-]/gi, sep);
    // 日文转罗马字母
    // nameStr = hepburn.fromKana(nameStr);
    // nameStr = wanakana.toRomaji(nameStr);
    // 韩文转罗马字母
    // nameStr = aromanize.hangulToLatin(nameStr, 'rr-translit');
    // 繁体转换为简体中文
    nameStr = sify(nameStr);
    // 去掉所有特殊字符
    return nameStr.replaceAll(reNonChars, sep);
}

function getAutoModePrefix(dir, sep) {
    // 从左到右的目录层次
    const [d1, d2, d3] = dir.split(path.sep).slice(-3);
    log.debug([d1, d2, d3].join(','));
    if (d3.includes(d1) && d2.includes(d1)) {
        return d3;
    }
    if (d3.includes(d2)) {
        return d3;
    }
    if (d2.includes(d1)) {
        return [d2, d3].join(sep)
    }
    return [d1, d2, d3].join(sep)
}

function parseNameMode(argv) {
    let mode = argv.auto ? MODE_AUTO : argv.mode || MODE_AUTO;
    if (argv.mprefix) { mode = MODE_PREFIX; }
    if (argv.dirname) { mode = MODE_DIR; }
    if (argv.media) { mode = MODE_MEDIA; }
    return mode;
}

// 重复文件名Set，检测重复，防止覆盖
const nameDuplicateSet = new Set();
function createNewNameByMode(f, argv) {
    const mode = parseNameMode(argv);
    const nameLength = (mode == MODE_MEDIA) ? 200 : argv.length || NAME_LENGTH;
    const nameSlice = nameLength * -1;
    const [dir, base, ext] = helper.pathSplit(f.path);
    const oldName = path.basename(f.path);
    const dirParts = dir.split(path.sep).slice(-3);
    const dirName = path.basename(dir);
    const logTag = `Prefix::${mode.toUpperCase()[0]}`;
    // 直接忽略 . _ 开头的目录
    if (/^[\._]/.test(dirName)) {
        return;
    }
    const ipx = `${f.index}/${f.total}`
    log.info(logTag, `Processing ${ipx} ${f.path}`);
    let sep = "_";
    let prefix = argv.prefix;
    let oldBase = base;
    switch (mode) {
        case MODE_MEDIA:
            {
                sep = ".";
                prefix = dirName;
                if (prefix.match(reMediaDirName)) {
                    prefix = dirParts[2];
                }
                if (prefix.length < 4 && /^[A-Za-z0-9]+$/.test(prefix)) {
                    prefix = dirParts[2] + sep + prefix;
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
                prefix = dirName;
                if (prefix.match(reMediaDirName)) {
                    prefix = dirParts[2];
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
                    log.showYellow(logTag, `Ignore: ${ipx} ${helper.pathShort(f.path)}`);
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
        prefix = cleanAlbumName(prefix, sep, oldName);
        oldBase = cleanAlbumName(oldBase, sep, oldName);
    }
    // 不添加重复前缀
    if (oldBase.includes(prefix)) {
        log.info(logTag, `IgnorePrefix: ${ipx} ${helper.pathShort(f.path)}`);
        prefix = "";
    }
    let fullBase = prefix + sep + oldBase;
    // 去除首位空白和特殊字符
    fullBase = fullBase.replaceAll(reStripUglyChars, "");
    // 多余空白和字符替换为一个字符 _或.
    fullBase = fullBase.replaceAll(reUglyChars, sep);
    // 去掉重复词组，如目录名和人名
    fullBase = Array.from(new Set(fullBase.split(sep))).join(sep)
    fullBase = unicodeStrLength(fullBase) > nameLength ? fullBase.slice(nameSlice) : fullBase;
    // 再次去掉首位的特殊字符和空白字符
    fullBase = fullBase.replaceAll(reStripUglyChars, "");
    const newName = `${fullBase}${ext}`;
    const newPath = path.join(dir, newName);
    if (fullBase === base) {
        log.info(logTag, `NoChange: ${ipx} ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    else if (fs.existsSync(newPath)) {
        log.info(logTag, `Exists: ${ipx} ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    else if (nameDuplicateSet.has(newPath)) {
        log.info(logTag, `Duplicate: ${ipx} ${helper.pathShort(newPath)}`);
        f.skipped = true;
    }
    nameDuplicateSet.add(newPath);
    if (f.skipped) {
        log.fileLog(`Skip: ${ipx} ${f.path}`, logTag);
    } else {
        f.outName = newName;
        log.show(logTag, `${ipx} ${chalk.cyan(helper.pathShort(f.path, 36))} => ${chalk.green(newName)}`);
        log.fileLog(`Prepare: ${ipx} <${f.path}> => ${newName}`, logTag);
    }
    return f;
}

const handler = async function cmdPrefix(argv) {
    const testMode = !argv.doit;
    const logTag = "cmdPrefix";
    log.info(logTag, argv);
    const root = path.resolve(argv.input);
    if (!root || !(await fs.pathExists(root))) {
        throw new Error(`Invalid Input: ${root}`);
    }
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag);
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag);
    }
    const mode = argv.mode || MODE_AUTO;
    const prefix = argv.prefix;
    const startMs = Date.now();
    log.show(logTag, `Input: ${root}`);

    if (mode === MODE_PREFIX && !prefix) {
        throw new Error(`No prefix value supplied!`);
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
    if (files.length == 0) {
        log.showYellow("Prefix", "Nothing to do, exit now.");
        return;
    }
    files = files.map((f, i) => {
        return {
            ...f,
            index: i,
            total: files.length,
        }
    })
    const fCount = files.length;
    const tasks = files.map(f => createNewNameByMode(f, argv)).filter(f => f?.outName)
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