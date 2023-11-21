import path from "path";
import { promisify } from "util";
import { walk as __walk } from "@nodelib/fs.walk";
import fs from 'fs-extra';
import { fdir } from "fdir";
import * as logger from "./debug.js";
import { pathShort, fileSizeSI, humanTime } from "./helper.js";
import { cpus } from "os";
const cpuCount = cpus().length;

async function walkOld(root, options) {
  options = options || {};
  const startMs = Date.now();
  logger.debug("walk:", root, "entryFilter:", String(options.entryFilter));
  // https://www.npmjs.com/package/@nodelib/fs.walk
  // walk 31245 files in 31 seconds
  const filter = (entry) => entry.stats.isFile();
  let files = await promisify(__walk)(
    root,
    Object.assign(
      {
        stats: true,
        concurrency: 4 * cpuCount,
        followSymbolicLinks: false,
        throwErrorOnBrokenSymbolicLink: false,
        errorFilter: (error) => error.code == "ENOENT",
        entryFilter: options.entryFilter || filter,
      },
      options
    )
  );
  // append index always
  if (options.withIndex || true) {
    files.forEach(function (value, i) {
      value.index = i;
    });
  }

  // https://www.npmjs.com/package/readdirp
  // walk 31245 files in 30 seconds
  // const files = await readdirp.promise(root, {
  //   fileFilter: options.fileFilter || options.entryFilter || Boolean,
  //   type: "files",
  //   alwaysStat: true,
  // });
  for (const [i, f] of files.entries()) {
    logger.debug(
      "walk: Item",
      i + 1,
      pathShort(f.path),
      fileSizeSI(f.stats.size)
    );
  }
  logger.info(
    "walk:",
    `total ${files.length} files found in ${humanTime(startMs)}`
  );
  return files;
}

async function walk(root, options) {
  options = options || {};
  const walkFilter = options.entryFilter || ((entry) => entry.stats.isFile());
  const startMs = Date.now();
  logger.info("walk:", root, "options:", options);
  const statsMap = new Map();
  const crawler = new fdir()
    .withFullPaths()
    .withMaxDepth(6)
    .filter((fPath, isDir) => {
      const st = fs.statSync(fPath);
      statsMap.set(fPath, st);
      const entry = {
        name: path.basename(fPath),
        path: fPath,
        dirent: null,
        stats: st
      }
      return walkFilter(entry);
    }).crawl(root);
  const files = await crawler.withPromise();
  const results = files.map((v, i) => { return { name: path.basename(v), path: v, index: i, stats: statsMap.get(v) } });
  for (const [i, f] of results.entries()) {
    logger.debug(
      "walk: Item",
      i + 1,
      pathShort(f.path)
    );
  }
  logger.info(
    "walk:",
    `total ${files.length} files found in ${humanTime(startMs)}`
  );
  return results;
}

async function walkDir(root) {
  const startMs = Date.now();
  logger.info("walkDir:", root);
  const crawler = new fdir()
    .withFullPaths()
    .withMaxDepth(6)
    .onlyDirs() // ignore files
    .crawl(root);
  const filenames = await crawler.withPromise();
  logger.info(
    "walkDir:",
    `total ${filenames.length} files found in ${humanTime(startMs)}`
  );
  return filenames;
}

const _walk = walk;
const _walkDir = walkDir;
export { _walk as walk, _walkDir as walkDir };
