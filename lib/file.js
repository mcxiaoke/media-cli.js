import { fdir } from "fdir";
import fs from 'fs-extra';
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import * as logger from "./debug.js";
import { humanTime, pathShort } from "./helper.js";
;

async function parallel(arr, fn, threads = 2) {
  const result = [];
  while (arr.length) {
    const res = await Promise.all(arr.splice(0, threads).map(x => fn(x)));
    result.push(res);
  }
  return result.flat();
}

// 注释由文心一言生成 20231206
// 异步函数 walk(root, options) 从指定的根目录开始遍历目录，返回一个包含遍历结果的对象数组  
async function walk(root, options) {
  // options 为可选参数，若未传入，则使用空对象作为默认值  
  options = options || {};
  // 定义一个过滤器，用于判断是否为文件，默认为判断是否为文件文件  
  const walkFilter = options.entryFilter || ((entry) => entry.stats.isFile());
  // 记录开始时间  
  const startMs = Date.now();
  // 打印日志，显示正在遍历的根目录和选项  
  logger.debug("walk:", root, "options:", options);
  // 创建一个 fdir 对象，用于遍历目录  
  const crawler = new fdir()
    .withErrors()
    // 开启 fdir 的全路径模式  
    .withFullPaths()
    // 设置遍历的最大深度为8  
    .withMaxDepth(8)
    // 开始遍历指定的根目录 
    .crawl(root);
  // 使用 Promise 等待遍历完成，获取遍历结果的文件或目录数组  
  let allFiles = (await crawler.withPromise()).sort();
  const entryMapper = async (fPath, index) => {
    try {
      const st = await fs.stat(fPath); // 获取文件或目录的元信息  
      // 定义一个对象，包含文件或目录的基本信息  
      const entry = {
        root: root,
        name: path.basename(fPath), // 文件或目录的名称  
        path: fPath, // 文件或目录的路径  
        dirent: null, // 当前未知的信息，此处为 null  
        stats: st, // 文件或目录的元信息  
        index: index,
      }
      return entry;
    } catch (error) {
      logger.warn(
        "walk: filter error",
        error,
        pathShort(fPath)
      );
      return null;
    }
  }
  // 获取文件元数据，转换为entry对象 
  // 只有满足 walkFilter 的文件或目录才会被继续遍历  
  // return walkFilter(entry);
  const files = (await pMap(allFiles, entryMapper, { concurrency: cpus().length * 4 }));
  const results = files.filter(entry => entry && walkFilter(entry));
  // 打印日志，显示每个遍历到的文件或目录的信息  
  for (const [i, entry] of results.entries()) {
    // 打印 "walk: Item" 后跟索引值和文件或目录的短路径  
    logger.debug(
      "walk: Item",
      i + 1,
      entry.index + 1,
      pathShort(entry.path),
      entry.stats.size,
    );
  }
  // 打印日志，显示总共找到了多少个文件以及耗时  
  logger.debug(
    "walk:", // 打印 "walk:" 后跟总文件数和耗时信息  
    `total ${results.length} files found in ${humanTime(startMs)}`
    // 总文件数为 results.length，
    // 耗时为 humanTime(startMs) 返回的易读时间字符串  
  );
  // 返回遍历结果的对象数组  
  return results;
}

// 注释由文心一言生成 20231206
// 异步函数 walkDir(root) 用于从指定的根目录开始递归遍历目录，返回一个包含遍历结果的文件名的数组  
async function walkDir(root) {
  // 记录开始时间  
  const startMs = Date.now();
  // 打印日志，显示正在遍历的根目录  
  logger.info("walkDir:", root);
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
  logger.debug(
    "walkDir:", // 打印 "walkDir:" 后跟总文件数和耗时信息  
    `total ${dirPaths.length} files found in ${humanTime(startMs)}` // 总文件数为 filenames.length，耗时为 humanTime(startMs) 返回的易读时间字符串  
  );
  // 返回遍历结果的文件名数组  
  return dirPaths;
}

const _walk = walk;
const _walkDir = walkDir;
export { _walk as walk, _walkDir as walkDir };
