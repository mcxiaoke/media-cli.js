#!/usr/bin/env node
const klawSync = require("klaw-sync");
const path = require("path");
const chalk = require("chalk");
const fs = require("fs-extra");
const inquirer = require("inquirer");
const workerpool = require("workerpool");
const cpuCount = require("os").cpus().length;
const h = require("../lib/helper");
const d = require("../lib/debug");

const yargs = require("yargs/yargs")(process.argv.slice(2));
const argv = yargs
  .usage("Usage: $0 <command> <source> [options]")
  .command(
    // format and name is important!
    // <> means required
    // [] means optional
    // <source> is argument name
    ["toaac <source> [options]", "$0"],
    "Convert audio files to m4a(aac) format in source dir",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains audio files",
          type: "string",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          default: false,
          description: "Force to override exists file",
        });
    },
    (argv) => {
      commandToAAC(argv);
    }
  )
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .alias("i", "version")
  .epilog("Copyright 2021 @ Zhang Xiaoke")
  .demandCommand()
  .showHelpOnFail()
  .help().argv;
d.setLevel(argv.verbose);
d.D(argv);

async function commandToAAC(argv) {
  const root = path.resolve(argv.source);
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  await executeToAAC(root);
}

async function checkFiles(files) {
  const results = await Promise.all(
    // true means keep
    // false mean skip
    files.map(async (f, i) => {
      const index = i + 1;
      if (h.ext(f, true) == ".m4a") {
        d.L(chalk.gray(`SkipAAC (${index}): ${h.sps(f)}`));
        return false;
      }
      const aacName = h.getAACFileName(f);
      const p1 = path.join(path.dirname(f), "output", aacName);
      if (await fs.pathExists(p1)) {
        d.W(chalk.gray(`SkipExists (${i}): ${h.sps(p1)}`));
        return false;
      }
      const p2 = path.join(path.dirname(f), aacName);
      if (await fs.pathExists(p2)) {
        d.W(chalk.gray(`SkipExists (${index}): ${h.sps(p2)}`));
        return false;
      }
      d.L(chalk.green(`Prepared (${index}): `) + `${h.sps(f)}`);
      return true;
    })
  );
  return files.filter((_v, i) => results[i]);
}

async function allToAAC(files) {
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount,
    workerType: "process",
  });
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f, i) => {
      const file = path.resolve(f);
      const result = await pool.exec("toAAC", [file, i + 1]);
      return result;
    })
  );
  await pool.terminate();
  const elapsedSecs = (Date.now() - startMs) / 1000;
  d.L(`Result: ${results.length} files converted in ${elapsedSecs}s.`);
  return results;
}

async function executeToAAC(root) {
  const startMs = Date.now();
  // list all files in dir recursilly
  let files = klawSync(root, { nodir: true }).map((f) => f.path);
  const filesCount = files.length;
  // keep only non-m4a audio files
  // todo add check to ensure is audio file
  files = await checkFiles(files);
  d.L(`Total ${filesCount} files processed in ${Date.now() - startMs}ms`);
  const skipCount = filesCount - files.length;
  if (skipCount > 0) {
    d.L(`Total ${skipCount} audio files are skipped`);
  }
  const output = path.join(root, "output");
  d.L(`Input: ${root}`);
  d.L(`Output: ${output}`);
  if (files.length == 0) {
    d.L(chalk.green("Nothing to do, exit now."));
    return;
  }
  d.L(`Total ${files.length} audio files ready to convert`);
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(`Are you sure to convert ${files.length} files?`),
    },
  ]);
  if (answer.yes) {
    allToAAC(files).then((results) => {
      d.L(chalk.green(`There are ${results.length} audio files converted.`));
    });
  } else {
    d.L(chalk.yellowBright("Will do nothing, aborted by user."));
  }
}
