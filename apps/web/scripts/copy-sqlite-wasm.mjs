import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WASM_FILE = 'wa-sqlite.wasm'

const require = createRequire(import.meta.url)
const publicDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'public',
)
const source = join(
  dirname(require.resolve('wa-sqlite/dist/wa-sqlite.mjs')),
  WASM_FILE,
)
const target = join(publicDir, WASM_FILE)

mkdirSync(publicDir, { recursive: true })

const current = statSync(target, { throwIfNoEntry: false })
if (!current || current.size !== statSync(source).size) {
  copyFileSync(source, target)
  console.log(`copied ${WASM_FILE} to public/`)
}
