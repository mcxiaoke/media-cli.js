#!/usr/bin/env node
const klawSync = require("klaw-sync");
const path = require("path");
const chalk = require("chalk");
const util = require("util");
const fs = require("fs-extra");
const inquirer = require("inquirer");
const workerpool = require("workerpool");
const cpuCount = require("os").cpus().length;
const h = require("../lib/helper");
const d = require("../lib/debug");
const un = require("../lib/unicode");
const exif = require("../lib/exif");
const cue = require("@jhanssen/cue-parser");

async function main() {
  const data = await fs.readFile(process.argv.slice(2)[0]);
  const cuesheet = cue.parse(data, "gbk");
  console.dir(cuesheet);
  const tracks = cuesheet.files[0].tracks;
  for (const t of tracks) {
    console.dir(t);
    console.dir(t.indexes);
  }
}

// npm install printf
// https://ffmpeg.org/ffmpeg-all.html#Main-options
// https://ffmpeg.org/ffmpeg-utils.html#time-duration-syntax
// ffmpeg split by timestamp and duration
// split and convert to aac:
// ffmpeg -ss 00:00:00.00 -to 00:04:34.35 -i .\女生宿舍.ape -map a:0 -c:a libfdk_aac -b:a 320k -metadata title="恋人未满" -metadata artist="S.H.E" -metadata album="女生宿舍" track01.m4a

// -ss seekto=start -to=end, -t=duration
main();

// last track, not -to option
//ffmpeg -ss 00:37:24.25 -i .\女生宿舍.ape -map a:0 -c:a libfdk_aac -b:a 320k -metadata title="恋人未满" -metadata artist="S.H.E" -metadata album="女生宿舍" track10.m4a
