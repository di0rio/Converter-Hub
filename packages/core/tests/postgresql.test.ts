import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseDump } from '../src/parser/index.js'
import { toTabular, countRows, extractColumns } from '../src/tabular/index.js'
import type { SqlDump, Table } from '../src/types/index.js'

const samplePath = resolve(
  import.meta.dirname,
  '../../../examples/postgresql/sample.sql',
)

function schema(dump: SqlDump, name: string) {
  const found = dump.databases.find((d) => d.name === name)
  if (!found) throw new Error('missing schema ' + name)
  return found
}

function table(dump: SqlDump, schemaName: string, name: string): Table {
  const found = schema(dump, schemaName).tables.find((t) => t.name === name)
  if (!found) throw new Error('missing table ' + name)
  return found
}

describe('parseDump: PostgreSQL', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = parseDump(readFileSync(samplePath, 'utf-8'))
  })

  describe('format', () => {
    it('reads the fixture as PostgreSQL without being told', () => {
      expect(dump.format).toBe('postgresql')
    })

    it('marks every table with the dialect its statements are written in', () => {
      for (const database of dump.databases) {
        for (const t of database.tables) expect(t.format).toBe('postgresql')
      }
    })
  })

  describe('schema detection', () => {
    it('groups tables by schema, not by database', () => {
      expect(dump.databases.map((d) => d.name).sort()).toEqual([
        'inventory',
        'public',
      ])
    })

    it('keeps the CREATE SCHEMA statement with the schema that declares one', () => {
      expect(schema(dump, 'inventory').createStatement).toContain('CREATE SCHEMA')
    })

    it('records the implicit public schema even though nothing declares it', () => {
      expect(schema(dump, 'public').createStatement).toBe('')
      expect(schema(dump, 'public').tables.length).toBeGreaterThan(0)
    })
  })

  describe('table detection', () => {
    it('finds every table under its own schema', () => {
      expect(schema(dump, 'public').tables.map((t) => t.name)).toEqual([
        'customers',
        'orders',
        'audit_log',
      ])
      expect(schema(dump, 'inventory').tables.map((t) => t.name)).toEqual(['parts'])
    })

    it('strips the schema qualifier from the table name', () => {
      expect(table(dump, 'public', 'customers').name).toBe('customers')
    })

    it('keeps the CREATE TABLE statement verbatim', () => {
      expect(table(dump, 'public', 'customers').createStatement).toContain(
        'CREATE TABLE public.customers',
      )
    })
  })

  describe('column detection', () => {
    it('reads multi-word types without mistaking them for columns', () => {
      expect(extractColumns(table(dump, 'public', 'customers'))).toEqual([
        'id',
        'full_name',
        'email',
        'notes',
        'signed_up_at',
      ])
    })

    it('unquotes a reserved word used as a column name', () => {
      expect(extractColumns(table(dump, 'public', 'orders'))).toContain('order')
    })

    it('skips table-level constraint clauses', () => {
      expect(extractColumns(table(dump, 'public', 'orders'))).not.toContain(
        'CONSTRAINT',
      )
    })
  })

  describe('COPY data', () => {
    it('reads rows out of a COPY block', () => {
      expect(countRows(table(dump, 'public', 'customers'))).toBe(4)
      expect(countRows(table(dump, 'public', 'orders'))).toBe(3)
    })

    it('counts an empty COPY block as no rows at all', () => {
      expect(countRows(table(dump, 'public', 'audit_log'))).toBe(0)
      expect(toTabular(table(dump, 'public', 'audit_log')).rows).toEqual([])
    })

    it('reads \\N as null rather than as the text', () => {
      const rows = toTabular(table(dump, 'public', 'customers')).rows
      expect(rows[2][3]).toBeNull()
    })

    it('decodes backslash escapes inside COPY fields', () => {
      const rows = toTabular(table(dump, 'public', 'customers')).rows
      expect(rows[3][1]).toBe('Tab\tNewline')
      expect(rows[3][3]).toBe('Line one\nLine two, with a comma')
    })

    it('preserves UTF-8 values', () => {
      const rows = toTabular(table(dump, 'public', 'customers')).rows
      expect(rows[1][1]).toBe('Břetislav Ondráček')
    })

    it('keeps a semicolon inside data from ending the statement', () => {
      const rows = toTabular(table(dump, 'inventory', 'parts')).rows
      expect(rows[0][1]).toBe('Bolt, 8 mm; galvanised')
    })
  })

  describe('INSERT data', () => {
    it('reads rows from a dump written with --inserts', () => {
      expect(countRows(table(dump, 'inventory', 'parts'))).toBe(3)
    })

    it('undoubles a quote in a standard-conforming string', () => {
      const rows = toTabular(table(dump, 'inventory', 'parts')).rows
      expect(rows[1][1]).toBe("Washer, 8 mm — O'Brien pattern")
    })

    it('reads a value that spans several lines', () => {
      const rows = toTabular(table(dump, 'inventory', 'parts')).rows
      expect(rows[2][1]).toBe('Nut, 8 mm\n(two-line description)')
    })
  })

  describe('statement placement', () => {
    it('puts the nextval default before the rows and the constraints after', () => {
      const customers = table(dump, 'public', 'customers')
      expect(customers.preDataStatements.join('\n')).toContain('SET DEFAULT nextval')
      expect(customers.postDataStatements.join('\n')).toContain('ADD CONSTRAINT')
    })

    it('keeps a sequence with the table that owns it', () => {
      const customers = table(dump, 'public', 'customers')
      const all = [...customers.preDataStatements, ...customers.postDataStatements]
      expect(all.join('\n')).toContain('CREATE SEQUENCE public.customers_id_seq')
      expect(all.join('\n')).toContain('setval')
      // Never in the shared postamble, where a partial export would drag it
      // along for tables the user did not select.
      expect(dump.postamble).not.toContain('setval')
    })

    it('attaches an index to the table it is declared on', () => {
      expect(table(dump, 'public', 'orders').postDataStatements.join('\n')).toContain(
        'CREATE INDEX orders_customer_id_idx',
      )
    })

    it('keeps session settings in the preamble', () => {
      expect(dump.preamble).toContain('SET client_encoding')
      expect(dump.preamble).toContain('standard_conforming_strings')
    })
  })

  describe('edge cases', () => {
    it('reads a table whose name is only qualified by search_path', () => {
      const parsed = parseDump(
        [
          '-- PostgreSQL database dump',
          'SET search_path = app, pg_catalog;',
          'CREATE TABLE widgets (id integer NOT NULL, label text);',
          "INSERT INTO widgets (id, label) VALUES (1, 'first');",
        ].join('\n'),
      )

      expect(parsed.databases.map((d) => d.name)).toEqual(['app'])
      expect(countRows(parsed.databases[0].tables[0])).toBe(1)
    })

    it('records the owning database when a dump names one', () => {
      const parsed = parseDump(
        [
          '-- PostgreSQL database dump',
          'CREATE DATABASE shop;',
          '\\connect shop',
          'CREATE TABLE public.items (id integer NOT NULL);',
        ].join('\n'),
      )

      expect(parsed.databases[0].name).toBe('public')
      expect(parsed.databases[0].catalog).toBe('shop')
    })

    it('does not let a dollar-quoted body end the statement early', () => {
      const parsed = parseDump(
        [
          '-- PostgreSQL database dump',
          'SET search_path = public;',
          'CREATE FUNCTION noop() RETURNS void AS $$ BEGIN; END; $$ LANGUAGE plpgsql;',
          'CREATE TABLE public.after_function (id integer NOT NULL);',
        ].join('\n'),
      )

      expect(parsed.databases[0].tables.map((t) => t.name)).toEqual([
        'after_function',
      ])
    })

    it('decodes an E-string with backslash escapes', () => {
      const parsed = parseDump(
        [
          '-- PostgreSQL database dump',
          'SET search_path = public;',
          'CREATE TABLE public.notes (id integer, body text);',
          "INSERT INTO public.notes (id, body) VALUES (1, E'first\\nsecond');",
        ].join('\n'),
      )

      expect(toTabular(parsed.databases[0].tables[0]).rows[0][1]).toBe(
        'first\nsecond',
      )
    })

    it('reads a table with no CREATE TABLE from its COPY header', () => {
      const parsed = parseDump(
        [
          '-- PostgreSQL database dump',
          'COPY public.orphan (a, b) FROM stdin;',
          '1\tone',
          '\\.',
        ].join('\n'),
      )

      const orphan = parsed.databases[0].tables[0]
      expect(orphan.name).toBe('orphan')
      expect(toTabular(orphan).columns).toEqual(['a', 'b'])
      expect(toTabular(orphan).rows).toEqual([['1', 'one']])
    })
  })
})
