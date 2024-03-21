#!/usr/bin/env node
import chalk from 'chalk';
import { $ } from 'execa';
import fs from 'fs-extra';
import iconv from "iconv-lite";
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import sharp from "sharp";
import which from "which";

import dayjs from 'dayjs';
import * as log from '../lib/debug.js';
import * as helper from '../lib/helper.js';
// https://day.js.org/docs/zh-CN/display/format
const DATE_FORMAT = 'YYYY-MM-DD HH:mm:ss.SSS Z';

async function renameOneFile(f) {
    // 生成输出文件的路径  
    const outPath = path.join(path.dirname(f.path), f.outName);
    // 如果输出文件名不存在或者输入文件路径等于输出文件路径，忽略该文件并打印警告信息  
    if (!f.outName || f.path == f.outPath) {
        log.showYellow("Rename", "ignore", f.path);
        return;
    }
    try {
        // 使用 fs 模块的 rename 方法重命名文件，并等待操作完成  
        await fs.rename(f.path, outPath);
        // 打印重命名成功的日志信息，显示输出文件的路径  
        log.show(`${chalk.green(`Renamed:`)} ${outPath}`);
        log.fileLog(`Done: ${f.path} => ${f.outName}`, "Rename");
        return f;
    } catch (error) {
        // 捕获并打印重命名过程中出现的错误信息，显示错误原因和输入文件的路径  
        log.error("Rename", error, f.path);
        log.fileLog(`Error: ${f.path} Error: ${error}`, "Rename");
    }
}

// 这个函数是一个异步函数，用于重命名文件  
export async function renameFiles(files) {
    // 打印日志信息，显示要重命名的文件总数  
    log.info("Rename", `total ${files.length} files prepared`);
    const results = await pMap(files, renameOneFile, { concurrency: cpus().length * 4 });
    const allCount = results.length;
    const okCount = results.filter(Boolean);
    log.info("Rename", `total ${okCount}/${allCount} files renamed`);
    return results;
}

function fixEncoding(str = '') {
    return iconv.decode(Buffer.from(str, 'binary'), 'cp936');
}

const fixedOkStr = iconv.decode(Buffer.from('OK'), 'utf8')
async function compressHEIF(t) {
    const logTag = "Compress[HEIF]"
    log.info(logTag, "processing", t)
    if (!helper.isHEVCImage(t.src)) {
        return;
    }
    const exePath = await which("nconvert", { nothrow: true })
    if (!exePath) {
        log.warn(logTag, "nconvert executable not in path")
        return
    }

    const fileSrc = t.src
    const dstName = path.basename(t.dst)
    try {
        const { stderr } = await $({ encoding: 'binary' })`${exePath} -overwrite -opthuff -no_auto_ext -out jpeg -o ${dstName} -q ${t.quality} -resize longest ${t.width} ${fileSrc}`;
        const sr = fixEncoding(stderr)
        log.info(logTag, "stderr", sr)
        // strange fix for encoding str compare
        if (sr.endsWith(fixedOkStr)) {
            log.show(logTag, `${helper.pathShort(fileSrc)} => ${dstName}`)
            log.fileLog(`${fileSrc} => ${dstName}`, logTag);
            return {
                width: t.width,
                height: t.height,
                format: 'jpeg'
            }
        }
    } catch (error) {
        log.error(logTag, error)
    }
}

function getDirPrefix(fileSrc, sep) {
    // Others\Images\COSPLAY\Dami\图片\
    const dirParts = path.dirname(fileSrc).split(path.sep).slice(-3).join("");
    return dirParts.replaceAll(/图片|视频|Image|Video/gi, "");
}

// 这是一个异步函数，用于创建缩略图  
export async function compressImage(t) {
    const logTag = "Compress";
    const prefix = getDirPrefix(t.src);
    // 如果目标文件已存在，且有删除未压缩文件标志
    // 则不进行压缩处理，添加标志后返回
    if (t.shouldSkip) {
        log.show(logTag, `${t.index}/${t.total}`, helper.pathShort(t.dst), chalk.yellow(`SKIP::${t.skipReason}`));
        log.fileLog(`${t.index}/${t.total} <${t.src}> => ${path.basename(t.dst)} SKIP::${t.skipReason}`, logTag);
        return t;
    }
    // 试图确保目标文件目录存在，如果不存在则创建  
    try {
        await fs.ensureDir(path.dirname(t.dst));
        let r = await compressHEIF(t);
        if (!r) {
            // 初始化一个sharp对象，用于图像处理  
            // 尝试读取源图像文件  
            const s = sharp(t.src);
            // 对图像进行重新调整尺寸，设置宽度为 t.width，保持原始宽高比  
            // 同时应用质量为 t.quality（默认值为86）的JPEG压缩，并使用"4:4:4"的色度子采样  
            r = await s
                .resize({ width: t.width })
                .withMetadata()
                .withExifMerge({
                    IFD0: {
                        ImageDescription: `${prefix} ${dayjs().format(DATE_FORMAT)}`,
                        Copyright: `${dayjs().format(DATE_FORMAT)} mediac`,
                        Artist: "mediac",
                        Software: "nodejs.cli.mediac",
                        XPSubject: prefix,
                        XPTitle: path.basename(t.src),
                        XPComment: `${dayjs().format(DATE_FORMAT)} mediac`,
                        XPAuthor: "mediac",
                    }
                })
                .jpeg({ quality: t.quality || 86, chromaSubsampling: "4:4:4" })
                // 将处理后的图像保存到目标文件  
                .toFile(t.dst);
            // 获取目标文件的文件信息 
        }
        const fst = await fs.stat(t.dst);
        // 显示创建的缩略图的相关信息（包括路径、尺寸和文件大小）  
        log.showGreen(logTag, `${t.index}/${t.total}`, helper.pathShort(t.dst), `${r.width}x${r.height}`, `${helper.humanSize(fst.size)}`);
        // 如果目标文件大小小于100KB，则可能文件损坏，删除该文件  
        // file may be corrupted, del it  
        if (fst.size < 100 * 1024) {
            await helper.safeRemove(t.dst);
            log.showYellow(logTag, `dst too small, del ${t.dst} ${t.index}/${t.total}`);
        }
        t.dstExists = await fs.pathExists(t.dst);
        t.dstExists && log.fileLog(`<${t.src}> => ${path.basename(t.dst)} ${helper.humanSize(fst.size)}`, logTag);
        // 返回处理后的图像信息对象  
        t.done = true;
        return t;
    } catch (error) {
        // 如果在处理过程中出现错误，则捕获并处理错误信息  
        log.error(logTag, `error on '${t.src} ${t.index}'`, error);
        try { // 尝试删除已创建的目标文件，防止错误文件占用空间  
            await helper.safeRemove(t.dst);
        } catch (error) { } // 忽略删除操作的错误，不进行额外处理  
    }
} // 结束函数定义