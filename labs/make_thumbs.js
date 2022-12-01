const sharp = require("sharp");
const path = require("path");
const helper = require("../lib/helper");
const exif = require("../lib/exif");
const mf = require("../lib/file");
const fs = require("fs-extra");
const assert = require("assert");
const log = require("../lib/debug");
// debug and logging config
const prettyError = require("pretty-error").start();
prettyError.skipNodeFiles();

log.setLevel(9);

async function makeThumbs(root, options) {
  assert.equal("string", typeof root, "root must be string");
  options = options || {};
  const maxSize = options.maxSize || 3000;
  const force = options.force || false;

  const RE_THUMB = /(小图|精选|feature|web|thumb)/gi;
  log.info("makeThumbs input:", root);
  const walkOpts = {
    entryFilter: (f) =>
      f.stats.isFile() &&
      f.stats.size > 100 * 1024 &&
      helper.isImageFile(f.path) &&
      !RE_THUMB.test(f.path),
  };
  const files = await mf.walk(root, walkOpts);
  log.info("makeThumbs", `total ${files.length} found`);
  if (files.length == 0) {
    log.showYellow("No files, nothing to do, abort.");
    return;
  }

  for (const f of files) {
    const fileSrc = f.path;
    const [dir, base, ext] = helper.pathSplit(fileSrc);
    const fileDst = path.join(dir, `${base}_thumb.jpg`);
    if (await fs.pathExists(fileDst)) {
      log.info("makeThumbs exists:", fileDst, force ? "(Override)" : "");
      if (!force) {
        continue;
      }
    }
    try {
      const s = sharp(fileSrc);
      const m = await s.metadata();
      if (m.width <= maxSize && m.height <= maxSize) {
        log.debug("makeThumbs skip:", fileSrc);
        continue;
      }
      const nw =
        m.width > m.height
          ? maxSize
          : Math.round((maxSize * m.width) / m.height);
      console.debug(
        "makeThumbs processing:",
        fileSrc,
        m.format,
        m.width,
        m.height,
        nw
      );
      const result = await s
        .resize({ width: nw })
        .withMetadata()
        .jpeg({ quality: 85, chromaSubsampling: "4:4:4" })
        .toFile(fileDst);
      log.showGreen("makeThumbs done:", fileDst, result.width, result.height);
    } catch (error) {
      log.error("makeThumbs error:", error, f.path);
    }
  }
}

async function main() {
  await makeThumbs(process.argv.slice(2)[0]);
}

main();
