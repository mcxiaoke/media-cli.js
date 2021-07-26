const { spawnSync } = require("child_process");
const iconv = require("iconv-lite");
const workerpool = require("workerpool");
const path = require("path");
const fs = require("fs-extra");
const d = require("../lib/debug");
const h = require("../lib/helper");

function executeCommand(command, args = []) {
  const argsStr = args.join(" ");
  const result = spawnSync(command, args);
  let output;
  if (result.status != 0) {
    output = iconv.decode(result.stderr, "utf8");
    d.W(
      `Command Failed: '${command} ${argsStr}' (${result.status}):${output} (${process.pid})`
    );
  } else {
    output = iconv.decode(result.stdout, "utf8");
    d.D(`Command Success: '${command} ${argsStr}' (${process.pid})`);
  }
  output && d.D(`Execute Command output: ${output}`);
  return {
    command: command,
    args: args,
    status: result.status,
    ok: result.status == 0,
    output: output,
  };
}

function cmdExifTool(file) {
  const result = spawnSync("exiftool", ["-j", file]);
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0];
  } catch (error) {
    d.E(`ERROR! cmdExifTool ${error} <${file}>`);
  }
}

function cmdFFProbe(file) {
  const args =
    "-hide_banner -loglevel fatal -show_error -show_format -show_streams -show_programs -show_chapters -print_format json".split(
      " "
    );
  const result = spawnSync("ffprobe", args);
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0];
  } catch (error) {
    d.E(`ERROR! cmdFFProbe ${error} <${file}>`);
  }
}

function getTrackArgs(track) {
  const dstDir = path.dirname(track.file);
  const dstName = `${track.artist} @ ${track.title}.m4a`;
  const fileDst = path.join(dstDir, dstName);
  let args = "-n -loglevel repeat+level+info".split(" ");
  if (track.ss) {
    args.push("-ss");
    args.push(track.ss);
  }
  if (track.to) {
    args.push("-to");
    args.push(track.to);
  }
  args.push("-i");
  args.push(fileSrc);
  args = args.concat("-map a:0 -c:a libfdk_aac -b:a 320k".split(" "));
  args.push(fileDst);
  args.push("-hide_banner");
  d.I("getTrackArgs", "ffmpeg", args);
  return {
    fileDst: fileDst,
    args: args,
  };
}

// convert one ape/wav/flac file with cue to multi aac tracks
function splitTracks(file, index) {
  // ffmpeg -ss 00:00:00.00 -to 00:04:34.35 -i .\女生宿舍.ape -map a:0 -c:a libfdk_aac -b:a 320k -metadata title="恋人未满" -metadata artist="S.H.E" -metadata album="女生宿舍" track01.m4a
  const fileSrc = path.resolve(file.path);
  d.D(`splitTracks: processing ${index} ${fileSrc}`);
  const tracks = require("../lib/cue").getAudioTracks(fileSrc);
  if (!tracks || tracks.length == 0) {
    d.W(`InvalidCue: ${h.ps(fileSrc)} (${index})`);
    return { status: 0, output: "", file: fileSrc };
  }

  const results = [];
  for (const track of tracks) {
    const t = getTrackArgs(track);
    d.L(`Track Converting (${track.index}): to ${h.ps(t.fileDst)}`);
    const r = executeCommand("ffmpeg", t.args);
    if (r.ok) {
      d.L(`Track OK (${index}): ${h.ps(t.fileDst)}`);
    } else {
      d.W(`Track ERROR (${index}): ${h.ps(t.file)} ${r.output}`);
    }
    results.push(r);
  }
  const okCount = results.filter((r) => r.ok).length;
  if (okCount == tracks.length) {
    d.L(`All OK (${index}): ${h.ps(fileSrc)}`);
  } else {
    d.W(
      `Some OK (${index}): ${h.ps(fileSrc)} Failed:${tracks.length - okCount}`
    );
  }
  return result;
}

// convert one mp3/ape/wav/flac to single aac file
function toAACFile(file, index) {
  // ls *.mp3 | parallel ffmpeg -n -loglevel repeat+level+warning -i "{}" -map a:0 -c:a libfdk_aac -b:a 192k output/"{.}".m4a -hide_banner
  d.D(`toAACFile: processing ${index} ${file.path}`);
  const fileSrc = path.resolve(file.path);
  const [dir, base, ext] = h.pathSplit(fileSrc);
  const dstDir = dir;
  const fileDst = path.join(dstDir, `${base}.m4a`);
  if (fs.pathExistsSync(fileDst)) {
    d.W(`SkipExists: ${h.ps(fileDst)} (${index})`);
    return { status: 0, output: "", file: fileSrc };
  }
  let args = "-n -loglevel repeat+level+info -i".split(" ");
  args.push(fileSrc);
  args = args.concat("-map a:0 -c:a libfdk_aac -b:a".split(" "));
  if (file.loseless) {
    args.push("320k");
  } else {
    args.push(file.bitRate > 192 ? "192k" : "128k");
  }
  args.push(fileDst);
  args.push("-hide_banner");
  d.I("ffmpeg", args);
  // console.log(`Converting: ${fileName}`);
  fs.ensureDirSync(dstDir);
  // const result = spawnSync("ffmpeg", args);
  d.L(`Converting (${index}): [${file.bitRate}k] ${h.ps(fileSrc)}`);
  const result = executeCommand("ffmpeg", args);
  if (result.ok) {
    d.L(`OK (${index}): ${h.ps(fileDst)}`);
    //caution: delete orignal audio file
    // try {
    //   fs.rmSync(fileSrc);
    //   d.L(`Delete Original OK: (${index}): ${h.ps(fileSrc)}`);
    // } catch (error) {
    //   d.L(`Delete Original Error: (${index}): ${h.ps(fileSrc)} ${error}`);
    // }
  } else {
    d.W(`ERROR (${index}): ${h.ps(fileSrc)} ${result.output}`);
  }
  return result;
}

// https://github.com/josdejong/workerpool
// https://www.npmjs.com/package/workerpool
workerpool.worker({
  cmdExifTool: cmdExifTool,
  cmdFFProbe: cmdFFProbe,
  toAACFile: toAACFile,
  splitTracks: splitTracks,
});
