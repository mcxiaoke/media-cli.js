/*
 * File: cmd_moveup.js
 * Created: 2024-03-15 20:57:59 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import fs from "fs-extra"
import inquirer from "inquirer"
import pMap from "p-map"
import path from "path"

import * as log from "../lib/debug.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as mf from "../lib/file.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

export { aliases, builder, command, describe, handler }

const command = "moveup <input> [output]"
const aliases = ["mp"]
const describe = t("moveup.description")

const MODE_AUTO = "auto"
const MODE_DIR = "dirname"
const MODE_PREFIX = "prefix"
const MODE_MEDIA = "media"
const MODE_CLEAN = "clean"

const builder = function addOptions(ya, helpOrVersionSet) {
    return (
        ya
            // 输出文件名名称
            .option("output", {
                alias: "o",
                type: "string",
                normalize: true,
                description: t("moveup.output"),
            })
            // 指定MODE，三种：自动，目录名，指定前缀
            .option("mode", {
                alias: "m",
                type: "string",
                default: MODE_AUTO,
                description: t("moveup.mode"),
                choices: [MODE_AUTO, MODE_DIR, MODE_PREFIX, MODE_MEDIA, MODE_CLEAN],
            })
            // 移动所有文件到根目录的指定目录
            .option("topmost", {
                alias: "r",
                type: "boolean",
                description: t("moveup.topmost"),
            })
            // 确认执行所有系统操作，非测试模式，如删除和重命名和移动操作
            .option("doit", {
                alias: "d",
                type: "boolean",
                default: false,
                description: t("option.common.doit"),
            })
            // 移动所有文件到输入目录根目录，不创建子目录
            .option("flat", {
                alias: "f",
                type: "boolean",
                default: false,
                description: t("moveup.flat"),
            })
            // 自动确认所有操作，跳过用户交互
            .option("yes", {
                alias: "y",
                type: "boolean",
                default: false,
                description: t("option.common.yes"),
            })
    )
}

/**
 * 验证输入目录
 * @param {string} input - 输入目录路径
 * @returns {Promise<string>} 解析后的绝对路径
 */
async function validateInput(input) {
    const logTag = "MoveUp"
    const root = path.resolve(input)
    try {
        if (!root || !(await fs.pathExists(root))) {
            log.error(logTag, `Invalid Input: '${root}'`)
            throw createError(ErrorTypes.INVALID_ARGUMENT, `Invalid Input: ${input}`)
        }
        return root
    } catch (error) {
        await handleError(error, { operation: "validateInput", input })
        throw error
    }
}

/**
 * 获取子目录列表
 * @param {string} root - 根目录路径
 * @param {Array<string>} outDirNames - 输出目录名称列表
 * @returns {Promise<Array<string>>} 子目录名称列表
 */
async function getSubDirs(root, outDirNames) {
    const logTag = "MoveUp"
    try {
        const subDirs = (await fs.readdir(root, { withFileTypes: true }))
            .filter((d) => d.isDirectory() && !outDirNames.includes(d.name))
            .map((d) => d.name)
        log.show(logTag, "found sub dirs:", subDirs)
        return subDirs
    } catch (error) {
        log.error(logTag, "Failed to read directory:", error)
        await handleError(error, { operation: "readdir", path: root })
        throw error
    }
}

/**
 * 确认操作
 * @param {string} message - 确认消息
 * @param {boolean} autoConfirm - 是否自动确认
 * @returns {Promise<boolean>} 用户是否确认
 */
async function confirmOperation(message, autoConfirm = false) {
    const logTag = "MoveUp"
    if (autoConfirm) {
        log.show(logTag, `Auto-confirming: ${message}`)
        return true
    }
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(message),
        },
    ])
    return answer.yes
}

/**
 * 处理单个目录的文件移动
 * @param {string} root - 根目录路径
 * @param {string} subDirN - 子目录名称
 * @param {boolean} toRoot - 是否移动到根目录
 * @param {boolean} flatMode - 是否移动到根目录且不创建子目录
 * @param {Array<string>} outDirNames - 输出目录名称列表
 * @param {boolean} testMode - 是否为测试模式
 * @param {Set} keepDirList - 要保留的目录列表
 * @returns {Promise<{moved: number, total: number}>} 移动文件数量和总文件数量
 */
async function processDirectory(root, subDirN, toRoot, flatMode, outDirNames, testMode, keepDirList) {
    const logTag = "MoveUp"
    const subDirPath = path.join(root, subDirN)
    log.info(logTag, "processing files in ", subDirPath)
    
    let curDir = toRoot ? root : subDirPath
    let files = []
    try {
        files = await mf.walk(subDirPath, {
            needStats: true,
        })
    } catch (error) {
        log.error(logTag, "Failed to walk directory:", error)
        await handleError(error, { operation: "walk", path: subDirPath })
        return { moved: 0, total: 0 }
    }
    
    const totalCount = files.length
    log.show(logTag, `Total ${totalCount} media files found in ${subDirPath}`)
    
    let outDirPaths = []
    if (flatMode) {
        // 扁平模式：所有文件直接移动到根目录
        outDirPaths = Array(outDirNames.length).fill(root)
        keepDirList.add(root)
    } else {
        // 正常模式：按类型创建子目录
        outDirPaths = outDirNames.map((x) => path.join(curDir, x))
        keepDirList.add(curDir)
        for (const odp of outDirPaths) {
            keepDirList.add(odp)
        }
    }
    
    if (outDirNames.includes(subDirN)) {
        log.showYellow(logTag, `Skip dir ${subDirPath}`)
        return { moved: 0, total: 0 }
    }

    if (flatMode) {
        log.info(logTag, `output:${root} (flat mode)`)
    } else {
        log.info(logTag, `output:${curDir}${path.sep}{${outDirNames}}`)
    }
    log.info(logTag, `moving ${totalCount} files in ${subDirPath} ...`)
    
    // 使用 p-map 并行处理文件移动
    const moveResults = await pMap(files, async (f, index) => {
        const currentDupCount = index + 1
        const fileSrc = f.path
        const [srcDir, srcBase, srcExt] = helper.pathSplit(fileSrc)
        const srcDirName = path.basename(srcDir)
        const fileType = helper.getFileTypeByExt(fileSrc)
        
        let fileDst
        if (flatMode) {
            // 扁平模式：直接移动到根目录
            fileDst = path.join(root, path.basename(fileSrc))
        } else {
            // 正常模式：移动到对应类型的子目录
            fileDst = path.join(outDirPaths[fileType], path.basename(fileSrc))
        }
        
        if (srcDir === path.dirname(fileDst)) {
            log.info(logTag, "Skip InDst:", fileDst)
            return false
        }
        if (fileSrc === fileDst) {
            log.info(logTag, "Skip Same:", fileDst)
            return false
        }
        if (!(await fs.pathExists(fileSrc))) {
            log.showYellow(logTag, "Not Found:", fileSrc)
            return false
        }

        if (!flatMode) {
            await fs.ensureDir(path.dirname(fileDst))
        }

        if (await fs.pathExists(fileDst)) {
            // 检查文件是否完全相同
            if (await helper.isExactSameFile(fileSrc, fileDst)) {
                log.info(logTag, "Skip Same File:", fileDst)
                return false
            }
            // 文件名相同但内容不同，生成唯一文件名
            if (flatMode) {
                // 扁平模式：在根目录中生成唯一文件名
                fileDst = path.join(root, `${srcDirName}_${path.basename(fileSrc, srcExt)}_${currentDupCount}${srcExt}`)
            } else {
                // 正常模式：在对应子目录中生成唯一文件名
                const [dstDir, dstBase, dstExt] = helper.pathSplit(fileDst)
                fileDst = path.join(dstDir, `${srcDirName}_${dstBase}_${currentDupCount}${dstExt}`)
            }
            log.showYellow(logTag, "New Name:", fileDst)
        }
        
        if (await fs.pathExists(fileDst)) {
            log.showYellow(logTag, "Exists:", fileDst)
            return false
        }

        try {
            if (testMode) {
                log.debug(logTag, "NotMoved:", fileSrc, "to", fileDst)
                return false
            } else {
                await fs.move(fileSrc, fileDst)
                log.info(logTag, "Moved:", fileSrc, "to", fileDst)
                log.fileLog(`Moved: <${fileSrc}> => <${fileDst}>`, logTag)
                return true
            }
        } catch (error) {
            log.error(logTag, "Failed:", error, fileSrc, "to", fileDst)
            await handleError(error, { operation: "moveFile", src: fileSrc, dst: fileDst })
            return false
        }
    }, { concurrency: 4 }) // 控制并发数，避免系统资源过度使用
    
    // 计算成功移动的文件数量
    const movedCount = moveResults.filter(Boolean).length
    
    log.showGreen(
        logTag,
        `${totalCount} files in ${helper.pathShort(subDirPath)} are moved.`,
        testMode ? "[DRY RUN]" : "",
    )
    
    return { moved: movedCount, total: totalCount }
}

/**
 * 清理空目录
 * @param {string} root - 根目录路径
 * @param {Set} keepDirList - 要保留的目录列表
 * @param {boolean} testMode - 是否为测试模式
 * @param {boolean} autoConfirm - 是否自动确认
 * @returns {Promise<void>}
 */
async function cleanupEmptyDirs(root, keepDirList, testMode, autoConfirm = false) {
    const logTag = "MoveUp"
    
    keepDirList = new Set([...keepDirList].map((x) => path.resolve(x)))
    let subDirEntries = await mf.walk(root, { withDirs: true, withFiles: false })
    let subDirList = subDirEntries.map((x) => x.path)
    subDirList = new Set([...subDirList].map((x) => path.resolve(x)))
    const toRemoveDirList = setDifference(subDirList, keepDirList)

    log.show(logTag, `There are ${keepDirList.size} output dirs ${chalk.red("DO NOTHING")}`)
    log.show(keepDirList)
    log.showYellow(
        logTag,
        `There are ${toRemoveDirList.size} unused dirs to ${chalk.red("DELETE")}, samples:`,
    )
    log.show([...toRemoveDirList].slice(-10))
    
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    
    const removeUnusedAnswer = await confirmOperation(`Are you sure to DELETE these unused folders?`, autoConfirm)
    if (!removeUnusedAnswer) {
        log.showYellow(logTag, "Will do nothing, aborted by user.")
        return
    }
    
    // 使用 p-map 并行处理目录清理
    const results = await pMap([...toRemoveDirList], async (td) => {
        if (!testMode) {
            try {
                await helper.safeRemove(td)
                log.fileLog(`SafeDel: <${td}>`, logTag)
                return true
            } catch (error) {
                log.error(logTag, "Failed to delete directory:", error)
                await handleError(error, { operation: "safeRemove", path: td })
                return false
            }
        }
        log.show(logTag, "SafeDel", helper.pathShort(td), testMode ? "[DRY RUN]" : "")
        return false
    }, { concurrency: 4 }) // 控制并发数
    
    // 计算成功删除的目录数量
    const delCount = results.filter(Boolean).length
    log.showGreen(logTag, `${delCount} dirs were SAFE DELETED ${testMode ? "[DRY RUN]" : ""}`)
}

/**
 * 向上移动命令处理函数
 * 将深层子目录的文件移动到子目录或根目录的图片/视频目录
 * @param {Object} argv - 命令行参数对象
 * @param {string} argv.input - 输入目录路径
 * @param {string} argv.output - 输出文件名
 * @param {string} argv.mode - 操作模式
 * @param {boolean} argv.topmost - 是否移动到根目录
 * @param {boolean} argv.doit - 是否执行实际操作
 * @returns {Promise<void>}
 */
const handler = async function cmdMoveUp(argv) {
    const logTag = "MoveUp"
    log.info(logTag, argv)
    const testMode = !argv.doit
    
    // 验证输入
    const root = await validateInput(argv.input)
    
    if (!testMode) {
        log.fileLog(`Root: ${root}`, logTag)
        log.fileLog(`Argv: ${JSON.stringify(argv)}`, logTag)
    }

    const toRoot = argv.topmost || false
    const flatMode = argv.flat || false
    const autoConfirm = argv.yes || false
    // 读取顶级目录下所有的子目录
    const defaultDirName = "文件"
    const picDirName = argv.output || "图片"
    const videoDirName = "视频"
    const audioDirName = "音乐"
    const bookDirName = "电子书"
    const otherDirName = "其它"
    const outDirNames = [
        defaultDirName,
        picDirName,
        videoDirName,
        audioDirName,
        bookDirName,
        otherDirName,
    ]
    
    // 获取子目录列表
    const subDirs = await getSubDirs(root, outDirNames)
    
    testMode && log.showYellow("++++++++++ TEST MODE (DRY RUN) ++++++++++")
    
    // 确认操作
    const confirmAnswer = await confirmOperation(`Are you sure to move all files to top sub folder?`, autoConfirm)
    if (!confirmAnswer) {
        log.showYellow(logTag, "Will do nothing, aborted by user.")
        return
    }

    let keepDirList = new Set()
    keepDirList.add(path.resolve(root))

    // 移动深层子目录的文件到 子目录或根目录的 图片/视频 目录
    let movedCount = 0
    let totalCount = 0
    
    // 根据不同模式执行不同的处理逻辑
    switch (argv.mode) {
        case MODE_DIR:
            // 按目录名模式处理：使用子目录名作为前缀
            log.show(logTag, "Using directory name mode")
            for (const subDirN of subDirs) {
                const result = await processDirectory(root, subDirN, toRoot, flatMode, outDirNames, testMode, keepDirList)
                movedCount += result.moved
                totalCount += result.total
            }
            break
        case MODE_PREFIX:
            // 按前缀模式处理：使用指定前缀
            log.show(logTag, "Using prefix mode")
            for (const subDirN of subDirs) {
                const result = await processDirectory(root, subDirN, toRoot, flatMode, outDirNames, testMode, keepDirList)
                movedCount += result.moved
                totalCount += result.total
            }
            break
        case MODE_MEDIA:
            // 按媒体类型模式处理：仅处理媒体文件
            log.show(logTag, "Using media mode")
            for (const subDirN of subDirs) {
                const result = await processDirectory(root, subDirN, toRoot, flatMode, outDirNames, testMode, keepDirList)
                movedCount += result.moved
                totalCount += result.total
            }
            break
        case MODE_CLEAN:
            // 仅清理模式：不移动文件，只清理空目录
            log.show(logTag, "Using clean mode - only cleaning empty directories")
            // 直接跳转到清理步骤
            break
        default:
            // 自动模式：默认处理
            log.show(logTag, "Using auto mode")
            for (const subDirN of subDirs) {
                const result = await processDirectory(root, subDirN, toRoot, flatMode, outDirNames, testMode, keepDirList)
                movedCount += result.moved
                totalCount += result.total
            }
    }
    
    log.showGreen(
        logTag,
        `Total ${movedCount}/${totalCount} files moved.`,
        testMode ? "[DRY RUN]" : "",
    )
    log.showYellow(logTag, "There are some unused folders left after moving up operations.")

    // 确认清理操作
    const cleanupAnswer = await confirmOperation(`Do you want to cleanup these unused sub folders?`, autoConfirm)
    if (!cleanupAnswer) {
        return
    }

    // 清理空目录
    await cleanupEmptyDirs(root, keepDirList, testMode, autoConfirm)
}

/**
 * 计算两个集合的差集
 * @param {Set} setA - 第一个集合
 * @param {Set} setB - 第二个集合
 * @returns {Set} setA - setB 的差集
 */
function setDifference(setA, setB) {
    const ds = new Set(setA)
    for (const elem of setB) {
        ds.delete(elem)
    }
    return ds
}
