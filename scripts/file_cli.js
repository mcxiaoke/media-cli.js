#!/usr/bin/env node
const path = require("path")
const chalk = require("chalk")
const fs = require("fs-extra")
const inquirer = require("inquirer")
const { walk } = require("../lib/file")
const h = require("../lib/helper")
const log = require("../lib/debug")
const un = require("../lib/unicode")
// debug and logging config
const prettyError = require("pretty-error").start()
prettyError.skipNodeFiles()

const configCli = (argv) => {
  // log.setName("AudioCli");
  log.setLevel(argv.verbose)
  log.debug(argv)
}

const yargs = require("yargs/yargs")(process.argv.slice(2))
yargs
  .positional("input", {
    describe: "Input folder that contains files",
    type: "string",
    normalize: true,
  })
  .option("output", {
    alias: "o",
    type: "string",
    describe: "Output put folder that store results",
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
    describe: "filename extension list for files to delete [-e jpg png zip]",
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
  .command(
    ["test"],
    "Test command, print arguments",
    (yargs) => { },
    (argv) => {
      yargs.showHelp()
      log.show(argv)
    }
  )
  .command(
    ["delete <input>", "del"],
    "Delete files by pattern/extension/size",
    (yargs) => { },
    (argv) => {
      cmdDelete(argv)
    }
  )
  .command(
    ["move <input>", "mv"],
    "Move files by pattern/date/extension/size",
    (yargs) => { },
    (argv) => {
      cmdMove(argv)
    }
  )

  .usage(`Usage: $0 <command> <input> [options]`)
  .count("verbose")
  .alias("v", "verbose")
  .alias("h", "help")
  .epilog(
    "File Utilities: Find/Delete/Rename/Move/Copy\nCopyright 2021 @ Zhang Xiaoke"
  )
  .example(
    '$0 delete C:\\Temp\\data -k DSC_ -p /d+/ -s ">123k" "<15m" -r -t file',
    "Delete such files files meet condition: <filename has keyword:DSC_ and filename matches regex pattern:/d+/ and size above 123k and size below 15m and type is file (excluding dir), and recursive include files in sub dirs> in dir C:\\Temp\\data dir"
  )
  .demandCommand(1, chalk.red("Missing sub command you want to execute!"))
  .showHelpOnFail()
  .help()
  .middleware([configCli])
const argv = yargs.argv

async function cmdDelete(argv) {
  log.info(`cmdDelete:`, argv)
  const root = argv.input
  let files = await walk(root)
  files = files.filter((f) => {
    const filename = path.basename(f.path)
    return filename.includes(keyword)
  })
  files.forEach((f) => d.L("Found:", f.path))
  if (files.length == 0 || !argv.keyword) {
    log.warn(`No files need to be processed, abort.`)
    return
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
  ])
  if (answer.yes) {
    files = files.map(async (f, i) => {
      try {
        log.info(`Deleting `, i, h.ps(f.path))
        await fs.rm(f.path)
        log.show(`Deleted `, i, h.ps(f.path))
      } catch (error) {
        log.error(`Delete Failed: `, i, h.ps(f.path), error)
      }
    })
  } else {
    log.warn(`Nothing to do, abort by user.`)
  }
}

async function cmdMove(argv) {
  log.info(`cmdMove:`, argv)
  const root = argv.input
  let files = await walk(root)
  for (const f of files) {
    log.show(f.path, f.stats.mtime)
  }
  files = files.sort((a, b) => { })
}
