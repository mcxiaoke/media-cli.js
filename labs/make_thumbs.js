import assert from "assert";
import chalk from 'chalk';
import fs from 'fs-extra';
import inquirer from 'inquirer';
import { cpus } from "os";
import pMap from 'p-map';
import path from 'path';
import prettyerror from "pretty-error";
import sharp from 'sharp';
const cpuCount = cpus().length;

import * as log from "../lib/debug.js";
import * as mf from "../lib/file.js";
import * as helper from "../lib/helper.js";

// debug and logging config
const prettyError = prettyerror.start();
prettyError.skipNodeFiles();

log.setLevel(1);

async function makeThumbOneWithArgs(args) {
  return await makeThumbOne(...args)
}

async function makeThumbOne(fileSrc, fileDst, maxSize) {
  log.debug("makeThumb =>", fileSrc, fileDst);
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
      log.info("makeThumb copy:", fileSrc);
      // just copy original file
      await fs.copyFile(fileSrc, fileDst)
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

  // https://stackoverflow.com/questions/2851308
  // don't use g flag
  const RE_THUMB = /(精选|小图|web|thumb)/i;
  log.info("makeThumbs input:", root);
  const walkOpts = {
    entryFilter: (f) =>
      f.stats.isFile() &&
      f.stats.size > 100 * 1024 &&
      helper.isImageFile(f.path) &&
      !RE_THUMB.test(path.resolve(f.path)),
  };
  let files = await mf.walk(root, walkOpts);
  log.info("makeThumbs", `total ${files.length} found`);
  //files = files.filter(f => !RE_THUMB.test(f.path))
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
    // let thumbDir = path.join(path.dirname(dir), path.basename(dir) + '_Thumbs');
    let thumbDir = dir.replace(/(JPEG|Photos)/i, 'Thumbs');
    thumbDir = thumbDir.replace('相机照片', '相机小图');
    thumbDir = thumbDir.replace('H:\\', 'E:\\Temp\\')
    if (!await fs.pathExists(thumbDir)) {
      await fs.mkdirp(thumbDir)
    }
    const fileDst = path.join(thumbDir, `${base}_thumb.jpg`);
    if (await fs.pathExists(fileDst)) {
      continue;
    }
    log.info("makeThumbs", `add ${f.path}`);
    if (RE_THUMB.test(fileSrc)) {
      log.showYellow("makeThumbs", `error ${f.path}`);
    }
    tasks.push([fileSrc, fileDst, maxSize]);
  }

  if (tasks.length == 0) {
    log.showYellow("No tasks, nothing to do, abort.");
    return;
  }
  log.info("makeThumbs", `total ${tasks.length} tasks`);

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to make thumbs for ${tasks.length}/${files.length} files?`
      ),
    },
  ]);
  if (!answer.yes) {
    log.showYellow("Will do nothing, aborted by user.");
    return;
  }
  // make thumb
  const result = await pMap(tasks, makeThumbOneWithArgs, { concurrency: cpuCount });
}

async function main() {
  await makeThumbs(process.argv.slice(2)[0]);
}

main();
