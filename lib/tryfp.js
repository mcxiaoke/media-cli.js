// native errors
const exceptions = [EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError].filter(
  (ex) => typeof ex === 'function',
)

const conf = {}
const setNoneValue = (x) => (conf.none = x)

const throwNativeErr = (err) => {
  if (exceptions.includes(err.constructor)) throw err
  return err
}

const convertNativeErr = (err) => {
  if (!exceptions.includes(err.constructor)) return err
  const error = Error(err.message)
  error.stack = err.stack
  return error
}

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

const tryWrapAsync = (errTransf) => (promise) =>
  typeof promise === 'function'
    ? (...args) => tryWrapAsync(errTransf)(promise(...args))
    : promise.then(
      (data) => [conf.none, data],
      (err) => [errTransf ? errTransf(err) : err, conf.none],
    )

const trySmart = tryWrap(throwNativeErr)
const trySmartAsync = tryWrapAsync(throwNativeErr)

const tryCatch = tryWrap()
const tryCatchAsync = tryWrapAsync()

export {
  setNoneValue, tryCatch,
  tryCatchAsync, trySmart,
  trySmartAsync
}
