import { describe, it, expect } from 'vitest'
import { HUB_NAME, HUB_TAGLINE, TOOLS, findTool } from '@/lib/tools'

describe('tool registry', () => {
  it('lists every tool the hub advertises', () => {
    // The hub must never show a tool that has no page behind it. Both entries
    // here are implemented; a third should not be added until its route is.
    expect(TOOLS.map((tool) => tool.id)).toEqual(['spreadsheet', 'sql'])
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

  it('lists every format the spreadsheet tool writes', () => {
    expect(findTool('spreadsheet').output).toEqual([
      'XLSX',
      'CSV',
      'JSON',
      'Markdown',
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
