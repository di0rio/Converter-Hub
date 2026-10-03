import { DataFormatError } from '@sql-extractor/core'

export type XmlValue = string | { [key: string]: XmlValue | XmlValue[] }

const ELEMENT = 1
const TEXT = 3
const CDATA = 4

// Browsers stop near 256 levels; this keeps a parser that does not from
// overflowing the stack.
const MAX_DEPTH = 256

function read(node: Element, depth = 0): XmlValue {
  if (depth > MAX_DEPTH) {
    throw new DataFormatError('This XML is nested too deeply to read.')
  }
  // No prototype, so an element named constructor or __proto__ is plain data.
  const value: Record<string, XmlValue | XmlValue[]> = Object.create(null)
  for (const attribute of Array.from(node.attributes)) {
    value[`@${attribute.name}`] = attribute.value
  }

  const text: string[] = []
  let hasChildren = false
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === ELEMENT) {
      hasChildren = true
      const name = child.nodeName
      const next = read(child as Element, depth + 1)
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

  // Entities are how a few bytes expand into gigabytes, and the browsers'
  // limits on them differ. A data file has no use for them.
  if (/<!ENTITY/i.test(text)) {
    throw new DataFormatError(
      'This XML declares entities, which this tool does not read.',
    )
  }

  let document: Document
  try {
    document = new DOMParser().parseFromString(
      text.replace(/^\ufeff/, ''),
      'application/xml',
    )
  } catch {
    throw refuse()
  }

  const root = document.documentElement
  if (!root || document.getElementsByTagName('parsererror').length > 0) {
    throw refuse()
  }
  return { [root.nodeName]: read(root) }
}
