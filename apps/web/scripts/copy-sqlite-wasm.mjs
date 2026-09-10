// Publish wa-sqlite's WebAssembly binary as a static asset.
//
// The SQLite build is fetched over HTTP at runtime rather than inlined, so the
// binary has to be reachable from the browser. Copying it out of node_modules
// at build and dev time keeps it out of version control while guaranteeing the
// served copy always matches the installed version — a committed copy silently
// goes stale the first time wa-sqlite is upgraded.
//
// A missing copy fails only in a browser, at the moment someone opens a
// database: the tests resolve the binary from node_modules directly and stay
// green. tests/copy-sqlite-wasm.test.ts is what catches that.
//
// Like ensure-react-symlinks.mjs, this is deliberately NOT a postinstall hook:
// installing this repository must never execute its code.
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

// Skip the copy when the target is already this exact build. Vercel builds on a
// cold checkout, so the common local case is a no-op.
const current = statSync(target, { throwIfNoEntry: false })
if (!current || current.size !== statSync(source).size) {
  copyFileSync(source, target)
  console.log(`copied ${WASM_FILE} to public/`)
}
