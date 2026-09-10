import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { SqlTool } from '@/components/sql-tool'

/**
 * One tool, two kinds of input. A dump is a script and a SQLite file is a
 * database, and the tool tells them apart by what the file holds rather than
 * by its name — then hands it to the flow that reads it.
 *
 * Fixtures are built here and hold invented data.
 */

const require = createRequire(import.meta.url)
const wasm = readFileSync(
  join(
    dirname(require.resolve('wa-sqlite/dist/wa-sqlite.mjs')),
    'wa-sqlite.wasm',
  ),
)

const DUMP = `-- MySQL dump
CREATE TABLE \`crew\` (\`id\` int NOT NULL, \`name\` varchar(20));
INSERT INTO \`crew\` VALUES (1,'Ada');
`

/** A SQLite database whose last row lives only in its write-ahead log. */
function sqliteFiles(name = 'crew.db'): File[] {
  const path = join(mkdtempSync(join(tmpdir(), 'sql-tool-')), name)
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA wal_autocheckpoint=0')
  db.exec(
    "CREATE TABLE crew (id INTEGER, name TEXT); INSERT INTO crew VALUES (1, 'Ada');",
  )
  db.exec('PRAGMA wal_checkpoint(FULL)')
  db.exec("INSERT INTO crew VALUES (2, 'Grace');")
  // Read while the connection is open: closing it would checkpoint the log.
  return [
    new File([readFileSync(path)], name),
    new File([readFileSync(`${path}-wal`)], `${name}-wal`),
  ]
}

function select(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('no file input')
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SqlTool', () => {
  it('reads a SQL dump as a dump', async () => {
    const { container } = render(<SqlTool />)

    select(container, [new File([DUMP], 'crew.sql')])

    expect(await screen.findByText(/Read as a MySQL dump/i)).toBeInTheDocument()
    expect(screen.getByText('crew')).toBeInTheDocument()
  })

  it('reads a SQLite database and its log as a database', async () => {
    const { container } = render(<SqlTool />)

    select(container, sqliteFiles())

    expect(
      await screen.findByText(/write-ahead log was included/i, undefined, {
        timeout: 10_000,
      }),
    ).toBeInTheDocument()
    expect(screen.getByText('2 rows')).toBeInTheDocument()
  })

  it('recognises SQLite by its header, whatever the file is called', async () => {
    const { container } = render(<SqlTool />)
    const [main] = sqliteFiles('crew.db')

    select(container, [new File([main as File], 'export.sql')])

    expect(
      await screen.findByText('crew', undefined, { timeout: 10_000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Read as a MySQL dump/i)).not.toBeInTheDocument()
  })

  it('moves between the two when the next file is the other kind', async () => {
    const { container } = render(<SqlTool />)

    select(container, sqliteFiles())
    await screen.findByText(/write-ahead log was included/i, undefined, {
      timeout: 10_000,
    })

    select(container, [new File([DUMP], 'crew.sql')])

    expect(await screen.findByText(/Read as a MySQL dump/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/write-ahead log was included/i),
    ).not.toBeInTheDocument()
  })

  it('keeps one heading for both kinds of input', async () => {
    const { container } = render(<SqlTool />)
    const heading = () =>
      screen.getByRole('heading', { name: /Extract from a database/i })

    expect(heading()).toBeInTheDocument()
    select(container, sqliteFiles())
    await screen.findByText(/write-ahead log was included/i, undefined, {
      timeout: 10_000,
    })
    expect(heading()).toBeInTheDocument()
  })

  it('refuses a file of neither kind, naming what it takes', async () => {
    const { container } = render(<SqlTool />)

    select(container, [new File(['%PDF-1.7'], 'report.pdf')])

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not supported/i)
    expect(alert).toHaveTextContent(/\.sql/)
    expect(alert).toHaveTextContent(/\.db/)
  })
})
