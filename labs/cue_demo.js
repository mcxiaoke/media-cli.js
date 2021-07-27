#!/usr/bin/env node
const fs = require("fs-extra");
const klawSync = require("klaw-sync");
const d = require("../lib/debug");
const h = require("../lib/helper");
const cue = require("../lib/cue");

d.setLevel(9);
// cue.parseAudioTracks(process.argv.slice(2)[0]);

function deleteAudioWithCue(root) {
  const filterFn = (f) => {
    return h.ext(f.path, true) == ".cue";
  };
  let files = klawSync(root, {
    nodir: true,
    traverseAll: true,
    filter: filterFn,
  });
  const cueFiles = files.map((f) => f.path);
  const audioFiles = cueFiles.map((f) => cue.getAudioFile(f));
  console.log(cueFiles.length, audioFiles.length);
  for (const cf of cueFiles) {
    // console.log("Delete", cf);
    // fs.rmSync(cf);
  }
  for (const af of audioFiles) {
    // console.log("Delete", af);
    // fs.rmSync(af);
  }
}

deleteAudioWithCue(process.argv.slice(2)[0]);
