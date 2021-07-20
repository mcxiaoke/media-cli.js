#!/usr/bin/env node
const klawSync = require("klaw-sync");
const path = require("path");
const fs = require("fs-extra");
const workerpool = require("workerpool");
const cpuCount = require("os").cpus().length;

async function main() {
  root = process.argv.slice(2)[0];
  if (!root) {
    console.log("No folder root, abort.");
    process.exit(1);
    return;
  }
  console.log(`Platform: ${process.platform}`);
  const pool = workerpool.pool(__dirname + "/workers.js", {
    maxWorkers: cpuCount,
    workerType: "process",
  });
  root = path.resolve(root);
  console.log(`Input: ${root}`);
  let files = klawSync(root, { nodir: true });
  files = files.filter((f) => path.extname(f.path) == ".mp3");
  const output = path.join(root, "output");
  console.log(`Output: ${output}`);
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f) => {
      const file = path.resolve(f.path);
      const result = await pool.exec("ffmpegConvert", [file]);
      // console.log(path.basename(file), result, process.pid);
      return result;
    })
  );
  await pool.terminate();
  const elapsedSecs = (Date.now() - startMs) / 1000;
  console.log(`Result: ${results.length} files converted in ${elapsedSecs}s.`);
  // delete output files for test
  fs.rmSync(output, { recursive: true });
}

main();
