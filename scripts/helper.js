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

const path = require("path");

function getExtname(filename) {
  const ext = path.extname(filename);
  return ext && ext.toLowerCase();
}

function isImageFile(filename) {
  return IMAGE_FORMATS.includes(getExtname(filename));
}

function isRawFile(filename) {
  return RAW_FORMATS.includes(getExtname(filename));
}

function isVideoFile(filename) {
  return VIDEO_FORMATS.includes(getExtname(filename));
}

function isMediaFile(filename) {
  return MEDIA_FORMATS.includes(getExtname(filename));
}

module.exports.isImageFile = isImageFile;
module.exports.isRawFile = isRawFile;
module.exports.isVideoFile = isVideoFile;
module.exports.isMediaFile = isMediaFile;
module.exports.getExtname = getExtname;
