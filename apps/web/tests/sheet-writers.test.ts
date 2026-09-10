import { describe, it, expect } from 'vitest'
import { toJson, toMarkdown } from '@/lib/sheet-writers'

function table(columns: string[], rows: string[][]) {
  return { name: 'sheet', columns, rows }
}

describe('toJson', () => {
  it('turns each row into an object keyed by the header', () => {
    const json = toJson(
      table(
        ['name', 'age'],
        [
          ['Ada', '36'],
          ['Grace', '45'],
        ],
      ),
    )

    expect(JSON.parse(json)).toEqual([
      { name: 'Ada', age: '36' },
      { name: 'Grace', age: '45' },
    ])
  })

  it('is indented with two spaces', () => {
    expect(toJson(table(['a'], [['1']]))).toBe('[\n  {\n    "a": "1"\n  }\n]')
  })

  it('names empty and repeated headers the way every writer does', () => {
    const json = toJson(table(['name', '', 'name'], [['a', 'b', 'c']]))

    expect(JSON.parse(json)).toEqual([
      { name: 'a', column_2: 'b', name_2: 'c' },
    ])
  })

  it('gives every object the same keys, however long its row', () => {
    const json = toJson(table(['a', 'b'], [['1'], ['1', '2', '3']]))

    expect(JSON.parse(json)).toEqual([
      { a: '1', b: '', column_3: '' },
      { a: '1', b: '2', column_3: '3' },
    ])
  })

  it('keeps values exactly as they are', () => {
    // JSON is read by programs, not reopened by a spreadsheet, so a prefix
    // would only corrupt the value.
    const json = toJson(table(['v'], [['=1+1'], ['say "hi"']]))

    expect(JSON.parse(json)).toEqual([{ v: '=1+1' }, { v: 'say "hi"' }])
  })

  it('keeps a header named __proto__ as an ordinary key', () => {
    const json = toJson(table(['__proto__'], [['x']]))
    const [row] = JSON.parse(json)

    expect(Object.keys(row)).toEqual(['__proto__'])
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('is an empty array for a sheet holding only a header', () => {
    expect(toJson(table(['a', 'b'], []))).toBe('[]')
  })

  it('is an empty array for an empty sheet', () => {
    expect(toJson(table([], []))).toBe('[]')
  })
})

describe('toMarkdown', () => {
  it('writes a GFM table', () => {
    expect(toMarkdown(table(['Name', 'Age'], [['John', '30']]))).toBe(
      '| Name | Age |\n| --- | --- |\n| John | 30 |\n',
    )
  })

  it('escapes a pipe so it cannot open a column', () => {
    expect(toMarkdown(table(['v'], [['a|b']]))).toContain('| a\\|b |')
  })

  it('turns a line break into <br>', () => {
    const md = toMarkdown(table(['v'], [['a\nb'], ['c\r\nd']]))

    expect(md).toContain('| a<br>b |')
    expect(md).toContain('| c<br>d |')
  })

  it('escapes markup so a cell cannot inject HTML', () => {
    const md = toMarkdown(table(['v'], [['<script>x</script> & co']]))

    expect(md).toContain('| &lt;script&gt;x&lt;/script&gt; &amp; co |')
    expect(md).not.toContain('<script>')
  })

  it('neutralises a value that would read as a formula', () => {
    expect(toMarkdown(table(['v'], [['=1+1']]))).toContain("| '=1+1 |")
  })

  it('names empty and repeated headers the way every writer does', () => {
    expect(toMarkdown(table(['name', '', 'name'], []))).toBe(
      '| name | column_2 | name_2 |\n| --- | --- | --- |\n',
    )
  })

  it('fills a short row so every line has the same columns', () => {
    expect(toMarkdown(table(['a', 'b'], [['1']]))).toBe(
      '| a | b |\n| --- | --- |\n| 1 |  |\n',
    )
  })

  it('writes the header and separator for a sheet holding only a header', () => {
    expect(toMarkdown(table(['a'], []))).toBe('| a |\n| --- |\n')
  })

  it('is empty for an empty sheet', () => {
    expect(toMarkdown(table([], []))).toBe('')
  })
})
