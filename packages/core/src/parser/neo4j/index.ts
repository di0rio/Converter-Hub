import type { SqlDump, Database, Table } from '../../types/index.js'
import type { FormatParser, DataBlock } from '../shared/format-parser.js'
import { ANSI_DIALECT } from '../shared/dialect.js'
import {
  readColumns as readColumnsShared,
  readInsertBlock,
  countInsertRows,
} from '../shared/script-parser.js'
import { tableFromDocuments } from '../shared/documents.js'

/**
 * Read a Cypher script's nodes — `CREATE (n:Label {key: value, ...})`.
 *
 * Nodes sharing a label become a table and their properties become its
 * columns, which is a real mapping: a `:Person` node set is a table of people.
 *
 * Relationships are not. A graph's edges are the part this model has nowhere
 * to put — database, table, row has no place for "this node points at that
 * one" — so they are counted and reported, never invented into a table. That
 * loss is what keeps this format `experimental`, and the catalog note and the
 * app both say so before anyone exports.
 */

const DEFAULT_DATABASE = 'neo4j'

/** `CREATE (n:Label {` or `MERGE (n:Label {` — a node with properties. */
const NODE =
  /\b(?:CREATE|MERGE)\s*\(\s*[A-Za-z_][\w]*\s*:\s*([A-Za-z_][\w]*)\s*(?:{|\))/g

/** A relationship arrow between two nodes, in either direction. */
const RELATIONSHIP =
  /-\s*\[\s*:?[A-Za-z_][\w]*[^\]]*\]\s*->|<-\s*\[\s*:?[A-Za-z_][\w]*[^\]]*\]\s*-/g

/**
 * Read a Cypher property map into a record.
 *
 * Cypher writes unquoted keys and single-quoted strings, so this is not JSON
 * and cannot be handed to `JSON.parse`. Only scalars are read; a nested map or
 * list is kept as its source text, the same rule the other document readers
 * use for values that have no column of their own.
 */
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

    // Walk to the comma that ends this value, respecting nesting and quotes.
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
    index++ // step past the comma
  }

  return properties
}

/** One Cypher scalar as the value a cell should hold. */
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

  // A map, a list or a function call: carry the source text rather than guess.
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
      properties = readProperties(body)
    }

    const existing = labels.get(label)
    if (existing) existing.push(properties)
    else labels.set(label, [properties])
  }

  const tables: Table[] = []
  for (const [label, nodes] of labels) {
    // A label whose nodes carry no properties has no columns, so no table.
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
    // Say what was dropped, in the dump itself, rather than losing it quietly.
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

/** The body of a `{...}` starting at `open`, respecting nesting and quotes. */
function readBalancedBraces(text: string, open: number): string {
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

  return ''
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
