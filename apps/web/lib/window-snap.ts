import type { Rect, WorkspaceBounds } from '@/hooks/use-preview-windows'

export const SNAP_EDGE = 32
const CORNER_DEPTH = 0.28

export function snapTarget(
  pointer: { x: number; y: number },
  bounds: WorkspaceBounds,
): Rect | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null

  const { x, y } = pointer
  if (x < -SNAP_EDGE || y < -SNAP_EDGE) return null
  if (x > bounds.width + SNAP_EDGE || y > bounds.height + SNAP_EDGE) return null

  const nearLeft = x <= SNAP_EDGE
  const nearRight = x >= bounds.width - SNAP_EDGE
  const nearTop = y <= SNAP_EDGE
  const halfWidth = Math.round(bounds.width / 2)
  const halfHeight = Math.round(bounds.height / 2)

  if (nearLeft || nearRight) {
    const left = nearLeft ? 0 : bounds.width - halfWidth
    if (y <= bounds.height * CORNER_DEPTH) {
      return { x: left, y: 0, width: halfWidth, height: halfHeight }
    }
    if (y >= bounds.height * (1 - CORNER_DEPTH)) {
      return {
        x: left,
        y: bounds.height - halfHeight,
        width: halfWidth,
        height: halfHeight,
      }
    }
    return { x: left, y: 0, width: halfWidth, height: bounds.height }
  }

  if (nearTop) {
    return { x: 0, y: 0, width: bounds.width, height: bounds.height }
  }

  return null
}

export const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (a != null &&
    b != null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height)
