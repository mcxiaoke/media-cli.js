#!/usr/bin/env node

const os = require("os");
const path = require("path");
const inquirer = require("inquirer");
const fs = require("fs-extra");
const dayjs = require("dayjs");
const klawSync = require("klaw-sync");
const chalk = require("chalk");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const ExifTool = require("exiftool-vendored").ExifTool;
const { ExifDateTime } = require("exiftool-vendored");
const h_ = require("./helper");
const d_ = require("../lib/debug");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

async function showExifDate(filename) {
  try {
    const tags = await et.read(filename);
    d_.L(tags);
  } catch (error) {
    d_.E(error);
  } finally {
    await et.end();
  }
}

async function listFiles(root) {
  // list all files in root dir
  const filterMedia = (item) => {
    return h_.isMediaFile(item.path) && item.stats.size > 100 * 1024;
  };
  let startMs = Date.now();
  let files = klawSync(root, {
    nodir: true,
    traverseAll: true,
    filter: filterMedia,
  });
  files = files.map((f) => {
    f.root = root;
    return f;
  });
  d_.I(`listFiles ${files.length} files in ${Date.now() - startMs}ms`);
  return files;
}

function fixSonyTag(tags) {
  // hack for sony 6300
  // samples/6300/VID_20210628_191003_4k.MP4'
  // FileModifyDate rawValue: '2021:06:28 19:10:13+08:00'
  // MediaModifyDate rawValue: '2021:06:28 11:10:03'
  if (
    tags.TimeZone &&
    tags.MajorBrand &&
    tags.MajorBrand.toLowerCase().includes("sony")
  ) {
    d_.D("fixSonyTag:", tags.SourceFile);
    return ["FileModifyDate", tags.FileModifyDate];
  }
}

function fixAppleTag(tags) {
  // iphone video must use CreationDate, not CreateDate
  //  CreationDate rawValue: '2021:06:21 10:22:47+08:00',
  // CreateDate rawValue: '2021:06:21 02:22:47',
  if (
    tags.MediaCreateDate &&
    tags.CreationDate instanceof ExifDateTime &&
    tags.MajorBrand &&
    tags.MajorBrand.toLowerCase().includes("apple")
  ) {
    d_.D("fixAppleTag:", tags.SourceFile);
    return ["CreationDate", tags.CreationDate];
  }
}

function fixScreenShot(tags) {
  return (
    h_.getExtname(tags.FileName, true) == "png" && [
      "FileModifyDate",
      tags.FileModifyDate,
    ]
  );
}

function hackAndFix(tags) {
  return fixSonyTag(tags) || fixAppleTag(tags) || fixScreenShot(tags);
}

function selectDateTag(tags) {
  // !!key order is important!!
  let keys = [
    "CreationDate",
    "MediaCreateDate",
    "MediaModifyDate",
    "SubSecCreateDate",
    "SubSecDateTimeOriginal",
    "DateTimeOriginal",
    "CreateDate",
    "ModifyDate",
    "FileModifyDate",
  ];
  // let dateTags = Object.entries(tags).filter((entry) => {
  //   const [k, v] = entry;
  //   return v instanceof ExifDateTime;
  // });
  for (const k of keys) {
    if (tags[k] instanceof ExifDateTime) {
      return [k, tags[k]];
    }
  }
}

async function getExifDate(filename) {
  // read exif date using exiftool
  try {
    const tags = await et.read(filename);
    // show exiftool error message
    if (tags.Error) {
      d_.W(tags.Error);
    }
    return { exif: tags, date: hackAndFix(tags) || selectDateTag(tags) };
  } catch (error) {
    d_.E(error);
  }
}

async function parseFiles(files) {
  // extract date from exif data
  let startMs = Date.now();
  const exifFiles = await Promise.all(
    files.map(async (f) => {
      d_.D(`parseFiles start:${f.path}`);
      const { date, exif } = await getExifDate(f.path);
      d_.D(`parseFiles end:${f.path} ${date}`);
      return (
        date && {
          path: f.path,
          root: f.root,
          size: f.stats.size,
          date: date[1].toDate(),
          rawDate: date,
          // rawExif: exif,
        }
      );
    })
  );
  await et.end();
  d_.I(`parseFiles ${exifFiles.length} in ${Date.now() - startMs}ms`);
  return exifFiles.filter(Boolean);
}

// new name by exif date time
// eg. DSC_20210119_111546.ARW
// eg. IMG_20210121_174456.JPG
function createNameByDate(file) {
  // create file name by exif date
  let prefix;
  if (h_.isImageFile(file.path)) {
    prefix = "IMG_";
  } else if (h_.isRawFile(file.path)) {
    prefix = "DSC_";
  } else {
    prefix = "VID_";
  }
  const ext = h_.getExtname(file.path);
  const ms = file.rawDate[1]?.millisecond || 0;
  // https://dayjs.gitee.io/docs/zh-CN/display/format
  const dateStr = dayjs(file.date).format("YYYYMMDD_HHmmss");
  if (ms > 0) {
    dstName = `${prefix}${dateStr}_${ms}${ext}`;
  } else {
    dstName = `${prefix}${dateStr}${ext}`;
  }
  file["outName"] = dstName;
  d_.D(`createNameByDate ${h_.shortPath(file.path)} ${file.outName}}`);
  return file;
}

function buildNames(files) {
  let startMs = Date.now();
  const newFiles = files.map((f) => createNameByDate(f));
  d_.I(`buildNames time: ${Date.now() - startMs}ms`);
  return newFiles;
}

function checkFiles(files) {
  // filter small files and invalid date files
  d_.D(`checkFiles before filter: ${files.length} files`);
  files = files.filter((f) => {
    if (h_.isVideoFile(f.path) && f.size < 10 * 1024 * 1024) {
      d_.I(
        chalk.yellow(`Skip [Size]: `) +
          `${h_.shortPath(f.path)} <${Math.round(f.size / 1024)}k>`
      );
      return false;
    }
    if (f.date.getHours() < 7 || f.rawDate.hour < 7) {
      const dateStr = dayjs(f.date).format("YYYY-MM-DD HH:mm:ss Z");
      d_.W(
        chalk.yellow(`Skip [Date]: `) + `${h_.shortPath(f.path)} <${dateStr}>`
      );
      return false;
    }
    const inName = path.basename(f.path, path.extname(f.path));
    const outName = path.basename(f.outName, path.extname(f.outName));
    // if name without extension is almost same, skip the file
    if (
      outName == inName ||
      inName.includes(outName) ||
      outName.includes(inName)
    ) {
      d_.I(chalk.gray(`Skip [Name]: ${h_.shortPath(f.path)} <${f.outName}>`));
      return false;
    } else {
      return true;
    }
  });
  d_.D(`checkFiles after filter: ${files.length} files`);
  // check name duplicate conficts and using name suffix
  const duplicateSet = new Set();
  files = files.map((f) => {
    const name = path.basename(f.path);
    const ext = h_.getExtname(name);
    const originalOutName = path.basename(f.outName, ext);
    let outName = originalOutName;
    let outPath = path.join(path.dirname(f.path), outName + ext);
    let dupSuffix = ["A", "B", "C", "D", "E", "F", "G", "H"];
    let dupIndex = 0;
    while (duplicateSet.has(outName)) {
      outName = originalOutName + "_" + dupSuffix[dupIndex];
      outPath = path.join(path.dirname(f.path), outName + ext);
      dupIndex++;
    }
    duplicateSet.add(outName);
    const newOutName = outName + ext;
    if (f.outName != newOutName) {
      d_.INFO(chalk.yellow(`Duplicated: ${f.outName} to ${newOutName}`));
    }
    f.outName = newOutName;
    d_.L(
      chalk.green(`Prepared:`) + ` ${h_.shortPath(f.path)} ==> ${f.outName}`
    );
    return f;
  });
  return files;
}

async function renameFiles(files) {
  d_.D(`renameFiles before: ${files.length} files`);
  // do rename all files
  return await Promise.all(
    files.map(async (f) => {
      const outPath = path.join(path.dirname(f.path), f.outName);
      try {
        await fs.rename(f.path, outPath);
        d_.L(chalk.green(`Renamed:`) + ` ${outPath}`);
        return f;
      } catch (error) {
        d_.E(error);
      }
    })
  );
}

async function checkRoot(root) {
  if (!root || !fs.existsSync(root)) {
    d_.W(`checkRoot source '${root} is not exists'`);
    return;
  }
  if (fs.statSync(root).isFile()) {
    showExifDate(root);
    return;
  }
  if (!fs.statSync(root).isDirectory()) {
    d_.W(`checkRoot source '${root} is not directory'`);
    await et.end();
    return;
  }
  return path.resolve(root);
}

async function executeRename(root) {
  root = await checkRoot(root);
  if (!root) {
    d_.W(`executeRename Invalid Path: ${root}`);
    return;
  }
  // action: rename media file by exif date
  const startMs = Date.now();
  d_.L(chalk.yellow(`Source: ${root}`));
  let files = await listFiles(root);
  const filesCount = files.length;
  d_.L(`Total ${files.length} media files found`);
  files = await parseFiles(files);
  d_.L(`Total ${files.length} media files have exif date`);
  files = buildNames(files);
  files = checkFiles(files);
  if (files.length > 0) {
    d_.L(`Total ${files.length} media files need to rename`);
  }
  const skipCount = filesCount - files.length;
  if (skipCount > 0) {
    d_.L(`Total ${skipCount} media files are skipped`);
  }
  d_.L(
    `Total ${filesCount} files processed in ${(Date.now() - startMs) / 1000}s`
  );
  d_.L(chalk.yellow(`Source: ${root}`));
  if (files.length == 0) {
    d_.L(chalk.green("Nothing to do, exit now."));
    return;
  }
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to rename ${files.length} files?`),
    },
  ]);
  if (answer.yes) {
    renameFiles(files).then((files) => {
      d_.L(chalk.green9`There ${files.length} file were renamed.`);
    });
  } else {
    d_.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function executeMove() {}

module.exports.showExifDate = showExifDate;
module.exports.executeRename = executeRename;
