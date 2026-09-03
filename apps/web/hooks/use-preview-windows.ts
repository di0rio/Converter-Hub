'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * How the workspace shows the open tables.
 *
 * `full` gives a table the whole workspace, which is what someone reading data
 * actually wants. `windows` is the opt-in floating mode, for putting tables
 * next to each other.
 */
export type PreviewMode = 'full' | 'windows'

/** How several open tables share the workspace while in `full` mode. */
export type FullLayout = 'tabs' | 'single' | 'split'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * One open table preview, positioned inside the workspace.
 *
 * `x` and `y` are workspace-relative pixels, so a window never depends on page
 * scroll or on where the workspace sits in the viewport.
 */
export interface PreviewWindow extends Rect {
  id: string
  tableName: string
  /**
   * Paint order: the highest `z` is the front-most, active window.
   *
   * Stacking lives in a number rather than in array order because array order
   * is also DOM order, and re-inserting a node restarts its CSS animation and
   * drops focus — raising a window used to make it flicker and lose the
   * keyboard. The array now keeps insertion order for good.
   */
  z: number
  /** Collapsed to its title bar. */
  minimized: boolean
  /**
   * Geometry to return to when un-maximised or un-snapped. Null while the
   * window sits at a size the user set themselves.
   */
  restore: Rect | null
}

export interface WorkspaceBounds {
  width: number
  height: number
}

export const WINDOW_DEFAULT_WIDTH = 460
export const WINDOW_DEFAULT_HEIGHT = 300
export const WINDOW_MIN_WIDTH = 260
export const WINDOW_MIN_HEIGHT = 140
/** Each cascaded window steps down and right by this much. */
const CASCADE_STEP = 26
/** How far a cascade walks before it returns to the origin. */
const CASCADE_LIMIT = 6

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

/**
 * Keep a window fully inside the workspace.
 *
 * The size is capped first so a window can never be larger than the area that
 * holds it, then the origin is clamped to what is left. A workspace that has
 * not been measured yet leaves the values untouched.
 */
export function containWindow(
  window: PreviewWindow,
  bounds: WorkspaceBounds,
): PreviewWindow {
  if (bounds.width <= 0 || bounds.height <= 0) return window

  const width = clamp(window.width, WINDOW_MIN_WIDTH, bounds.width)
  const height = clamp(window.height, WINDOW_MIN_HEIGHT, bounds.height)

  return {
    ...window,
    width,
    height,
    x: clamp(window.x, 0, bounds.width - width),
    y: clamp(window.y, 0, bounds.height - height),
  }
}

const sameGeometry = (a: PreviewWindow, b: PreviewWindow) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** The front-most window, or null when nothing is open. */
export function frontWindow(windows: PreviewWindow[]): PreviewWindow | null {
  let front: PreviewWindow | null = null
  for (const w of windows) if (!front || w.z > front.z) front = w
  return front
}

/**
 * The open preview windows, in insertion order.
 *
 * Stacking is carried by `z`, never by array position, so raising a window is a
 * style change and nothing in the DOM moves. Windows are preview only: nothing
 * here touches the export selection.
 *
 * The workspace reports its size through `setBounds`; every open, move and
 * resize is clamped to it, so a window cannot be placed or dragged outside.
 */
export function usePreviewWindows() {
  const [windows, setWindows] = useState<PreviewWindow[]>([])
  const [mode, setModeState] = useState<PreviewMode>('full')
  const [layout, setLayoutState] = useState<FullLayout>('tabs')

  // Refs, not state: the open and focus callbacks need the newest value without
  // being rebuilt, and a rebuilt callback re-renders the whole table list.
  const boundsRef = useRef<WorkspaceBounds>({ width: 0, height: 0 })
  const modeRef = useRef<PreviewMode>('full')
  const layoutRef = useRef<FullLayout>('tabs')
  // Monotonic, so a raised window is above every window ever raised before it.
  const topZ = useRef(0)

  /** Record the workspace size and pull every window back inside it. */
  const setBounds = useCallback((bounds: WorkspaceBounds) => {
    boundsRef.current = bounds
    setWindows((prev) => {
      const next = prev.map((w) =>
        // A maximised window follows the workspace instead of keeping a size
        // that no longer fills it.
        w.restore
          ? { ...w, x: 0, y: 0, width: bounds.width, height: bounds.height }
          : containWindow(w, bounds),
      )
      return next.every((w, i) => sameGeometry(w, prev[i])) ? prev : next
    })
  }, [])

  /**
   * Open a table, or raise it when it is already open.
   *
   * `at` places the window where a drop landed; without it the window cascades
   * off the ones already open so a second table never lands exactly on the first.
   */
  const openWindow = useCallback(
    (tableName: string, at?: { x: number; y: number }) => {
      setWindows((prev) => {
        topZ.current += 1
        const single = modeRef.current === 'full' && layoutRef.current === 'single'

        const existing = prev.find((w) => w.tableName === tableName)
        // Already open: raise and un-collapse it instead of stacking a duplicate.
        if (existing) {
          const raised = prev.map((w) =>
            w.id === existing.id ? { ...w, z: topZ.current, minimized: false } : w,
          )
          return single ? raised.filter((w) => w.id === existing.id) : raised
        }

        const step = (prev.length % CASCADE_LIMIT) * CASCADE_STEP
        const opened = containWindow(
          {
            id: `${tableName}-${Date.now()}-${topZ.current}`,
            tableName,
            x: at ? at.x : step,
            y: at ? at.y : step,
            width: WINDOW_DEFAULT_WIDTH,
            height: WINDOW_DEFAULT_HEIGHT,
            z: topZ.current,
            minimized: false,
            restore: null,
          },
          boundsRef.current,
        )

        // One at a time: opening a table replaces whatever was on screen.
        return single ? [opened] : [...prev, opened]
      })
    },
    [],
  )

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const closeAllWindows = useCallback(() => setWindows([]), [])

  /** Raise a window to the front. A no-op when it is already there. */
  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id)
      if (!target || target.z === topZ.current) return prev
      topZ.current += 1
      return prev.map((w) => (w.id === id ? { ...w, z: topZ.current } : w))
    })
  }, [])

  /** Apply a moved or resized geometry, clamped to the workspace. */
  const updateWindow = useCallback(
    (id: string, patch: Partial<Omit<PreviewWindow, 'id' | 'tableName'>>) => {
      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w
          // Geometry the user sets by hand ends the maximised or snapped state,
          // so the restore button never offers a size they already left.
          const resized =
            patch.x !== undefined ||
            patch.y !== undefined ||
            patch.width !== undefined ||
            patch.height !== undefined
          const restore =
            patch.restore !== undefined
              ? patch.restore
              : resized
                ? null
                : w.restore
          return containWindow({ ...w, ...patch, restore }, boundsRef.current)
        }),
      )
    },
    [],
  )

  /** Collapse a window to its title bar, or expand it again. */
  const toggleMinimize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)),
    )
  }, [])

  /** Fill the workspace, or go back to the size the window had before. */
  const toggleMaximize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w
        if (w.restore) {
          return containWindow({ ...w, ...w.restore, restore: null }, boundsRef.current)
        }
        const bounds = boundsRef.current
        if (bounds.width <= 0 || bounds.height <= 0) return w
        return {
          ...w,
          restore: { x: w.x, y: w.y, width: w.width, height: w.height },
          x: 0,
          y: 0,
          width: bounds.width,
          height: bounds.height,
          minimized: false,
        }
      }),
    )
  }, [])

  const setMode = useCallback((next: PreviewMode) => {
    modeRef.current = next
    setModeState(next)
    // Back in floating windows, an earlier collapse should not hide a table the
    // user just asked to see.
    if (next === 'windows') {
      setWindows((prev) =>
        prev.some((w) => w.minimized)
          ? prev.map((w) => ({ ...w, minimized: false }))
          : prev,
      )
    }
  }, [])

  const setLayout = useCallback((next: FullLayout) => {
    layoutRef.current = next
    setLayoutState(next)
    // "Single" means one table on screen, so adopting it keeps the front-most
    // and drops the rest rather than hiding tables with no way back to them.
    if (next === 'single') {
      setWindows((prev) => {
        const front = frontWindow(prev)
        return front && prev.length > 1 ? [front] : prev
      })
    }
  }, [])

  return {
    windows,
    mode,
    layout,
    openWindow,
    closeWindow,
    closeAllWindows,
    focusWindow,
    updateWindow,
    toggleMinimize,
    toggleMaximize,
    setMode,
    setLayout,
    setBounds,
  }
}
