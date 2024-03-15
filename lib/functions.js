#!/usr/bin/env node
import path from "path";
import fs from 'fs-extra';
import pMap from 'p-map';
import chalk from 'chalk';
import * as log from '../lib/debug.js'

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
    const results = await pMap(files, renameOneFile, { concurrency: cpuCount * 4 });
    const allCount = results.length;
    const okCount = results.filter(Boolean);
    log.info("Rename", `total ${okCount}/${allCount} files renamed`);
    return results;
}