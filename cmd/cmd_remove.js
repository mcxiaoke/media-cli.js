/*
 * File: cmd_remove.js
 * Created: 2024-03-15 20:34:17 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import assert from "assert"
import chalk from "chalk"
import dayjs from "dayjs"
import { fileTypeFromFile } from "file-type"
import fs from "fs-extra"
import imageSizeOfSync from "image-size"
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from "p-map"
import path from "path"
import { argv } from "process"
import { promisify } from "util"
import { comparePathSmartBy, uniqueByFields } from "../lib/core.js"
import * as log from "../lib/debug.js"
import * as enc from "../lib/encoding.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"
import { getMediaInfo, getVideoInfo } from "../lib/mediainfo.js"
import { addEntryProps, applyFileNameRules } from "./cmd_shared.js"

// a = all, f = files, d = directories
const TYPE_LIST = ["a", "f", "d"]

export { aliases, builder, command, describe, handler }

const command = "remove [input] [directories...]"
const aliases = ["rm", "rmf"]
const describe = t("remove.description")

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            .option("loose", {
                alias: "l",
                type: "boolean",
                default: false,
                // 宽松模式，默认不开启，宽松模式条件或，默认严格模式条件与
                description: t("remove.loose"),
            })
            // 输出目录，如果存在，就是移动到这个目录，否则是删除
            .option("output", {
                alias: "o",
                type: "string",
                description: t("option.remove.output"),
            })
            // 保持源文件目录结构
            .option("output-tree", {
                alias: "otree",
                describe: t("remove.output.tree"),
                type: "boolean",
                default: false,
            })
            // 正则，包含文件名规则
            .option("include", {
                alias: "I",
                type: "string",
                description: t("option.common.include"),
            })
            //字符串或正则，不包含文件名规则
            // 如果是正则的话需要转义
            .option("exclude", {
                alias: "E",
                type: "string",
                description: t("option.common.exclude"),
            })
            // 默认启用正则模式，禁用则为字符串模式
            .option("regex", {
                alias: "re",
                type: "boolean",
                default: true,
                description: t("option.common.regex"),
            })
            // 需要处理的扩展名列表，默认为常见视频文件
            .option("extensions", {
                alias: "e",
                type: "string",
                describe: t("option.common.extensions"),
            })
            .option("width", {
                type: "number",
                default: 0,
                // 图片文件的最大宽度
                description: t("remove.width"),
            })
            .option("height", {
                type: "number",
                default: 0,
                // 图片文件的最大高度
                description: t("remove.height"),
            })
            .option("measure", {
                alias: "m",
                type: "string",
                default: "",
                // 图片文件的长宽字符串形式
                description: t("remove.measure"),
            })
            .option("sizel", {
                alias: "sl",
                type: "number",
                default: 0,
                // 图片文件的文件大小，最小值，大于，单位为k
                description: t("remove.sizel"),
            })
            .option("sizer", {
                alias: "sr",
                type: "number",
                default: 0,
                // size 的 别名
                // 图片文件的文件大小，最大值，小于，单位为k
                description: t("remove.sizer"),
            })
            .option("pattern", {
                alias: "p",
                type: "string",
                default: "",
                // 文件名匹配，字符串或正则表达式
                description: t("remove.pattern"),
            })
            // 启用反转匹配模式
            .option("not-match", {
                alias: "n",
                type: "boolean",
                default: false,
                description: t("remove.not.match"),
            })
            .option("list", {
                type: "string",
                default: null,
                // 文件名列表文本文件，或者一个目录，里面包含的文件作为文件名列表来源
                description: t("remove.list"),
            })
            // 视频模式，按照视频文件的元数据删除
            // duration,dimension(width,height),bitrate
            // 参数格式 缩写 du=xx,w=xx,h=xx,dm=xx,bit=xx
            // duration=xx,width=xx,height=xx,bitrate=xx
            .option("video", {
                alias: "vdm",
                type: "string",
                description: t("remove.video"),
            })
            // 要处理的文件类型 文件或目录或所有，默认只处理文件
            .option("type", {
                type: "choices",
                choices: TYPE_LIST,
                default: "f",
                description: t("remove.type"),
            })
            .option("reverse", {
                alias: "r",
                type: "boolean",
                default: false,
                // 文件名列表反转，默认为否，即删除列表中的文件，反转则删除不在列表中的文件
                description: t("remove.reverse"),
            })
            .option("corrupted", {
                alias: "c",
                type: "boolean",
                default: false,
                // 移除损坏的文件
                description: t("remove.corrupted"),
            })
            .option("badchars", {
                alias: "b",
                type: "boolean",
                default: false,
                // 移除文件名含乱码的文件
                description: t("remove.badchars"),
            })
            .option("delete-permanently", {
                type: "boolean",
                default: false,
                // 直接删除文件，不使用安全删除
                description: t("remove.delete.permanently"),
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

const handler = cmdRemove
async function cmdRemove(argv) {
    const logTag = "cmdRemove"
    log.info(logTag, argv)
    const testMode = !argv.doit
    assert.strictEqual("string", typeof argv.input, "root must be string")
    const root = await helper.validateInput(argv.input)
    // 1200*1600 1200,1600 1200x1600 1200|1600
    const reMeasure = /^\d+[x*,\|]\d+$/
    // 如果没有提供任何一个参数，报错，显示帮助
    if (
        argv.width == 0 &&
        argv.height == 0 &&
        argv.size == 0 &&
        !(argv.measure && reMeasure.test(argv.measure)) &&
        !argv.pattern &&
        !argv.list &&
        !argv.corrupted &&
        !argv.badchars
    ) {
        log.show(logTag, argv)
        log.error(logTag, t("remove.required.conditions"))
        throw createError(ErrorTypes.MISSING_REQUIRED_ARGUMENT, t("remove.required.conditions"))
    }

    const type = (argv.type || "f").toLowerCase()
    if (!TYPE_LIST.includes(type)) {
        throw createError(ErrorTypes.INVALID_ARGUMENT, `Error: type must be one of ${TYPE_LIST}`)
    }

    let cWidth = 0
    let cHeight = 0
    if (argv.width > 0 && argv.height > 0) {
        cWidth = argv.width
        cHeight = argv.height
    } else if (argv.measure && argv.measure.length > 0) {
        // 解析文件长宽字符串，例如 2160x4680
        const [x, y] = argv.measure.split(/[x*,\|]/).map(Number)
        log.showRed(x, y)
        if (x > 0 && y > 0) {
            cWidth = x
            cHeight = y
        }
    }

    const cList = argv.list || "-not-exists"

    let cNames = []
    if (await fs.pathExists(path.resolve(cList))) {
        try {
            const list = path.resolve(cList)
            const listStat = await fs.stat(list)
            if (listStat.isFile()) {
                cNames = (await readNameList(list)) || new Set()
            } else if (listStat.isDirectory()) {
                const dirFiles = (await fs.readdir(list)) || []
                cNames = new Set(dirFiles.map((x) => path.parse(x).name.trim()))
            } else {
                log.error(logTag, `invalid arguments: list file invalid 1`)
                return
            }
        } catch (error) {
            log.error(logTag, `invalid arguments: list file invalid 2`)
            return
        }
    }

    cNames = cNames || new Set()

    log.show(logTag, `${t("path.input")}:`, root)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
    }

    const walkOpts = {
        needStats: true,
        withDirs: type === "d",
        withFiles: type === "a" || type === "f",
        withIndex: true,
    }
    log.showGreen(logTag, `${t("remove.scanning")}... (${type})`)
    let fileEntries = await mf.walk(root, walkOpts)
    log.show(logTag, `${t("remove.found.files", { count: fileEntries.length })}: ${root}`)
    // 处理额外目录参数
    if (argv.directories?.length > 0) {
        const extraDirs = new Set(argv.directories.map((d) => path.resolve(d)))
        for (const dirPath of extraDirs) {
            const st = await fs.stat(dirPath)
            if (st.isDirectory()) {
                const dirFiles = await mf.walk(dirPath, walkOpts)
                if (dirFiles.length > 0) {
                    log.show(
                        logTag,
                        t("ffmpeg.add.files", { count: dirFiles.length, path: dirPath }),
                    )
                    fileEntries = fileEntries.concat(dirFiles)
                }
            }
        }
    }
    // 根据完整路径去重
    fileEntries = uniqueByFields(fileEntries, "path")
    // 应用文件名过滤规则
    fileEntries = await applyFileNameRules(fileEntries, argv)
    // 路径排序，路径深度=>路径长度=>自然语言
    fileEntries = fileEntries.sort(comparePathSmartBy("path"))
    log.show(logTag, `${t("remove.found.files", { count: fileEntries.length })} (${type})`)

    const conditions = {
        total: fileEntries.length,
        loose: argv.loose,
        corrupted: argv.corrupted,
        badchars: argv.badchars,
        width: cWidth,
        height: cHeight,
        sizeLeft: argv.sizel || 0,
        sizeRight: argv.sizer || 0,
        pattern: argv.pattern,
        notMatch: argv.notMatch,
        names: cNames || new Set(),
        reverse: argv.reverse || false,
        purge: argv.deletePermanently || false,
        testMode,
    }

    fileEntries = fileEntries.map((f, i) => {
        return {
            ...f,
            index: i,
            argv: argv,
            total: fileEntries.length,
            conditions: conditions,
        }
    })
    let tasks = await pMap(fileEntries, preRemoveArgs, { concurrency: cpus().length * 2 })

    conditions.names = Array.from(cNames).slice(-5)
    const total = tasks.length
    tasks = tasks.filter((t) => t?.shouldRemove)
    const skipped = total - tasks.length
    if (skipped > 0) {
        log.showYellow(logTag, t("remove.files.skipped", { count: skipped }))
    }
    if (tasks.length === 0) {
        log.show(logTag, conditions)
        log.showYellow(logTag, t("remove.nothing.to.do"))
        return
    }
    log.showYellow(logTag, t("remove.files.to.remove", { count: tasks.length, type: type }))
    // log.show(logTag, `Below are last sample tasks:`)
    // for (const task of tasks.slice(-20)) {
    //     log.show(`ToRemove: [${task.desc}] ${task.src}`)
    // }
    log.showYellow(logTag, conditions)
    if (cNames && cNames.size > 0) {
        // 默认仅删除列表中的文件，反转则仅保留列表中的文件，其它的全部删除，谨慎操作
        log.showYellow(logTag, `Attention: use file name list, ignore all other conditions`)
        log.showRed(
            logTag,
            `Attention: Will DELETE all files ${cReverse ? "NOT IN" : "IN"} the name list!`,
        )
    }
    log.fileLog(`Conditions: ${JSON.stringify(conditions)}`, logTag)
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    // 计算文件总共大小
    const totalSize = tasks.reduce((acc, file) => acc + file.size, 0)
    // 计算每个目录的大小和文件数目
    // const directoryStats = {}
    // files.forEach(file => {
    //     const directory = path.dirname(file.path)
    //     if (!directoryStats[directory]) {
    //         directoryStats[directory] = { size: 0, fileCount: 0 }
    //     }
    //     directoryStats[directory].size += file.size
    //     directoryStats[directory].fileCount++
    // })
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("remove.confirm.delete", {
                    count: tasks.length,
                    size: helper.humanSize(totalSize),
                    type: type,
                }),
            ),
        },
    ])

    if (!answer.yes) {
        log.showYellow(t("operation.cancelled"))
        return
    }

    const startMs = Date.now()
    log.showGreen(logTag, "task startAt", dayjs().format())
    let removedCount = 0
    let index = 0
    if (testMode) {
        log.showYellow(logTag, t("common.test.mode.note", { count: tasks.length }))
    } else {
        for (const task of tasks) {
            const flag = task.isDir ? "D" : "F"
            try {
                // 此选项为永久删除
                if (conditions.purge) {
                    await fs.remove(task.src)
                    log.show(
                        logTag,
                        `${t("operation.delete")} ${++index}/${tasks.length} ${helper.pathShort(task.src)} ${helper.humanSize(task.size)} ${flag}`,
                    )
                    log.fileLog(
                        `${t("operation.delete")}: ${task.index} <${task.src}> ${helper.humanSize(task.size)} ${flag}`,
                        logTag,
                    )
                } else {
                    // 此选项安全删除，仅移动到指定目录
                    await helper.safeRemove(task.src)
                    log.show(
                        logTag,
                        `${t("operation.move")} ${++index}/${tasks.length} ${helper.pathShort(task.src)} ${helper.humanSize(task.size)} ${flag}`,
                    )
                    log.fileLog(
                        `${t("operation.move")}: ${task.index} <${task.src}> ${helper.humanSize(task.size)} ${flag}`,
                        logTag,
                    )
                }
                ++removedCount
            } catch (error) {
                log.error(
                    logTag,
                    `${t("remove.failed")}: ${task.src} ${helper.humanSize(task.size)} ${flag}`,
                    error,
                )
            }
        }
    }

    log.showGreen(logTag, "task endAt", dayjs().format())
    log.showGreen(
        logTag,
        t("remove.summary", { count: removedCount, time: helper.humanTime(startMs), type: type }),
    )
}

/**
 * 从文件中读取文件名列表
 * @param {string} list - 文件名列表文件路径
 * @returns {Promise<Set<string>>} 文件名集合
 */
async function readNameList(list) {
    const listContent = (await fs.readFile(list, "utf-8")) || ""
    const nameList = listContent
        .split(/\r?\n/)
        .map((x) => path.parse(x).name.trim())
        .filter(Boolean)
    return new Set(nameList)
}

/**
 * 构建删除任务参数
 * @param {number} index - 文件索引
 * @param {string} desc - 任务描述
 * @param {boolean} shouldRemove - 是否应该删除
 * @param {string} src - 文件路径
 * @param {number} size - 文件大小
 * @returns {Object} 删除任务参数对象
 */
function buildRemoveArgs(index, desc, shouldRemove, src, size) {
    return {
        index,
        desc,
        shouldRemove,
        src,
        size,
    }
}

/**
 * 准备删除任务参数
 * @param {Object} f - 文件对象
 * @param {string} f.path - 文件路径
 * @param {boolean} f.isDir - 是否为目录
 * @param {number} f.index - 文件索引
 * @param {number} f.total - 总文件数
 * @param {number} f.size - 文件大小
 * @param {Object} f.conditions - 条件对象
 * @returns {Promise<Object>} 删除任务参数对象
 */
async function preRemoveArgs(f) {
    const fileSrc = path.resolve(f.path)
    const fileName = path.basename(fileSrc)
    const [dir, base, ext] = helper.pathSplit(fileSrc)
    const flag = f.isDir ? "D" : "F"
    const c = f.conditions || {}
    const ipx = `${f.index}/${f.total}`
    // 文件名列表规则
    const cNames = c.names || new Set()
    // 是否反转文件名列表
    const cReverse = c.reverse
    const hasList = cNames && cNames.size > 0

    let itemDesc = ""
    //----------------------------------------------------------------------
    if (hasList) {
        let shouldRemove = false
        const nameInList = cNames.has(base.trim())
        shouldRemove = cReverse ? !nameInList : nameInList
        itemDesc = `IN=${nameInList} R=${cReverse}`
        log.show(`preRemove[List] add:${ipx}`, `${helper.pathShort(fileSrc)} ${itemDesc} ${flag}`)
        return buildRemoveArgs(f.index, itemDesc, shouldRemove, fileSrc, f.size)
    }
    // 文件名列表是单独规则，优先级最高，如果存在，直接返回，忽略其它条件
    //----------------------------------------------------------------------

    // three args group
    // name pattern top1
    // width && height top2
    // size top3
    // 宽松模式，采用 OR 匹配条件，默认是 AND
    const hasLoose = c.loose || false
    // 删除损坏文件
    const hasCorrupted = c.corrupted || false
    // 移除乱码文件名的文件
    const hasBadChars = c.badchars || false
    // 最大宽度
    const cWidth = c.width || 0
    // 最大高度
    const cHeight = c.height || 0
    // 文件名匹配文本
    const cPattern = (c.pattern || "").toLowerCase()
    // 启用反向匹配
    const cNotMatch = c.notMatch || false

    const hasName = cPattern?.length > 0
    const hasSize = c.sizeLeft > 0 || c.sizeRight > 0
    const hasMeasure = cWidth > 0 || cHeight > 0

    let testCorrupted = false
    let testBadChars = false
    let testPattern = false
    let testSize = false
    let testMeasure = false

    const isImageExt = helper.isImageFile(fileSrc)
    const isVideoExt = helper.isVideoFile(fileSrc)
    const itemSize = f.size
    const itemCount = 1

    try {
        // 检查文件是否损坏
        if (hasCorrupted && f.isFile) {
            const isAudioExt = helper.isAudioFile(fileName)
            const isRawExt = helper.isRawFile(fileName)
            const isArchiveExt = helper.isArchiveFile(fileName)
            if (isAudioExt || isVideoExt) {
                // 大小小于5k，可能损坏
                if (f.size < 5 * 1024) {
                    log.showGray("preRemove[BadSizeM]:", `${ipx} ${fileSrc}`)
                    itemDesc += " BadSizeM"
                    testCorrupted = true
                } else {
                    // 对于媒体文件，获取媒体信息判断是否损坏
                    const info = await getMediaInfo(fileSrc)
                    // 正常的多媒体文件有duration和bitrate字段
                    const validMediaFile = info?.duration && info?.bitrate
                    if (!validMediaFile) {
                        log.showGray(
                            "preRemove[CorruptedMedia]:",
                            `${ipx} ${fileSrc}`,
                            info?.format || "unknwon format",
                        )
                        itemDesc += " Corrupted"
                        testCorrupted = true
                    }
                }
            } else if (isImageExt || isRawExt || isArchiveExt) {
                // 大小小于5k，可能损坏
                if (f.size < 5 * 1024) {
                    log.showGray("preRemove[BadSizeF]:", `${ipx} ${fileSrc}`)
                    itemDesc += " BadSizeF"
                    testCorrupted = true
                } else {
                    // 对于图片文件，检查文件类型
                    const ft = await fileTypeFromFile(fileSrc)
                    if (!ft?.mime) {
                        log.showGray("preRemove[CorruptedFormat]:", `${ipx} ${fileSrc}`)
                        itemDesc += " Corrupted"
                        testCorrupted = true
                    }
                }
            }
            if (!testCorrupted) {
                log.info("preRemove[Good]:", `${ipx} ${fileSrc}`)
            }
        }

        // 检查文件名是否有乱码
        if (hasBadChars) {
            if (enc.hasBadCJKChar(fileName) || enc.hasBadUnicode(fileName, true)) {
                log.showGray(
                    "preRemove[BadChars]:",
                    `${ipx} ${fileSrc} (${helper.humanSize(itemSize)},${itemCount})`,
                )
                itemDesc += " BadChars"
                testBadChars = true
            }
        }

        // 检查文件名匹配
        if (!testCorrupted && hasName) {
            const fName = fileName.toLowerCase()
            const rp = new RegExp(cPattern, "ui")
            itemDesc += ` P=${cPattern}`
            // 开头匹配，或末尾匹配，或正则匹配
            const pMatched =
                fName.startsWith(cPattern) || fName.endsWith(cPattern) || rp.test(fName)
            // 条件反转判断
            testPattern = cNotMatch ? !pMatched : pMatched
            if (testPattern) {
                log.info(
                    "preRemove[Name]:",
                    `${ipx} ${helper.pathShort(fileSrc)} [P=${rp}] (${helper.humanSize(itemSize)},${itemCount})`,
                )
            } else {
                log.debug("preRemove[Name]:", `${ipx} ${fileName} [P=${rp}]`)
            }
        }

        // 检查文件大小
        if (!testCorrupted && hasSize && f.isFile) {
            // 命令行参数单位为K，这里修正为字节
            const sizeLeft = c.sizeLeft * 1000
            const sizeRight = c.sizeRight * 1000
            itemDesc += ` S=${helper.humanSize(f.size)} (${c.sizeLeft}K,${c.sizeRight}K)`

            if (c.sizeRight > 0) {
                testSize = f.size > sizeLeft && f.size < sizeRight
            } else {
                testSize = f.size > sizeLeft
            }
            log.info(
                "preRemove[Size]:",
                `${ipx} ${fileName} [${helper.humanSize(itemSize)}] Size=(${c.sizeLeft}K,${c.sizeRight}K)`,
            )
        }

        // 检查宽高
        if (!testCorrupted && hasMeasure && f.isFile) {
            try {
                let fWidth, fHeight
                if (isImageExt) {
                    // 获取图片宽高
                    const imageSizeOf = promisify(imageSizeOfSync)
                    const dimension = await imageSizeOf(fileSrc)
                    fWidth = dimension.width || 0
                    fHeight = dimension.height || 0
                } else if (isVideoExt) {
                    // 获取视频宽高
                    const vi = await getVideoInfo(fileSrc)
                    fWidth = vi.width || 0
                    fHeight = vi.height || 0
                }

                itemDesc += ` M=${fWidth}x${fHeight}`
                if (cWidth > 0 && cHeight > 0) {
                    // 宽高都提供时，要求都满足才能删除
                    if (fWidth <= cWidth && fHeight <= cHeight) {
                        log.info(
                            "preRemove[M]:",
                            `${ipx} ${fileName} ${fWidth}x${fHeight} [${cWidth}x${cHeight}]`,
                        )
                        testMeasure = true
                    }
                } else if (cWidth > 0 && fWidth <= cWidth) {
                    // 只提供宽要求
                    log.info(
                        "preRemove[M]:",
                        `${ipx} ${fileName} ${fWidth}x${fHeight} [W=${cWidth}]`,
                    )
                    testMeasure = true
                } else if (cHeight > 0 && fHeight <= cHeight) {
                    // 只提供高要求
                    log.info(
                        "preRemove[M]:",
                        `${ipx} ${fileName} ${fWidth}x${fHeight} [H=${cHeight}]`,
                    )
                    testMeasure = true
                }
            } catch (error) {
                log.info("preRemove[M]:", `${ipx} InvalidImage: ${fileName} ${error.message}`)
            }
        }

        let shouldRemove = false

        if (testCorrupted || testBadChars) {
            shouldRemove = true
        } else {
            if (hasLoose) {
                // 宽松模式：满足任一条件
                shouldRemove = testPattern || testSize || testMeasure
            } else {
                // 严格模式：满足所有条件
                log.debug(
                    "PreRemove ",
                    `${ipx} ${helper.pathShort(fileSrc)} hasName=${hasName}-${testPattern} hasSize=${hasSize}-${testSize} hasMeasure=${hasMeasure}-${testMeasure} testCorrupted=${testCorrupted},testBadChars=${testBadChars},flag=${flag}`,
                )
                shouldRemove = checkConditions()
            }
        }

        if (shouldRemove) {
            // 大文件或大目录警告
            if (itemSize > mf.FILE_SIZE_1M * 200 || (f.isDir && itemCount > 100)) {
                log.showYellow(
                    "PreRemove[Large]:",
                    `${ipx} ${helper.pathShort(fileSrc)} (${helper.humanSize(itemSize)},${itemCount})  ${flag}`,
                )
            }
            log.show(
                chalk.green("PreRemove"),
                chalk.yellow("ADD"),
                ++preparedCount,
                `${helper.pathShort(fileSrc, 48)} ${itemDesc} ${testCorrupted ? "Corrupted" : ""} (${helper.humanSize(itemSize)})`,
                ipx,
            )
            log.fileLog(
                `add: ${ipx} <${fileSrc}> ${itemDesc} ${flag} (${helper.humanSize(itemSize)},${itemCount})`,
                "PreRemove",
            )
        } else {
            ;(testPattern || testSize || testMeasure) &&
                log.info(
                    "PreRemove ignore:",
                    `${ipx} ${helper.pathShort(fileSrc)} [${itemDesc}] (${testPattern} ${testSize} ${testMeasure}) ${flag}`,
                )
        }

        return buildRemoveArgs(f.index, itemDesc, shouldRemove, fileSrc, itemSize)
    } catch (error) {
        log.error(`PreRemove ${ipx} error:`, error, fileSrc, flag)
        log.fileLog(`Error: ${f.index} <${fileSrc}> ${flag}`, "PreRemove")
        throw error
    }

    /**
     * 检查删除条件
     * @returns {boolean} 是否满足删除条件
     */
    function checkConditions() {
        // 当三个条件都为真时
        if (hasName && hasSize && hasMeasure) {
            return testPattern && testSize && testMeasure
        }
        // hasMeasure = false
        else if (hasName && hasSize && !hasMeasure) {
            return testPattern && testSize
        }
        // hasName = false
        else if (!hasName && hasSize && hasMeasure) {
            return testSize && testMeasure
        }
        // hasSize = false
        else if (hasName && !hasSize && hasMeasure) {
            return testPattern && testMeasure
        }
        // 其他情况下，三个hasXXX条件只有一个为真，
        // hasXXX为false时 testXXX一定为false
        // 所以可以简化测试方法
        else {
            return testPattern || testSize || testMeasure
        }
    }
}
