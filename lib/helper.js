/*
 * File: helper.js
 * Created: 2021-07-19 14:23:52
 * Modified: 2024-03-23 11:52:37
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import dayjs from "dayjs";
import fs from 'fs-extra';
import path from 'path';
import prettyBytes from 'pretty-bytes';
import prettyMilliseconds from 'pretty-ms';

const ARCHIVE_FORMATS = [
  ".7z",
  ".zip",
  ".rar",
  ".001",
  ".iso",
  ".gz",
]

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

const VIDEO_FORMATS = [".mp4", ".mov", ".wmv", ".avi", ".mkv", ".m4v", ".ts", ".flv", ".webm", ".rmvb", ".rm", ".vob"];

const HEVC_IMAGE_FORMATS = ['.heif', '.heic', ".avif"];

const SUBTITLE_FORMATS = [".src", ".ass", ".stl"];

const BOOK_FORMATS = [".epub", ".mobi", ".azw3", ".pdf"];

const MEDIA_FORMATS = [...RAW_FORMATS, ...IMAGE_FORMATS, ...VIDEO_FORMATS];

export const FILE_TYPE_DEFAULT = 0;
export const FILE_TYPE_IMAGE = 1;
export const FILE_TYPE_VIDEO = 2;
export const FILE_TYPE_BOOK = 3;
export const FILE_TYPE_ARCHIVE = 4;

export function isArchiveFile(filename) {
  return ARCHIVE_FORMATS.includes(pathExt(filename, true));
}

export function isImageFile(filename) {
  return IMAGE_FORMATS.includes(pathExt(filename, true));
}

export function isRawFile(filename) {
  return RAW_FORMATS.includes(pathExt(filename, true));
}

export const isHEVCImage = (filename) => HEVC_IMAGE_FORMATS.includes(pathExt(filename, true));

export function isVideoFile(filename) {
  return VIDEO_FORMATS.includes(pathExt(filename, true));
}

export function isMediaFile(filename) {
  return MEDIA_FORMATS.includes(pathExt(filename, true));
}

export function isSubtitleFile(filename) {
  return SUBTITLE_FORMATS.includes(pathExt(filename, true));
}

export function isBookFile(filename) {
  return BOOK_FORMATS.includes(pathExt(filename, true));
}

export function getFileTypeByExt(filename) {
  const ext = pathExt(filename, true);
  if (IMAGE_FORMATS.includes(ext)) {
    return FILE_TYPE_IMAGE;
  }
  else if (VIDEO_FORMATS.includes(ext)) {
    return FILE_TYPE_VIDEO;
  }
  else if (BOOK_FORMATS.includes(ext)) {
    return FILE_TYPE_BOOK;
  }
  else if (ARCHIVE_FORMATS.includes(ext)) {
    return FILE_TYPE_ARCHIVE;
  } else {
    return FILE_TYPE_DEFAULT;
  }
}

// https://stackoverflow.com/questions/1144783/
// simple: str.split(search).join(replacement)
// or str = str.replace(/abc/g, '');
// function replaceAll(str, find, replace) {
//   return str.replace(new RegExp(find, 'g'), replace);
// }
export function escapeRegExp(string) {
  return string.replace(/[.*+\-?^${}()|[\]\\]/g, "\\$&");
  // $& means the whole matched string
}
export function replaceAll(str, find, replace) {
  return str.replace(new RegExp(escapeRegExp(find), "g"), replace);
}

export function humanTime(startMs) {
  let milliseconds = Date.now() - startMs;
  return prettyMilliseconds(milliseconds)
}

export function humanSize(sizeNum, options = {}) {
  return prettyBytes(sizeNum, options);
}

export function pathShort(ps, width = 40) {
  const s = path.resolve(ps);
  // shorten long path by segments
  if (!s || s.length < width) {
    return s;
  }
  const parts = s.split(path.sep);
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
  return path.join(".", ...parts.slice(index));
}

export function pathSplit(fullpath) {
  const abspath = path.resolve(fullpath);
  // const filename = path.basename(abspath);
  // const d = path.dirname(abspath);
  // const e = path.extname(abspath);
  // const b = path.basename(filename, e);
  // dir,base,ext
  // return [d, b, e];
  //https://nodejs.org/api/path.html#path_path_parse_path
  const parts = path.parse(abspath);
  return [parts.dir, parts.name, parts.ext];
}

// 获取根目录路径，比如 C:\\
export function pathRoot(ps) {
  return path.parse(path.resolve(ps)).root;
}

export function pathSegments(ps) {
  return ps.split(path.sep)
}

/**
 * 去掉输入路径的根目录，组合输出目录，生成新路径
 * 假设输入 'F:\\Temp\\JPEG\\202206\\DSCN2040.JPG'
 * 假设输出 'E:\\Temp\Test\\'
 * 那么结果 'E:\\Temp\\Test\\Temp\\JPEG\\202206\\DSCN2040_thumb.jpg'
 * @param {*} input 输入路径
 * @param {*} output 输出路径
 * @returns 生成新路径
 */
export function pathRewrite(input, output) {
  let segs = input.split(path.sep)
  segs = segs.slice(Math.max(1, segs.length - 3))
  return path.join(output, ...segs)
}

export function pathExt(filename, toLowerCase = false) {
  const ext = path.extname(filename);
  return toLowerCase ? ext?.toLowerCase() : ext;
}

export function getSafeDeletedDir(filepath) {
  const dtStr = dayjs().format("YYYYMMDD");
  const dir = path.join(pathRoot(filepath), 'Deleted_By_Mediac', dtStr);
  return path.resolve(dir);
}

// 安全删除文件，转移到Deleted目录，而不是永久删除，防止误删
// 安全删除的文件，移动后，保持原有目录结构
export async function safeRemove(filepath) {
  try {
    let deletedDir = getSafeDeletedDir(filepath);
    let parts = path.parse(filepath)
    let dirOriginal = path.relative(parts.root, parts.dir);
    deletedDir = path.join(deletedDir, dirOriginal);
    let deletedPath = path.join(deletedDir, path.basename(filepath));
    if (await fs.pathExists(deletedPath)) {
      deletedPath = path.join(deletedDir, "_", path.basename(filepath));
    }
    await fs.ensureDir(deletedDir);
    await fs.move(filepath, deletedPath);
  } catch (error) { }
}

// 复杂的长正侧，可以分离组合
export const combineRegex = (...parts) =>
  new RegExp(parts.map(x => (x instanceof RegExp) ? x.source : x).join(''), "i");

export const combineRegexG = (...parts) =>
  new RegExp(parts.map(x => (x instanceof RegExp) ? x.source : x).join(''), "ugi");


// https://www.npmjs.com/package/underscore
export const _pick = (obj, ...keys) => Object.fromEntries(
  keys
    .filter(key => key in obj)
    .map(key => [key, obj[key]])
);

export const _ipick = (obj, ...keys) => Object.fromEntries(
  keys.map(key => [key, obj[key]])
);

export const _omit = (obj, ...keys) => Object.fromEntries(
  Object.entries(obj)
    .filter(([key]) => !keys.includes(key))
);