import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The SQLite WebAssembly binary is fetched over HTTP at runtime, so a missing
 * copy fails only in a browser, at the moment someone opens a database. Every
 * other test resolves it from node_modules and passes regardless. This is the
 * one that notices.
 */

const require = createRequire(import.meta.url)
const projectRoot = dirname(__dirname)
const WASM = 'wa-sqlite.wasm'

beforeAll(() => {
  execFileSync('node', [join(projectRoot, 'scripts', 'copy-sqlite-wasm.mjs')])
})

describe('copy-sqlite-wasm', () => {
  it('publishes the SQLite binary the browser asks for', () => {
    const published = statSync(join(projectRoot, 'public', WASM), {
      throwIfNoEntry: false,
    })
    expect(published, `${WASM} is missing from public/`).toBeDefined()

    const source = join(
      dirname(require.resolve('wa-sqlite/dist/wa-sqlite.mjs')),
      WASM,
    )
    expect(published?.size).toBe(statSync(source).size)
  })
})
