function isPlainObject(value: object) {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Convert values crossing the Electron IPC boundary into a conservative,
 * structured-clone-safe shape. FFmpeg internals can contain Errors, Sets,
 * Maps, child-process metadata or circular references; none of those should
 * be sent directly to the renderer.
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
  if (value instanceof Set) return [...value].map((item) => toSerializable(item, seen))
  if (value instanceof Map) {
    return [...value.entries()].map(([key, item]) => [
      toSerializable(key, seen),
      toSerializable(item, seen),
    ])
  }

  if (typeof value !== "object") return String(value)
  if (seen.has(value)) return "[Circular]"
  seen.add(value)

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
}
