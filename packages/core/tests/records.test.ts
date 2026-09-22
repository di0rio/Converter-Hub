import { describe, it, expect } from 'vitest'
import {
  DataFormatError,
  parseJson,
  parseJsonl,
  recordsToTable,
  recordsToTables,
  tableToRecords,
  toJsonl,
} from '../src/records/index.js'

describe('recordsToTable', () => {
  it('turns an array of flat objects into columns and rows', () => {
    const table = recordsToTable('people', [
      { id: 1, name: 'Ada' },
      { id: 2, city: 'Porto' },
    ])

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

  it('reaches a list through objects that each hold exactly one property', () => {
    const table = recordsToTable('t', {
      people: { person: [{ a: 1 }, { a: 2 }] },
    })

    expect(table.rows).toEqual([['1'], ['2']])
  })

  it('refuses shapes that are not a table', () => {
    const refuse = (value: unknown) =>
      expect(() => recordsToTable('t', value)).toThrow(DataFormatError)

    refuse({ foo: { bar: { baz: true } } })
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

describe('recordsToTables', () => {
  it('spells a nested group out as group.field columns', () => {
    const [table] = recordsToTables('t', [
      { id: 1, price: { cost: 2, tax: null }, stock: { cost: 3 } },
    ])
    expect(table?.columns).toEqual(['id', 'price.cost', 'price.tax', 'stock.cost'])
    expect(table?.rows).toEqual([['1', '2', null, '3']])
  })

  // ERP exports name each record element apart: <PROD_1>, <PROD_7>, …
  it('reads numbered sibling elements as the records of one list', () => {
    const [table] = recordsToTables('t', {
      items: { ITEM_1: { code: 'a' }, ITEM_7: { code: 'b' } },
    })
    expect(table?.rows).toEqual([['a'], ['b']])
  })

  it('does not take an ordinary record with numbered fields for a list', () => {
    expect(() =>
      recordsToTables('t', { line1: 'street', line2: 'city' }),
    ).toThrow(DataFormatError)
  })

  it('makes one table per list when a document holds several', () => {
    const tables = recordsToTables('export', {
      export: {
        added: { ROW_1: { id: 1, group: { a: 'x' } }, ROW_2: { id: 2 } },
        removed: { ROW_5: { id: 5, date: 'd' } },
      },
    })
    expect(tables.map((t) => t.name)).toEqual(['added', 'removed'])
    expect(tables[0]?.columns).toEqual(['id', 'group.a'])
    expect(tables[0]?.rows).toEqual([['1', 'x'], ['2', null]])
    expect(tables[1]?.rows).toEqual([['5', 'd']])
  })

  it('leaves an empty list out instead of failing the document', () => {
    const tables = recordsToTables('t', {
      added: [{ id: 1 }],
      removed: '',
    })
    expect(tables.map((t) => t.name)).toEqual(['added'])
  })

  it('refuses a document with several lists as a single table', () => {
    expect(() =>
      recordsToTable('t', { a: [{ x: 1 }], b: [{ y: 2 }] }),
    ).toThrow(DataFormatError)
  })
})
