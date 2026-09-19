import type { TabularTable } from '../tabular/columns.js'
import { normalizeColumns } from '../tabular/columns.js'
import { bytesToBase64 } from '../utilities/encoding.js'

export class SqliteReadError extends Error {}

export type SqliteValue = null | number | bigint | string | Uint8Array

export interface SqliteColumn {
  name: string
  declaredType: string
  primaryKey: boolean
  notNull: boolean
}

export interface SqliteTable {
  name: string
  createStatement: string
  columns: SqliteColumn[]
  rows: SqliteValue[][]
  rowCount: number
  indexStatements: string[]
}

export interface SqliteDatabase {
  tables: SqliteTable[]
  unreadable: UnreadableTable[]
}

export interface UnreadableTable {
  name: string
  reason: 'virtual' | 'array' | 'external' | 'temporary' | 'charset' | 'damaged'
  detail?: string
}

export function toCellText(value: SqliteValue): string | null {
  if (value === null) return null
  if (value instanceof Uint8Array) return bytesToBase64(value)
  if (typeof value === 'string') return value
  return String(value)
}

export function toSqlLiteral(value: SqliteValue): string {
  if (value === null) return 'NULL'
  if (value instanceof Uint8Array) {
    let hex = ''
    for (const byte of value) hex += byte.toString(16).padStart(2, '0')
    return "X'" + hex + "'"
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL'
  }
  if (typeof value === 'bigint') return String(value)
  return "'" + value.replace(/'/g, "''") + "'"
}

function identifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

export function sqliteToTabular(table: SqliteTable): TabularTable {
  return {
    name: table.name,
    columns: normalizeColumns(table.columns.map((c) => c.name)),
    rows: table.rows.map((row) => row.map(toCellText)),
  }
}

const ROWS_PER_INSERT = 500

export function sqliteToSql(tables: readonly SqliteTable[]): string {
  const lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;']
  const trailing: string[] = []

  for (const table of tables) {
    lines.push(table.createStatement.trimEnd().replace(/;$/, '') + ';')

    const columns = table.columns.map((c) => identifier(c.name)).join(',')
    for (let i = 0; i < table.rows.length; i += ROWS_PER_INSERT) {
      const batch = table.rows
        .slice(i, i + ROWS_PER_INSERT)
        .map((row) => '(' + row.map(toSqlLiteral).join(',') + ')')
        .join(',\n  ')
      lines.push(
        'INSERT INTO ' +
          identifier(table.name) +
          ' (' +
          columns +
          ') VALUES\n  ' +
          batch +
          ';',
      )
    }

    for (const index of table.indexStatements) {
      trailing.push(index.trimEnd().replace(/;$/, '') + ';')
    }
  }

  return [...lines, ...trailing, 'COMMIT;', ''].join('\n')
}

const SIDECAR = /^(.*)-(wal|shm)$/i

export interface SqliteFileGroup<T> {
  main: T
  wal?: T | undefined
  shm?: T | undefined
}

export function groupSqliteFiles<T extends { name: string }>(
  files: readonly T[],
): SqliteFileGroup<T> {
  const mains: T[] = []
  const sidecars: { base: string; kind: string; file: T }[] = []

  for (const file of files) {
    const match = SIDECAR.exec(file.name)
    if (match) {
      sidecars.push({
        base: (match[1] as string).toLowerCase(),
        kind: (match[2] as string).toLowerCase(),
        file,
      })
    } else {
      mains.push(file)
    }
  }

  if (mains.length === 0) {
    throw new SqliteReadError(
      sidecars.length > 0
        ? 'Only SQLite companion files were selected. Add the database file itself - the one without a -wal or -shm suffix.'
        : 'No file was selected.',
    )
  }
  if (mains.length > 1) {
    throw new SqliteReadError(
      'Select one database at a time, together with its -wal and -shm files if it has them.',
    )
  }

  const main = mains[0] as T
  const key = main.name.toLowerCase()
  const owned = sidecars.filter((s) => s.base === key)

  if (owned.length !== sidecars.length) {
    throw new SqliteReadError(
      'Some selected -wal or -shm files belong to a different database. Select the files that share one database name.',
    )
  }

  return {
    main,
    wal: owned.find((s) => s.kind === 'wal')?.file,
    shm: owned.find((s) => s.kind === 'shm')?.file,
  }
}
