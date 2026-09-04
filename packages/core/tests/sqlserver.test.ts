import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { sqlserverParser } from '../src/parser/sqlserver/index.js'
import type { SqlDump, Table } from '../src/types/index.js'

const samplePath = resolve(
  import.meta.dirname,
  '../../../examples/sqlserver/sample.sql',
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

/** Row count for a table, the way `tabular/index.ts` computes it. */
function countRows(t: Table): number {
  let total = 0
  for (const statement of t.dataStatements)
    total += sqlserverParser.countDataRows(statement)
  return total
}

/** Flatten a table's data statements into columns and rows, ignoring the
 * registry-backed helpers in `tabular/index.ts` since the sqlserver parser is
 * not wired into it yet. */
function tabularRows(t: Table): (string | null)[][] {
  const columns = sqlserverParser.readColumns(t.createStatement)
  const rows: (string | null)[][] = []

  for (const statement of t.dataStatements) {
    const block = sqlserverParser.readDataBlock(statement)
    for (const values of block.rows) {
      if (block.columns && columns.length > 0) {
        const named = block.columns
        rows.push(
          columns.map((c) => {
            const i = named.indexOf(c)
            return i === -1 ? null : (values[i] ?? null)
          }),
        )
        continue
      }
      rows.push(values)
    }
  }

  return rows
}

describe('sqlserverParser', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = sqlserverParser.parse(readFileSync(samplePath, 'utf-8'))
  })

  describe('format', () => {
    it('reports sqlserver', () => {
      expect(dump.format).toBe('sqlserver')
    })

    it('marks every table with the dialect its statements are written in', () => {
      for (const database of dump.databases) {
        for (const t of database.tables) expect(t.format).toBe('sqlserver')
      }
    })
  })

  describe('schema detection', () => {
    it('groups tables by schema, not by database', () => {
      expect(dump.databases.map((d) => d.name).sort()).toEqual(['dbo', 'sales'])
    })

    it('keeps the CREATE SCHEMA statement with the schema that declares one', () => {
      expect(schema(dump, 'sales').createStatement).toContain('CREATE SCHEMA')
    })

    it('records the implicit dbo schema even though nothing declares it', () => {
      expect(schema(dump, 'dbo').createStatement).toBe('')
      expect(schema(dump, 'dbo').tables.length).toBeGreaterThan(0)
    })

    it('records the owning database from USE', () => {
      expect(schema(dump, 'sales').catalog).toBe('ShopDb')
      expect(schema(dump, 'dbo').catalog).toBe('ShopDb')
    })
  })

  describe('table detection', () => {
    it('finds every table under its own schema', () => {
      expect(schema(dump, 'sales').tables.map((t) => t.name)).toEqual([
        'customers',
        'Order Items',
      ])
      expect(schema(dump, 'dbo').tables.map((t) => t.name)).toEqual([
        'orders',
        'empty_table',
      ])
    })

    it('strips the schema qualifier from the table name', () => {
      expect(table(dump, 'sales', 'customers').name).toBe('customers')
    })

    it('keeps the CREATE TABLE statement verbatim', () => {
      expect(table(dump, 'sales', 'customers').createStatement).toContain(
        'CREATE TABLE [sales].[customers]',
      )
    })

    it('defaults an unqualified table to the dbo schema', () => {
      expect(table(dump, 'dbo', 'orders').createStatement).toContain(
        'CREATE TABLE [orders]',
      )
    })

    it('reads a table name that contains a space', () => {
      expect(table(dump, 'sales', 'Order Items').name).toBe('Order Items')
    })
  })

  describe('column detection', () => {
    it('reads bracketed columns, including [nvarchar](max)', () => {
      expect(
        sqlserverParser.readColumns(
          table(dump, 'sales', 'customers').createStatement,
        ),
      ).toEqual(['id', 'name', 'note', 'ref', 'active', 'thumbnail'])
    })

    it('reads a multi-word bracketed type without mistaking it for a column', () => {
      expect(
        sqlserverParser.readColumns(
          table(dump, 'dbo', 'orders').createStatement,
        ),
      ).toEqual(['id', 'customer_id', 'note', 'total'])
    })

    it('skips a table-level CONSTRAINT clause', () => {
      const columns = sqlserverParser.readColumns(
        table(dump, 'sales', 'customers').createStatement,
      )
      expect(columns).not.toContain('CONSTRAINT')
      expect(columns).not.toContain('PK_customers')
    })
  })

  describe('INSERT data', () => {
    it('reads INSERT without INTO', () => {
      const [first] = table(dump, 'sales', 'customers').dataStatements
      expect(first).toMatch(/^INSERT\s+\[sales\]/)
      expect(sqlserverParser.countDataRows(first)).toBe(2)
    })

    it('reads INSERT INTO', () => {
      const [, second] = table(dump, 'sales', 'customers').dataStatements
      expect(second).toMatch(/^INSERT\s+INTO\s+\[sales\]/)
      expect(sqlserverParser.countDataRows(second)).toBe(1)
    })

    it('reads the explicit column list', () => {
      const [first] = table(dump, 'sales', 'customers').dataStatements
      expect(sqlserverParser.readDataBlock(first).columns).toEqual([
        'id',
        'name',
        'note',
        'ref',
        'active',
        'thumbnail',
      ])
    })

    it('counts rows across every table', () => {
      expect(countRows(table(dump, 'sales', 'customers'))).toBe(3)
      expect(countRows(table(dump, 'dbo', 'orders'))).toBe(2)
      expect(countRows(table(dump, 'sales', 'Order Items'))).toBe(1)
    })

    it('counts an empty table as no rows at all', () => {
      const empty = table(dump, 'dbo', 'empty_table')
      expect(empty.dataStatements.length).toBe(0)
      expect(countRows(empty)).toBe(0)
    })

    it('decodes an N-prefixed unicode string literal', () => {
      const rows = tabularRows(table(dump, 'sales', 'customers'))
      expect(rows[0][1]).toBe('Alice Example')
    })

    it('undoubles a doubled single-quote escape', () => {
      const rows = tabularRows(table(dump, 'sales', 'customers'))
      expect(rows[0][2]).toBe("says 'hi'")
    })

    it('preserves UTF-8 values', () => {
      const rows = tabularRows(table(dump, 'sales', 'customers'))
      expect(rows[2][1]).toBe('Zoë Müller')
    })

    it('keeps a semicolon inside a string value from ending the statement', () => {
      const rows = tabularRows(table(dump, 'dbo', 'orders'))
      expect(rows[0][2]).toBe('Includes tax; ships free')
    })

    it('does not let GO on its own line inside a string end the batch', () => {
      const rows = tabularRows(table(dump, 'sales', 'customers'))
      expect(rows[1][2]).toBe('first line\nGO\nsecond line')
      // Proof the batch kept going: the third row parsed at all.
      expect(rows.length).toBe(3)
    })

    it('reads a NULL value as null', () => {
      const customers = tabularRows(table(dump, 'sales', 'customers'))
      expect(customers[0][3]).toBeNull()
      const orders = tabularRows(table(dump, 'dbo', 'orders'))
      expect(orders[1][2]).toBeNull()
    })

    it('keeps a 0x binary literal as written', () => {
      const rows = tabularRows(table(dump, 'sales', 'customers'))
      expect(rows[0][5]).toBe('0x0102FF')
    })

    it('reads rows for a table whose name contains a space', () => {
      const rows = tabularRows(table(dump, 'sales', 'Order Items'))
      expect(rows).toEqual([['1', 'Widget']])
    })
  })

  describe('statement placement', () => {
    it('puts SET IDENTITY_INSERT ON before the rows and OFF after them', () => {
      const customers = table(dump, 'sales', 'customers')
      expect(customers.preDataStatements.join('\n')).toContain(
        'SET IDENTITY_INSERT [sales].[customers] ON',
      )
      expect(customers.postDataStatements.join('\n')).toContain(
        'SET IDENTITY_INSERT [sales].[customers] OFF',
      )
    })

    it('attaches an ADD CONSTRAINT to the table it names', () => {
      expect(
        table(dump, 'sales', 'customers').postDataStatements.join('\n'),
      ).toContain('ADD CONSTRAINT [DF_active]')
    })

    it('attaches a CREATE INDEX to the table it is declared on', () => {
      expect(
        table(dump, 'dbo', 'orders').postDataStatements.join('\n'),
      ).toContain('CREATE INDEX [IX_orders_customer]')
    })

    it('keeps session SET statements in the preamble', () => {
      expect(dump.preamble).toContain('SET ANSI_NULLS ON')
      expect(dump.preamble).toContain('SET QUOTED_IDENTIFIER ON')
    })

    it('keeps the USE statement in the preamble', () => {
      expect(dump.preamble).toContain('USE [ShopDb]')
    })
  })

  describe('edge cases', () => {
    it('reads a table with no schema qualifier at all as dbo', () => {
      const parsed = sqlserverParser.parse(
        [
          'CREATE TABLE widgets ([id] [int] NOT NULL)',
          'GO',
          'INSERT INTO widgets ([id]) VALUES (1)',
          'GO',
        ].join('\n'),
      )

      expect(parsed.databases.map((d) => d.name)).toEqual(['dbo'])
      expect(parsed.databases[0].tables[0].name).toBe('widgets')
    })

    it('does not require a trailing semicolon on any statement', () => {
      const parsed = sqlserverParser.parse(
        [
          'CREATE TABLE [dbo].[t]([id] [int] NOT NULL)',
          'GO',
          'INSERT [dbo].[t] ([id]) VALUES (1)',
          'GO',
        ].join('\n'),
      )

      const t = parsed.databases[0].tables[0]
      expect(t.createStatement.trim().endsWith(';')).toBe(false)
      expect(t.dataStatements[0]?.trim().endsWith(';')).toBe(false)
    })

    it('parses an Azure Synapse distribution clause without corrupting the columns', () => {
      const synapseCreate = [
        'CREATE TABLE [dbo].[fact_sales](',
        '    [id] [int] NOT NULL,',
        '    [amount] [decimal](10, 2) NOT NULL',
        ')',
        'WITH (DISTRIBUTION = HASH([id]), CLUSTERED COLUMNSTORE INDEX)',
      ].join('\n')

      expect(sqlserverParser.readColumns(synapseCreate)).toEqual([
        'id',
        'amount',
      ])

      const parsed = sqlserverParser.parse([synapseCreate, 'GO'].join('\n'))
      const table = parsed.databases[0].tables.find(
        (t) => t.name === 'fact_sales',
      )
      expect(table).toBeDefined()
      expect(table?.createStatement).toContain('CLUSTERED COLUMNSTORE INDEX')
    })

    it('keeps a bracket-escaped identifier readable', () => {
      const parsed = sqlserverParser.parse(
        ['CREATE TABLE [dbo].[Weird]]Name]([id] [int] NOT NULL)', 'GO'].join(
          '\n',
        ),
      )

      expect(parsed.databases[0].tables[0].name).toBe('Weird]Name')
    })
  })
})
