#!/usr/bin/env node
const path = require("path");
const fs = require("fs-extra");
const chalk = require("chalk");
const d = require("../lib/debug");
const exif = require("../lib/exif");

const yargs = require("yargs/yargs")(process.argv.slice(2));
// https://github.com/yargs/yargs/blob/master/docs/advanced.md
const argv = yargs
  .usage("Usage: $0 <command> <source> [options]")
  .command(
    ["rename <source> [options]", "rn", "$0"],
    "Rename media files in source dir by exif date",
    (yargs) => {
      yargs
        .positional("source", {
          describe: "Source folder that contains media files",
          type: "string",
        })
        .option("backup", {
          alias: "b",
          type: "boolean",
          default: false,
          description: "backup original file before rename",
        })
        .option("force", {
          alias: "f",
          type: "boolean",
          default: false,
          description: "force rename files without valid exif date",
        })
        .option("prefix", {
          alias: "p",
          type: "string",
          default: "IMG_/DSC_/VID_",
          description: "custom filename prefix for raw/image/video files'",
        })
        .option("suffix", {
          alias: "s",
          type: "string",
          default: "",
          description: "custom filename suffix",
        })
        .option("template", {
          alias: "t",
          type: "string",
          default: "YYYYMMDD_HHmmss",
          description:
            "filename date format template, see https://day.js.org/docs/en/display/format",
        });
    },
    (argv) => {
      commandRename(argv);
    }
  )
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .alias("i", "version")
  .epilog(
    "<Media Utilities>\nRename Image/Raw/Video files by EXIF date tags\nCopyright 2021 @ Zhang Xiaoke"
  )
  .demandCommand()
  .showHelpOnFail()
  .help().argv;
d.setLevel(argv.verbose);
d.D(argv);

async function commandRename(argv) {
  const root = path.resolve(argv.source);
  if (!root || !fs.pathExistsSync(root)) {
    yargs.showHelp();
    d.E(chalk.red(`ERROR! Source '${root}' is not exists or not a directory!`));
    return;
  }
  await exif.executeRename(root);
}
