import type { Rect, WorkspaceBounds } from '@/hooks/use-preview-windows'

/** How close to an edge the pointer has to get before a zone arms. */
export const SNAP_EDGE = 32
/** How deep a corner zone reaches along the left and right edges. */
const CORNER_DEPTH = 0.28

/**
 * The region a window would take if the drag ended right now, or null when the
 * pointer is nowhere near an edge.
 *
 * Zones are read from the pointer, not the window, because a window is already
 * clamped against the walls: by the time it touches the left edge every drag
 * towards that side looks identical, and left-half and top-left could not be
 * told apart.
 */
export function snapTarget(
  pointer: { x: number; y: number },
  bounds: WorkspaceBounds,
): Rect | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null

  const { x, y } = pointer
  // A pointer outside the workspace belongs to no zone; pointer capture keeps
  // delivering moves after the cursor has left.
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

  // The top edge between the two corners fills the workspace, the way a
  // desktop window manager treats a drag into the title bar area.
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
