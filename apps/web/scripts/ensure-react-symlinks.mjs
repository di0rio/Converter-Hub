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
// realpath so every import shares one resolved path. The links are relative, so moving or
// renaming the repository does not leave them dangling; they still resolve to the same realpath.
//
// Windows makes a symlink a privilege (Developer Mode or an administrator), so there the
// link is a directory junction, which is not — but a junction takes an absolute target.
// Moving the repository then leaves it pointing at the old path, and the next run relinks it.
//
// The new link is made beside the old one and renamed over it, so a failure leaves the
// hard-linked mirror in place rather than no react at all.
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

// existsSync follows symlinks, so it reports a dangling link as absent even though its
// path is still taken. lstat looks at the link itself.
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
  if (windows) symlinkSync(target, staged, 'junction')
  else symlinkSync(relative(dirname(link), target), staged)

  if (occupied(link)) rmSync(link, { recursive: true, force: true })
  renameSync(staged, link)
  console.log(
    `[ensure-react-symlinks] linked ${relative(root, link)} -> ${relative(root, target)}`,
  )
}
