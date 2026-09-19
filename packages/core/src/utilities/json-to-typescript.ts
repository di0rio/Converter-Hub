import { parseJson } from '../records/index.js'

type Kind = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array'

type Shape = { kinds: Kind[]; object?: ObjectShape; items?: Shape }

type ObjectShape = {
  seen: number
  fields: Map<string, { shape: Shape; count: number }>
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/

function kindOf(value: unknown): Kind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const type = typeof value
  return type === 'string' || type === 'number' || type === 'boolean'
    ? type
    : 'object'
}

function add(shape: Shape, value: unknown): void {
  const kind = kindOf(value)
  if (!shape.kinds.includes(kind)) shape.kinds.push(kind)

  if (kind === 'object') {
    shape.object ??= { seen: 0, fields: new Map() }
    shape.object.seen++
    for (const [key, field] of Object.entries(value as object)) {
      let entry = shape.object.fields.get(key)
      if (!entry) {
        entry = { shape: { kinds: [] }, count: 0 }
        shape.object.fields.set(key, entry)
      }
      entry.count++
      add(entry.shape, field)
    }
  } else if (kind === 'array') {
    shape.items ??= { kinds: [] }
    for (const item of value as unknown[]) add(shape.items, item)
  }
}

function typeName(hint: string): string {
  const pascal = hint
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
  if (!pascal) return 'Item'
  return /^[A-Za-z_$]/.test(pascal) ? pascal : `T${pascal}`
}

class Writer {
  readonly names = new Set<string>()
  readonly declarations: string[] = []

  unique(base: string): string {
    let name = base
    for (let n = 2; this.names.has(name); n++) name = `${base}${n}`
    this.names.add(name)
    return name
  }

  type(shape: Shape, hint: string): string {
    if (shape.kinds.length === 0) return 'unknown'
    return shape.kinds
      .map((kind) => {
        if (kind === 'object')
          return this.interface(shape.object as ObjectShape, hint)
        if (kind === 'array') return this.array(shape.items as Shape, hint)
        return kind
      })
      .join(' | ')
  }

  array(items: Shape, hint: string): string {
    const inner = this.type(items, `${hint}Item`)
    return items.kinds.length > 1 ? `(${inner})[]` : `${inner}[]`
  }

  interface(object: ObjectShape, hint: string): string {
    const name = this.unique(typeName(hint))
    const slot = this.declarations.push('') - 1
    const lines = [...object.fields].map(([key, field]) => {
      const property = IDENTIFIER.test(key) ? key : JSON.stringify(key)
      const optional = field.count < object.seen ? '?' : ''
      return `  ${property}${optional}: ${this.type(field.shape, key)}`
    })
    this.declarations[slot] =
      `export interface ${name} {\n${lines.join('\n')}\n}\n`
    return name
  }
}

export function jsonToTypeScript(text: string, rootName = 'Root'): string {
  const shape: Shape = { kinds: [] }
  add(shape, parseJson(text))

  const writer = new Writer()
  if (shape.kinds.length === 1 && shape.object) {
    writer.interface(shape.object, rootName)
  } else {
    writer.names.add(rootName)
    const slot = writer.declarations.push('') - 1
    writer.declarations[slot] =
      `export type ${rootName} = ${writer.type(shape, rootName)}\n`
  }
  return writer.declarations.join('\n')
}
