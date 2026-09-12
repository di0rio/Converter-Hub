import { DataFormatError } from '@sql-extractor/core'

/**
 * XML as a plain value, read with the browser's own parser.
 *
 * The shape is fixed, so the same document always gives the same value:
 *
 * - the document becomes `{ [root]: value }`, names kept as the parser reports
 *   them, namespace prefix included;
 * - an attribute becomes `"@name"`;
 * - a child element becomes a property, and one that repeats becomes a list in
 *   document order;
 * - an element holding only text becomes that text, and an empty one `""`;
 * - text beside attributes or children goes under `"#text"`, each piece
 *   trimmed and joined by a space. Comments and processing instructions are
 *   left out; CDATA is text.
 *
 * `DOMParser` builds an inert document: it runs nothing and fetches nothing,
 * so an external entity or DTD in the file is never resolved.
 */

export type XmlValue = string | { [key: string]: XmlValue | XmlValue[] }

const ELEMENT = 1
const TEXT = 3
const CDATA = 4

function read(node: Element): XmlValue {
  const value: Record<string, XmlValue | XmlValue[]> = {}
  for (const attribute of Array.from(node.attributes)) {
    value[`@${attribute.name}`] = attribute.value
  }

  const text: string[] = []
  let hasChildren = false
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === ELEMENT) {
      hasChildren = true
      const name = child.nodeName
      const next = read(child as Element)
      const existing = value[name]
      if (existing === undefined) value[name] = next
      else if (Array.isArray(existing)) existing.push(next)
      else value[name] = [existing, next]
    } else if (child.nodeType === TEXT || child.nodeType === CDATA) {
      text.push(child.nodeValue ?? '')
    }
  }

  if (!hasChildren && node.attributes.length === 0) return text.join('')

  const pieces = text.map((piece) => piece.trim()).filter(Boolean)
  if (pieces.length > 0) value['#text'] = pieces.join(' ')
  return value
}

export function parseXml(text: string): XmlValue {
  const refuse = () => new DataFormatError('This file is not well-formed XML.')

  let document: Document
  try {
    document = new DOMParser().parseFromString(
      text.replace(/^\ufeff/, ''),
      'application/xml',
    )
  } catch {
    throw refuse()
  }

  // A browser reports a syntax error as a document holding <parsererror>,
  // whose text quotes the file - so it is detected, never shown.
  const root = document.documentElement
  if (!root || document.getElementsByTagName('parsererror').length > 0) {
    throw refuse()
  }
  return { [root.nodeName]: read(root) }
}
