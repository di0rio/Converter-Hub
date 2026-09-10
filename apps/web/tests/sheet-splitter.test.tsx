import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react'
import * as XLSX from 'xlsx'
import { SheetSplitter } from '@/components/spreadsheet/sheet-splitter'

/**
 * The whole flow, against the real hook and the real reader: choose a file,
 * pick sheets, split, download. Nothing here is mocked except the browser APIs
 * jsdom does not implement.
 */

/** A synthetic workbook. No real spreadsheet is ever committed. */
function makeFile(
  sheets: Record<string, unknown[][]>,
  name = 'clients.xlsx',
): File {
  const workbook = XLSX.utils.book_new()
  for (const [sheetName, rows] of Object.entries(sheets)) {
    workbook.SheetNames.push(sheetName)
    workbook.Sheets[sheetName] = XLSX.utils.aoa_to_sheet(rows)
  }

  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  return new File([bytes], name)
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('no file input')
  return input as HTMLInputElement
}

async function loadFile(container: HTMLElement, file: File) {
  fireEvent.change(fileInput(container), { target: { files: [file] } })
  await waitFor(() =>
    expect(screen.getByText(/sheets? found/i)).toBeInTheDocument(),
  )
}

const SAMPLE = {
  Clients: [
    ['name', 'city'],
    ['Ada', 'Lisbon'],
    ['Grace', 'Porto'],
  ],
  Orders: [
    ['id', 'total'],
    ['1', '9.99'],
  ],
}

let createObjectURL: ReturnType<typeof vi.fn>
let revokeObjectURL: ReturnType<typeof vi.fn>
let click: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  createObjectURL = vi.fn(() => 'blob:archive')
  revokeObjectURL = vi.fn()
  // jsdom implements neither, and the download step is the point of the tool.
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
  })
  click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SheetSplitter', () => {
  it('opens on an empty state that says what it takes and where it runs', () => {
    render(<SheetSplitter />)

    expect(
      screen.getByRole('heading', { name: /Split a spreadsheet/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Select a spreadsheet/i)).toBeInTheDocument()
    expect(screen.getByText(/\.xlsx · \.xlsm · \.xls/)).toBeInTheDocument()
    expect(screen.getByText(/Nothing is uploaded/i)).toBeInTheDocument()
    // The preview pane is not blank while it waits.
    expect(screen.getByText(/No sheet open/i)).toBeInTheDocument()
  })

  it('sits inside the hub, with a way back to it', () => {
    render(<SheetSplitter />)

    expect(
      screen.getByRole('link', { name: /Converter Hub/i }),
    ).toHaveAttribute('href', '/')
  })

  it('offers a keyboard path to the file, not only a drop target', () => {
    const { container } = render(<SheetSplitter />)

    const input = fileInput(container)
    expect(input.accept).toBe('.xlsx,.xlsm,.xls')
    expect(
      screen.getByRole('button', { name: /Drop a file here/i }),
    ).toBeInTheDocument()
  })

  it('refuses a file type it cannot read, and says so without a stack trace', async () => {
    const { container } = render(<SheetSplitter />)

    fireEvent.change(fileInput(container), {
      target: { files: [new File(['id,name'], 'data.csv')] },
    })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not supported/i)
    expect(alert).toHaveTextContent(/\.xlsx, \.xlsm or \.xls/)
  })

  it('lists the sheets in a loaded workbook, with their row counts', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))

    expect(screen.getByText('2 sheets found')).toBeInTheDocument()

    // Scoped to the list: a sheet name also appears in the preview header.
    const sheets = within(
      screen.getByRole('region', { name: /Select sheets/i }),
    )
    expect(sheets.getByText('Clients')).toBeInTheDocument()
    expect(sheets.getByText('Orders')).toBeInTheDocument()
    // Data rows, not range rows: the header names the columns, the way the
    // SQL tool counts a table's rows.
    expect(sheets.getByText('2 rows')).toBeInTheDocument()
    expect(sheets.getByText('1 row')).toBeInTheDocument()
  })

  it('previews the first sheet with content, without being asked', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument())
    expect(
      screen.getByRole('columnheader', { name: 'name' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Ada' })).toBeInTheDocument()
  })

  it('selects every sheet with content by default', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))

    expect(screen.getByText('2 sheets ready to split.')).toBeInTheDocument()
    expect(screen.getByText('2 / 2')).toBeInTheDocument()
  })

  it('lists an empty sheet but will not export it', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile({ Clients: SAMPLE.Clients, Blank: [] }))

    const sheets = within(
      screen.getByRole('region', { name: /Select sheets/i }),
    )
    expect(sheets.getByText('Blank')).toBeInTheDocument()
    expect(sheets.getByText('empty')).toBeInTheDocument()

    // Listed for transparency, but it does not count towards the export: one
    // of one selectable sheet, not one of two.
    expect(sheets.getByText('1 / 1')).toBeInTheDocument()
    expect(screen.getByText('1 sheet ready to split.')).toBeInTheDocument()
  })

  it('splits the workbook and reports what it produced', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))

    fireEvent.click(screen.getByRole('button', { name: /Split sheets/i }))

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Download ZIP/i }),
      ).toBeInTheDocument(),
    )

    const summary = within(
      screen.getByRole('region', { name: /Split and download/i }),
    )
    expect(summary.getByText('clients_sheets.zip')).toBeInTheDocument()
    // Two sheets in, two files out.
    expect(summary.getByText('Files').nextSibling).toHaveTextContent('2')
  })

  it('hands the archive to the browser without sending it anywhere', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))
    fireEvent.click(screen.getByRole('button', { name: /Split sheets/i }))

    const download = await screen.findByRole('button', {
      name: /Download ZIP/i,
    })
    fireEvent.click(download)

    // A blob: URL is this tab's own memory. Nothing is fetched or posted.
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob)
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:archive')
  })

  it('drops a built archive when the output format changes', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))
    fireEvent.click(screen.getByRole('button', { name: /Split sheets/i }))
    await screen.findByRole('button', { name: /Download ZIP/i })

    // The archive on screen was written as .xlsx, so it must not be offered
    // as the result of a CSV split.
    fireEvent.click(screen.getByRole('radio', { name: /CSV/i }))

    expect(
      screen.queryByRole('button', { name: /Download ZIP/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Split sheets/i }),
    ).toBeInTheDocument()
  })

  it('starts over back to the empty state', async () => {
    const { container } = render(<SheetSplitter />)

    await loadFile(container, makeFile(SAMPLE))

    fireEvent.click(screen.getByRole('button', { name: /Start over/i }))

    await waitFor(() =>
      expect(screen.queryByText('Clients')).not.toBeInTheDocument(),
    )
    expect(screen.getByText(/No sheet open/i)).toBeInTheDocument()
  })
})
