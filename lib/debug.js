/*
 * File: debug.js
 * Created: 2021-07-20 16:59:09 +0800
 * Modified: 2024-04-09 22:13:40 +0800
 * Author: mcxiaoke (github@mcxiaoke.com)
 * License: Apache License 2.0
 */


import chalk from 'chalk'
import dayjs from "dayjs"
import fs from 'fs-extra'
import log from 'loglevel'
import prefix from 'loglevel-plugin-prefix'
import os from 'os'
import path from "path"
import util from 'util'

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


function applyCustomPlugin(logger, options = {}) {
  const originalFactory = logger.methodFactory
  logger.methodFactory = (methodName, logLevel, loggerName) => {
    const rawMethod = originalFactory(methodName, logLevel, loggerName)

    return function () {
      const chalkFunc = msgColors[methodName.toUpperCase()]
      const messages = []
      for (let i = 0; i < arguments.length; i++) {
        // show object member details
        const arg =
          options.inspectObject && typeof arguments[i] === "object"
            ? util.inspect(arguments[i], {
              showHidden: false,
              depth: 3,
              // breakLength: Infinity,
            })
            : arguments[i]
        messages.push(options.coloredMessage ? chalkFunc(arg) : arg)
      }
      rawMethod(...messages)
    }
  }
  // Be sure to call setLevel method in order to apply plugin
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

function getLogRootDir() { return path.join(os.tmpdir(), "mediac") }

const fileLogCache = new Map()

export const fileLogPath = (logFileName = "mediac") => {
  const name = `${logFileName}_log_${nowDateStr}.txt`
  return path.resolve(path.join(getLogRootDir(), name))
}

export const fileLog = (logText, logTag = "", logFileName = "mediac") => {
  const dt = dayjs().format("HH:mm:ss.SSS")
  const name = fileLogPath(logFileName)
  const cache = fileLogCache.get(name) || []
  cache.push(`[${dt}][${logTag}] ${logText}`)
  fileLogCache.set(name, cache)

}

export const flushFileLog = async () => {
  for (const [key, value] of fileLogCache) {
    try {
      await fs.appendFile(key, value.join('\n'), { encoding: 'utf-8' })
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
  console.log(
    ...args.map((a) => (typeof a === "object" ? a : chalk.yellow(a)))
  )
}

export const showBlue = (...args) => {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.blue(a))))
}

export const showMagenta = (...args) => {
  console.log(
    ...args.map((a) => (typeof a === "object" ? a : chalk.magenta(a)))
  )
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

export const setVerbose = (level) =>
  log.setLevel(Math.max(0, log.levels.WARN - level))

export const setLevel = (lvl) => log.setLevel(lvl)
export const getLevel = () => log.getLevel()

export const isVerbose = () => log.getLevel() <= log.levels.INFO

export const setName = (name) => (loggerName = name);

