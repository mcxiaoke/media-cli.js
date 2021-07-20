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

async function allToAAC(files) {
  const pool = workerpool.pool(__dirname + "/audio_workers.js", {
    maxWorkers: cpuCount,
    workerType: "process",
  });
  const startMs = Date.now();
  const results = await Promise.all(
    files.map(async (f) => {
      const file = path.resolve(f);
      const result = await pool.exec("toAAC", [file]);
      return result;
    })
  );
  await pool.terminate();
  const elapsedSecs = (Date.now() - startMs) / 1000;
  d.L(`Result: ${results.length} files converted in ${elapsedSecs}s.`);
  return results;
}

async function checkFiles(files) {
  const results = await Promise.all(
    files.map(async (f) => {
      if (h.ext(f, true) == ".m4a") {
        d.L(`Skip AAC: ${h.sps(f)}`);
        return false;
      }
      const outPath = path.join(path.dirname(f), "output", h.getAACFileName(f));
      const fileExists = await fs.pathExists(outPath);
      if (fileExists) {
        d.L(`Skip exists: ${h.sps(outPath)}`);
      }
      return !fileExists;
    })
  );
  return files.filter((_v, i) => results[i]);
}

async function executeToAAC(root) {
  d.L(`Input: ${root}`);
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
