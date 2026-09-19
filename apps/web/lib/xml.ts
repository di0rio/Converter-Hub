import { DataFormatError } from '@sql-extractor/core'

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

  const root = document.documentElement
  if (!root || document.getElementsByTagName('parsererror').length > 0) {
    throw refuse()
  }
  return { [root.nodeName]: read(root) }
}
