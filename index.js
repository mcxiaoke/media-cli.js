#!/usr/bin/env node
/*
 * File: media_cli.js
 * Modified: 2024-04-08 22:21:01
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import EventEmitter from "events"
import fs from "fs-extra"
import { cpus } from "os"
import path from "path"
import yargs from "yargs"
import * as log from "./lib/debug.js"
import * as exif from "./lib/exif.js"
import * as mf from "./lib/file.js"
import * as helper from "./lib/helper.js"
import { i18n, t } from "./lib/i18n.js"

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
            },
        )
        // 运行一些简单的测试任务
        .command(await import("./cmd/cmd_run.js"))
        // 命令：DCIM重命名
        // 默认按照EXIF拍摄日期重命名，可提供自定义模板
        .command(await import("./cmd/cmd_dcim.js"))
        // 命令 LR输出文件移动
        // 移动RAW目录下LR输出的JPEG目录到单独的图片目录
        .command(await import("./cmd/cmd_lr.js"))
        // 命令 压缩图片
        // 压缩满足条件的图片，可指定最大边长和文件大小，输出质量
        // 可选删除压缩后的源文件
        .command(await import("./cmd/cmd_compress.js"))
        // 命令 删除图片
        // 按照指定规则删除文件，条件包括宽度高度、文件大小、文件名规则
        // 支持严格模式和宽松模式
        .command(await import("./cmd/cmd_remove.js"))
        // 命令 向上移动文件
        // 把多层嵌套目录下的文件移动到顶层目录，按图片和视频分类
        .command(await import("./cmd/cmd_moveup.js"))
        // 命令 按文件名日期时间移动文件
        // 按文件名的日期时间，移动到按年月的子目录中
        .command(await import("./cmd/cmd_move.js"))
        // 命令 重命名文件 添加前缀
        .command(await import("./cmd/cmd_prefix.js"))
        // 命令 文件名替换 乱码修复 文件名净化等
        .command(await import("./cmd/cmd_rename.js"))
        // 命令 智能解压ZIP文件，处理文件名乱码问题
        .command(await import("./cmd/cmd_zipu.js"))
        // 命令 乱码解析，猜测编码，输出可能正确的字符串
        .command(await import("./cmd/cmd_decode.js"))
        // 命令，用ffmpeg执行视频和音频压缩和格式转换
        .command(await import("./cmd/cmd_ffmpeg.js"))
        .count("verbose")
        .alias("v", "verbose")
        .alias("h", "help")
        .epilog(`${t("app.description")}.\n${t("app.copyright")}`)
        .demandCommand(1, chalk.red("缺少要执行的子命令!"))
        .showHelpOnFail(true)
        .version()
        .help()
        .middleware([configCli])
    const logFilePath = log.fileLogPath()
    try {
        log.show("==============================================================")
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
