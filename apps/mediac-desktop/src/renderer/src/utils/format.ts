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
  let s = escapeHtml(cmdStr)
  // Highlight quoted paths first so HTML tag attributes are not matched
  s = s.replace(/"([^"]*)"/g, '<span class="path">"$1"</span>')
  // Then highlight CLI flags
  s = s.replace(/(\s)(-[a-z0-9:_]+)(?=\s|$)/gi, '$1<span class="fl">$2</span>')
  return s
}
