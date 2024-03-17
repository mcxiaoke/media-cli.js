import util from 'util';
import path from "path";
import os from 'os';
import log from 'loglevel';
import chalk from 'chalk';
import fs from 'fs-extra';
import dayjs from "dayjs";
import prefix from 'loglevel-plugin-prefix';

let loggerName = "";
const nowDateStr = dayjs().format("YYYYMMDD_HHmmss");

const levelColors = {
  TRACE: chalk.magenta,
  DEBUG: chalk.cyan,
  INFO: chalk.green,
  WARN: chalk.yellow,
  ERROR: chalk.red,
};

const msgColors = {
  TRACE: chalk.magenta,
  DEBUG: chalk.gray,
  INFO: chalk.white,
  WARN: chalk.yellow,
  ERROR: chalk.red,
};

function applyCustomPlugin(logger, options) {
  options = options || {};
  const originalFactory = logger.methodFactory;
  logger.methodFactory = function (methodName, logLevel, loggerName) {
    const rawMethod = originalFactory(methodName, logLevel, loggerName);

    return function () {
      const chalkFunc = msgColors[methodName.toUpperCase()];
      const messages = [];
      for (let i = 0; i < arguments.length; i++) {
        // show object member details
        const arg =
          options.inspectObject && typeof arguments[i] === "object"
            ? util.inspect(arguments[i], {
              showHidden: false,
              depth: 3,
              // breakLength: Infinity,
            })
            : arguments[i];
        messages.push(options.coloredMessage ? chalkFunc(arg) : arg);
      }
      rawMethod.apply(undefined, messages);
    };
  };
  // Be sure to call setLevel method in order to apply plugin
  // logger.setLevel(logger.getLevel());
}

applyCustomPlugin(log, { inspectObject: true, coloredMessage: true });
prefix.reg(log);
prefix.apply(log, {
  levelFormatter(level) {
    return level.toUpperCase();
  },
  nameFormatter(name) {
    return name || loggerName;
  },
  timestampFormatter(date) {
    return date.toISOString();
  },
  format(level, name, timestamp) {
    let msg = `${levelColors[level](level)}`;
    name && name.trim().length > 0 && (msg += ` ${chalk.green(`${name}`)}`);
    return msg;
  },
});

export const fileLogName = function (logFileName = undefined) {
  const name = `_${logFileName ?? "media_cli"}_${nowDateStr}_log.txt`;
  return path.resolve(path.join(os.tmpdir(), name));
}

export const fileLog = function (logText, logTag = undefined, logFileName = undefined) {
  const dt = dayjs().format("YYYYMMDDHHmmss");
  try {
    fs.appendFile(fileLogName(logFileName), `${dt} [${logTag ?? ""}] ${logText}\n`, { encoding: 'utf-8' }, err => { });
  } catch (error) { }
}

export const showGray = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.gray(a))));
};

export const showRed = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.red(a))));
};

export const showGreen = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.green(a))));
};

export const showYellow = function (...args) {
  console.log(
    ...args.map((a) => (typeof a === "object" ? a : chalk.yellow(a)))
  );
};

export const showBlue = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.blue(a))));
};

export const showMagenta = function (...args) {
  console.log(
    ...args.map((a) => (typeof a === "object" ? a : chalk.magenta(a)))
  );
};

export const showCyan = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.cyan(a))));
};

export const showWhite = function (...args) {
  console.log(...args.map((a) => (typeof a === "object" ? a : chalk.white(a))));
};

export const show = showWhite;

export const trace = function () {
  log.trace.apply(log, arguments);
};

export const debug = function () {
  log.debug.apply(log, arguments);
};

export const info = function () {
  log.info.apply(log, arguments);
};

export const warn = function () {
  log.warn.apply(log, arguments);
};

export const error = function () {
  log.error.apply(log, arguments);
};

export const setVerbose = (level) =>
  log.setLevel(Math.max(0, log.levels.WARN - level));

export const setLevel = (lvl) => log.setLevel(lvl);
export const getLevel = () => log.getLevel();

export const isVerbose = () => log.getLevel() <= log.levels.INFO;

export const setName = (name) => (loggerName = name);

