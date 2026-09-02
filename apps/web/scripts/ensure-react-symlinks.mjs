// React module-identity fix for Vitest with Bun workspaces.
//
// Deliberately NOT a postinstall hook. Installing this repository must never
// execute its code, because maintainers install contributor branches to review
// them. This runs from the web "test" script instead, which already executes
// project code, and from "bun run --filter web setup" when needed by hand.
//
// Bun stores react/react-dom in node_modules/.bun and hard-links mirrors into
// apps/web/node_modules. react-dom (CommonJS) resolves react to its .bun scope while
// Vite-inlined source (lucide-react, components) resolves to the app's node_modules — same
// physical files, different resolved paths => two React module instances => React 19 hooks
// throw "Cannot read properties of null (reading 'useContext')".
//
// This replaces the hard-linked react/react-dom mirrors with symlinks to the .bun store
// realpath so every import shares one resolved path.
import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const webModules = join(root, 'apps', 'web', 'node_modules')
const storeDir = join(root, 'node_modules', '.bun')

if (!existsSync(storeDir)) process.exit(0)

for (const name of ['react', 'react-dom']) {
  const matches = readdirSync(storeDir).filter((d) => d.startsWith(`${name}@`))
  if (matches.length === 0) continue

  const target = join(storeDir, matches[0], 'node_modules', name)
  const link = join(webModules, name)
  if (!existsSync(target)) continue

  const alreadyLinked =
    existsSync(link) && lstatSync(link).isSymbolicLink() && readlinkSync(link) === target

  if (alreadyLinked) continue

  if (existsSync(link)) rmSync(link, { recursive: true, force: true })
  symlinkSync(target, link)
  console.log(`[ensure-react-symlinks] linked ${relative(root, link)} -> ${relative(root, target)}`)
}
