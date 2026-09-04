/**
 * Do PostgreSQL- and MySQL-derived products read through the EXISTING
 * postgresql/mysql parsers, without any parser change?
 *
 * These products are not registered formats yet (no entry in
 * `parser/index.ts`'s PARSERS map), so `parseDump`/`getParser` cannot be used
 * for them — the fixtures are fed straight to `postgresParser` /
 * `createMysqlParser('mysql')`, bypassing format detection entirely. Every
 * table these parsers produce is stamped with `format: 'postgresql'` (or
 * `'mysql'`) regardless of which product wrote the dump; that stamping is a
 * fact about today's parsers, not something this suite is trying to fix.
 *
 * Each product gets one synthetic, `pg_dump`/`mysqldump`-shaped fixture under
 * `examples/<id>/sample.sql`, built the way the real tool actually writes
 * dumps — including the one clause that makes that product different from
 * plain PostgreSQL/MySQL. Where that clause trips up the parser, the fixture
 * is kept as written by the real tool and the behaviour is asserted as it
 * actually is, rather than bent until it passes.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { postgresParser } from '../src/parser/postgresql/index.js'
import { createMysqlParser } from '../src/parser/mysql/index.js'
import { toTabular, countRows, extractColumns } from '../src/tabular/index.js'
import type { SqlDump, Table } from '../src/types/index.js'

const mysqlParser = createMysqlParser('mysql')

function loadFixture(id: string): string {
  return readFileSync(
    resolve(import.meta.dirname, '../../../examples/' + id + '/sample.sql'),
    'utf-8',
  )
}

function group(dump: SqlDump, name: string) {
  const found = dump.databases.find((d) => d.name === name)
  if (!found) throw new Error('missing schema/database ' + name)
  return found
}

function table(dump: SqlDump, groupName: string, tableName: string): Table {
  const found = group(dump, groupName).tables.find((t) => t.name === tableName)
  if (!found) throw new Error('missing table ' + tableName)
  return found
}

// ==================================================================
// CockroachDB — `cockroach dump` output read by postgresParser
// ==================================================================
//
// Verdict: works with gaps. Schema/table detection, statement placement and
// row values all read correctly. But cockroach dump appends a trailing
// `FAMILY "primary" (a, b, ...)` clause inside the CREATE TABLE parens, after
// the last real column/constraint. postgresParser's CONSTRAINT_KEYWORDS list
// (CONSTRAINT, PRIMARY, UNIQUE, FOREIGN, CHECK, EXCLUDE, LIKE) does not
// include FAMILY, so `readColumns` falls through to the bare-identifier
// regex and adds a bogus "FAMILY" column. That corrupts any consumer that
// cross-references CREATE TABLE columns against row data (toTabular).
// INSERT statements name their own columns explicitly, so decoding a
// statement in isolation (readDataBlock) is unaffected — only the
// CREATE-TABLE-derived column list is wrong.
describe('family profile: CockroachDB (via postgresParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = postgresParser.parse(loadFixture('cockroachdb'))
  })

  it('is read using the postgresql parser/format stamp', () => {
    expect(dump.format).toBe('postgresql')
    expect(table(dump, 'public', 'customers').format).toBe('postgresql')
  })

  it('groups tables under the public schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['public'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'public').tables.map((t) => t.name)).toEqual([
      'customers',
      'orders',
    ])
  })

  it('keeps the CREATE TABLE statement verbatim, FAMILY clause included', () => {
    expect(table(dump, 'public', 'customers').createStatement).toContain(
      'FAMILY "primary" (id, full_name, email, signed_up_at)',
    )
  })

  it('reads the declared columns without inventing one from the FAMILY clause', () => {
    expect(extractColumns(table(dump, 'public', 'customers'))).toEqual([
      'id',
      'full_name',
      'email',
      'signed_up_at',
    ])
  })

  it('still reads a PostgreSQL column that is genuinely named family', () => {
    // FAMILY is not reserved, so skipping the clause must not cost a real
    // column. This is the reason only the unambiguous forms are skipped.
    const create = 'CREATE TABLE public.people (id integer, family text);'
    expect(postgresParser.readColumns(create)).toEqual(['id', 'family'])
  })

  it('still counts INSERT rows correctly, since row counting does not use readColumns', () => {
    expect(countRows(table(dump, 'public', 'customers'))).toBe(3)
    expect(countRows(table(dump, 'public', 'orders'))).toBe(2)
  })

  it('decodes row values correctly when read from the INSERT statement directly', () => {
    // readDataBlock takes its column list from the INSERT statement's own
    // explicit column list, not from the CREATE TABLE — so it sidesteps the
    // FAMILY bug entirely and proves the row *values* are fine.
    const stmt = table(dump, 'public', 'customers').dataStatements[0]
    const block = postgresParser.readDataBlock(stmt)
    expect(block.columns).toEqual(['id', 'full_name', 'email', 'signed_up_at'])
    expect(block.rows[0]).toEqual([
      '1',
      'Alice Example',
      'alice@example.test',
      '2024-01-15 10:30:00',
    ])
    expect(block.rows[1][1]).toBe('Renée Example')
    expect(block.rows[1][2]).toBeNull() // NULL email
  })

  it('exports rows with no phantom column, which is what CSV and XLSX receive', () => {
    const tabular = toTabular(table(dump, 'public', 'customers'))
    expect(tabular.columns).toEqual([
      'id',
      'full_name',
      'email',
      'signed_up_at',
    ])
    expect(tabular.rows[0]).toEqual([
      '1',
      'Alice Example',
      'alice@example.test',
      '2024-01-15 10:30:00',
    ])
  })
})

// ==================================================================
// YugabyteDB — `ysql_dump` output read by postgresParser
// ==================================================================
//
// Verdict: works unmodified. ysql_dump is close enough to pg_dump that this
// is effectively a PostgreSQL dump: `SPLIT INTO n TABLETS` is a table- and
// index-level trailing clause that sits *outside* the CREATE TABLE/INDEX
// parens, so readColumns never sees it, and USING lsm on the index is just
// text carried along verbatim.
describe('family profile: YugabyteDB (via postgresParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = postgresParser.parse(loadFixture('yugabytedb'))
  })

  it('is read using the postgresql parser/format stamp', () => {
    expect(dump.format).toBe('postgresql')
  })

  it('groups tables under the public schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['public'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'public').tables.map((t) => t.name)).toEqual([
      'customers',
      'orders',
    ])
  })

  it('reads columns without being confused by the trailing SPLIT INTO clause', () => {
    expect(extractColumns(table(dump, 'public', 'customers'))).toEqual([
      'id',
      'full_name',
      'email',
      'signed_up_at',
    ])
  })

  it('unquotes a reserved word used as a column name', () => {
    expect(extractColumns(table(dump, 'public', 'orders'))).toEqual([
      'id',
      'customer_id',
      'order',
      'total',
    ])
  })

  it('attaches the SPLIT INTO index to the table it indexes', () => {
    expect(
      table(dump, 'public', 'customers').postDataStatements.join('\n'),
    ).toContain('CREATE INDEX customers_email_idx')
  })

  it('reads rows out of the COPY block', () => {
    expect(countRows(table(dump, 'public', 'customers'))).toBe(3)
  })

  it('reads \\N as null and preserves UTF-8', () => {
    const rows = toTabular(table(dump, 'public', 'customers')).rows
    expect(rows[1][1]).toBe('Renée Example')
    expect(rows[1][2]).toBeNull()
  })

  it('reads rows out of INSERT statements for the second table', () => {
    expect(countRows(table(dump, 'public', 'orders'))).toBe(2)
    const rows = toTabular(table(dump, 'public', 'orders')).rows
    expect(rows[0]).toEqual([
      '1',
      '11111111-1111-1111-1111-111111111111',
      'Widget crate',
      '129.50',
    ])
  })
})

// ==================================================================
// Greenplum — pg_dump output plus DISTRIBUTED BY/RANDOMLY, read by
// postgresParser
// ==================================================================
//
// Verdict: works unmodified. DISTRIBUTED BY (col) / DISTRIBUTED RANDOMLY sits
// after the closing paren of CREATE TABLE, outside the region readColumns
// balances over, so it is never mistaken for a column.
describe('family profile: Greenplum (via postgresParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = postgresParser.parse(loadFixture('greenplum'))
  })

  it('groups tables under the public schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['public'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'public').tables.map((t) => t.name)).toEqual([
      'orders',
      'audit_log',
    ])
  })

  it('keeps DISTRIBUTED BY / DISTRIBUTED RANDOMLY out of the column list', () => {
    const orderColumns = extractColumns(table(dump, 'public', 'orders'))
    expect(orderColumns).toEqual(['id', 'customer_name', 'amount'])
    expect(orderColumns).not.toContain('DISTRIBUTED')

    const auditColumns = extractColumns(table(dump, 'public', 'audit_log'))
    expect(auditColumns).toEqual(['id', 'event', 'logged_at'])
  })

  it('keeps the trailing distribution clause in the CREATE TABLE text', () => {
    expect(table(dump, 'public', 'orders').createStatement).toContain(
      'DISTRIBUTED BY (id)',
    )
    expect(table(dump, 'public', 'audit_log').createStatement).toContain(
      'DISTRIBUTED RANDOMLY',
    )
  })

  it('reads rows from the COPY block, including a NULL amount', () => {
    expect(countRows(table(dump, 'public', 'orders'))).toBe(3)
    const rows = toTabular(table(dump, 'public', 'orders')).rows
    expect(rows[1][1]).toBe('Renée Example')
    expect(rows[2][2]).toBeNull()
  })

  it('reads rows from INSERT statements for the second table', () => {
    expect(countRows(table(dump, 'public', 'audit_log'))).toBe(2)
  })
})

// ==================================================================
// Amazon Redshift — DDL with DISTKEY/SORTKEY/DISTSTYLE/ENCODE, read by
// postgresParser
// ==================================================================
//
// Verdict: works unmodified for the DDL shown here. ENCODE is a per-column
// attribute that sits inside the same comma-separated column clause as the
// column it modifies, so it never becomes its own list entry; DISTSTYLE,
// DISTKEY(...) and SORTKEY(...) are table-level clauses after the closing
// paren, same as Greenplum's DISTRIBUTED BY. Row data is carried as plain
// INSERT statements here rather than COPY: Redshift's own bulk-load path is
// `COPY ... FROM 's3://...'` / `UNLOAD`, not a local `COPY ... FROM stdin`
// text block, so INSERT is the realistic shape for a portable local dump.
describe('family profile: Amazon Redshift (via postgresParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = postgresParser.parse(loadFixture('redshift'))
  })

  it('groups tables under the public schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['public'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'public').tables.map((t) => t.name)).toEqual([
      'orders',
      'events',
    ])
  })

  it('reads columns without ENCODE/DISTKEY/SORTKEY/DISTSTYLE leaking in', () => {
    const orderColumns = extractColumns(table(dump, 'public', 'orders'))
    expect(orderColumns).toEqual(['id', 'customer_name', 'amount', 'notes'])
    for (const bogus of ['ENCODE', 'DISTKEY', 'SORTKEY', 'DISTSTYLE']) {
      expect(orderColumns).not.toContain(bogus)
    }

    expect(extractColumns(table(dump, 'public', 'events'))).toEqual([
      'id',
      'event_name',
    ])
  })

  it('keeps the column-attribute ENCODE clauses in the CREATE TABLE text', () => {
    expect(table(dump, 'public', 'orders').createStatement).toContain(
      'ENCODE lzo',
    )
    expect(table(dump, 'public', 'orders').createStatement).toContain(
      'DISTKEY(id)',
    )
  })

  it('reads rows from INSERT statements, including a NULL and UTF-8', () => {
    expect(countRows(table(dump, 'public', 'orders'))).toBe(3)
    const rows = toTabular(table(dump, 'public', 'orders')).rows
    expect(rows[1][1]).toBe('Renée Example')
    expect(rows[1][3]).toBeNull()
  })
})

// ==================================================================
// TimescaleDB — pg_dump output plus SELECT create_hypertable(...), read by
// postgresParser
// ==================================================================
//
// Verdict: works unmodified. create_hypertable is a plain SELECT statement,
// not DDL, so classifyStatement falls through to 'unknown' and it is parked
// in preamble/postamble verbatim — it never touches column reading.
describe('family profile: TimescaleDB (via postgresParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = postgresParser.parse(loadFixture('timescaledb'))
  })

  it('groups tables under the public schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['public'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'public').tables.map((t) => t.name)).toEqual([
      'sensors',
      'sensor_readings',
    ])
  })

  it('reads the hypertable columns correctly', () => {
    expect(extractColumns(table(dump, 'public', 'sensor_readings'))).toEqual([
      'id',
      'sensor_id',
      'recorded_at',
      'value',
    ])
  })

  it('parks the create_hypertable() call rather than losing it', () => {
    expect(dump.postamble).toContain(
      "create_hypertable('public.sensor_readings', 'recorded_at')",
    )
  })

  it('reads rows from the COPY block, including a NULL value', () => {
    expect(countRows(table(dump, 'public', 'sensor_readings'))).toBe(3)
    const rows = toTabular(table(dump, 'public', 'sensor_readings')).rows
    expect(rows[1][3]).toBeNull()
  })

  it('reads UTF-8 values from the plain INSERT-backed table', () => {
    expect(countRows(table(dump, 'public', 'sensors'))).toBe(2)
    const rows = toTabular(table(dump, 'public', 'sensors')).rows
    expect(rows[1][1]).toBe('Renée Example lab — sensor B')
  })
})

// ==================================================================
// Citus — pg_dump output plus SELECT create_distributed_table(...) /
// create_reference_table(...), read by postgresParser
// ==================================================================
//
// Verdict: works unmodified, for the same reason as TimescaleDB: both calls
// are plain SELECT statements that classify as 'unknown' and are parked
// verbatim, never interfering with column or row reading.
describe('family profile: Citus (via postgresParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = postgresParser.parse(loadFixture('citus'))
  })

  it('groups tables under the public schema', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['public'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'public').tables.map((t) => t.name)).toEqual([
      'regions',
      'events',
    ])
  })

  it('reads columns for both the reference table and the distributed table', () => {
    expect(extractColumns(table(dump, 'public', 'regions'))).toEqual([
      'id',
      'name',
    ])
    expect(extractColumns(table(dump, 'public', 'events'))).toEqual([
      'id',
      'tenant_id',
      'payload',
    ])
  })

  it('parks both distribution calls rather than losing them', () => {
    expect(dump.postamble).toContain("create_reference_table('public.regions')")
    expect(dump.postamble).toContain(
      "create_distributed_table('public.events', 'tenant_id')",
    )
  })

  it('reads rows from INSERT statements', () => {
    expect(countRows(table(dump, 'public', 'regions'))).toBe(2)
  })

  it('reads rows from the COPY block, including a NULL and UTF-8', () => {
    expect(countRows(table(dump, 'public', 'events'))).toBe(3)
    const rows = toTabular(table(dump, 'public', 'events')).rows
    expect(rows[1][2]).toBeNull()
    expect(rows[2][2]).toBe('Renée Example placed an order')
  })
})

// ==================================================================
// TiDB — Dumpling output, read by createMysqlParser('mysql')
// ==================================================================
//
// Verdict: works unmodified. The TiDB-specific `/*T![feature] ... */`
// comments (guarding AUTO_RANDOM and CLUSTERED/NONCLUSTERED) contain their
// own balanced parens, so readBalanced's paren-depth tracking returns to the
// same depth after each comment and never mistakes comment text for a
// column boundary; PRIMARY KEY / KEY clauses are skipped the same way they
// are in a plain MySQL dump.
describe('family profile: TiDB (via createMysqlParser)', () => {
  let dump: SqlDump

  beforeAll(() => {
    dump = mysqlParser.parse(loadFixture('tidb'))
  })

  it('is read using the mysql parser/format stamp', () => {
    expect(dump.format).toBe('mysql')
    expect(table(dump, 'shop_db', 'customers').format).toBe('mysql')
  })

  it('groups tables under the database named in CREATE DATABASE/USE', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['shop_db'])
  })

  it('finds every table with its name unqualified', () => {
    expect(group(dump, 'shop_db').tables.map((t) => t.name)).toEqual([
      'customers',
      'orders',
    ])
  })

  it('keeps the /*T![...] */ comments in the CREATE TABLE text verbatim', () => {
    expect(table(dump, 'shop_db', 'customers').createStatement).toContain(
      '/*T![auto_rand] AUTO_RANDOM(5) */',
    )
    expect(table(dump, 'shop_db', 'orders').createStatement).toContain(
      '/*T![clustered_index] NONCLUSTERED */',
    )
  })

  it('reads columns without AUTO_RANDOM or the T! comment leaking in as a column', () => {
    expect(extractColumns(table(dump, 'shop_db', 'customers'))).toEqual([
      'id',
      'full_name',
      'email',
      'signed_up_at',
    ])
    expect(extractColumns(table(dump, 'shop_db', 'orders'))).toEqual([
      'id',
      'customer_id',
      'note',
    ])
  })

  it('reads rows from a multi-tuple INSERT, including NULL and UTF-8', () => {
    expect(countRows(table(dump, 'shop_db', 'customers'))).toBe(3)
    const rows = toTabular(table(dump, 'shop_db', 'customers')).rows
    expect(rows[0]).toEqual([
      '1000000000000001',
      'Alice Example',
      'alice@example.test',
      '2024-01-15 10:30:00',
    ])
    expect(rows[1][1]).toBe('Renée Example')
    expect(rows[1][2]).toBeNull()
  })

  it('reads the second table, including a NULL note with an embedded comma', () => {
    expect(countRows(table(dump, 'shop_db', 'orders'))).toBe(2)
    const rows = toTabular(table(dump, 'shop_db', 'orders')).rows
    expect(rows[0][2]).toBe('Ships to depot, invoice #A-100')
    expect(rows[1][2]).toBeNull()
  })
})
