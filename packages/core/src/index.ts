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
export { toTabular, extractColumns, countRows } from './tabular/index.js'
export { normalizeColumns } from './tabular/columns.js'
export { generateExport } from './generator/index.js'
export {
  toCsv,
  toXlsx,
  createZip,
  neutralizeFormula,
  toFileName,
  uniqueName,
} from './generator/writers.js'
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
export type { TabularTable } from './tabular/columns.js'
export type { ExportFormat, ExportResult } from './generator/index.js'
export type {
  CsvDelimiter,
  CsvOptions,
  ExportFile,
} from './generator/writers.js'
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
  SqliteReadError,
} from './sqlite/index.js'
export {
  readSqliteDatabase,
  isSqliteFile,
  isWalFile,
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

export { parseCsv, detectDelimiter } from './csv/index.js'
export type { CsvParseOptions } from './csv/index.js'
export {
  DataFormatError,
  parseJson,
  parseJsonl,
  toJsonl,
  recordsToTable,
  tableToRecords,
} from './records/index.js'
export {
  bytesToBase64,
  encodeBase64,
  decodeBase64,
  encodeHex,
  decodeHex,
  encodeUrl,
  decodeUrl,
  encodeHtmlEntities,
  decodeHtmlEntities,
} from './utilities/encoding.js'
export { CASE_STYLES, toCase } from './utilities/case.js'
export type { CaseStyle } from './utilities/case.js'
export { convertTimestamp } from './utilities/timestamp.js'
export type { Timestamp, TimestampRead } from './utilities/timestamp.js'
export { convertColor } from './utilities/color.js'
export type { Color } from './utilities/color.js'
export { jsonToTypeScript } from './utilities/json-to-typescript.js'
