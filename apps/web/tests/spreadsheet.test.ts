import { describe, it, expect } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import * as XLSX from 'xlsx'
import {
  MAX_WORKBOOK_BYTES,
  buildArchive,
  isOversizedWorkbook,
  oversizedWorkbookMessage,
  readPreview,
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

describe('readPreview', () => {
  it('returns at most the rows it was asked for', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => [`row ${i}`])
    const source = makeWorkbook({ Big: [['label'], ...rows] })

    const preview = await readPreview(source.workbook, 'Big', 10)

    expect(preview).toHaveLength(10)
    expect(preview[0]).toEqual(['label'])
  })

  it('is empty for a sheet with no used range', async () => {
    const source = makeWorkbook({ Clients: [['name']] })
    source.workbook.Sheets.Clients = {}

    expect(await readPreview(source.workbook, 'Clients')).toEqual([])
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
    await buildArchive(source, ['A', 'B', 'C'], 'xlsx', (done, total) =>
      seen.push([done, total]),
    )

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
