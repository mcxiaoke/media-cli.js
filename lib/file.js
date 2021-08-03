const util = require("util");
const fsWalk = require("@nodelib/fs.walk");
const log = require("./debug");
const helper = require("./helper");
const cpuCount = require("os").cpus().length;

async function walk(root, options) {
  options = options || {};
  const startMs = Date.now();
  log.info("walk: Root", root, options);
  // https://www.npmjs.com/package/@nodelib/fs.walk
  // walk 31245 files in 31 seconds
  const files = await util.promisify(fsWalk.walk)(
    root,
    Object.assign(
      {
        stats: true,
        concurrency: 4 * cpuCount,
        followSymbolicLinks: false,
        throwErrorOnBrokenSymbolicLink: false,
        errorFilter: (error) => error.code == "ENOENT",
        entryFilter: (entry) => entry.stats.isFile(),
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
    log.debug(
      "walk: Item",
      i + 1,
      helper.pathShort(f.path),
      helper.fileSize(f.stats.size)
    );
  }
  log.info(
    "walk: Result",
    `total ${files.length} files found in ${helper.humanTime(startMs)}`
  );
  return files;
}

module.exports.walk = walk;
