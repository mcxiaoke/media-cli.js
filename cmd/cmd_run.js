/*
 * Project: mediac
 * Created: 2026-02-05 17:32:08
 * Modified: 2026-02-05 17:32:08
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */
import chalk from "chalk"
import * as cliProgress from "cli-progress"
import dayjs from "dayjs"
import { $, execa } from "execa"
import fs from "fs-extra"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import sharp from "sharp"
import * as core from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as exif from "../lib/exif.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"

//
export { aliases, builder, command, describe, handler }

const command = "execute [input]"
const aliases = ["run"]
const describe = "Run standalone tasks"

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            // 输出目录，默认输出文件与原文件同目录
            .option("output", {
                alias: "o",
                describe: "Folder store ouput files",
                type: "string",
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: "filename include pattern",
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: "filename exclude pattern ",
            })
            // 默认启用正则模式，禁用则为字符串模式
            .option("regex", {
                alias: "re",
                type: "boolean",
                default: true,
                description: "match filenames by regex pattern",
            })
            // 需要处理的扩展名列表，默认为常见视频文件
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: "include files by extensions (eg. .wav|.flac)",
            })
    )
}

const handler = cmdRunTask

async function cmdRunTask(argv) {
    const logTag = "cmdRunTask"
    const root = await helper.validateInput(argv.input)
    log.show(logTag, argv)
    const walkOpts = {
        needStats: true,
        entryFilter: (f) => f.isFile && helper.isImageFile(f.path),
    }
    // log.showGreen(logTag, `Walking files ...`)
    // let files = await mf.walk(root, walkOpts)
    // if (!files || files.length === 0) {
    //     log.showYellow(logTag, "no files found, abort.")
    //     return
    // }
}
