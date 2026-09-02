import { describe, it, expect, beforeAll } from 'vitest'
import { parseDump } from '../src/parser/index.js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const samplePath = resolve(
  import.meta.dirname,
  '../../../examples/mysql/sample.sql'
)

describe('parseDump', () => {
  describe('parsing the sample fixture', () => {
    let dump: ReturnType<typeof parseDump>

    beforeAll(() => {
      const sql = readFileSync(samplePath, 'utf-8')
      dump = parseDump(sql)
    })

    it('finds both databases', () => {
      expect(dump.databases).toHaveLength(2)
      expect(dump.databases.map((d) => d.name)).toEqual([
        'store_db',
        'blog_db',
      ])
    })

    it('parses store_db tables', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      expect(storeDb.tables.map((t) => t.name)).toEqual([
        'customers',
        'products',
        'categories',
        'orders',
      ])
    })

    it('parses blog_db tables', () => {
      const blogDb = dump.databases.find((d) => d.name === 'blog_db')!
      expect(blogDb.tables.map((t) => t.name)).toEqual([
        'posts',
        'comments',
        'tags',
      ])
    })

    it('captures CREATE DATABASE statements', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      expect(storeDb.createStatement).toContain('CREATE DATABASE')
      expect(storeDb.createStatement).toContain('store_db')
    })

    it('captures USE statements', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      expect(storeDb.useStatement).toContain('USE')
      expect(storeDb.useStatement).toContain('store_db')
    })

    it('captures CREATE TABLE statements', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      const customers = storeDb.tables.find((t) => t.name === 'customers')!
      expect(customers.createStatement).toContain('CREATE TABLE')
      expect(customers.createStatement).toContain('`customers`')
      expect(customers.createStatement).toContain('AUTO_INCREMENT')
    })

    it('captures INSERT statements', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      const customers = storeDb.tables.find((t) => t.name === 'customers')!
      expect(customers.dataStatements.length).toBeGreaterThan(0)
      expect(customers.dataStatements[0]).toContain('INSERT INTO')
      expect(customers.dataStatements[0]).toContain('`customers`')
    })

    it('captures LOCK/UNLOCK statements', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      const customers = storeDb.tables.find((t) => t.name === 'customers')!
      expect(customers.preDataStatements.join('\n')).toContain('LOCK TABLES')
      expect(customers.postDataStatements.join('\n')).toContain('UNLOCK TABLES')
    })

    it('captures foreign key constraints in CREATE TABLE', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      const orders = storeDb.tables.find((t) => t.name === 'orders')!
      expect(orders.createStatement).toContain('CONSTRAINT')
      expect(orders.createStatement).toContain('REFERENCES')
    })

    it('captures preamble SET statements', () => {
      expect(dump.preamble).toContain('SET')
      expect(dump.preamble).toContain('CHARACTER_SET_CLIENT')
    })

    it('captures postamble SET statements', () => {
      expect(dump.postamble).toContain('SET')
      expect(dump.postamble).toContain('OLD_TIME_ZONE')
    })

    it('captures table database association', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      for (const table of storeDb.tables) {
        expect(table.database).toBe('store_db')
      }
    })

    it('has correct data in customers INSERT', () => {
      const storeDb = dump.databases.find((d) => d.name === 'store_db')!
      const customers = storeDb.tables.find((t) => t.name === 'customers')!
      const insertSql = customers.dataStatements[0]
      expect(insertSql).toContain("Alice Johnson")
      expect(insertSql).toContain("Bob Smith")
      expect(insertSql).toContain("Charlie Brown")
    })
  })

  describe('edge cases', () => {
    it('handles empty SQL', () => {
      const dump = parseDump('', { format: 'mysql' })
      expect(dump.databases).toHaveLength(0)
      expect(dump.preamble).toBe('')
      expect(dump.postamble).toBe('')
    })

    it('handles preamble-only SQL', () => {
      const sql = `/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;`
      const dump = parseDump(sql, { format: 'mysql' })
      expect(dump.databases).toHaveLength(0)
      expect(dump.preamble).toContain('SET')
    })

    it('handles single database with one table', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`test_db\`;
USE \`test_db\`;

CREATE TABLE \`users\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB;

INSERT INTO \`users\` VALUES (1);
`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(1)
      expect(dump.databases[0].name).toBe('test_db')
      expect(dump.databases[0].tables).toHaveLength(1)
      expect(dump.databases[0].tables[0].name).toBe('users')
      expect(dump.databases[0].tables[0].dataStatements).toHaveLength(1)
    })

    it('handles multiple databases', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db1\`;
USE \`db1\`;
CREATE TABLE \`t1\` (\`id\` int) ENGINE=InnoDB;

CREATE DATABASE IF NOT EXISTS \`db2\`;
USE \`db2\`;
CREATE TABLE \`t2\` (\`id\` int) ENGINE=InnoDB;
`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(2)
      expect(dump.databases[0].name).toBe('db1')
      expect(dump.databases[1].name).toBe('db2')
    })

    it('handles table with no INSERT statements', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`empty\` (\`id\` int) ENGINE=InnoDB;
`
      const dump = parseDump(sql)
      const table = dump.databases[0].tables[0]
      expect(table.dataStatements).toHaveLength(0)
    })

    it('handles table without lock/unlock', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`nolock\` (\`id\` int) ENGINE=InnoDB;
INSERT INTO \`nolock\` VALUES (1);
`
      const dump = parseDump(sql)
      const table = dump.databases[0].tables[0]
      expect(table.preDataStatements).toHaveLength(0)
      expect(table.postDataStatements).toHaveLength(0)
      expect(table.dataStatements).toHaveLength(1)
    })
  })

  describe('statement splitting edge cases', () => {
    it('handles string literals with semicolons', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`test\` (\`id\` int, \`msg\` varchar(100)) ENGINE=InnoDB;
INSERT INTO \`test\` VALUES (1, 'hello;world');
`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(1)
      const table = dump.databases[0].tables[0]
      expect(table.dataStatements).toHaveLength(1)
      expect(table.dataStatements[0]).toContain('hello;world')
    })

    it('handles backtick identifiers with escaped backticks', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`my\`db\`;
`
      // This is tricky — escaped backticks in identifiers
      // The parser should handle basic backtick identifiers
      const dump = parseDump(sql)
      // At minimum it shouldn't crash
      expect(dump).toBeDefined()
    })

    it('handles inline comments', () => {
      const sql = `
-- This is a comment
CREATE DATABASE IF NOT EXISTS \`db\`;
/* Block comment */
USE \`db\`;
# Hash comment
CREATE TABLE \`t\` (\`id\` int) ENGINE=InnoDB;
`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(1)
      expect(dump.databases[0].tables).toHaveLength(1)
    })

    it('handles conditional comments (version-specific SQL)', () => {
      const sql = `
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
/*!40101 SET NAMES utf8mb4 */;
CREATE TABLE \`t\` (\`id\` int) ENGINE=InnoDB;
`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(1)
      expect(dump.preamble).toContain('SET')
    })

    it('handles multi-line INSERT statements', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`t\` (\`id\` int, \`name\` varchar(100)) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES
(1, 'Alice'),
(2, 'Bob'),
(3, 'Charlie');
`
      const dump = parseDump(sql)
      const table = dump.databases[0].tables[0]
      expect(table.dataStatements).toHaveLength(1)
      expect(table.dataStatements[0]).toContain('Alice')
      expect(table.dataStatements[0]).toContain('Charlie')
    })

    it('handles double-quoted strings', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`t\` (\`id\` int, \`msg\` varchar(100)) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1, "hello world");
`
      const dump = parseDump(sql)
      const table = dump.databases[0].tables[0]
      expect(table.dataStatements).toHaveLength(1)
      expect(table.dataStatements[0]).toContain('hello world')
    })
  })

  describe('statement classification', () => {
    it('classifies CREATE DATABASE', () => {
      const sql = `CREATE DATABASE IF NOT EXISTS \`mydb\` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(1)
      expect(dump.databases[0].name).toBe('mydb')
    })

    it('classifies USE', () => {
      const sql = `USE \`mydb\`;`
      const dump = parseDump(sql)
      expect(dump.databases).toHaveLength(1)
      expect(dump.databases[0].name).toBe('mydb')
    })

    it('classifies CREATE TABLE', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE IF NOT EXISTS \`users\` (\`id\` int) ENGINE=InnoDB;
`
      const dump = parseDump(sql)
      expect(dump.databases[0].tables).toHaveLength(1)
    })

    it('classifies INSERT INTO', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`t\` (\`id\` int) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1);
INSERT INTO \`t\` VALUES (2);
`
      const dump = parseDump(sql)
      expect(dump.databases[0].tables[0].dataStatements).toHaveLength(2)
    })

    it('classifies LOCK TABLES', () => {
      const sql = `
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
CREATE TABLE \`t\` (\`id\` int) ENGINE=InnoDB;
LOCK TABLES \`t\` WRITE;
INSERT INTO \`t\` VALUES (1);
UNLOCK TABLES;
`
      const dump = parseDump(sql)
      const table = dump.databases[0].tables[0]
      expect(table.preDataStatements.join('\n')).toContain('LOCK TABLES')
      expect(table.postDataStatements.join('\n')).toContain('UNLOCK TABLES')
    })

    it('classifies SET statements in preamble', () => {
      const sql = `
SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS;
CREATE DATABASE IF NOT EXISTS \`db\`;
USE \`db\`;
SET FOREIGN_KEY_CHECKS=0;
CREATE TABLE \`t\` (\`id\` int) ENGINE=InnoDB;
`
      const dump = parseDump(sql)
      expect(dump.preamble).toContain('SET @OLD_FOREIGN_KEY_CHECKS')
      expect(dump.postamble).toContain('SET FOREIGN_KEY_CHECKS=0')
    })
  })
})
