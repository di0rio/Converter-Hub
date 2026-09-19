export interface TabularTable {
  name: string
  columns: string[]
  rows: (string | null)[][]
}

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
