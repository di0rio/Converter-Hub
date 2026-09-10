export {
  parseDump,
  getParser,
  findParser,
  readableFormats,
  UnsupportedFormatError,
} from './parser/index.js'
export { extractDatabase } from './extractor/index.js'
export {
  MAX_DUMP_BYTES,
  formatBytes,
  isOversizedDump,
  oversizedDumpMessage,
} from './limits/index.js'
export {
  toTabular,
  extractColumns,
  countRows,
  normalizeColumns,
} from './tabular/index.js'
export {
  generateExport,
  toCsv,
  toXlsx,
  createZip,
  neutralizeFormula,
  toFileName,
  uniqueName,
} from './generator/index.js'
export { toSqlInserts } from './generator/sql-inserts.js'
export {
  CATALOG,
  DATABASE_FORMATS,
  SUPPORTED_FORMATS,
  EXPERIMENTAL_FORMATS,
  allFormats,
  formatsWithStatus,
  describeFormat,
  detectFormat,
  isDatabaseFormat,
  isReadable,
} from './formats/index.js'

export type { ParseOptions } from './parser/index.js'
export type { TabularTable } from './tabular/index.js'
export type {
  CsvDelimiter,
  CsvOptions,
  ExportFormat,
  ExportFile,
  ExportResult,
} from './generator/index.js'
export type { SqlInsertsOptions } from './generator/sql-inserts.js'

export type {
  DatabaseFormat,
  DialectFamily,
  FormatConfidence,
  FormatDescriptor,
  FormatDetection,
  NamespaceKind,
  SupportStatus,
} from './formats/index.js'

export type {
  SqlDump,
  Database,
  Table,
  ExtractionOptions,
  ExtractionResult,
} from './types/index.js'

export {
  toCellText,
  toSqlLiteral,
  sqliteToTabular,
  sqliteToSql,
  groupSqliteFiles,
} from './sqlite/index.js'
export {
  readSqliteDatabase,
  isSqliteFile,
  isWalFile,
  SqliteReadError,
  SQLITE_HEADER_BYTES,
} from './sqlite/reader.js'
export type {
  SqliteValue,
  SqliteColumn,
  SqliteTable,
  SqliteDatabase,
  SqliteFileGroup,
  UnreadableTable,
} from './sqlite/index.js'
export type {
  SqliteFileSet,
  WasmSupplier,
  ReadOptions,
} from './sqlite/reader.js'
