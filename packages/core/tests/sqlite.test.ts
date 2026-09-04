import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sqliteParser } from '../src/parser/sqlite/index.js'
import type { SqlDump, Table } from '../src/types/index.js'

// The registry that wires formats into parseDump() does not know about
// 'sqlite' yet — that wiring is done separately — so the parser is imported
// and exercised directly, exactly as the mysql/postgresql readers are tested
// before being registered.

const samplePath = resolve(import.meta.dirname, '../../../examples/sqlite/sample.sql')

function table(dump: SqlDump, name: string): Table {
  const found = dump.databases[0]?.tables.find((t) => t.name === name)
  if (!found) throw new Error('missing table ' + name)
  return found
}

/** Every row of a table, decoded, in declaration column order. */
function rowsOf(t: Table): (string | null)[][] {
  const rows: (string | null)[][] = []
  for (const statement of t.dataStatements) {
    const block = sqliteParser.readDataBlock(statement)
    rows.push(...block.rows)
  }
  return rows
}

describe('sqliteParser', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = sqliteParser.parse(readFileSync(samplePath, 'utf-8'))
  })

  describe('format', () => {
    it('reports sqlite', () => {
      expect(dump.format).toBe('sqlite')
    })

    it('marks every table with the sqlite dialect', () => {
      for (const database of dump.databases) {
        for (const t of database.tables) expect(t.format).toBe('sqlite')
      }
    })
  })

  describe('namespace detection', () => {
    it('produces exactly one database, named main', () => {
      expect(dump.databases.length).toBe(1)
      expect(dump.databases[0].name).toBe('main')
    })

    it('never invents a name from the source file', () => {
      // Nothing in the fixture names the database; 'main' is SQLite's own
      // word for it, not derived from the filename "sample.sql".
      expect(dump.databases[0].name).not.toBe('sample')
    })

    it('every table belongs to main', () => {
      for (const t of dump.databases[0].tables) expect(t.database).toBe('main')
    })
  })

  describe('table detection', () => {
    it('finds every user table, and no more', () => {
      expect(dump.databases[0].tables.map((t) => t.name).sort()).toEqual([
        'archived_authors',
        'authors',
        'blobs',
        'order',
      ])
    })

    it('unquotes a reserved word used as a table name', () => {
      expect(table(dump, 'order').createStatement).toContain('CREATE TABLE "order"')
    })

    it('keeps the CREATE TABLE statement verbatim', () => {
      expect(table(dump, 'authors').createStatement).toContain('AUTOINCREMENT')
    })
  })

  describe('column detection', () => {
    it('reads plain columns in declaration order', () => {
      expect(sqliteParser.readColumns(table(dump, 'authors').createStatement)).toEqual([
        'id',
        'name',
        'bio',
      ])
    })

    it('unquotes every identifier style SQLite accepts: ", `, and [ ]', () => {
      expect(sqliteParser.readColumns(table(dump, 'order').createStatement)).toEqual([
        'id',
        'note',
        'status',
      ])
    })
  })

  describe('INSERT data and row counts', () => {
    it('counts rows across every INSERT for a table', () => {
      let total = 0
      for (const statement of table(dump, 'authors').dataStatements) {
        total += sqliteParser.countDataRows(statement)
      }
      expect(total).toBe(3)
      expect(rowsOf(table(dump, 'authors')).length).toBe(3)
    })

    it('handles multiple tables independently', () => {
      expect(rowsOf(table(dump, 'order')).length).toBe(2)
    })

    it('counts a table with a CREATE TABLE but no rows as empty', () => {
      const archived = table(dump, 'archived_authors')
      expect(archived.dataStatements.length).toBe(0)
      expect(rowsOf(archived)).toEqual([])
    })

    it('reads a NULL value as null, not as the text NULL', () => {
      const rows = rowsOf(table(dump, 'authors'))
      expect(rows[1][2]).toBeNull()
    })

    it('undoubles an escaped quote inside a string literal', () => {
      const rows = rowsOf(table(dump, 'authors'))
      expect(rows[0][2]).toBe(
        "Writes about SQL; semicolons and quotes ' included.",
      )
    })

    it('keeps a semicolon inside a string value from ending the statement', () => {
      // The value above contains a literal ';' — if it had split the
      // statement early, 'archived_authors' would show up truncated or the
      // parse would have produced a stray malformed table.
      expect(rowsOf(table(dump, 'authors')).length).toBe(3)
      expect(dump.databases[0].tables.map((t) => t.name)).toContain('authors')
    })

    it('preserves UTF-8 values', () => {
      const rows = rowsOf(table(dump, 'authors'))
      expect(rows[2][1]).toBe('Zoë Example')
      expect(rows[2][2]).toBe('Café-adjacent, Müller-approved.')
    })

    it('keeps a blob literal exactly as written, without decoding it', () => {
      const rows = rowsOf(table(dump, 'blobs'))
      expect(rows[0][1]).toBe("X'53514C697465'")
    })
  })

  describe('PRAGMA, BEGIN and COMMIT are not tables', () => {
    it('never creates a table for a session or transaction statement', () => {
      const names = dump.databases[0].tables.map((t) => t.name.toUpperCase())
      expect(names).not.toContain('PRAGMA')
      expect(names).not.toContain('BEGIN')
      expect(names).not.toContain('COMMIT')
    })

    it('keeps PRAGMA and BEGIN TRANSACTION in the preamble', () => {
      expect(dump.preamble).toContain('PRAGMA foreign_keys')
      expect(dump.preamble).toContain('BEGIN TRANSACTION')
    })

    it('keeps COMMIT in the postamble', () => {
      expect(dump.postamble).toContain('COMMIT')
    })
  })

  describe('sqlite_sequence', () => {
    it('is excluded from the selectable table list', () => {
      expect(dump.databases[0].tables.map((t) => t.name)).not.toContain('sqlite_sequence')
    })

    it('keeps its statements in the postamble so a SQL export still restores', () => {
      expect(dump.postamble).toContain('CREATE TABLE sqlite_sequence')
      expect(dump.postamble).toContain('DELETE FROM sqlite_sequence')
      expect(dump.postamble).toContain("INSERT INTO sqlite_sequence VALUES('authors',3)")
      expect(dump.postamble).toContain("INSERT INTO sqlite_sequence VALUES('order',2)")
    })
  })

  describe('indexes and views', () => {
    it('attaches an index to the table it is declared on', () => {
      expect(table(dump, 'authors').postDataStatements.join('\n')).toContain(
        'CREATE INDEX idx_authors_name',
      )
    })

    it('parks a view in the postamble, since it has no single owning table', () => {
      expect(dump.postamble).toContain('CREATE VIEW author_names')
    })
  })
})
