import { describe, it, expect } from 'vitest'
import { normalizeColumns } from '../src/tabular/index.js'
import { neutralizeFormula } from '../src/generator/index.js'

describe('normalizeColumns', () => {
  it('names an empty header after its position', () => {
    expect(normalizeColumns(['id', '', '  '])).toEqual([
      'id',
      'column_2',
      'column_3',
    ])
  })

  it('suffixes a repeated name, ignoring case', () => {
    expect(normalizeColumns(['name', 'Name', 'name'])).toEqual([
      'name',
      'Name_2',
      'name_3',
    ])
  })

  it('never produces a name twice, even when a suffix is already taken', () => {
    expect(normalizeColumns(['a', 'a_2', 'a'])).toEqual(['a', 'a_2', 'a_3'])
    expect(normalizeColumns(['column_2', ''])).toEqual([
      'column_2',
      'column_2_2',
    ])
  })

  it('trims the whitespace around a name', () => {
    expect(normalizeColumns(['  city '])).toEqual(['city'])
  })

  it('widens to cover rows longer than the header', () => {
    expect(normalizeColumns(['a'], 3)).toEqual(['a', 'column_2', 'column_3'])
  })
})

describe('neutralizeFormula', () => {
  it('prefixes a value a spreadsheet would read as a formula', () => {
    expect(neutralizeFormula('=1+1')).toBe("'=1+1")
    expect(neutralizeFormula('+1')).toBe("'+1")
    expect(neutralizeFormula('-1')).toBe("'-1")
    expect(neutralizeFormula('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(neutralizeFormula('\tx')).toBe("'\tx")
  })

  it('leaves anything else alone', () => {
    expect(neutralizeFormula('plain')).toBe('plain')
    expect(neutralizeFormula('a=b')).toBe('a=b')
    expect(neutralizeFormula('')).toBe('')
  })
})
