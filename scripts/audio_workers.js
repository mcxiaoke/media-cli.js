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

function exifRead(file) {
  const result = spawnSync("exiftool", ["-j", file]);
  try {
    return JSON.parse(iconv.decode(result.stdout, "utf8"))[0];
  } catch (error) {
    d.E(`ERROR! exifRead ${error} <${file}>`);
  }
}

function toAAC(file, index) {
  // convert mp3 to aac
  // ls *.mp3 | parallel ffmpeg -n -loglevel repeat+level+warning -i "{}" -map a:0 -c:a libfdk_aac -b:a 192k output/"{.}".m4a -hide_banner
  d.D(`toAAC: processing1 ${index} ${file.path}`);
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
  exifRead: exifRead,
  toAAC: toAAC,
});
