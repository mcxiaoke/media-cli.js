/*
 * File: file.js
 * Created: 2021-07-23 11:56:40
 * Modified: 2024-03-23 11:52:28
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */


import * as fsWalk from '@nodelib/fs.walk';
import * as cliProgress from "cli-progress";
import { fdir } from "fdir";
import fs from 'fs-extra';
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import { PathScurry } from 'path-scurry';
import { promisify } from 'util';
import { compareSmart } from './core.js';
import * as log from "./debug.js";
import { humanTime, pathShort } from "./helper.js";

async function walkUseFdir(root) {
  const crawler = new fdir()
    .withErrors()
    .withFullPaths()
    .crawl(root);
  return (await crawler.withPromise()).sort(compareSmart);
}

async function walkUsePathScurry(root) {
  const pw = new PathScurry(root)
  return (await pw.walk({
    withFileTypes: false,
    follow: false,
  })).sort(compareSmart);
}

// 异步函数 walk(root, options) 从指定的根目录开始遍历目录，返回一个包含遍历结果的对象数组  
export async function walkSimple(root, options = {}) {
  const logTag = "walk1";
  const walkFilter = options.entryFilter || Boolean;
  log.info(logTag, root, "options:", options);
  const initMs = Date.now();
  let startMs = Date.now();
  const walkAsync = promisify(fsWalk.walk)
  let files = await walkAsync(root, {
    stats: options.needStats || false,
    concurrency: Infinity,
  })
  files = files.sort(compareSmart)
  log.info(
    logTag,
    `total ${files.length} files found in ${humanTime(startMs)}`
  );
  const entryMapper = async (entry, index) => {
    return {
      ...entry,
      root,
      index
    }
  }
  startMs = Date.now();
  files = (await pMap(files, entryMapper, { concurrency: cpus().length * 2 }));
  // files = await Promise.all(files.map(entryMapper));
  log.debug(
    logTag,
    `${files.length} files mapped in ${humanTime(startMs)}`
  );
  startMs = Date.now();
  files = files.filter(entry => entry && walkFilter(entry));
  log.info(
    logTag,
    `total ${files.length} filterred files in ${humanTime(initMs)}.`
  );
  return files;
}

let walkLastUpdatedAt = 0;
// 异步函数 walk(root, options) 从指定的根目录开始遍历目录，返回一个包含遍历结果的对象数组  
export async function walk(root, options = {}) {
  const logTag = "walk2";
  const walkFilter = options.entryFilter || Boolean;
  log.info(logTag, root, "options:", options);
  const initMs = Date.now();
  let startMs = Date.now();
  let files = await walkUseFdir(root);
  log.info(
    logTag,
    `total ${files.length} files found in ${humanTime(startMs)}`
  );
  const needBar = files.length > 9999 && !log.isVerbose();
  const bar1 = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic);
  needBar && bar1.start(files.length, 0);
  const entryMapper = async (fpath, index) => {
    try {
      const st = (options.needStats || false) ? (await fs.stat(fpath)) : {};
      const entry = {
        root,
        name: path.basename(fpath),
        path: fpath,
        stats: st,
        index,
      };
      log.debug(
        logTag,
        entry.index,
        pathShort(entry.path),
        entry.stats?.size,
      );
      const timeNow = Date.now();
      if (timeNow - walkLastUpdatedAt > 2 * 1000) {
        needBar && bar1.update(index);
        walkLastUpdatedAt = timeNow;
      }
      return entry;
    } catch (error) {
      log.warn(
        logTag,
        error,
        pathShort(entry.path)
      );
    }
  }
  startMs = Date.now();
  files = (await pMap(files, entryMapper, { concurrency: cpus().length * 4 }));
  // files = files.sort(compareSmartBy('path'))
  needBar && bar1.update(files.length);
  needBar && bar1.stop();
  log.debug(
    logTag,
    `${files.length} files mapped in ${humanTime(startMs)}`
  );
  startMs = Date.now();
  files = files.filter(entry => entry && walkFilter(entry));
  log.info(
    logTag,
    `total ${files.length} filterred files in ${humanTime(initMs)}.`
  );
  return files;
}

// 异步函数 walkDir(root) 用于从指定的根目录开始递归遍历目录，返回一个包含遍历结果的文件名的数组  
export async function walkDir(root) {
  // 记录开始时间  
  const startMs = Date.now();
  // 打印日志，显示正在遍历的根目录  
  log.info("walkDir:", root);
  // 创建一个 fdir 对象，用于递归遍历目录  
  const crawler = new fdir()
    // 开启 fdir 的全路径模式  
    .withFullPaths()
    // 设置遍历的最大深度为8  
    .withMaxDepth(8)
    // 只遍历目录，忽略文件  
    .onlyDirs() // ignore files  
    // 开始遍历指定的根目录  
    .crawl(root);
  // 使用 Promise 等待遍历完成，获取遍历结果的文件名数组  
  const dirPaths = (await crawler.withPromise()).sort();
  // 打印日志，显示总共找到了多少个文件以及耗时  
  log.debug(
    "walkDir:", // 打印 "walkDir:" 后跟总文件数和耗时信息  
    `total ${dirPaths.length} files found in ${humanTime(startMs)}` // 总文件数为 filenames.length，耗时为 humanTime(startMs) 返回的易读时间字符串  
  );
  // 返回遍历结果的文件名数组  
  return dirPaths;
}
