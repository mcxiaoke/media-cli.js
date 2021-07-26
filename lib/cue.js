#!/usr/bin/env node
const path = require("path");
const fs = require("fs-extra");
const h = require("../lib/helper");
const d = require("../lib/debug");
const un = require("../lib/unicode");
const cue = require("@jhanssen/cue-parser");
const printf = require("printf");

function getAudioTracks(cuefile) {
  cuefile = path.resolve(cuefile);
  const ext = h.ext(cuefile, true);
  if (ext != ".cue") {
    throw `Error:${cuefile} is not a valid cue file`;
  }
  // only support single file cue sheet
  const data = fs.readFileSync(cuefile);
  const encoding = process.platform.includes("win") ? "gbk" : "utf8";
  const sheet = cue.parse(data, encoding);
  if (
    !sheet ||
    !sheet.files ||
    sheet.files.length == 0 ||
    !sheet.files[0].tracks ||
    sheet.files[0].tracks.length == 0
  ) {
    // throw `Error:${cuefile} has no valid tracks`;
    return;
  }
  console.log(sheet);
  const file = path.join(path.dirname(cuefile), sheet.files[0].name);
  const tracks = sheet.files[0].tracks;
  const clips = [];
  const format = "%02d:%02d:%02d.%02d";
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    const t =
      track.indexes.length > 1 ? track.indexes[1].time : track.indexes[0].time;
    const ss = printf(format, 0, t.min, t.sec, t.frame);
    let to;
    if (i + 1 < tracks.length) {
      const nt = tracks[i + 1].indexes[0].time;
      to = printf(format, 0, nt.min, nt.sec, nt.frame);
    }
    clips.push({
      file: file,
      title: track.title,
      artist: track.performer,
      album: sheet.title,
      index: track.number,
      ss: ss,
      to: to,
    });
  }
  //   for (const c of clips) {
  //     console.log(c);
  //   }
}

// getAudioTracks(process.argv.slice(2)[0]);

module.exports.getAudioTracks = getAudioTracks;
