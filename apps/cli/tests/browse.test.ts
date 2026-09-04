import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import prompts from 'prompts'
import { listEntries, browseForFile } from '../src/commands/browse.js'

vi.mock('prompts')
const mockedPrompts = vi.mocked(prompts)

describe('listEntries', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sql-extractor-browse-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('lists directories before files, both alphabetically', async () => {
    await mkdir(join(tmpDir, 'zeta'))
    await mkdir(join(tmpDir, 'alpha'))
    await writeFile(join(tmpDir, 'b.sql'), '')
    await writeFile(join(tmpDir, 'a.sql'), '')

    const entries = listEntries(tmpDir)

    expect(entries.map((e) => e.title)).toEqual(['alpha/', 'zeta/', 'a.sql', 'b.sql'])
  })

  it('filters out non-.sql files and dotfiles', async () => {
    await writeFile(join(tmpDir, 'dump.sql'), '')
    await writeFile(join(tmpDir, 'readme.txt'), '')
    await writeFile(join(tmpDir, '.hidden.sql'), '')

    const entries = listEntries(tmpDir)

    expect(entries.map((e) => e.title)).toEqual(['dump.sql'])
  })

  it('returns an empty list for an unreadable directory', () => {
    const entries = listEntries(join(tmpDir, 'does-not-exist'))
    expect(entries).toEqual([])
  })
})

describe('browseForFile', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sql-extractor-browse-'))
    mockedPrompts.mockReset()
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('navigates into a subdirectory and picks a .sql file', async () => {
    await mkdir(join(tmpDir, 'dumps'))
    const target = join(tmpDir, 'dumps', 'shop.sql')
    await writeFile(target, '')

    mockedPrompts
      .mockResolvedValueOnce({ choice: join(tmpDir, 'dumps') })
      .mockResolvedValueOnce({ choice: target })

    const result = await browseForFile(tmpDir)

    expect(result).toBe(target)
  })

  it('falls back to manual text entry', async () => {
    const manualPath = '/some/manual/path.sql'

    mockedPrompts
      .mockResolvedValueOnce({ choice: '__manual__' })
      .mockResolvedValueOnce({ path: manualPath })

    const result = await browseForFile(tmpDir)

    expect(result).toBe(manualPath)
  })

  it('exits when no file is selected', async () => {
    mockedPrompts.mockResolvedValueOnce({ choice: undefined })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit called')
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(browseForFile(tmpDir)).rejects.toThrow('exit called')
    expect(logSpy).toHaveBeenCalledWith('No file selected. Exiting.')

    exitSpy.mockRestore()
    logSpy.mockRestore()
  })
})
