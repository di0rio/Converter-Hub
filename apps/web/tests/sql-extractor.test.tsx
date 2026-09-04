import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SqlExtractor } from '@/components/sql-extractor'
import { useSqlDump } from '@/hooks/use-sql-dump'
import { DATABASE_FORMATS } from '@sql-extractor/core'

// Mock the hook to control component state deterministically.
// The hook's real logic is tested separately in use-sql-dump.test.ts.
vi.mock('@/hooks/use-sql-dump', () => ({
  useSqlDump: vi.fn(),
}))

const mockedUseSqlDump = vi.mocked(useSqlDump)

// Synthetic fixtures
const SAMPLE_SQL = `-- MySQL dump
CREATE DATABASE IF NOT EXISTS \`shop_db\` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE \`shop_db\`;

DROP TABLE IF EXISTS \`users\`;
CREATE TABLE \`users\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`name\` varchar(100) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES \`users\` WRITE;
INSERT INTO \`users\` VALUES
(1, 'Alice Johnson');
UNLOCK TABLES;
`

function baseHookState(overrides: Record<string, unknown> = {}) {
  return {
    step: 'file' as const,
    dump: null,
    fileName: '',
    selectedDatabase: '',
    selectedTables: [],
    exportFormat: 'sql' as const,
    sourceFormat: DATABASE_FORMATS.mysql,
    confidence: 'detected' as const,
    formatOverride: null,
    database: null,
    status: 'idle' as const,
    result: null,
    error: null,
    allTablesSelected: false,
    someTablesSelected: false,
    loadFile: vi.fn(),
    overrideSourceFormat: vi.fn(),
    reportFileError: vi.fn(),
    selectDatabase: vi.fn(),
    toggleTable: vi.fn(),
    toggleAllTables: vi.fn(),
    selectFormat: vi.fn(),
    convert: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  }
}

describe('SqlExtractor', () => {
  beforeEach(() => {
    mockedUseSqlDump.mockReset()
  })

  it('renders the heading and file upload on initial load', () => {
    mockedUseSqlDump.mockReturnValue(baseHookState())

    render(<SqlExtractor />)

    expect(
      screen.getByRole('heading', { name: /SQL Database Extractor/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Select a database dump/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choose SQL file/i })).toBeInTheDocument()
  })

  it('exposes an accessible file upload input', () => {
    mockedUseSqlDump.mockReturnValue(baseHookState())

    const { container } = render(<SqlExtractor />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('file')
    expect(input.accept).toBe('.sql,text/plain')
    // The section is labelled "Select a database dump" and the input is associated with the
    // visible label via htmlFor.
    expect(screen.getByRole('region', { name: /Select a database dump/i })).toBeInTheDocument()
    expect(
      screen.getAllByLabelText(/Select a database dump/i).some((el) => el.getAttribute('type') === 'file'),
    ).toBe(true)
    expect(screen.getByText(/processed entirely in your browser/i)).toBeInTheDocument()
  })

  it('displays the selected file name once a file is loaded', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({ fileName: 'store.sql', step: 'database' }),
    )

    render(<SqlExtractor />)

    expect(screen.getByRole('button', { name: /store\.sql/i })).toBeInTheDocument()
  })

  it('shows an error alert when an error is present', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({ error: 'Unable to parse SQL dump. Please check the file format.' }),
    )

    render(<SqlExtractor />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(
      'Unable to parse SQL dump. Please check the file format.',
    )
  })

  it('shows database selection options after a file is loaded', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'database',
        fileName: 'store.sql',
        dump: {
          databases: [
            {
              name: 'shop_db',
              createStatement: 'CREATE DATABASE shop_db',
              useStatement: 'USE shop_db',
              tables: [{ name: 'users' }, { name: 'orders' }],
            },
          ],
          format: 'mysql' as const,
          preamble: '',
          postamble: '',
        },
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByText(/Select database/i)).toBeInTheDocument()
    expect(screen.getByText('shop_db')).toBeInTheDocument()
  })

  it('shows table selection after a database is chosen', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'tables',
        fileName: 'store.sql',
        selectedDatabase: 'shop_db',
        database: {
          name: 'shop_db',
          createStatement: 'CREATE DATABASE shop_db',
          useStatement: 'USE shop_db',
          tables: [
            {
              name: 'users',
              database: 'shop_db',
              createStatement: 'CREATE TABLE users',
              format: 'mysql' as const,
              preDataStatements: [],
              dataStatements: [],
              postDataStatements: [],
            },
            {
              name: 'orders',
              database: 'shop_db',
              createStatement: 'CREATE TABLE orders',
              format: 'mysql' as const,
              preDataStatements: [],
              dataStatements: [],
              postDataStatements: [],
            },
          ],
        },
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByText(/Select tables/i)).toBeInTheDocument()
    expect(screen.getByText('Select all')).toBeInTheDocument()
    expect(screen.getByText('users')).toBeInTheDocument()
    expect(screen.getByText('orders')).toBeInTheDocument()
  })

  it('shows the download step once tables are selected', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'export',
        fileName: 'store.sql',
        selectedDatabase: 'shop_db',
        selectedTables: ['users'],
        database: {
          name: 'shop_db',
          createStatement: 'CREATE DATABASE shop_db',
          useStatement: 'USE shop_db',
          tables: [
            {
              name: 'users',
              database: 'shop_db',
              createStatement: 'CREATE TABLE users',
              format: 'mysql' as const,
              preDataStatements: [],
              dataStatements: [],
              postDataStatements: [],
            },
          ],
        },
        allTablesSelected: true,
        someTablesSelected: false,
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByRole('radiogroup', { name: /Export format/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /SQL/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /CSV/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Excel/i })).toBeInTheDocument()

    expect(screen.getByLabelText(/Convert and download/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Convert/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start over/i })).toBeInTheDocument()
    expect(screen.getByText(/1 table ready to convert/i)).toBeInTheDocument()
  })

  it('offers the archive for download once conversion has finished', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'export',
        fileName: 'store.sql',
        selectedDatabase: 'shop_db',
        selectedTables: ['users'],
        exportFormat: 'csv' as const,
        status: 'done' as const,
        result: {
          filename: 'shop_db-export.zip',
          bytes: new Uint8Array([1, 2, 3]),
          files: ['users.csv'],
          tableCount: 1,
        },
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByRole('button', { name: /Download ZIP/i })).toBeInTheDocument()
    expect(screen.getByText('shop_db-export.zip')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Convert$/i })).not.toBeInTheDocument()
  })

  it('selects an export format through the format buttons', () => {
    const selectFormat = vi.fn()
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'export',
        selectedDatabase: 'shop_db',
        selectedTables: ['users'],
        selectFormat,
      }),
    )

    render(<SqlExtractor />)
    fireEvent.click(screen.getByRole('radio', { name: /Excel/i }))

    expect(selectFormat).toHaveBeenCalledWith('xlsx')
  })

  it('invokes onFile when a file is uploaded', async () => {
    const loadFile = vi.fn(() => true)
    mockedUseSqlDump.mockReturnValue(baseHookState({ loadFile }))

    const { container } = render(<SqlExtractor />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    const file = new File([SAMPLE_SQL], 'dump.sql', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [file] } })

    // file.text() is async; wait for the promise to resolve
    await waitFor(() => {
      expect(loadFile).toHaveBeenCalledWith(SAMPLE_SQL, 'dump.sql')
    })
  })

  it('renders a start-over button that resets state', () => {
    const reset = vi.fn()
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'export',
        fileName: 'store.sql',
        selectedDatabase: 'shop_db',
        selectedTables: ['users'],
        database: {
          name: 'shop_db',
          createStatement: 'CREATE DATABASE shop_db',
          useStatement: 'USE shop_db',
          tables: [],
        },
        extract: vi.fn(() => ({
          sql: '-- extracted',
          database: 'shop_db',
          tableCount: 1,
        })),
        reset,
      }),
    )

    render(<SqlExtractor />)
    fireEvent.click(screen.getByRole('button', { name: /Start over/i }))
    expect(reset).toHaveBeenCalled()
  })
})

describe('SqlExtractor: source formats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('advertises only the formats that have a parser behind them', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({ sourceFormat: null, confidence: null }),
    )

    render(<SqlExtractor />)

    expect(screen.getByText(/Supported: MySQL · MariaDB · PostgreSQL\./)).toBeInTheDocument()
  })

  it('names the engine a loaded dump was recognised as', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        fileName: 'shop.sql',
        sourceFormat: DATABASE_FORMATS.postgresql,
        confidence: 'detected',
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByText(/Read as a PostgreSQL dump\./)).toBeInTheDocument()
  })

  it('says an engine was assumed rather than claiming a detection', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        fileName: 'hand-written.sql',
        sourceFormat: DATABASE_FORMATS.mysql,
        confidence: 'assumed',
      }),
    )

    render(<SqlExtractor />)

    expect(
      screen.getByText(/No engine markers found — read as MySQL\./),
    ).toBeInTheDocument()
  })

  it('calls a PostgreSQL grouping a schema, not a database', () => {
    mockedUseSqlDump.mockReturnValue(
      baseHookState({
        step: 'database',
        fileName: 'shop.sql',
        sourceFormat: DATABASE_FORMATS.postgresql,
        confidence: 'detected',
        dump: {
          format: 'postgresql' as const,
          databases: [
            {
              name: 'public',
              catalog: 'shop',
              createStatement: '',
              useStatement: '',
              tables: [{ name: 'customers' }],
            },
          ],
          preamble: '',
          postamble: '',
        },
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByText(/Select schema/i)).toBeInTheDocument()
    expect(screen.queryByText(/Select database/i)).not.toBeInTheDocument()
    // The owning database is shown rather than dropped.
    expect(screen.getByText('shop.')).toBeInTheDocument()
  })
})
