#!/usr/bin/env node
import assert from "assert";
import chalk from 'chalk';
import dayjs from "dayjs";
import fs from 'fs-extra';
import inquirer from "inquirer";
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import sharp from "sharp";

import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';

// 日志文件
const fileLog = function (msg, tag) {
    log.fileLog(msg, tag, "mediac");
}

export { aliases, builder, command, describe, handler };

const command = "remove <input> [output]"
const aliases = ["rm", "rmf"]
const describe = 'Remove files by given size/width-height/name-pattern/file-list'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("safe", {
        type: "boolean",
        default: true,
        // 使用安全删除，默认开启，移动到Deleted目录，关闭后是永久删除
        description: "If true, moved to Deleted dir, instead real delete",
    })
        .option("loose", {
            alias: "l",
            type: "boolean",
            default: false,
            // 宽松模式，默认不开启，宽松模式条件或，默认严格模式条件与
            description: "If true, operation of conditions is OR, default AND",
        })
        .option("width", {
            type: "number",
            default: 0,
            // 图片文件的最大宽度
            description: "Files width smaller than value will be removed",
        })
        .option("height", {
            type: "number",
            default: 0,
            // 图片文件的最大高度
            description: "Files height smaller than value will be removed",
        })
        .option("measure", {
            alias: "m",
            type: "string",
            default: "",
            // 图片文件的长宽字符串形式
            description: "File x*y dimension, width and height, eg: '123x456'",
        })
        .option("size", {
            alias: "s",
            type: "number",
            default: 0,
            // 图片文件的文件大小数值，最大，单位为k
            description: "Files size smaller than value will be removed (unit:k)",
        })
        .option("pattern", {
            alias: "p",
            type: "string",
            default: "",
            // 文件名匹配，字符串或正则表达式
            description: "Files name pattern matche value will be removed",
        })
        .option("list", {
            type: "string",
            default: null,
            // 文件名列表文本文件，或者一个目录，里面包含的文件作为文件名列表来源
            description: "File name list file, or dir contains files for file name",
        })
        .option("reverse", {
            alias: "r",
            type: "boolean",
            default: false,
            // 文件名列表反转，默认为否，即删除列表中的文件，反转则删除不在列表中的文件
            description: "delete files in list, if true delete files not in the list",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}


const handler = async function cmdRemove(argv) {
    log.info('cmdRemove', argv);
    assert.strictEqual("string", typeof argv.input, "root must be string");
    if (!argv.input || !(await fs.pathExists(argv.input))) {
        log.error("cmdRemove", `Invalid Input: '${argv.input}'`);
        throw new Error("Invalid Input: " + argv.input);
    }
    const root = path.resolve(argv.input);
    // 如果没有提供任何一个参数，报错，显示帮助
    if (argv.width == 0 && argv.height == 0 && argv.size == 0
        && !argv.pattern && !argv.list) {
        log.error("cmdRemove", `width/height/size/pattern/list not supplied`);
        throw new Error("width/height/size/pattern/list not supplied");
    }

    const testMode = !argv.doit;
    const useSafeRemove = argv.safe || true;
    const cLoose = argv.loose || false;
    const cWidth = argv.width || 0;
    const cHeight = argv.height || 0;
    const cSize = argv.size * 1024 || 0;
    const cPattern = argv.pattern || "";
    const cReverse = argv.reverse || false;
    const cList = argv.list || "-not-exists";

    if (argv.measure && argv.measure.length > 0) {
        // 解析文件长宽字符串，例如 2160x4680
    }

    let cNames = [];
    if (await fs.pathExists(path.resolve(cList))) {
        try {
            const list = path.resolve(cList);
            const listStat = await fs.stat(list);
            if (listStat.isFile()) {
                cNames = (await readNameList(list)) || new Set();
            } else if (listStat.isDirectory()) {
                const dirFiles = (await fs.readdir(list)) || [];
                cNames = new Set(dirFiles.map(x => path.parse(x).name.trim()));
            } else {
                log.error("cmdRemove", `invalid arguments: list file invalid 1`);
                return;
            }
        } catch (error) {
            log.error(error);
            log.error("cmdRemove", `invalid arguments: list file invalid 2`);
            return;
        }
    }

    cNames = cNames || new Set();

    log.show("cmdRemove", `input:`, root);
    fileLog(`<Input> ${root}`, "cmdRemove");

    const conditions = {
        loose: cLoose,
        width: cWidth,
        height: cHeight,
        size: cSize,
        pattern: cPattern,
        names: cNames || new Set(),
        reverse: cReverse,
        safe: useSafeRemove,
        testMode: testMode,
    }

    const walkOpts = {
        entryFilter: (f) =>
            f.stats.isFile(),
        withIndex: true,
    };
    const files = await mf.walk(root, walkOpts);
    log.show("cmdRemove", `total ${files.length} files found`);
    const prepareFunc = async f => {
        return prepareRemoveArgs(f, conditions)
    }
    let tasks = await pMap(files, prepareFunc, { concurrency: cpus().length * 2 })

    conditions.names = Array.from(cNames).slice(-5);
    const total = tasks.length;
    tasks = tasks.filter((t) => t && t.shouldRemove);
    const skipped = total - tasks.length;
    log.showYellow("cmdRemove", `${tasks.length} files to be removed`);
    if (skipped > 0) {
        log.showYellow("cmdRemove", `${skipped} files are ignored`)
    }
    if (tasks.length == 0) {
        log.show("cmdRemove", conditions);
        log.showGreen("Nothing to do, abort.");
        return;
    }

    log.show("cmdRemove", `task sample:`, tasks.slice(-1));
    log.showYellow("cmdRemove", conditions);
    if (cNames && cNames.size > 0) {
        // 默认仅删除列表中的文件，反转则仅保留列表中的文件，其它的全部删除，谨慎操作
        log.showYellow("cmdRemove", `Attention: use file name list, ignore all other conditions`);
        log.showRed("cmdRemove", `Attention: Will DELETE all files ${cReverse ? "NOT IN" : "IN"} the name list!`);
    }
    fileLog(`<Conditions> list=${cNames.size},loose=${cLoose},width=${cWidth},height=${cHeight},size=${cSize / 1024}k,name=${cPattern}`, "cmdRemove");
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to remove ${tasks.length} files (total ${files.length}) using above conditions?`
            ),
        },
    ]);

    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.");
        return;
    }

    const startMs = Date.now();
    log.showGreen("cmdRemove", 'task startAt', dayjs().format())
    // const result = await pMap(tasks, fs.remove, { concurrency: cpuCount / 2 + 1 });
    let removedCount = 0;
    let index = 0;
    if (testMode) {
        log.showYellow("cmdRemove", `All ${tasks.length} files, BUT NO file removed in TEST MODE.`);
    } else {
        for (const task of tasks) {
            try {
                await useSafeRemove ? helper.safeRemove(task.src) : fs.remove(task.src);
                ++removedCount;
                fileLog(`<Removed> ${task.src} (${task.index})`, "cmdRemove");
                log.show("cmdRemove", `${useSafeRemove ? "SafeDel" : "Deleted"} ${task.src} (${task.index}) (${++index}/${tasks.length})`);
            } catch (error) {
                log.error("cmdRemove", `failed to remove file ${task.src}`, error);
            }
        }
    }

    log.showGreen("cmdRemove", 'task endAt', dayjs().format())
    log.showGreen("cmdRemove", `${removedCount} files removed in ${helper.humanTime(startMs)}`)
    log.show("cmdRemove", `task logs are written to ${log.fileLogName()}`);
}

async function readNameList(list) {
    const listContent = await fs.readFile(list, 'utf-8') || "";
    const nameList = listContent.split(/\r?\n/).map(x => path.parse(x).name.trim()).filter(Boolean);
    return new Set(nameList);
}

function buildRemoveArgs(index, desc, shouldRemove, src) {
    return {
        index: index,
        desc: desc,
        shouldRemove: shouldRemove,
        src: src,
    };
}

async function prepareRemoveArgs(f, options) {
    const fileSrc = path.resolve(f.path);
    const fileName = path.basename(fileSrc);
    const [dir, base, ext] = helper.pathSplit(fileSrc);

    let conditions = options || {};
    //log.show("prepareRM options:", options);
    // 文件名列表规则
    const cNames = conditions.names || new Set();
    // 是否反转文件名列表
    const cReverse = conditions.reverse;
    const hasList = cNames && cNames.size > 0;

    let itemDesc = "";
    //----------------------------------------------------------------------
    if (hasList) {
        let shouldRemove = false;
        const nameInList = cNames.has(base.trim());
        if (cReverse) {
            shouldRemove = !nameInList;
        } else {
            shouldRemove = nameInList;
        }
        itemDesc = `IN=${nameInList} R=${cReverse}`;
        log.show(
            "prepareRM[List] add:",
            `${helper.pathShort(fileSrc)} ${itemDesc}`, f.index
        );
        return buildRemoveArgs(f.index, itemDesc, shouldRemove, fileSrc);
    }
    // 文件名列表是单独规则，优先级最高，如果存在，直接返回，忽略其它条件
    //----------------------------------------------------------------------

    // three args group
    // name pattern top1
    // width && height top2
    // size top3
    // 宽松模式，采用 OR 匹配条件，默认是 AND
    const cLoose = conditions.loose || false;
    // 最大宽度
    const cWidth = conditions.width || 0;
    // 最大高度
    const cHeight = conditions.height || 0;
    // 最大文件大小，单位k
    const cSize = conditions.size || 0;
    // 文件名匹配文本
    const cPattern = (conditions.pattern || "").toLowerCase();

    const hasName = cPattern && cPattern.length > 0;//1
    const hasSize = cSize > 0;//2
    const hasMeasure = cWidth > 0 || cHeight > 0;//3

    //log.show("prepareRM", `${cWidth}x${cHeight} ${cSize} /${cPattern}/`);

    let testName = false;
    let testSize = false;
    let testMeasure = false;

    try {
        // 首先检查名字正则匹配
        if (hasName) {
            const fName = fileName.toLowerCase();
            const rp = new RegExp(cPattern, "gi");
            itemDesc += ` PT=${cPattern}`;
            // 开头匹配，或末尾匹配，或正则匹配
            if (fName.startsWith(cPattern) || fName.endsWith(cPattern) || rp.test(fName)) {
                log.info(
                    "prepareRM[Name]:", `${fileName} [NamePattern=${rp}]`
                );
                testName = true;
            } else {
                log.debug(
                    "prepareRM[Name]:", `${fileName} [NamePattern=${rp}]`
                );
            }
        }

        // 其次检查文件大小是否满足条件
        if (hasSize) {
            const fst = await fs.stat(fileSrc);
            const fSize = fst.size || 0;
            itemDesc += ` ${Math.round(fSize / 1024)}k`
            if (fSize > 0 && fSize <= cSize) {
                log.info(
                    "prepareRM[Size]:",
                    `${fileName} [${Math.round(fSize / 1024)}k] [Size=${cSize / 1024}k]`
                );
                testSize = true;
            }
        }

        // 图片文件才检查宽高
        const isImage = helper.isImageFile(fileSrc);

        // 再次检查宽高是否满足条件
        if (hasMeasure) {
            if (isImage) {
                const s = sharp(fileSrc);
                const m = await s.metadata();
                const fWidth = m.width || 0;
                const fHeight = m.height || 0;
                itemDesc += ` ${fWidth}x${fHeight}`
                if (cWidth > 0 && cHeight > 0) {
                    // 宽高都提供时，要求都满足才能删除
                    if (fWidth <= cWidth && fHeight <= cHeight) {
                        log.info(
                            "prepareRM[Measure]:",
                            `${fileName} ${fWidth}x${fHeight} [${cWidth}x${cHeight}]`
                        );
                        testMeasure = true;
                    }
                }
                else {
                    if (cWidth > 0 && fWidth <= cWidth) {
                        // 只提供宽要求
                        log.info(
                            "prepareRM[Measure]:",
                            `${fileName} ${fWidth}x${fHeight} [W=${cWidth}]`
                        );
                        testMeasure = true;
                    } else if (cHeight > 0 && fHeight <= cHeight) {
                        // 只提供高要求
                        log.info(
                            "prepareRM[Measure]:",
                            `${fileName} ${fWidth}x${fHeight} [H=${cHeight}]`
                        );
                        testMeasure = true;
                    }
                }
            } else {
                log.info("prepareRM[Measure]:", `${fileName} is not image file`);
            }
        }

        // 满足名字规则/文件大小/宽高任一规则即会被删除，或关系
        let shouldRemove = false;
        if (cLoose) {
            shouldRemove = testName || testSize || testMeasure;
        }
        else {
            // 必须同时满足所有用户已提供的条件，与关系
            shouldRemove = ((hasName && testName) || !hasName)
                && ((hasSize && testSize) || !hasSize)
                && ((isImage && hasMeasure && testMeasure) || !hasMeasure);
        }

        if (shouldRemove) {
            log.show(
                "prepareRM add:",
                `${helper.pathShort(fileSrc)} ${itemDesc}`, f.index
            );
        } else {
            (testName || testSize || testMeasure) && log.info(
                "prepareRM ignore:",
                `${helper.pathShort(fileSrc)} ${itemDesc} (${testName} ${testSize} ${testMeasure})`, f.index
            );
        }

        return {
            // conditions: conditions,
            // testName: testName,
            // testSize: testSize,
            // testMeasure: testMeasure,
            index: f.index,
            desc: itemDesc,
            shouldRemove: shouldRemove,
            src: fileSrc,
        };

    } catch (error) {
        log.error("prepareRM error:", error, fileSrc);
        // await fs.remove(fileSrc);
        fileLog(`<Error> ${fileSrc} (${f.index})`, "cmdRemove");
    }
}
