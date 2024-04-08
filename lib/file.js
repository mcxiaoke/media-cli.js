/*
 * File: file.js
 * Created: 2021-07-23 11:56:40
 * Modified: 2024-03-23 11:52:28
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import * as cliProgress from "cli-progress";
import { fdir } from "fdir";
import fs from 'fs-extra';
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import { comparePathSmart, compareSmart } from './core.js';
import * as log from "./debug.js";
import { humanTime, pathShort } from "./helper.js";

async function walkUseFdir(root, withDirs = false, withFiles = false) {
  const fd = new fdir()
  if (withDirs) {
    if (withFiles) {
      fd.withDirs();
    } else {
      fd.onlyDirs();
    }
  }
  fd.withErrors();
  const crawler = fd.withErrors().withFullPaths().crawl(root);
  return (await crawler.withPromise()).sort(comparePathSmart);
}

let walkLastUpdatedAt = 0;
// 异步函数 walk(root, options) 从指定的根目录开始遍历目录，返回一个包含遍历结果的对象数组  
export async function walk(root, options = {}) {
  const logTag = "walk";
  const entryFilter = options.entryFilter || Boolean;
  log.info(logTag, root, "options:", options);
  const initMs = Date.now();
  let startMs = Date.now();
  let files = await walkUseFdir(root, options.withDirs, options.withFiles);
  log.info(
    logTag,
    `Total ${files.length} entries found in ${humanTime(startMs)} `
  );
  const needBar = files.length > 9999 && !log.isVerbose();
  const bar1 = new cliProgress.SingleBar({ etaBuffer: 300 }, cliProgress.Presets.shades_classic);
  needBar && bar1.start(files.length, 0);
  const entryMapper = async (fpath, index) => {
    try {
      const st = options.needStats ? (await fs.stat(fpath)) : {};
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
        st,
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
        pathShort(fpath)
      );
      throw error;
    }
  }
  startMs = Date.now();
  files = (await pMap(files, entryMapper, { concurrency: cpus().length * 4 }));
  needBar && bar1.update(files.length);
  needBar && bar1.stop();
  log.debug(
    logTag,
    `${files.length} files mapped in ${humanTime(startMs)}`
  );
  startMs = Date.now();
  files = files.filter(entry => entry && entryFilter(entry));
  log.info(
    logTag,
    `total ${files.length} filterred files in ${humanTime(initMs)}.`
  );
  return files;
}
