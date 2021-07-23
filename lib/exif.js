#!/usr/bin/env node

const os = require("os");
const path = require("path");
const inquirer = require("inquirer");
const fs = require("fs-extra");
const dayjs = require("dayjs");
const klawSync = require("klaw-sync");
const chalk = require("chalk");
const ExifTool = require("exiftool-vendored").ExifTool;
const { ExifDateTime } = require("exiftool-vendored");
const h = require("./helper");
const d = require("./debug");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

async function showExifDate(filename) {
  try {
    const tags = await et.read(filename);
    d.L(tags);
  } catch (error) {
    d.E(error);
  } finally {
    await et.end();
  }
}

function listFiles(root, filterFn) {
  // list all files in root dir, exclude small files
  let startMs = Date.now();
  let files = klawSync(root, {
    nodir: true,
    traverseAll: true,
    filter: filterFn,
  });
  files = files.map((f) => {
    f.root = root;
    return f;
  });
  d.I(`listFiles: ${files.length} files found in ${h.ht(startMs)}`);
  return files;
}

async function readTags(files) {
  // files => file list
  // or files => root
  // if (typeof files == "string") {
  //   files = listFiles(files);
  // }
  let startMs = Date.now();
  files = await Promise.all(
    files.map(async (f) => {
      const filename = f.path;
      try {
        const tags = await et.read(filename);
        // show exiftool error message
        if (tags.Error) {
          d.W(tags.Error);
        }
        d.D(
          `readTags: processing ${h.ps(filename)} ${
            tags && tags.MIMEType
          } ${h.fz(f.stats.size)}`
        );
        f.tags = tags;
      } catch (error) {
        d.E(error);
      }
      return f;
    })
  );
  await et.end();
  d.I(`readTags: ${files.length} files processed in ${h.ht(startMs)}`);
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
    d.D("fixSonyTag:", tags.SourceFile);
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
    d.D("fixAppleTag:", tags.SourceFile);
    return ["CreationDate", tags.CreationDate];
  }
}

function fixScreenShot(tags) {
  return (
    h.ext(tags.FileName, true) == "png" && [
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

function extractExifDate(file) {
  return (
    file && file.tags && (hackAndFix(file.tags) || selectDateTag(file.tags))
  );
}

async function parseFiles(files) {
  // extract date from exif data
  let startMs = Date.now();
  files = await readTags(files);
  files = await Promise.all(
    files.map(async (f) => {
      const date = extractExifDate(f);
      d.D(`parseFiles ${f.path} ${date}`);
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
  d.I(`parseFiles ${files.length} in ${h.ht(startMs)}`);
  return files.filter(Boolean);
}

// new name by exif date time
// eg. DSC_20210119_111546.ARW
// eg. IMG_20210121_174456.JPG
function createNameByDate(file) {
  // create file name by exif date
  let prefix;
  if (h.isImageFile(file.path)) {
    prefix = "IMG_";
  } else if (h.isRawFile(file.path)) {
    prefix = "DSC_";
  } else {
    prefix = "VID_";
  }
  const ext = h.ext(file.path);
  const ms = file.rawDate[1]?.millisecond || 0;
  // https://dayjs.gitee.io/docs/zh-CN/display/format
  const dateStr = dayjs(file.date).format("YYYYMMDD_HHmmss");
  if (ms > 0) {
    dstName = `${prefix}${dateStr}_${ms}${ext}`;
  } else {
    dstName = `${prefix}${dateStr}${ext}`;
  }
  file["outName"] = dstName;
  d.D(`createNameByDate ${h.ps(file.path)} ${file.outName}`);
  return file;
}

function buildNames(files) {
  let startMs = Date.now();
  const newFiles = files.map((f) => createNameByDate(f));
  d.I(`buildNames time: ${Date.now() - startMs}`);
  return newFiles;
}

function checkFiles(files) {
  // filter small files and invalid date files
  d.D(`checkFiles before filter: ${files.length} files`);
  files = files.filter((f) => {
    if (h.isVideoFile(f.path) && f.size < 10 * 1024 * 1024) {
      d.I(chalk.yellow(`Skip [Size]: `) + `${h.ps(f.path)} <${h.fz(f.size)}>`);
      return false;
    }
    if (f.date.getHours() < 7 || f.rawDate.hour < 7) {
      const dateStr = dayjs(f.date).format("YYYY-MM-DD HH:mm:ss Z");
      d.W(chalk.yellow(`Skip [Date]: `) + `${h.ps(f.path)} <${dateStr}>`);
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
      d.I(chalk.gray(`Skip [Name]: ${h.ps(f.path)} <${f.outName}>`));
      return false;
    } else {
      return true;
    }
  });
  d.D(`checkFiles after filter: ${files.length} files`);
  // check name duplicate conficts and using name suffix
  const duplicateSet = new Set();
  files = files.map((f) => {
    const name = path.basename(f.path);
    const ext = h.ext(name);
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
      d.I(chalk.yellow(`Duplicated: ${f.outName} to ${newOutName}`));
    }
    f.outName = newOutName;
    d.L(chalk.green(`Prepared:`) + ` ${h.ps(f.path)} ==> ${f.outName}`);
    return f;
  });
  return files;
}

async function renameFiles(files) {
  d.D(`renameFiles before: ${files.length} files`);
  // do rename all files
  return await Promise.all(
    files.map(async (f) => {
      const outPath = path.join(path.dirname(f.path), f.outName);
      try {
        await fs.rename(f.path, outPath);
        d.L(chalk.green(`Renamed:`) + ` ${outPath}`);
        return f;
      } catch (error) {
        d.E(error);
      }
    })
  );
}

async function checkRoot(root) {
  if (!root || !fs.existsSync(root)) {
    d.W(`checkRoot source '${root} is not exists'`);
    return;
  }
  if (fs.statSync(root).isFile()) {
    showExifDate(root);
    return;
  }
  if (!fs.statSync(root).isDirectory()) {
    d.W(`checkRoot source '${root} is not directory'`);
    await et.end();
    return;
  }
  return path.resolve(root);
}

async function executeRename(root) {
  root = await checkRoot(root);
  if (!root) {
    d.W(`executeRename Invalid Path: ${root}`);
    return;
  }
  // action: rename media file by exif date
  const startMs = Date.now();
  d.L(chalk.yellow(`Source: ${root}`));
  let files = await listFiles(root);
  // exclude non-media files
  files = files.filter((f) => h.isMediaFile(f.path));
  const filesCount = files.length;
  d.L(`Total ${files.length} media files found`);
  files = await parseFiles(files);
  d.L(`Total ${files.length} media files have exif date`);
  files = buildNames(files);
  files = checkFiles(files);
  d.L(`Total ${filesCount} files processed in ${h.ht(startMs)}ms`);
  const skipCount = filesCount - files.length;
  if (skipCount > 0) {
    d.L(`Total ${skipCount} media files are skipped`);
  }
  d.L(chalk.yellow(`Source: ${root}`));
  if (files.length == 0) {
    d.L(chalk.green("Nothing to do, exit now."));
    return;
  }
  d.L(`Total ${files.length} media files ready to rename`);
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
      d.L(chalk.green9`There ${files.length} file were renamed.`);
    });
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function executeMove() {}

module.exports.listFiles = listFiles;
module.exports.readTags = readTags;
module.exports.showExifDate = showExifDate;
module.exports.executeRename = executeRename;
