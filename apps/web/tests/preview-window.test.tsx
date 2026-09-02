import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { parseDump } from '@sql-extractor/core'
import { PreviewWindow } from '@/components/preview-window'
import type { PreviewWindow as PreviewWindowState } from '@/hooks/use-preview-windows'

// Synthetic fixture — no real data.
const DUMP = [
  'CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(50));',
  "INSERT INTO `users` VALUES (1,'Ana'),(2,'Bruno');",
].join('\n')

const table = parseDump(DUMP).databases[0].tables[0]

const state: PreviewWindowState = {
  id: 'w1',
  tableName: 'users',
  x: 30,
  y: 40,
  width: 400,
  height: 260,
}

function setup(overrides: Partial<React.ComponentProps<typeof PreviewWindow>> = {}) {
  const handlers = {
    onFocus: vi.fn(),
    onClose: vi.fn(),
    onChange: vi.fn(),
  }
  const view = render(
    <PreviewWindow
      window={state}
      table={table}
      rowCount={2}
      active
      {...handlers}
      {...overrides}
    />,
  )
  return { ...view, ...handlers }
}

const header = () => screen.getByLabelText('Move users window')

/**
 * Dispatch a pointer gesture that actually carries coordinates.
 *
 * jsdom builds a bare `Event` for `pointerdown`/`pointermove`, dropping
 * clientX, clientY and button, so `fireEvent.pointerDown` cannot express a
 * gesture. A MouseEvent carries all three and React dispatches it to the
 * matching `onPointer*` handler by event name.
 */
function pointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: { clientX?: number; clientY?: number; button?: number } = {},
) {
  fireEvent(
    element,
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init }),
  )
}

describe('PreviewWindow', () => {
  it('names the table and its row count in the header', () => {
    setup()
    const head = header()
    expect(within(head).getByText('users')).toBeInTheDocument()
    expect(within(head).getByText('2 rows')).toBeInTheDocument()
  })

  it('says "row" in the singular for a one-row table', () => {
    setup({ rowCount: 1 })
    expect(within(header()).getByText('1 row')).toBeInTheDocument()
  })

  it('shows the table data', () => {
    setup()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Bruno')).toBeInTheDocument()
  })

  it('closes from the header button', () => {
    const { onClose } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Close users preview' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('raises itself when pressed anywhere', () => {
    const { onFocus } = setup()
    pointer(screen.getByRole('dialog'), 'pointerdown')
    expect(onFocus).toHaveBeenCalled()
  })

  it('tracks the pointer 1:1 from where the header was grabbed', () => {
    const { onChange } = setup()

    // Grab 50px into the window, then move the pointer by (+100, +70).
    pointer(header(), 'pointerdown', { clientX: state.x + 50, clientY: state.y + 10 })
    pointer(header(), 'pointermove', { clientX: state.x + 150, clientY: state.y + 80 })

    expect(onChange).toHaveBeenLastCalledWith({ x: state.x + 100, y: state.y + 70 })
  })

  it('stops moving once the pointer is released', () => {
    const { onChange } = setup()

    pointer(header(), 'pointerdown', { clientX: 80, clientY: 50 })
    pointer(header(), 'pointerup', { clientX: 80, clientY: 50 })
    onChange.mockClear()
    pointer(header(), 'pointermove', { clientX: 400, clientY: 400 })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not start a move from a non-primary button', () => {
    const { onChange } = setup()

    pointer(header(), 'pointerdown', { clientX: 80, clientY: 50, button: 2 })
    pointer(header(), 'pointermove', { clientX: 400, clientY: 400 })

    expect(onChange).not.toHaveBeenCalled()
  })

  it('resizes from the corner grip', () => {
    const { onChange } = setup()
    const grip = screen.getByLabelText('Resize users preview')

    pointer(grip, 'pointerdown', { clientX: 100, clientY: 100 })
    pointer(grip, 'pointermove', { clientX: 180, clientY: 160 })

    expect(onChange).toHaveBeenLastCalledWith({
      width: state.width + 80,
      height: state.height + 60,
    })
  })

  it('moves with the arrow keys, so a pointer is never required', () => {
    const { onChange } = setup()

    fireEvent.keyDown(header(), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ x: state.x + 8, y: state.y })

    fireEvent.keyDown(header(), { key: 'ArrowDown', shiftKey: true })
    expect(onChange).toHaveBeenLastCalledWith({ x: state.x, y: state.y + 24 })
  })

  it('ignores keys that are not arrows', () => {
    const { onChange } = setup()
    fireEvent.keyDown(header(), { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('marks the active window more prominently than an inactive one', () => {
    const { unmount } = setup({ active: true })
    expect(screen.getByRole('dialog').className).toContain('shadow-lg')
    unmount()

    setup({ active: false })
    expect(screen.getByRole('dialog').className).not.toContain('shadow-lg')
  })

  it('keeps the table inside the window rather than letting it set the size', () => {
    setup()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveStyle({ width: '400px', height: '260px' })
    expect(dialog.className).toContain('overflow-hidden')
  })
})
