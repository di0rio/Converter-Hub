/**
 * Recognising a gbak backup.
 *
 * A `.fbk` is not a database and not a script: it is the serialisation `gbak`
 * writes, which only `gbak` restores. Reading one end to end means implementing
 * Firebird's backup format — a record stream whose types are `rec_burp`,
 * `rec_relation`, `rec_data` and so on, each a list of attributes. That work is
 * not done here.
 *
 * What is done here is telling the difference. A backup handed to a tool that
 * reads databases used to be refused as an unknown file type, which is true but
 * useless: the file is intact, it is simply one step away from being readable.
 * Naming it, and naming the step, is worth the forty lines this costs.
 *
 * The header record is enough for that, and it is the one part of the format
 * that is unambiguous: a record type byte, then `attribute, length, value`
 * triples, closed by a zero byte.
 */

/** Record types, from Firebird's `burp.h`. Only the header is read here. */
const REC_BURP = 0

/** Attributes of the header record. */
const ATT_END = 0
const ATT_BACKUP_DATE = 1
const ATT_BACKUP_FORMAT = 2
const ATT_BACKUP_FILE = 7
const ATT_PAGE_SIZE = 6

/**
 * Enough bytes to decide. The version attribute sits at a fixed offset, so the
 * answer never needs more than the first handful.
 */
export const FBK_HEADER_BYTES = 7

/** Backup formats gbak has written. Well clear of anything plausible by luck. */
const MAX_FORMAT = 100

function int32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  )
}

/**
 * Is this the start of a gbak backup?
 *
 * The test is the opening of the header record: `rec_burp`, then the backup
 * format as a four-byte attribute. A zero first byte already rules out a
 * database (which opens with a page type) and any text file, and the format
 * number rules out a run of zeros.
 */
export function isFbkFile(head: Uint8Array): boolean {
  if (head.length < FBK_HEADER_BYTES) return false
  if (head[0] !== REC_BURP) return false
  if (head[1] !== ATT_BACKUP_FORMAT || head[2] !== 4) return false

  const format = int32(head, 3)
  return format > 0 && format <= MAX_FORMAT
}

export interface FbkDescription {
  /** The backup format version gbak wrote. */
  format: number
  /** Page size of the database it was taken from, when the header says. */
  pageSize?: number
  /** Path of the database it was taken from, as it was on that machine. */
  sourceFile?: string
  /** When the backup ran, in gbak's own wording. */
  backupDate?: string
}

/**
 * What the header record says about the backup.
 *
 * Only the first record is read, and only its text and integer attributes —
 * enough to tell someone which database this is and when it was taken, so a
 * refusal can name the file rather than describe a category.
 */
export function describeFbk(bytes: Uint8Array): FbkDescription | null {
  if (!isFbkFile(bytes)) return null

  const text = new TextDecoder('latin1')
  const description: FbkDescription = { format: int32(bytes, 3) }

  // Past the record type byte; each step consumes one attribute.
  let at = 1
  while (at < bytes.length) {
    const attribute = bytes[at]
    if (attribute === ATT_END) break

    const length = bytes[at + 1]
    if (length === undefined) break

    const value = bytes.subarray(at + 2, at + 2 + length)
    if (value.length < length) break

    if (attribute === ATT_PAGE_SIZE && length === 4) {
      description.pageSize = int32(bytes, at + 2)
    } else if (attribute === ATT_BACKUP_FILE) {
      description.sourceFile = text.decode(value)
    } else if (attribute === ATT_BACKUP_DATE) {
      description.backupDate = text.decode(value)
    }

    at += 2 + length
  }

  return description
}

/**
 * What to tell someone who handed us a backup.
 *
 * It names the database and the date, because a backup file name rarely does,
 * and then names the one command that turns it into something this tool reads.
 * No path from the backup is echoed into a shell snippet — the restore line is
 * written against the file the user chose, not against a string out of the
 * file.
 */
export function fbkGuidance(description: FbkDescription): string {
  const taken = description.backupDate ? ` taken ${description.backupDate}` : ''
  const of = description.sourceFile ? ` of ${description.sourceFile}` : ''

  return (
    `That is a gbak backup${of}${taken}, not a database. ` +
    'Restore it first — `gbak -c backup.fbk database.fdb` — and open the .fdb.'
  )
}
