import type { DatabaseFormat } from '../formats/index.js'

export interface SqlDump {
  format: DatabaseFormat
  databases: Database[]
  preamble: string
  postamble: string
}

export interface Database {
  name: string
  catalog?: string
  createStatement: string
  useStatement: string
  tables: Table[]
}

export interface Table {
  name: string
  database: string
  format: DatabaseFormat
  createStatement: string
  preDataStatements: string[]
  dataStatements: string[]
  postDataStatements: string[]
}

export interface ExtractionOptions {
  database: string
  tables: string[] | 'all'
}

export interface ExtractionResult {
  sql: string
  database: string
  tableCount: number
}
