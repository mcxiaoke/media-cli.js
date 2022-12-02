import sharp from 'sharp';
import dayjs from 'dayjs';
import path from 'path';
import fs from 'fs-extra';
import PQueue from 'p-queue';
import pMap from 'p-map';
import assert from "assert";
import prettyerror from "pretty-error";
import { cpus } from "os";
const cpuCount = cpus().length;

import * as helper from "../lib/helper.js";
import * as mf from "../lib/file.js";
import * as log from "../lib/debug.js";

// debug and logging config
const prettyError = prettyerror.start();
prettyError.skipNodeFiles();

//log.setLevel(9);

async function makeThumbOneWithArgs(args) {
  return await makeThumbOne(...args)
}

async function makeThumbOne(fileSrc, fileDst, maxSize) {
  //log.info("makeThumb =>", fileSrc, fileDst);
  if (await fs.pathExists(fileDst)) {
    log.info("makeThumb exists:", fileDst, force ? "(Override)" : "");
    if (!force) {
      return;
    }
  }
  try {
    const s = sharp(fileSrc);
    const m = await s.metadata();
    if (m.width <= maxSize && m.height <= maxSize) {
      log.debug("makeThumb skip:", fileSrc);
      return;
    }
    const nw =
      m.width > m.height
        ? maxSize
        : Math.round((maxSize * m.width) / m.height);
    console.debug(
      "makeThumb processing:",
      fileSrc,
      m.format,
      m.width,
      m.height,
      nw
    );
    const result = await s
      .resize({ width: nw })
      .withMetadata({
        exif: {
          IFD0: {
            Copyright: 'Make Thumbs Script',
          }
        }
      })
      .jpeg({ quality: 85, chromaSubsampling: "4:4:4" })
      .toFile(fileDst);
    log.showGreen("makeThumb done:", fileDst, result.width, result.height);
    return result
  } catch (error) {
    log.error("makeThumb error:", error, fileSrc);
  }
}

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

  const tasks = []
  // prepare thumb tasks
  for (const f of files) {
    const fileSrc = f.path;
    const [dir, base, ext] = helper.pathSplit(fileSrc);
    // const thumbDir = path.join(path.dirname(dir), path.basename(dir) + '_Thumbs');
    const thumbDir = dir.replace(/(JPEG|Photos)/i, 'Thumbs');
    if (!await fs.pathExists(thumbDir)) {
      await fs.mkdirp(thumbDir)
    }
    const fileDst = path.join(thumbDir, `${base}_thumb.jpg`);
    tasks.push([fileSrc, fileDst, maxSize]);
  }
  // make thumb
  const result = await pMap(tasks, makeThumbOneWithArgs, { concurrency: cpuCount - 2 });
}

async function main() {
  await makeThumbs(process.argv.slice(2)[0]);
}

main();
