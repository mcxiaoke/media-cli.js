const path = require("path");

const IMAGE_FORMATS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".avif",
  ".heic",
  ".heif",
  ".gif",
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

const VIDEO_FORMATS = [".mp4", ".mov", ".wmv", ".avi", ".mkv", ".flv", ".webm"];

const MEDIA_FORMATS = [...RAW_FORMATS, ...IMAGE_FORMATS, ...VIDEO_FORMATS];

// https://stackoverflow.com/questions/1144783/
// simple: str.split(search).join(replacement)
// or str = str.replace(/abc/g, '');
// function replaceAll(str, find, replace) {
//   return str.replace(new RegExp(find, 'g'), replace);
// }
function escapeRegExp(string) {
  return string.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
  // $& means the whole matched string
}
function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), "g"), replace);
}

function humanTime(startMs) {
  // TIP: to find current time in milliseconds, use:
  // var  current_time_milliseconds = new Date().getTime();
  function numberEnding(number) {
    return number > 1 ? "s" : "";
  }
  var milliseconds = Date.now() - startMs;
  var temp = Math.floor(milliseconds / 1000);
  var years = Math.floor(temp / 31536000);
  if (years) {
    return years + " year" + numberEnding(years);
  }
  //TODO: Months! Maybe weeks?
  var days = Math.floor((temp %= 31536000) / 86400);
  if (days) {
    return days + " day" + numberEnding(days);
  }
  var hours = Math.floor((temp %= 86400) / 3600);
  if (hours) {
    return hours + " hour" + numberEnding(hours);
  }
  var minutes = Math.floor((temp %= 3600) / 60);
  if (minutes) {
    return minutes + " minute" + numberEnding(minutes);
  }
  var seconds = temp % 60;
  if (seconds) {
    return seconds + " second" + numberEnding(seconds);
  }
  return milliseconds + " ms";
}

// https://stackoverflow.com/questions/10420352/
function fileSizeSI(a, b, c, d, e) {
  return (
    ((b = Math),
    (c = b.log),
    (d = 1e3),
    (e = (c(a) / c(d)) | 0),
    a / b.pow(d, e)).toFixed(2) +
    " " +
    (e ? "kMGTPEZY"[--e] + "B" : "Bytes")
  );
}

function fileSizeIEC(a, b, c, d, e) {
  return (
    ((b = Math),
    (c = b.log),
    (d = 1024),
    (e = (c(a) / c(d)) | 0),
    a / b.pow(d, e)).toFixed(2) +
    " " +
    (e ? "KMGTPEZY"[--e] + "iB" : "Bytes")
  );
}

function pathShort(s, width = 48) {
  // shorten long path by segments
  if (!s || s.length < width) {
    return s;
  }
  let parts = s.split(path.sep);
  if (parts.length < 4) {
    return s;
  }
  let length = 0;
  let index = 0;
  for (let i = 0; i < parts.length; i++) {
    length += parts[i].length;
    index = i;
    if (s.length - length < width) {
      break;
    }
  }
  // console.log(parts, s.length, length, index);
  return path.join("...", ...parts.slice(index));
}

function pathSplit(fullpath) {
  abspath = path.resolve(fullpath);
  filename = path.basename(abspath);
  d = path.dirname(abspath);
  e = path.extname(abspath);
  b = path.basename(filename, e);
  // dir,base,ext
  return [d, b, e];
}

function pathExt(filename, toLowerCase = false) {
  const ext = path.extname(filename);
  return toLowerCase ? ext && ext.toLowerCase() : ext;
}

function isImageFile(filename) {
  return IMAGE_FORMATS.includes(pathExt(filename, true));
}

function isRawFile(filename) {
  return RAW_FORMATS.includes(pathExt(filename, true));
}

function isVideoFile(filename) {
  return VIDEO_FORMATS.includes(pathExt(filename, true));
}

function isMediaFile(filename) {
  return MEDIA_FORMATS.includes(pathExt(filename, true));
}

module.exports.isImageFile = isImageFile;
module.exports.isRawFile = isRawFile;
module.exports.isVideoFile = isVideoFile;
module.exports.isMediaFile = isMediaFile;
module.exports.pathExt = pathExt;
module.exports.pathShort = pathShort;
module.exports.fileSize = fileSizeSI;
module.exports.humanTime = humanTime;
module.exports.replaceAll = replaceAll;
module.exports.pathSplit = pathSplit;
