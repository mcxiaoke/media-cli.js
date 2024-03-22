#!/usr/bin/env node
import assert from "assert";
import chalk from 'chalk';
import * as cliProgress from "cli-progress";
import dayjs from "dayjs";
import exif from 'exif-reader';
import fs from 'fs-extra';
import inquirer from "inquirer";
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import sharp from "sharp";
import * as log from '../lib/debug.js';
import * as mf from '../lib/file.js';
import { compressImage } from "../lib/functions.js";
import * as helper from '../lib/helper.js';
export { aliases, builder, command, describe, handler };

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = 'Compress input images to target size'

const QUALITY_DEFAULT = 86;
const SIZE_DEFAULT = 2048 // in kbytes
const WIDTH_DEFAULT = 6000;

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("purge", {
        alias: "p",
        type: "boolean",
        default: false,
        description: "Purge original image files",
    })
        // 是否覆盖已存在的压缩后文件
        .option("override", {
            type: "boolean",
            default: false,
            description: "Override existing dst files",
        })
        // 压缩后文件质量参数  
        .option("quality", {
            alias: "q",
            type: "number",
            default: QUALITY_DEFAULT,
            description: "Target image file compress quality",
        })
        // 需要处理的最小文件大小
        .option("size", {
            alias: "s",
            type: "number",
            default: SIZE_DEFAULT,
            description: "Processing file bigger than this size (unit:k)",
        })
        // 需要处理的图片最小尺寸
        .option("width", {
            alias: "w",
            type: "number",
            default: WIDTH_DEFAULT,
            description: "Max width of long side of image thumb",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

let compressLastUpdatedAt = 0;
const bar1 = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic);
const handler = async function cmdCompress(argv) {
    const testMode = !argv.doit;
    const logTag = "cmdCompress";
    const root = path.resolve(argv.input);
    assert.strictEqual("string", typeof root, "root must be string");
    if (!root || !(await fs.pathExists(root))) {
        log.error(logTag, `Invalid Input: '${root}'`);
        throw new Error(`Invalid Input: ${root}`);
    }
    if (!testMode) {
        log.fileLog(`Root:${root}`, logTag);
        log.fileLog(`Argv:${JSON.stringify(argv)}`, logTag);
    }
    log.show(logTag, argv);
    const override = argv.override || false;
    const quality = argv.quality || QUALITY_DEFAULT;
    const minFileSize = (argv.size || SIZE_DEFAULT) * 1024;
    const maxWidth = argv.width || WIDTH_DEFAULT;
    const deleteSrc = argv.purge || false;
    log.show(`${logTag} input:`, root);

    const RE_THUMB = /Z4K|M4K|feature|web|thumb$/i;
    const walkOpts = {
        needStats: true,
        entryFilter: (f) =>
            f.stats.isFile()
            && !RE_THUMB.test(f.path)
            && f.stats.size > minFileSize
            && helper.isImageFile(f.path)
    };
    log.showGreen(logTag, `Walking files ...`);
    let files = await mf.walk(root, walkOpts);
    if (!files || files.length == 0) {
        log.showYellow(logTag, "no files found, abort.");
        return;
    }
    log.show(logTag, `total ${files.length} files found (all)`);
    if (files.length == 0) {
        log.showYellow("Nothing to do, abort.");
        return;
    }
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
    log.showGreen(logTag, `preparing compress arguments...`);
    let startMs = Date.now();
    const addArgsFunc = async (f, i) => {
        return {
            ...f,
            total: files.length,
            index: i,
            quality,
            override,
            deleteSrc,
            maxWidth,
        }
    }
    files = await Promise.all(files.map(addArgsFunc));
    const needBar = files.length > 9999 && !log.isVerbose();
    needBar && bar1.start(files.length, 0);
    let tasks = await pMap(files, preCompress, { concurrency: cpus().length * 4 })
    needBar && bar1.update(files.length);
    needBar && bar1.stop();
    log.info(logTag, "before filter: ", tasks.length);
    const total = tasks.length;
    tasks = tasks.filter((t) => t?.dst);
    const skipped = total - tasks.length;
    log.info(logTag, "after filter: ", tasks.length);
    if (skipped > 0) {
        log.showYellow(logTag, `${skipped} thumbs skipped`)
    }
    if (tasks.length == 0) {
        log.showYellow("Nothing to do, abort.");
        return;
    }
    tasks.forEach((t, i) => {
        t.total = tasks.length;
        t.index = i;
    });
    log.show(logTag, `in ${helper.humanTime(startMs)} tasks:`)
    tasks.slice(-2).forEach(t => {
        log.show(helper._omit(t, "stats"));
    })
    log.info(logTag, argv);
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to compress ${tasks.length} files? \n[Apply to files bigger than ${minFileSize / 1024}K, target long width is ${maxWidth}] \n${deleteSrc ? "(Attention: you choose to delete original file!)" : "(Will keep original file)"}`
            ),
        },
    ]);

    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.");
        return;
    }

    startMs = Date.now();
    log.showGreen(logTag, 'startAt', dayjs().format())
    if (testMode) {
        log.showYellow(logTag, `[DRY RUN], no thumbs generated.`)
    } else {
        const results = await pMap(tasks, compressImage, { concurrency: cpus().length / 2 });
        const done = results.filter(t => t?.done);
        log.showGreen(logTag, `${done.length} thumbs generated in ${helper.humanTime(startMs)}`)
        if (deleteSrc) {
            await deleteSrcExists(results);
        }
    }
    log.showGreen(logTag, 'endAt', dayjs().format(), helper.humanTime(startMs))

}

async function deleteSrcExists(results) {
    const logTag = "deleteSrc";
    const toDelete = results.filter(t => t?.src && t.dstExists && t.dst);
    const total = toDelete?.length ?? 0;
    if (total <= 0) {
        return;
    }
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to delete ${total} original files?}`
            ),
        },
    ]);
    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.");
        return;
    }
    const deletecFunc = async (index, td) => {
        const srcExists = await fs.pathExists(td.src);
        const dstExists = await fs.pathExists(td.dst);
        // 确认文件存在，确保不会误删除
        if (!(srcExists && dstExists)) {
            return;
        }
        await helper.safeRemove(td.src);
        log.showYellow(logTag, `${index}/${total}`, `${helper.pathShort(td.src)} SAFE_DEL`);
        log.fileLog(`SafeDel: <${td.dst}>`, logTag);
        return td.src;
    }
    const deleted = await pMap(toDelete, deletecFunc, { concurrency: cpus().length * 8 })
    // for (const [index, td] of toDelete.entries()) {
    //     const srcExists = await fs.pathExists(td.src);
    //     const dstExists = await fs.pathExists(td.dst);
    //     // 确认文件存在，确保不会误删除
    //     if (srcExists && dstExists) {
    //         await helper.safeRemove(td.src);
    //         log.showYellow(logTag, `${index}/${total}`, `${helper.pathShort(td.src)} REMOVED::SAFE`);
    //         log.fileLog(`SafeDel: <${td.dst}>`, logTag);
    //     }
    // }
    log.showCyan(logTag, `${deleted.filter(Boolean).length} files are safe removed`);

}

// 文心一言注释 20231206
// 准备压缩图片的参数，并进行相应的处理  
async function preCompress(f, options = {}) {
    const logTag = 'preCompress'
    // log.debug("prepareCompressArgs options:", options); // 打印日志，显示选项参数  
    const maxWidth = options.maxWidth || 6000; // 获取最大宽度限制，默认为6000  
    let fileSrc = path.resolve(f.path); // 解析源文件路径  
    const [dir, base, ext] = helper.pathSplit(fileSrc); // 将路径分解为目录、基本名和扩展名  
    let fileDst = path.join(dir, `${base}_Z4K.jpg`); // 构建目标文件路径，添加压缩后的文件名后缀  
    fileSrc = path.resolve(fileSrc); // 解析源文件路径（再次确认）  
    fileDst = path.resolve(fileDst); // 解析目标文件路径（再次确认）  

    const timeNow = Date.now();
    if (timeNow - walkLastUpdatedAt > 2 * 1000) {
        needBar && bar1.update(f.index);
        walkLastUpdatedAt = timeNow;
    }

    if (await fs.pathExists(fileDst)) {
        // 如果目标文件已存在，则进行相应的处理  
        log.info(logTag, "exists:", fileDst);
        return {
            ...f,
            width: 0,
            height: 0,
            src: fileSrc,
            dst: fileDst,
            dstExists: true,
            shouldSkip: true,
            skipReason: 'EXISTS',
        };
    }
    try {
        const st = await fs.stat(fileSrc);
        const m = await sharp(fileSrc).metadata();
        try {
            if (m?.exif) {
                const md = exif(m.exif)?.Image;
                if (md && (md.Copyright?.includes("mediac")
                    || md.Software?.includes("mediac")
                    || md.Artist?.includes("mediac"))
                    || md.XPComment?.includes("mediac")) {
                    log.info(logTag, "skip:", fileDst);
                    return {
                        ...f,
                        width: 0,
                        height: 0,
                        src: fileSrc,
                        dst: fileDst,
                        shouldSkip: true,
                        skipReason: 'MEDIAC',
                    };
                }
            }
        } catch (error) {
            log.warn(logTag, "exif", error.message, fileSrc);
            log.fileLog(`ExifErr: <${fileSrc}> ${error.message}`, logTag);
        }

        const nw =
            m.width > m.height ? maxWidth : Math.round((maxWidth * m.width) / m.height);
        const nh = Math.round((nw * m.height) / m.width);

        const dw = nw > m.width ? m.width : nw;
        const dh = nh > m.height ? m.height : nh;
        if (f.total < 9999) {
            log.show(logTag, `${f.index}/${f.total}`,
                helper.pathShort(fileSrc),
                `(${m.width}x${m.height} => ${dw}x${dh}) ${m.format} ${helper.humanSize(st.size)}`
            );
        }
        log.fileLog(`Pre: ${f.index}/${f.total} <${fileSrc}> ` +
            `${dw}x${dh}) ${m.format} ${helper.humanSize(st.size)}`, logTag);
        return {
            ...f,
            width: dw,
            height: dh,
            src: fileSrc,
            dst: fileDst,
        };
    } catch (error) {
        log.warn(logTag, "sharp", error.message, fileSrc);
        log.fileLog(`SharpErr: ${f.index} <${fileSrc}> sharp:${error.message}`, logTag);
    }
}