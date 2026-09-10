import { describe, it, expect } from 'vitest'
import { parseCsv, detectDelimiter } from '../src/csv/index.js'
import { toCsv } from '../src/generator/writers.js'
import { DataFormatError } from '../src/records/index.js'

describe('parseCsv', () => {
  it('reads rows of fields', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads quoted fields holding the delimiter, quotes and line breaks', () => {
    expect(
      parseCsv('name,note\r\n"Doe, Jane","say ""hi"""\r\n"a\r\nb",x\r\n'),
    ).toEqual([
      ['name', 'note'],
      ['Doe, Jane', 'say "hi"'],
      ['a\r\nb', 'x'],
    ])
  })

  it('takes the delimiter it is given', () => {
    expect(parseCsv('a;b\n"1;2";3', { delimiter: ';' })).toEqual([
      ['a', 'b'],
      ['1;2', '3'],
    ])
    expect(parseCsv('a\tb\n1\t2', { delimiter: '\t' })).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('ignores a byte order mark and keeps unicode', () => {
    expect(parseCsv('\ufeffcidade\nSão Paulo\n東京')).toEqual([
      ['cidade'],
      ['São Paulo'],
      ['東京'],
    ])
  })

  it('keeps empty fields, including a trailing one', () => {
    expect(parseCsv('a,,c\n1,\n')).toEqual([
      ['a', '', 'c'],
      ['1', ''],
    ])
  })

  it('skips blank lines and does not invent a row after the last newline', () => {
    expect(parseCsv('a\n\n1\r\n\r\n')).toEqual([['a'], ['1']])
  })

  it('reads a lone carriage return as a line break', () => {
    expect(parseCsv('a\rb')).toEqual([['a'], ['b']])
  })

  it('refuses a quote that never closes, quoting nothing from the file', () => {
    expect(() => parseCsv('a,"secret-value\n1,2')).toThrow(DataFormatError)
    expect(() => parseCsv('a,"secret-value\n1,2')).not.toThrow(/secret/)
  })

  it('reads back what the CSV writer wrote', () => {
    const table = {
      name: 't',
      columns: ['name', 'note'],
      rows: [
        ['Doe, Jane', 'line\nbreak'],
        ['Ada', 'say "hi"'],
      ],
    }

    for (const delimiter of [',', ';', '\t'] as const) {
      expect(parseCsv(toCsv(table, { delimiter }), { delimiter })).toEqual([
        table.columns,
        ...table.rows,
      ])
    }
  })
})

describe('detectDelimiter', () => {
  it('picks the delimiter the header line uses most', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t')
  })

  it('does not count a delimiter inside quotes', () => {
    expect(detectDelimiter('"a,b,c";d\n1;2')).toBe(';')
  })

  it('falls back to a comma for a single column', () => {
    expect(detectDelimiter('name\nAda')).toBe(',')
  })
})
