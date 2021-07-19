const { spawnSync } = require("child_process");
const iconv = require("iconv-lite");
const workerpool = require("workerpool");
const path = require("path");
const fs = require("fs-extra");

function executeCommand(command, args = []) {
  const argsStr = args.join(" ");
  const result = spawnSync(command, args);
  let output;
  if (result.status != 0) {
    output = iconv.decode(result.stderr, "utf8");
    console.log(
      `Command '${command} ${argsStr}' failed(${result.status}): ${output} (${process.pid})`
    );
  } else {
    output = iconv.decode(result.stdout, "utf8");
    console.log(`Command '${command} ${argsStr}' success. (${process.pid})`);
  }
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
    console.warn(`===>>> ${error} <${file}>`);
  }
}

function ffmpegConvert(file) {
  // convert mp3 to aac
  // ls *.mp3 | parallel ffmpeg -n -loglevel repeat+level+warning -i "{}" -map a:0 -c:a libfdk_aac -b:a 192k output/"{.}".m4a -hide_banner
  const fileSrc = path.resolve(file);
  const nameBase = path.basename(fileSrc, path.extname(fileSrc));
  const dstDir = path.join(path.dirname(fileSrc), "output");
  const fileDst = path.join(dstDir, `${nameBase}.m4a`);
  if (fs.existsSync(fileDst)) {
    console.log(`Skip exists: ${fileDst}`);
    return { status: 0, output: "", file: fileSrc };
  }
  let args = "-n -loglevel repeat+level+warning -i".split(" ");
  args.push(fileSrc);
  args = args.concat("-map a:0 -c:a libfdk_aac -b:a 192k".split(" "));
  args.push(fileDst);
  args.push("-hide_banner");
  // console.log("ffmpeg", args);
  // console.log(`Converting: ${fileName}`);
  fs.ensureDirSync(dstDir);
  // const result = spawnSync("ffmpeg", args);
  const result = executeCommand("ffmpeg", args);
  if (result.ok) {
    console.log(`Convert failed: ${path.basename(fileSrc)} ${result.output}`);
  } else {
    console.log(`Converted to: ${path.basename(fileDst)}`);
  }
  return result;
}

// https://github.com/josdejong/workerpool
// https://www.npmjs.com/package/workerpool
workerpool.worker({
  exifRead: exifRead,
  ffmpegConvert: ffmpegConvert,
});
