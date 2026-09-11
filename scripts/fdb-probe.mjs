// Read a Firebird database with the core reader and print what it found:
// the header, each table's name, row count and column count, and the tables
// it could not read with the reason. Never prints row data.
//
//   bun run --filter @sql-extractor/core build
//   node scripts/fdb-probe.mjs /path/to/DATABASE.FDB

import { readFileSync } from 'node:fs'
import { isFdbFile, readFdbDatabase } from '../packages/core/dist/index.js'

const path = process.argv[2]
if (!path) {
  console.error('usage: node scripts/fdb-probe.mjs <file.fdb>')
  process.exit(2)
}

const bytes = new Uint8Array(readFileSync(path))
if (isFdbFile(bytes)) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  console.log(
    `page size ${view.getUint16(16, true)}, ODS ${view.getUint16(18, true) & 0x7fff}.${view.getUint16(62, true)}, ${bytes.length} bytes`,
  )
}

const started = Date.now()
try {
  const { tables, unreadable } = readFdbDatabase(bytes, { rowLimit: 0 })
  for (const table of tables) {
    console.log(
      `${table.name}\t${table.rowCount} rows\t${table.columns.length} columns`,
    )
  }
  for (const table of unreadable) {
    console.log(
      `UNREADABLE ${table.name}\t${table.reason}${table.detail ? `\t${table.detail}` : ''}`,
    )
  }
  console.log(
    `${tables.length} tables, ${unreadable.length} unreadable, ${Date.now() - started} ms`,
  )
} catch (error) {
  console.error(
    `FAILED: ${error.message}${error.detail ? ` (${error.detail})` : ''}`,
  )
  process.exit(1)
}
