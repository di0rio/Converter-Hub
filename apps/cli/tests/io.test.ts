import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSqlFile } from '../src/utils/io.js'

describe('readSqlFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sql-extractor-io-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('reads a file that is within the ceiling', async () => {
    const path = join(dir, 'small.sql')
    await writeFile(path, 'SELECT 1;', 'utf-8')

    expect(await readSqlFile(path)).toBe('SELECT 1;')
  })

  it('refuses a file past the ceiling before reading it', async () => {
    const path = join(dir, 'big.sql')
    await writeFile(path, 'x'.repeat(2048), 'utf-8')

    // A small explicit ceiling stands in for the real one, so the test does
    // not have to write hundreds of megabytes to exercise the refusal.
    await expect(readSqlFile(path, 1024)).rejects.toThrow(
      /The largest dump this tool reads is 1 KB/,
    )
  })

  it('accepts a file exactly at the ceiling', async () => {
    const path = join(dir, 'exact.sql')
    await writeFile(path, 'x'.repeat(1024), 'utf-8')

    await expect(readSqlFile(path, 1024)).resolves.toHaveLength(1024)
  })

  it('reports a missing file without reading anything', async () => {
    await expect(readSqlFile(join(dir, 'nope.sql'))).rejects.toThrow(
      /File not found/,
    )
  })
})
