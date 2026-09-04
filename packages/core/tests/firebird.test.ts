import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { firebirdParser, parseFirebirdDump } from '../src/parser/firebird/index.js'
import type { SqlDump, Table } from '../src/types/index.js'

// The registry (parser/index.ts) does not wire up 'firebird' yet, so the
// parser is exercised directly rather than through parseDump/getParser.

const samplePath = resolve(import.meta.dirname, '../../../examples/firebird/sample.sql')

function database(dump: SqlDump) {
  const found = dump.databases[0]
  if (!found) throw new Error('missing database')
  return found
}

function table(dump: SqlDump, name: string): Table {
  const found = database(dump).tables.find((t) => t.name === name)
  if (!found) throw new Error('missing table ' + name)
  return found
}

/** Column names, read the same way `tabular/index.ts` would via a registered parser. */
function columnsOf(t: Table): string[] {
  return firebirdParser.readColumns(t.createStatement)
}

/** Row count, summed across every data-carrying statement. */
function rowCountOf(t: Table): number {
  let total = 0
  for (const stmt of t.dataStatements) total += firebirdParser.countDataRows(stmt)
  return total
}

/** Decoded value tuples from every data statement, in statement order. */
function rowsOf(t: Table): (string | null)[][] {
  const rows: (string | null)[][] = []
  for (const stmt of t.dataStatements) rows.push(...firebirdParser.readDataBlock(stmt).rows)
  return rows
}

describe('parseFirebirdDump', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = parseFirebirdDump(readFileSync(samplePath, 'utf-8'))
  })

  describe('format', () => {
    it('reports firebird on the dump', () => {
      expect(dump.format).toBe('firebird')
    })

    it('marks every table with the dialect its statements are written in', () => {
      for (const t of database(dump).tables) expect(t.format).toBe('firebird')
    })

    it('exposes the parser under the firebird format id', () => {
      expect(firebirdParser.format).toBe('firebird')
    })
  })

  describe('database naming', () => {
    it('names the database from CREATE DATABASE, stripping path and extension', () => {
      expect(dump.databases.length).toBe(1)
      expect(database(dump).name).toBe('library')
      expect(database(dump).createStatement).toContain("CREATE DATABASE 'library.fdb'")
    })

    it('falls back to a stable name when no CREATE DATABASE is present', () => {
      const parsed = parseFirebirdDump(
        [
          'CREATE TABLE widgets (id INTEGER NOT NULL, label VARCHAR(50));',
          "INSERT INTO widgets (id, label) VALUES (1, 'first');",
        ].join('\n'),
      )

      expect(parsed.databases.length).toBe(1)
      expect(parsed.databases[0]?.name).toBe('database')
      expect(parsed.databases[0]?.createStatement).toBe('')
    })
  })

  describe('table detection', () => {
    it('finds every table declared in the script', () => {
      expect(database(dump).tables.map((t) => t.name).sort()).toEqual([
        'AUTHORS',
        'BOOKS',
        'BORROWINGS',
      ])
    })

    it('produces exactly one database for the whole script', () => {
      expect(dump.databases.length).toBe(1)
    })

    it('keeps the CREATE TABLE statement verbatim', () => {
      expect(table(dump, 'AUTHORS').createStatement).toContain('CREATE TABLE AUTHORS')
    })

    it('never turns a trigger or a procedure into a table', () => {
      const names = database(dump).tables.map((t) => t.name)
      expect(names).not.toContain('AUTHORS_BI')
      expect(names).not.toContain('BOOKS_BI')
      expect(names).not.toContain('GET_BOOK_COUNT')
      expect(names).not.toContain('BEGIN')
      expect(names.length).toBe(3)
    })
  })

  describe('column detection', () => {
    it('reads plain columns in declaration order', () => {
      expect(columnsOf(table(dump, 'BOOKS'))).toEqual([
        'ID',
        'TITLE',
        'AUTHOR_ID',
        'PRICE',
        'CHECKSUM',
      ])
    })

    it('parses a double-quoted identifier with a space as one column name', () => {
      expect(columnsOf(table(dump, 'AUTHORS'))).toEqual([
        'ID',
        'NAME',
        'Full Name',
        'EMAIL',
        'NOTES',
      ])
    })

    it('does not read a table-level CONSTRAINT clause as a column', () => {
      const columns = columnsOf(table(dump, 'AUTHORS'))
      expect(columns).not.toContain('CONSTRAINT')
      expect(columns).not.toContain('PK_AUTHORS')
      expect(columns).not.toContain('PRIMARY')
    })

    it('reads a table with only a primary key constraint', () => {
      expect(columnsOf(table(dump, 'BORROWINGS'))).toEqual([
        'ID',
        'BOOK_ID',
        'BORROWED_AT',
      ])
    })
  })

  describe('INSERT data', () => {
    it('reads row counts per table', () => {
      expect(rowCountOf(table(dump, 'AUTHORS'))).toBe(3)
      expect(rowCountOf(table(dump, 'BOOKS'))).toBe(2)
    })

    it('counts a table with no INSERT statements as empty', () => {
      expect(rowCountOf(table(dump, 'BORROWINGS'))).toBe(0)
      expect(table(dump, 'BORROWINGS').dataStatements).toEqual([])
    })

    it('reads an explicit column list from INSERT INTO t (a, b) VALUES (...)', () => {
      const block = firebirdParser.readDataBlock(table(dump, 'AUTHORS').dataStatements[0] as string)
      expect(block.columns).toEqual(['ID', 'NAME', 'EMAIL', 'NOTES'])
    })

    it('reads null columns when INSERT names every column implicitly', () => {
      const block = firebirdParser.readDataBlock(table(dump, 'BOOKS').dataStatements[0] as string)
      expect(block.columns).toBeNull()
    })

    it('decodes a NULL value as null rather than the text NULL', () => {
      const rows = rowsOf(table(dump, 'AUTHORS'))
      // Row 2: (2, 'Bob Example', NULL, 'Ships to São Paulo') -> EMAIL is NULL
      expect(rows[1]?.[2]).toBeNull()
      // Row 3: EMAIL and NOTES are both NULL
      expect(rows[2]?.[2]).toBeNull()
      expect(rows[2]?.[3]).toBeNull()
    })

    it('undoubles a doubled single quote inside a string literal', () => {
      const rows = rowsOf(table(dump, 'AUTHORS'))
      expect(rows[2]?.[1]).toBe("O'Malley Example")
    })

    it('keeps a semicolon inside a string value from ending the statement', () => {
      const rows = rowsOf(table(dump, 'AUTHORS'))
      expect(rows[0]?.[3]).toBe('Prefers email; not phone.')
      // The statement after it still parsed as its own row.
      expect(rowCountOf(table(dump, 'AUTHORS'))).toBe(3)
    })

    it('preserves UTF-8 values', () => {
      const authorRows = rowsOf(table(dump, 'AUTHORS'))
      expect(authorRows[1]?.[3]).toBe('Ships to São Paulo')

      const bookRows = rowsOf(table(dump, 'BOOKS'))
      expect(bookRows[1]?.[1]).toBe('Über die Bücher')
    })

    it('keeps an X\'...\' binary literal exactly as written', () => {
      const rows = rowsOf(table(dump, 'BOOKS'))
      expect(rows[0]?.[4]).toBe("X'DEADBEEF'")
      expect(rows[1]?.[4]).toBe("X'CAFEBABE'")
    })
  })

  describe('SET TERM handling', () => {
    it('parses a trigger body with several internal semicolons as one statement', () => {
      const authorsPre = table(dump, 'AUTHORS').preDataStatements.join('\n')
      expect(authorsPre).toContain('CREATE TRIGGER AUTHORS_BI')

      const trigger = table(dump, 'AUTHORS').preDataStatements.find((s) =>
        s.includes('CREATE TRIGGER AUTHORS_BI'),
      )
      expect(trigger).toBeDefined()
      // The whole BEGIN...END body, semicolons and all, is one statement.
      expect(trigger).toContain('GEN_ID(GEN_AUTHORS_ID, 1)')
      expect(trigger).toContain("NEW.EMAIL = 'unknown@example.test'")
      expect(trigger).toContain('END')
      // At least two internal semicolons survived inside the one statement.
      expect((trigger?.match(/;/g) ?? []).length).toBeGreaterThanOrEqual(2)
    })

    it('produces no phantom tables from the SET TERM region', () => {
      expect(database(dump).tables.length).toBe(3)
    })

    it('restores the default terminator after SET TERM ; ^, so later statements split normally', () => {
      // The INSERT statements after the SET TERM block parsed as three separate
      // rows, not as one statement glued together.
      expect(rowCountOf(table(dump, 'AUTHORS'))).toBe(3)
    })

    it('parses a stored procedure body with an internal semicolon as one statement, and keeps it out of the tables', () => {
      expect(dump.postamble).toContain('CREATE PROCEDURE GET_BOOK_COUNT')
      expect(dump.postamble).toContain('SUSPEND')
    })
  })

  describe('generators', () => {
    it('attaches a generator to the table its trigger increments', () => {
      const authorsPre = table(dump, 'AUTHORS').preDataStatements.join('\n')
      expect(authorsPre).toContain('CREATE GENERATOR GEN_AUTHORS_ID')

      const booksPre = table(dump, 'BOOKS').preDataStatements.join('\n')
      expect(booksPre).toContain('CREATE GENERATOR GEN_BOOKS_ID')
    })

    it('orders the generator before the trigger that uses it', () => {
      const pre = table(dump, 'AUTHORS').preDataStatements
      const genIndex = pre.findIndex((s) => s.includes('CREATE GENERATOR GEN_AUTHORS_ID'))
      const triggerIndex = pre.findIndex((s) => s.includes('CREATE TRIGGER AUTHORS_BI'))
      expect(genIndex).toBeGreaterThanOrEqual(0)
      expect(triggerIndex).toBeGreaterThan(genIndex)
    })

    it('parks a generator value reseed rather than guessing its owner', () => {
      expect(dump.postamble).toContain('ALTER SEQUENCE GEN_AUTHORS_ID RESTART WITH 4')
    })
  })

  describe('statement placement', () => {
    it('attaches an index to the table it is declared on', () => {
      expect(table(dump, 'AUTHORS').postDataStatements.join('\n')).toContain(
        'CREATE UNIQUE INDEX IDX_AUTHORS_EMAIL',
      )
      expect(table(dump, 'BOOKS').postDataStatements.join('\n')).toContain(
        'CREATE INDEX IDX_BOOKS_TITLE',
      )
    })

    it('attaches a foreign key added by ALTER TABLE to the table it alters', () => {
      expect(table(dump, 'BOOKS').postDataStatements.join('\n')).toContain(
        'ADD CONSTRAINT FK_BOOKS_AUTHOR FOREIGN KEY',
      )
      expect(table(dump, 'BORROWINGS').postDataStatements.join('\n')).toContain(
        'ADD CONSTRAINT FK_BORROWINGS_BOOK FOREIGN KEY',
      )
    })

    it('parks trailing GRANT and COMMIT statements in the postamble', () => {
      expect(dump.postamble).toContain('GRANT SELECT ON AUTHORS TO PUBLIC')
      expect(dump.postamble).toContain('COMMIT WORK')
    })
  })

  describe('edge cases', () => {
    it('reads a table with no CREATE TABLE from its INSERT header', () => {
      const parsed = parseFirebirdDump(
        "INSERT INTO orphan (a, b) VALUES (1, 'one');",
      )

      const orphan = parsed.databases[0]?.tables[0]
      expect(orphan?.name).toBe('orphan')
      const block = firebirdParser.readDataBlock(orphan?.dataStatements[0] as string)
      expect(block.columns).toEqual(['a', 'b'])
      expect(block.rows).toEqual([['1', 'one']])
    })

    it('matches an unquoted table name case-insensitively between CREATE TABLE and INSERT', () => {
      const parsed = parseFirebirdDump(
        [
          'CREATE TABLE Widgets (id INTEGER NOT NULL, label VARCHAR(50));',
          "INSERT INTO WIDGETS (id, label) VALUES (1, 'first');",
        ].join('\n'),
      )

      expect(parsed.databases[0]?.tables.length).toBe(1)
      expect(rowCountOf(parsed.databases[0]?.tables[0] as Table)).toBe(1)
    })

    it('keeps a quoted, case-sensitive identifier distinct from an unquoted one', () => {
      const parsed = parseFirebirdDump(
        [
          'CREATE TABLE "MixedCase" (id INTEGER NOT NULL);',
          'CREATE TABLE OTHER (id INTEGER NOT NULL);',
        ].join('\n'),
      )

      const names = parsed.databases[0]?.tables.map((t) => t.name)
      expect(names).toEqual(['MixedCase', 'OTHER'])
    })

    it('parks an unattached generator instead of guessing a table for it', () => {
      const parsed = parseFirebirdDump(
        [
          'CREATE GENERATOR GEN_ORPHAN;',
          'CREATE TABLE widgets (id INTEGER NOT NULL);',
        ].join('\n'),
      )

      expect(parsed.preamble).toContain('CREATE GENERATOR GEN_ORPHAN')
      expect(table(parsed, 'widgets').preDataStatements).toEqual([])
    })
  })
})
