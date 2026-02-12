/*
 * File: cmd_lr.js
 * Created: 2026-02-12 09:16:00 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 * 
 * Command: Move JPEG output of RAW files to other folder
 */

import chalk from "chalk"
import fs from "fs-extra"
import inquirer from "inquirer"
import path from "path"
import yargs from "yargs"
import * as log from "../lib/debug.js"
import * as mf from "../lib/file.js"

export { aliases, builder, command, describe, handler }

const command = "lrmove <input> [output]"
const aliases = ["lv"]
const describe = "Move JPEG output of RAW files to other folder"

const builder = (ya) => {
  // 可以在这里添加特定于这个命令的选项
  return ya
}

const handler = async (argv) => {
  await cmdLRMove(argv)
}

async function cmdLRMove(argv) {
  log.show("cmdLRMove", argv)
  const root = path.resolve(argv.input)
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp()
    log.error("LRMove", `Invalid Input: '${root}'`)
    return
  }
  
  log.show(`LRMove: input:`, root)
  
  let filenames = await mf.walk(root, { needStats: true, withFiles: false, withDirs: true })
  filenames = filenames.map((entry) => entry.path).filter((f) => path.basename(f) === "JPEG")
  log.show("LRMove:", `Total ${filenames.length} JPEG folders found`)
  
  if (filenames.length === 0) {
    log.showGreen("Nothing to do, abort.")
    return
  }
  
  const files = filenames.map((f) => {
    const fileSrc = f
    const fileBase = path.dirname(fileSrc)
    const fileDst = fileBase.replace("RAW" + path.sep, "JPEG" + path.sep)
    const task = {
      fileSrc: fileSrc,
      fileDst: fileDst,
    }
    log.show(`SRC:`, fileSrc)
    log.show("DST:", fileDst)
    return task
  })
  
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to move these ${files.length} JPEG folder with files?`,
      ),
    },
  ])
  
  if (answer.yes) {
    for (const f of files) {
      try {
        await fs.move(f.fileSrc, f.fileDst)
        log.showGreen("Moved:", f.fileSrc, "to", f.fileDst)
      } catch (error) {
        log.error("Failed:", error, f.fileSrc, "to", f.fileDst)
      }
    }
  } else {
    log.showYellow("Will do nothing, aborted by user.")
  }
}