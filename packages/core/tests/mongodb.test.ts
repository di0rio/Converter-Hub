import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mongodbParser } from '../src/parser/mongodb/index.js'
import { toTabular, countRows } from '../src/tabular/index.js'

const dump = mongodbParser.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../examples/mongodb/sample.sql'),
    'utf-8',
  ),
)

function table(name: string) {
  const found = dump.databases[0]?.tables.find((t) => t.name === name)
  if (!found) throw new Error('no collection ' + name)
  return found
}

describe('parseMongoDump', () => {
  it('names the database from the use statement, not from the filename', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['shop'])
  })

  it('finds every collection, including one named through getCollection', () => {
    expect(dump.databases[0]?.tables.map((t) => t.name)).toEqual([
      'customers',
      'orders',
      'audit_log',
    ])
  })

  it('columns are the union of the keys the documents use', () => {
    // address and note appear only in the third document, tags only in the
    // first. Taking the first document's shape would lose three columns.
    expect(toTabular(table('customers')).columns).toEqual([
      '_id',
      'full_name',
      'email',
      'tags',
      'address',
      'note',
    ])
  })

  it('fills a key a document does not carry with null', () => {
    expect(toTabular(table('customers')).rows[1]).toEqual([
      '2',
      'Bob Example',
      null,
      null,
      null,
      null,
    ])
  })

  it('keeps a nested object as its JSON text rather than flattening it', () => {
    expect(toTabular(table('customers')).rows[2]?.[4]).toBe(
      '{"city":"São Paulo"}',
    )
  })

  it('keeps an array as its JSON text', () => {
    expect(toTabular(table('customers')).rows[0]?.[3]).toBe('["vip","early"]')
  })

  it('preserves UTF-8 and an embedded semicolon', () => {
    const rows = toTabular(table('customers')).rows
    expect(rows[2]?.[1]).toBe('Zoë Example')
    expect(rows[2]?.[5]).toBe('Prefers email; not phone.')
  })

  it('escapes a quote in a value so the generated INSERT survives it', () => {
    expect(toTabular(table('orders')).rows[1]?.[2]).toBe(
      "O'Brien pattern washers",
    )
  })

  it('counts documents as rows', () => {
    expect(countRows(table('customers'))).toBe(3)
    expect(countRows(table('orders'))).toBe(2)
    expect(countRows(table('audit_log'))).toBe(1)
  })

  it('declares every generated column with a type, so the SQL is runnable', () => {
    expect(table('orders').createStatement).toContain('"total" text')
    expect(table('orders').createStatement).not.toMatch(/"total"\s*[,)]/)
  })

  it('skips a call whose argument is JavaScript rather than JSON', () => {
    // Unquoted keys and ObjectId() are script, not data. Half-reading them
    // would invent values; skipping loses nothing that was ever readable.
    const parsed = mongodbParser.parse(
      'use x;\ndb.a.insertMany([{ _id: ObjectId("aaa"), n: 1 }]);\n' +
        'db.b.insertMany([{ "_id": 1 }]);',
    )
    expect(parsed.databases[0]?.tables.map((t) => t.name)).toEqual(['b'])
  })

  it('yields no database at all when nothing parses', () => {
    expect(mongodbParser.parse('use x;').databases).toEqual([])
  })
})
