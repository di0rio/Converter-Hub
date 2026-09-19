export const MAX_DUMP_BYTES = 250 * 1024 * 1024

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 bytes'
  if (bytes < 1024) return bytes + ' ' + UNITS[0]

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }

  const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return rounded.replace(/\.0$/, '') + ' ' + UNITS[unit]
}

export function isOversizedDump(
  bytes: number,
  limit = MAX_DUMP_BYTES,
): boolean {
  return bytes > limit
}

export function oversizedDumpMessage(
  bytes: number,
  limit = MAX_DUMP_BYTES,
): string {
  return (
    'That file is ' +
    formatBytes(bytes) +
    '. The largest dump this tool reads is ' +
    formatBytes(limit) +
    '.'
  )
}
