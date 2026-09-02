#!/usr/bin/env node
import { Command } from 'commander'
import { extractCommand } from './commands/extract.js'
import type { ExtractOptions } from './commands/extract.js'

const program = new Command()

program
  .name('sql-extractor')
  .description('Extract databases and tables from MySQL/MariaDB SQL dumps')
  .version('0.1.0')

program
  .argument('<file>', 'SQL dump file path')
  .option('-d, --database <name>', 'Database name to extract')
  .option('-a, --all', 'Extract all tables')
  .option('-t, --tables <list>', 'Comma-separated table names to extract')
  .option('-o, --output <path>', 'Output file path')
  .action(async (file: string, options: ExtractOptions) => {
    try {
      await extractCommand(file, options)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(msg + '\n')
      process.exitCode = 1
    }
  })

program.parse(process.argv)
