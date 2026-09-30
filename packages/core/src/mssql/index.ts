/**
 * Reading a SQL Server backup without restoring it.
 *
 * The database describes itself. Five base tables hold everything needed to
 * read the rest: `sysallocunits` says which pages belong to which rowset,
 * `sysrowsets` says which object a rowset belongs to, `sysrscols` gives the
 * physical layout of every column of every rowset, and `sysschobjs` and
 * `syscolpars` supply the names. Only the first three have to be known in
 * advance, and their layouts have not moved since SQL Server 2005; the other
 * two are then read exactly the way every user table is.
 *
 * Pages are found by sweeping the file once rather than by following the
 * allocation chains. Every page names the allocation unit it belongs to in its
 * own header, so one pass is enough — and a backup, which leaves out the
 * extents the database never allocated, stays readable without anyone having
 * to work out where the gaps are.
 */

import {
  SqliteReadError,
  type SqliteColumn,
  type SqliteDatabase,
  type SqliteTable,
  type SqliteValue,
  type UnreadableTable,
} from '../sqlite/index.js'
import { uniqueName } from '../generator/writers.js'
import {
  damaged,
  findImage,
  IMAGE_SEARCH_BYTES,
  isAllocated,
  isDataPage,
  isNullAt,
  isPfsPage,
  isSetStart,
  MssqlReadError,
  PAGE_SIZE,
  pageAddress,
  pageStamp,
  pfsPageFor,
  readPage,
  readPageHeader,
  readRecord,
  slotOffsets,
  type Record as PageRecord,
} from './pages.js'
import {
  decodeValue,
  declaredType,
  fixedWidth,
  isLargeObject,
  minimumBytes,
  typeInfo,
  type TypeInfo,
} from './values.js'

export { MssqlReadError, isBakFile, BAK_HEADER_BYTES } from './pages.js'

export interface MssqlReadOptions {
  rowLimit?: number | undefined
  /**
   * The code page `varchar` columns were written in. Windows-1252 covers the
   * western European collations, which is what a Latin-script database uses.
   */
  codePage?: string | undefined
  /**
   * The most table data to hold. A backup past it is refused with a message
   * rather than left to run the tab out of memory.
   */
  maxDataBytes?: number | undefined
}

/** The base tables, by the object id every SQL Server database gives them. */
const SYS = { rscols: 3, rowsets: 5, allocUnits: 7, schobjs: 34, colpars: 41 }

/** Only the in-row data of a heap or a clustered index holds the rows. */
const IN_ROW_DATA = 1

/** A clustered index is index 1 and a heap is index 0; either is the table. */
const TABLE_INDEXES = [1, 0]

/**
 * Record kinds that are rows. A heap row that outgrew its page moves, leaving
 * a stub behind that points to it; the stub is not a row, the moved record is.
 */
const ROW = 0
const FORWARDED = 1

/** `sysrscols.status`: the column was dropped and its bytes are dead. */
const DROPPED = 2

/** `sysschobjs.type` for a user table. */
const USER_TABLE = 'U'

interface Column {
  /** Its column id in the table, which is how `syscolpars` names it. */
  id: number
  info: TypeInfo
  /**
   * Where it sits in the fixed part of a record. Below zero, the column is
   * variable-length and this is minus its place among the variable columns.
   */
  offset: number
  nullBit: number
  bitPosition: number
}

interface Rowset {
  id: number
  rowCount: number
  /** `cmprlevel`: 0 unless the rowset uses row or page compression. */
  compression: number
}

interface Catalog {
  /** Rowsets by object and index — one per partition. */
  rowsets: Map<string, Rowset[]>
  /** The stamp an allocation unit's pages carry, by rowset id. */
  pagesOf: Map<number, number>
  /** Column layout, by rowset id. */
  layouts: Map<number, Column[]>
}

const rowsetKey = (objectId: number, indexId: number) =>
  objectId + ':' + indexId

/** The data pages of each allocation unit, by the stamp in their header. */
type PageStore = Map<number, Uint8Array[]>

/** What the sweep has kept so far. */
interface Sweep {
  /** Data pages by address. A later copy of a page replaces an earlier one. */
  data: Map<number, Uint8Array>
  /** The PFS pages, by address, to tell pages in use from freed ones. */
  pfs: Map<number, Uint8Array>
  /** Reached the start of another backup set in the same file. */
  done: boolean
  limit: number
}

function sweep(limit = Number.POSITIVE_INFINITY): Sweep {
  return { data: new Map(), pfs: new Map(), done: false, limit }
}

const TOO_LARGE =
  'This backup holds more table data than a browser tab can hold.'

/**
 * Keeps the pages of one stretch of the database image that the reader needs.
 *
 * Data pages are a fraction of a backup — the rest is indexes, large values,
 * allocation maps and the log — so keeping only these is what lets a backup
 * far larger than a tab's memory be read at all. `copy` decides whether they
 * are kept as views into `chunk` or cut loose from it.
 */
function collect(into: Sweep, chunk: Uint8Array, copy: boolean): void {
  const keep = (at: number) =>
    copy ? chunk.slice(at, at + PAGE_SIZE) : chunk.subarray(at, at + PAGE_SIZE)

  for (let at = 0; at + PAGE_SIZE <= chunk.length; at += PAGE_SIZE) {
    // A new backup set is where this one ends. Its blocks sit on 512-byte
    // boundaries, not on page ones, so every sector of the stretch is looked at.
    for (let sector = at; sector < at + PAGE_SIZE; sector += 512) {
      if (isSetStart(chunk, sector)) {
        into.done = true
        return
      }
    }

    if (isPfsPage(chunk, at)) {
      into.pfs.set(pageAddress(chunk, at), keep(at))
    } else if (isDataPage(chunk, at)) {
      into.data.set(pageAddress(chunk, at), keep(at))
      if (into.data.size * PAGE_SIZE > into.limit) {
        throw new MssqlReadError(TOO_LARGE, 'data pages past the limit')
      }
    }
  }
}

/** The kept data pages that are still in use, grouped by allocation unit. */
function inUse(kept: Sweep): PageStore {
  const store: PageStore = new Map()
  for (const [address, page] of kept.data) {
    const file = Math.floor(address / 2 ** 32)
    const pageId = address % 2 ** 32
    const pfs = kept.pfs.get(file * 2 ** 32 + pfsPageFor(pageId))
    if (pfs && !isAllocated(pfs, pageId)) continue

    const stamp = pageStamp(page)
    const list = store.get(stamp)
    if (list) list.push(page)
    else store.set(stamp, [page])
  }
  return store
}

class Reader {
  constructor(private readonly pages: PageStore) {}

  /** Every live record of an allocation unit, in the order its pages sit. */
  private *records(stamp: number): Generator<[PageRecord, DataView]> {
    for (const stored of this.pages.get(stamp) ?? []) {
      const page = readPage(stored, 0)
      const view = new DataView(page.buffer, page.byteOffset, PAGE_SIZE)
      const header = readPageHeader(view)
      if (header.level !== 0) continue

      for (const slot of slotOffsets(view, header.slotCount)) {
        const record = readRecord(page, view, slot)
        if (record && (record.kind === ROW || record.kind === FORWARDED))
          yield [record, view]
      }
    }
  }

  /**
   * The catalog, read at the fixed offsets of the three base tables whose
   * layout this reader has to know before it can read anything.
   *
   * Offsets below are from the start of the record; its fixed part begins
   * four bytes in, after the status bits and the fixed-part length.
   */
  catalog(): Catalog {
    // An allocation unit id carries the stamp its pages bear in bits 16 to
    // 63, which is what turns a swept page into a rowset.
    const pagesOf = new Map<number, number>()
    for (const [record, view] of this.records(SYS.allocUnits)) {
      if (record.fixed.length < 21 || record.fixed[8] !== IN_ROW_DATA) continue
      const { at } = record
      const auid = view.getBigUint64(at + 4, true)
      const owner = Number(view.getBigUint64(at + 13, true))
      pagesOf.set(owner, Number(auid >> 16n))
    }

    const rowsets = new Map<string, Rowset[]>()
    for (const [record, view] of this.records(SYS.rowsets)) {
      if (record.fixed.length < 36) continue
      const { at } = record
      const key = rowsetKey(
        view.getInt32(at + 13, true),
        view.getInt32(at + 17, true),
      )
      const rowset: Rowset = {
        id: Number(view.getBigUint64(at + 4, true)),
        rowCount: Number(view.getBigInt64(at + 31, true)),
        compression: view.getUint8(at + 39),
      }
      const list = rowsets.get(key)
      if (list) list.push(rowset)
      else rowsets.set(key, [rowset])
    }

    const layouts = new Map<number, Column[]>()
    for (const [record, view] of this.records(SYS.rscols)) {
      if (record.fixed.length < 50) continue
      const { at } = record
      if (view.getInt32(at + 40, true) & DROPPED) continue

      const rowset = Number(view.getBigUint64(at + 4, true))
      const column: Column = {
        id: view.getInt32(at + 12, true),
        info: typeInfo(view.getInt32(at + 28, true)),
        // Only the low half of either field is the position; the bits above
        // are flags this reader has no use for.
        offset: view.getInt16(at + 44, true),
        nullBit: view.getUint16(at + 48, true),
        bitPosition: view.getInt16(at + 52, true),
      }
      const list = layouts.get(rowset)
      if (list) list.push(column)
      else layouts.set(rowset, [column])
    }
    for (const list of layouts.values()) list.sort((a, b) => a.id - b.id)

    return { rowsets, pagesOf, layouts }
  }

  /** A whole rowset, decoded through a layout, up to `limit` rows. */
  rows(
    stamp: number,
    columns: readonly Column[],
    limit: number,
    codePage: string,
  ): SqliteValue[][] {
    const rows: SqliteValue[][] = []
    if (limit <= 0) return rows
    for (const [record] of this.records(stamp)) {
      rows.push(row(record, columns, codePage))
      if (rows.length >= limit) break
    }
    return rows
  }
}

function row(
  record: PageRecord,
  columns: readonly Column[],
  codePage: string,
): SqliteValue[] {
  const values: SqliteValue[] = []

  for (const { info, offset, nullBit, bitPosition } of columns) {
    if (isNullAt(record, nullBit) || isLargeObject(info.xtype)) {
      values.push(null)
      continue
    }

    if (offset < 0) {
      const stored = record.variable[-offset - 1]
      const present = stored && stored.length >= minimumBytes(info)
      values.push(present ? decodeValue(stored, info, 0, codePage) : null)
      continue
    }

    // A column added after a row was written is simply not in that row.
    const at = offset - 4
    const width = fixedWidth(info)
    if (at < 0 || at + width > record.fixed.length) {
      values.push(null)
      continue
    }
    values.push(
      decodeValue(
        record.fixed.subarray(at, at + width),
        info,
        bitPosition,
        codePage,
      ),
    )
  }

  return values
}

export function readMssqlBackup(
  bytes: Uint8Array,
  options: MssqlReadOptions = {},
): SqliteDatabase {
  return guarded(() => {
    const kept = sweep(options.maxDataBytes)
    collect(kept, bytes.subarray(findImage(bytes)), false)
    return build(inUse(kept), options)
  })
}

/** Read from the file in pieces this size, a whole number of pages. */
const CHUNK_BYTES = 4096 * PAGE_SIZE

/** All that is needed of a `Blob` or a `File`: its size, and part of it. */
export interface BlobLike {
  readonly size: number
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> }
}

/**
 * The same, for a backup too large to hold in memory whole.
 *
 * It is read a chunk at a time and only the pages the reader needs are kept,
 * so what the tab holds is the table data rather than the whole file.
 */
export async function readMssqlBackupBlob(
  blob: BlobLike,
  options: MssqlReadOptions = {},
): Promise<SqliteDatabase> {
  const slice = async (from: number, to: number) =>
    new Uint8Array(
      await blob.slice(from, Math.min(to, blob.size)).arrayBuffer(),
    )

  const head = await slice(0, IMAGE_SEARCH_BYTES + PAGE_SIZE)
  const start = guarded(() => findImage(head))
  const kept = sweep(options.maxDataBytes)

  for (let at = start; at < blob.size && !kept.done; at += CHUNK_BYTES) {
    const chunk = await slice(at, at + CHUNK_BYTES)
    guarded(() => collect(kept, chunk, true))
  }
  return guarded(() => build(inUse(kept), options))
}

function guarded<T>(read: () => T): T {
  try {
    return read()
  } catch (cause) {
    if (cause instanceof SqliteReadError) throw cause
    throw damaged(cause instanceof Error ? cause.message : 'unknown')
  }
}

function build(store: PageStore, options: MssqlReadOptions): SqliteDatabase {
  const reader = new Reader(store)
  const codePage = options.codePage ?? 'windows-1252'
  const limit = options.rowLimit ?? Number.POSITIVE_INFINITY
  const catalog = reader.catalog()

  const objects = systemRows(reader, catalog, SYS.schobjs, codePage)
  const columns = systemRows(reader, catalog, SYS.colpars, codePage)

  const names = new Map<number, Map<number, string>>()
  for (const [objectId, , columnId, name] of columns) {
    if (typeof objectId !== 'number' || typeof columnId !== 'number') continue
    if (typeof name !== 'string') continue
    let byId = names.get(objectId)
    if (!byId) names.set(objectId, (byId = new Map()))
    byId.set(columnId, name)
  }

  const tables: SqliteTable[] = []
  const unreadable: UnreadableTable[] = []
  const taken = new Set<string>()

  for (const [objectId, name, , , , kind] of objects) {
    if (typeof objectId !== 'number' || typeof name !== 'string') continue
    if (typeof kind !== 'string' || kind.trim() !== USER_TABLE) continue

    const table = uniqueName(name, taken)
    const partitions = tableRowsets(catalog, objectId)
    if (partitions.some((p) => p.compression !== 0)) {
      unreadable.push({
        name: table,
        reason: 'compressed',
        detail: 'row or page compression',
      })
      continue
    }

    try {
      tables.push(
        readTable(reader, catalog, partitions, {
          name: table,
          names: names.get(objectId),
          limit,
          codePage,
        }),
      )
    } catch (cause) {
      unreadable.push({
        name: table,
        reason: 'damaged',
        detail: cause instanceof Error ? cause.message : 'unknown',
      })
    }
  }

  tables.sort((a, b) => a.name.localeCompare(b.name))
  return { tables, unreadable }
}

/** The partitions of a table's heap or clustered index. */
function tableRowsets(catalog: Catalog, objectId: number): Rowset[] {
  for (const indexId of TABLE_INDEXES) {
    const found = catalog.rowsets.get(rowsetKey(objectId, indexId))
    if (found) return found
  }
  return []
}

/** One of the two base tables read the ordinary way, once the catalog is up. */
function systemRows(
  reader: Reader,
  catalog: Catalog,
  objectId: number,
  codePage: string,
): SqliteValue[][] {
  const [rowset] = catalog.rowsets.get(rowsetKey(objectId, 1)) ?? []
  const layout = rowset && catalog.layouts.get(rowset.id)
  const stamp = rowset && catalog.pagesOf.get(rowset.id)
  if (!layout || stamp === undefined) throw damaged('the catalog is missing')
  return reader.rows(stamp, layout, Number.POSITIVE_INFINITY, codePage)
}

interface TableRequest {
  name: string
  names: Map<number, string> | undefined
  limit: number
  codePage: string
}

function readTable(
  reader: Reader,
  catalog: Catalog,
  partitions: readonly Rowset[],
  request: TableRequest,
): SqliteTable {
  const [first] = partitions
  const layout = (first && catalog.layouts.get(first.id)) ?? []

  // A column with no name is one the engine added, such as the uniquifier
  // of a clustered index whose key is not unique. It is not the table's.
  const { names } = request
  const kept = names ? layout.filter((c) => names.has(c.id)) : layout
  const ids = new Set(kept.map((c) => c.id))

  const rows: SqliteValue[][] = []
  let stated = 0
  for (const partition of partitions) {
    stated += partition.rowCount
    const stamp = catalog.pagesOf.get(partition.id)
    const columns = (catalog.layouts.get(partition.id) ?? kept).filter((c) =>
      ids.has(c.id),
    )
    if (stamp === undefined) continue
    rows.push(
      ...reader.rows(
        stamp,
        columns,
        request.limit - rows.length,
        request.codePage,
      ),
    )
  }

  const tableColumns: SqliteColumn[] = kept.map((column) => ({
    name: names?.get(column.id) ?? 'column' + column.id,
    declaredType: declaredType(column.info),
    primaryKey: false,
    notNull: false,
  }))

  return {
    name: request.name,
    createStatement:
      `CREATE TABLE ${quote(request.name)} (\n` +
      tableColumns
        .map((c) => `  ${quote(c.name)} ${c.declaredType}`)
        .join(',\n') +
      '\n)',
    columns: tableColumns,
    rows,
    rowCount: Math.max(stated, rows.length),
    indexStatements: [],
  }
}

function quote(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}
