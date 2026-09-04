import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import {
  MAX_DUMP_BYTES,
  isOversizedDump,
  oversizedDumpMessage,
} from '@sql-extractor/core'

export async function readSqlFile(
  filePath: string,
  maxBytes: number = MAX_DUMP_BYTES,
): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`Error: File not found: ${filePath}`)
  }

  // Check the size before reading. The whole file becomes one string, so a
  // dump past the ceiling has to be refused rather than half-read.
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    throw new Error(`Error: Unable to read file: ${filePath}`)
  }

  if (isOversizedDump(size, maxBytes)) {
    throw new Error('Error: ' + oversizedDumpMessage(size, maxBytes))
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
