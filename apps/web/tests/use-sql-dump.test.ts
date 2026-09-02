import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSqlDump } from '@/hooks/use-sql-dump'

// Synthetic SQL dump fixture — no real production data
const SAMPLE_SQL = `-- MySQL dump
CREATE DATABASE IF NOT EXISTS \`shop_db\` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;
USE \`shop_db\`;

DROP TABLE IF EXISTS \`users\`;
CREATE TABLE \`users\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`name\` varchar(100) NOT NULL,
  \`email\` varchar(255) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES \`users\` WRITE;
INSERT INTO \`users\` VALUES
(1, 'Alice Johnson', 'alice@example.com'),
(2, 'Bob Smith', 'bob@example.com');
UNLOCK TABLES;

DROP TABLE IF EXISTS \`orders\`;
CREATE TABLE \`orders\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`user_id\` int NOT NULL,
  \`total\` decimal(10,2) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

LOCK TABLES \`orders\` WRITE;
INSERT INTO \`orders\` VALUES
(1, 1, 19.99);
UNLOCK TABLES;
`

describe('useSqlDump', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads a valid SQL dump and auto-selects its only database', () => {
    const { result } = renderHook(() => useSqlDump())

    expect(result.current.step).toBe('file')
    expect(result.current.dump).toBeNull()

    let ok = false
    act(() => {
      ok = result.current.loadFile(SAMPLE_SQL, 'dump.sql')
    })

    expect(ok).toBe(true)
    expect(result.current.fileName).toBe('dump.sql')
    expect(result.current.error).toBeNull()
    // A dump with exactly one database has nothing to choose between.
    expect(result.current.selectedDatabase).toBe('shop_db')
    expect(result.current.step).toBe('tables')
    expect(result.current.dump?.databases).toHaveLength(1)
    expect(result.current.dump?.databases[0].name).toBe('shop_db')
    expect(result.current.dump?.databases[0].tables).toHaveLength(2)
  })

  it('parses the expected databases and tables', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
    })

    const dump = result.current.dump!
    expect(dump.databases.map((d) => d.name)).toEqual(['shop_db'])
    const shop = dump.databases[0]
    expect(shop.tables.map((t) => t.name)).toEqual(['users', 'orders'])
    // Table data should be captured
    expect(shop.tables[0].insertStatements).toHaveLength(1)
    expect(shop.tables[0].insertStatements[0]).toContain("'alice@example.com'")
  })

  it('rejects an empty file instead of stalling on an empty dump', () => {
    const { result } = renderHook(() => useSqlDump())

    let ok = true
    act(() => {
      ok = result.current.loadFile('', 'bad.sql')
    })

    expect(ok).toBe(false)
    expect(result.current.dump).toBeNull()
    expect(result.current.step).toBe('file')
    expect(result.current.error).toContain('empty')
  })

  it('rejects a file with no recognisable database or table', () => {
    const { result } = renderHook(() => useSqlDump())

    let ok = true
    act(() => {
      ok = result.current.loadFile('hello world, not a dump at all', 'notes.txt')
    })

    expect(ok).toBe(false)
    expect(result.current.dump).toBeNull()
    expect(result.current.error).toContain('No databases or tables were found')
  })

  it('recovers a database name from a dump that declares none', () => {
    const { result } = renderHook(() => useSqlDump())

    const singleDbDump = [
      '-- MySQL dump 10.13',
      '-- Host: localhost    Database: shop',
      'CREATE TABLE `users` (`id` int NOT NULL, PRIMARY KEY (`id`));',
      "INSERT INTO `users` VALUES (1);",
    ].join('\n')

    act(() => {
      result.current.loadFile(singleDbDump, 'shop.sql')
    })

    expect(result.current.dump?.databases.map((d) => d.name)).toEqual(['shop'])
    expect(result.current.dump?.databases[0].tables.map((t) => t.name)).toEqual(['users'])
  })

  it('selects a database and exposes it', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
    })

    act(() => {
      result.current.selectDatabase('shop_db')
    })

    expect(result.current.selectedDatabase).toBe('shop_db')
    expect(result.current.database?.name).toBe('shop_db')
    // No tables selected yet, so we are on the tables step
    expect(result.current.step).toBe('tables')
    expect(result.current.selectedTables).toEqual([])
  })

  it('toggles individual tables', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
    })

    act(() => {
      result.current.toggleTable('users')
    })
    expect(result.current.selectedTables).toEqual(['users'])
    expect(result.current.step).toBe('export')
    expect(result.current.someTablesSelected).toBe(true)
    expect(result.current.allTablesSelected).toBe(false)

    act(() => {
      result.current.toggleTable('orders')
    })
    expect(result.current.selectedTables).toEqual(['users', 'orders'])
    expect(result.current.allTablesSelected).toBe(true)

    // Toggle off
    act(() => {
      result.current.toggleTable('users')
    })
    expect(result.current.selectedTables).toEqual(['orders'])
  })

  it('toggles all tables at once', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
    })

    act(() => {
      result.current.toggleAllTables()
    })
    expect(result.current.selectedTables).toEqual(['users', 'orders'])
    expect(result.current.allTablesSelected).toBe(true)

    act(() => {
      result.current.toggleAllTables()
    })
    expect(result.current.selectedTables).toEqual([])
  })

  it('converts the selected table into a downloadable SQL archive', async () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
      result.current.toggleTable('users')
    })

    act(() => {
      result.current.convert()
    })

    await waitFor(() => expect(result.current.status).toBe('done'))

    expect(result.current.result).not.toBeNull()
    expect(result.current.result!.filename).toBe('shop_db-export.zip')
    expect(result.current.result!.tableCount).toBe(1)
    expect(result.current.result!.files).toEqual(['shop_db.sql'])
    expect(result.current.result!.bytes.byteLength).toBeGreaterThan(0)
  })

  it('produces one CSV per table and a single workbook for xlsx', async () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
    })
    act(() => {
      result.current.toggleAllTables()
      result.current.selectFormat('csv')
    })
    act(() => {
      result.current.convert()
    })
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.result!.files).toEqual(['users.csv', 'orders.csv'])

    act(() => {
      result.current.selectFormat('xlsx')
    })
    // Changing the format must invalidate the previous archive.
    expect(result.current.result).toBeNull()

    act(() => {
      result.current.convert()
    })
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.result!.files).toEqual(['shop_db.xlsx'])
  })

  it('refuses to convert when no table is selected', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
    })

    act(() => {
      result.current.convert()
    })

    expect(result.current.result).toBeNull()
    expect(result.current.error).toBe('Select at least one table to export.')
  })

  it('clears a previous archive when the table selection changes', async () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
      result.current.toggleTable('users')
    })
    act(() => {
      result.current.convert()
    })
    await waitFor(() => expect(result.current.status).toBe('done'))
    expect(result.current.result).not.toBeNull()

    act(() => {
      result.current.toggleTable('orders')
    })

    expect(result.current.result).toBeNull()
    expect(result.current.status).toBe('idle')
  })

  it('selecting a new database clears the previously selected tables', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
      result.current.toggleTable('users')
    })
    expect(result.current.selectedTables).toEqual(['users'])

    act(() => {
      result.current.selectDatabase('shop_db')
    })
    expect(result.current.selectedTables).toEqual([])
  })

  it('resets all state', () => {
    const { result } = renderHook(() => useSqlDump())

    act(() => {
      result.current.loadFile(SAMPLE_SQL, 'dump.sql')
      result.current.selectDatabase('shop_db')
      result.current.toggleTable('users')
    })
    expect(result.current.step).toBe('export')

    act(() => {
      result.current.reset()
    })

    expect(result.current.dump).toBeNull()
    expect(result.current.fileName).toBe('')
    expect(result.current.selectedDatabase).toBe('')
    expect(result.current.selectedTables).toEqual([])
    expect(result.current.error).toBeNull()
    expect(result.current.step).toBe('file')
  })
})
