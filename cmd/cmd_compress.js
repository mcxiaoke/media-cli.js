#!/usr/bin/env node
import assert from "assert";
import dayjs from "dayjs";
import inquirer from "inquirer";
import pMap from 'p-map';
import sharp from "sharp";
import path from "path";
import fs from 'fs-extra';
import chalk from 'chalk';
import yargs from "yargs";
import { cpus } from "os";
import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'

export { command, aliases, describe, builder, handler }

const command = "compress <input> [output]"
const aliases = ["cs", "cps"]
const describe = 'Compress input images to target size'


const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("delete", {
        alias: "d",
        type: "boolean",
        default: false,
        description: "Delete original image file",
    })
        // 压缩后文件质量参数  
        .option("quality", {
            alias: "q",
            type: "number",
            default: 88,
            description: "Target image file compress quality",
        })
        // 需要处理的最小文件大小
        .option("size", {
            alias: "s",
            type: "number",
            default: 2048,
            description: "Processing file bigger than this size (unit:k)",
        })
        // 需要处理的图片最小尺寸
        .option("width", {
            alias: "w",
            type: "number",
            default: 6000,
            description: "Max width of long side of image thumb",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "not-dry-run",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = async function cmdCompress(argv) {
    const root = path.resolve(argv.input);
    assert.strictEqual("string", typeof root, "root must be string");
    if (!root || !(await fs.pathExists(root))) {
        log.error("cmdCompress", `Invalid Input: '${root}'`);
        throw new Error("Invalid Input: " + root);
    }
    log.show('cmdCompress', argv);
    const testMode = !argv.doit;
    const force = argv.force || false;
    const quality = argv.quality || 88;
    const minFileSize = (argv.size || 2048) * 1024;
    const maxWidth = argv.width || 6000;
    const deleteOriginal = argv.delete || false;
    log.show(`cmdCompress: input:`, root);

    const RE_THUMB = /(Z4K|feature|web|thumb)/i;
    const walkOpts = {
        entryFilter: (f) =>
            f.stats.isFile()
            && f.stats.size > minFileSize
            && helper.isImageFile(f.path)
            && !RE_THUMB.test(f.path)
    };
    let files = await mf.walk(root, walkOpts);
    log.show("cmdCompress", `total ${files.length} files found (all)`);
    files = files.filter(f => !RE_THUMB.test(f.path));
    log.show("cmdCompress", `total ${files.length} files found (filtered)`);
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

    const conditions = {
        maxWidth: maxWidth,
        force: force,
        deleteOriginal: deleteOriginal
    };
    const prepareFunc = async f => {
        return prepareCompressArgs(f, conditions)
    }
    let tasks = await pMap(files, prepareFunc, { concurrency: cpus().length })

    log.debug("cmdCompress before filter: ", tasks.length);
    const total = tasks.length;
    tasks = tasks.filter((t) => t && t.dst);
    const skipped = total - tasks.length;
    log.debug("cmdCompress after filter: ", tasks.length);
    if (skipped > 0) {
        log.showYellow(`cmdCompress: ${skipped} thumbs skipped`)
    }
    if (tasks.length == 0) {
        log.showYellow("Nothing to do, abort.");
        return;
    }
    tasks.forEach(t => {
        t.total = tasks.length;
        t.quality = quality || 88;
        t.deleteOriginal = deleteOriginal || false;
    });
    log.show(`cmdCompress: task sample:`, tasks.slice(-2))
    log.showYellow("cmdCompress:", argv);
    testMode && log.showGreen("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                `Are you sure to compress ${tasks.length} files? \n[Apply to files bigger than ${minFileSize / 1024}K, and max long side is ${maxWidth}] \n${deleteOriginal ? "(Attention: you choose to delete original file!)" : "(Will keep original file)"}`
            ),
        },
    ]);

    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.");
        return;
    }

    const startMs = Date.now();
    log.showGreen('cmdCompress: startAt', dayjs().format())
    const result = await pMap(tasks, makeThumbOne, { concurrency: cpus().length / 2 + 1 });
    log.showGreen('cmdCompress: endAt', dayjs().format())
    log.showGreen(`cmdCompress: ${result.length} thumbs generated in ${helper.humanTime(startMs)}`)
}

// 文心一言注释 20231206
// 准备压缩图片的参数，并进行相应的处理  
async function prepareCompressArgs(f, options) {
    options = options || {};
    // log.show("prepareCompressArgs options:", options); // 打印日志，显示选项参数  
    const maxWidth = options.maxWidth || 4000; // 获取最大宽度限制，默认为4000  
    const force = options.force || false; // 获取强制压缩标志位，默认为false  
    const deleteOriginal = options.deleteOriginal || false; // 获取删除原文件标志位，默认为false  
    let fileSrc = path.resolve(f.path); // 解析源文件路径  
    const [dir, base, ext] = helper.pathSplit(fileSrc); // 将路径分解为目录、基本名和扩展名  
    let fileDst = path.join(dir, `${base}_Z4K.jpg`); // 构建目标文件路径，添加压缩后的文件名后缀  
    fileSrc = path.resolve(fileSrc); // 解析源文件路径（再次确认）  
    fileDst = path.resolve(fileDst); // 解析目标文件路径（再次确认）  

    if (await fs.pathExists(fileDst)) { // 如果目标文件已存在，则进行相应的处理  
        log.info("prepareCompress exists:", fileDst, force ? "(Override)" : ""); // 打印日志，显示目标文件存在的情况，以及是否进行覆盖处理  
        if (deleteOriginal) { // 如果设置了删除原文件标志位  
            await helper.safeRemove(fileSrc); // 删除源文件，并打印日志  
            log.showYellow('prepareCompress exists, delete', helper.pathShort(fileSrc)); // 打印日志，显示删除源文件信息，并以黄色字体显示警告信息  
        }
        if (!force) { // 如果未设置强制标志位，则直接返回（不再进行后续处理）  
            return;
        }
    }
    try { // 尝试执行后续操作，可能会抛出异常  
        const s = sharp(fileSrc); // 使用sharp库对源文件进行处理，返回sharp对象实例  
        const m = await s.metadata(); // 获取源文件的元数据信息（包括宽度和高度）  
        const nw = // 计算新的宽度，如果原始宽度大于高度，则使用最大宽度限制；否则按比例计算新的宽度  
            m.width > m.height ? maxWidth : Math.round((maxWidth * m.width) / m.height);
        const nh = Math.round((nw * m.height) / m.width); // 计算新的高度，按比例计算新的高度  

        const dw = nw > m.width ? m.width : nw; // 计算最终输出的宽度，如果新的宽度大于原始宽度，则使用原始宽度；否则使用新的宽度  
        const dh = nh > m.height ? m.height : nh; // 计算最终输出的高度，按比例计算最终输出高度，如果新的高度大于原始高度，则使用原始高度；否则使用新的高度  
        log.show(// 打印日志，显示压缩后的文件信息  
            "prepareCompress:",
            helper.pathShort(fileDst),
            `(${m.width}x${m.height} => ${dw}x${dh})`
        );
        return { // 返回压缩后的参数对象，包括输出文件的宽度、高度、源文件路径、目标文件路径以及索引信息等属性  
            width: dw,
            height: dh,
            src: fileSrc,
            dst: fileDst,
            index: f.index,
        };
    } catch (error) {
        log.error("prepareCompress error:", error, fileSrc);
    }
}