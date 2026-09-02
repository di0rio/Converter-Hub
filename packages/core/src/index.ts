export { parseDump, getParser, UnsupportedFormatError } from './parser/index.js'
export { extractDatabase } from './extractor/index.js'
export { toTabular, extractColumns, countRows } from './tabular/index.js'
export { generateExport, toCsv, toXlsx, createZip } from './generator/index.js'
export {
  DATABASE_FORMATS,
  SUPPORTED_FORMATS,
  describeFormat,
  detectFormat,
  isDatabaseFormat,
} from './formats/index.js'

export type { ParseOptions } from './parser/index.js'
export type { TabularTable } from './tabular/index.js'
export type { ExportFormat, ExportFile, ExportResult } from './generator/index.js'

export type {
  DatabaseFormat,
  FormatConfidence,
  FormatDescriptor,
  FormatDetection,
  NamespaceKind,
} from './formats/index.js'

export type {
  SqlDump,
  Database,
  Table,
  ExtractionOptions,
  ExtractionResult,
} from './types/index.js'
