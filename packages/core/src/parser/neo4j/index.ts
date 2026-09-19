import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ANSI_DIALECT } from '../shared/dialect.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { tableFromDocuments } from '../shared/documents.js'

const DEFAULT_DATABASE = 'neo4j'

const NODE =
  /\b(?:CREATE|MERGE)\s*\(\s*[A-Za-z_][\w]*\s*:\s*([A-Za-z_][\w]*)\s*(?:{|\))/g

const RELATIONSHIP =
  /-\s*\[\s*:?[A-Za-z_][^\]]*\]\s*->|<-\s*\[\s*:?[A-Za-z_][^\]]*\]\s*-/g

function readProperties(body: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  let index = 0

  while (index < body.length) {
    const key = /\s*([A-Za-z_][\w]*)\s*:\s*/y
    key.lastIndex = index
    const match = key.exec(body)
    if (!match) break

    index = key.lastIndex
    const name = match[1] as string
    const start = index

    let depth = 0
    let quote: string | null = null
    while (index < body.length) {
      const ch = body[index] as string

      if (quote !== null) {
        if (ch === '\\') index++
        else if (ch === quote) quote = null
      } else if (ch === "'" || ch === '"') {
        quote = ch
      } else if (ch === '{' || ch === '[') {
        depth++
      } else if (ch === '}' || ch === ']') {
        depth--
      } else if (ch === ',' && depth === 0) {
        break
      }

      index++
    }

    properties[name] = decodeValue(body.slice(start, index).trim())
    index++
  }

  return properties
}

function decodeValue(raw: string): unknown {
  if (raw.length === 0) return null
  if (/^(null|NULL)$/.test(raw)) return null
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)

  const quote = raw[0]
  if (
    (quote === "'" || quote === '"') &&
    raw.endsWith(quote) &&
    raw.length >= 2
  ) {
    return raw.slice(1, -1).replace(/\\(.)/g, '$1')
  }

  return raw
}

export function parseNeo4jDump(text: string): SqlDump {
  const labels = new Map<string, Record<string, unknown>[]>()

  NODE.lastIndex = 0
  let node: RegExpExecArray | null
  while ((node = NODE.exec(text)) !== null) {
    const label = node[1] as string
    const opensProperties = text[NODE.lastIndex - 1] === '{'

    let properties: Record<string, unknown> = {}
    if (opensProperties) {
      const body = readBalancedBraces(text, NODE.lastIndex - 1)
      if (body === null) break
      properties = readProperties(body)
    }

    const existing = labels.get(label)
    if (existing) existing.push(properties)
    else labels.set(label, [properties])
  }

  const tables: Table[] = []
  for (const [label, nodes] of labels) {
    if (nodes.every((n) => Object.keys(n).length === 0)) continue
    tables.push(tableFromDocuments(label, DEFAULT_DATABASE, 'neo4j', nodes))
  }

  RELATIONSHIP.lastIndex = 0
  const relationships = (text.match(RELATIONSHIP) ?? []).length

  const database: Database = {
    name: DEFAULT_DATABASE,
    createStatement: '',
    useStatement: '',
    tables,
  }

  return {
    format: 'neo4j',
    databases: tables.length > 0 ? [database] : [],
    preamble:
      relationships > 0
        ? '-- ' +
          relationships +
          ' relationship(s) in this graph were not extracted: a table has\n' +
          '-- nowhere to put an edge. Only nodes and their properties are read.'
        : '',
    postamble: '',
  }
}

function readBalancedBraces(text: string, open: number): string | null {
  let depth = 0
  let quote: string | null = null

  for (let i = open; i < text.length; i++) {
    const ch = text[i] as string

    if (quote !== null) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(open + 1, i)
    }
  }

  return null
}

export function readColumns(createStatement: string): string[] {
  return readColumnsShared(createStatement, ANSI_DIALECT)
}

export function readDataBlock(statement: string): DataBlock {
  return readInsertBlock(statement, ANSI_DIALECT)
}

export function countDataRows(statement: string): number {
  return countInsertRows(statement, ANSI_DIALECT)
}

export const neo4jParser: FormatParser = {
  format: 'neo4j',
  parse: parseNeo4jDump,
  readColumns,
  readDataBlock,
  countDataRows,
}
