/**
 * The table shape every writer takes, and the column naming they share.
 *
 * Kept apart from the rest of `tabular`, which reads parsed SQL dumps and so
 * imports every parser: a writer needs neither.
 */

export interface TabularTable {
  name: string
  columns: string[]
  rows: (string | null)[][]
}

/**
 * Column names every writer can rely on: none empty, none repeated.
 *
 * An empty header is named after its position (`column_3`) and a repeated one
 * is suffixed (`name_2`). Repeats are found ignoring case, because SQL
 * identifiers and file systems often do. `width` widens the list to cover rows
 * that run past the header.
 */
export function normalizeColumns(
  header: readonly string[],
  width = header.length,
): string[] {
  const taken = new Set<string>()
  const columns: string[] = []

  for (let i = 0; i < Math.max(width, header.length); i++) {
    const base = header[i]?.trim() || `column_${i + 1}`
    let name = base
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}_${n}`
    taken.add(name.toLowerCase())
    columns.push(name)
  }

  return columns
}
