#!/usr/bin/env node

const os = require("os");
const path = require("path");
const readline = require("readline");
const fs = require("fs-extra");
const dateFormat = require("date-fns/format");
const klawSync = require("klaw-sync");
const parseArgs = require("minimist");
const ExifTool = require("exiftool-vendored").ExifTool;
const { ExifDateTime } = require("exiftool-vendored");
const et = new ExifTool({
  taskTimeoutMillis: 5000,
  maxTasksPerProcess: 1000,
  maxProcs: os.cpus().length,
});

const IMAGE_FORMATS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".avif",
  ".heic",
  ".heif",
  ".webp",
  ".tiff",
];
const RAW_FORMATS = [
  ".crw",
  ".cr2",
  ".cr3",
  ".nef",
  ".nrw",
  ".arw",
  ".srf",
  ".sr2",
  ".raw",
  ".rw2",
  ".raf",
  ".dng",
];
const VIDEO_FORMATS = [".mp4", ".mov", ".wmv", ".avi", ".mkv"];

const VALID_FORMATS = IMAGE_FORMATS + RAW_FORMATS + VIDEO_FORMATS;

function isVideo(filename) {
  const ext = path.extname(filename);
  return ext && VIDEO_FORMATS.contains(ext.toLowerCase());
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
    return tags.FileModifyDate;
  }
}

function fixAppleTag(tags) {
  // iphone video must use CreationDate, not CreateDate
  //  CreationDate rawValue: '2021:06:21 10:22:47+08:00',
  // CreateDate rawValue: '2021:06:21 02:22:47',
  if (
    tags.CreationDate instanceof ExifDateTime &&
    tags.MajorBrand &&
    tags.MajorBrand.toLowerCase().includes("apple")
  ) {
    // console.log("Hack2:", tags.SourceFile);
    return tags.CreationDate;
  }
}

function hackAndFix(tags) {
  return fixSonyTag(tags) || fixAppleTag(tags);
}

function convertDate(exifDate) {
  return (
    exifDate &&
    new Date(
      exifDate.year,
      exifDate.month - 1,
      exifDate.day,
      exifDate.hour,
      exifDate.minute,
      exifDate.second,
      exifDate.millisecond
    )
  );
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
  let dateTags = [
    tags.CreationDate,
    tags.MediaCreateDate,
    tags.MediaModifyDate,
    tags.DateTimeOriginal,
    tags.SubSecCreateDate,
    tags.SubSecDateTimeOriginal,
    tags.CreateDate,
    tags.ModifyDate,
    tags.FileModifyDate,
  ];
  dateTags = dateTags.filter((t) => t instanceof ExifDateTime);
  //   console.log(dateTags);
  return dateTags && dateTags[0];
}

async function getExifDate(filename) {
  try {
    const tags = await et.read(filename);
    return hackAndFix(tags) || selectDateTag(tags);
  } catch (error) {
    console.error(error);
  }
}

// new name by exif date time
// eg. DSC_20210119_111546.ARW
// eg. IMG_20210121_174456.JPG
function createNameByDate(file) {
  const date = file.rawDate;
  const srcName = path.basename(file.path);
  const ext = path.extname(file.path);
  let prefix;
  if (IMAGE_FORMATS.includes(ext.toLowerCase())) {
    prefix = "IMG_";
  } else if (RAW_FORMATS.includes(ext.toLowerCase())) {
    prefix = "DSC_";
  } else {
    prefix = "VID_";
  }
  let dateStr = dateFormat(file.date, "yyyyMMdd_HHmmss");
  if (date.millisecond > 0) {
    dstName = `${prefix}${dateStr}_${date.millisecond}${ext}`;
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
    let ext = path.extname(item.path);
    return (
      ext &&
      VALID_FORMATS.includes(ext.toLowerCase()) &&
      item.stats.size > 100 * 1024
    );
  };
  let startMs = Date.now();
  let files = klawSync(root, {
    nodir: true,
    traverseAll: true,
    filter: filterMedia,
  });
  console.log(`listFiles time: ${Date.now() - startMs}ms`);
  console.log(`listFiles count: ${files.length}`);
  return files;
}

async function parseFiles(files) {
  let startMs = Date.now();
  const dstFiles = await Promise.all(
    files.map(async (f) => {
      const exifDate = await getExifDate(f.path);
      const jsDate = convertDate(exifDate);
      return (
        jsDate && {
          path: f.path,
          size: f.stats.size,
          date: jsDate,
          rawDate: exifDate,
        }
      );
    })
  );
  await et.end();
  console.log(`parseFiles time: ${Date.now() - startMs}ms`);
  return dstFiles.filter(Boolean);
}

async function renameFiles(files) {
  return await Promise.all(
    files.map(async (f) => {
      const outPath = path.join(path.dirname(f.path), f.outName);
      try {
        await fs.rename(f.path, outPath);
        console.log(`Renamed: ${outPath}`);
        return f;
      } catch (error) {
        console.error(error);
      }
    })
  );
}

async function main() {
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
  console.log(`Total files count (dir): ${files.length}`);
  files = await parseFiles(files);
  console.log(`Total files count (exif): ${files.length}`);
  files = buildNames(files);
  console.log(`Total files count (before): ${files.length}`);
  files = files.filter((f) => {
    // console.log(f);
    if (f.date.getHours() < 7 || f.rawDate.hour < 7) {
      console.warn("Invalid Date:", f);
      return false;
    }
    const inName = path.basename(f.path, path.extname(f.path));
    const outName = path.basename(f.outName, path.extname(f.outName));
    if (
      outName == inName ||
      inName.includes(outName) ||
      outName.includes(inName)
    ) {
      //   console.log(`Skip: ${f.path}`);
      return false;
    } else {
      console.log(`Task: ${f.path} => ${f.outName}`);
      return true;
    }
  });
  console.log(`Total files count (after): ${files.length}`);
  if (files.length == 0) {
    console.log("Nothing to do, quit now.");
    return;
  }

  const rdi = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rdi.question(
    `Are you sure to rename ${files.length} files？`,
    function (answer) {
      rdi.close();
      if (answer == "y" || answer == "yes") {
        renameFiles(files).then((files) => {
          console.log(`Total files count (renamed): ${files.length}`);
        });
      } else {
        console.log("Nothing to do, aborted by user.");
      }
    }
  );
}

main();
