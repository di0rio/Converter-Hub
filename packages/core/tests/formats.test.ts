import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { detectFormat, SUPPORTED_FORMATS, describeFormat } from '../src/formats/index.js'
import { parseDump, UnsupportedFormatError } from '../src/parser/index.js'
import { countRows } from '../src/tabular/index.js'

function fixture(name: string): string {
  return readFileSync(
    resolve(import.meta.dirname, '../../../examples/' + name + '/sample.sql'),
    'utf-8',
  )
}

describe('detectFormat', () => {
  it('names MySQL from a mysqldump fixture', () => {
    expect(detectFormat(fixture('mysql'))).toEqual({
      format: 'mysql',
      confidence: 'detected',
    })
  })

  it('separates MariaDB from MySQL by its own markers', () => {
    expect(detectFormat(fixture('mariadb'))).toEqual({
      format: 'mariadb',
      confidence: 'detected',
    })
  })

  it('names PostgreSQL from a pg_dump fixture', () => {
    expect(detectFormat(fixture('postgresql'))).toEqual({
      format: 'postgresql',
      confidence: 'detected',
    })
  })

  it('reports plain SQL as assumed rather than as a detection', () => {
    expect(
      detectFormat("CREATE TABLE t (id int);\nINSERT INTO t VALUES (1);"),
    ).toEqual({ format: 'mysql', confidence: 'assumed' })
  })

  it('refuses to name a format for text that is not a dump', () => {
    expect(detectFormat('hello world, not a dump at all')).toEqual({
      format: null,
      confidence: null,
    })
  })

  it('refuses to choose when two engines are equally evidenced', () => {
    // One marker each: a backtick identifier and a COPY terminator.
    const contradictory = ['SELECT `x`;', '\\.'].join('\n')
    expect(detectFormat(contradictory).format).toBeNull()
  })

  it('lets a clear majority win over an incidental marker', () => {
    // A PostgreSQL dump that happens to contain a backtick in a value.
    const postgres = [
      '-- PostgreSQL database dump',
      'SET search_path = public;',
      'CREATE TABLE public.t (id integer, quoted text);',
      "COPY public.t (id, quoted) FROM stdin;",
      '1\ta `backtick` value',
      '\\.',
    ].join('\n')

    expect(detectFormat(postgres).format).toBe('postgresql')
  })
})

describe('parseDump', () => {
  it('rejects a file it cannot place, without leaking the input', () => {
    let thrown: unknown
    try {
      parseDump('hello world, not a dump at all')
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(UnsupportedFormatError)
    expect((thrown as Error).message).toBe('Unsupported database format.')
    expect((thrown as Error).message).not.toContain('hello world')
  })

  it('reads a dump as the format it is told to, skipping detection', () => {
    const dump = parseDump('SET foo = 1;', { format: 'mysql' })
    expect(dump.format).toBe('mysql')
    expect(dump.databases).toHaveLength(0)
  })
})

describe('format descriptors', () => {
  it('lists only formats that have a parser behind them', () => {
    for (const descriptor of SUPPORTED_FORMATS) {
      expect(() => parseDump('', { format: descriptor.id })).not.toThrow()
    }
  })

  it('calls a PostgreSQL grouping a schema and a MySQL one a database', () => {
    expect(describeFormat('postgresql').namespaceLabel).toBe('Schema')
    expect(describeFormat('mysql').namespaceLabel).toBe('Database')
    expect(describeFormat('mariadb').namespaceLabel).toBe('Database')
  })
})

describe('MariaDB', () => {
  const dump = parseDump(fixture('mariadb'))

  it('reads the database and its tables', () => {
    expect(dump.databases.map((d) => d.name)).toEqual(['library_db'])
    expect(dump.databases[0].tables.map((t) => t.name)).toEqual([
      'authors',
      'books',
      'loans',
    ])
  })

  it('reports MariaDB rather than MySQL', () => {
    expect(dump.format).toBe('mariadb')
    expect(dump.databases[0].tables[0].format).toBe('mariadb')
  })

  it('treats a /*M!...*/ comment as the statement it contains', () => {
    expect(dump.preamble).toContain('NOTE_VERBOSITY')
  })

  it('counts rows across engines the same way', () => {
    expect(countRows(dump.databases[0].tables[0])).toBe(3)
    expect(countRows(dump.databases[0].tables[2])).toBe(0)
  })
})
