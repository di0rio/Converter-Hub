import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractCommand } from '../src/commands/extract.js'

// Synthetic SQL dump fixture (no real production data)
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
(1, 'Alice'),
(2, 'Bob');
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

CREATE DATABASE IF NOT EXISTS \`blog_db\`;
USE \`blog_db\`;

DROP TABLE IF EXISTS \`posts\`;
CREATE TABLE \`posts\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`title\` varchar(255) NOT NULL,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`

describe('extractCommand', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sql-extractor-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('reads a valid SQL file successfully', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    const outputPath = join(tmpDir, 'out.sql')
    await extractCommand(dumpPath, {
      database: 'shop_db',
      all: true,
      output: outputPath,
    })

    const output = await readFile(outputPath, 'utf-8')
    expect(output).toContain('CREATE DATABASE')
    expect(output).toContain('USE `shop_db`;')
  })

  it('throws File not found error for missing file', async () => {
    const missingPath = join(tmpDir, 'non-existent.sql')
    await expect(
      extractCommand(missingPath, { database: 'shop_db', all: true, output: join(tmpDir, 'o.sql') }),
    ).rejects.toThrow(`Error: File not found: ${missingPath}`)
  })

  it('throws Database not found error for unknown database', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    await expect(
      extractCommand(dumpPath, {
        database: 'unknown_db',
        all: true,
        output: join(tmpDir, 'o.sql'),
      }),
    ).rejects.toThrow('Error: Database not found: unknown_db')
  })

  it('throws Table not found error for unknown table', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    await expect(
      extractCommand(dumpPath, {
        database: 'shop_db',
        tables: 'nonexistent_table',
        output: join(tmpDir, 'o.sql'),
      }),
    ).rejects.toThrow('Error: Table not found: nonexistent_table')
  })

  it('successfully extracts all tables', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    const outputPath = join(tmpDir, 'out.sql')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await extractCommand(dumpPath, {
      database: 'shop_db',
      all: true,
      output: outputPath,
    })

    expect(existsSync(outputPath)).toBe(true)
    const output = await readFile(outputPath, 'utf-8')
    expect(output).toContain('CREATE TABLE `users`')
    expect(output).toContain('CREATE TABLE `orders`')
    expect(logSpy).toHaveBeenCalledWith(
      'Extracted 2 table(s) from database "shop_db" to ' + outputPath,
    )
    logSpy.mockRestore()
  })

  it('successfully extracts specific tables', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    const outputPath = join(tmpDir, 'out.sql')
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await extractCommand(dumpPath, {
      database: 'shop_db',
      tables: 'users',
      output: outputPath,
    })

    const output = await readFile(outputPath, 'utf-8')
    expect(output).toContain('CREATE TABLE `users`')
    expect(output).not.toContain('CREATE TABLE `orders`')
    expect(logSpy).toHaveBeenCalledWith(
      'Extracted 1 table(s) from database "shop_db" to ' + outputPath,
    )
    logSpy.mockRestore()
  })

  it('generates an output file with correct SQL content', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    const outputPath = join(tmpDir, 'result.sql')
    await extractCommand(dumpPath, {
      database: 'shop_db',
      tables: 'orders',
      output: outputPath,
    })

    const output = await readFile(outputPath, 'utf-8')
    expect(output).toContain('USE `shop_db`;')
    expect(output).toContain('CREATE TABLE `orders`')
    // Should not leak unrelated tables from other databases
    expect(output).not.toContain('CREATE TABLE `posts`')
    // Should not leak unrelated tables from the same database
    expect(output).not.toContain('CREATE TABLE `users`')
  })

  it('splits comma-separated tables correctly', async () => {
    const dumpPath = join(tmpDir, 'dump.sql')
    await writeFile(dumpPath, SAMPLE_SQL, 'utf-8')

    const outputPath = join(tmpDir, 'out.sql')
    await extractCommand(dumpPath, {
      database: 'shop_db',
      tables: 'users,orders',
      output: outputPath,
    })

    const output = await readFile(outputPath, 'utf-8')
    expect(output).toContain('CREATE TABLE `users`')
    expect(output).toContain('CREATE TABLE `orders`')
  })
})
