import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { parseDump } from '@sql-extractor/core'
import { Workspace, TABLE_DRAG_TYPE } from '@/components/workspace'
import type { PreviewWindow } from '@/hooks/use-preview-windows'

// Synthetic fixture — no real data.
const DUMP = [
  'CREATE DATABASE `shop`;',
  'USE `shop`;',
  'CREATE TABLE `users` (`id` int NOT NULL, `name` varchar(50));',
  "INSERT INTO `users` VALUES (1,'Ana'),(2,'Bruno');",
  'CREATE TABLE `orders` (`id` int NOT NULL, `total` decimal(10,2));',
  "INSERT INTO `orders` VALUES (1,'9.90');",
].join('\n')

const database = parseDump(DUMP).databases[0]
const rowCounts = new Map([
  ['users', 2],
  ['orders', 1],
])

const openWindow = (patch: Partial<PreviewWindow> = {}): PreviewWindow => ({
  id: 'w1',
  tableName: 'users',
  x: 10,
  y: 20,
  width: 400,
  height: 260,
  z: 1,
  minimized: false,
  restore: null,
  ...patch,
})

function setup(props: Partial<React.ComponentProps<typeof Workspace>> = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onClose: vi.fn(),
    onCloseAll: vi.fn(),
    onFocus: vi.fn(),
    onMinimize: vi.fn(),
    onMaximize: vi.fn(),
    onModeChange: vi.fn(),
    onLayoutChange: vi.fn(),
    onChange: vi.fn(),
    onMeasure: vi.fn(),
  }
  const view = render(
    <Workspace
      database={database}
      windows={[]}
      rowCounts={rowCounts}
      mode="windows"
      layout="tabs"
      {...handlers}
      {...props}
    />,
  )
  return { ...view, ...handlers }
}

/** A drag payload carrying a table name, as the table list writes it. */
function tableTransfer(tableName: string) {
  return {
    types: [TABLE_DRAG_TYPE],
    getData: (type: string) => (type === TABLE_DRAG_TYPE ? tableName : ''),
    dropEffect: 'none',
  }
}

describe('Workspace', () => {
  it('invites a drop while nothing is open', () => {
    setup()
    expect(screen.getByText(/drop a table here/i)).toBeInTheDocument()
  })

  it('opens the dropped table', () => {
    const { onOpen } = setup()

    fireEvent.drop(screen.getByLabelText('Preview workspace'), {
      dataTransfer: tableTransfer('orders'),
      clientX: 300,
      clientY: 200,
    })

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0]).toBe('orders')
  })

  it('ignores the drop point in the full mode, where position means nothing', () => {
    const { onOpen } = setup({ mode: 'full' })

    fireEvent.drop(screen.getByLabelText('Preview workspace'), {
      dataTransfer: tableTransfer('orders'),
      clientX: 300,
      clientY: 200,
    })

    expect(onOpen).toHaveBeenCalledWith('orders')
  })

  it('ignores a drop that carries no table', () => {
    const { onOpen } = setup()

    fireEvent.drop(screen.getByLabelText('Preview workspace'), {
      dataTransfer: { types: ['text/plain'], getData: () => 'something else' },
    })

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('acknowledges a table dragged over it', () => {
    setup()
    const workspace = screen.getByLabelText('Preview workspace')

    fireEvent.dragEnter(workspace, { dataTransfer: tableTransfer('users') })
    expect(screen.getByText(/drop to preview/i)).toBeInTheDocument()

    fireEvent.dragLeave(workspace, { dataTransfer: tableTransfer('users') })
    expect(screen.getByText(/drop a table here/i)).toBeInTheDocument()
  })

  it('stays in its drop state while the pointer crosses child elements', () => {
    setup()
    const workspace = screen.getByLabelText('Preview workspace')

    // Entering a child fires enter before the parent's leave.
    fireEvent.dragEnter(workspace, { dataTransfer: tableTransfer('users') })
    fireEvent.dragEnter(workspace, { dataTransfer: tableTransfer('users') })
    fireEvent.dragLeave(workspace, { dataTransfer: tableTransfer('users') })

    expect(screen.getByText(/drop to preview/i)).toBeInTheDocument()
  })

  it('renders an open window with its table data', () => {
    setup({ windows: [openWindow()] })

    expect(
      screen.getByRole('dialog', { name: 'users preview' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.queryByText(/drop a table here/i)).not.toBeInTheDocument()
  })

  it('positions a window from its state', () => {
    setup({ windows: [openWindow({ x: 40, y: 60, width: 320, height: 200 })] })

    const dialog = screen.getByRole('dialog', { name: 'users preview' })
    expect(dialog).toHaveStyle({
      left: '40px',
      top: '60px',
      width: '320px',
      height: '200px',
    })
  })

  it('stacks windows by z-index and leaves the DOM order alone', () => {
    setup({
      windows: [
        openWindow({ id: 'a', tableName: 'users', z: 5 }),
        openWindow({ id: 'b', tableName: 'orders', z: 2 }),
      ],
    })

    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs.map((d) => d.getAttribute('aria-label'))).toEqual([
      'users preview',
      'orders preview',
    ])
    expect(dialogs[0]).toHaveStyle({ zIndex: '5' })
    expect(dialogs[1]).toHaveStyle({ zIndex: '2' })
    // The highest z is the active one, whatever its position in the array.
    expect(dialogs[0]).toHaveAttribute('data-active')
    expect(dialogs[1]).not.toHaveAttribute('data-active')
  })

  it('skips a window whose table is no longer in the database', () => {
    setup({ windows: [openWindow({ tableName: 'gone' })] })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/drop a table here/i)).toBeInTheDocument()
  })

  it('gives the table the whole workspace in the full mode', () => {
    setup({ mode: 'full', windows: [openWindow()] })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('tabpanel', { name: 'users preview' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ana')).toBeInTheDocument()
  })

  it('offers a tab per open table and raises the one that is pressed', () => {
    const { onFocus } = setup({
      mode: 'full',
      windows: [
        openWindow({ id: 'a', tableName: 'users', z: 2 }),
        openWindow({ id: 'b', tableName: 'orders', z: 1 }),
      ],
    })

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.click(tabs[1])
    expect(onFocus).toHaveBeenCalledWith('b')
  })

  it('tiles every open table in the split layout', () => {
    setup({
      mode: 'full',
      layout: 'split',
      windows: [
        openWindow({ id: 'a', tableName: 'users' }),
        openWindow({ id: 'b', tableName: 'orders' }),
      ],
    })

    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByLabelText('users preview')).toBeInTheDocument()
    expect(screen.getByLabelText('orders preview')).toBeInTheDocument()
  })

  it('switches the mode and the layout from the toolbar', () => {
    const { onModeChange, onLayoutChange } = setup({ mode: 'full' })

    fireEvent.click(screen.getByRole('radio', { name: 'Windows' }))
    expect(onModeChange).toHaveBeenCalledWith('windows')

    fireEvent.click(screen.getByRole('radio', { name: 'Split' }))
    expect(onLayoutChange).toHaveBeenCalledWith('split')
  })

  it('hides the layout choice that only applies to the full mode', () => {
    setup({ mode: 'windows' })
    expect(
      screen.queryByRole('radio', { name: 'Split' }),
    ).not.toBeInTheDocument()
  })

  it('closes everything at once, and only offers to while something is open', () => {
    const { onCloseAll, rerender } = setup()
    expect(
      screen.queryByRole('button', { name: 'Close all' }),
    ).not.toBeInTheDocument()

    rerender(
      <Workspace
        database={database}
        windows={[openWindow()]}
        rowCounts={rowCounts}
        mode="windows"
        layout="tabs"
        onOpen={vi.fn()}
        onClose={vi.fn()}
        onCloseAll={onCloseAll}
        onFocus={vi.fn()}
        onMinimize={vi.fn()}
        onMaximize={vi.fn()}
        onModeChange={vi.fn()}
        onLayoutChange={vi.fn()}
        onChange={vi.fn()}
        onMeasure={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close all' }))
    expect(onCloseAll).toHaveBeenCalledTimes(1)
  })

  it('keeps the toolbar out of the way until a database is loaded', () => {
    setup({ database: null })
    expect(
      screen.queryByRole('radiogroup', { name: 'Preview mode' }),
    ).not.toBeInTheDocument()
  })
})
