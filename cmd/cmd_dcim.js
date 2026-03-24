/*
 * File: cmd_dcim.js
 * Created: 2024-03-20 13:43:17 +0800
 * Modified: 2024-04-09 22:13:39 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

// 导入必要的库和模块
import chalk from "chalk"
import dayjs from "dayjs"
import fs from "fs-extra"
import inquirer from "inquirer"
import path from "path"

import { addEntryProps, renameFiles } from "./cmd_shared.js"
import * as log from "../lib/debug.js"
import { ErrorTypes, createError, handleError } from "../lib/errors.js"
import * as exif from "../lib/exif.js"
import * as helper from "../lib/helper.js"
import { t } from "../lib/i18n.js"

const LOG_TAG = "DcimR"

// 导出命令相关配置
export { aliases, builder, command, describe, handler }

// 命令定义
const command = "dcimr <input...> [options]"  // 命令格式，支持多个输入目录
const aliases = ["dm", "dcim"]             // 命令别名
const describe = t("dcim.description")      // 命令描述

/**
 * 添加命令选项
 * @param {Object} ya - yargs 实例
 * @param {boolean} helpOrVersionSet - 是否设置了帮助或版本选项
 * @returns {Object} 配置后的 yargs 实例
 */
const builder = function addOptions(ya, helpOrVersionSet) {
    return ya
        .option("backup", {
            alias: "b",
            type: "boolean",
            default: false,
            description: t("dcim.backup"),
        })
        .option("fast", {
            alias: "f",
            type: "boolean",
            description: t("dcim.fast"),
        })
        .option("prefix", {
            alias: "p",
            type: "string",
            default: "IMG_/DSC_/VID_",
            description: t("dcim.prefix"),
        })
        .option("suffix", {
            alias: "s",
            type: "string",
            default: "",
            description: t("dcim.suffix"),
        })
        .option("template", {
            alias: "t",
            type: "string",
            default: "YYYYMMDD_HHmmss",
            description: t("dcim.template"),
        })
        .option("doit", {
            alias: "d",
            type: "boolean",
            default: false,
            description: t("option.common.doit"),
        })
        .option("log", {
            alias: "l",
            type: "string",
            description: "Export operation log to specified file",
        })
        .option("backup-dir", {
            alias: "bd",
            type: "string",
            description: "Backup original files to specified directory",
        })
}

/**
 * DCIM重命名命令处理函数
 * 根据EXIF元数据中的日期信息重命名媒体文件
 * 支持批量处理多个目录，自动跳过无效文件和重复文件
 *
 * @param {Object} argv - 命令行参数对象
 * @param {string[]} argv.input - 输入目录路径数组
 * @param {boolean} argv.doit - 是否执行实际操作（false为预览模式）
 * @param {boolean} argv.fast - 是否使用快速模式（跳过EXIF解析，使用文件修改时间）
 * @param {string} argv.prefix - 文件名前缀（支持IMG_/DSC_/VID_自动识别）
 * @param {string} argv.suffix - 文件名后缀
 * @param {string} argv.template - 日期格式化模板（dayjs格式）
 * @param {boolean} argv.backup - 是否创建备份
 * @param {string} argv.backup-dir - 备份目录路径
 * @param {string} argv.log - 日志文件导出路径
 * @returns {Promise<void>}
 */
const handler = async function cmdRename(argv) {
    log.logInfo(LOG_TAG, argv)
    
    const inputDirs = Array.isArray(argv.input) ? argv.input : [argv.input]
    const testMode = !argv.doit
    const fastMode = argv.fast || false
    const startMs = Date.now()
    const operationLog = []
    
    operationLog.push({
        timestamp: new Date().toISOString(),
        action: "START",
        message: "开始 DCIM 重命名操作",
        params: {
            inputDirs,
            fastMode,
            testMode,
            prefix: argv.prefix,
            suffix: argv.suffix,
            template: argv.template,
        },
    })
    
    let allFiles = []
    let totalFileCount = 0
    
    for (const input of inputDirs) {
        const root = path.resolve(input)
        log.logInfo(LOG_TAG, `${t("path.input")}: ${root}`)
        
        operationLog.push({
            timestamp: new Date().toISOString(),
            action: "PROCESS_DIR",
            message: `处理目录: ${root}`,
        })
        
        if (!(await fs.pathExists(root))) {
            const errorMsg = `Invalid Input: '${root}'`
            log.logError(LOG_TAG, errorMsg)
            operationLog.push({
                timestamp: new Date().toISOString(),
                action: "ERROR",
                message: errorMsg,
            })
            throw createError(ErrorTypes.INVALID_ARGUMENT, errorMsg)
        }
        
        try {
            const files = await exif.listMedia(root)
            totalFileCount += files.length
            allFiles = [...allFiles, ...files]
            const foundMsg = t("dcim.total.files.found", { count: files.length })
            log.logInfo(LOG_TAG, foundMsg)
            operationLog.push({
                timestamp: new Date().toISOString(),
                action: "FILES_FOUND",
                message: foundMsg,
                directory: root,
                count: files.length,
            })
        } catch (error) {
            const errorMsg = `Error listing files in ${root}: ${error.message}`
            log.logError(LOG_TAG, errorMsg)
            operationLog.push({
                timestamp: new Date().toISOString(),
                action: "ERROR",
                message: errorMsg,
            })
            throw createError(ErrorTypes.PROCESS_ERROR, errorMsg)
        }
    }
    
    if (allFiles.length === 0) {
        const noFilesMsg = t("dcim.no.files.found")
        log.logWarn(LOG_TAG, noFilesMsg)
        operationLog.push({
            timestamp: new Date().toISOString(),
            action: "NO_FILES",
            message: noFilesMsg,
        })
        
        if (argv.log) {
            await exportLog(argv.log, operationLog)
        }
        return
    }
    
    const confirmFiles = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.green(t("common.continue.processing")),
        },
    ])
    
    if (!confirmFiles.yes) {
        const abortedMsg = t("common.aborted.by.user")
        log.logWarn(LOG_TAG, abortedMsg)
        operationLog.push({
            timestamp: new Date().toISOString(),
            action: "ABORTED",
            message: abortedMsg,
        })
        
        if (argv.log) {
            await exportLog(argv.log, operationLog)
        }
        return
    }
    
    log.logInfo(LOG_TAG, t("dcim.processing.exif"))
    try {
        allFiles = await exif.parseFiles(allFiles, { fastMode })
        log.logInfo(
            LOG_TAG,
            t("dcim.files.parsed", { count: allFiles.length }),
            fastMode ? `(${t("mode.fast")})` : "",
        )
    } catch (error) {
        log.logError(LOG_TAG, `Error parsing EXIF data: ${error.message}`)
        throw createError(ErrorTypes.PROCESS_ERROR, `Error parsing EXIF data: ${error.message}`)
    }

    allFiles = allFiles.map((f) => {
        f.namePrefix = argv.prefix
        f.nameSuffix = argv.suffix
        f.nameTemplate = argv.template
        return f
    })

    allFiles = exif.buildNames(allFiles)

    const [validFiles, skippedBySize, skippedByDate] = exif.checkFiles(allFiles)
    allFiles = validFiles

    if (totalFileCount - allFiles.length > 0) {
        log.logWarn(LOG_TAG, t("dcim.files.skipped", { count: totalFileCount - allFiles.length }))
    }

    log.logInfo(
        LOG_TAG,
        t("dcim.files.processed", { count: totalFileCount, time: helper.humanTime(startMs) }),
        fastMode ? `(${t("mode.fast")})` : "",
    )

    if (skippedBySize.length > 0) {
        log.logWarn(LOG_TAG, t("dcim.files.skipped.by.size", { count: skippedBySize.length }))
    }

    if (skippedByDate.length > 0) {
        log.logWarn(LOG_TAG, t("dcim.files.skipped.by.date", { count: skippedByDate.length }))
    }

    if (allFiles.length === 0) {
        log.logWarn(LOG_TAG, t("common.nothing.to.do"))
        return
    }

    allFiles = addEntryProps(allFiles)
    log.logInfo(
        LOG_TAG,
        t("dcim.files.ready", { count: allFiles.length }),
        fastMode ? `(${t("mode.fast")})` : "",
    )

    log.logInfo(LOG_TAG, t("dcim.task.sample"))
    for (const f of allFiles.slice(-10)) {
        log.show(path.basename(f.path), f.outName, f.date)
    }

    log.info(LOG_TAG, argv)

    testMode && log.logWarn(LOG_TAG, `++++++++++ ${t("ffmpeg.test.mode")} ++++++++++`)
    
    // 询问用户是否确认重命名
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: false,
            message: chalk.bold.red(
                t("dcim.rename.confirm", { count: allFiles.length }) +
                    (fastMode ? " (" + t("mode.fast") + ")" : ""),
            ),
        },
    ])
    
    // 如果用户确认重命名
    if (answer.yes) {
        if (testMode) {
            const testModeMsg = t("common.test.mode.note", { count: allFiles.length })
            log.logWarn(LOG_TAG, testModeMsg)
            operationLog.push({
                timestamp: new Date().toISOString(),
                action: "TEST_MODE",
                message: testModeMsg,
                count: allFiles.length,
            })
        } else {
            try {
                if (argv["backup-dir"]) {
                    const backupDir = path.resolve(argv["backup-dir"])
                    log.logInfo(LOG_TAG, `Backing up files to: ${backupDir}`)
                    operationLog.push({
                        timestamp: new Date().toISOString(),
                        action: "BACKUP_START",
                        message: `开始备份文件到: ${backupDir}`,
                        count: allFiles.length,
                    })
                    
                    await backupFiles(allFiles, backupDir)
                    
                    operationLog.push({
                        timestamp: new Date().toISOString(),
                        action: "BACKUP_COMPLETE",
                        message: `文件备份完成`,
                        directory: backupDir,
                    })
                }
                
                const results = await renameFiles(allFiles, false)
                const renamedMsg = t("dcim.files.renamed", { count: results.length })
                log.logSuccess(LOG_TAG, renamedMsg)
                operationLog.push({
                    timestamp: new Date().toISOString(),
                    action: "RENAMED",
                    message: renamedMsg,
                    count: results.length,
                })
            } catch (error) {
                const errorMsg = `Error renaming files: ${error.message}`
                log.logError(LOG_TAG, errorMsg)
                operationLog.push({
                    timestamp: new Date().toISOString(),
                    action: "ERROR",
                    message: errorMsg,
                })
                
                if (argv.log) {
                    await exportLog(argv.log, operationLog)
                }
                
                throw createError(ErrorTypes.PROCESS_ERROR, errorMsg)
            }
        }
    } else {
        const abortedMsg = t("common.aborted.by.user")
        log.logWarn(LOG_TAG, abortedMsg)
        operationLog.push({
            timestamp: new Date().toISOString(),
            action: "ABORTED",
            message: abortedMsg,
        })
    }
    
    operationLog.push({
        timestamp: new Date().toISOString(),
        action: "COMPLETE",
        message: "DCIM 重命名操作完成",
        time: helper.humanTime(startMs),
    })
    
    if (argv.log) {
        await exportLog(argv.log, operationLog)
    }
}

async function exportLog(logPath, logData) {
    try {
        const logDir = path.dirname(logPath)
        if (!(await fs.pathExists(logDir))) {
            await fs.mkdirs(logDir)
        }
        const logContent = JSON.stringify(logData, null, 2)
        await fs.writeFile(logPath, logContent, "utf8")
        log.logSuccess(LOG_TAG, `Log exported to: ${logPath}`)
    } catch (error) {
        log.logError(LOG_TAG, `Error exporting log: ${error.message}`)
    }
}

async function backupFiles(files, backupDir) {
    try {
        if (!(await fs.pathExists(backupDir))) {
            await fs.mkdirs(backupDir)
        }
        
        const backedUpFiles = []
        
        for (const file of files) {
            const srcPath = file.path
            const fileName = path.basename(srcPath)
            const dstPath = path.join(backupDir, fileName)
            
            if (await fs.pathExists(dstPath)) {
                const timestamp = dayjs().format("YYYYMMDD_HHmmss")
                const ext = path.extname(fileName)
                const baseName = path.basename(fileName, ext)
                const newFileName = `${baseName}_${timestamp}${ext}`
                const newDstPath = path.join(backupDir, newFileName)
                
                await fs.copy(srcPath, newDstPath)
                backedUpFiles.push({ ...file, backupPath: newDstPath })
            } else {
                await fs.copy(srcPath, dstPath)
                backedUpFiles.push({ ...file, backupPath: dstPath })
            }
        }
        
        log.logSuccess(LOG_TAG, `Backed up ${backedUpFiles.length} files to: ${backupDir}`)
        return backedUpFiles
    } catch (error) {
        log.logError(LOG_TAG, `Error backing up files: ${error.message}`)
        throw error
    }
}
