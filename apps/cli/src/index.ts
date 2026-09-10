#!/usr/bin/env node
import { Command } from 'commander'
import { SUPPORTED_FORMATS } from '@sql-extractor/core'
import { extractCommand } from './commands/extract.js'
import type { ExtractOptions } from './commands/extract.js'
import { sqliteCommand } from './commands/sqlite.js'
import type { SqliteOptions } from './commands/sqlite.js'

const FORMATS = SUPPORTED_FORMATS.map((format) => format.id).join(', ')

const program = new Command()

program
  .name('sql-extractor')
  .description(`Extract databases and tables from SQL dumps (${FORMATS})`)
  .version('0.1.0')

program
  .argument('[file]', 'SQL dump file path (omit to browse and pick one)')
  .option('-d, --database <name>', 'Database name to extract')
  .option('-a, --all', 'Extract all tables')
  .option('-t, --tables <list>', 'Comma-separated table names to extract')
  .option('-o, --output <path>', 'Output file path')
  .option(
    '-f, --format <name>',
    `Source database format (${FORMATS}); detected from the dump when omitted`,
  )
  .action(async (file: string | undefined, options: ExtractOptions) => {
    try {
      await extractCommand(file, options)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(msg + '\n')
      process.exitCode = 1
    }
  })

program
  .command('sqlite')
  .description(
    'Convert a SQLite database. Its -wal is read too, whether passed or ' +
      'sitting beside it, so the result reflects the latest committed state.',
  )
  .argument(
    '<files...>',
    'SQLite database path, optionally followed by its -wal and -shm',
  )
  .option('-f, --format <name>', 'Output format (csv, xlsx, sql)', 'csv')
  .option('-t, --tables <list>', 'Comma-separated table names to convert')
  .option('-o, --output <path>', 'Output ZIP path')
  .action(async (files: string[], options: SqliteOptions) => {
    try {
      await sqliteCommand(files, options)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(msg + '\n')
      process.exitCode = 1
    }
  })

program.parse(process.argv)
