import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { unzipSync } from 'fflate'
import { DataFormatError, recordsToTable } from '@sql-extractor/core'
import {
  DATA_INPUTS,
  DATA_OUTPUTS,
  convertData,
  readData,
  writeData,
} from '@/lib/data-convert'

/** Synthetic fixtures: the same two invented rows in every input format. */
const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '..', '..', '..', 'examples', 'data', name),
    'utf8',
  )

const PEOPLE = [
  ['1', 'Ada Lovelace', 'London'],
  ['2', 'Grace Hopper', 'New York, NY'],
]

const people = [
  { id: 1, name: 'Ada Lovelace', city: 'London' },
  { id: 2, name: 'Grace Hopper', city: 'New York, NY' },
]

const text = (content: string | Uint8Array) =>
  typeof content === 'string' ? content : new TextDecoder().decode(content)

describe('readData', () => {
  it.each(DATA_INPUTS)(
    'reads the %s fixture into the same table',
    async (format) => {
      const value = await readData(fixture(`people.${format}`), format)

      expect(recordsToTable('people', value).rows).toEqual(PEOPLE)
    },
  )

  it('detects a semicolon-separated CSV', async () => {
    const value = await readData('id;name\n1;"Doe; Jane"\n', 'csv')

    expect(value).toEqual([{ id: '1', name: 'Doe; Jane' }])
  })

  it('refuses invalid YAML without quoting it', async () => {
    const run = () => readData('key: [unclosed, secret-value', 'yaml')

    await expect(run()).rejects.toThrow(DataFormatError)
    await expect(run()).rejects.not.toThrow(/secret/)
  })

  it('refuses a YAML alias bomb instead of expanding it', async () => {
    const bomb = [
      'a: &a ["x","x","x","x","x","x","x","x","x"]',
      'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'd: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'e: [*d,*d,*d,*d,*d,*d,*d,*d,*d]',
    ].join('\n')

    await expect(readData(bomb, 'yaml')).rejects.toThrow(DataFormatError)
  })
})

describe('writeData', () => {
  it.each(DATA_OUTPUTS)('writes %s from a table of records', async (format) => {
    const content = await writeData(people, format, 'people')

    expect(content.length).toBeGreaterThan(0)
  })

  it('writes CSV, quoting what needs it', async () => {
    const csv = text(await writeData(people, 'csv', 'people'))

    expect(csv.replace(/^\ufeff/, '')).toBe(
      'id,name,city\r\n1,Ada Lovelace,London\r\n2,Grace Hopper,"New York, NY"\r\n',
    )
  })

  it('writes CSV with the delimiter it is given, and TSV with tabs', async () => {
    const semicolons = text(
      await writeData(people, 'csv', 'people', { delimiter: ';' }),
    )
    const tabs = text(await writeData(people, 'tsv', 'people'))

    expect(semicolons).toContain('2;Grace Hopper;New York, NY')
    expect(tabs).toContain('2\tGrace Hopper\tNew York, NY')
  })

  it('writes JSON, JSON Lines and YAML that read back as the same data', async () => {
    const json = text(await writeData(people, 'json', 'people'))
    const jsonl = text(await writeData(people, 'jsonl', 'people'))
    const yaml = text(await writeData(people, 'yaml', 'people'))

    expect(JSON.parse(json)).toEqual(people)
    expect(
      jsonl
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual(people)
    expect(parseYaml(yaml)).toEqual(people)
  })

  it('writes a Markdown table, SQL inserts and a workbook', async () => {
    const markdown = text(await writeData(people, 'markdown', 'people'))
    const sql = text(await writeData(people, 'sql', 'people'))
    const xlsx = (await writeData(people, 'xlsx', 'people')) as Uint8Array

    expect(markdown).toContain('| id | name | city |')
    expect(sql).toContain('CREATE TABLE "people"')
    expect(sql).toContain("('2', 'Grace Hopper', 'New York, NY')")
    expect(Object.keys(unzipSync(xlsx))).toContain('xl/workbook.xml')
  })

  it('keeps a nested document for JSON and YAML, and refuses to flatten it into a table', async () => {
    const nested = JSON.parse(fixture('nested.json'))

    expect(JSON.parse(text(await writeData(nested, 'json', 'nested')))).toEqual(
      nested,
    )
    expect(parseYaml(text(await writeData(nested, 'yaml', 'nested')))).toEqual(
      nested,
    )
    for (const format of [
      'csv',
      'tsv',
      'markdown',
      'sql',
      'xlsx',
      'jsonl',
    ] as const) {
      await expect(writeData(nested, format, 'nested')).rejects.toThrow(
        DataFormatError,
      )
    }
  })
})

describe('convertData', () => {
  it('names the file after the input and types it by the output', async () => {
    const file = await convertData(
      fixture('people.json'),
      'json',
      'csv',
      'people',
    )

    expect(file.filename).toBe('people.csv')
    expect(file.type).toBe('text/csv')
    expect(text(file.bytes)).toContain('Grace Hopper')
  })

  it('offers every output for every input', () => {
    expect(DATA_OUTPUTS).toEqual([
      'csv',
      'tsv',
      'json',
      'jsonl',
      'yaml',
      'markdown',
      'sql',
      'xlsx',
    ])
  })
})
