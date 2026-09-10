// Publish sql.js's WASM binary as a static asset.
//
// sql.js fetches `sql-wasm.wasm` at runtime rather than inlining it, so the
// file has to be reachable over HTTP. Copying it out of node_modules at build
// and dev time keeps the binary out of version control while guaranteeing the
// served copy always matches the installed version — a committed copy silently
// goes stale the first time sql.js is upgraded.
//
// Like ensure-react-symlinks.mjs, this is deliberately NOT a postinstall hook:
// installing this repository must never execute its code.
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WASM = 'sql-wasm.wasm'
const require = createRequire(import.meta.url)
const publicDir = join(dirname(dirname(fileURLToPath(import.meta.url))), 'public')

const source = join(dirname(require.resolve('sql.js')), WASM)
const target = join(publicDir, WASM)

// Skip the copy when the target is already this exact build. Vercel runs the
// build on a cold checkout, so the common local case is a no-op.
const current = statSync(target, { throwIfNoEntry: false })
if (!current || current.size !== statSync(source).size) {
  mkdirSync(publicDir, { recursive: true })
  copyFileSync(source, target)
  console.log(`copied ${WASM} to public/`)
}
