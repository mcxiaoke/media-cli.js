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
 * 重写logger的methodFactory方法，增强日志输出功能
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
                        showHidden: false, // 不显示隐藏属性
                        depth: 3, // 展开深度为3层
                        colors: false, // 在util.inspect中不使用颜色，由chalk处理
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
        format(level, name) {
            let msg = `${levelColors[level](level)}`
            if (name && name.trim().length > 0) msg += ` ${chalk.green(`${name}`)}`
            return msg
        },
    })
}

/**
 * 获取日志根目录路径
 * 返回操作系统临时目录下的mediac子目录
 *
 * @returns {string} 日志根目录路径
 */
function getLogRootDir() {
    return path.join(os.tmpdir(), "mediac")
}

const fileLogCache = new Map()

// ---------------------------------------------------------------------------
// 文件日志自动落盘
// ---------------------------------------------------------------------------
// 目标：不再等整个流程结束才写盘。出现异常 / Ctrl+C 时也能看到已有日志。
// 策略：
//   1) 条数阈值 —— 某日志文件缓存攒满 FILE_LOG_FLUSH_COUNT 条即触发一次落盘；
//   2) 时间阈值 —— 某日志文件缓存的「首条未落盘日志」进入超过
//      FILE_LOG_FLUSH_INTERVAL_MS 后，下一条新日志到来时随本地触发落盘；
//   3) 退出兜底 —— flushFileLogSync 由调用方挂在 exit / 信号 / 异常处理器上，
//      保证中断时剩余缓存全部同步写盘。
// 说明：惰性计时（有日志进来才检查），不设常驻定时器，无泄漏。
const FILE_LOG_FLUSH_COUNT = 64
const FILE_LOG_FLUSH_INTERVAL_MS = 2000
// name(日志文件路径) -> 该文件首条未落盘日志进入缓存的时间戳
const fileLogPendingSince = new Map()
// 串行化 async 落盘：appendFile 并发写同一文件会交错/双写，
// 用 promise 链保证同一时刻只有一次落盘在途。
let fileLogFlushChain = Promise.resolve()

/**
 * 获取文件日志的完整路径
 *
 * @param {string} logFileName - 日志文件名前缀，默认为"mediac"
 * @returns {string} 完整的日志文件路径
 */
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
/**
 * 记录日志到文件缓存
 * 将日志文本添加到文件日志缓存中，稍后通过flushFileLog写入文件
 *
 * @param {string} logText - 要记录的日志文本
 * @param {string} logTag - 日志标签，用于标识日志来源
 * @param {string} logFileName - 日志文件名（默认：mediac）
 */
export const fileLog = (logText, logTag = "", logFileName = "mediac") => {
    const dt = dayjs().format("HH:mm:ss.SSS") // 格式化当前时间为时分秒毫秒
    const name = fileLogPath(logFileName) // 获取完整的日志文件路径
    const cache = fileLogCache.get(name) || [] // 获取该日志文件的缓存数组，如果没有则创建空数组

    // 将格式化的日志条目添加到缓存
    cache.push(`[${dt}][${logTag}] ${logText}`)

    // 记录该文件「首条未落盘日志」的入缓存时间：达到时间阈值后随下一条日志落盘
    if (!fileLogPendingSince.has(name)) {
        fileLogPendingSince.set(name, Date.now())
    }

    // 更新缓存
    fileLogCache.set(name, cache)

    // 自动落盘：条数阈值立即触发；时间阈值由新日志带入（惰性），不设定时器
    const pendingAt = fileLogPendingSince.get(name)
    if (
        cache.length >= FILE_LOG_FLUSH_COUNT ||
        Date.now() - pendingAt >= FILE_LOG_FLUSH_INTERVAL_MS
    ) {
        fileLogPendingSince.delete(name)
        // 不 await：fileLog 是同步路径，落盘走 promise 链串行执行
        void flushFileLog()
    }
}

/**
 * 将缓存中的日志写入文件
 * 遍历fileLogCache，将所有缓存的日志条目写入对应文件
 * 通过 promise 链串行执行，避免并发写同一文件造成交错/双写
 */
export const flushFileLog = () => {
    const flushRun = async () => {
        for (const [key, value] of fileLogCache) {
            if (value.length === 0) {
                continue
            }
            // splice 取出当前缓存行并清空，避免与「写盘后清空」的旧语义冲突
            // （写盘期间新 push 进来的行留在数组里，随下一次 flush 写出）
            const lines = value.splice(0)
            try {
                // 每条日志自带换行：补齐多批次拼接时的行尾，避免粘连
                await fs.appendFile(key, lines.join("\n") + "\n", { encoding: "utf-8" })
                fileLogPendingSince.delete(key)
            } catch (error) {
                // 写失败放回缓存头部：下次 flush 重试，避免日志丢失
                value.unshift(...lines)
                log.show(error)
            }
        }
    }
    fileLogFlushChain = fileLogFlushChain.then(flushRun)
    return fileLogFlushChain
}

/**
 * 同步将缓存中的日志写入文件
 * 适用于进程退出 / 信号 / 未捕获异常等事件循环即将终止的场景：
 * 此时异步 flush 可能来不及完成，用 appendFileSync 保证剩余缓存全部落盘。
 */
export const flushFileLogSync = () => {
    for (const [key, value] of fileLogCache) {
        if (value.length === 0) {
            continue
        }
        const lines = value.splice(0)
        try {
            fs.appendFileSync(key, lines.join("\n") + "\n", { encoding: "utf-8" })
            fileLogPendingSince.delete(key)
        } catch (error) {
            value.unshift(...lines)
            log.show(error)
        }
    }
}

// 统一兜底：任何退出路径（正常结束 / process.exit / Ctrl+C 与 SIGTERM
// 经各模块 handler 转 exit）都会触发 exit 事件，同步落盘剩余缓存，
// 保证中途中断时已产生的文件日志不丢。
process.on("exit", () => {
    flushFileLogSync()
})

/**
 * 以灰色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showGray = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.gray(a))))
}

/**
 * 以红色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showRed = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.red(a))))
}

/**
 * 以绿色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showGreen = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.green(a))))
}

/**
 * 以黄色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showYellow = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.yellow(a))))
}

/**
 * 以蓝色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showBlue = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.blue(a))))
}

/**
 * 以洋红色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showMagenta = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.magenta(a))))
}

/**
 * 以青色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showCyan = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.cyan(a))))
}

/**
 * 以白色显示输出
 *
 * @param  {...*} args - 要输出的参数
 */
export const showWhite = (...args) => {
    console.log(...args.map((a) => (typeof a === "object" ? a : chalk.white(a))))
}

export const show = showWhite

export const LogLevel = Object.freeze({
    TRACE: 0,
    DEBUG: 1,
    INFO: 2,
    WARN: 3,
    ERROR: 4,
    SILENT: 5,
})

export const LogCategory = Object.freeze({
    START: { prefix: "START", color: chalk.cyan },
    END: { prefix: "END", color: chalk.cyan },
    DONE: { prefix: "DONE", color: chalk.green },
    OK: { prefix: "OK", color: chalk.green },
    SUCCESS: { prefix: "SUCCESS", color: chalk.green },
    SKIP: { prefix: "SKIP", color: chalk.yellow },
    WARN: { prefix: "WARN", color: chalk.yellow },
    ERROR: { prefix: "ERROR", color: chalk.red },
    FAIL: { prefix: "FAIL", color: chalk.red },
    INFO: { prefix: "INFO", color: chalk.white },
    DEBUG: { prefix: "DEBUG", color: chalk.gray },
    PROGRESS: { prefix: "PROGRESS", color: chalk.cyan },
    TASK: { prefix: "TASK", color: chalk.blue },
})

function formatLogTag(tag) {
    return tag && typeof tag === "string" ? `[${tag}]` : ""
}

function formatLogCategory(category) {
    if (!category) return ""
    const cat = typeof category === "string" ? LogCategory[category.toUpperCase()] : category
    if (!cat) return ""
    return cat.color(`[${cat.prefix}]`)
}

export function logWithTag(tag, category, ...args) {
    const tagStr = formatLogTag(tag)
    const catStr = formatLogCategory(category)
    const prefix = [tagStr, catStr].filter(Boolean).join(" ")
    console.log(prefix, ...args.map((a) => (typeof a === "object" ? a : String(a))))
}

export function logSuccess(tag, ...args) {
    logWithTag(tag, LogCategory.SUCCESS, ...args)
}

export function logWarn(tag, ...args) {
    logWithTag(tag, LogCategory.WARN, ...args)
}

export function logError(tag, ...args) {
    logWithTag(tag, LogCategory.ERROR, ...args)
}

export function logSkip(tag, ...args) {
    logWithTag(tag, LogCategory.SKIP, ...args)
}

export function logProgress(tag, ...args) {
    logWithTag(tag, LogCategory.PROGRESS, ...args)
}

export function logTask(tag, index, total, ...args) {
    const progress = total > 0 ? `${index}/${total}` : `${index}`
    logWithTag(tag, LogCategory.TASK, chalk.cyan(progress), ...args)
}

export function logStart(tag, ...args) {
    logWithTag(tag, LogCategory.START, ...args)
}

export function logEnd(tag, ...args) {
    logWithTag(tag, LogCategory.END, ...args)
}

export function logDone(tag, ...args) {
    logWithTag(tag, LogCategory.DONE, ...args)
}

export function logInfo(tag, ...args) {
    logWithTag(tag, LogCategory.INFO, ...args)
}

export function logDebug(tag, ...args) {
    logWithTag(tag, LogCategory.DEBUG, ...args)
}

export function logFail(tag, ...args) {
    logWithTag(tag, LogCategory.FAIL, ...args)
}

/**
 * 输出trace级别日志
 *
 * @param  {...*} args - 要输出的参数
 */
export const trace = function () {
    log.trace(...arguments)
}

/**
 * 输出debug级别日志
 *
 * @param  {...*} args - 要输出的参数
 */
export const debug = function () {
    log.debug(...arguments)
}

/**
 * 输出info级别日志
 *
 * @param  {...*} args - 要输出的参数
 */
export const info = function () {
    log.info(...arguments)
}

/**
 * 输出warn级别日志
 *
 * @param  {...*} args - 要输出的参数
 */
export const warn = function () {
    log.warn(...arguments)
}

/**
 * 输出error级别日志
 *
 * @param  {...*} args - 要输出的参数
 */
export const error = function () {
    log.error(...arguments)
}

/**
 * 设置日志详细程度
 * level值越大，输出越详细
 *
 * @param {number} level - 详细程度级别
 */
export const setVerbose = (level) => log.setLevel(Math.max(0, log.levels.WARN - level))

/**
 * 设置日志级别
 *
 * @param {number} lvl - 日志级别
 */
export const setLevel = (lvl) => log.setLevel(lvl)

/**
 * 获取当前日志级别
 *
 * @returns {number} 日志级别
 */
export const getLevel = () => log.getLevel()

/**
 * 检查是否处于详细模式（INFO及以上）
 *
 * @returns {boolean} 如果是详细模式返回true
 */
export const isVerbose = () => log.getLevel() <= log.levels.INFO

/**
 * 设置日志记录器名称
 *
 * @param {string} name - 日志名称
 */
export const setName = (name) => (loggerName = name)

/**
 * 测量函数执行时间的装饰器
 * @param {Function} fn - 要测量的函数
 * @param {string} [label] - 可选标签，默认为函数名
 * @returns {Function} - 包装后的函数
 */
export const measure = (fn, label) => {
    return function (...args) {
        const name = label || fn.name || "anonymous"
        const start = Date.now()
        let result
        try {
            result = fn.apply(this, args)
        } catch (error) {
            const end = Date.now()
            showRed(`[Timer] ${name} (Error): ${end - start}ms`)
            throw error
        }

        if (result && typeof result.then === "function") {
            return result
                .then((res) => {
                    const end = Date.now()
                    showCyan(`[Timer] ${name}: ${end - start}ms`)
                    return res
                })
                .catch((err) => {
                    const end = Date.now()
                    showRed(`[Timer] ${name} (Error): ${end - start}ms`)
                    throw err
                })
        } else {
            const end = Date.now()
            showCyan(`[Timer] ${name}: ${end - start}ms`)
            return result
        }
    }
}
