/*
 * File: debug.js
 * Created: 2021-07-20 16:59:09 +0800
 * Modified: 2024-04-09 22:13:40 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */

import chalk from "chalk"
import dayjs from "dayjs"
import fs from "fs-extra"
import log from "loglevel"
import prefix from "loglevel-plugin-prefix"
import os from "os"
import path from "path"
import util from "util"

setupLogger()

let loggerName = ""
const nowDateStr = dayjs().format("YYYYMMDDHHmmss")

const levelColors = {
    TRACE: chalk.magenta,
    DEBUG: chalk.cyan,
    INFO: chalk.green,
    WARN: chalk.yellow,
    ERROR: chalk.red,
}

const msgColors = {
    TRACE: chalk.magenta,
    DEBUG: chalk.gray,
    INFO: chalk.white,
    WARN: chalk.yellow,
    ERROR: chalk.red,
}

/**
 * 应用自定义日志插件到logger对象
 * 为不同日志级别的消息添加颜色和对象检查功能
 *
 * @param {Object} logger - loglevel logger实例
 * @param {Object} options - 配置选项
 * @param {boolean} options.inspectObject - 是否对对象参数使用util.inspect展开
 * @param {boolean} options.coloredMessage - 是否为消息添加颜色
 */
function applyCustomPlugin(logger, options = {}) {
    const originalFactory = logger.methodFactory

    // 重写methodFactory方法，为每个日志级别创建自定义的日志方法
    logger.methodFactory = (methodName, logLevel, loggerName) => {
        const rawMethod = originalFactory(methodName, logLevel, loggerName)

        return function () {
            // 获取对应日志级别的颜色函数
            const chalkFunc = msgColors[methodName.toUpperCase()]
            const messages = []

            // 处理所有传入的参数
            for (let i = 0; i < arguments.length; i++) {
                let arg = arguments[i]

                // 如果启用了对象检查且参数是对象，使用util.inspect展开对象
                if (options.inspectObject && typeof arg === "object") {
                    arg = util.inspect(arg, {
                        showHidden: false,  // 不显示隐藏属性
                        depth: 3,          // 展开深度为3层
                        colors: false,     // 在util.inspect中不使用颜色，由chalk处理
                    })
                }

                // 如果启用了彩色消息，使用对应级别的颜色函数处理
                messages.push(options.coloredMessage ? chalkFunc(arg) : arg)
            }

            // 调用原始的日志方法输出处理后的消息
            rawMethod(...messages)
        }
    }

    // 注意：应用插件后需要调用setLevel方法来激活插件
    // logger.setLevel(logger.getLevel());
}

function setupLogger() {
    fs.mkdirsSync(getLogRootDir())
    applyCustomPlugin(log, { inspectObject: true, coloredMessage: true })
    prefix.reg(log)
    prefix.apply(log, {
        levelFormatter(level) {
            return level.toUpperCase()
        },
        nameFormatter(name) {
            return name || loggerName
        },
        timestampFormatter(date) {
            return date.toISOString()
        },
        format(level, name, timestamp) {
            let msg = `${levelColors[level](level)}`
            if (name && name.trim().length > 0) msg += ` ${chalk.green(`${name}`)}`
            return msg
        },
    })
}

function getLogRootDir() {
    return path.join(os.tmpdir(), "mediac")
}

const fileLogCache = new Map()

export const fileLogPath = (logFileName = "mediac") => {
    const name = `${logFileName}_log_${nowDateStr}.txt`
    return path.resolve(path.join(getLogRootDir(), name))
}

/**
 * 将日志文本添加到文件日志缓存中
 * 日志会缓存在内存中，稍后通过flushFileLog写入文件
 *
 * @param {string} logText - 要记录的日志文本
 * @param {string} logTag - 日志标签，用于标识日志来源
 * @param {string} logFileName - 日志文件名（默认：mediac）
 */
export const fileLog = (logText, logTag = "", logFileName = "mediac") => {
    const dt = dayjs().format("HH:mm:ss.SSS")  // 格式化当前时间为时分秒毫秒
    const name = fileLogPath(logFileName)       // 获取完整的日志文件路径
    const cache = fileLogCache.get(name) || []  // 获取该日志文件的缓存数组，如果没有则创建空数组

    // 将格式化的日志条目添加到缓存
    cache.push(`[${dt}][${logTag}] ${logText}`)

    // 更新缓存
    fileLogCache.set(name, cache)
}

export const flushFileLog = async () => {
    for (const [key, value] of fileLogCache) {
        try {
            await fs.appendFile(key, value.join("\n"), { encoding: "utf-8" })
        } catch (error) {
            log.show(error)
        }
    }
}

export const showGray = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.gray(a))))
}

export const showRed = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.red(a))))
}

export const showGreen = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.green(a))))
}

export const showYellow = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.yellow(a))))
}

export const showBlue = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.blue(a))))
}

export const showMagenta = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.magenta(a))))
}

export const showCyan = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.cyan(a))))
}

export const showWhite = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.white(a))))
}

export const show = showWhite

export const trace = function () {
    log.trace(...arguments)
}

export const debug = function () {
    log.debug(...arguments)
}

export const info = function () {
    log.info(...arguments)
}

export const warn = function () {
    log.warn(...arguments)
}

export const error = function () {
    log.error(...arguments)
}

export const setVerbose = (level) => log.setLevel(Math.max(0, log.levels.WARN - level))

export const setLevel = (lvl) => log.setLevel(lvl)
export const getLevel = () => log.getLevel()

export const isVerbose = () => log.getLevel() <= log.levels.INFO

export const setName = (name) => (loggerName = name)
