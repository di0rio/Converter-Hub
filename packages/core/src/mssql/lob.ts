/**
 * Values kept off the row, read from the pages they were moved to.
 *
 * A row holds one of two kinds of pointer instead of the value. A legacy
 * `text`, `ntext` or `image` column holds a 16-byte text pointer: 8 bytes of
 * timestamp, then the page, file and slot of the value's root. A `max` column
 * whose value no longer fits, or a `varchar(n)` pushed to row-overflow, holds
 * an inline root in a complex column: a 12-byte header whose first byte is 2
 * (row-overflow) or 4 (large value), then 12-byte links — where the data so
 * far ends in the value, then page, file and slot.
 *
 * Either way the trail ends in records of kind 4, blob fragments, on text
 * pages. Past the usual 4-byte record header each one opens with an 8-byte
 * blob id and a 2-byte structure type:
 *
 * - SMALL_ROOT (0): a 2-byte length, 4 bytes unused, then up to 64 bytes of
 *   data.
 * - LARGE_ROOT_YUKON (5): 2-byte max links, cur links and level, 4 bytes
 *   unused, then 12-byte links as in an inline root.
 * - INTERNAL (2): max links, cur links and level, then 16-byte links — an
 *   8-byte offset, then page, file and slot.
 * - DATA (3): the data itself, to the end of the record.
 *
 * The layout follows OrcaMDF's reading of it, and SQL Server 2008 Internals,
 * table 7-1, for the inline root; no public Microsoft document describes it.
 * Like OrcaMDF, a node's value is its children's data one after another. The
 * offsets inside the tree are not needed for that, and whether an INTERNAL
 * node counts them from its own start or the value's is not documented, so
 * only the root's are used: its last link says how long the value is.
 *
 * Nothing on these pages is trusted. A pointer that leads nowhere, to the
 * wrong kind of record, back to a fragment the value already used, or deeper
 * than any real tree goes, gives no value rather than an error. And since each
 * fragment belongs to one value, all the values of one read together can hold
 * no more bytes, and visit no more fragments, than the text pages kept do;
 * past that, a crafted file that points many slots or rows at the same data
 * gets NULLs instead of running the tab out of memory.
 */

import { PAGE, PAGE_SIZE, readPage, readRecord, slotAt } from './pages.js'

const LOB = { smallRoot: 0, internal: 2, data: 3, largeRoot: 5 }

/** `status bits A` record kind of a piece of a large value. */
const BLOB_FRAGMENT = 4

/** Inline root types, from the first byte of the complex column. */
const ROW_OVERFLOW = 2
const INLINE_ROOT = 4

const TEXT_POINTER_BYTES = 16
const ROOT_HEADER_BYTES = 12
const LINK_BYTES = 12
const INTERNAL_LINK_BYTES = 16

/** A tree for a 2 GB value is a few levels deep; this is far past that. */
const MAX_DEPTH = 16

/** The most slots a page can have. */
const MAX_SLOTS = (PAGE_SIZE - 96) / 2

interface Link {
  /** Where the link's data ends in the value. */
  end: number
  address: number
  slot: number
}

function linkAt(v: DataView, at: number, endBytes: 4 | 8): Link {
  const end =
    endBytes === 4 ? v.getUint32(at, true) : Number(v.getBigUint64(at, true))
  const row = at + endBytes
  return {
    end,
    address: v.getUint16(row + 4, true) * 2 ** 32 + v.getUint32(row, true),
    slot: v.getUint16(row + 6, true),
  }
}

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

/** One value being gathered: its pieces so far, and the fragments used. */
interface Walk {
  parts: Uint8Array[]
  size: number
  used: Set<string>
}

export class Lobs {
  private bytesLeft: number
  private visitsLeft: number

  /** Text pages, by address. */
  constructor(private readonly pages: Map<number, Uint8Array>) {
    this.bytesLeft = pages.size * PAGE_SIZE
    this.visitsLeft = pages.size * MAX_SLOTS
  }

  /** The value a 16-byte text pointer leads to, or null. */
  fromTextPointer(pointer: Uint8Array): Uint8Array | null {
    if (pointer.length !== TEXT_POINTER_BYTES) return null
    const root = linkAt(view(pointer), 4, 4)
    return this.gather((walk) => this.node(root.address, root.slot, 0, walk))
  }

  /** The value an inline root in a complex column leads to, or null. */
  fromInlineRoot(root: Uint8Array): Uint8Array | null {
    const kind = root[0]
    if (kind !== ROW_OVERFLOW && kind !== INLINE_ROOT) return null
    const count = (root.length - ROOT_HEADER_BYTES) / LINK_BYTES
    if (!Number.isInteger(count)) return null
    return this.gather((walk) =>
      this.links(root, ROOT_HEADER_BYTES, count, 4, 0, walk),
    )
  }

  private gather(walk: (into: Walk) => boolean): Uint8Array | null {
    const into: Walk = { parts: [], size: 0, used: new Set() }
    if (!walk(into)) return null

    const out = new Uint8Array(into.size)
    let at = 0
    for (const part of into.parts) {
      if (at >= into.size) break
      const take = part.subarray(0, into.size - at)
      out.set(take, at)
      at += take.length
    }
    return out
  }

  /** A blob fragment's bytes past the record header, or null. */
  private fragment(address: number, slot: number): Uint8Array | null {
    const stored = this.pages.get(address)
    if (!stored) return null
    const page = readPage(stored, 0)
    if (page[1] !== PAGE.textMix && page[1] !== PAGE.textTree) return null

    const v = new DataView(page.buffer, page.byteOffset, PAGE_SIZE)
    const at = slotAt(v, v.getUint16(22, true), slot)
    if (at < 0) return null
    const record = readRecord(page, v, at)
    return record?.kind === BLOB_FRAGMENT ? record.fixed : null
  }

  /** Adds all the data under one fragment, whatever structure it holds. */
  private node(
    address: number,
    slot: number,
    depth: number,
    walk: Walk,
  ): boolean {
    const key = address + ':' + slot
    if (depth > MAX_DEPTH || walk.used.has(key)) return false
    if (--this.visitsLeft < 0) return false
    walk.used.add(key)

    const bytes = this.fragment(address, slot)
    if (!bytes || bytes.length < 10) return false
    const v = view(bytes)

    switch (v.getUint16(8, true)) {
      case LOB.data:
        return this.take(bytes.subarray(10), walk)
      case LOB.smallRoot: {
        if (bytes.length < 16) return false
        const length = v.getUint16(10, true)
        return (
          length <= bytes.length - 16 &&
          this.take(bytes.subarray(16, 16 + length), walk)
        )
      }
      case LOB.largeRoot:
        if (bytes.length < 20) return false
        return this.links(bytes, 20, v.getUint16(12, true), 4, depth, walk)
      case LOB.internal:
        if (bytes.length < 16) return false
        return this.links(bytes, 16, v.getUint16(12, true), 8, depth, walk)
      default:
        return false
    }
  }

  private take(data: Uint8Array, walk: Walk): boolean {
    this.bytesLeft -= data.length
    if (this.bytesLeft < 0) return false
    walk.parts.push(data)
    walk.size += data.length
    return true
  }

  /**
   * Adds the data of a run of links, one after another. At the root, the
   * last link's end is the value's length: data short of it is a broken tree,
   * and data past it is not the value's.
   */
  private links(
    bytes: Uint8Array,
    first: number,
    count: number,
    endBytes: 4 | 8,
    depth: number,
    walk: Walk,
  ): boolean {
    const width = endBytes === 4 ? LINK_BYTES : INTERNAL_LINK_BYTES
    if (count < 1 || first + count * width > bytes.length) return false

    const v = view(bytes)
    let end = 0
    for (let i = 0; i < count; i++) {
      const link = linkAt(v, first + i * width, endBytes)
      if (!this.node(link.address, link.slot, depth + 1, walk)) return false
      end = link.end
    }

    if (depth > 0) return true
    if (walk.size < end) return false
    walk.size = end
    return true
  }
}
