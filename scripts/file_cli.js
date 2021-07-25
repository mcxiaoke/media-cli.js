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
  .command(
    ["delete <source> [options]", "del", "d"],
    "Delete files by pattern/extension/size in source dir",
    (yargs) => {
      yargs
        .example(
          '$0 delete C:\\Temp\\data -k DSC_ -p /d+/ -s ">123k" "<15m" -r -t file',
          "Delete such files files meet condition: <filename has keyword:DSC_ and filename matches regex pattern:/d+/ and size above 123k and size below 15m and type is file (excluding dir), and recursive include files in sub dirs> in dir C:\\Temp\\data dir"
        )
        .positional("source", {
          describe: "Source folder that contains files",
          type: "string",
          normalize: true,
        })
        .option("type", {
          alias: "t",
          type: "string",
          default: "file",
          choices: ["file", "dir", "all"],
          describe: "file type for files to delete [-t file]",
        })
        .option("keyword", {
          alias: "k",
          type: "string",
          describe: "filename keyword for files to delete [-k DSC_]",
        })
        .option("pattern", {
          alias: "p",
          type: "string",
          describe: "filename regex pattern for files to delete [-p /d+/]",
        })
        .option("extension", {
          alias: ["e", "ext"],
          type: "array",
          describe:
            "filename extension list for files to delete [-e jpg png zip]",
        })
        .option("size", {
          alias: ["s", "sz"],
          type: "array",
          describe: "file size for files to delete (><) [-s >123k <10m",
        })
        .option("recursive", {
          alias: "r",
          type: "boolean",
          describe: "handle files recursive in source dir [-r]",
        })
        .epilog(
          "One or more of options is required: [--keyword/--pattern/--extension/--size]"
        );
    },
    (argv) => {
      console.log(argv);
      // cmdDelete(argv);
    }
  )
  .usage(`Usage: $0 <command> <source> [options]`)
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .epilog(
    "<File Utilities>\nFind/Delete/Rename/Move/Copy\nCopyright 2021 @ Zhang Xiaoke"
  )
  .demandCommand(1, chalk.red("Missing sub command you want to execute!"))
  .showHelpOnFail()
  .help();
const argv = yargs.argv;
d.setLevel(argv.verbose);
d.I(argv);

async function cmdDelete(argv) {
  d.L(`cmdDelete:`, argv);
  const root = argv.source;
  let files = klawSync(root, { nodir: true });
  files = files.filter((f) => {
    const filename = path.basename(f.path);
    return filename.includes(keyword);
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
