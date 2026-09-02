import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SqlExtractor } from '@/components/sql-extractor'
import { useSqlDump } from '@/hooks/use-sql-dump'

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
    database: null,
    error: null,
    allTablesSelected: false,
    someTablesSelected: false,
    loadFile: vi.fn(),
    selectDatabase: vi.fn(),
    toggleTable: vi.fn(),
    toggleAllTables: vi.fn(),
    extract: vi.fn(() => null),
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
    expect(screen.getByText(/Select SQL file/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Choose SQL file/i })).toBeInTheDocument()
  })

  it('exposes an accessible file upload input', () => {
    mockedUseSqlDump.mockReturnValue(baseHookState())

    const { container } = render(<SqlExtractor />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input).not.toBeNull()
    expect(input.type).toBe('file')
    expect(input.accept).toBe('.sql,text/plain')
    // The section is labelled "Select SQL file" and the input is associated with the
    // visible label via htmlFor.
    expect(screen.getByRole('region', { name: /Select SQL file/i })).toBeInTheDocument()
    expect(
      screen.getAllByLabelText(/Select SQL file/i).some((el) => el.getAttribute('type') === 'file'),
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
              insertStatements: [],
              indexes: [],
            },
            {
              name: 'orders',
              database: 'shop_db',
              createStatement: 'CREATE TABLE orders',
              insertStatements: [],
              indexes: [],
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
        step: 'download',
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
              insertStatements: [],
              indexes: [],
            },
          ],
        },
        allTablesSelected: true,
        someTablesSelected: false,
        extract: vi.fn(() => ({
          sql: '-- extracted\nCREATE TABLE users;\n',
          database: 'shop_db',
          tableCount: 1,
        })),
      }),
    )

    render(<SqlExtractor />)

    expect(screen.getByLabelText(/Download/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download SQL/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start over/i })).toBeInTheDocument()
    expect(screen.getByText('shop_db')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
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
        step: 'download',
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
