'use client'

import { useCallback, useRef, useState } from 'react'

export type PreviewMode = 'full' | 'windows'

export type FullLayout = 'tabs' | 'single' | 'split'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface PreviewWindow extends Rect {
  id: string
  name: string
  z: number
  minimized: boolean
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
const CASCADE_STEP = 26
const CASCADE_LIMIT = 6

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max))

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

export function frontWindow(windows: PreviewWindow[]): PreviewWindow | null {
  let front: PreviewWindow | null = null
  for (const w of windows) if (!front || w.z > front.z) front = w
  return front
}

export function usePreviewWindows() {
  const [windows, setWindows] = useState<PreviewWindow[]>([])
  const [mode, setModeState] = useState<PreviewMode>('full')
  const [layout, setLayoutState] = useState<FullLayout>('tabs')

  const boundsRef = useRef<WorkspaceBounds>({ width: 0, height: 0 })
  const modeRef = useRef<PreviewMode>('full')
  const layoutRef = useRef<FullLayout>('tabs')
  const topZ = useRef(0)

  const setBounds = useCallback((bounds: WorkspaceBounds) => {
    boundsRef.current = bounds
    setWindows((prev) => {
      const next = prev.map((w) =>
        w.restore
          ? { ...w, x: 0, y: 0, width: bounds.width, height: bounds.height }
          : containWindow(w, bounds),
      )
      return next.every((w, i) => sameGeometry(w, prev[i])) ? prev : next
    })
  }, [])

  const openWindow = useCallback(
    (name: string, at?: { x: number; y: number }) => {
      setWindows((prev) => {
        topZ.current += 1
        const single =
          modeRef.current === 'full' && layoutRef.current === 'single'

        const existing = prev.find((w) => w.name === name)
        if (existing) {
          const raised = prev.map((w) =>
            w.id === existing.id
              ? { ...w, z: topZ.current, minimized: false }
              : w,
          )
          return single ? raised.filter((w) => w.id === existing.id) : raised
        }

        const step = (prev.length % CASCADE_LIMIT) * CASCADE_STEP
        const opened = containWindow(
          {
            id: `${name}-${Date.now()}-${topZ.current}`,
            name,
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

        return single ? [opened] : [...prev, opened]
      })
    },
    [],
  )

  const closeWindow = useCallback((id: string) => {
    setWindows((prev) => prev.filter((w) => w.id !== id))
  }, [])

  const closeAllWindows = useCallback(() => setWindows([]), [])

  const focusWindow = useCallback((id: string) => {
    setWindows((prev) => {
      const target = prev.find((w) => w.id === id)
      if (!target || target.z === topZ.current) return prev
      topZ.current += 1
      return prev.map((w) => (w.id === id ? { ...w, z: topZ.current } : w))
    })
  }, [])

  const updateWindow = useCallback(
    (id: string, patch: Partial<Omit<PreviewWindow, 'id' | 'name'>>) => {
      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== id) return w
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

  const toggleMinimize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, minimized: !w.minimized } : w)),
    )
  }, [])

  const toggleMaximize = useCallback((id: string) => {
    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w
        if (w.restore) {
          return containWindow(
            { ...w, ...w.restore, restore: null },
            boundsRef.current,
          )
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
