#!/usr/bin/env node
import assert from "assert";
import chalk from 'chalk';
import dayjs from "dayjs";
import fs from 'fs-extra';
import inquirer from "inquirer";
import { cpus } from "os";
import pMap from 'p-map';
import path from "path";
import PrettyError from 'pretty-error';
import sharp from "sharp";
import yargs from "yargs";
import * as log from '../lib/debug.js';
import * as exif from '../lib/exif.js';
import * as mf from '../lib/file.js';
import * as helper from '../lib/helper.js';

import EventEmitter from 'events';

const cpuCount = cpus().length;
// debug and logging config
// 配置错误信息输出
const prettyError = PrettyError.start();
prettyError.skipNodeFiles();
// 配置调试等级
const configCli = (argv) => {
  // log.setName("MediaCli");
  log.setVerbose(argv.verbose);
  log.debug(argv);
};

EventEmitter.defaultMaxListeners = 1000;

main();

async function main() {
  // 命令行参数解析
  // const ya = yargs(process.argv.slice(2));
  // https://github.com/yargs/yargs/blob/master/docs/advanced.md
  const ya = yargs(process.argv.slice(2));
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
        ya.showHelp();
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
        // yargs.option("output", {
        //   alias: "o",
        //   type: "string",
        //   normalize: true,
        //   description: "Output folder",
        // });
      },
      (argv) => {
        cmdOrganize(argv);
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
        cmdLRMove(argv);
      }
    )
    // 命令 生成缩略图
    // 生成指定大小的缩略图，可指定最大边长
    .command(
      ["thumbs <input> [output]", "tb"],
      "Make thumbs for input images",
      (ya) => {
        ya
          // .option("output", {
          //   alias: "o",
          //   type: "string",
          //   normalize: true,
          //   description: "Output folder",
          // })
          .option("force", {
            alias: "f",
            type: "boolean",
            description: "Force to override existing thumb files",
          })
          .option("max", {
            alias: "m",
            type: "number",
            description: "Max size of long side of image thumb",
          });
      },
      (argv) => {
        cmdThumbs(argv);
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
    // 命令 文件名修复 乱码修复 文件名净化
    .command(await import("../cmd/cmd_fixname.js"))
    // 命令 智能解压ZIP文件，处理文件名乱码问题
    .command(await import("../cmd/cmd_zipu.js"))
    // 命令 乱码解析，猜测编码，输出可能正确的字符串
    .command(await import("../cmd/cmd_decode.js"))
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
    .middleware([configCli]);
  const logFilePath = log.fileLogPath()
  try {
    log.show('==============================================================')
    const argv = await ya.parse();
    log.debug(argv)
  } catch (err) {
    // await ya.getHelp()
    log.showRed(`${err.message}`);
  } finally {
    await log.flushFileLog();
    if (await fs.pathExists(logFilePath)) {
      const filePath = logFilePath.split(path.sep).join("/");
      log.showYellow(`See logs: file:///${filePath}`);
      // await open(filePath)
    }
  }
}

async function cmdOrganize(argv) {
  log.show('cmdOrganize', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("Organize", `Invalid Input: '${root}'`);
    return;
  }
  const output = argv.output || root;
  // rules:
  // 1. into folders by file type (png/video/image)
  // 2. into folders by date month
  log.show(`Organize: input:`, root);
  log.show(`Organize: output:`, output);
  let files = await exif.listMedia(root);
  log.show("Organize", `Total ${files.length} media files found`);
  const pics = {};
  files.forEach((f, i) => {
    log.debug(`Processing(${i}):`, path.basename(f.path), f.stats.mtime);
    if ([".png", ".gif"].includes(helper.pathExt(f.path, true))) {
      if (!pics["pngs"]) {
        pics["pngs"] = [];
      }
      pics["pngs"].push(f);
      log.debug("PNG Item:", f.path);
    } else if (
      f.stats.size < 1000 * 1024 &&
      helper.pathExt(f.path, true) === ".jpg"
    ) {
      if (!pics["pngs"]) {
        pics["pngs"] = [];
      }
      pics["pngs"].push(f);
      log.debug("Other Item:", f.path, helper.humanSize(f.stats.size));
    } else {
      let dirName;
      const dateStr = dayjs(f.stats.mtime).format("YYYYMM");;
      if (helper.isVideoFile(f.path)) {
        dirName = path.join("vids", dateStr);
      } else {
        dirName = dateStr;
      }
      if (!pics[dirName]) {
        pics[dirName] = [];
      }
      pics[dirName].push(f);
      log.debug("Image Item:", f.path, dirName);
    }
  });
  for (const [k, v] of Object.entries(pics)) {
    if (v.length > 0) {
      log.show(
        `Organize:`,
        `${v.length} files will be moved to '${path.join(output, k)}'`
      );
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
  ]);
  if (answer.yes) {
    for (const [k, v] of Object.entries(pics)) {
      if (v.length > 0) {
        const movedFiles = [];
        const fileOutput = path.join(output, k);
        for (const f of v) {
          const fileSrc = f.path;
          const fileDst = path.join(fileOutput, path.basename(fileSrc));
          if (!(await fs.pathExists(fileSrc))) {
            log.info("Not Found:", fileSrc);
            continue;
          }
          if (await fs.pathExists(fileDst)) {
            log.info("Skip Exists:", fileDst);
            continue;
          }
          if (!(await fs.pathExists(fileOutput))) {
            await fs.mkdirp(fileOutput);
          }
          try {
            await fs.move(fileSrc, fileDst);
            movedFiles.push([fileSrc, fileDst]);
            log.info("Moved:", fileSrc, "to", fileDst);
          } catch (error) {
            log.error("Failed:", error, fileSrc, "to", fileDst);
          }
        }
        if (v.length - movedFiles.length > 0) {
          log.showYellow(
            `Skipped:`,
            `${v.length - movedFiles.length
            } files are already in '${fileOutput}'`
          );
        }
        if (movedFiles.length > 0) {
          log.showGreen(
            `Done:`,
            `${movedFiles.length} files are moved to '${fileOutput}'`
          );
        }
      }
    }
  } else {
    log.showYellow("Will do nothing, aborted by user.");
  }
}

async function cmdLRMove(argv) {
  log.show('cmdLRMove', argv);
  const root = path.resolve(argv.input);
  if (!root || !(await fs.pathExists(root))) {
    yargs.showHelp();
    log.error("LRMove", `Invalid Input: '${root}'`);
    return;
  }
  // const output = argv.output || root;
  log.show(`LRMove: input:`, root);
  // log.show(`LRMove: output:`, output);
  let filenames = await mf.walkDir(root, { needStats: false, });
  filenames = filenames.filter(f => path.basename(f) === "JPEG");
  log.show("LRMove:", `Total ${filenames.length} JPEG folders found`);
  if (filenames.length === 0) {
    log.showGreen("Nothing to do, abort.");
    return;
  }
  const files = filenames.map(f => {
    const fileSrc = f;
    const fileBase = path.dirname(fileSrc);
    const fileDst = fileBase.replace("RAW" + path.sep, "JPEG" + path.sep);
    const task = {
      fileSrc: fileSrc,
      fileDst: fileDst
    }
    log.show(`SRC:`, fileSrc);
    log.show("DST:", fileDst);
    return task;
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
  ]);
  if (answer.yes) {
    for (const f of files) {
      try {
        await fs.move(f.fileSrc, f.fileDst);
        log.showGreen("Moved:", f.fileSrc, "to", f.fileDst);
      } catch (error) {
        log.error("Failed:", error, f.fileSrc, "to", f.fileDst);
      }
    }
  } else {
    log.showYellow("Will do nothing, aborted by user.");
  }
}

// 文心一言注释
// 准备缩略图参数的异步函数  
async function prepareThumbArgs(f, options) {
  // 默认选项为空对象  
  options = options || {};
  // 最大尺寸，默认为3000  
  const maxSize = options.maxSize || 3000;
  // 是否强制，默认为false  
  const force = options.force || false;
  // 输出路径，默认为undefined  
  const output = options.output || undefined;
  // 文件源路径，解析后  
  let fileSrc = path.resolve(f.path);
  // 使用helper.pathSplit分割路径，得到目录、基本名称和扩展名  
  const [dir, base, ext] = helper.pathSplit(fileSrc);
  // 文件目标路径  
  let fileDst;
  // 目录目标路径  
  let dirDst;
  // 如果output存在，使用output重写目录目标路径  
  if (output) {
    dirDst = helper.pathRewrite(dir, output);
  } else {
    // 否则，将目录目标路径替换为'Thumbs'文件夹，或者如果目录目标路径和目录相同，则创建一个新目录（例如'202206_thumbs'）  
    dirDst = dir.replace(/JPEG|Photos/i, 'Thumbs');
    if (dirDst === dir) {
      dirDst = path.join(path.dirname(dir), path.basename(dir) + '_thumbs');
    }
  }
  // 将目录目标路径中的'相机照片'替换为'相机小图'  
  dirDst = dirDst.replace('相机照片', '相机小图');
  // 文件目标路径，加入新的基本名称和扩展名（例如'_thumb.jpg'）  
  fileDst = path.join(dirDst, `${base}_thumb.jpg`);
  // 解析文件源路径和文件目标路径为绝对路径  
  fileSrc = path.resolve(fileSrc);
  fileDst = path.resolve(fileDst);

  // 检查文件目标路径是否存在，如果存在并且不强制执行，则返回空对象；否则，如果强制执行，则继续执行下面的代码块  
  if (await fs.pathExists(fileDst)) {
    log.info("prepareThumbArgs exists:", fileDst, force ? "(Override)" : "");
    if (!force) {
      return;
    }
  }
  try {
    // 使用sharp库创建图像对象，并传入文件源路径  
    const s = sharp(fileSrc);
    // 获取图像元数据对象，并等待操作完成  
    const m = await s.metadata();
    // 如果图像宽度和高度都小于等于最大尺寸，则打印调试信息并返回空对象；否则，继续执行下面的代码块  
    if (m.width <= maxSize && m.height <= maxSize) {
      log.debug("prepareThumbArgs skip:", fileSrc);
      return;
    }
    // 根据图像宽度和高度计算新的宽度和高度，使宽度不超过最大尺寸，并保持高度比例不变  
    const nw = m.width > m.height ? maxSize : Math.round((maxSize * m.width) / m.height);
    const nh = Math.round((nw * m.height) / m.width);
    // 打印信息，显示文件目标路径、原始尺寸和新尺寸（例如'F:\Temp\照片\202206_thumbs\202206_thumb.jpg (3072x2048 => 300x200)'）  
    log.info("prepareThumbArgs add:", fileDst, `(${m.width}x${m.height} => ${nw}x${nh})`);
    // 返回一个对象，包含新尺寸、文件源路径和文件目标路径等属性，同时包含索引属性（如果原始对象存在）  
    return { width: nw, height: nh, src: fileSrc, dst: fileDst, index: f.index };
  } catch (error) {
    log.error("prepareThumbArgs error:", error, f.path);
  }
}

async function cmdThumbs(argv) {
  log.show('cmdThumbs', argv);
  const root = path.resolve(argv.input);
  assert.strictEqual("string", typeof root, "root must be string");
  if (!root || !(await fs.pathExists(root))) {
    ya.showHelp();
    log.error("cmdThumbs", `Invalid Input: '${root}'`);
    return;
  }
  const maxWidth = argv.max || 3000;
  const force = argv.force || false;
  const output = argv.output;
  // return;
  // const output = argv.output || root;
  log.show(`cmdThumbs: input:`, root);
  log.show(`cmdThumbs: output:`, output);

  const RE_THUMB = /(小图|精选|feature|web|thumb)/i;
  const walkOpts = {
    entryFilter: (f) =>
      f.stats.isFile() &&
      f.stats.size > 500 * 1024 &&
      helper.isImageFile(f.path) &&
      !RE_THUMB.test(f.path),
  };
  const files = await mf.walk(root, walkOpts);
  log.info("cmdThumbs", `total ${files.length} found`);
  const conditions = {
    maxWidth: maxWidth,
    force: force,
    output: output,
  };
  const prepareFunc = async f => {
    return prepareThumbArgs(f, conditions)
  }
  let tasks = await pMap(files, prepareFunc, { concurrency: cpus().length })
  log.debug("cmdThumbs before filter: ", tasks.length);
  const total = tasks.length;
  tasks = tasks.filter((t) => t && t.dst);
  const skipped = total - tasks.length;
  log.debug("cmdThumbs after filter: ", tasks.length);
  if (skipped > 0) {
    log.showYellow(`cmdThumbs: ${skipped} thumbs skipped`)
  }
  if (tasks.length === 0) {
    log.showYellow("Nothing to do, abort.");
    return;
  }
  log.show(`cmdThumbs: task sample:`, tasks.slice(-1))
  const answer = await inquirer.prompt([
    {
      type: "confirm",
      name: "yes",
      default: false,
      message: chalk.bold.red(
        `Are you sure to make thumbs for ${tasks.length} files?`
      ),
    },
  ]);

  if (!answer.yes) {
    log.showYellow("Will do nothing, aborted by user.");
    return;
  }

  const startMs = Date.now();
  log.showGreen('cmdThumbs: startAt', dayjs().format())
  const result = await pMap(tasks, compressImage, { concurrency: cpuCount });
  log.showGreen('cmdThumbs: endAt', dayjs().format())
  log.showGreen(`cmdThumbs: ${result.length} thumbs generated in ${helper.humanTime(startMs)}`)
}
