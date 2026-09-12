import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { strFromU8, unzipSync } from 'fflate'
import { SqliteConverter } from '@/components/sqlite-converter'

/**
 * The whole tool against the real reader and a real SQLite engine: pick the
 * files, see the tables, choose a format, convert, take the ZIP. Only the
 * browser APIs jsdom lacks are stood in for - the fetch of the WebAssembly
 * binary and the object URL the download goes through.
 *
 * The fixture is built at test time and holds invented data. Its last row is
 * written after a checkpoint, so it exists only in the write-ahead log: a tool
 * that ignored the log would pass everything here except that row.
 */

const require = createRequire(import.meta.url)
const wasm = readFileSync(
  join(
    dirname(require.resolve('wa-sqlite/dist/wa-sqlite.mjs')),
    'wa-sqlite.wasm',
  ),
)

/** A database in WAL mode, as the files a user would select. */
function walDatabase(): File[] {
  const path = join(mkdtempSync(join(tmpdir(), 'sqlite-ui-')), 'crew.db')
  const db = new DatabaseSync(path)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA wal_autocheckpoint=0')
  db.exec(`CREATE TABLE crew (id INTEGER PRIMARY KEY, name TEXT, badge BLOB);
           INSERT INTO crew VALUES (1, 'Ada', x'00ff');`)
  db.exec('PRAGMA wal_checkpoint(FULL)')
  db.exec(`INSERT INTO crew VALUES (2, 'Grace', NULL);`)
  // The connection stays open: closing it would checkpoint the log away.
  const files = [
    new File([readFileSync(path)], 'crew.db'),
    new File([readFileSync(`${path}-wal`)], 'crew.db-wal'),
  ]
  if (existsSync(`${path}-shm`)) {
    files.push(new File([readFileSync(`${path}-shm`)], 'crew.db-shm'))
  }
  return files
}

function select(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]')
  if (!input) throw new Error('no file input')
  fireEvent.change(input, { target: { files } })
}

/** The archive handed to the browser, unpacked. */
function readArchive(blob: Blob): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve(unzipSync(new Uint8Array(reader.result as ArrayBuffer)))
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

let createObjectURL: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () =>
        wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    })),
  )
  createObjectURL = vi.fn(() => 'blob:archive')
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
  })
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: vi.fn(),
    configurable: true,
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Select the fixture, every table, a format, and take the archive. */
async function convert(format: RegExp, delimiter?: RegExp) {
  const { container } = render(<SqliteConverter />)
  select(container, walDatabase())

  // The row that lives only in the log is counted, before anything is exported.
  await screen.findByText(/write-ahead log was included/i, undefined, {
    timeout: 10_000,
  })
  expect(screen.getByText('2 rows')).toBeInTheDocument()

  fireEvent.click(screen.getByRole('checkbox', { name: /Select all/i }))
  fireEvent.click(screen.getByRole('radio', { name: format }))
  if (delimiter) fireEvent.click(screen.getByRole('radio', { name: delimiter }))
  fireEvent.click(screen.getByRole('button', { name: /^Convert$/i }))
  fireEvent.click(await screen.findByRole('button', { name: /Download ZIP/i }))

  return readArchive(createObjectURL.mock.calls[0]?.[0] as Blob)
}

describe('SqliteConverter', () => {
  it('converts a database and its write-ahead log to CSV', async () => {
    const archive = await convert(/^CSV/, /Semicolon/)

    expect(Object.keys(archive)).toEqual(['crew.csv'])
    expect(
      strFromU8(archive['crew.csv'] as Uint8Array).replace(/^\ufeff/, ''),
    ).toBe('id;name;badge\r\n1;Ada;AP8=\r\n2;Grace;\r\n')
  })

  it('converts the same database to SQL carrying its schema', async () => {
    const archive = await convert(/^SQL/)

    const sql = strFromU8(archive['crew.sql'] as Uint8Array)
    expect(sql).toContain('CREATE TABLE crew (id INTEGER PRIMARY KEY')
    expect(sql).toContain("(1,'Ada',X'00ff')")
    expect(sql).toContain("(2,'Grace',NULL)")
  })

  it('asks for the database when only its companion files are chosen', async () => {
    const { container } = render(<SqliteConverter />)
    select(container, [new File(['index'], 'crew.db-shm')])

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/database file itself/i)
  })

  it('refuses a file that is not SQLite without quoting it', async () => {
    const { container } = render(<SqliteConverter />)
    select(container, [new File(['secret-token, not sqlite'], 'notes.db')])

    const alert = await screen.findByRole('alert', undefined, {
      timeout: 10_000,
    })
    expect(alert).toHaveTextContent(/not a SQLite database/i)
    expect(alert).not.toHaveTextContent(/secret-token/)
  })
})
