// Bun hard-links react into apps/web/node_modules, so Vite and react-dom
// resolve it under two paths and React hooks break in tests. Linking both to
// the store fixes that. Not a postinstall hook on purpose: installing a branch
// should never run its code.

import {
  existsSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const webModules = join(root, 'apps', 'web', 'node_modules')
const storeDir = join(root, 'node_modules', '.bun')
const windows = process.platform === 'win32'

function occupied(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

function linksTo(link, target) {
  if (!occupied(link) || !lstatSync(link).isSymbolicLink()) return false
  return resolve(dirname(link), readlinkSync(link)) === resolve(target)
}

if (!existsSync(storeDir)) process.exit(0)

for (const name of ['react', 'react-dom']) {
  const matches = readdirSync(storeDir).filter((d) => d.startsWith(`${name}@`))
  if (matches.length === 0) continue

  const target = join(storeDir, matches[0], 'node_modules', name)
  const link = join(webModules, name)
  if (!existsSync(target) || linksTo(link, target)) continue

  const staged = `${link}.linking`
  if (occupied(staged)) rmSync(staged, { recursive: true, force: true })
  // Symlinks need Developer Mode on Windows; junctions do not.
  if (windows) symlinkSync(target, staged, 'junction')
  else symlinkSync(relative(dirname(link), target), staged)

  if (occupied(link)) rmSync(link, { recursive: true, force: true })
  renameSync(staged, link)
  console.log(
    `[ensure-react-symlinks] linked ${relative(root, link)} -> ${relative(root, target)}`,
  )
}
