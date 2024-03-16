#!/usr/bin/env node
import path from "path";
import fs from 'fs-extra';
import sharp from "sharp";
import { cpus } from "os";
import pMap from 'p-map';
import chalk from 'chalk';

import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'

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
        log.show(chalk.green(`Renamed:`) + ` ${outPath}`);
        return f;
    } catch (error) {
        // 捕获并打印重命名过程中出现的错误信息，显示错误原因和输入文件的路径  
        log.error("Rename", error, f.path);
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

// 文心一言注释
// 这是一个异步函数，用于创建缩略图  
export async function makeThumbOne(t) {
    // 试图确保目标文件目录存在，如果不存在则创建  
    try {
        await fs.ensureDir(path.dirname(t.dst));
        // 初始化一个sharp对象，用于图像处理  
        // 尝试读取源图像文件  
        const s = sharp(t.src);
        // 对图像进行重新调整尺寸，设置宽度为 t.width，保持原始宽高比  
        // 同时应用质量为 t.quality（默认值为86）的JPEG压缩，并使用"4:4:4"的色度子采样  
        const r = await s
            .resize({ width: t.width })
            .withMetadata()
            .jpeg({ quality: t.quality || 86, chromaSubsampling: "4:4:4" })
            // 将处理后的图像保存到目标文件  
            .toFile(t.dst);
        // 获取目标文件的文件信息  
        const fst = await fs.stat(t.dst);
        // 显示创建的缩略图的相关信息（包括路径、尺寸和文件大小）  
        log.showGreen("makeThumb", helper.pathShort(t.dst), `${r.width}x${r.height}`, `${helper.fileSizeSI(fst.size)}`, `${t.index}/${t.total}`);
        // 如果目标文件大小小于100KB，则可能文件损坏，删除该文件  
        // file may be corrupted, del it  
        if (fst.size < 100 * 1024) {
            await fs.remove(t.dst);
            log.showRed("makeThumb", `file too small, del ${t.dst} ${t.index}/${t.total}`);
        } else if (t.deleteOriginal) {
            try {
                await helper.safeRemove(t.src);
                log.showGray("makeThumb del:", helper.pathShort(t.src));
            } catch (error) {
                log.error("makeThumb", "del error", error);
            }
        }
        return r; // 返回处理后的图像信息对象  
    } catch (error) {
        // 如果在处理过程中出现错误，则捕获并处理错误信息  
        log.error("makeThumb", `error on '${t.src} ${t.index}'`, error);
        try { // 尝试删除已创建的目标文件，防止错误文件占用空间  
            await fs.remove(t.dst);
        } catch (error) { } // 忽略删除操作的错误，不进行额外处理  
    }
} // 结束函数定义