#!/usr/bin/env node

const os = require("os");
const path = require("path");
const inquirer = require("inquirer");
const fs = require("fs-extra");
const dateFormat = require("date-fns/format");
const klawSync = require("klaw-sync");
const parseArgs = require("minimist");
const chalk = require("chalk");
const ExifTool = require("exiftool-vendored").ExifTool;
const { ExifDateTime } = require("exiftool-vendored");
const {
  isVideoFile,
  isMediaFile,
  getExtname,
  isImageFile,
  isRawFile,
} = require("./lib/constants");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

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
  return getExtname(tags.FileName) == "png" && tags.FileModifyDate;
}

function hackAndFix(tags) {
  return fixSonyTag(tags) || fixAppleTag(tags) || fixScreenShot(tags);
}

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

function selectDateTag(tags) {
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
  try {
    const tags = await et.read(filename);
    return { exif: tags, date: hackAndFix(tags) || selectDateTag(tags) };
  } catch (error) {
    console.error(error);
  }
}

// new name by exif date time
// eg. DSC_20210119_111546.ARW
// eg. IMG_20210121_174456.JPG
function createNameByDate(file) {
  let prefix;
  if (isImageFile(file.path)) {
    prefix = "IMG_";
  } else if (isRawFile(file.path)) {
    prefix = "DSC_";
  } else {
    prefix = "VID_";
  }
  const ext = path.extname(file.path);
  const rawDate = file.rawDate[1];
  let dateStr = dateFormat(file.date, "yyyyMMdd_HHmmss");
  if (rawDate.millisecond > 0) {
    dstName = `${prefix}${dateStr}_${rawDate.millisecond}${ext}`;
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

async function listFiles(root) {
  const filterMedia = (item) => {
    return isMediaFile(item.path) && item.stats.size > 100 * 1024;
  };
  let startMs = Date.now();
  let files = klawSync(root, {
    nodir: true,
    traverseAll: true,
    filter: filterMedia,
  });
  console.log(`listFiles ${files.length} files in ${Date.now() - startMs}ms`);
  return files;
}

async function parseFiles(files) {
  let startMs = Date.now();
  const exifFiles = await Promise.all(
    files.map(async (f) => {
      const { date, exif } = await getExifDate(f.path);
      return (
        date && {
          path: f.path,
          size: f.stats.size,
          date: date[1].toDate(),
          rawDate: date,
          rawExif: exif,
        }
      );
    })
  );
  await et.end();
  console.log(`parseFiles ${exifFiles.length} in ${Date.now() - startMs}ms`);
  return exifFiles.filter(Boolean);
}

function checkFiles(files) {
  files = files.filter((f) => {
    if (isVideoFile(f.path) && f.size < 10 * 1024 * 1024) {
      console.warn(
        chalk.yellow(`Skip [Size]: `) + `${f.path} ${f.size / 1000}k`
      );
      return false;
    }
    if (f.date.getHours() < 7 || f.rawDate.hour < 7) {
      console.warn(chalk.yellow(`Skip [Date]: `) + `${f.path} ${f.date}`);
      return false;
    }
    const inName = path.basename(f.path, path.extname(f.path));
    const outName = path.basename(f.outName, path.extname(f.outName));
    if (
      outName == inName ||
      inName.includes(outName) ||
      outName.includes(inName)
    ) {
      console.log(chalk.gray(`Skip [Name]: ${f.path}`));
      return false;
    } else {
      return true;
    }
  });
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

async function executeRename() {
  const argv = parseArgs(process.argv.slice(2));
  console.log(argv);
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
  console.log(`Root: ${root}`);
  let files = await listFiles(root);
  console.log(`Total files found in root: ${files.length}`);
  files = await parseFiles(files);
  console.log(`Total files has exif date: ${files.length}`);
  files = buildNames(files);
  files = checkFiles(files);
  console.log(`Total files need to rename: ${files.length}`);
  if (files.length == 0) {
    console.log(chalk.green("Nothing to do, exit now."));
    return;
  }
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

main();
