import { describe, it, expect } from 'vitest'
import { toSqlInserts } from '../src/generator/sql-inserts.js'
import { parseDump } from '../src/parser/index.js'
import { toTabular } from '../src/tabular/index.js'

const MYSQL_MODE =
  "/*!40101 SET SESSION sql_mode = 'ANSI_QUOTES,NO_BACKSLASH_ESCAPES' */;"

function table(columns: string[], rows: (string | null)[][], name = 'users') {
  return { name, columns, rows }
}

/** The statements only, without the comment lines that open the file. */
function body(sql: string): string {
  return sql.slice(sql.indexOf('CREATE TABLE'))
}

describe('toSqlInserts', () => {
  it('writes a CREATE TABLE of TEXT columns and one INSERT', () => {
    const sql = toSqlInserts(
      table(
        ['name', 'age'],
        [
          ['John', '30'],
          ['Maria', '25'],
        ],
      ),
      { tableName: 'users' },
    )

    expect(body(sql)).toBe(
      [
        'CREATE TABLE "users" (',
        '  "name" TEXT,',
        '  "age" TEXT',
        ');',
        '',
        'INSERT INTO "users" ("name", "age")',
        'VALUES',
        "  ('John', '30'),",
        "  ('Maria', '25');",
        '',
      ].join('\n'),
    )
  })

  it('opens with comments and the MySQL mode that makes it standard SQL there', () => {
    const sql = toSqlInserts(table(['a'], [['1']]), { tableName: 't' })
    const [first, second, third] = sql.split('\n')

    expect(first.startsWith('-- ')).toBe(true)
    expect(second.startsWith('-- ')).toBe(true)
    // Read by MySQL and MariaDB only; every other engine sees a comment.
    expect(third).toBe(MYSQL_MODE)
  })

  it('doubles quotes inside identifiers and strings', () => {
    const sql = toSqlInserts(table(['na"me'], [["O'Brien"]]), {
      tableName: 'user"s',
    })

    expect(sql).toContain('CREATE TABLE "user""s" (')
    expect(sql).toContain('  "na""me" TEXT')
    expect(sql).toContain("  ('O''Brien');")
  })

  it('writes an empty cell as NULL, not an empty string', () => {
    const sql = toSqlInserts(table(['a', 'b', 'c'], [['', null, 'x']]), {
      tableName: 't',
    })

    expect(sql).toContain("  (NULL, NULL, 'x');")
  })

  it('keeps statement syntax inside a value as text', () => {
    const sql = toSqlInserts(
      table(['v'], [["x'); DROP TABLE t; --"], ['a;b'], ['-- c']]),
      { tableName: 't' },
    )

    expect(sql).toContain("  ('x''); DROP TABLE t; --'),")
    expect(sql).toContain("  ('a;b'),")
    expect(sql).toContain("  ('-- c');")
  })

  it('writes a backslash as itself, which the MySQL mode keeps literal', () => {
    // Without NO_BACKSLASH_ESCAPES, a trailing backslash would escape the
    // closing quote in MySQL and let the next value run as SQL.
    const sql = toSqlInserts(
      table(['a', 'b'], [['C:\\temp\\', '); DROP TABLE t; --']]),
      { tableName: 't' },
    )

    expect(sql).toContain("  ('C:\\temp\\', '); DROP TABLE t; --');")
    expect(sql).toContain(MYSQL_MODE)
  })

  it('keeps unicode as it is', () => {
    const sql = toSqlInserts(table(['cidade'], [['São Paulo'], ['東京']]), {
      tableName: 'lugares',
    })

    expect(sql).toContain("  ('São Paulo'),")
    expect(sql).toContain("  ('東京');")
  })

  it('names empty and repeated headers the way every writer does', () => {
    const sql = toSqlInserts(table(['name', '', 'Name'], [['a', 'b', 'c']]), {
      tableName: 't',
    })

    expect(sql).toContain('INSERT INTO "t" ("name", "column_2", "Name_2")')
  })

  it('writes 500 rows as one INSERT and 501 as two', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, i) => [String(i)])
    const statements = (sql: string) => sql.match(/^INSERT INTO /gm) ?? []

    const five = toSqlInserts(table(['n'], rows(500)), { tableName: 't' })
    const fiveOne = toSqlInserts(table(['n'], rows(501)), { tableName: 't' })

    expect(statements(five)).toHaveLength(1)
    expect(statements(fiveOne)).toHaveLength(2)
    // The second batch holds exactly the one row left over.
    expect(fiveOne.trimEnd().endsWith("VALUES\n  ('500');")).toBe(true)
  })

  it('writes only the CREATE TABLE for a sheet holding only a header', () => {
    const sql = toSqlInserts(table(['a', 'b'], []), { tableName: 't' })

    expect(sql).toContain('CREATE TABLE "t" (')
    expect(sql).not.toContain('INSERT INTO')
  })

  it('cleans a table name taken from a sheet', () => {
    expect(
      toSqlInserts(table(['a'], []), { tableName: ' Sales\u0007 ' }),
    ).toContain('CREATE TABLE "Sales" (')
    expect(toSqlInserts(table(['a'], []), { tableName: '   ' })).toContain(
      'CREATE TABLE "sheet" (',
    )
  })

  it('is read back by the SQLite parser as the same table', () => {
    const source = table(
      ['name', 'note'],
      [
        ["O'Brien", 'a;b'],
        ['Ada', null],
      ],
    )

    const dump = parseDump(toSqlInserts(source, { tableName: 'users' }), {
      format: 'sqlite',
    })
    const parsed = toTabular(dump.databases[0].tables[0])

    expect(parsed.columns).toEqual(['name', 'note'])
    expect(parsed.rows).toEqual([
      ["O'Brien", 'a;b'],
      ['Ada', null],
    ])
  })
})
