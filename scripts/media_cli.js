#!/usr/bin/env node
import assert from "assert";
import dayjs from "dayjs";
import inquirer from "inquirer";
import throat from 'throat';
import pMap from 'p-map';
import sharp from "sharp";
import path from "path";
import fs from 'fs-extra';
import chalk from 'chalk';
import yargs from "yargs";
import PrettyError from 'pretty-error';
import { cpus } from "os";

import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'

const cpuCount = cpus().length;
// debug and logging config
const prettyError = PrettyError.start();
prettyError.skipNodeFiles();

const configCli = (argv) => {
  // log.setName("AudioCli");
  log.setLevel(argv.verbose);
  log.debug(argv);
};

const ya = yargs(process.argv.slice(2));
// https://github.com/yargs/yargs/blob/master/docs/advanced.md
ya
  .usage("Usage: $0 <command> <input> [options]")
  .positional("input", {
    describe: "Input folder that contains files",
    type: "string",
    normalize: true,
  })
  .command(
    ["test", "tt", "$0"],
    "Test command, do nothing",
    (ya) => {
      // yargs.option("output", {
      //   alias: "o",
      //   type: "string",
      //   normalize: true,
      //   description: "Output folder",
      // });
    },
    (argv) => {
      ya.showHelp();
    }
  )
  .command(
    ["rename <input> [options]", "rn"],
    "Rename media files in input dir by exif date",
    (ya) => {
      ya
        .option("backup", {
          alias: "b",
          type: "boolean",
          default: false,
          description: "backup original file before rename",
        })
        .option("fast", {
          alias: "f",
          type: "boolean",
          description: "fast mode (use file modified time, no exif parse)",
        })
        .option("prefix", {
          alias: "p",
          type: "string",
          default: "IMG_/DSC_/VID_",
          description: "custom filename prefix for raw/image/video files'",
        })
        .option("suffix", {
          alias: "s",
          type: "string",
          default: "",
          description: "custom filename suffix",
        })
        .option("template", {
          alias: "t",
          type: "string",
          default: "YYYYMMDD_HHmmss",
          description:
            "filename date format template, see https://day.js.org/docs/en/display/format",
        });
    },
    (argv) => {
      cmdRename(argv);
    }
  )
  .command(
    ["organize <input> [output]", "oz"],
    "Organize pictures by file modified date",
    (ya) => {
      // yargs.option("output", {
      //   alias: "o",
      //   type: "string",
      //   normalize: true,
      //   description: "Output folder",
      // });
    },
    (argv) => {
      cmdOrganize(argv);
    }
  )
  .command(
    ["lrmove <input> [output]", "lv"],
    "Move JPEG output of RAW files to other folder",
    (ya) => {
      // yargs.option("output", {
      //   alias: "o",
      //   type: "string",
      //   normalize: true,
      //   description: "Output folder",
      // });
    },
    (argv) => {
      cmdLRMove(argv);
    }
  )
  .command(
    ["thumbs <input> [output]", "tb"],
    "Make thumbs for input images",
    (ya) => {
      ya
        // .option("output", {
        //   alias: "o",
        //   type: "string",
        //   normalize: true,
        //   description: "Output folder",
        // })
        .option("force", {
          alias: "f",
          type: "boolean",
          description: "Force to override existing thumb files",
        })
        .option("max", {
          alias: "m",
          type: "number",
          description: "Max size of long side of image thumb",
        });
    },
    (argv) => {
      cmdThumbs(argv);
    }
  )
  .command(
    ["prefix <input> [output]", "px"],
    "Rename files by append dir name or fixed string",
    (ya) => {
      ya.option("size", {
        alias: "s",
        type: "number",
        default: 12,
        description: "size[length] of prefix of dir name",
      })
        .option("ignore", {
          alias: "i",
          type: "string",
          description: "ignore string of prefix of dir name",
        })
        .option("prefix", {
          alias: "p",
          type: "string",
          description: "filename prefix for output ",
        })
    },
    (argv) => {
      cmdPrefix(argv);
    }
  )
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .epilog(
    "Media Utilities: Rename Image/Raw/Video files by EXIF date tags\nCopyright 2021 @ Zhang Xiaoke"
  )
  .demandCommand(1, chalk.red("Missing sub command you want to execute!"))
  .showHelpOnFail()
  .help()
  .middleware([configCli]);
const argv = ya.argv;

async function renameFiles(files) {
  log.info("Rename", `total ${files.length} files`);
  // do rename all files
  return await Promise.all(
    files.map(async (f) => {
      const outPath = path.join(path.dirname(f.path), f.outName);
      try {
        await fs.rename(f.path, outPath);
        log.show(chalk.green(`Renamed:`) + ` ${outPath}`);
        return f;
      } catch (error) {
        log.error("Rename", error, f.path);
      }
    })
  );
}

async function cmdPrefix(argv) {
  log.show('cmdPrefix', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error(`Invalid Input: '${root}'`);
    return;
  }
  const fastMode = argv.fast || false;
  const startMs = Date.now();
  log.show("Prefix", `Input: ${root}`, fastMode ? "(FastMode)" : "");
  let files = await mf.walk(root, {
    entryFilter: (entry) =>
      entry.stats.isFile() &&
      entry.stats.size > 1024 &&
      helper.isMediaFile(entry.path),
  });
  // process only image files
  // files = files.filter(x => helper.isImageFile(x.path));
  files.sort();
  log.show("Prefix", `Total ${files.length} media files found`);
  if (files.length == 0) {
    log.showYellow("Prefix", "Nothing to do, exit now.");
    return;
  }
  let nameIndex = 0;
  for (const f of files) {
    const [dir, base, ext] = helper.pathSplit(f.path);
    let dirPrefix = dir.replaceAll(/\W/gi, "").slice(0, 3);
    let dirFix = dir.split(path.sep).slice(-2).join("")
    let dirStr = dirFix.replaceAll(/[\.\\\/:"'\?]/gi, "")
    if (argv.ignore && argv.ignore.length >= 2) {
      dirStr = dirStr.replaceAll(argv.ignore, "");
    } else {
      dirStr = dirStr.replaceAll(/画师|图片|视频/gi, "");
    }
    const prefix = argv.prefix || dirPrefix || "IMG";
    const fPrefix = dirStr.slice((argv.size || 12) * -1)
    const newName = `${prefix}_${fPrefix}_${++nameIndex}${ext}`.toUpperCase()
    const newPath = path.join(dir, newName);
    f.outName = newName;
    log.show("Prefix", `New Name: ${helper.pathShort(newPath)}`);
  }
  log.show(
    "Prefix",
    `Total ${files.length} media files ready to rename`,
    fastMode ? "(FastMode)" : ""
  );
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to rename ${files.length} files?` +
        (fastMode ? " (FastMode)" : "")
      ),
    },
  ]);
  if (answer.yes) {
    renameFiles(files).then((files) => {
      log.showGreen("Prefix", `There ${files.length} file were renamed.`);
    });
  } else {
    log.showYellow("Prefix", "Will do nothing, aborted by user.");
  }
}

async function cmdRename(argv) {
  log.show('cmdRename', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error(`Invalid Input: '${root}'`);
    return;
  }
  const fastMode = argv.fast || false;
  // action: rename media file by exif date
  const startMs = Date.now();
  log.show("Rename", `Input: ${root}`, fastMode ? "(FastMode)" : "");
  let files = await exif.listMedia(root);
  const filesCount = files.length;
  log.show("Rename", `Total ${files.length} media files found`);
  files = await exif.parseFiles(files, { fastMode: fastMode });
  log.show(
    "Rename",
    `Total ${files.length} media files parsed`,
    fastMode ? "(FastMode)" : ""
  );
  files = exif.buildNames(files);
  const [validFiles, skippedBySize, skippedByDate] = exif.checkFiles(files);
  files = validFiles;
  if (filesCount - files.length > 0) {
    log.warn(
      "Rename",
      `Total ${filesCount - files.length} media files skipped`
    );
  }
  log.show(
    "Rename",
    `Total ${filesCount} files processed in ${helper.humanTime(startMs)}`,
    fastMode ? "(FastMode)" : ""
  );
  if (skippedBySize.length > 0) {
    log.showYellow(
      "Rename",
      `Total ${skippedBySize.length} media files are skipped by size`
    );
  }
  if (skippedByDate.length > 0) {
    log.showYellow(
      "Rename",
      `Total ${skippedByDate.length} media files are skipped by date`
    );
  }
  if (files.length == 0) {
    log.showYellow("Rename", "Nothing to do, exit now.");
    return;
  }
  log.show(
    "Rename",
    `Total ${files.length} media files ready to rename`,
    fastMode ? "(FastMode)" : ""
  );
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to rename ${files.length} files?` +
        (fastMode ? " (FastMode)" : "")
      ),
    },
  ]);
  if (answer.yes) {
    renameFiles(files).then((files) => {
      log.showGreen("Rename", `There ${files.length} file were renamed.`);
    });
  } else {
    log.showYellow("Rename", "Will do nothing, aborted by user.");
  }
}

async function cmdOrganize(argv) {
  log.show('cmdOrganize', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("Organize", `Invalid Input: '${root}'`);
    return;
  }
  const output = argv.output || root;
  // rules:
  // 1. into folders by file type (png/video/image)
  // 2. into folders by date month
  log.show(`Organize: input:`, root);
  log.show(`Organize: output:`, output);
  let files = await exif.listMedia(root);
  log.show("Organize", `Total ${files.length} media files found`);
  const pics = {};
  files.forEach((f, i) => {
    log.debug(`Processing(${i}):`, path.basename(f.path), f.stats.mtime);
    if (helper.isVideoFile(f.path)) {
      if (!pics["vids"]) {
        pics["vids"] = [];
      }
      pics["vids"].push(f);
      log.debug("Video Item:", f.path);
    } else if ([".png", ".gif"].includes(helper.pathExt(f.path, true))) {
      if (!pics["pngs"]) {
        pics["pngs"] = [];
      }
      pics["pngs"].push(f);
      log.debug("PNG Item:", f.path);
    } else if (
      f.stats.size < 1000 * 1024 &&
      helper.pathExt(f.path, true) === ".jpg"
    ) {
      if (!pics["pngs"]) {
        pics["pngs"] = [];
      }
      pics["pngs"].push(f);
      log.debug("Other Item:", f.path, helper.fileSizeSI(f.stats.size));
    } else {
      const dateStr = dayjs(f.stats.mtime).format("YYYYMM");
      if (!pics[dateStr]) {
        pics[dateStr] = [];
      }
      pics[dateStr].push(f);
      log.debug("Image Item:", f.path, dateStr);
      if (dateStr.includes("08")) {
        log.show(f.path, f.stats.mtime);
      }
    }
  });
  for (const [k, v] of Object.entries(pics)) {
    if (v.length > 0) {
      log.show(
        `Organize:`,
        `${v.length} files will be moved to '${path.join(output, k)}'`
      );
    }
  }
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to move these ${files.length} files?`
      ),
    },
  ]);
  if (answer.yes) {
    for (const [k, v] of Object.entries(pics)) {
      if (v.length > 0) {
        const movedFiles = [];
        const fileOutput = path.join(output, k);
        for (const f of v) {
          const fileSrc = f.path;
          const fileDst = path.join(fileOutput, path.basename(fileSrc));
          if (!(await fs.pathExists(fileSrc))) {
            log.info("Not Found:", fileSrc);
            continue;
          }
          if (await fs.pathExists(fileDst)) {
            log.info("Skip Exists:", fileDst);
            continue;
          }
          if (!(await fs.pathExists(fileOutput))) {
            await fs.mkdirp(fileOutput);
          }
          try {
            await fs.move(fileSrc, fileDst);
            movedFiles.push([fileSrc, fileDst]);
            log.info("Moved:", fileSrc, "to", fileDst);
          } catch (error) {
            log.error("Failed:", error, fileSrc, "to", fileDst);
          }
        }
        if (v.length - movedFiles.length > 0) {
          log.showYellow(
            `Skipped:`,
            `${v.length - movedFiles.length
            } files are already in '${fileOutput}'`
          );
        }
        if (movedFiles.length > 0) {
          log.showGreen(
            `Done:`,
            `${movedFiles.length} files are moved to '${fileOutput}'`
          );
        }
      }
    }
  } else {
    log.showYellow("Will do nothing, aborted by user.");
  }
}

async function cmdLRMove(argv) {
  log.show('cmdLRMove', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("LRMove", `Invalid Input: '${root}'`);
    return;
  }
  // const output = argv.output || root;
  log.show(`LRMove: input:`, root);
  // log.show(`LRMove: output:`, output);
  let files = await mf.walk(root, {
    entryFilter: (entry) =>
      entry.stats.isDirectory() && path.basename(entry.path) === "JPEG",
  });
  log.show("LRMove:", `Total ${files.length} JPEG folders found`);
  if (files.length == 0) {
    log.showGreen("Nothing to do, abort.");
    return;
  }
  for (const f of files) {
    const fileSrc = f.path;
    const fileBase = path.dirname(fileSrc);
    const fileDst = fileBase.replace("RAW" + path.sep, "JPEG" + path.sep);
    log.show(`SRC:`, f.path);
    log.show("DST:", fileDst);
    f.fileSrc = fileSrc;
    f.fileDst = fileDst;
  }
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to move these ${files.length} JPEG folder with files?`
      ),
    },
  ]);
  if (answer.yes) {
    for (const f of files) {
      try {
        await fs.move(f.fileSrc, f.fileDst);
        log.showGreen("Moved:", f.fileSrc, "to", f.fileDst);
      } catch (error) {
        log.error("Failed:", error, f.fileSrc, "to", f.fileDst);
      }
    }
  } else {
    log.showYellow("Will do nothing, aborted by user.");
  }
}

async function prepareThumbArgs(f, options) {
  options = options || {};
  const maxSize = options.maxSize || 3000;
  const force = options.force || false;
  const output = options.output || undefined;
  let fileSrc = path.resolve(f.path);
  const [dir, base, ext] = helper.pathSplit(fileSrc);
  let fileDst;
  let dirDst;
  if (output) {
    dirDst = helper.pathRewrite(dir, output);
  } else {
    dirDst = dir.replace(/JPEG|Photos/i, 'Thumbs');
    if (dirDst == dir) {
      // input 'F:\\Temp\\照片\\202206\\'
      // output 'F:\\Temp\\照片\\202206_thumbs\\'
      dirDst = path.join(path.dirname(dir), path.basename(dir) + '_thumbs')
    }
  }
  dirDst = dirDst.replace('相机照片', '相机小图');
  fileDst = path.join(dirDst, `${base}_thumb.jpg`);
  fileSrc = path.resolve(fileSrc);
  fileDst = path.resolve(fileDst);

  if (await fs.pathExists(fileDst)) {
    log.info("cmdThumbs exists:", fileDst, force ? "(Override)" : "");
    if (!force) {
      return;
    }
  }
  try {
    const s = sharp(fileSrc);
    const m = await s.metadata();
    if (m.width <= maxSize && m.height <= maxSize) {
      log.debug("cmdThumbs skip:", fileSrc);
      return;
    }
    const nw =
      m.width > m.height ? maxSize : Math.round((maxSize * m.width) / m.height);
    const nh = Math.round((nw * m.height) / m.width);

    log.debug(
      "cmdThumbs prepared:",
      fileDst,
      `(${m.width}x${m.height} => ${nw}x${nh})`
    );
    return {
      width: nw,
      src: fileSrc,
      dst: fileDst,
    };
  } catch (error) {
    log.error("cmdThumbs error:", error, f.path);
  }
}

async function makeThumbOne(t) {
  await fs.ensureDir(path.dirname(t.dst));
  // console.log(t.dst);
  const s = sharp(t.src);
  const r = await s
    .resize({ width: t.width })
    .withMetadata()
    .jpeg({ quality: 85, chromaSubsampling: "4:4:4" })
    .toFile(t.dst);
  log.showGreen("cmdThumbs done:", t.dst, r.width, r.height);
  return r;
}

async function cmdThumbs(argv) {
  log.show('cmdThumbs', argv);
  const root = path.resolve(argv.input);
  assert.strictEqual("string", typeof root, "root must be string");
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("cmdThumbs", `Invalid Input: '${root}'`);
    return;
  }
  const maxSize = argv.maxSize || 3000;
  const force = argv.force || false;
  const output = argv.output;
  // return;
  // const output = argv.output || root;
  log.show(`cmdThumbs: input:`, root);
  log.show(`cmdThumbs: output:`, output);

  const RE_THUMB = /(小图|精选|feature|web|thumb)/i;
  const walkOpts = {
    entryFilter: (f) =>
      f.stats.isFile() &&
      f.stats.size > 100 * 1024 &&
      helper.isImageFile(f.path) &&
      !RE_THUMB.test(f.path),
  };
  const files = await mf.walk(root, walkOpts);
  log.info("cmdThumbs", `total ${files.length} found`);

  let tasks = await Promise.all(
    files.map(
      throat(cpuCount, (f) =>
        prepareThumbArgs(f, {
          maxSize: maxSize,
          force: force,
          output: output,
        })
      )
    )
  );
  log.debug("cmdThumbs before filter: ", tasks.length);
  const total = tasks.length;
  tasks = tasks.filter((t) => t && t.dst);
  const skipped = total - tasks.length;
  log.debug("cmdThumbs after filter: ", tasks.length);
  if (skipped > 0) {
    log.showYellow(`cmdThumbs: ${skipped} thumbs skipped`)
  }
  if (tasks.length == 0) {
    log.showYellow("Nothing to do, abort.");
    return;
  }
  log.show(`cmdThumbs: task sample:`, tasks.slice(-1))
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to make thumbs for ${tasks.length} files?`
      ),
    },
  ]);

  if (!answer.yes) {
    log.showYellow("Will do nothing, aborted by user.");
    return;
  }

  const startMs = Date.now();
  log.showGreen('cmdThumbs: startAt', dayjs().format())
  const result = await pMap(tasks, makeThumbOne, { concurrency: cpuCount });
  log.showGreen('cmdThumbs: endAt', dayjs().format())
  log.showGreen(`cmdThumbs: ${result.length} thumbs generated in ${helper.humanTime(startMs)}`)
}
