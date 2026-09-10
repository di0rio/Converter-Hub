// Publish sql.js's WASM binaries as static assets.
//
// sql.js fetches its `.wasm` at runtime rather than inlining it, so the file
// has to be reachable over HTTP. Copying it out of node_modules at build and
// dev time keeps the binary out of version control while guaranteeing the
// served copy always matches the installed version — a committed copy silently
// goes stale the first time sql.js is upgraded.
//
// Both builds are copied. sql.js declares a conditional export: a browser
// resolves `sql-wasm-browser.js`, which requests `sql-wasm-browser.wasm`, while
// Node resolves `sql-wasm.js` and requests `sql-wasm.wasm`. Resolving from this
// script picks the Node name, so shipping only that one leaves the browser
// asking for a file that was never published — a 404 that surfaces as an
// unreadable file rather than as a missing asset.
//
// Like ensure-react-symlinks.mjs, this is deliberately NOT a postinstall hook:
// installing this repository must never execute its code.
import { createRequire } from 'node:module'
import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BINARIES = ['sql-wasm.wasm', 'sql-wasm-browser.wasm']

const require = createRequire(import.meta.url)
const publicDir = join(
  dirname(dirname(fileURLToPath(import.meta.url))),
  'public',
)
const distDir = dirname(require.resolve('sql.js'))

mkdirSync(publicDir, { recursive: true })

for (const name of BINARIES) {
  const source = join(distDir, name)
  const target = join(publicDir, name)
  // Skip the copy when the target is already this exact build. Vercel runs the
  // build on a cold checkout, so the common local case is a no-op.
  const current = statSync(target, { throwIfNoEntry: false })
  if (current && current.size === statSync(source).size) continue
  copyFileSync(source, target)
  console.log(`copied ${name} to public/`)
}
