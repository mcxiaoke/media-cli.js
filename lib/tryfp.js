// native errors
const exceptions = [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].filter(
    (ex) => typeof ex === "function",
)

const conf = {}

/**
 * 设置"无错误"状态的表示值
 * 默认情况下，tryCatch返回的第一个元素为null表示成功
 *
 * @param {*} x - "无错误"状态的表示值
 */
const setNoneValue = (x) => (conf.none = x)

/**
 * 如果是原生错误类型则抛出，否则返回
 *
 * @param {Error} err - 错误对象
 * @returns {Error} 非原生错误类型时返回错误对象
 * @throws 原生错误类型
 */
const throwNativeErr = (err) => {
    if (exceptions.includes(err.constructor)) throw err
    return err
}

/**
 * 将原生错误转换为普通Error对象
 *
 * @param {Error} err - 错误对象
 * @returns {Error} 转换后的Error对象
 */
const convertNativeErr = (err) => {
    if (!exceptions.includes(err.constructor)) return err
    const error = Error(err.message)
    error.stack = err.stack
    return error
}

/**
 * 同步函数try-catch包装器
 * 将函数包装为返回[error, result]元组的函数
 *
 * @param {Function} errTransf - 错误转换函数
 * @returns {Function} 包装后的函数
 */
const tryWrap =
    (errTransf) =>
    (func) =>
    (...args) => {
        try {
            const result = func(...args)
            return [conf.none, result]
        } catch (err) {
            return [errTransf ? errTransf(err) : err, conf.none]
        }
    }

/**
 * 异步函数try-catch包装器
 * 将Promise包装为返回[error, result]元组的Promise
 *
 * @param {Function} errTransf - 错误转换函数
 * @returns {Function} 包装后的函数
 */
const tryWrapAsync = (errTransf) => (promise) =>
    typeof promise === "function"
        ? (...args) => tryWrapAsync(errTransf)(promise(...args))
        : promise.then(
              (data) => [conf.none, data],
              (err) => [errTransf ? errTransf(err) : err, conf.none],
          )

/**
 * 智能try-catch包装器（同步）
 * 原生错误会抛出，其他错误作为结果返回
 */
const trySmart = tryWrap(throwNativeErr)

/**
 * 智能try-catch包装器（异步）
 * 原生错误会抛出，其他错误作为结果返回
 */
const trySmartAsync = tryWrapAsync(throwNativeErr)

/**
 * 普通try-catch包装器（同步）
 * 所有错误都作为结果返回，不抛出
 */
const tryCatch = tryWrap()

/**
 * 普通try-catch包装器（异步）
 * 所有错误都作为结果返回，不抛出
 */
const tryCatchAsync = tryWrapAsync()

export { setNoneValue, tryCatch, tryCatchAsync, trySmart, trySmartAsync }
