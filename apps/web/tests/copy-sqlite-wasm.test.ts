import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
