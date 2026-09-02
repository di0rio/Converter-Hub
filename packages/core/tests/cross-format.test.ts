import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { parseDump } from '../src/parser/index.js'
import { extractDatabase } from '../src/extractor/index.js'
import { toTabular, countRows } from '../src/tabular/index.js'
import { generateExport } from '../src/generator/index.js'
import type { ExportFormat } from '../src/generator/index.js'
import type { DatabaseFormat } from '../src/formats/index.js'

function fixture(name: string): string {
  return readFileSync(
    resolve(import.meta.dirname, '../../../examples/' + name + '/sample.sql'),
    'utf-8',
  )
}

/**
 * One case per supported source format, each naming a table whose rows are
 * known, so the same assertions can run against all of them.
 */
const CASES: {
  fixture: string
  format: DatabaseFormat
  database: string
  table: string
  rows: number
  columns: string[]
  /** A value in the table that a naive splitter would break on. */
  awkwardValue: string
}[] = [
  {
    fixture: 'mysql',
    format: 'mysql',
    database: 'store_db',
    table: 'customers',
    rows: 5,
    columns: ['id', 'name', 'email', 'created_at'],
    awkwardValue: 'alice@example.com',
  },
  {
    fixture: 'mariadb',
    format: 'mariadb',
    database: 'library_db',
    table: 'books',
    rows: 3,
    columns: ['id', 'author_id', 'title', 'blurb', 'published_on'],
    awkwardValue: "O'Brien's Ledger",
  },
  {
    fixture: 'postgresql',
    format: 'postgresql',
    database: 'public',
    table: 'customers',
    rows: 4,
    columns: ['id', 'full_name', 'email', 'notes', 'signed_up_at'],
    awkwardValue: 'Břetislav Ondráček',
  },
]

describe('the same pipeline runs for every source format', () => {
  for (const testCase of CASES) {
    describe(testCase.format, () => {
      const dump = parseDump(fixture(testCase.fixture))
      const database = dump.databases.find((d) => d.name === testCase.database)!
      const table = database.tables.find((t) => t.name === testCase.table)!

      it('normalises to the same shape', () => {
        expect(dump.format).toBe(testCase.format)
        expect(table.format).toBe(testCase.format)
        expect(toTabular(table).columns).toEqual(testCase.columns)
        expect(countRows(table)).toBe(testCase.rows)
      })

      it('produces the same tabular result regardless of dialect', () => {
        const tabular = toTabular(table)
        expect(tabular.rows).toHaveLength(testCase.rows)
        expect(tabular.rows.every((row) => row.length === tabular.columns.length)).toBe(
          true,
        )
        expect(tabular.rows.flat()).toContain(testCase.awkwardValue)
      })

      for (const exportFormat of ['sql', 'csv', 'xlsx'] as ExportFormat[]) {
        it('exports to ' + exportFormat + ' through the shared generator', () => {
          const result = generateExport(
            dump,
            { database: testCase.database, tables: [testCase.table] },
            exportFormat,
          )

          expect(result.tableCount).toBe(1)
          expect(result.bytes.byteLength).toBeGreaterThan(0)
          expect(Object.keys(unzipSync(result.bytes))).toEqual(result.files)
        })
      }

      it('writes a CSV holding every row, whichever engine wrote the dump', () => {
        const result = generateExport(
          dump,
          { database: testCase.database, tables: [testCase.table] },
          'csv',
        )

        const entry = unzipSync(result.bytes)[result.files[0]]
        const lines = strFromU8(entry).trimEnd().split('\r\n')

        // Header plus one line per row, unless a value carries its own newline.
        expect(lines.length).toBeGreaterThanOrEqual(testCase.rows + 1)
        expect(lines[0]).toContain(testCase.columns[1])
      })

      it('extracts SQL in the dialect it came from, not another one', () => {
        const sql = extractDatabase(dump, {
          database: testCase.database,
          tables: 'all',
        }).sql

        expect(sql).toContain(testCase.table)

        // Re-reading the extraction has to land on the same engine and the
        // same rows: the extractor reproduces statements, it does not
        // translate them.
        const round = parseDump(sql)
        expect(round.format).toBe(testCase.format)

        const sameTable = round.databases
          .find((d) => d.name === testCase.database)!
          .tables.find((t) => t.name === testCase.table)!
        expect(toTabular(sameTable).rows).toEqual(toTabular(table).rows)
      })
    })
  }
})
