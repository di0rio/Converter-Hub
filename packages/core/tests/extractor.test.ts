import { describe, it, expect, beforeAll } from 'vitest'
import { parseDump } from '../src/parser/index.js'
import { extractDatabase } from '../src/extractor/index.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const samplePath = resolve(
  import.meta.dirname,
  '../../../examples/mysql/sample.sql'
)

describe('extractDatabase', () => {
  let dump: ReturnType<typeof parseDump>

  beforeAll(() => {
    const sql = readFileSync(samplePath, 'utf-8')
    dump = parseDump(sql)
  })

  describe('extracting all tables', () => {
    it('extracts all tables from store_db', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.database).toBe('store_db')
      expect(result.tableCount).toBe(4)
      expect(result.sql).toContain('customers')
      expect(result.sql).toContain('products')
      expect(result.sql).toContain('categories')
      expect(result.sql).toContain('orders')
    })

    it('extracts all tables from blog_db', () => {
      const result = extractDatabase(dump, {
        database: 'blog_db',
        tables: 'all',
      })

      expect(result.database).toBe('blog_db')
      expect(result.tableCount).toBe(3)
      expect(result.sql).toContain('posts')
      expect(result.sql).toContain('comments')
      expect(result.sql).toContain('tags')
    })
  })

  describe('extracting specific tables', () => {
    it('extracts only customers from store_db', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(result.database).toBe('store_db')
      expect(result.tableCount).toBe(1)
      expect(result.sql).toContain('customers')
      expect(result.sql).not.toContain('products')
    })

    it('extracts multiple specific tables', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers', 'orders'],
      })

      expect(result.tableCount).toBe(2)
      expect(result.sql).toContain('customers')
      expect(result.sql).toContain('orders')
      expect(result.sql).not.toContain('products')
      expect(result.sql).not.toContain('categories')
    })

    it('extracts only posts from blog_db', () => {
      const result = extractDatabase(dump, {
        database: 'blog_db',
        tables: ['posts'],
      })

      expect(result.tableCount).toBe(1)
      expect(result.sql).toContain('posts')
      expect(result.sql).not.toContain('comments')
    })
  })

  describe('output format', () => {
    it('includes extraction header comments', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.sql).toContain('-- Extracted from MySQL dump')
      expect(result.sql).toContain('-- Database: store_db')
      expect(result.sql).toContain('-- Tables: 4')
    })

    it('includes preamble SET statements', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.sql).toContain('SET')
      expect(result.sql).toContain('CHARACTER_SET_CLIENT')
    })

    it('includes CREATE DATABASE and USE statements', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.sql).toContain('CREATE DATABASE')
      expect(result.sql).toContain('store_db')
      expect(result.sql).toContain('USE')
    })

    it('includes CREATE TABLE DDL for each table', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(result.sql).toContain('CREATE TABLE')
      expect(result.sql).toContain('`customers`')
      expect(result.sql).toContain('AUTO_INCREMENT')
    })

    it('includes INSERT statements', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(result.sql).toContain('INSERT INTO')
      expect(result.sql).toContain('Alice Johnson')
    })

    it('includes LOCK/UNLOCK when present', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(result.sql).toContain('LOCK TABLES')
      expect(result.sql).toContain('UNLOCK TABLES')
    })

    it('includes table-specific comments', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(result.sql).toContain('-- Table: customers')
    })

    it('includes postamble SET statements', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.sql).toContain('OLD_TIME_ZONE')
    })

    it('includes foreign key constraints in CREATE TABLE', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['orders'],
      })

      expect(result.sql).toContain('CONSTRAINT')
      expect(result.sql).toContain('REFERENCES')
    })

    it('includes LOCK and INSERT in correct order', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      const lockIdx = result.sql.indexOf('LOCK TABLES')
      const insertIdx = result.sql.indexOf('INSERT INTO')
      const unlockIdx = result.sql.indexOf('UNLOCK TABLES')

      expect(lockIdx).toBeLessThan(insertIdx)
      expect(insertIdx).toBeLessThan(unlockIdx)
    })
  })

  describe('error cases', () => {
    it('returns empty result for non-existent database', () => {
      const result = extractDatabase(dump, {
        database: 'nonexistent',
        tables: 'all',
      })

      expect(result.sql).toBe('')
      expect(result.database).toBe('nonexistent')
      expect(result.tableCount).toBe(0)
    })

    it('produces minimal dump when no tables match', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['nonexistent_table'],
      })

      expect(result.database).toBe('store_db')
      expect(result.tableCount).toBe(0)
      // Still produces a valid dump with the database and preamble, just no tables
      expect(result.sql).toContain('Extracted from MySQL dump')
      expect(result.sql).toContain('CREATE DATABASE')
      expect(result.sql).toContain('store_db')
      expect(result.sql).not.toContain('CREATE TABLE')
    })

    it('returns empty result for empty database', () => {
      const emptyDump = parseDump(`
CREATE DATABASE IF NOT EXISTS \`empty_db\`;
USE \`empty_db\`;
`)
      const result = extractDatabase(emptyDump, {
        database: 'empty_db',
        tables: 'all',
      })

      expect(result.database).toBe('empty_db')
      expect(result.tableCount).toBe(0)
    })
  })

  describe('immutability', () => {
    it('does not mutate the original dump', () => {
      const originalSql = readFileSync(samplePath, 'utf-8')
      const originalDump = parseDump(originalSql)

      // Deep clone for comparison
      const originalDatabases = JSON.parse(
        JSON.stringify(originalDump.databases)
      )

      extractDatabase(originalDump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(originalDump.databases).toEqual(originalDatabases)
    })
  })

  describe('determinism', () => {
    it('produces the same output for the same input', () => {
      const options = { database: 'store_db', tables: ['customers'] as string[] }

      const result1 = extractDatabase(dump, options)
      const result2 = extractDatabase(dump, options)

      expect(result1.sql).toBe(result2.sql)
      expect(result1.database).toBe(result2.database)
      expect(result1.tableCount).toBe(result2.tableCount)
    })

    it('produces consistent output across multiple calls', () => {
      const options = { database: 'blog_db', tables: 'all' as const }
      const results = Array.from({ length: 5 }, () =>
        extractDatabase(dump, options)
      )

      for (const result of results) {
        expect(result.sql).toBe(results[0].sql)
      }
    })
  })

  describe('table with no INSERTs', () => {
    it('includes CREATE TABLE but no INSERT statements', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['categories'],
      })

      expect(result.tableCount).toBe(1)
      expect(result.sql).toContain('CREATE TABLE')
      expect(result.sql).toContain('`categories`')
      // categories has no INSERT data in the sample
      expect(result.sql).not.toMatch(/INSERT INTO\s+`categories`/)
    })
  })
})
