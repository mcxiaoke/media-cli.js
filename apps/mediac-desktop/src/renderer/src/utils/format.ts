export function formatSize(bytes: number): string {
  if (!bytes || isNaN(bytes)) return "0 B"
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + " GB"
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(0) + " MB"
  return Math.round(bytes / 1e3) + " KB"
}

export function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return "00:00"
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const p = (x: number) => (x < 10 ? "0" : "") + x
  return (h > 0 ? h + ":" : "") + p(m) + ":" + p(s)
}

export function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function highlightFfmpegCmd(cmdStr: string): string {
  if (!cmdStr) return ""
  // Single-pass regex tokenizer:
  // 1. Quoted string: "..."
  // 2. CLI flag: -flag or -option:specifier
  // 3. Any non-whitespace token
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|(-[a-zA-Z0-9:_]+)|([^\s]+)/g
  let match: RegExpExecArray | null
  let lastIndex = 0
  let html = ""

  while ((match = regex.exec(cmdStr)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(cmdStr.slice(lastIndex, match.index))
    }
    lastIndex = regex.lastIndex

    if (match[1] !== undefined) {
      // Quoted string/path
      html += `<span class="path">&quot;${escapeHtml(match[1])}&quot;</span>`
    } else if (match[2] !== undefined) {
      // CLI flag
      html += `<span class="fl">${escapeHtml(match[2])}</span>`
    } else if (match[3] !== undefined) {
      // Regular parameter value
      html += escapeHtml(match[3])
    }
  }

  if (lastIndex < cmdStr.length) {
    html += escapeHtml(cmdStr.slice(lastIndex))
  }

  return html
}
