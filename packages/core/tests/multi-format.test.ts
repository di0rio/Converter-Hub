import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SUPPORTED_FORMATS,
  EXPERIMENTAL_FORMATS,
  detectFormat,
  describeFormat,
} from '../src/formats/index.js'
import { parseDump, findParser } from '../src/parser/index.js'
import { toTabular, countRows } from '../src/tabular/index.js'
import { generateExport } from '../src/generator/index.js'
import { extractDatabase } from '../src/extractor/index.js'
import type { ExportFormat } from '../src/generator/index.js'

const READABLE = [...SUPPORTED_FORMATS, ...EXPERIMENTAL_FORMATS]

function fixturePath(id: string): string {
  return resolve(import.meta.dirname, '../../../examples/' + id + '/sample.sql')
}

function fixture(id: string): string {
  return readFileSync(fixturePath(id), 'utf-8')
}

describe('every readable format', () => {
  it('is a non-empty set, so the loops below actually assert something', () => {
    expect(READABLE.length).toBeGreaterThan(5)
  })

  for (const descriptor of READABLE) {
    describe(descriptor.label, () => {
      it('ships a synthetic fixture', () => {
        expect(existsSync(fixturePath(descriptor.id))).toBe(true)
      })

      it('has a parser registered', () => {
        expect(findParser(descriptor.id)).not.toBeNull()
      })

      it('is detected as itself from its own fixture', () => {
        expect(detectFormat(fixture(descriptor.id))).toEqual({
          format: descriptor.id,
          confidence: 'detected',
        })
      })

      it('parses without being told which engine wrote it', () => {
        const dump = parseDump(fixture(descriptor.id))
        expect(dump.format).toBe(descriptor.id)
        expect(dump.databases.length).toBeGreaterThan(0)
      })

      it('stamps every table with the format it was read as', () => {
        const dump = parseDump(fixture(descriptor.id))
        for (const database of dump.databases) {
          for (const table of database.tables) {
            expect(table.format).toBe(descriptor.id)
          }
        }
      })

      it('finds at least one table with columns and rows', () => {
        const dump = parseDump(fixture(descriptor.id))
        const tables = dump.databases.flatMap((d) => d.tables)

        expect(tables.length).toBeGreaterThan(0)
        expect(tables.some((t) => toTabular(t).columns.length > 0)).toBe(true)
        expect(tables.some((t) => countRows(t) > 0)).toBe(true)
      })

      it('carries no stray control character into a cell', () => {
        const dump = parseDump(fixture(descriptor.id))
        for (const database of dump.databases) {
          for (const table of database.tables) {
            for (const row of toTabular(table).rows) {
              for (const cell of row) {
                if (cell === null) continue
                expect(cell).not.toMatch(/[\u0000-\u0008\u000E-\u001F]/)
              }
            }
          }
        }
      })
    })
  }
})

describe('one pipeline, every source format', () => {
  const EXPORTS: ExportFormat[] = ['sql', 'csv', 'xlsx']

  for (const descriptor of READABLE) {
    for (const format of EXPORTS) {
      it(`exports ${descriptor.label} to ${format.toUpperCase()}`, () => {
        const dump = parseDump(fixture(descriptor.id))
        const database = dump.databases.find((d) => d.tables.length > 0)
        expect(database).toBeDefined()

        const result = generateExport(
          dump,
          { database: database!.name, tables: 'all' },
          format,
        )

        expect(result.bytes.length).toBeGreaterThan(0)
        expect(result.files.length).toBeGreaterThan(0)
        expect(result.tableCount).toBe(database!.tables.length)
      })
    }
  }
})

describe('SQL export preserves the source dialect', () => {
  it("never rewrites one engine's SQL into another's", () => {
    for (const descriptor of READABLE) {
      const dump = parseDump(fixture(descriptor.id))
      const database = dump.databases.find((d) => d.tables.length > 0)
      if (!database) continue

      const sql = extractDatabase(dump, {
        database: database.name,
        tables: 'all',
      }).sql

      expect(sql).toContain(describeFormat(descriptor.id).label)

      for (const table of database.tables) {
        if (table.createStatement === '') continue
        expect(sql).toContain(table.createStatement.trimEnd())
      }
    }
  })
})

describe('the catalog cannot overstate itself', () => {
  it('gives every supported format a parser', () => {
    for (const descriptor of SUPPORTED_FORMATS) {
      expect(findParser(descriptor.id)).not.toBeNull()
    }
  })

  it('explains every experimental format with a note', () => {
    for (const descriptor of EXPERIMENTAL_FORMATS) {
      expect(descriptor.note, descriptor.label).toBeTruthy()
    }
  })
})
