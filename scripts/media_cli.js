#!/usr/bin/env node
const assert = require("assert");
const dayjs = require("dayjs");
const inquirer = require("inquirer");
const throat = require("throat");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs-extra");
const chalk = require("chalk");
const cpuCount = require("os").cpus().length;
const log = require("../lib/debug");
const exif = require("../lib/exif");
const helper = require("../lib/helper");
const mf = require("../lib/file");
// debug and logging config
const prettyError = require("pretty-error").start();
prettyError.skipNodeFiles();

const configCli = (argv) => {
  // log.setName("AudioCli");
  log.setLevel(argv.verbose);
  log.debug(argv);
};

const yargs = require("yargs/yargs")(process.argv.slice(2));
// https://github.com/yargs/yargs/blob/master/docs/advanced.md
yargs
  .usage("Usage: $0 <command> <input> [options]")
  .positional("input", {
    describe: "Input folder that contains files",
    type: "string",
    normalize: true,
  })
  .command(
    ["rename <input> [options]", "rn", "$0"],
    "Rename media files in input dir by exif date",
    (yargs) => {
      yargs
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
    (yargs) => {
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
    (yargs) => {
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
    (yargs) => {
      yargs
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
const argv = yargs.argv;

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

async function cmdRename(argv) {
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
  pics = {};
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
      log.debug("Other Item:", f.path, helper.fileSize(f.stats.size));
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
            `${
              v.length - movedFiles.length
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
  const year = new Date().getFullYear();
  options = options || {};
  const maxSize = options.maxSize || 3000;
  const force = options.force || false;
  const output = options.output || undefined;
  let fileSrc = path.resolve(f.path);
  const [dir, base, ext] = helper.pathSplit(fileSrc);
  let fileDst;
  if (output) {
    fileDst = path.join(
      output,
      path.basename(path.dirname(dir)),
      path.basename(dir),
      `${base}_thumb.jpg`
    );
  } else {
    let dir2;
    if (dir.includes("JPEG")) {
      const thumbPath = path.join("Thumbs", String(year), "相机小图");
      dir2 = dir.replace("JPEG", thumbPath);
      fileDst = path.join(dir2, `${base}_thumb.jpg`);
    } else {
      fileDst = path.join(dir, "thumbs", `${base}_thumb.jpg`);
    }
  }

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

    log.show(
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

async function cmdThumbs(argv) {
  const root = path.resolve(argv.input);
  assert.strictEqual("string", typeof root, "root must be string");
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("cmdThumbs", `Invalid Input: '${root}'`);
    return;
  }
  log.error(argv);
  // return;
  // const output = argv.output || root;
  log.show(`cmdThumbs: input:`, root);
  const maxSize = argv.maxSize || 3000;
  const force = argv.force || false;
  const output = argv.output;

  const RE_THUMB = /(小图|精选|feature|web|thumb)/gi;
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
  tasks = tasks.filter((t) => t && t.dst);
  log.debug("cmdThumbs after filter: ", tasks.length);
  if (tasks.length == 0) {
    log.showYellow("Nothing to do, abort.");
    return;
  }

  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to make thumbs for ${files.length} files?`
      ),
    },
  ]);

  if (!answer.yes) {
    log.showYellow("Will do nothing, aborted by user.");
    return;
  }

  for (const t of tasks) {
    await fs.ensureDir(path.dirname(t.dst));
    // console.log(t.dst);
    const s = sharp(t.src);
    const r = await s
      .resize({ width: t.width })
      .withMetadata()
      .jpeg({ quality: 85, chromaSubsampling: "4:4:4" })
      .toFile(t.dst);
    log.showGreen("cmdThumbs done:", t.dst, r.width, r.height);
  }
}
