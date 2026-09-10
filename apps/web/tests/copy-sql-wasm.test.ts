import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * The WASM binary is fetched over HTTP at runtime, so a missing or misnamed
 * copy fails only in a browser, at the moment a user opens a file — every test
 * here still passes, because Node resolves a different build of sql.js than a
 * browser does.
 *
 * sql.js declares a conditional export: a browser gets `sql-wasm-browser.js`,
 * which requests `sql-wasm-browser.wasm`; Node gets `sql-wasm.js`, which
 * requests `sql-wasm.wasm`. Publishing only the name this process resolves
 * leaves the browser asking for a file that was never copied. This asserts both
 * are served.
 */

const require = createRequire(import.meta.url)
const projectRoot = dirname(__dirname)
const publicDir = join(projectRoot, 'public')
const distDir = dirname(require.resolve('sql.js'))

beforeAll(() => {
  execFileSync('node', [join(projectRoot, 'scripts', 'copy-sql-wasm.mjs')])
})

describe('copy-sql-wasm', () => {
  it.each(['sql-wasm.wasm', 'sql-wasm-browser.wasm'])(
    'publishes %s to public/',
    (name) => {
      const published = statSync(join(publicDir, name), {
        throwIfNoEntry: false,
      })
      expect(published, `${name} is missing from public/`).toBeDefined()
      expect(published?.size).toBe(statSync(join(distDir, name)).size)
    },
  )
})
