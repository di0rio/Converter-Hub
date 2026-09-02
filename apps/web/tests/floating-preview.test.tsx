import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { parseDump } from '@sql-extractor/core'
import { FloatingPreview } from '@/components/floating-preview'

const DUMP = [
  'CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(100));',
  "INSERT INTO `users` VALUES (1,'Ana');",
  'CREATE TABLE `orders` (`id` int NOT NULL);',
].join('\n')

const database = parseDump(DUMP).databases[0]
const users = database.tables[0]
const orders = database.tables[1]

// jsdom has no real layout; guard the pointer-math shouldn't throw during a drag.
const stubRect = (element: HTMLElement) => {
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0,
    width: 100, height: 50,
    toJSON: () => ({}),
  } as DOMRect)
}

const dt = (name: string) => ({
  setData: vi.fn(),
  getData: vi.fn(() => name),
  effectAllowed: '',
  dropEffect: '',
})

describe('FloatingPreview', () => {
  it('shows a concise empty state when no table is selected', () => {
    render(<FloatingPreview table={null} onPreview={vi.fn()} />)
    expect(screen.getByText(/select a table to preview its data/i)).toBeInTheDocument()
  })

  it('renders the selected table inside the floating window', () => {
    render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    expect(screen.getByText(/users/)).toBeInTheDocument()
    expect(screen.getByText(/1 row/)).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('is a fixed, draggable window with a grip handle', () => {
    const { container } = render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    const window = container.firstElementChild!
    expect(window).toHaveClass('fixed')
    expect(screen.getByRole('presentation')).toBeInTheDocument()
    const header = screen.getByRole('presentation')
    stubRect(window as HTMLElement)
    fireEvent.pointerDown(header, { clientX: 10, clientY: 5, pointerId: 1, button: 0 })
    fireEvent.pointerMove(header, { clientX: 20, clientY: 15, pointerId: 1 })
    fireEvent.pointerUp(header, { pointerId: 1 })
    expect(() => fireEvent.pointerMove(header, { clientX: 30, clientY: 25, pointerId: 1 })).not.toThrow()
  })

  it('hides via the close button and reopens from the show button', () => {
    render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /hide preview/i }))
    expect(screen.queryByRole('presentation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show preview/i }))
    expect(screen.getByRole('presentation')).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('re-mounts the animated pane so a table switch replays the entrance', () => {
    const { container, rerender } = render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    const firstPane = container.querySelector('.motion-safe\\:animate-preview-in')
    rerender(<FloatingPreview table={orders} onPreview={vi.fn()} />)
    const secondPane = container.querySelector('.motion-safe\\:animate-preview-in')
    expect(secondPane).not.toBeNull()
    expect(secondPane).not.toBe(firstPane)
  })

  it('previews the table dropped onto the window', () => {
    const onPreview = vi.fn()
    const { container } = render(<FloatingPreview table={null} onPreview={onPreview} />)
    const window = container.firstElementChild!
    fireEvent.dragEnter(window)
    fireEvent.dragOver(window, { dataTransfer: dt('orders') })
    fireEvent.drop(window, { dataTransfer: dt('orders') })
    expect(onPreview).toHaveBeenCalledWith('orders')
  })

  it('offers a resize handle whose pointer-math does not throw', () => {
    const { container } = render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    const window = container.firstElementChild as HTMLElement
    const handle = screen.getByRole('separator', { name: /resize preview/i })
    stubRect(window)
    // jsdom does not deliver clientX/clientY for synthetic pointer events, so the
    // numeric width cannot be asserted here; guard that the gesture never throws.
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 })
    expect(() => fireEvent.pointerMove(handle, { pointerId: 1, clientX: 10 })).not.toThrow()
    fireEvent.pointerUp(handle, { pointerId: 1 })
  })

  it('maximizes and restores from the header button', () => {
    const { container } = render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    const window = container.firstElementChild as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: /maximize preview/i }))
    expect(window).toHaveClass('rounded-none')
    expect(window).toHaveStyle('left: 0px')
    // Resize handles are hidden while maximized.
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /restore preview/i }))
    expect(window).not.toHaveClass('rounded-none')
    expect(screen.getByRole('separator', { name: /resize preview/i })).toBeInTheDocument()
  })

  it('toggles maximize on a header double-click', () => {
    const { container } = render(<FloatingPreview table={users} onPreview={vi.fn()} />)
    const window = container.firstElementChild as HTMLElement
    const header = screen.getByRole('presentation')
    fireEvent.dblClick(header)
    expect(window).toHaveStyle('left: 0px')
    fireEvent.dblClick(header)
    expect(window).not.toHaveStyle('left: 0px')
  })
})