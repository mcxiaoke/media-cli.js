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
import { createRequire } from "module"
import path from "path"
import yargs from "yargs"
import * as log from "./lib/debug.js"
import { t } from "./lib/i18n.js"

// 最低支持的 Node 版本，与 package.json 的 engines 保持一致。
// 下限由依赖决定：exiftool-vendored@35 要求 >=20，glob@13 要求 18||20||>=22。
// 说明：此前代码使用 `using` 声明式资源管理（需 Node >= 24），
// 已改为共享单例 + 进程退出时释放，因此不再需要 24。
const MIN_NODE_MAJOR = 20

// yargs 的 .version() 需要从 cwd 向上查找 package.json，
// 全局安装（bin 指向 index.js）时查找会失败并输出 "unknown"。
// 这里直接从本模块所在位置读取，保证 --version 始终可用。
const require = createRequire(import.meta.url)
const { version: APP_VERSION } = require("./package.json")

// 版本前置校验：把"解析阶段 SyntaxError 裸堆栈"变成一条可读提示。
// 校验必须在任何业务模块 import 之前完成——ESM 的 import 是静态提升的，
// 因此这里用独立函数 + 顶部调用，不改 import 顺序也能先于依赖加载报错。
function checkNodeVersion() {
    const major = Number.parseInt(process.versions.node.split(".")[0], 10)
    if (Number.isNaN(major) || major < MIN_NODE_MAJOR) {
        process.stderr.write(
            [
                chalk.red(`MediaCli 需要 Node.js >= ${MIN_NODE_MAJOR}，当前为 ${process.versions.node}。`),
                "请升级 Node.js 后重试：https://nodejs.org/",
                "",
            ].join("\n"),
        )
        process.exit(1)
    }
}

checkNodeVersion()

// fix max listeners
EventEmitter.defaultMaxListeners = 1000

// 全局兜底错误捕获：此前全仓库没有注册任何 process 级处理器，
// 未捕获异常只会打印裸堆栈且退出码不确定，CLAUDE.md 的相关描述与实现不符。
process.on("uncaughtException", (error) => {
    log.showRed(`未捕获异常: ${error?.stack || error?.message || error}`)
    process.exitCode = 1
})
process.on("unhandledRejection", (reason) => {
    log.showRed(`未处理的 Promise 拒绝: ${reason?.stack || reason?.message || reason}`)
    process.exitCode = 1
})

// 配置调试等级
const configCli = (argv) => {
    // 太冗长了删掉
    delete argv.$0
    // log.setName("MediaCli");
    log.setVerbose(argv.verbose)
    log.debug(argv)
}

await main()

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
            () => {
                // yargs.option("output", {
                //   alias: "o",
                //   type: "string",
                //   normalize: true,
                //   description: "Output folder",
                // });
            },
            () => {
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
        // 命令 从文件名中提取日期时间，移动文件
        .command(await import("./cmd/cmd_pick.js"))
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
        .version(APP_VERSION)
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
        // 必须设置非 0 退出码：否则脚本报错仍以 exit 0 结束，
        // CI / 批处理串联会把失败误判为成功。
        process.exitCode = 1
    } finally {
        await log.flushFileLog()
        if (await fs.pathExists(logFilePath)) {
            const filePath = logFilePath.split(path.sep).join("/")
            log.showYellow(`See logs: file:///${filePath}`)
            // await open(filePath)
        }
    }
}
