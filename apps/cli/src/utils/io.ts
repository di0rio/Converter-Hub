import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export async function readSqlFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`Error: File not found: ${filePath}`)
  }

  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    throw new Error(`Error: Unable to read file: ${filePath}`)
  }
}

export async function writeOutputFile(
  filePath: string,
  content: string,
): Promise<void> {
  try {
    await writeFile(filePath, content, 'utf-8')
  } catch {
    throw new Error(`Error: Unable to generate output file: ${filePath}`)
  }
}
