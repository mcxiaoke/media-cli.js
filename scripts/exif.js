#!/usr/bin/env node

const os = require("os");
const path = require("path");
const inquirer = require("inquirer");
const fs = require("fs-extra");
const dayjs = require("dayjs");
const klawSync = require("klaw-sync");
const parseArgs = require("minimist");
const chalk = require("chalk");
const ExifTool = require("exiftool-vendored").ExifTool;
const { ExifDateTime } = require("exiftool-vendored");
const helper = require("./helper");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

async function showExifDate(filename) {
  try {
    const tags = await et.read(filename);
    console.log(tags);
  } catch (error) {
    console.error(error);
  } finally {
    await et.end();
  }
}

async function listFiles(root) {
  // list all files in root dir
  const filterMedia = (item) => {
    return helper.isMediaFile(item.path) && item.stats.size > 100 * 1024;
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
  console.log(`listFiles ${files.length} files in ${Date.now() - startMs}ms`);
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
    // console.log("Hack1:", tags.SourceFile);
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
    // console.log("Hack2:", tags.SourceFile);
    return ["CreationDate", tags.CreationDate];
  }
}

function fixScreenShot(tags) {
  return (
    helper.getExtname(tags.FileName) == "png" && [
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
    return { exif: tags, date: hackAndFix(tags) || selectDateTag(tags) };
  } catch (error) {
    console.error(error);
  }
}

async function parseFiles(files) {
  // extract date from exif data
  let startMs = Date.now();
  const exifFiles = await Promise.all(
    files.map(async (f) => {
      const { date, exif } = await getExifDate(f.path);
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
  console.log(`parseFiles ${exifFiles.length} in ${Date.now() - startMs}ms`);
  return exifFiles.filter(Boolean);
}

// new name by exif date time
// eg. DSC_20210119_111546.ARW
// eg. IMG_20210121_174456.JPG
function createNameByDate(file) {
  // create file name by exif date
  let prefix;
  if (helper.isImageFile(file.path)) {
    prefix = "IMG_";
  } else if (helper.isRawFile(file.path)) {
    prefix = "DSC_";
  } else {
    prefix = "VID_";
  }
  const ext = helper.getExtname(file.path);
  const ms = file.rawDate[1]?.millisecond || 0;
  // https://dayjs.gitee.io/docs/zh-CN/display/format
  const dateStr = dayjs(file.date).format("YYYYMMDD_HHmmss");
  if (ms > 0) {
    dstName = `${prefix}${dateStr}_${ms}${ext}`;
  } else {
    dstName = `${prefix}${dateStr}${ext}`;
  }
  file["outName"] = dstName;
  return file;
}

function buildNames(files) {
  let startMs = Date.now();
  const newFiles = files.map((f) => createNameByDate(f));
  console.log(`buildNames time: ${Date.now() - startMs}ms`);
  return newFiles;
}

function checkFiles(files) {
  // filter small files and invalid date files
  files = files.filter((f) => {
    if (helper.isVideoFile(f.path) && f.size < 10 * 1024 * 1024) {
      console.warn(
        chalk.yellow(`Skip [Size]: `) +
          `${f.path} <${Math.round(f.size / 1024)}k>`
      );
      return false;
    }
    if (f.date.getHours() < 7 || f.rawDate.hour < 7) {
      const dateStr = dayjs(f.date).format("YYYY-MM-DD HH:mm:ss Z");
      console.warn(chalk.yellow(`Skip [Date]: `) + `${f.path} <${dateStr}>`);
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
      console.log(chalk.gray(`Skip [Name]: ${f.path} <${f.outName}>`));
      return false;
    } else {
      return true;
    }
  });
  // check name duplicate conficts and using name suffix
  const duplicateSet = new Set();
  files = files.map((f) => {
    const name = path.basename(f.path);
    const ext = path.extname(name);
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
      console.log(chalk.green(`Confict: ${f.outName} to ${newOutName}`));
    }
    f.outName = outName + ext;
    console.log(
      chalk.green(`Prepared [Rename]:`) + ` ${name} ==> ${f.outName}`
    );
    return f;
  });
  return files;
}

async function renameFiles(files) {
  // do rename all files
  return await Promise.all(
    files.map(async (f) => {
      const outPath = path.join(path.dirname(f.path), f.outName);
      try {
        await fs.rename(f.path, outPath);
        console.log(chalk.green(`Renamed:`) + ` ${outPath}`);
        return f;
      } catch (error) {
        console.error(error);
      }
    })
  );
}

async function checkRoot() {
  const argv = parseArgs(process.argv.slice(2));
  //   console.log(argv);
  root = argv._[0];
  if (!root || !fs.existsSync(root)) {
    return;
  }
  if (fs.statSync(root).isFile()) {
    showExifDate(root);
    return;
  }
  if (!fs.statSync(root).isDirectory()) {
    await et.end();
    return;
  }
  return path.resolve(root);
}

async function executeRename() {
  // action: rename media file by exif date
  const root = await checkRoot();
  if (!root) {
    return;
  }
  console.log(`Root: ${root}`);
  let files = await listFiles(root);
  console.log(`Total media files found in root: ${files.length}`);
  files = await parseFiles(files);
  console.log(`Total media files has exif date: ${files.length}`);
  files = buildNames(files);
  files = checkFiles(files);
  console.log(`Total media files need to rename: ${files.length}`);
  if (files.length == 0) {
    console.log(chalk.green("Nothing to do, exit now."));
    return;
  }
  console.log(`Root: ${root}`);
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.red(`Are you sure to rename ${files.length} files?`),
    },
  ]);
  if (answer.yes) {
    renameFiles(files).then((files) => {
      console.log(`There ${files.length} file were renamed.`);
    });
  } else {
    console.log(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}

async function main() {
  await executeRename();
}

if (require.main) {
  main();
}

module.exports.showExifDate = showExifDate;
module.exports.executeRename = executeRename;
