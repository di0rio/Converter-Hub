import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { HUB_NAME, HUB_TAGLINE, TOOLS, findTool } from '@/lib/tools'
import {
  IMAGE_INPUTS,
  IMAGE_OUTPUTS,
  MARKDOWN_INPUTS,
  MARKDOWN_OUTPUTS,
  formatLabels,
} from '@/lib/formats'
import { DATA_INPUTS, DATA_OUTPUTS } from '@/lib/data-convert'

describe('tool registry', () => {
  it('lists every tool the hub advertises', () => {
    // The hub must never show a tool that has no page behind it. Every entry
    // here is implemented; a new one should not be added until its route is.
    expect(TOOLS.map((tool) => tool.id)).toEqual([
      'spreadsheet',
      'sql',
      'data',
      'markdown',
      'json-to-typescript',
      'image',
    ])
  })

  it('advertises exactly the formats the image tool converts', () => {
    const image = findTool('image')
    expect(image.source).toEqual(formatLabels(IMAGE_INPUTS))
    expect(image.output).toEqual(formatLabels(IMAGE_OUTPUTS))
    // Read where the browser decodes it; canvas cannot write it.
    expect(image.output).not.toContain('AVIF')
  })

  it('advertises exactly the formats the Markdown tool converts', () => {
    const markdown = findTool('markdown')
    expect(markdown.source).toEqual(formatLabels(MARKDOWN_INPUTS))
    expect(markdown.output).toEqual(formatLabels(MARKDOWN_OUTPUTS))
  })

  it('has a page behind every tool it lists', () => {
    for (const tool of TOOLS) {
      const page = join(__dirname, '..', 'app', tool.href.slice(1), 'page.tsx')
      expect(existsSync(page), `${tool.href} has no page`).toBe(true)
    }
  })

  // The card cannot promise a format the tool does not read or write: both
  // lists come from the same constants the converter itself uses.
  it('advertises exactly the formats the data tool converts', () => {
    const data = findTool('data')
    expect(data.source).toEqual(formatLabels(DATA_INPUTS))
    expect(data.output).toEqual(formatLabels(DATA_OUTPUTS))
  })

  // One tool for both kinds of database input: a dump is a script, a SQLite
  // file is a database, and the tool tells them apart by content.
  it('reads SQL dumps and database files in the one SQL tool', () => {
    const sql = findTool('sql')
    expect(sql.source).toEqual([
      'SQL dumps',
      'SQLite databases',
      'Firebird databases',
    ])
    expect(sql.output).toEqual([
      'SQL',
      'CSV',
      'XLSX',
      'JSON',
      'JSON Lines',
      'Markdown',
    ])
  })

  it('gives every tool a unique id and a unique route', () => {
    const ids = TOOLS.map((tool) => tool.id)
    const hrefs = TOOLS.map((tool) => tool.href)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(hrefs).size).toBe(hrefs.length)
  })

  it('describes every tool completely enough to render a card', () => {
    for (const tool of TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0)
      expect(tool.tagline.length).toBeGreaterThan(0)
      expect(tool.description.length).toBeGreaterThan(0)
      expect(tool.heading.length).toBeGreaterThan(0)
      expect(tool.source.length).toBeGreaterThan(0)
      expect(tool.output.length).toBeGreaterThan(0)
      expect(typeof tool.Icon).toBe('object')
    }
  })

  it('lists every format the spreadsheet tool reads', () => {
    expect(findTool('spreadsheet').source).toEqual([
      'XLSX',
      'XLSM',
      'XLS',
      'XLSB',
      'ODS',
      'CSV',
      'TSV',
    ])
  })

  it('lists every format the spreadsheet tool writes', () => {
    expect(findTool('spreadsheet').output).toEqual([
      'XLSX',
      'CSV',
      'JSON',
      'Markdown',
      'SQL',
    ])
  })

  it('routes every tool from the site root', () => {
    for (const tool of TOOLS) {
      expect(tool.href.startsWith('/')).toBe(true)
    }
  })

  it('finds a tool by id', () => {
    expect(findTool('sql').name).toBe('SQL')
    expect(findTool('spreadsheet').name).toBe('Spreadsheets')
  })

  it('fails loudly on an id that has no tool', () => {
    // A miss is a wiring mistake in this repo, never a user input, so it must
    // not quietly render an empty page.
    expect(() => findTool('pdf')).toThrow(/Unknown tool/)
  })

  it('names the product once, for every surface to reuse', () => {
    expect(HUB_NAME).toBe('Converter Hub')
    expect(HUB_TAGLINE).toMatch(/nothing is uploaded/i)
  })
})
