#!/usr/bin/env node
const os = require("os");
const path = require("path");
const dayjs = require("dayjs");
const chalk = require("chalk");
const ExifTool = require("exiftool-vendored").ExifTool;
const { ExifDateTime } = require("exiftool-vendored");
const helper = require("./helper");
const log = require("./debug");
const mf = require("./file");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

async function listMedia(root) {
  return await mf.walk(root, {
    entryFilter: (entry) =>
      entry.stats.isFile() && helper.isMediaFile(entry.path),
  });
}

async function readSingleExif(filename) {
  try {
    return await et.read(filename);
  } catch (error) {
    log.error(error);
  } finally {
    await et.end();
  }
}

async function showExifDate(filename) {
  log.show(readTags(filename) || `No exif tags found for ${filename}`);
}

async function readAllTags(files) {
  // files => file list
  // or files => root
  // if (typeof files == "string") {
  //   files = listFiles(files);
  // }
  const t = files.length;
  let startMs = Date.now();
  files = await Promise.all(
    files.map(async (f, i) => {
      const filename = f.path;
      try {
        const tags = await et.read(filename);
        // show exiftool error message
        if (tags.Error) {
          log.warn(`readAllTags: err ${helper.pathShort(filename)} ${error}`);
        }
        log.info(
          `readAllTags(${i}/${t}):`,
          helper.pathShort(filename),
          tags.FileModifyDate.rawValue
        );
        f.tags = tags;
      } catch (error) {
        log.warn(`readAllTags: catch ${helper.pathShort(filename)} ${error}`);
      }
      return f;
    })
  );
  await et.end();
  log.info(
    `readAllTags: ${files.length} files processed in ${helper.humanTime(
      startMs
    )}`
  );
  return files.filter((f) => f.tags);
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
    log.debug("fixSonyTag:", tags.SourceFile);
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
    log.debug("fixAppleTag:", tags.SourceFile);
    return ["CreationDate", tags.CreationDate];
  }
}

function fixScreenShot(tags) {
  return (
    helper.pathExt(tags.FileName, true) == "png" && [
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

async function parseFiles(files, options) {
  log.info(`parseFiles`, options);
  options = options || {};
  // fast mode, skip exif parse
  if (options.fastMode) {
    return files.map((f) => {
      const date = f.stats.mtime;
      log.debug(`parseFiles`, ` ${f.path} ${date}`);
      return (
        date && {
          path: f.path,
          root: f.root,
          size: f.stats.size,
          date: f.stats.mtime,
        }
      );
    });
  }
  // extract date from exif data
  let startMs = Date.now();
  files = await readAllTags(files);
  files = await Promise.all(
    files.map(async (f) => {
      const date = extractExifDate(f);
      log.debug(`parseFiles`, ` ${f.path} ${date}`);
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
  log.info(`parseFiles ${files.length} in ${helper.humanTime(startMs)}`);
  return files.filter(Boolean);
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
  const ext = helper.pathExt(file.path);
  const ms = (file.rawDate && file.rawDate[1].millisecond) || 0;
  // https://dayjs.gitee.io/docs/zh-CN/display/format
  const dateStr = dayjs(file.date).format("YYYYMMDD_HHmmss");
  if (ms > 0) {
    dstName = `${prefix}${dateStr}_${ms}${ext}`;
  } else {
    dstName = `${prefix}${dateStr}${ext}`;
  }
  file["outName"] = dstName;
  log.debug(`createNameByDate ${helper.pathShort(file.path)} ${file.outName}`);
  return file;
}

function buildNames(files) {
  let startMs = Date.now();
  const newFiles = files.map((f) => createNameByDate(f));
  log.debug(`buildNames time: ${Date.now() - startMs}`);
  return newFiles;
}

function checkFiles(files) {
  log.info(`checkFiles before filter: ${files.length} files`);
  const skippedByDate = [];
  const skippedBySize = [];
  files = files.filter((f) => {
    if (helper.isVideoFile(f.path) && f.size < 500 * 1024) {
      log.info(
        `Check [Size]:`,
        `${helper.pathShort(f.path)} <${helper.fileSize(f.size)}>`
      );
      skippedBySize.push(f);
      return false;
    }
    if (f.date.getHours() < 7) {
      if (!helper.pathExt(f.path) === ".png") {
        const dateStr = dayjs(f.date).format("YYYY-MM-DD HH:mm:ss Z");
        log.warn(`Check [Date]:`, `${helper.pathShort(f.path)} <${dateStr}>`);
        skippedByDate.push(f);
        return false;
      }
    }
    const inName = path.basename(f.path, path.extname(f.path));
    const outName = path.basename(f.outName, path.extname(f.outName));
    // if name without extension is almost same, skip the file
    if (
      outName == inName ||
      inName.includes(outName) ||
      outName.includes(inName)
    ) {
      log.debug(`Skip [Name]: ${helper.pathShort(f.path)} <${f.outName}>`);
      return false;
    } else {
      return true;
    }
  });
  log.info(`checkFiles after filter: ${files.length} files`);
  // check name duplicate conficts and using name suffix
  const duplicateSet = new Set();
  files = files.map((f) => {
    const name = path.basename(f.path);
    const ext = helper.pathExt(name);
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
      log.info(chalk.yellow(`Duplicated: ${f.outName} to ${newOutName}`));
    }
    f.outName = newOutName;
    log.show(
      chalk.green(`Prepared:`) + ` ${helper.pathShort(f.path)} ==> ${f.outName}`
    );
    return f;
  });
  return [files, skippedBySize, skippedByDate];
}

module.exports.listMedia = listMedia;
module.exports.readSingleExif = readSingleExif;
module.exports.readAllTags = readAllTags;
module.exports.showExifDate = showExifDate;
module.exports.parseFiles = parseFiles;
module.exports.checkFiles = checkFiles;
module.exports.buildNames = buildNames;
