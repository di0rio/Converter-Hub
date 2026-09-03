import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  containWindow,
  frontWindow,
  usePreviewWindows,
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  type PreviewWindow,
} from '@/hooks/use-preview-windows'

const BOUNDS = { width: 800, height: 600 }

const win = (patch: Partial<PreviewWindow> = {}): PreviewWindow => ({
  id: 'w1',
  tableName: 'users',
  x: 0,
  y: 0,
  width: WINDOW_DEFAULT_WIDTH,
  height: WINDOW_DEFAULT_HEIGHT,
  z: 1,
  minimized: false,
  restore: null,
  ...patch,
})

describe('containWindow', () => {
  it('leaves a window that already fits untouched', () => {
    const inside = win({ x: 10, y: 20 })
    expect(containWindow(inside, BOUNDS)).toEqual(inside)
  })

  it('pulls a window back from past the right and bottom edges', () => {
    const contained = containWindow(win({ x: 5000, y: 5000 }), BOUNDS)
    expect(contained.x).toBe(BOUNDS.width - WINDOW_DEFAULT_WIDTH)
    expect(contained.y).toBe(BOUNDS.height - WINDOW_DEFAULT_HEIGHT)
  })

  it('pulls a window back from negative coordinates', () => {
    const contained = containWindow(win({ x: -5000, y: -5000 }), BOUNDS)
    expect(contained.x).toBe(0)
    expect(contained.y).toBe(0)
  })

  it('caps the size to the workspace and keeps the origin visible', () => {
    const contained = containWindow(win({ width: 9999, height: 9999 }), BOUNDS)
    expect(contained.width).toBe(BOUNDS.width)
    expect(contained.height).toBe(BOUNDS.height)
    expect(contained.x).toBe(0)
    expect(contained.y).toBe(0)
  })

  it('never shrinks a window below its minimum', () => {
    const contained = containWindow(win({ width: 1, height: 1 }), BOUNDS)
    expect(contained.width).toBe(WINDOW_MIN_WIDTH)
    expect(contained.height).toBe(WINDOW_MIN_HEIGHT)
  })

  it('leaves geometry alone while the workspace is still unmeasured', () => {
    const far = win({ x: 5000, y: 5000 })
    expect(containWindow(far, { width: 0, height: 0 })).toEqual(far)
  })
})

describe('usePreviewWindows', () => {
  it('starts with nothing open', () => {
    const { result } = renderHook(() => usePreviewWindows())
    expect(result.current.windows).toEqual([])
  })

  it('opens a window for a table', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))

    expect(result.current.windows).toHaveLength(1)
    expect(result.current.windows[0].tableName).toBe('users')
  })

  it('cascades each new window instead of stacking them exactly', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))
    act(() => result.current.openWindow('products'))

    const [a, b, c] = result.current.windows
    expect([a.x, b.x, c.x]).toEqual([0, 26, 52])
    expect([a.y, b.y, c.y]).toEqual([0, 26, 52])
  })

  it('raises an already-open table instead of opening it twice', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))
    act(() => result.current.openWindow('users'))

    expect(result.current.windows).toHaveLength(2)
    expect(frontWindow(result.current.windows)!.tableName).toBe('users')
  })

  it('keeps insertion order in the array so no DOM node ever moves', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setMode('windows'))
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))
    act(() => result.current.focusWindow(result.current.windows[0].id))

    expect(result.current.windows.map((w) => w.tableName)).toEqual([
      'users',
      'orders',
    ])
  })

  it('places a dropped window at the drop point', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users', { x: 120, y: 90 }))

    expect(result.current.windows[0]).toMatchObject({ x: 120, y: 90 })
  })

  it('contains a window dropped outside the workspace', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users', { x: 5000, y: 5000 }))

    const opened = result.current.windows[0]
    expect(opened.x).toBe(BOUNDS.width - WINDOW_DEFAULT_WIDTH)
    expect(opened.y).toBe(BOUNDS.height - WINDOW_DEFAULT_HEIGHT)
  })

  it('brings a window to the front on focus', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))

    const users = result.current.windows[0]
    act(() => result.current.focusWindow(users.id))

    expect(frontWindow(result.current.windows)!.tableName).toBe('users')
  })

  it('keeps the order when focusing the front-most window', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))

    const before = result.current.windows
    act(() => result.current.focusWindow(before.at(-1)!.id))
    expect(result.current.windows).toBe(before)
  })

  it('closes one window and leaves the rest', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))

    act(() => result.current.closeWindow(result.current.windows[0].id))

    expect(result.current.windows.map((w) => w.tableName)).toEqual(['orders'])
  })

  it('closes every window at once', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))

    act(() => result.current.closeAllWindows())

    expect(result.current.windows).toEqual([])
  })

  it('clamps a move to the workspace', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users'))

    const id = result.current.windows[0].id
    act(() => result.current.updateWindow(id, { x: 5000, y: 5000 }))

    expect(result.current.windows[0]).toMatchObject({
      x: BOUNDS.width - WINDOW_DEFAULT_WIDTH,
      y: BOUNDS.height - WINDOW_DEFAULT_HEIGHT,
    })
  })

  it('clamps a resize to the minimum size', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users'))

    const id = result.current.windows[0].id
    act(() => result.current.updateWindow(id, { width: 10, height: 10 }))

    expect(result.current.windows[0]).toMatchObject({
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    })
  })

  it('pulls open windows back inside when the workspace shrinks', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users', { x: 300, y: 280 }))

    act(() => result.current.setBounds({ width: 500, height: 400 }))

    const w = result.current.windows[0]
    expect(w.x + w.width).toBeLessThanOrEqual(500)
    expect(w.y + w.height).toBeLessThanOrEqual(400)
  })

  it('does not churn state when a re-measure changes nothing', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users'))

    const before = result.current.windows
    act(() => result.current.setBounds(BOUNDS))
    expect(result.current.windows).toBe(before)
  })

  it('defaults to a full-width preview, not floating windows', () => {
    const { result } = renderHook(() => usePreviewWindows())
    expect(result.current.mode).toBe('full')
    expect(result.current.layout).toBe('tabs')
  })

  it('collapses a window to its title bar and back', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    const id = result.current.windows[0].id

    act(() => result.current.toggleMinimize(id))
    expect(result.current.windows[0].minimized).toBe(true)

    act(() => result.current.toggleMinimize(id))
    expect(result.current.windows[0].minimized).toBe(false)
  })

  it('maximises to the workspace and restores the previous geometry', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users', { x: 40, y: 30 }))
    const id = result.current.windows[0].id

    act(() => result.current.toggleMaximize(id))
    expect(result.current.windows[0]).toMatchObject({
      x: 0,
      y: 0,
      width: BOUNDS.width,
      height: BOUNDS.height,
    })

    act(() => result.current.toggleMaximize(id))
    expect(result.current.windows[0]).toMatchObject({
      x: 40,
      y: 30,
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT,
      restore: null,
    })
  })

  it('drops the maximised state as soon as the window is moved by hand', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users'))
    const id = result.current.windows[0].id

    act(() => result.current.toggleMaximize(id))
    act(() => result.current.updateWindow(id, { x: 60, y: 60 }))

    expect(result.current.windows[0].restore).toBeNull()
  })

  it('keeps a maximised window filling a workspace that changed size', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setBounds(BOUNDS))
    act(() => result.current.openWindow('users'))
    act(() => result.current.toggleMaximize(result.current.windows[0].id))

    act(() => result.current.setBounds({ width: 500, height: 400 }))

    expect(result.current.windows[0]).toMatchObject({ width: 500, height: 400 })
  })

  it('replaces the open table in the single layout', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.setLayout('single'))
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))

    expect(result.current.windows.map((w) => w.tableName)).toEqual(['orders'])
  })

  it('keeps only the front-most table when the single layout is adopted', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.openWindow('orders'))
    act(() => result.current.focusWindow(result.current.windows[0].id))

    act(() => result.current.setLayout('single'))

    expect(result.current.windows.map((w) => w.tableName)).toEqual(['users'])
  })

  it('expands collapsed windows when the windowed mode is entered', () => {
    const { result } = renderHook(() => usePreviewWindows())
    act(() => result.current.openWindow('users'))
    act(() => result.current.toggleMinimize(result.current.windows[0].id))

    act(() => result.current.setMode('windows'))

    expect(result.current.windows[0].minimized).toBe(false)
  })
})
