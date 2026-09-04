import prompts from 'prompts'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

const MANUAL_ENTRY = '__manual__'

export interface Entry {
  title: string
  value: string
  isDir: boolean
}

/** List subdirectories and .sql files in a directory, dirs first, alphabetical within each. */
export function listEntries(dir: string): Entry[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }

  const entries: Entry[] = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)

    let isDir: boolean
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }

    if (isDir) {
      entries.push({ title: `${name}/`, value: full, isDir: true })
    } else if (name.toLowerCase().endsWith('.sql')) {
      entries.push({ title: name, value: full, isDir: false })
    }
  }

  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.title.localeCompare(b.title)
  })

  return entries
}

/** Interactively navigate the filesystem with arrow keys and pick a .sql file. */
export async function browseForFile(
  startDir: string = process.cwd(),
): Promise<string> {
  let dir = resolve(startDir)

  for (;;) {
    const entries = listEntries(dir)
    const parent = dirname(dir)

    const choices: Entry[] = [
      ...(parent !== dir
        ? [{ title: '.. (up a directory)', value: parent, isDir: true }]
        : []),
      ...entries,
      { title: 'Type a path manually', value: MANUAL_ENTRY, isDir: false },
    ]

    const response = await prompts({
      type: 'select',
      name: 'choice',
      message: `Select a .sql file — ${dir}`,
      choices: choices.map((c) => ({ title: c.title, value: c.value })),
    })

    if (response.choice === undefined) {
      console.log('No file selected. Exiting.')
      process.exit(1)
    }

    if (response.choice === MANUAL_ENTRY) {
      const manual = await prompts({
        type: 'text',
        name: 'path',
        message: 'SQL dump file path',
      })

      if (!manual.path) {
        console.log('No path given. Exiting.')
        process.exit(1)
      }

      return manual.path
    }

    const chosen = choices.find((c) => c.value === response.choice)
    if (chosen?.isDir) {
      dir = response.choice
      continue
    }

    return response.choice
  }
}
