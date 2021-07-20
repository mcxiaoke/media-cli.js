const path = require("path");

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

const AUDIO_FORMATS = [
  ".mp3",
  ".m4a",
  ".aac",
  ".ogg",
  ".wma",
  ".ape",
  ".flac",
  ".tta",
  ".vox",
  ".wav",
];

const VIDEO_FORMATS = [".mp4", ".mov", ".wmv", ".avi", ".mkv", ".flv", ".webm"];

const MEDIA_FORMATS = IMAGE_FORMATS + RAW_FORMATS + VIDEO_FORMATS;

function shortPath(s, width = 48) {
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
  return path.join(...parts.slice(index));
}

function getExtname(filename, toLowerCase = false) {
  const ext = path.extname(filename);
  return toLowerCase ? ext?.toLowerCase() : ext;
}

function isImageFile(filename) {
  return IMAGE_FORMATS.includes(getExtname(filename, true));
}

function isRawFile(filename) {
  return RAW_FORMATS.includes(getExtname(filename, true));
}

function isVideoFile(filename) {
  return VIDEO_FORMATS.includes(getExtname(filename, true));
}

function isMediaFile(filename) {
  return MEDIA_FORMATS.includes(getExtname(filename, true));
}

module.exports.isImageFile = isImageFile;
module.exports.isRawFile = isRawFile;
module.exports.isVideoFile = isVideoFile;
module.exports.isMediaFile = isMediaFile;
module.exports.getExtname = getExtname;
module.exports.shortPath = shortPath;
