import { describe, it, expect } from 'vitest'
import { sameRect, snapTarget, SNAP_EDGE } from '@/lib/window-snap'

const BOUNDS = { width: 800, height: 600 }
const middle = { x: 400, y: 300 }

describe('snapTarget', () => {
  it('arms nothing away from the edges', () => {
    expect(snapTarget(middle, BOUNDS)).toBeNull()
  })

  it('arms nothing while the workspace is still unmeasured', () => {
    expect(snapTarget({ x: 0, y: 0 }, { width: 0, height: 0 })).toBeNull()
  })

  it('fills the left half from the left edge', () => {
    expect(snapTarget({ x: SNAP_EDGE - 1, y: 300 }, BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 600,
    })
  })

  it('fills the right half from the right edge', () => {
    expect(snapTarget({ x: BOUNDS.width - 1, y: 300 }, BOUNDS)).toEqual({
      x: 400,
      y: 0,
      width: 400,
      height: 600,
    })
  })

  it('takes a quarter from a corner', () => {
    expect(snapTarget({ x: 2, y: 2 }, BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    })
    expect(snapTarget({ x: BOUNDS.width - 2, y: BOUNDS.height - 2 }, BOUNDS)).toEqual({
      x: 400,
      y: 300,
      width: 400,
      height: 300,
    })
  })

  it('fills the workspace from the top edge between the corners', () => {
    expect(snapTarget({ x: 400, y: 4 }, BOUNDS)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    })
  })

  it('arms nothing along the bottom edge, which owns no zone', () => {
    expect(snapTarget({ x: 400, y: BOUNDS.height - 1 }, BOUNDS)).toBeNull()
  })

  it('arms nothing once the pointer has left the workspace', () => {
    expect(snapTarget({ x: -200, y: 300 }, BOUNDS)).toBeNull()
    expect(snapTarget({ x: 400, y: 900 }, BOUNDS)).toBeNull()
  })
})

describe('sameRect', () => {
  it('treats two null zones as unchanged', () => {
    expect(sameRect(null, null)).toBe(true)
  })

  it('separates a zone from no zone', () => {
    expect(sameRect({ x: 0, y: 0, width: 1, height: 1 }, null)).toBe(false)
  })

  it('compares by value, so a re-computed zone does not count as a change', () => {
    const a = { x: 0, y: 0, width: 400, height: 600 }
    expect(sameRect(a, { ...a })).toBe(true)
    expect(sameRect(a, { ...a, width: 401 })).toBe(false)
  })
})
