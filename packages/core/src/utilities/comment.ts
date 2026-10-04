const CONTROL = /[\x00-\x1F\x7F]/g

/**
 * A name interpolated into a `--` comment. Names come from quoted identifiers
 * and can carry a line break, which would end the comment and turn the rest of
 * the name into a standalone statement.
 */
export function commentText(name: string): string {
  return name.replace(CONTROL, '')
}
