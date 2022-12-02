import { promisify } from "util";
import { walk as __walk } from "@nodelib/fs.walk";
import * as logger from "./debug.js";
import { pathShort, fileSizeSI, humanTime } from "./helper.js";
import { cpus } from "os";
const cpuCount = cpus().length;

async function walk(root, options) {
  options = options || {};
  const startMs = Date.now();
  logger.debug("walk:", root, "entryFilter:", String(options.entryFilter));
  // https://www.npmjs.com/package/@nodelib/fs.walk
  // walk 31245 files in 31 seconds
  const filter = (entry) => entry.stats.isFile();
  const files = await promisify(__walk)(
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

const _walk = walk;
export { _walk as walk };
