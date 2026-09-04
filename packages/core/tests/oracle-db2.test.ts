import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { oracleParser } from '../src/parser/oracle/index.js'
import { db2Parser } from '../src/parser/db2/index.js'
import { splitScript, ORACLE_DIALECT } from '../src/parser/shared/dialect.js'
import { toTabular, countRows } from '../src/tabular/index.js'
import type { SqlDump, Table } from '../src/types/index.js'

function fixture(id: string): string {
  return readFileSync(
    resolve(import.meta.dirname, '../../../examples/' + id + '/sample.sql'),
    'utf-8',
  )
}

function table(dump: SqlDump, schema: string, name: string): Table {
  const found = dump.databases
    .find((d) => d.name === schema)
    ?.tables.find((t) => t.name === name)
  if (!found) throw new Error('no table ' + schema + '.' + name)
  return found
}

describe('parseOracleDump', () => {
  const dump = oracleParser.parse(fixture('oracle'))

  describe('script directives', () => {
    it('treats REM and PROMPT lines as comments, not as statements', () => {
      const names = dump.databases.flatMap((d) => d.tables.map((t) => t.name))
      expect(names).toEqual(['CUSTOMERS', 'ORDERS'])
    })

    it('keeps a PL/SQL block whole, semicolons and all', () => {
      const sql = [
        'CREATE OR REPLACE TRIGGER t',
        'BEFORE INSERT ON SHOP.CUSTOMERS',
        'FOR EACH ROW',
        'BEGIN',
        '  IF :NEW.ID IS NULL THEN',
        '    SELECT seq.NEXTVAL INTO :NEW.ID FROM dual;',
        '  END IF;',
        'END;',
        '/',
        "INSERT INTO SHOP.CUSTOMERS (ID) VALUES (9);",
      ].join('\n')

      const statements = splitScript(sql, ORACLE_DIALECT)
      expect(statements).toHaveLength(2)
      expect(statements[0]).toContain('END IF;')
      expect(statements[1]).toContain('INSERT INTO')
    })

    it('does not let a REM line swallow the statement after it', () => {
      const sql = ['REM a comment', 'CREATE TABLE S.T (ID NUMBER(10));'].join('\n')
      const parsed = oracleParser.parse(sql)
      expect(parsed.databases[0]?.tables.map((t) => t.name)).toEqual(['T'])
    })
  })

  describe('schemas and tables', () => {
    it('groups tables by schema', () => {
      expect(dump.databases.map((d) => d.name)).toEqual(['SHOP'])
    })

    it('strips the schema qualifier from the table name', () => {
      expect(table(dump, 'SHOP', 'CUSTOMERS').name).toBe('CUSTOMERS')
    })

    it('reports Oracle as the source format on every table', () => {
      expect(dump.format).toBe('oracle')
      expect(table(dump, 'SHOP', 'ORDERS').format).toBe('oracle')
    })
  })

  describe('columns', () => {
    it('reads multi-word types without mistaking them for columns', () => {
      expect(toTabular(table(dump, 'SHOP', 'CUSTOMERS')).columns).toEqual([
        'ID',
        'FULL_NAME',
        'EMAIL',
        'SIGNED_UP',
        'NOTES',
      ])
    })

    it('unquotes a reserved word used as a column name', () => {
      expect(toTabular(table(dump, 'SHOP', 'ORDERS')).columns).toContain('Order')
    })

    it('skips table-level constraint clauses', () => {
      expect(toTabular(table(dump, 'SHOP', 'ORDERS')).columns).not.toContain(
        'CONSTRAINT',
      )
    })
  })

  describe('rows', () => {
    it('counts rows per table', () => {
      expect(countRows(table(dump, 'SHOP', 'CUSTOMERS'))).toBe(3)
      expect(countRows(table(dump, 'SHOP', 'ORDERS'))).toBe(2)
    })

    it('decodes NULL as null rather than the text', () => {
      expect(toTabular(table(dump, 'SHOP', 'CUSTOMERS')).rows[1]?.[2]).toBeNull()
    })

    it('undoubles a quote inside a string literal', () => {
      expect(toTabular(table(dump, 'SHOP', 'ORDERS')).rows[1]?.[1]).toBe(
        "O'Brien pattern washers",
      )
    })

    it('keeps a semicolon inside a value from ending the statement', () => {
      expect(toTabular(table(dump, 'SHOP', 'CUSTOMERS')).rows[0]?.[4]).toBe(
        'Prefers email; not phone.',
      )
    })

    it('preserves UTF-8 values', () => {
      expect(toTabular(table(dump, 'SHOP', 'CUSTOMERS')).rows[2]?.[1]).toBe(
        'Zoë Example',
      )
    })
  })

  describe('statement placement', () => {
    it('attaches an index to the table it is declared on', () => {
      const customers = table(dump, 'SHOP', 'CUSTOMERS')
      const attached = [
        ...customers.preDataStatements,
        ...customers.postDataStatements,
      ].join('\n')
      expect(attached).toContain('CREATE INDEX SHOP.IDX_CUSTOMERS_EMAIL')
    })

    it('parks a sequence rather than inventing a table for it', () => {
      const names = dump.databases.flatMap((d) => d.tables.map((t) => t.name))
      expect(names).not.toContain('CUSTOMERS_SEQ')
    })

    it('never offers a trigger as a selectable table', () => {
      const names = dump.databases.flatMap((d) => d.tables.map((t) => t.name))
      expect(names).not.toContain('CUSTOMERS_BI')
    })
  })
})

describe('parseDb2Dump', () => {
  const dump = db2Parser.parse(fixture('db2'))

  it('groups tables by schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['SHOP'])
  })

  it('finds every table with its name unqualified', () => {
    expect(dump.databases[0]?.tables.map((t) => t.name)).toEqual([
      'ORDERS',
      'PARTIES',
    ])
  })

  it('reports Db2 as the source format', () => {
    expect(dump.format).toBe('db2')
    expect(table(dump, 'SHOP', 'ORDERS').format).toBe('db2')
  })

  it('reads columns past a GENERATED ALWAYS AS IDENTITY clause', () => {
    expect(toTabular(table(dump, 'SHOP', 'ORDERS')).columns).toEqual([
      'ID',
      'CUSTOMER',
      'TOTAL',
      'PLACED_AT',
      'Order',
    ])
  })

  it('counts rows from a multi-row VALUES list', () => {
    expect(countRows(table(dump, 'SHOP', 'ORDERS'))).toBe(3)
    expect(countRows(table(dump, 'SHOP', 'PARTIES'))).toBe(2)
  })

  it('decodes NULL, UTF-8 and an embedded semicolon', () => {
    const rows = toTabular(table(dump, 'SHOP', 'ORDERS')).rows
    expect(rows[1]?.[2]).toBeNull()
    expect(rows[2]?.[1]).toBe('Zoë Example')
    expect(rows[2]?.[4]).toBe('Note; with semicolon')
  })

  it('attaches a foreign key added by ALTER TABLE to the table it alters', () => {
    const orders = table(dump, 'SHOP', 'ORDERS')
    const attached = [
      ...orders.preDataStatements,
      ...orders.postDataStatements,
    ].join('\n')
    expect(attached).toContain('FK_ORDERS_PARTY')
  })
})
