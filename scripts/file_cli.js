#!/usr/bin/env node
const path = require("path");
const chalk = require("chalk");
const fs = require("fs-extra");
const inquirer = require("inquirer");
const klawSync = require("klaw-sync");
const h = require("../lib/helper");
const d = require("../lib/debug");
const un = require("../lib/unicode");

const yargs = require("yargs/yargs")(process.argv.slice(2));
yargs
  .positional("source", {
    describe: "Source folder that contains files",
    type: "string",
  })
  .option("keyword", {
    alias: "k",
    type: "string",
    description: "The filename keyword to match",
  })
  .usage(`Usage: $0 <command> <source> [options]`)
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .epilog(
    "<File Utilities>\nFind/Delete/Rename/Move/Copy\nCopyright 2021 @ Zhang Xiaoke"
  )
  .showHelpOnFail()
  .help();
const argv = yargs.argv;
d.setLevel(argv.verbose);
d.I(argv);

async function deleteByPattern(root, keyword) {
  let files = klawSync(root, { nodir: true });
  files = files.filter((f) => {
    const filename = path.basename(f.path);
    return h.isAudioFile(filename) && !filename.includes(keyword);
  });
  files.forEach((f) => d.L("Found:", f.path));
  if (files.length == 0 || !argv.keyword) {
    d.L(`No files need to be processed, abort.`);
    return;
  }
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to delete these ${files.length} files?`
      ),
    },
  ]);
  if (answer.yes) {
    files = files.map((f, i) => {
      try {
        d.L(`Deleting `, i, h.ps(f.path));
        fs.rmSync(f.path);
        d.L(`Deleted `, i, h.ps(f.path));
      } catch (error) {
        console.error(`Delete Failed: `, i, h.ps(f.path), error);
      }
    });
  } else {
    d.L(`Nothing to do, abort by user.`);
  }
}

async function main() {
  const keyword = argv.keyword;
  const root = (argv._[0] && path.resolve(argv._[0])) || "";
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  if (!keyword) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Missing match keyword option!`));
    return;
  }
  await deleteByPattern(root, keyword);
}

main();
