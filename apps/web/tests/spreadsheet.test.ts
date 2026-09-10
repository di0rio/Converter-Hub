import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import * as XLSX from 'xlsx'
import {
  MAX_WORKBOOK_BYTES,
  buildArchive,
  isOversizedWorkbook,
  oversizedWorkbookMessage,
  readSheetRows,
  readWorkbook,
  toFileName,
  type LoadedWorkbook,
} from '@/lib/spreadsheet'

/** A workbook built in memory, so no real spreadsheet is ever committed. */
function makeWorkbook(sheets: Record<string, unknown[][]>): LoadedWorkbook {
  const workbook = XLSX.utils.book_new()

  // Assigned directly rather than through book_append_sheet: that helper
  // rejects the very names this tool has to defend against, and a file written
  // by something other than Excel can still carry them.
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.SheetNames.push(name)
    workbook.Sheets[name] = XLSX.utils.aoa_to_sheet(rows)
  }

  return {
    fileName: 'clients.xlsx',
    baseName: 'clients',
    sheets: workbook.SheetNames.map((name) => {
      const ref = workbook.Sheets[name]['!ref']
      const end = ref?.split(':').at(-1) ?? ''
      const rows = Number(end.replace(/[A-Z]/g, '') || 0)
      return { name, rows, columns: 1, empty: !ref }
    }),
    workbook,
  }
}

function entries(bytes: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(bytes)
}

describe('toFileName', () => {
  it('replaces the characters a file system reserves', () => {
    // "Jan/Feb" would otherwise collapse into a path separator.
    expect(toFileName('Jan/Feb')).toBe('Jan-Feb')
    expect(toFileName('Q1:Q2')).toBe('Q1-Q2')
    expect(toFileName('a\\b*c?d"e<f>g|h')).toBe('a-b-c-d-e-f-g-h')
  })

  it('keeps accents and non-Latin scripts', () => {
    // These are legal in file names, and mangling them only makes the output
    // harder to recognise.
    expect(toFileName('Março')).toBe('Março')
    expect(toFileName('売上')).toBe('売上')
  })

  it('cannot produce an entry that escapes the archive', () => {
    expect(toFileName('../../etc/passwd')).toBe('etc-passwd')
    expect(toFileName('..')).toBe('sheet')
    expect(toFileName('.')).toBe('sheet')
  })

  it('cannot produce a hidden file', () => {
    expect(toFileName('.hidden')).toBe('hidden')
  })

  it('strips control characters', () => {
    expect(toFileName('Sales\u0007\u001f')).toBe('Sales')
  })

  it('falls back to a name when nothing usable survives', () => {
    expect(toFileName('   ')).toBe('sheet')
    expect(toFileName('///')).toBe('sheet')
  })

  it('caps a pathological name', () => {
    expect(toFileName('x'.repeat(500))).toHaveLength(100)
  })
})

describe('workbook size ceiling', () => {
  it('accepts a file at the limit and refuses one past it', () => {
    expect(isOversizedWorkbook(MAX_WORKBOOK_BYTES)).toBe(false)
    expect(isOversizedWorkbook(MAX_WORKBOOK_BYTES + 1)).toBe(true)
  })

  it('names both sizes and nothing from the file itself', () => {
    const message = oversizedWorkbookMessage(200 * 1024 * 1024)
    expect(message).toContain('200 MB')
    expect(message).toContain('100 MB')
  })
})

describe('readWorkbook', () => {
  it('describes each sheet, and marks the empty ones', async () => {
    const source = makeWorkbook({
      Clients: [
        ['name', 'city'],
        ['Ada', 'Lisbon'],
        ['Grace', 'Porto'],
      ],
    })
    // A sheet with no used range at all.
    source.workbook.SheetNames.push('Blank')
    source.workbook.Sheets.Blank = {}

    const bytes = XLSX.write(source.workbook, {
      bookType: 'xlsx',
      type: 'array',
    })
    const file = new File([bytes], 'clients.xlsx')

    const loaded = await readWorkbook(file)

    expect(loaded.baseName).toBe('clients')
    expect(loaded.sheets.map((sheet) => sheet.name)).toContain('Clients')

    // Three rows in the range, one of which names the columns.
    const clients = loaded.sheets.find((sheet) => sheet.name === 'Clients')
    expect(clients).toMatchObject({ rows: 2, columns: 2, empty: false })

    const blank = loaded.sheets.find((sheet) => sheet.name === 'Blank')
    expect(blank?.empty).toBe(true)
  })
})

describe('readSheetRows', () => {
  it('returns every row, header first', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`row ${i}`])
    const source = makeWorkbook({ Big: [['label'], ...rows] })

    const read = await readSheetRows(source.workbook, 'Big')

    expect(read).toHaveLength(41)
    expect(read[0]).toEqual(['label'])
  })

  it('returns at most the rows it was asked for', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`row ${i}`])
    const source = makeWorkbook({ Big: [['label'], ...rows] })

    expect(await readSheetRows(source.workbook, 'Big', 10)).toHaveLength(10)
  })

  it('is empty for a sheet with no used range', async () => {
    const source = makeWorkbook({ Clients: [['name']] })
    source.workbook.Sheets.Clients = {}

    expect(await readSheetRows(source.workbook, 'Clients')).toEqual([])
  })
})

describe('buildArchive', () => {
  it('writes one workbook per selected sheet', async () => {
    const source = makeWorkbook({
      Clients: [['name'], ['Ada']],
      Orders: [['id'], ['1']],
      Skipped: [['x'], ['y']],
    })

    const result = await buildArchive(source, ['Clients', 'Orders'], 'xlsx')

    expect(result.filename).toBe('clients_sheets.zip')
    expect(result.files).toEqual(['Clients.xlsx', 'Orders.xlsx'])

    const unpacked = entries(result.bytes)
    expect(Object.keys(unpacked).sort()).toEqual([
      'Clients.xlsx',
      'Orders.xlsx',
    ])

    // Each entry is a workbook in its own right, holding only its own sheet.
    const clients = XLSX.read(unpacked['Clients.xlsx'], { type: 'array' })
    expect(clients.SheetNames).toEqual(['Clients'])
    expect(
      XLSX.utils.sheet_to_json(clients.Sheets.Clients, { header: 1 }),
    ).toEqual([['name'], ['Ada']])
  })

  it('writes one CSV per selected sheet', async () => {
    const source = makeWorkbook({
      Clients: [
        ['name', 'city'],
        ['Ada', 'Lisbon'],
      ],
    })

    const result = await buildArchive(source, ['Clients'], 'csv')

    expect(result.files).toEqual(['Clients.csv'])

    // The byte order mark is what makes Excel read the file as UTF-8. It is
    // asserted on the bytes, because a UTF-8 decoder consumes it on the way
    // back out.
    const raw = entries(result.bytes)['Clients.csv']
    expect(Array.from(raw.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])

    const csv = strFromU8(raw)
    expect(csv).toContain('name,city')
    expect(csv).toContain('Ada,Lisbon')
  })

  it('neutralises a cell that would be read back as a formula', async () => {
    // The same rule the SQL tool applies: a leading = + - or @ makes a
    // spreadsheet treat the value as a formula when the CSV is reopened.
    const source = makeWorkbook({
      Payload: [['note'], ['=1+1'], ['+cmd'], ['-2'], ['@SUM(A1)']],
    })

    const csv = strFromU8(
      entries((await buildArchive(source, ['Payload'], 'csv')).bytes)[
        'Payload.csv'
      ],
    )

    expect(csv).toContain("'=1+1")
    expect(csv).toContain("'+cmd")
    expect(csv).toContain("'-2")
    expect(csv).toContain("'@SUM(A1)")
    expect(csv).not.toMatch(/(^|[\r\n,])=1\+1/)
  })

  it('quotes a value carrying the delimiter', async () => {
    const source = makeWorkbook({ Clients: [['name'], ['Doe, Jane']] })

    const csv = strFromU8(
      entries((await buildArchive(source, ['Clients'], 'csv')).bytes)[
        'Clients.csv'
      ],
    )

    expect(csv).toContain('"Doe, Jane"')
  })

  it('writes CSV with the delimiter it is given', async () => {
    const source = makeWorkbook({
      Clients: [
        ['name', 'city'],
        ['Doe; Jane', 'Lisbon'],
      ],
    })

    const result = await buildArchive(source, ['Clients'], 'csv', {
      delimiter: ';',
    })
    const csv = strFromU8(entries(result.bytes)['Clients.csv'])

    expect(csv.replace(/^\ufeff/, '')).toBe(
      'name;city\r\n"Doe; Jane";Lisbon\r\n',
    )
  })

  it('writes one JSON array per selected sheet', async () => {
    const source = makeWorkbook({
      Clients: [
        ['name', 'city'],
        ['Ada', 'Lisbon'],
      ],
      Orders: [['id'], ['1']],
    })

    const result = await buildArchive(source, ['Clients', 'Orders'], 'json')

    expect(result.files).toEqual(['Clients.json', 'Orders.json'])
    const raw = entries(result.bytes)['Clients.json']
    // No byte order mark: a JSON parser rejects one.
    expect(raw[0]).toBe(0x5b)
    expect(JSON.parse(strFromU8(raw))).toEqual([
      { name: 'Ada', city: 'Lisbon' },
    ])
  })

  it('writes an empty JSON array for a sheet holding only a header', async () => {
    const source = makeWorkbook({ Header: [['a', 'b']] })

    const result = await buildArchive(source, ['Header'], 'json')

    expect(strFromU8(entries(result.bytes)['Header.json'])).toBe('[]')
  })

  it('writes one Markdown table per selected sheet', async () => {
    const source = makeWorkbook({
      Clients: [
        ['name', 'city'],
        ['Ada', 'Lisbon'],
      ],
    })

    const result = await buildArchive(source, ['Clients'], 'md')

    expect(result.files).toEqual(['Clients.md'])
    expect(strFromU8(entries(result.bytes)['Clients.md'])).toBe(
      '| name | city |\n| --- | --- |\n| Ada | Lisbon |\n',
    )
  })

  it('keeps two sheets that differ only by case as two files', async () => {
    // The same file name on Windows and macOS, so the later one is suffixed
    // rather than silently overwriting the first.
    const source = makeWorkbook({
      Sales: [['a'], ['1']],
      sales: [['b'], ['2']],
    })

    const result = await buildArchive(source, ['Sales', 'sales'], 'xlsx')

    expect(result.files).toEqual(['Sales.xlsx', 'sales_2.xlsx'])
    expect(Object.keys(entries(result.bytes))).toHaveLength(2)
  })

  it('names entries safely when a sheet name carries separators', async () => {
    const source = makeWorkbook({ 'Jan/Feb': [['a'], ['1']] })

    const result = await buildArchive(source, ['Jan/Feb'], 'xlsx')

    expect(result.files).toEqual(['Jan-Feb.xlsx'])
    // Nothing in the archive may contain a path separator.
    for (const name of Object.keys(entries(result.bytes))) {
      expect(name).not.toContain('/')
      expect(name).not.toContain('\\')
    }
  })

  it('reports progress once per sheet, in order', async () => {
    const source = makeWorkbook({
      A: [['a'], ['1']],
      B: [['b'], ['2']],
      C: [['c'], ['3']],
    })

    const seen: Array<[number, number]> = []
    await buildArchive(source, ['A', 'B', 'C'], 'xlsx', {
      onProgress: (done, total) => seen.push([done, total]),
    })

    expect(seen).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('skips a name the workbook does not have rather than failing', async () => {
    const source = makeWorkbook({ Clients: [['a'], ['1']] })

    const result = await buildArchive(source, ['Clients', 'Gone'], 'xlsx')

    expect(result.files).toEqual(['Clients.xlsx'])
  })
})

describe('buildArchive: formulas', () => {
  /**
   * Sheet B reads from its neighbours the ways a real workbook does. Each cell
   * carries the cached value Excel would have stored next to the formula.
   */
  function linked(): LoadedWorkbook {
    const source = makeWorkbook({
      A: [['n'], [10]],
      'Other Sheet': [['m'], [3]],
      "O'Brien": [['q'], [4]],
      B: [
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        [0, 0, 0, 0, 0, 0, 0, 0],
      ],
    })
    const b = source.workbook.Sheets.B
    b.A2 = { t: 'n', v: 20, f: 'A!A2*2' }
    b.B2 = { t: 'n', v: 6, f: "'Other Sheet'!A2*2" }
    b.C2 = { t: 'n', v: 8, f: "'O''Brien'!A2*2" }
    b.D2 = { t: 'n', v: 5, f: '[1]Sheet1!A1' }
    b.E2 = { t: 'n', v: 40, f: 'A2*2' }
    b.F2 = { t: 's', v: 'a!b', f: '"a!b"' }
    b.G2 = { t: 'n', v: 40, f: 'B!E2' }
    b.H2 = { t: 'n', v: 20, f: 'Rate*2' }
    source.workbook.Workbook = { Names: [{ Name: 'Rate', Ref: 'A!$A$2' }] }
    return source
  }

  async function exportB(source: LoadedWorkbook): Promise<XLSX.WorkSheet> {
    const result = await buildArchive(source, ['B'], 'xlsx')
    const book = XLSX.read(entries(result.bytes)['B.xlsx'], {
      type: 'array',
      cellFormula: true,
    })
    return book.Sheets.B
  }

  it('keeps the cached value of a formula that reads another sheet', async () => {
    const sheet = await exportB(linked())

    expect(sheet.A2.f).toBeUndefined()
    expect(sheet.A2.v).toBe(20)
  })

  it('recognises quoted sheet names, with spaces or apostrophes', async () => {
    const sheet = await exportB(linked())

    expect(sheet.B2.f).toBeUndefined()
    expect(sheet.B2.v).toBe(6)
    expect(sheet.C2.f).toBeUndefined()
    expect(sheet.C2.v).toBe(8)
  })

  it('keeps the cached value of a reference to another workbook', async () => {
    const sheet = await exportB(linked())

    expect(sheet.D2.f).toBeUndefined()
    expect(sheet.D2.v).toBe(5)
  })

  it('keeps the cached value of a defined name, which the new file lacks', async () => {
    const sheet = await exportB(linked())

    expect(sheet.H2.f).toBeUndefined()
    expect(sheet.H2.v).toBe(20)
  })

  it('leaves a formula that only reads its own sheet alone', async () => {
    const sheet = await exportB(linked())

    expect(sheet.E2.f).toBe('A2*2')
    // Naming its own sheet is still reading its own sheet.
    expect(sheet.G2.f).toBe('B!E2')
    // A "!" inside a string literal is not a reference.
    expect(sheet.F2.f).toBe('"a!b"')
  })

  it('never changes the workbook it was given', async () => {
    const source = linked()

    await exportB(source)

    expect(source.workbook.Sheets.B.A2.f).toBe('A!A2*2')
    expect(source.workbook.Sheets.B.C2.f).toBe("'O''Brien'!A2*2")
    expect(source.workbook.Sheets.B.H2.f).toBe('Rate*2')
  })
})

describe('readWorkbook: formats', () => {
  const ROWS = [
    ['name', 'city'],
    ['Ada', 'São Paulo'],
    ['Grace', 'Porto'],
  ]

  /** A synthetic workbook written by SheetJS in the given format. */
  function written(bookType: XLSX.BookType, name: string): File {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(ROWS),
      'Clients',
    )
    return new File([XLSX.write(workbook, { bookType, type: 'array' })], name)
  }

  for (const [bookType, name] of [
    ['xlsx', 'book.xlsx'],
    ['xlsm', 'book.xlsm'],
    ['biff8', 'book.xls'],
    ['xlsb', 'book.xlsb'],
    ['ods', 'book.ods'],
  ] as const) {
    it(`reads ${name} back sheet for sheet and row for row`, async () => {
      const loaded = await readWorkbook(written(bookType, name))

      expect(loaded.sheets.map((sheet) => sheet.name)).toEqual(['Clients'])
      expect(await readSheetRows(loaded.workbook, 'Clients')).toEqual(ROWS)
    })
  }

  it('reads a CSV as one sheet named after the file', async () => {
    const file = new File(
      ['name,city\r\nAda,São Paulo\r\nGrace,Porto\r\n'],
      'clientes.csv',
    )

    const loaded = await readWorkbook(file)

    expect(loaded.sheets.map((sheet) => sheet.name)).toEqual(['clientes'])
    expect(await readSheetRows(loaded.workbook, 'clientes')).toEqual(ROWS)
  })

  it('reads a CSV saved by Excel in a decimal-comma locale', async () => {
    // A byte order mark, semicolons, and a semicolon inside a quoted value.
    const file = new File(
      ['\ufeffname;city\r\nAda;São Paulo\r\n"Doe; Jane";Porto\r\n'],
      'export.csv',
    )

    const loaded = await readWorkbook(file)

    expect(await readSheetRows(loaded.workbook, 'export')).toEqual([
      ['name', 'city'],
      ['Ada', 'São Paulo'],
      ['Doe; Jane', 'Porto'],
    ])
  })

  it('keeps CSV values as the text they are', async () => {
    // A postcode or an id keeps its leading zero, and "1.10" is not 1.1.
    const file = new File(
      ['code,price,day\r\n007,1.10,2024-01-02\r\n'],
      'codes.csv',
    )

    const loaded = await readWorkbook(file)

    expect(await readSheetRows(loaded.workbook, 'codes')).toEqual([
      ['code', 'price', 'day'],
      ['007', '1.10', '2024-01-02'],
    ])
  })

  it('reads a TSV', async () => {
    const file = new File(
      ['name\tcity\nAda\tSão Paulo\nGrace\tPorto\n'],
      'clientes.tsv',
    )

    const loaded = await readWorkbook(file)

    expect(await readSheetRows(loaded.workbook, 'clientes')).toEqual(ROWS)
  })

  it('refuses a binary file renamed to .csv', async () => {
    const file = new File(
      [new Uint8Array([0, 1, 2, 255, 254, 0, 7])],
      'data.csv',
    )

    await expect(readWorkbook(file)).rejects.toThrow()
  })

  it('refuses a CSV whose quotes never close', async () => {
    const file = new File(['a,"b\n1,2\n'], 'broken.csv')

    await expect(readWorkbook(file)).rejects.toThrow()
  })

  it('refuses a file whose content is not the format its extension names', async () => {
    const text = 'hello, not a spreadsheet'

    await expect(readWorkbook(new File([text], 'fake.ods'))).rejects.toThrow()
    await expect(readWorkbook(new File([text], 'fake.xlsx'))).rejects.toThrow()
    await expect(readWorkbook(new File([text], 'fake.xlsb'))).rejects.toThrow()
  })
})

describe('buildArchive: SQL output', () => {
  it('writes one .sql per sheet, named after the sheet', async () => {
    const source = makeWorkbook({
      Clients: [
        ['name', 'city'],
        ['Ada', 'Lisbon'],
      ],
      Orders: [['id'], ['A-1']],
    })

    const result = await buildArchive(source, ['Clients', 'Orders'], 'sql')

    expect(result.files).toEqual(['Clients.sql', 'Orders.sql'])

    const sql = strFromU8(entries(result.bytes)['Clients.sql'])
    expect(sql).toContain('CREATE TABLE "Clients" (')
    expect(sql).toContain('INSERT INTO "Clients" ("name", "city")')
    expect(sql).toContain("  ('Ada', 'Lisbon');")
  })

  it('names the table after the sheet, not after the file', async () => {
    const source = makeWorkbook({ 'Jan/Feb': [['a'], ['1']] })

    const sql = strFromU8(
      entries((await buildArchive(source, ['Jan/Feb'], 'sql')).bytes)[
        'Jan-Feb.sql'
      ],
    )

    // The file name is cleaned for the archive; the table keeps the sheet's
    // own name, which SQL can quote.
    expect(sql).toContain('CREATE TABLE "Jan/Feb" (')
  })

  it('carries a value that looks like SQL through as text', async () => {
    const source = makeWorkbook({
      Payload: [['note'], ["x'); DROP TABLE t; --"], ['C:\\temp\\']],
    })

    const sql = strFromU8(
      entries((await buildArchive(source, ['Payload'], 'sql')).bytes)[
        'Payload.sql'
      ],
    )

    expect(sql).toContain("  ('x''); DROP TABLE t; --'),")
    expect(sql).toContain("  ('C:\\temp\\');")
    // The mode line is what keeps the backslash literal in MySQL.
    expect(sql).toContain('NO_BACKSLASH_ESCAPES')
  })

  it('writes only the CREATE TABLE for a sheet holding just a header', async () => {
    const source = makeWorkbook({ Empty: [['a', 'b']] })

    const sql = strFromU8(
      entries((await buildArchive(source, ['Empty'], 'sql')).bytes)[
        'Empty.sql'
      ],
    )

    expect(sql).toContain('CREATE TABLE "Empty" (')
    expect(sql).not.toContain('INSERT INTO')
  })
})
