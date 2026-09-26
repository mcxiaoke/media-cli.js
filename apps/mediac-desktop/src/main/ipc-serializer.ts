function isPlainObject(value: object) {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Convert values crossing the Electron IPC boundary into a conservative,
 * structured-clone-safe shape. FFmpeg internals can contain Errors, Sets,
 * Maps, child-process metadata or circular references; none of those should
 * be sent directly to the renderer.
 *
 * `seen` 是**当前递归路径栈**（进入时 add、返回时 delete），不是全局 visited 集：
 * 同一个对象被两个字段共享（DAG，如 {a: info, b: info}）是合法结构，不该被判成循环
 * 而替换为 "[Circular]" —— 那会静默丢数据。只有真正的祖先引用才算循环。
 */
export function toSerializable(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null) return null
  if (typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "bigint") return `${value}n`
  if (typeof value === "undefined") return null
  if (typeof value === "function" || typeof value === "symbol") return String(value)

  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null,
    }
  }
  // Set/Map 同样进出路径栈：自引用集合（Set 含自身）此前会无限递归。
  if (value instanceof Set) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    try {
      return [...value].map((item) => toSerializable(item, seen))
    } finally {
      seen.delete(value)
    }
  }
  if (value instanceof Map) {
    if (seen.has(value)) return "[Circular]"
    seen.add(value)
    try {
      return [...value.entries()].map(([key, item]) => [
        toSerializable(key, seen),
        toSerializable(item, seen),
      ])
    } finally {
      seen.delete(value)
    }
  }

  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      return value.map((item) => toSerializable(item, seen))
    }

    if (!isPlainObject(value)) {
      const result: Record<string, unknown> = {}
      for (const key of Object.getOwnPropertyNames(value)) {
        if (key === "caller" || key === "callee" || key === "arguments") continue
        try {
          result[key] = toSerializable((value as Record<string, unknown>)[key], seen)
        } catch {
          result[key] = "[Unavailable]"
        }
      }
      return result
    }

    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      try {
        result[key] = toSerializable(item, seen)
      } catch {
        result[key] = "[Unavailable]"
      }
    }
    return result
  } finally {
    seen.delete(value)
  }
}
