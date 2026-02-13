/*
 * File: cmd_prefix.js
 * Created: 2024-03-15 16:29:41 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import { sify } from "chinese-conv"
import fs from "fs-extra"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import { asyncFilter } from "../lib/core.js"
import * as log from "../lib/debug.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import {
    RE_MEDIA_DIR_NAME,
    RE_ONLY_NUMBER,
    RE_UGLY_CHARS,
    RE_UGLY_CHARS_BORDER,
    cleanFileName,
    renameFiles,
} from "./cmd_shared.js"

const MODE_AUTO = "auto"
const MODE_DIR = "dirname"
const MODE_PREFIX = "prefix"
const MODE_MEDIA = "media"
const MODE_CLEAN = "clean"

const NAME_LENGTH = 48

export { aliases, builder, command, describe, handler }

const command = "prefix <input> [output]"
const aliases = ["pf", "px"]
const describe = t("prefix.description")
const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .option("length", {
                alias: "l",
                type: "number",
                default: NAME_LENGTH,
                description: t("prefix.length"),
            })
            // 仅处理符合指定条件的文件，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            // 仅处理不符合指定条件的文件，例外文件名规则
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            // 仅用于PREFIX模式，文件名添加指定前缀字符串
            .option("prefix", {
                alias: "p",
                type: "string",
                description: t("prefix.prefix"),
            })
            // 指定MODE，三种：自动，目录名，指定前缀
            .option("mode", {
                alias: "m",
                type: "string",
                default: MODE_AUTO,
                description: t("prefix.mode"),
                choices: [MODE_AUTO, MODE_DIR, MODE_PREFIX, MODE_MEDIA, MODE_CLEAN],
            })
            .option("auto", {
                type: "boolean",
                description: t("prefix.auto"),
            })
            .option("dirname", {
                alias: "D",
                type: "boolean",
                description: t("prefix.dirname"),
            })
            .option("prefix", {
                alias: "P",
                type: "boolean",
                description: t("prefix.prefix"),
            })
            .option("media", {
                alias: "M",
                type: "boolean",
                description: t("prefix.media"),
            })
            .option("clean-only", {
                alias: "C",
                type: "boolean",
                description: t("prefix.clean.only"),
            })
            // 清理文件名中的特殊字符和非法字符
            .option("clean", {
                alias: "c",
                type: "boolean",
                description: t("prefix.clean"),
            })
            // 全选模式，强制处理所有文件
            .option("all", {
                alias: "a",
                type: "boolean",
                description: t("prefix.all"),
            })
            // 并行操作限制，并发数，默认为 CPU 核心数
            .option("jobs", {
                alias: "j",
                describe: t("option.common.jobs"),
                type: "number",
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: t("option.common.doit"),
            })
    )
}

/**
 * 根据目录层次自动生成前缀
 * @param {string} dir - 目录路径
 * @param {string} sep - 分隔符
 * @returns {string} 生成的前缀
 */
function getAutoModePrefix(dir, sep) {
    // 从左到右的目录层次
    const [d1, d2, d3] = dir.split(path.sep).slice(-3)
    log.debug([d1, d2, d3].join(","))
    if (d3.includes(d1) && d2.includes(d1)) {
        return d3
    }
    if (d3.includes(d2)) {
        return d3
    }
    if (d2.includes(d1)) {
        return [d2, d3].join(sep)
    }
    return [d1, d2, d3].join(sep)
}

/**
 * 解析命名模式
 * @param {Object} argv - 命令行参数对象
 * @returns {string} 解析后的模式
 */
function parseNameMode(argv) {
    let mode = argv.auto ? MODE_AUTO : argv.mode || MODE_AUTO
    if (argv.mprefix) {
        mode = MODE_PREFIX
    }
    if (argv.dirname) {
        mode = MODE_DIR
    }
    if (argv.media) {
        mode = MODE_MEDIA
    }
    if (argv.cleanOnly) {
        mode = MODE_CLEAN
    }
    return mode
}

/**
 * 重复文件名Set，检测重复，防止覆盖
 */
const nameDupSet = new Set()
let nameDupIndex = 0

/**
 * 根据模式创建新文件名
 * @param {Object} f - 文件对象
 * @param {string} f.path - 文件路径
 * @param {Object} f.argv - 命令行参数对象
 * @param {number} f.index - 文件索引
 * @param {number} f.total - 总文件数
 * @param {number} f.size - 文件大小
 * @returns {Promise<Object>} 处理后的文件对象
 */
async function createNewNameByMode(f) {
    const argv = f.argv
    const mode = parseNameMode(argv)
    const nameLength = mode === MODE_MEDIA || mode === MODE_CLEAN ? 200 : argv.length || NAME_LENGTH
    const nameSlice = nameLength * -1
    const [dir, base, ext] = helper.pathSplit(f.path)
    const oldName = path.basename(f.path)
    const dirParts = dir.split(path.sep).slice(-3)
    const dirName = path.basename(dir)
    const logTag = `Prefix::${mode.toUpperCase()[0]}`
    // 直接忽略 . _ 开头的目录
    if (/^[\._]/.test(dirName)) {
        return
    }
    const ipx = `${f.index}/${f.total}`
    log.info(logTag, `Processing ${ipx} ${f.path}`)
    let sep = "_"
    let prefix = argv.prefix
    let oldBase = base

    switch (mode) {
        case MODE_CLEAN:
            {
                sep = "."
                prefix = ""
            }
            break
        case MODE_MEDIA:
            {
                sep = "."
                prefix = dirName
                if (prefix.match(RE_MEDIA_DIR_NAME)) {
                    prefix = dirParts[2]
                }
                if (prefix.length < 4 && /^[A-Za-z0-9]+$/.test(prefix)) {
                    prefix = dirParts[2] + sep + prefix
                }
            }
            break
        case MODE_PREFIX:
            {
                sep = "_"
                prefix = argv.prefix
            }
            break
        case MODE_DIR:
            {
                sep = "_"
                prefix = dirName
                if (prefix.match(RE_MEDIA_DIR_NAME)) {
                    prefix = dirParts[2]
                }
                if (prefix.match(RE_MEDIA_DIR_NAME)) {
                    prefix = dirParts[1]
                }
                if (prefix.match(RE_MEDIA_DIR_NAME)) {
                    prefix = dirParts[0]
                }
            }
            break
        case MODE_AUTO:
            {
                sep = "_"
                prefix = getAutoModePrefix(dir, sep)
                const shouldCheck = RE_ONLY_NUMBER.test(base) && base.length < 10
                const forceAll = argv.all || false
                if (!shouldCheck && !forceAll) {
                    log.info(logTag, `Ignore: ${ipx} ${helper.pathShort(f.path)} [Auto]`)
                    return
                }
            }
            break
        default:
            throw createError(ErrorTypes.INVALID_ARGUMENT, `Invalid mode: ${mode} ${argv.mode}`)
    }

    if (mode !== MODE_CLEAN) {
        // 无有效前缀，报错退出
        if (!prefix || prefix.length == 0) {
            log.warn(logTag, `Invalid Prefix: ${helper.pathShort(f.path)} ${mode}`)
            throw createError(ErrorTypes.MISSING_REQUIRED_ARGUMENT, `No prefix supplied!`)
        }
    }

    // 是否净化文件名，去掉各种特殊字符
    if (argv.clean || mode === MODE_CLEAN) {
        prefix = cleanFileName(prefix, { separator: sep, keepDateStr: false, tc2sc: true })
        oldBase = cleanFileName(oldBase, { separator: sep, keepDateStr: true, tc2sc: true })
    }
    // 不添加重复前缀
    if (oldBase.includes(prefix)) {
        log.info(logTag, `IgnorePrefix: ${ipx} ${helper.pathShort(f.path)}`)
        prefix = ""
    }
    // 确保文件名不含有文件系统不允许的非法字符
    oldBase = helper.filenameSafe(oldBase)
    let fullBase = prefix.length > 0 ? prefix + sep + oldBase : oldBase
    // 去除首位空白和特殊字符
    fullBase = fullBase.replaceAll(RE_UGLY_CHARS_BORDER, "")
    // 多余空白和字符替换为一个字符 _或.
    fullBase = fullBase.replaceAll(RE_UGLY_CHARS, sep)
    // 去掉重复词组，如目录名和人名
    fullBase = Array.from(new Set(fullBase.split(sep))).join(sep)
    // 限制文件名长度
    fullBase = helper.unicodeLength(fullBase) > nameLength ? fullBase.slice(nameSlice) : fullBase
    // 再次去掉首位的特殊字符和空白字符
    fullBase = fullBase.replaceAll(RE_UGLY_CHARS_BORDER, "")

    let newName = `${fullBase}${ext}`
    let newPath = path.resolve(path.join(dir, newName))

    if (newPath === f.path) {
        log.info(logTag, `Same: ${ipx} ${helper.pathShort(newPath)}`)
        f.skipped = true
    } else if (await fs.pathExists(newPath)) {
        // 目标文件已存在
        const stn = await fs.stat(newPath)
        if (f.size === stn.size) {
            // 如果大小相等，认为是同一个文件
            log.info(logTag, `Exists: ${ipx} ${helper.pathShort(newPath)}`)
            f.skipped = true
        } else {
            // 大小不相等，文件名添加后缀
            // 找到一个不重复的新文件名
            do {
                newName = `${fullBase}${sep}D${++nameDupIndex}${ext}`
                newPath = path.resolve(path.join(dir, newName))
            } while (nameDupSet.has(newPath))
            log.info(logTag, `NewName: ${ipx} ${helper.pathShort(newPath)}`)
        }
    } else if (nameDupSet.has(newPath)) {
        log.info(logTag, `Duplicate: ${ipx} ${helper.pathShort(newPath)}`)
        f.skipped = true
    }

    nameDupSet.add(newPath)

    if (f.skipped) {
        // 跳过的文件不做处理
    } else {
        f.outName = newName
        f.outPath = newPath
        log.showGray(logTag, `SRC: ${ipx} ${helper.pathShort(f.path)}`)
        log.show(logTag, `DST: ${ipx} ${helper.pathShort(newPath)}`)
        log.fileLog(`Prepare: ${ipx} <${f.path}> [SRC]`, logTag)
        log.fileLog(`Prepare: ${ipx} <${newPath}> [DST]`, logTag)
    }

    return f
}

const handler = async function cmdPrefix(argv) {
    const testMode = !argv.doit
    const logTag = "cmdPrefix"
    log.info(logTag, argv)
    const root = path.resolve(argv.input)
    if (!root || !(await fs.pathExists(root))) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, `Invalid Input: ${root}`)
    }
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
    }
    const mode = parseNameMode(argv)
    const prefix = argv.prefix
    const startMs = Date.now()
    log.show(logTag, `Input: ${root}`)

    if (mode === MODE_PREFIX && !prefix) {
        throw createError(ErrorTypes.MISSING_REQUIRED_ARGUMENT, `No prefix value supplied!`)
    }

    let files = await mf.walk(root, {
        needStats: true,
        entryFilter: (entry) => entry.isFile && entry.size > 1024,
    })
    log.show(logTag, `Total ${files.length} files found in ${helper.humanTime(startMs)}`)
    if (argv.include?.length >= 3) {
        // 处理include规则
        const pattern = new RegExp(argv.include, "gi")

        files = await asyncFilter(files, (x) => x.path.match(pattern))
        log.show(logTag, `Total ${files.length} files left after include rules`)
    } else if (argv.exclude?.length >= 3) {
        // 处理exclude规则
        const pattern = new RegExp(argv.exclude, "gi")
        log.showRed(pattern)
        files = await asyncFilter(files, (x) => !x.path.match(pattern))
        log.show(logTag, `Total ${files.length} files left after exclude rules`)
    }
    if (files.length == 0) {
        log.showYellow("Prefix", t("common.nothing.to.do"))
        return
    }
    files = files.map((f, i) => {
        return {
            ...f,
            argv: argv,
            index: i,
            total: files.length,
        }
    })
    const fCount = files.length
    //const tasks = files.map(f => createNewNameByMode(f, argv)).filter(f => f?.outName)
    const jobCount = argv.jobs || cpus().length * 4
    let tasks = await pMap(files, createNewNameByMode, { concurrency: jobCount })
    tasks = tasks.filter((f) => f?.outName)

    tasks = tasks.map((f, i) => {
        return {
            ...f,
            argv: argv,
            index: i,
            total: files.length,
        }
    })

    const tCount = tasks.length
    log.showYellow(logTag, `Total ${fCount - tCount} files are skipped.`)
    if (tasks.length > 0) {
        log.showGreen(logTag, `Total ${tasks.length} media files ready to rename`)
    } else {
        log.showYellow(logTag, t("common.nothing.to.do"))
        return
    }
    log.show(logTag, argv)
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(t("prefix.confirm.rename", { count: tasks.length })),
        },
    ])
    if (answer.yes) {
        if (testMode) {
            log.showYellow(logTag, `${tasks.length} files, NO file renamed in TEST MODE.`)
        } else {
            const results = await renameFiles(tasks, false)
            log.showGreen(logTag, `All ${results.length} file were renamed.`)
        }
    } else {
        log.showYellow(logTag, t("operation.cancelled"))
    }
}
