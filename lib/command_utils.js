/*
 * File: command_utils.js
 * Created: 2026-03-27
 * Modified: 2026-09-19
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 *
 * Command utilities - Common patterns shared by command handlers
 *
 * 说明：本文件此前包含 20 个导出，但其中 13 个（createProgressBar、
 * withProgressBar、writeJsonReport、formatProgress、createWalkOptions、
 * buildFileFilter、withConfirmation、handleTestMode、checkTestMode、
 * logOperationStart、logOperationEnd、validateInputPath、getConcurrency）
 * 全仓库无任何调用点，属"重构做了一半"的残留，已移除。
 *
 * 特别注意：此前的 addEntryProps 与 cmd/cmd_shared.js 中的同名函数
 * 语义冲突（一个返回新数组、一个原地修改），而 cmd_ffmpeg.js 调用时
 * 丢弃了返回值——只因恰好导入了原地修改的版本才"侥幸正确"。
 * 该重复实现已删除，统一使用 cmd/cmd_shared.js 中的版本。
 */

import chalk from "chalk"
import inquirer from "inquirer"
import * as log from "./debug.js"
import { t } from "./i18n.js"

/**
 * 显示确认提示，返回用户是否确认
 *
 * @param {string|Object} message - 提示信息
 * @param {boolean} defaultValue - 默认选项
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmAction(message, defaultValue = false) {
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: defaultValue,
            message: typeof message === "string" ? chalk.bold.green(message) : message,
        },
    ])
    return answer.yes
}

/**
 * 显示危险操作确认提示（红色高亮），返回用户是否确认
 *
 * @param {string} message - 提示信息
 * @param {boolean} defaultValue - 默认选项
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmDangerousAction(message, defaultValue = false) {
    const answer = await inquirer.prompt([
        {
            type: "confirm",
            name: "yes",
            default: defaultValue,
            message: chalk.bold.red(message),
        },
    ])
    return answer.yes
}

/**
 * 通用"是否继续处理"确认
 *
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmContinue() {
    return await confirmAction(t("common.continue.processing"))
}

/**
 * 判断是否需要显示进度条
 * 文件数量超过阈值且非 verbose 模式时显示，避免小任务刷屏
 *
 * @param {number} fileCount - 文件数量
 * @param {number} threshold - 阈值，默认 9999
 * @returns {boolean} 是否需要显示进度条
 */
export function shouldShowProgressBar(fileCount, threshold = 9999) {
    return fileCount > threshold && !log.isVerbose()
}

/**
 * 用户取消时记录日志并返回是否应中止
 *
 * @param {boolean} confirmed - 用户是否确认
 * @param {string} logTag - 日志标签
 * @returns {Promise<boolean>} true 表示已取消、调用方应中止
 */
export async function abortIfCancelled(confirmed, logTag) {
    if (!confirmed) {
        log.logWarn(logTag, t("common.aborted.by.user"))
        return true
    }
    return false
}
