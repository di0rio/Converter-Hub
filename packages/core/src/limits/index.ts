/**
 * How large a dump this tool will accept.
 *
 * Reading is not streaming: the file becomes one JavaScript string, and the
 * parser then holds the statement list and the parsed model alongside it, with
 * the generated archive on top of that. Peak memory is a multiple of the file,
 * so the useful ceiling sits well below the runtime's own string limit.
 *
 * Refusing up front — from the file's size, before a byte is read — turns what
 * would be an out-of-memory crash partway through into a message that says
 * what happened.
 */
export const MAX_DUMP_BYTES = 250 * 1024 * 1024

const UNITS = ['bytes', 'KB', 'MB', 'GB', 'TB'] as const

/** A byte count in the largest unit that leaves it readable. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 bytes'
  if (bytes < 1024) return bytes + ' ' + UNITS[0]

  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }

  // One decimal below 10 keeps 1.2 GB from rounding to 1 GB; above it the
  // decimal adds nothing a reader wants.
  const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value))
  return rounded.replace(/\.0$/, '') + ' ' + UNITS[unit]
}

export function isOversizedDump(
  bytes: number,
  limit = MAX_DUMP_BYTES,
): boolean {
  return bytes > limit
}

/**
 * What to tell someone whose file is too large.
 *
 * Names both sizes so the gap is obvious, and carries nothing from the file
 * itself — no path, no contents.
 */
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
