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
import { cpus, tmpdir } from "os";

import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as helper from '../lib/helper.js'
import * as mf from '../lib/file.js'

const cpuCount = cpus().length;
// debug and logging config
const prettyError = PrettyError.start();
prettyError.skipNodeFiles();

const configCli = (argv) => {
  // log.setName("MediaCli");
  log.setLevel(argv.verbose);
  log.debug(argv);
};

const fileLog = function (msg, tag) {
  log.fileLog(msg, tag, "mediac");
}

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
    ["compress <input> [output]", "cs"],
    "Compress input images to target size",
    (ya) => {
      ya
        .option("delete", {
          alias: "d",
          type: "boolean",
          default: false,
          description: "Delete original image file",
        })
        .option("quality", {
          alias: "q",
          type: "number",
          default: 88,
          description: "Target image file compress quality",
        })
        .option("size", {
          alias: "s",
          type: "number",
          default: 3072,
          description: "Processing file bigger than this size (unit:k)",
        })
        .option("width", {
          alias: "w",
          type: "number",
          default: 4000,
          description: "Max width of long side of image thumb",
        });
    },
    (argv) => {
      cmdCompress(argv);
    }
  )
  .command(
    ["remove <input> [output]", "rm"],
    "Remove files by given size/width-height/name-pattern",
    (ya) => {
      ya
        .option("loose", {
          alias: "l",
          type: "boolean",
          default: false,
          description: "If true, operation of conditions is OR, else is AND",
        })
        .option("width", {
          type: "number",
          default: 0,
          description: "Files width smaller than value will be removed",
        })
        .option("height", {
          type: "number",
          default: 0,
          description: "Files height smaller than value will be removed",
        })
        .option("dimension", {
          alias: "d",
          type: "string",
          default: "",
          description: "File dimension, width and height, eg: '123x456'",
        })
        .option("size", {
          alias: "s",
          type: "number",
          default: 0,
          description: "Files size smaller than value will be removed (unit:k)",
        })
        .option("pattern", {
          alias: "p",
          type: "string",
          default: "",
          description: "Files name pattern matche value will be removed",
        });
    },
    (argv) => {
      cmdRemove(argv);
    }
  )
  .command(
    ["moveup <input> [output]", "mu"],
    "Move files to sub folder in top folder",
    (ya) => {
      ya
        .option("output", {
          alias: "o",
          type: "string",
          normalize: true,
          description: "Output sub folder name",
        });
    },
    (argv) => {
      cmdMoveUp(argv);
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
        .option("all", {
          alias: "a",
          type: "boolean",
          description: "force rename all files ",
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
      if (!f.outName || f.path == f.outPath) {
        log.showYellow("Rename", "ignore", f.path);
        return;
      }
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
  const allMode = argv.all || false;
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
  //let nameIndex = 0;
  const reOnlyNum = /^\d+$/;
  const tasks = [];
  for (const f of files) {
    const [dir, base, ext] = helper.pathSplit(f.path);
    if (!reOnlyNum.test(base) && !allMode) {
      log.showYellow("Prefix", `Ignore: ${helper.pathShort(f.path)}`);
      continue;
    }
    let dirFix = dir.split(path.sep).slice(-2).join("");
    let dirStr = dirFix.replaceAll(/[\.\\\/\[\]:"'\?\(\)\ \-\_\+\!\#\@\d]/gi, "");
    if (argv.ignore && argv.ignore.length >= 2) {
      dirStr = dirStr.replaceAll(argv.ignore, "");
    } else {
      dirStr = dirStr.replaceAll(/画师|图片|视频|PIC|NO/gi, "");
    }
    const oldBase = base.replaceAll(/\W-_\ \+/gi, "").slice(-6);
    const fPrefix = (dirStr + "_" + oldBase).slice((argv.size || 16) * -1);
    const newName = `${fPrefix}${ext}`.toUpperCase();
    const newPath = path.join(dir, newName);
    f.outName = newName;
    log.show("Prefix", `Output: ${helper.pathShort(newPath)}`);
    tasks.push(f);
  }
  if (tasks.length > 0) {
    log.showGreen(
      "Prefix",
      `Total ${files.length} media files ready to rename`,
      allMode ? "(allMode)" : ""
    );
  } else {
    log.showYellow(
      "Prefix",
      `Nothing to do, abort.`,
      allMode ? "(allMode)" : ""
    );
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to rename ${tasks.length} files?` +
        (allMode ? " (allMode)" : "")
      ),
    },
  ]);
  if (answer.yes) {
    renameFiles(tasks).then((tasks) => {
      log.showGreen("Prefix", `There ${tasks.length} file were renamed.`);
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

async function cmdMoveUp(argv) {
  log.show('cmdMoveUp', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("MoveUp", `Invalid Input: '${root}'`);
    return;
  }
  // 读取顶级目录下所有的子目录
  const outputDirName = argv.output || "图片";
  const videoDirName = "视频"
  let subDirs = await fs.readdir(root, { withFileTypes: true });
  subDirs = subDirs.filter(x => x.isDirectory()).map(x => x.name);
  log.show("MoveUp", "Folders:", subDirs)

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to move files in these folders to top sub folder?`
      ),
    },
  ]);
  if (!answer.yes) {
    log.showYellow("MoveUp", "Will do nothing, aborted by user.");
    return;
  }

  // 移动各个子目录的文件到 子目录/图片 目录
  let movedCount = 0;
  for (const subDir of subDirs) {
    let curDir = path.join(root, subDir)
    let files = await exif.listMedia(curDir)
    log.show("MoveUp", `Total ${files.length} media files found in ${subDir}`);
    const fileOutput = path.join(curDir, outputDirName)
    const videoOutput = path.join(curDir, videoDirName);
    log.show("MoveUp", `fileOutput = ${fileOutput}`);
    for (const f of files) {
      const fileSrc = f.path;
      const fileDst = path.join(helper.isVideoFile(fileSrc) ? videoOutput : fileOutput, path.basename(fileSrc));
      if (fileSrc === fileDst) {
        log.info("Skip Same:", fileDst);
        continue;
      }
      if (!(await fs.pathExists(fileSrc))) {
        log.showYellow("Not Found:", fileSrc);
        continue;
      }
      if (await fs.pathExists(fileDst)) {
        log.showYellow("Skip Exists:", fileDst);
        continue;
      }
      if (!(await fs.pathExists(fileOutput))) {
        await fs.mkdirp(fileOutput);
      }
      try {
        await fs.move(fileSrc, fileDst);
        // movedFiles.push([fileSrc, fileDst]);
        movedCount++;
        log.info("Moved:", fileSrc, "to", fileDst);
      } catch (error) {
        log.error("Failed:", error, fileSrc, "to", fileDst);
      }
    }
    log.showGreen("MoveUp", `Files in ${curDir} are moved to ${fileOutput}.`);
  };
  log.showGreen("MoveUp", `All ${movedCount} files moved.`);
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
    log.info("prepareThumbArgs exists:", fileDst, force ? "(Override)" : "");
    if (!force) {
      return;
    }
  }
  try {
    const s = sharp(fileSrc);
    const m = await s.metadata();
    if (m.width <= maxSize && m.height <= maxSize) {
      log.debug("prepareThumbArgs skip:", fileSrc);
      return;
    }
    const nw =
      m.width > m.height ? maxSize : Math.round((maxSize * m.width) / m.height);
    const nh = Math.round((nw * m.height) / m.width);

    log.debug(
      "prepareThumbArgs prepared:",
      fileDst,
      `(${m.width}x${m.height} => ${nw}x${nh})`
    );
    return {
      width: nw,
      src: fileSrc,
      dst: fileDst,
    };
  } catch (error) {
    log.error("prepareThumbArgs error:", error, f.path);
  }
}

async function makeThumbOne(t) {
  //log.show("makeThumbOne", t);
  try {
    await fs.ensureDir(path.dirname(t.dst));
    // console.log(t.dst);
    const s = sharp(t.src);
    const r = await s
      .resize({ width: t.width })
      .withMetadata()
      .jpeg({ quality: t.quality || 85, chromaSubsampling: "4:4:4" })
      .toFile(t.dst);
    log.showGreen("makeThumb output:", helper.pathShort(t.dst), r.width, r.height);
    const fst = await fs.stat(t.dst);
    // file may be corrupted, del it
    if (fst.size < 200 * 1024) {
      await fs.remove(t.dst);
      log.showRed("makeThumbOne", `file too small, del ${t.dst}`);
    } else if (t.deleteOriginal) {
      try {
        await fs.remove(t.src);
        log.show("makeThumb delete:", helper.pathShort(t.src));
      } catch (error) {
        log.error("makeThumb delete original", error);
      }
    }
    return r;
  } catch (error) {
    log.error("makeThumbOne", `error on '${t.src}'`, error);
    try {
      await fs.remove(t.dst);
    } catch (error) { }
  }
}

async function cmdThumbs(argv) {
  log.show('cmdThumbs', argv);
  const root = path.resolve(argv.input);
  assert.strictEqual("string", typeof root, "root must be string");
  if (!root || !(await fs.pathExists(root))) {
    ya.showHelp();
    log.error("cmdThumbs", `Invalid Input: '${root}'`);
    return;
  }
  const maxWidth = argv.max || 3000;
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
          maxWidth: maxWidth,
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

async function prepareCompressArgs(f, options) {
  options = options || {};
  // log.show("prepareCompressArgs options:", options);
  const maxWidth = options.maxWidth || 4000;
  const force = options.force || false;
  const deleteOriginal = options.deleteOriginal || false;
  let fileSrc = path.resolve(f.path);
  const [dir, base, ext] = helper.pathSplit(fileSrc);
  let fileDst = path.join(dir, `${base}_Z4K.jpg`);
  fileSrc = path.resolve(fileSrc);
  fileDst = path.resolve(fileDst);

  if (await fs.pathExists(fileDst)) {
    log.info("prepareCompress exists:", fileDst, force ? "(Override)" : "");
    if (deleteOriginal) {
      await fs.remove(fileSrc);
      log.showYellow('prepareCompress exists, delete', helper.pathShort(fileSrc));
    }
    if (!force) {
      return;
    }
  }
  try {
    const s = sharp(fileSrc);
    const m = await s.metadata();
    const nw =
      m.width > m.height ? maxWidth : Math.round((maxWidth * m.width) / m.height);
    const nh = Math.round((nw * m.height) / m.width);

    const dw = nw > m.width ? m.width : nw;
    const dh = nh > m.height ? m.height : nh;
    log.show(
      "prepareCompress:",
      helper.pathShort(fileDst),
      `(${m.width}x${m.height} => ${dw}x${dh})`
    );
    return {
      width: dw,
      height: dh,
      src: fileSrc,
      dst: fileDst,
    };
  } catch (error) {
    log.error("prepareCompress error:", error, fileSrc);
  }
}

async function cmdCompress(argv) {
  const root = path.resolve(argv.input);
  assert.strictEqual("string", typeof root, "root must be string");
  if (!root || !(await fs.pathExists(root))) {
    ya.showHelp();
    log.error("cmdCompress", `Invalid Input: '${root}'`);
    return;
  }
  log.show('cmdCompress', argv);
  const force = argv.force || false;
  const quality = argv.quality || 88;
  const minFileSize = (argv.size || 3072) * 1024;
  const maxWidth = argv.width || 4000;
  const deleteOriginal = argv.delete || false;
  log.show(`cmdCompress: input:`, root);

  const RE_THUMB = /(Z4K|feature|web|thumb)/i;
  const walkOpts = {
    entryFilter: (f) =>
      f.stats.isFile() &&
      f.stats.size > minFileSize &&
      helper.isImageFile(f.path) &&
      !RE_THUMB.test(f.path),
  };
  const files = await mf.walk(root, walkOpts);
  log.show("cmdCompress", `total ${files.length} files found`);

  let tasks = await Promise.all(
    files.map(
      throat(cpuCount, (f) =>
        prepareCompressArgs(f, {
          maxWidth: maxWidth,
          force: force,
          deleteOriginal: deleteOriginal
        })
      )
    )
  );
  log.debug("cmdCompress before filter: ", tasks.length);
  const total = tasks.length;
  tasks = tasks.filter((t) => t && t.dst);
  const skipped = total - tasks.length;
  log.debug("cmdCompress after filter: ", tasks.length);
  if (skipped > 0) {
    log.showYellow(`cmdCompress: ${skipped} thumbs skipped`)
  }
  if (tasks.length == 0) {
    log.showYellow("Nothing to do, abort.");
    return;
  }
  tasks.forEach(t => {
    t.quality = quality || 88;
    t.deleteOriginal = deleteOriginal || false;
  });
  log.show(`cmdCompress: task sample:`, tasks.slice(-2))
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to compress ${tasks.length} files? \n[Apply to files bigger than ${minFileSize / 1024}K, and max long side is ${maxWidth}] \n${deleteOriginal ? "(Attention: you choose to delete original file!)" : "(Will keep original file)"}`
      ),
    },
  ]);

  if (!answer.yes) {
    log.showYellow("Will do nothing, aborted by user.");
    return;
  }

  const startMs = Date.now();
  log.showGreen('cmdCompress: startAt', dayjs().format())
  const result = await pMap(tasks, makeThumbOne, { concurrency: cpuCount / 2 + 1 });
  log.showGreen('cmdCompress: endAt', dayjs().format())
  log.showGreen(`cmdCompress: ${result.length} thumbs generated in ${helper.humanTime(startMs)}`)
}

async function prepareRemoveArgs(f, options) {
  let conditions = options || {};
  //log.show("prepareRM options:", options);

  // three args group
  // name pattern top1
  // width && height top2
  // size top3
  const cLoose = conditions.loose || false;
  const cWidth = conditions.width || 0;
  const cHeight = conditions.height || 0;
  const cSize = conditions.size || 0;
  const cPattern = conditions.pattern || "";

  //log.show("prepareRM", `${cWidth}x${cHeight} ${cSize} /${cPattern}/`);

  const fileSrc = path.resolve(f.path);
  const fileName = path.basename(fileSrc);
  const [dir, base, ext] = helper.pathSplit(fileSrc);

  try {
    const fst = await fs.stat(fileSrc);
    const s = sharp(fileSrc);
    const m = await s.metadata();

    const fWidth = m.width || 0;
    const fHeight = m.height || 0;
    const fSize = fst.size || 0;
    const fName = fileName;

    const hasName = cPattern && cPattern.length > 0;//1
    const hasSize = cSize > 0;//2
    const hasMeasure = cWidth > 0 || cHeight > 0;//3

    let testName = false;
    let testSize = false;
    let testMeasure = false;

    // 首先检查名字正则匹配
    if (hasName) {
      const rp = new RegExp(cPattern, "gi");
      if (rp.test(fName)) {
        log.info(
          "prepareRM[Name]:",
          `${fileName} ${Math.round(fSize / 1024)}k ${fWidth}x${fHeight} [PT=${rp}]`
        );
        testName = true;
      } else {
        log.debug(
          "prepareRM[Name]:",
          `${fileName} ${Math.round(fSize / 1024)}k ${fWidth}x${fHeight} [PT=${rp}]`
        );
      }
    }
    //if (!shouldRemove) {
    // 其次检查文件大小是否满足条件
    if (hasSize) {
      if (fSize > 0 && fSize <= cSize) {
        log.info(
          "prepareRM[Size]:",
          `${fileName} [${Math.round(fSize / 1024)}k] ${fWidth}x${fHeight} [Size=${cSize / 1024}k]`
        );
        testSize = true;
      }
    }
    //}

    //if (!shouldRemove) {
    // 再次检查宽高是否满足条件
    if (hasMeasure) {
      if (cWidth > 0 && cHeight > 0) {
        // 宽高都提供时，要求都满足才能删除
        if (fWidth <= cWidth && fHeight <= cHeight) {
          log.info(
            "prepareRM[Measure]:",
            `${fileName} ${fWidth}x${fHeight} [${cWidth}x${cHeight}]`
          );
          testMeasure = true;
        }
      }
      else {
        if (cWidth > 0 && fWidth <= cWidth) {
          // 只提供宽要求
          log.info(
            "prepareRM[Measure]:",
            `${fileName} ${fWidth}x${fHeight} [W=${cWidth}]`
          );
          testMeasure = true;
        } else if (cHeight > 0 && fHeight <= cHeight) {
          // 只提供高要求
          log.info(
            "prepareRM[Measure]:",
            `${fileName} ${fWidth}x${fHeight} [H=${cHeight}]`
          );
          testMeasure = true;
        }
      }
    }
    //}

    // 满足名字规则/文件大小/宽高任一规则即会被删除，或关系
    let shouldRemove = false;
    if (cLoose) {
      shouldRemove = testName || testSize || testMeasure;
    }
    else {
      // 必须同时满足所有用户已提供的条件，与关系
      shouldRemove = ((hasName && testName) || !hasName)
        && ((hasSize && testSize) || !hasSize)
        && ((hasMeasure && testMeasure) || !hasMeasure);
    }

    if (shouldRemove) {
      log.show(
        "prepareRM add:",
        `${helper.pathShort(fileSrc)} ${Math.round(fSize / 1024)}k ${fWidth}x${fHeight}`, f.index
      );
    } else {
      (testName || testSize || testMeasure) && log.info(
        "prepareRM ignore:",
        `${helper.pathShort(fileSrc)} ${Math.round(fSize / 1024)}k ${fWidth}x${fHeight} (${testName} ${testSize} ${testMeasure})`, f.index
      );
    }

    return {
      // conditions: conditions,
      // testName: testName,
      // testSize: testSize,
      // testMeasure: testMeasure,
      index: f.index,
      width: fWidth,
      height: fHeight,
      size: fSize,
      shouldRemove: shouldRemove,
      src: fileSrc,
    };

  } catch (error) {
    log.error("prepareRM error:", error, fileSrc);
    // await fs.remove(fileSrc);
    fileLog(`<Error> ${fileSrc} (${f.index})`, "cmdRemove");
  }
}

async function cmdRemove(argv) {
  const root = path.resolve(argv.input);
  assert.strictEqual("string", typeof root, "root must be string");
  if (!root || !(await fs.pathExists(root))) {
    ya.showHelp();
    log.error("cmdRemove", `Invalid Input: '${root}'`);
    return;
  }
  log.show('cmdRemove', argv);
  const cLoose = argv.loose || false;
  const cWidth = argv.width || 0;
  const cHeight = argv.height || 0;
  const cSize = argv.size * 1024 || 0;
  const cPattern = argv.pattern || "";

  if (argv.dimension && argv.dimension.length > 0) {
    // parse dimension arg 2160x4680
  }

  if (cWidth == 0 && cHeight == 0 && cSize == 0 && !cPattern) {
    log.error("cmdRemove", `invalid arguments: width/height/size/pattern supplied`);
    return;
  }
  log.show("cmdRemove", `input:`, root);
  fileLog(`<Input> ${root}`, "cmdRemove");
  const conditions = {
    loose: cLoose,
    width: cWidth,
    height: cHeight,
    size: cSize,
    pattern: cPattern,
  }

  const walkOpts = {
    entryFilter: (f) =>
      f.stats.isFile() &&
      helper.isImageFile(f.path),
    withIndex: true,
  };
  const files = await mf.walk(root, walkOpts);
  log.show("cmdRemove", `total ${files.length} files found`);

  let tasks = await Promise.all(
    files.map(
      throat(2 * cpuCount, (f) =>
        prepareRemoveArgs(f, conditions)
      )
    )
  );
  const total = tasks.length;
  tasks = tasks.filter((t) => t && t.shouldRemove);
  const skipped = total - tasks.length;
  log.show("cmdRemove", `${tasks.length} files to be removed`);
  if (skipped > 0) {
    log.show("cmdRemove", `${skipped} files are ignored`)
  }
  if (tasks.length == 0) {
    log.show("cmdRemove", conditions);
    log.showGreen("Nothing to do, abort.");
    return;
  }

  log.show("cmdRemove", `task sample:`, tasks.slice(-1));
  log.showYellow("cmdRemove", conditions);
  fileLog(`<Conditions> loose=${cLoose},width=${cWidth},height=${cHeight},size=${cSize / 1024}k,name=${cPattern}`, "cmdRemove");
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to remove ${tasks.length} files (total ${files.length}) using above conditions?`
      ),
    },
  ]);

  if (!answer.yes) {
    log.showYellow("Will do nothing, aborted by user.");
    return;
  }

  const startMs = Date.now();
  log.showGreen("cmdRemove", 'task startAt', dayjs().format())
  // const result = await pMap(tasks, fs.remove, { concurrency: cpuCount / 2 + 1 });
  let removedCount = 0;
  let index = 0;
  for (const task of tasks) {
    try {
      await fs.remove(task.src);
      ++removedCount;
      fileLog(`<Removed> ${task.src} (${task.index})`, "cmdRemove");
      log.show("cmdRemove", `removed ${task.src} (${task.index}) (${++index}/${tasks.length})`);
    } catch (error) {
      log.error("cmdRemove", `failed to remove file ${task.src}`, error);
    }
  }

  log.showGreen("cmdRemove", 'task endAt', dayjs().format())
  log.showGreen("cmdRemove", `${removedCount} files removed in ${helper.humanTime(startMs)}`)
  log.show("cmdRemove", `task logs are written to ${log.fileLogName()}`);
}