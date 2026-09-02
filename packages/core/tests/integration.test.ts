import { describe, it, expect, beforeAll } from 'vitest'
import { parseDump } from '../src/parser/index.js'
import { extractDatabase } from '../src/extractor/index.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const samplePath = resolve(
  import.meta.dirname,
  '../../../examples/sample-mysql-dump.sql'
)

describe('integration: parse → extract', () => {
  let dump: ReturnType<typeof parseDump>

  beforeAll(() => {
    const sql = readFileSync(samplePath, 'utf-8')
    dump = parseDump(sql)
  })

  describe('end-to-end: store_db all tables', () => {
    it('contains all 4 tables from store_db', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.tableCount).toBe(4)
      expect(result.sql).toContain('`customers`')
      expect(result.sql).toContain('`products`')
      expect(result.sql).toContain('`categories`')
      expect(result.sql).toContain('`orders`')
    })

    it('contains CREATE TABLE for each table', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      const createMatches = result.sql.match(/CREATE TABLE/g)
      expect(createMatches).toHaveLength(4)
    })

    it('contains INSERT data for tables that have data', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      // customers, products, orders have INSERT data
      // categories does not
      expect(result.sql).toContain('INSERT INTO `customers`')
      expect(result.sql).toContain('INSERT INTO `products`')
      expect(result.sql).toContain('INSERT INTO `orders`')
    })

    it('contains all customer names', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      expect(result.sql).toContain('Alice Johnson')
      expect(result.sql).toContain('Bob Smith')
      expect(result.sql).toContain('Charlie Brown')
      expect(result.sql).toContain('Diana Prince')
      expect(result.sql).toContain('Eve Davis')
    })

    it('contains all product data', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['products'],
      })

      expect(result.sql).toContain('Wireless Mouse')
      expect(result.sql).toContain('Cotton T-Shirt')
      expect(result.sql).toContain('Organic Granola')
      expect(result.sql).toContain('Bluetooth Speaker')
      expect(result.sql).toContain('Denim Jacket')
    })

    it('preserves foreign key constraints in orders table', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['orders'],
      })

      expect(result.sql).toContain('fk_orders_customer')
      expect(result.sql).toContain('REFERENCES')
      expect(result.sql).toContain('ON DELETE CASCADE')
    })
  })

  describe('end-to-end: blog_db specific tables', () => {
    it('extracts only posts and comments', () => {
      const result = extractDatabase(dump, {
        database: 'blog_db',
        tables: ['posts', 'comments'],
      })

      expect(result.tableCount).toBe(2)
      expect(result.sql).toContain('`posts`')
      expect(result.sql).toContain('`comments`')
      expect(result.sql).not.toContain('`tags`')
    })

    it('contains all post titles', () => {
      const result = extractDatabase(dump, {
        database: 'blog_db',
        tables: ['posts'],
      })

      expect(result.sql).toContain('Getting Started with TypeScript')
      expect(result.sql).toContain('Building REST APIs with Node.js')
      expect(result.sql).toContain('Draft: Advanced Database Patterns')
    })

    it('contains all comment data', () => {
      const result = extractDatabase(dump, {
        database: 'blog_db',
        tables: ['comments'],
      })

      expect(result.sql).toContain('Jane Wilson')
      expect(result.sql).toContain('Mike Chen')
      expect(result.sql).toContain('Sarah Lee')
    })

    it('preserves foreign key constraint in comments', () => {
      const result = extractDatabase(dump, {
        database: 'blog_db',
        tables: ['comments'],
      })

      expect(result.sql).toContain('fk_comments_post')
      expect(result.sql).toContain('REFERENCES')
    })
  })

  describe('output is valid SQL structure', () => {
    it('starts with extraction header', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.sql.startsWith('-- Extracted from MySQL dump')).toBe(true)
    })

    it('contains USE statement after CREATE DATABASE', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      const createIdx = result.sql.indexOf('CREATE DATABASE')
      const useIdx = result.sql.indexOf('USE `store_db`')

      expect(createIdx).toBeGreaterThan(-1)
      expect(useIdx).toBeGreaterThan(createIdx)
    })

    it('each table has CREATE TABLE before INSERT', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      const tables = ['customers', 'products', 'orders']
      for (const tableName of tables) {
        const createIdx = result.sql.indexOf(
          `CREATE TABLE \`${tableName}\``
        )
        const insertIdx = result.sql.indexOf(`INSERT INTO \`${tableName}\``)

        expect(createIdx).toBeGreaterThan(-1)
        expect(insertIdx).toBeGreaterThan(createIdx)
      }
    })

    it('LOCK comes before INSERT and UNLOCK comes after INSERT', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      const lockIdx = result.sql.indexOf('LOCK TABLES `customers` WRITE')
      const insertIdx = result.sql.indexOf('INSERT INTO `customers`')
      const unlockIdx = result.sql.indexOf('UNLOCK TABLES')

      expect(lockIdx).toBeLessThan(insertIdx)
      expect(insertIdx).toBeLessThan(unlockIdx)
    })

    it('ends with newline', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      expect(result.sql.endsWith('\n')).toBe(true)
    })

    it('does not contain double blank lines in sequence (max one)', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: 'all',
      })

      // Allow at most two consecutive newlines (one blank line)
      expect(result.sql).not.toMatch(/\n\n\n/)
    })
  })

  describe('round-trip: parse extracted output', () => {
    it('extracted output can be re-parsed', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers', 'products'],
      })

      // Re-parse the extracted SQL
      const reParsed = parseDump(result.sql)

      expect(reParsed.databases.length).toBeGreaterThanOrEqual(1)
      const db = reParsed.databases.find((d) => d.name === 'store_db')
      expect(db).toBeDefined()
      expect(db!.tables).toHaveLength(2)
      expect(db!.tables.map((t) => t.name)).toEqual([
        'customers',
        'products',
      ])
    })

    it('re-parsed data matches original', () => {
      const result = extractDatabase(dump, {
        database: 'store_db',
        tables: ['customers'],
      })

      const reParsed = parseDump(result.sql)
      const db = reParsed.databases.find((d) => d.name === 'store_db')!
      const customers = db.tables.find((t) => t.name === 'customers')!

      expect(customers.dataStatements[0]).toContain('Alice Johnson')
      expect(customers.dataStatements[0]).toContain('Bob Smith')
    })
  })
})
