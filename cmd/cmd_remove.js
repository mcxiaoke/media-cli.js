/*
 * File: cmd_remove.js
 * Created: 2024-03-15 20:34:17 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */


import assert from "assert"
import chalk from 'chalk'
import dayjs from "dayjs"
import { fileTypeFromFile } from 'file-type'
import fs from 'fs-extra'
import imageSizeOfSync from 'image-size'
import inquirer from "inquirer"
import { cpus } from "os"
import pMap from 'p-map'
import path from "path"
import { argv } from "process"
import { promisify } from 'util'
import { comparePathSmartBy, uniqueByFields } from "../lib/core.js"
import * as log from '../lib/debug.js'
import * as enc from '../lib/encoding.js'
import * as mf from '../lib/file.js'
import * as helper from '../lib/helper.js'
import { getMediaInfo, getVideoInfo } from '../lib/mediainfo.js'
import { addEntryProps, applyFileNameRules } from './cmd_shared.js'

// a = all, f = files, d = directories
const TYPE_LIST = ['a', 'f', 'd']

export { aliases, builder, command, describe, handler }

const command = "remove [input] [directories...]"
const aliases = ["rm", "rmf"]
const describe = 'Remove files by given size/width-height/name-pattern/file-list'

const builder = function addOptions(ya, helpOrVersionSet) {
    return ya.option("loose", {
        alias: "l",
        type: "boolean",
        default: false,
        // 宽松模式，默认不开启，宽松模式条件或，默认严格模式条件与
        description: "If true, operation of conditions is OR, default AND",
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
            alias: 're',
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
        .option("width", {
            type: "number",
            default: 0,
            // 图片文件的最大宽度
            description: "Files width smaller than value will be removed",
        })
        .option("height", {
            type: "number",
            default: 0,
            // 图片文件的最大高度
            description: "Files height smaller than value will be removed",
        })
        .option("measure", {
            alias: "m",
            type: "string",
            default: "",
            // 图片文件的长宽字符串形式
            description: "File x*y dimension, width and height, eg: '123x456'",
        })
        .option("sizel", {
            alias: "sl",
            type: "number",
            default: 0,
            // 图片文件的文件大小，最小值，大于，单位为k
            description: "Files size bigger than value will be removed (unit:k)",
        })
        .option("sizer", {
            alias: 'sr',
            type: "number",
            default: 0,
            // size 的 别名
            // 图片文件的文件大小，最大值，小于，单位为k
            description: "Files size smaller than value will be removed (unit:k)",
        })
        .option("pattern", {
            alias: "p",
            type: "string",
            default: "",
            // 文件名匹配，字符串或正则表达式
            description: "Files name pattern matched value will be removed",
        })
        // 启用反转匹配模式
        .option("not-match", {
            alias: "n",
            type: "boolean",
            default: false,
            description: "Files name pattern not matched value will be removed",
        })
        .option("list", {
            type: "string",
            default: null,
            // 文件名列表文本文件，或者一个目录，里面包含的文件作为文件名列表来源
            description: "File name list file, or dir contains files for file name",
        })
        // 视频模式，按照视频文件的元数据删除
        // duration,dimension(width,height),bitrate
        // 参数格式 缩写 du=xx,w=xx,h=xx,dm=xx,bit=xx 
        // duration=xx,width=xx,height=xx,bitrate=xx
        .option("video", {
            alias: "vdm",
            type: "string",
            description: "Remove files by video metadata",
        })
        // 要处理的文件类型 文件或目录或所有，默认只处理文件
        .option("type", {
            type: "choices",
            choices: TYPE_LIST,
            default: 'f',
            description: "applied to file type (a=all,f=file,d=dir)",
        })
        .option("reverse", {
            alias: "r",
            type: "boolean",
            default: false,
            // 文件名列表反转，默认为否，即删除列表中的文件，反转则删除不在列表中的文件
            description: "delete files in list, if true delete files not in the list",
        })
        .option("corrupted", {
            alias: "c",
            type: "boolean",
            default: false,
            // 移除损坏的文件
            description: "delete corrupted files",
        })
        .option("badchars", {
            alias: "b",
            type: "boolean",
            default: false,
            // 移除文件名含乱码的文件
            description: "delete files with illegal or bad unicode chars",
        })
        .option("delete-permanently", {
            type: "boolean",
            default: false,
            // 直接删除文件，不使用安全删除
            description: "delete file permanently, not just move it",
        })
        // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: "execute os operations in real mode, not dry run",
        })
}

const handler = cmdRemove
async function cmdRemove(argv) {
    const logTag = 'cmdRemove'
    log.info(logTag, argv)
    const testMode = !argv.doit
    assert.strictEqual("string", typeof argv.input, "root must be string")
    const root = await helper.validateInput(argv.input)
    // 1200*1600 1200,1600 1200x1600 1200|1600
    const reMeasure = /^\d+[x*,\|]\d+$/
    // 如果没有提供任何一个参数，报错，显示帮助
    if (argv.width == 0 && argv.height == 0 && argv.size == 0
        && !(argv.measure && reMeasure.test(argv.measure))
        && !argv.pattern && !argv.list && !argv.corrupted && !argv.badchars) {
        log.show(logTag, argv)
        log.error(logTag, `required remove condition args not supplied`)
        throw new Error("required remove condition args not supplied")
    }

    const type = (argv.type || 'f').toLowerCase()
    if (!TYPE_LIST.includes(type)) {
        throw new Error(`Error: type must be one of ${TYPE_LIST}`)
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
                cNames = new Set(dirFiles.map(x => path.parse(x).name.trim()))
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

    log.show(logTag, `input:`, root)
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
    }

    const walkOpts = {
        needStats: true,
        withDirs: type === 'd',
        withFiles: type === 'a' || type === 'f',
        withIndex: true,
    }
    log.showGreen(logTag, `Walking files, please waiting ... (${type})`)
    let fileEntries = await mf.walk(root, walkOpts)
    log.show(logTag, `total ${fileEntries.length} files found in ${root}`)
    // 处理额外目录参数
    if (argv.directories?.length > 0) {
        const extraDirs = new Set(argv.directories.map(d => path.resolve(d)))
        for (const dirPath of extraDirs) {
            const st = await fs.stat(dirPath)
            if (st.isDirectory()) {
                const dirFiles = await mf.walk(dirPath, walkOpts)
                if (dirFiles.length > 0) {
                    log.show(logTag, `Add ${dirFiles.length} extra files from ${dirPath}`)
                    fileEntries = fileEntries.concat(dirFiles)
                }
            }
        }
    }
    // 根据完整路径去重
    fileEntries = uniqueByFields(fileEntries, 'path')
    // 应用文件名过滤规则
    fileEntries = await applyFileNameRules(fileEntries, argv)
    // 路径排序，路径深度=>路径长度=>自然语言
    fileEntries = fileEntries.sort(comparePathSmartBy('path'))
    log.show(logTag, `total ${fileEntries.length} files found (${type})`)

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
        log.showYellow(logTag, `${skipped} files are ignored`)
    }
    if (tasks.length === 0) {
        log.show(logTag, conditions)
        log.showYellow(logTag, "Nothing to do, abort.")
        return
    }
    log.showYellow(logTag, `${tasks.length} files to be removed (type=${type})`)
    // log.show(logTag, `Below are last sample tasks:`)
    // for (const task of tasks.slice(-20)) {
    //     log.show(`ToRemove: [${task.desc}] ${task.src}`)
    // }
    log.showYellow(logTag, conditions)
    if (cNames && cNames.size > 0) {
        // 默认仅删除列表中的文件，反转则仅保留列表中的文件，其它的全部删除，谨慎操作
        log.showYellow(logTag, `Attention: use file name list, ignore all other conditions`)
        log.showRed(logTag, `Attention: Will DELETE all files ${cReverse ? "NOT IN" : "IN"} the name list!`)
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
                `Are you sure to remove ${tasks.length} files (Size:${helper.humanSize(totalSize)}) using above conditions (type=${type})?`
            ),
        },
    ])

    if (!answer.yes) {
        log.showYellow("Will do nothing, aborted by user.")
        return
    }

    const startMs = Date.now()
    log.showGreen(logTag, 'task startAt', dayjs().format())
    let removedCount = 0
    let index = 0
    if (testMode) {
        log.showYellow(logTag, `${tasks.length} files, NO file removed in TEST MODE.`)
    } else {
        for (const task of tasks) {
            const flag = task.isDir ? "D" : "F"
            try {
                // 此选项为永久删除
                if (conditions.purge) {
                    await fs.remove(task.src)
                    log.show(logTag, `Deleted ${++index}/${tasks.length} ${helper.pathShort(task.src)} ${helper.humanSize(task.size)} ${flag}`)
                    log.fileLog(`Deleted: ${task.index} <${task.src}> ${helper.humanSize(task.size)} ${flag}`, logTag)
                } else {
                    // 此选项安全删除，仅移动到指定目录
                    await helper.safeRemove(task.src)
                    log.show(logTag, `Moved ${++index}/${tasks.length} ${helper.pathShort(task.src)} ${helper.humanSize(task.size)} ${flag}`)
                    log.fileLog(`Moved: ${task.index} <${task.src}> ${helper.humanSize(task.size)} ${flag}`, logTag)
                }
                ++removedCount
            } catch (error) {
                log.error(logTag, `failed to remove file ${task.src} ${helper.humanSize(task.size)} ${flag}`, error)
            }
        }
    }

    log.showGreen(logTag, 'task endAt', dayjs().format())
    log.showGreen(logTag, `${removedCount} files removed in ${helper.humanTime(startMs)} (${type})`)
}

async function readNameList(list) {
    const listContent = await fs.readFile(list, 'utf-8') || ""
    const nameList = listContent.split(/\r?\n/).map(x => path.parse(x).name.trim()).filter(Boolean)
    return new Set(nameList)
}

function buildRemoveArgs(index, desc, shouldRemove, src, size) {
    return {
        index,
        desc,
        shouldRemove,
        src,
        size,
    }
}

let preparedCount = 0
async function preRemoveArgs(f) {
    const fileSrc = path.resolve(f.path)
    const fileName = path.basename(fileSrc)
    const [dir, base, ext] = helper.pathSplit(fileSrc)
    const flag = f.isDir ? "D" : "F"
    const c = f.conditions || {}
    const ipx = `${f.index}/${f.total}`
    //log.show("prepareRM options:", options);
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
        log.show(
            `preRemove[List] add:${ipx}`,
            `${helper.pathShort(fileSrc)} ${itemDesc} ${flag}`)
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
    // // 交换长宽，长>宽
    // if (cWidth < cHeight) {
    //     [cWidth, cHeight] = [cHeight, cWidth]
    // }
    // 文件名匹配文本
    const cPattern = (c.pattern || "").toLowerCase()
    // 启用反向匹配
    const cNotMatch = c.notMatch || false

    const hasName = cPattern?.length > 0
    const hasSize = c.sizeLeft > 0 || c.sizeRight > 0
    const hasMeasure = cWidth > 0 || cHeight > 0

    //log.show("prepareRM", `${cWidth}x${cHeight} ${cSize} /${cPattern}/`);

    let testCorrupted = false
    let testBadChars = false
    let testPattern = false
    let testSize = false
    let testMeasure = false

    const isImageExt = helper.isImageFile(fileSrc)
    const isVideoExt = helper.isVideoFile(fileSrc)
    // 如果是目录，获取并显示目录内容大小
    // const itemSize = f.isDir ? await mf.getDirectorySizeR(fileSrc) : f.size
    // const itemCount = f.isDir ? await mf.getDirectoryFileCount(fileSrc) : 0
    const itemSize = f.size
    const itemCount = 1

    try {
        // 检查文件是否损坏
        if (hasCorrupted && f.isFile) {
            // only check video/audio/image type files
            const isAudioExt = helper.isAudioFile(fileName)
            const isRawExt = helper.isRawFile(fileName)
            const isArchiveExt = helper.isArchiveFile(fileName)
            if (isAudioExt || isVideoExt) {
                // size  < 5k , maybe corrputed
                if (f.size < 5 * 1024) {
                    log.showGray("preRemove[BadSizeM]:", `${ipx} ${fileSrc}`)
                    itemDesc += " BadSizeM"
                    testCorrupted = true
                } else {
                    // file-type库支持格式不全，不能用用于判断文件是否损坏
                    // 对于媒体文件，用ffprobe试试
                    const info = await getMediaInfo(fileSrc)
                    // 正常的多媒体文件有这两个字段
                    const validMediaFile = info?.duration && info?.bitrate
                    if (!validMediaFile) {
                        log.showGray("preRemove[CorruptedMedia]:", `${ipx} ${fileSrc}`, info?.format || "unknwon format")
                        itemDesc += " Corrupted"
                        testCorrupted = true
                    }
                }
            } else if (isImageExt || isRawExt || isArchiveExt) {
                // size  < 5k , maybe corrputed
                if (f.size < 5 * 1024) {
                    log.showGray("preRemove[BadSizeF]:", `${ipx} ${fileSrc}`)
                    itemDesc += " BadSizeF"
                    testCorrupted = true
                } else {
                    // file-type库支持格式不全，但可用于图片文件损坏判断
                    const ft = await fileTypeFromFile(fileSrc)
                    if (!ft?.mime) {
                        log.showGray("preRemove[CorruptedFormat]:", `${ipx} ${fileSrc}`)
                        itemDesc += " Corrupted"
                        testCorrupted = true
                    }
                }
            } else {
                // 其它类型文件，暂时没有判断是否损坏的可靠方法
            }
            if (!testCorrupted) {
                log.info("preRemove[Good]:", `${ipx} ${fileSrc}`)
            }
        }

        if (hasBadChars) {
            // 可能为文件或目录
            if (enc.hasBadCJKChar(fileName) || enc.hasBadUnicode(fileName, true)) {
                log.showGray("preRemove[BadChars]:", `${ipx} ${fileSrc} (${helper.humanSize(itemSize)},${itemCount})`)
                itemDesc += " BadChars"
                testBadChars = true
            }
        }

        // 首先检查名字正则匹配
        if (!testCorrupted && hasName) {
            const fName = fileName.toLowerCase()
            const rp = new RegExp(cPattern, "ui")
            itemDesc += ` P=${cPattern}`
            // 开头匹配，或末尾匹配，或正则匹配
            const pMatched = fName.startsWith(cPattern) || fName.endsWith(cPattern) || rp.test(fName)
            // 条件反转判断
            testPattern = cNotMatch ? !pMatched : pMatched
            if (testPattern) {
                log.info(
                    "preRemove[Name]:", `${ipx} ${helper.pathShort(fileSrc)} [P=${rp}] (${helper.humanSize(itemSize)},${itemCount})`
                )
            } else {
                log.debug(
                    "preRemove[Name]:", `${ipx} ${fileName} [P=${rp}]`
                )
            }
        }

        // 其次检查文件大小是否满足条件
        if (!testCorrupted && hasSize && f.isFile) {
            // 命令行参数单位为K，这里修正
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
                `${ipx} ${fileName} [${helper.humanSize(itemSize)}] Size=(${c.sizeLeft}K,${c.sizeRight}K)`
            )
        }

        // 图片和视频文件才检查宽高
        // 再次检查宽高是否满足条件
        if (!testCorrupted && hasMeasure && f.isFile) {
            try {
                let fWidth, fHeight
                if (isImageExt) {
                    // 图片宽高
                    const imageSizeOf = promisify(imageSizeOfSync)
                    const dimension = await imageSizeOf(fileSrc)
                    fWidth = dimension.width || 0
                    fHeight = dimension.height || 0
                } else if (isVideoExt) {
                    // 视频宽高
                    const vi = await getVideoInfo(fileSrc)
                    fWidth = vi.width || 0
                    fHeight = vi.height || 0
                }
                // // 确保宽大于高
                // if (fWidth < fHeight) {
                //     [fWidth, fHeight] = [fHeight, fWidth]
                // }
                itemDesc += ` M=${fWidth}x${fHeight}`
                if (cWidth > 0 && cHeight > 0) {
                    // 宽高都提供时，要求都满足才能删除
                    if (fWidth <= cWidth && fHeight <= cHeight) {
                        log.info(
                            "preRemove[M]:",
                            `${ipx} ${fileName} ${fWidth}x${fHeight} [${cWidth}x${cHeight}]`
                        )
                        testMeasure = true
                    }
                }
                else if (cWidth > 0 && fWidth <= cWidth) {
                    // 只提供宽要求
                    log.info(
                        "preRemove[M]:",
                        `${ipx} ${fileName} ${fWidth}x${fHeight} [W=${cWidth}]`
                    )
                    testMeasure = true
                } else if (cHeight > 0 && fHeight <= cHeight) {
                    // 只提供高要求
                    log.info(
                        "preRemove[M]:",
                        `${ipx} ${fileName} ${fWidth}x${fHeight} [H=${cHeight}]`
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
                shouldRemove = testPattern || testSize || testMeasure
            } else {
                log.debug("PreRemove ", `${ipx} ${helper.pathShort(fileSrc)} hasName=${hasName}-${testPattern} hasSize=${hasSize}-${testSize} hasMeasure=${hasMeasure}-${testMeasure} testCorrupted=${testCorrupted},testBadChars=${testBadChars},flag=${flag}`)
                shouldRemove = checkConditions()
            }
        }

        if (shouldRemove) {
            if (itemSize > mf.FILE_SIZE_1M * 200 || (f.isDir && itemCount > 100)) {
                log.showYellow("PreRemove[Large]:", `${ipx} ${helper.pathShort(fileSrc)} (${helper.humanSize(itemSize)},${itemCount})  ${flag}`)
            }
            log.show(
                chalk.green("PreRemove"), chalk.yellow('ADD'), ++preparedCount,
                `${helper.pathShort(fileSrc, 48)} ${itemDesc} ${testCorrupted ? "Corrupted" : ""} (${helper.humanSize(itemSize)})`, ipx)
            log.fileLog(`add: ${ipx} <${fileSrc}> ${itemDesc} ${flag} (${helper.humanSize(itemSize)},${itemCount})`, "PreRemove")
        } else {
            (testPattern || testSize || testMeasure) && log.info(
                "PreRemove ignore:",
                `${ipx} ${helper.pathShort(fileSrc)} [${itemDesc}] (${testPattern} ${testSize} ${testMeasure}) ${flag}`)
        }

        return buildRemoveArgs(f.index, itemDesc, shouldRemove, fileSrc, itemSize)

    } catch (error) {
        log.error(`PreRemove ${ipx} error:`, error, fileSrc, flag)
        log.fileLog(`Error: ${f.index} <${fileSrc}> ${flag}`, "PreRemove")
        throw error
    }

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
