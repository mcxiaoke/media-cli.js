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
 * 特别注意：此前的 addEntryProps 与 lib/rename.js 中的同名函数
 * 语义冲突（一个返回新数组、一个原地修改），而 cmd_ffmpeg.js 调用时
 * 丢弃了返回值——只因恰好导入了原地修改的版本才"侥幸正确"。
 * 该重复实现已删除，统一使用 lib/rename.js 中的版本。
 */

import chalk from "chalk"
import inquirer from "inquirer"
import * as log from "./debug.js"
import { t } from "./i18n.js"

/**
 * 全局自动确认开关
 *
 * 由命令行参数 `--auto-confirm` / `-A` 或环境变量 `MEDIAC_AUTO_CONFIRM` 打开，
 * 打开后所有 confirmAction / confirmDangerousAction / confirmContinue 调用
 * 一律直接返回 true，不再弹出交互提示，便于自动化测试与批量脚本。
 *
 * 注意：这只跳过"确认"环节，不影响 --doit 的真实执行语义。
 */
let autoConfirmEnabled = false

/**
 * 设置全局自动确认开关
 *
 * @param {boolean} enabled - 是否启用自动确认
 */
export function setAutoConfirm(enabled) {
    autoConfirmEnabled = !!enabled
    if (autoConfirmEnabled) {
        log.logInfo("AutoConfirm", "已启用自动确认模式，所有交互确认将被跳过")
    }
}

/**
 * 查询当前是否处于自动确认模式
 *
 * @returns {boolean} 是否自动确认
 */
export function isAutoConfirm() {
    return autoConfirmEnabled
}

/**
 * 从命令行参数/环境变量初始化自动确认开关
 *
 * 供各命令入口统一调用，避免遗漏。
 *
 * @param {object} argv - 命令行参数对象
 * @returns {boolean} 初始化后的开关状态
 */
export function initAutoConfirm(argv = {}) {
    const envValue = process.env.MEDIAC_AUTO_CONFIRM
    const envEnabled =
        typeof envValue === "string" && ["1", "true", "yes", "on"].includes(envValue.toLowerCase())
    setAutoConfirm(!!(argv.autoConfirm || argv.A || envEnabled))
    return autoConfirmEnabled
}

/**
 * 显示确认提示，返回用户是否确认
 *
 * @param {string|Object} message - 提示信息
 * @param {boolean} defaultValue - 默认选项
 * @returns {Promise<boolean>} 用户是否确认
 */
export async function confirmAction(message, defaultValue = false) {
    if (autoConfirmEnabled) {
        return true
    }
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
    if (autoConfirmEnabled) {
        return true
    }
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
