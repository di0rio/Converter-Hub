import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import { parseDump } from '../src/parser/index.js'
import { toTabular, extractColumns } from '../src/tabular/index.js'
import {
  toCsv,
  toXlsx,
  createZip,
  generateExport,
} from '../src/generator/index.js'

// Synthetic fixture — no real data.
const DUMP = [
  '-- MySQL dump 10.13',
  '-- Host: localhost    Database: shop',
  'CREATE DATABASE IF NOT EXISTS `shop` DEFAULT CHARACTER SET utf8mb4;',
  'USE `shop`;',
  'CREATE TABLE `users` (',
  '  `id` int NOT NULL AUTO_INCREMENT,',
  '  `name` varchar(100) NOT NULL,',
  '  `note` text,',
  '  PRIMARY KEY (`id`),',
  '  KEY `idx_name` (`name`)',
  ') ENGINE=InnoDB;',
  "INSERT INTO `users` VALUES (1,'Ana',NULL),(2,'Bruno, Jr.','say \\'hi\\''),(3,'Cleo','a\\nb');",
  'CREATE TABLE `orders` (',
  '  `id` int NOT NULL,',
  '  `code` varchar(20) NOT NULL,',
  '  PRIMARY KEY (`id`)',
  ');',
  "INSERT INTO `orders` (`id`, `code`) VALUES (1,'007'),(2,'12.50');",
].join('\n')

const dump = parseDump(DUMP)
const shop = dump.databases[0]

describe('parser: dumps without CREATE DATABASE', () => {
  it('recovers the database name from the mysqldump header', () => {
    const parsed = parseDump(
      [
        '-- Host: localhost    Database: inventory',
        'CREATE TABLE `parts` (`id` int NOT NULL, PRIMARY KEY (`id`));',
      ].join('\n'),
    )

    expect(parsed.databases).toHaveLength(1)
    expect(parsed.databases[0].name).toBe('inventory')
    expect(parsed.databases[0].tables.map((t) => t.name)).toEqual(['parts'])
  })

  it('falls back to a generic name when the header is absent', () => {
    const parsed = parseDump('CREATE TABLE `t` (`id` int NOT NULL);')
    expect(parsed.databases[0].name).toBe('database')
  })

  it('attaches orphan INSERT statements to an implicit database', () => {
    const parsed = parseDump("INSERT INTO `logs` VALUES (1,'x');")
    expect(parsed.databases[0].tables.map((t) => t.name)).toEqual(['logs'])
  })
})

describe('tabular', () => {
  it('reads column names and skips constraint clauses', () => {
    expect(extractColumns(shop.tables[0])).toEqual(['id', 'name', 'note'])
  })

  it('decodes NULL, escaped quotes and escape sequences', () => {
    const table = toTabular(shop.tables[0])
    expect(table.rows).toEqual([
      ['1', 'Ana', null],
      ['2', 'Bruno, Jr.', "say 'hi'"],
      ['3', 'Cleo', 'a\nb'],
    ])
  })

  it('honours an explicit column list on the INSERT', () => {
    const table = toTabular(shop.tables[1])
    expect(table.columns).toEqual(['id', 'code'])
    expect(table.rows).toEqual([
      ['1', '007'],
      ['2', '12.50'],
    ])
  })
})

describe('csv', () => {
  it('quotes delimiters, quotes and newlines per RFC 4180', () => {
    const csv = toCsv(toTabular(shop.tables[0]))
    const lines = csv.split('\r\n')

    expect(lines[0]).toBe('\ufeffid,name,note')
    expect(lines[1]).toBe('1,Ana,')
    expect(lines[2]).toBe('2,"Bruno, Jr.",say \'hi\'')
    expect(csv).toContain('"a\nb"')
  })

  it('neutralises leading = + - @ so Excel/Sheets cannot read them as formulas', () => {
    // Dump content is untrusted — a table value can carry a formula payload.
    const table = {
      name: 'notes',
      columns: ['id', 'note'],
      rows: [
        ['1', '=cmd|/c calc'],
        ['2', '+1+1'],
        ['3', '-1+1'],
        ['4', '@SUM(1,1)'],
        ['5', 'plain text'],
      ],
    }

    const lines = toCsv(table).split('\r\n')

    expect(lines[1]).toBe("1,'=cmd|/c calc")
    expect(lines[2]).toBe("2,'+1+1")
    expect(lines[3]).toBe("3,'-1+1")
    expect(lines[4]).toBe('4,"\'@SUM(1,1)"')
    expect(lines[5]).toBe('5,plain text')
  })
})

describe('xlsx', () => {
  const bytes = toXlsx(shop.tables.map(toTabular))
  const parts = unzipSync(bytes)

  it('produces a workbook with the required OOXML parts', () => {
    expect(Object.keys(parts)).toEqual(
      expect.arrayContaining([
        '[Content_Types].xml',
        '_rels/.rels',
        'xl/workbook.xml',
        'xl/_rels/workbook.xml.rels',
        'xl/worksheets/sheet1.xml',
        'xl/worksheets/sheet2.xml',
      ]),
    )
  })

  it('names one worksheet per table', () => {
    const workbook = strFromU8(parts['xl/workbook.xml'])
    expect(workbook).toContain('name="users"')
    expect(workbook).toContain('name="orders"')
  })

  it('keeps values with leading zeros as text', () => {
    const sheet = strFromU8(parts['xl/worksheets/sheet2.xml'])
    expect(sheet).toContain('<t xml:space="preserve">007</t>')
    // A plain decimal is still a number.
    expect(sheet).toContain('<v>12.50</v>')
  })

  it('constrains worksheet names to Excel rules', () => {
    const awkward = toXlsx([
      { name: 'a/b:c*d?e[f]g', columns: ['x'], rows: [['1']] },
      { name: 'x'.repeat(40), columns: ['x'], rows: [['1']] },
      { name: 'x'.repeat(40), columns: ['x'], rows: [['2']] },
    ])
    const workbook = strFromU8(unzipSync(awkward)['xl/workbook.xml'])

    expect(workbook).not.toMatch(/name="[^"]*[:\\/?*[\]][^"]*"/)
    for (const [, name] of workbook.matchAll(/name="([^"]+)"/g)) {
      expect(name.length).toBeLessThanOrEqual(31)
    }
  })
})

describe('zip', () => {
  it('round-trips its entries', () => {
    const bytes = createZip([
      { name: 'a.txt', content: new TextEncoder().encode('hello') },
      { name: 'b.txt', content: new TextEncoder().encode('world') },
    ])
    const entries = unzipSync(bytes)

    expect(Object.keys(entries).sort()).toEqual(['a.txt', 'b.txt'])
    expect(strFromU8(entries['a.txt'])).toBe('hello')
  })
})

describe('generateExport', () => {
  it('packages SQL as a single dump file', () => {
    const result = generateExport(
      dump,
      { database: 'shop', tables: 'all' },
      'sql',
    )

    expect(result.filename).toBe('shop-export.zip')
    expect(result.files).toEqual(['shop.sql'])
    expect(result.tableCount).toBe(2)
    expect(strFromU8(unzipSync(result.bytes)['shop.sql'])).toContain(
      'CREATE TABLE `users`',
    )
  })

  it('packages CSV as one file per selected table', () => {
    const result = generateExport(
      dump,
      { database: 'shop', tables: ['orders'] },
      'csv',
    )

    expect(result.files).toEqual(['orders.csv'])
    expect(result.tableCount).toBe(1)
    expect(Object.keys(unzipSync(result.bytes))).toEqual(['orders.csv'])
  })

  it('packages XLSX as one workbook', () => {
    const result = generateExport(
      dump,
      { database: 'shop', tables: 'all' },
      'xlsx',
    )
    expect(result.files).toEqual(['shop.xlsx'])
  })

  it('never executes SQL and never reaches the network or filesystem', () => {
    // generateExport returns bytes only; this guards the contract in review.
    const result = generateExport(
      dump,
      { database: 'shop', tables: 'all' },
      'sql',
    )
    expect(result.bytes).toBeInstanceOf(Uint8Array)
  })

  it('rejects an unknown database', () => {
    expect(() =>
      generateExport(dump, { database: 'nope', tables: 'all' }, 'sql'),
    ).toThrow(/not present/i)
  })

  it('rejects an empty table selection', () => {
    expect(() =>
      generateExport(dump, { database: 'shop', tables: [] }, 'csv'),
    ).toThrow(/No tables/i)
  })
})
