'use client'

import { useCallback, useRef, useState } from 'react'

/**
 * One open table preview, positioned inside the workspace.
 *
 * `x` and `y` are workspace-relative pixels, so a window never depends on page
 * scroll or on where the workspace sits in the viewport.
 */
export interface PreviewWindow {
  id: string
  tableName: string
  x: number
  y: number
  width: number
  height: number
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

/**
 * The open preview windows, front-most last.
 *
 * Array order *is* the stacking order, so focusing a window is a move to the
 * end and no z-index counter has to be kept in sync. Windows are preview only:
 * nothing here touches the export selection.
 *
 * The workspace reports its size through `setBounds`; every open, move and
 * resize is clamped to it, so a window cannot be placed or dragged outside.
 */
export function usePreviewWindows() {
  const [windows, setWindows] = useState<PreviewWindow[]>([])
  // A ref, not state: every callback needs the newest bounds without being
  // rebuilt each time the workspace is measured.
  const boundsRef = useRef<WorkspaceBounds>({ width: 0, height: 0 })

  /** Record the workspace size and pull every window back inside it. */
  const setBounds = useCallback((bounds: WorkspaceBounds) => {
    boundsRef.current = bounds
    setWindows((prev) => {
      const next = prev.map((w) => containWindow(w, bounds))
      return next.every((w, i) => sameGeometry(w, prev[i])) ? prev : next
    })
  }, [])

  /**
   * Open a table, or focus it when it is already open.
   *
   * `at` places the window where a drop landed; without it the window cascades
   * off the ones already open so a second table never lands exactly on the first.
   */
  const openWindow = useCallback((tableName: string, at?: { x: number; y: number }) => {
    setWindows((prev) => {
      const existing = prev.findIndex((w) => w.tableName === tableName)
      // Already open: raise it instead of stacking a duplicate.
      if (existing !== -1) {
        const found = prev[existing]
        return [...prev.slice(0, existing), ...prev.slice(existing + 1), found]
      }

      const step = (prev.length % CASCADE_LIMIT) * CASCADE_STEP

      return [
        ...prev,
        containWindow(
          {
            id: `${tableName}-${Date.now()}`,
            tableName,
            x: at ? at.x : step,
            y: at ? at.y : step,
            width: WINDOW_DEFAULT_WIDTH,
            height: WINDOW_DEFAULT_HEIGHT,
          },
          boundsRef.current,
        ),
      ]
    })
  }, [])

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const closeAllWindows = useCallback(() => setWindows([]), [])

  /** Raise a window to the front. A no-op when it is already there. */
  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const index = prev.findIndex((w) => w.id === id)
      if (index === -1 || index === prev.length - 1) return prev
      const found = prev[index]
      return [...prev.slice(0, index), ...prev.slice(index + 1), found]
    })
  }, [])

  /** Apply a moved or resized geometry, clamped to the workspace. */
  const updateWindow = useCallback(
    (id: string, patch: Partial<Omit<PreviewWindow, 'id' | 'tableName'>>) => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === id ? containWindow({ ...w, ...patch }, boundsRef.current) : w,
        ),
      )
    },
    [],
  )

  return {
    windows,
    openWindow,
    closeWindow,
    closeAllWindows,
    focusWindow,
    updateWindow,
    setBounds,
  }
}
