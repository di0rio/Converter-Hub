import { describe, it, expect } from 'vitest'
import {
  DataFormatError,
  parseJson,
  parseJsonl,
  recordsToTable,
  tableToRecords,
  toJsonl,
} from '../src/records/index.js'

describe('recordsToTable', () => {
  it('turns an array of flat objects into columns and rows', () => {
    const table = recordsToTable('people', [
      { id: 1, name: 'Ada' },
      { id: 2, city: 'Porto' },
    ])

    // Columns in the order they are first seen; a missing field is NULL.
    expect(table.columns).toEqual(['id', 'name', 'city'])
    expect(table.rows).toEqual([
      ['1', 'Ada', null],
      ['2', null, 'Porto'],
    ])
  })

  it('writes numbers and booleans as text and keeps null as null', () => {
    const table = recordsToTable('t', [{ n: 1.5, ok: true, gone: null }])

    expect(table.rows).toEqual([['1.5', 'true', null]])
  })

  it('reads the collection out of an object holding exactly one array', () => {
    const table = recordsToTable('t', { items: [{ a: 1 }, { a: 2 }] })

    expect(table.columns).toEqual(['a'])
    expect(table.rows).toEqual([['1'], ['2']])
  })

  it('refuses shapes that are not a table, rather than flattening them', () => {
    const refuse = (value: unknown) =>
      expect(() => recordsToTable('t', value)).toThrow(DataFormatError)

    refuse({ foo: { bar: { baz: true } } })
    refuse([{ a: { nested: 1 } }])
    refuse([{ a: [1, 2] }])
    refuse([1, 2, 3])
    refuse([{ a: 1 }, 'text'])
    refuse({ a: [{ x: 1 }], b: [{ y: 2 }] })
    refuse('just a string')
    refuse([])
  })

  it('never puts values from the file in its message', () => {
    expect(() =>
      recordsToTable('t', [{ token: { secret: 'secret-value' } }]),
    ).not.toThrow(/secret/)
  })
})

describe('tableToRecords', () => {
  it('keys each row by a usable header', () => {
    const records = tableToRecords({
      name: 't',
      columns: ['name', '', 'name'],
      rows: [
        ['Ada', 'x', 'y'],
        ['Grace', null, 'z'],
      ],
    })

    expect(records).toEqual([
      { name: 'Ada', column_2: 'x', name_2: 'y' },
      { name: 'Grace', column_2: null, name_2: 'z' },
    ])
  })
})

describe('parseJson', () => {
  it('reads JSON', () => {
    expect(parseJson('{"a":[1,true,null]}')).toEqual({ a: [1, true, null] })
  })

  it('refuses invalid JSON without quoting it', () => {
    expect(() => parseJson('{"token": secret-value')).toThrow(DataFormatError)
    expect(() => parseJson('{"token": secret-value')).not.toThrow(/secret/)
  })
})

describe('parseJsonl', () => {
  it('reads one value per line, skipping blank lines', () => {
    expect(parseJsonl('{"a":1}\r\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('names the line that failed, and nothing it held', () => {
    const run = () => parseJsonl('{"a":1}\n\n{"token": secret-value}\n')

    expect(run).toThrow(DataFormatError)
    expect(run).toThrow(/line 3/)
    expect(run).not.toThrow(/secret/)
  })
})

describe('toJsonl', () => {
  it('writes one compact value per line and reads back the same', () => {
    const values = [{ a: 1, b: 'x\ny' }, { a: null }]
    const text = toJsonl(values)

    expect(text).toBe('{"a":1,"b":"x\\ny"}\n{"a":null}\n')
    expect(parseJsonl(text)).toEqual(values)
  })
})
