#!/usr/bin/env node
/*
 * File: media_cli.js
 * Modified: 2024-04-08 22:21:01
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */


import assert from "assert"
import chalk from 'chalk'
import dayjs from "dayjs"
import EventEmitter from 'events'
import fs from 'fs-extra'
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import sharp from "sharp"
import yargs from "yargs"
import { compressImage } from '../cmd/cmd_shared.js'
import * as log from '../lib/debug.js'
import * as exif from '../lib/exif.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'


// fix max listeners
EventEmitter.defaultMaxListeners = 1000

const cpuCount = cpus().length
// 配置调试等级
const configCli = (argv) => {
  // 太冗长了删掉
  delete argv.$0
  // log.setName("MediaCli");
  log.setVerbose(argv.verbose)
  log.debug(argv)
}

// exitHook(signal => {
//   console.log(`Exiting with signal: ${signal}, kill ffmpeg`)
//   helper.killProcessSync('ffmpeg')
// })

try {
  await main()
} catch (error) {
  console.error(error)
}

async function main() {
  // 命令行参数解析
  // const ya = yargs(process.argv.slice(2));
  // https://github.com/yargs/yargs/blob/master/docs/advanced.md
  const ya = yargs(process.argv.slice(2))
  ya.usage("Usage: $0 <command> <input> [options]")
    // .positional("input", {
    //   describe: "Input folder that contains files",
    //   type: "string",
    //   normalize: true,
    // })
    // 测试命令，无作用
    .command(
      ["test", "tt", "$0"],
      "Test command, do nothing",
      (ya) => {
        // yargs.option("output", {
        //   alias: "o",
        //   type: "string",
        //   normalize: true,
        //   description: "Output folder",
        // });
      },
      (argv) => {
        ya.showHelp()
      }
    )
    // 命令：DCIM重命名
    // 默认按照EXIF拍摄日期重命名，可提供自定义模板
    .command(await import('../cmd/cmd_dcim.js'))
    // 命令 分类图片文件
    // 按照文件类型，图片或视频，分类整理
    // 按照EXIF拍摄日期的年份和月份整理图片
    .command(
      ["organize <input> [output]", "oz"],
      "Organize pictures by file modified date",
      (ya) => {
        ya.option("day", {
          // 按天创建文件夹
          alias: "d",
          type: "boolean",
          description: "organize files by day, default by month",
        })
      },
      (argv) => {
        cmdOrganize(argv)
      }
    )
    // 命令 LR输出文件移动
    // 移动RAW目录下LR输出的JPEG目录到单独的图片目录
    .command(
      ["lrmove <input> [output]", "lv"],
      "Move JPEG output of RAW files to other folder",
      (ya) => {
        // yargs.option("output", {
        //   alias: "o",
        //   type: "string",
        //   normalize: true,
        //   description: "Output folder",
        // });
      },
      (argv) => {
        cmdLRMove(argv)
      }
    )
    // 命令 压缩图片
    // 压缩满足条件的图片，可指定最大边长和文件大小，输出质量
    // 可选删除压缩后的源文件
    .command(await import("../cmd/cmd_compress.js"))
    // 命令 删除图片
    // 按照指定规则删除文件，条件包括宽度高度、文件大小、文件名规则
    // 支持严格模式和宽松模式
    .command(await import("../cmd/cmd_remove.js"))
    // 命令 向上移动文件
    // 把多层嵌套目录下的文件移动到顶层目录，按图片和视频分类
    .command(await import("../cmd/cmd_moveup.js"))
    // 命令 重命名文件 添加前缀
    .command(await import("../cmd/cmd_prefix.js"))
    // 命令 文件名替换 乱码修复 文件名净化等
    .command(await import("../cmd/cmd_rename.js"))
    // 命令 智能解压ZIP文件，处理文件名乱码问题
    .command(await import("../cmd/cmd_zipu.js"))
    // 命令 乱码解析，猜测编码，输出可能正确的字符串
    .command(await import("../cmd/cmd_decode.js"))
    // 命令，用ffmpeg执行视频和音频压缩和格式转换
    .command(await import("../cmd/cmd_ffmpeg.js"))
    .count("verbose")
    .alias("v", "verbose")
    .alias("h", "help")
    .epilog(
      "MediaCli is a multimedia file processing tool.\nCopyright 2021-2025 @ Zhang Xiaoke"
    )
    .demandCommand(1, chalk.red("Missing sub command you want to execute!"))
    .showHelpOnFail(true)
    .version()
    .help()
    .middleware([configCli])
  const logFilePath = log.fileLogPath()
  try {
    log.show('==============================================================')
    const argv = await ya.parse()
    log.debug(argv)
  } catch (err) {
    // await ya.getHelp()
    log.showRed(`${err.message}`)
  } finally {
    await log.flushFileLog()
    if (await fs.pathExists(logFilePath)) {
      const filePath = logFilePath.split(path.sep).join("/")
      log.showYellow(`See logs: file:///${filePath}`)
      // await open(filePath)
    }
  }
}

async function cmdOrganize(argv) {
  log.show('cmdOrganize', argv)
  const root = path.resolve(argv.input)
  const byDay = argv.day || false
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp()
    log.error("Organize", `Invalid Input: '${root}'`)
    return
  }
  const output = argv.output || root
  // rules:
  // 1. into folders by file type (png/video/image)
  // 2. into folders by date month
  log.show(`Organize: input:`, root)
  log.show(`Organize: output:`, output)
  let files = await exif.listMedia(root)
  files = await exif.parseFiles(files)
  log.show("Organize", `Total ${files.length} media files found.` + byDay ? "DAY MODE" : "MONTH MODE")
  const pics = {}
  files.forEach((f, i) => {
    log.debug(`Processing(${i}):`, path.basename(f.path))
    if (f.size > 0) {
      if ([".png", ".gif"].includes(helper.pathExt(f.path, true))) {
        if (!pics["pngs"]) {
          pics["pngs"] = []
        }
        pics["pngs"].push(f)
        log.debug("PNG Item:", f.path)
      } else {
        let dirName
        const monthStr = dayjs(f.date).format("YYYYMM")
        const dayStr = dayjs(f.date).format("YYYYMMDD")
        const dateStr = byDay ? dayStr : monthStr
        if (helper.isVideoFile(f.path)) {
          dirName = path.join("VID", dateStr)
        } else {
          dirName = dateStr
        }
        if (!pics[dirName]) {
          pics[dirName] = []
        }
        pics[dirName].push(f)
        log.show("Image Item:", f.path, dirName)
      }
    } else {
      log.show("Not Stats:", i, f.path, f.date)
    }

  })
  log.show(byDay ? "DAY MODE" : "MONTH MODE")
  for (const [k, v] of Object.entries(pics)) {
    if (v.length > 0) {
      log.show(
        `Organize:`,
        `${v.length} files will be moved to '${path.join(output, k)}'`
      )
    }
  }
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to move these ${files.length} files?`
      ),
    },
  ])
  if (answer.yes) {
    for (const [k, v] of Object.entries(pics)) {
      if (v.length > 0) {
        const movedFiles = []
        const fileOutput = path.join(output, k)
        for (const f of v) {
          const fileSrc = f.path
          const fileDst = path.join(fileOutput, path.basename(fileSrc))
          if (!(await fs.pathExists(fileSrc))) {
            log.info("Not Found:", fileSrc)
            continue
          }
          if (await fs.pathExists(fileDst)) {
            log.info("Skip Exists:", fileDst)
            continue
          }
          if (!(await fs.pathExists(fileOutput))) {
            await fs.mkdirp(fileOutput)
          }
          try {
            await fs.move(fileSrc, fileDst)
            movedFiles.push([fileSrc, fileDst])
            log.info("Moved:", fileSrc, "to", fileDst)
          } catch (error) {
            log.error("Failed:", error, fileSrc, "to", fileDst)
          }
        }
        if (v.length - movedFiles.length > 0) {
          log.showYellow(
            `Skipped:`,
            `${v.length - movedFiles.length
            } files are already in '${fileOutput}'`
          )
        }
        if (movedFiles.length > 0) {
          log.showGreen(
            `Done:`,
            `${movedFiles.length} files are moved to '${fileOutput}'`
          )
        }
      }
    }
  } else {
    log.showYellow("Will do nothing, aborted by user.")
  }
}

async function cmdLRMove(argv) {
  log.show('cmdLRMove', argv)
  const root = path.resolve(argv.input)
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp()
    log.error("LRMove", `Invalid Input: '${root}'`)
    return
  }
  // const output = argv.output || root;
  log.show(`LRMove: input:`, root)
  // log.show(`LRMove: output:`, output);
  let filenames = await mf.walk(root, { needStats: true, withFiles: false, withDirs: true })
  filenames = filenames.map(entry => entry.path).filter(f => path.basename(f) === "JPEG")
  log.show("LRMove:", `Total ${filenames.length} JPEG folders found`)
  if (filenames.length === 0) {
    log.showGreen("Nothing to do, abort.")
    return
  }
  const files = filenames.map(f => {
    const fileSrc = f
    const fileBase = path.dirname(fileSrc)
    const fileDst = fileBase.replace("RAW" + path.sep, "JPEG" + path.sep)
    const task = {
      fileSrc: fileSrc,
      fileDst: fileDst
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
        `Are you sure to move these ${files.length} JPEG folder with files?`
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
