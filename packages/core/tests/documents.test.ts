import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { elasticsearchParser } from '../src/parser/elasticsearch/index.js'
import { neo4jParser } from '../src/parser/neo4j/index.js'
import { allFormats } from '../src/formats/index.js'
import { tableFromDocuments } from '../src/parser/shared/documents.js'
import { toTabular, countRows } from '../src/tabular/index.js'
import type { SqlDump } from '../src/types/index.js'

function fixture(id: string): string {
  return readFileSync(
    resolve(import.meta.dirname, '../../../examples/' + id + '/sample.sql'),
    'utf-8',
  )
}

function table(dump: SqlDump, name: string) {
  const found = dump.databases[0]?.tables.find((t) => t.name === name)
  if (!found) throw new Error('no table ' + name)
  return found
}

describe('parseElasticsearchDump', () => {
  const dump = elasticsearchParser.parse(fixture('elasticsearch'))

  it('makes one table per index', () => {
    expect(dump.databases[0]?.tables.map((t) => t.name)).toEqual([
      'customers',
      'orders',
    ])
  })

  it('takes the row from _source and keeps the id beside it', () => {
    const row = toTabular(table(dump, 'customers'))
    expect(row.columns).toContain('_id')
    expect(row.rows[0]?.[row.columns.indexOf('_id')]).toBe('1')
  })

  it('columns are the union of the keys the documents use', () => {
    // address and note appear only in the third document.
    expect(toTabular(table(dump, 'customers')).columns).toEqual([
      'full_name',
      'email',
      'tags',
      '_id',
      'address',
      'note',
    ])
  })

  it('keeps a nested object and an array as their JSON text', () => {
    const rows = toTabular(table(dump, 'customers')).rows
    expect(rows[0]?.[2]).toBe('["vip","early"]')
    expect(rows[2]?.[4]).toBe('{"city":"São Paulo"}')
  })

  it('decodes null, booleans and UTF-8', () => {
    expect(toTabular(table(dump, 'customers')).rows[1]?.[1]).toBeNull()
    expect(toTabular(table(dump, 'customers')).rows[2]?.[0]).toBe('Zoë Example')
    expect(toTabular(table(dump, 'orders')).rows[0]?.[2]).toBe('true')
  })

  it('escapes a quote in a value so the generated INSERT survives it', () => {
    expect(toTabular(table(dump, 'orders')).rows[1]?.[0]).toBe(
      "O'Brien pattern washers",
    )
  })

  it('counts documents as rows', () => {
    expect(countRows(table(dump, 'customers'))).toBe(3)
    expect(countRows(table(dump, 'orders'))).toBe(2)
  })

  it('ignores a line that names no index', () => {
    const parsed = elasticsearchParser.parse(
      '{"_source":{"a":1}}\n{"_index":"kept","_source":{"a":2}}',
    )
    expect(parsed.databases[0]?.tables.map((t) => t.name)).toEqual(['kept'])
  })
})

describe('parseNeo4jDump', () => {
  const dump = neo4jParser.parse(fixture('neo4j'))

  it('makes one table per node label', () => {
    expect(dump.databases[0]?.tables.map((t) => t.name)).toEqual([
      'Person',
      'Product',
    ])
  })

  it('reads properties as columns, unioned across nodes', () => {
    expect(toTabular(table(dump, 'Person')).columns).toEqual([
      'id',
      'name',
      'email',
      'city',
      'note',
      'tags',
    ])
  })

  it('decodes Cypher scalars: numbers, booleans, null and both quote styles', () => {
    const people = toTabular(table(dump, 'Person')).rows
    expect(people[0]?.[0]).toBe('1')
    expect(people[1]?.[2]).toBeNull()
    // Cypher accepts double quotes too.
    expect(people[2]?.[1]).toBe('Zoë Example')
    expect(toTabular(table(dump, 'Product')).rows[0]?.[3]).toBe('true')
  })

  it('keeps a semicolon inside a value from ending the statement', () => {
    expect(toTabular(table(dump, 'Person')).rows[2]?.[4]).toBe(
      'Prefers email; not phone.',
    )
  })

  it('escapes a quote in a value', () => {
    expect(toTabular(table(dump, 'Product')).rows[1]?.[1]).toBe(
      "O'Brien pattern washers",
    )
  })

  it('keeps a list property as its source text rather than a column each', () => {
    expect(toTabular(table(dump, 'Person')).rows[2]?.[5]).toBe(
      "['vip', 'early']",
    )
  })

  it('does not turn a relationship into a table', () => {
    expect(dump.databases[0]?.tables.map((t) => t.name)).not.toContain('BOUGHT')
  })

  it('counts the relationships it dropped and says so in the dump', () => {
    expect(dump.preamble).toContain('2 relationship(s)')
    expect(dump.preamble).toContain('not extracted')
  })

  it('says nothing when the graph has no relationships to drop', () => {
    const parsed = neo4jParser.parse(
      "CREATE (a:Person {id: 1, name: 'Alice'});",
    )
    expect(parsed.preamble).toBe('')
  })

  it('counts nodes as rows', () => {
    expect(countRows(table(dump, 'Person'))).toBe(3)
    expect(countRows(table(dump, 'Product'))).toBe(2)
  })
})

describe('tableFromDocuments', () => {
  it('treats a key named after an Object.prototype member as data', () => {
    // Shared by MongoDB, Elasticsearch and Neo4j, so a prototype-chain read
    // here would break all three. A record may carry a field called toString
    // or constructor; a record missing it must give null, not the inherited
    // function.
    const built = tableFromDocuments('items', 'db', 'mongodb', [
      { sku: 'A1', toString: 'custom', constructor: 'c' },
      { sku: 'A2' },
    ])

    expect(toTabular(built).rows).toEqual([
      ['A1', 'custom', 'c'],
      ['A2', null, null],
    ])
  })
})

describe('the lossy flag', () => {
  it('is set exactly where reading cannot represent the source', () => {
    expect(
      allFormats()
        .filter((f) => f.lossy === true)
        .map((f) => f.id)
        .sort(),
    ).toEqual(['cockroachdb', 'neo4j'])
  })

  it('always comes with the note the app shows', () => {
    for (const format of allFormats().filter((f) => f.lossy === true)) {
      expect(format.note, format.label).toBeTruthy()
    }
  })
})
