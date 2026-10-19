import { damaged, type MemoLayout } from './header.js'

/**
 * The memo file that sits beside a table. dBase III fixed its blocks at 512
 * bytes and ended each memo with a 0x1A; dBase IV put a length in front of the
 * text; FoxPro wrote a big-endian block size in the file header and a type and
 * length in front of every block.
 */
const DBASE3_BLOCK = 512
const END_OF_TEXT = 0x1a
const DBASE4_MARKER = 0xffff
const FPT_TEXT = 1

/** A memo wider than this is treated as a damaged block rather than read. */
const MAX_MEMO = 64 * 1024 * 1024

export interface Memo {
  bytes: Uint8Array
  text: boolean
}

export class MemoFile {
  private readonly blockSize: number

  constructor(
    private readonly bytes: Uint8Array,
    private readonly layout: MemoLayout,
  ) {
    this.blockSize = this.readBlockSize()
  }

  private readBlockSize(): number {
    if (this.bytes.length < 8) throw damaged('memo file has no header')
    const v = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    )
    const size =
      this.layout === 'foxpro'
        ? v.getUint16(6, false)
        : this.layout === 'dbase4' && this.bytes.length >= 22
          ? v.getUint16(20, true)
          : DBASE3_BLOCK
    return size >= 1 && size <= 65536 ? size : DBASE3_BLOCK
  }

  read(block: number): Memo | null {
    if (block <= 0) return null
    const start = block * this.blockSize
    if (start >= this.bytes.length) return null
    return this.layout === 'foxpro'
      ? this.readFoxpro(start)
      : this.layout === 'dbase4'
        ? this.readDbase4(start)
        : this.readDbase3(start)
  }

  private slice(start: number, length: number): Uint8Array {
    if (length < 0 || length > MAX_MEMO) throw damaged('memo length')
    const end = Math.min(start + length, this.bytes.length)
    return this.bytes.slice(start, end)
  }

  private readDbase3(start: number): Memo {
    let end = this.bytes.length
    for (let i = start; i < this.bytes.length; i++) {
      if (this.bytes[i] === END_OF_TEXT) {
        end = i
        break
      }
    }
    return { bytes: this.bytes.slice(start, end), text: true }
  }

  private readDbase4(start: number): Memo | null {
    if (start + 8 > this.bytes.length) return null
    const v = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + start,
      this.bytes.byteLength - start,
    )
    if (v.getUint16(0, true) !== DBASE4_MARKER) return this.readDbase3(start)
    // The stored length counts the eight header bytes as well.
    const length = v.getUint32(4, true) - 8
    return { bytes: this.slice(start + 8, length), text: true }
  }

  private readFoxpro(start: number): Memo | null {
    if (start + 8 > this.bytes.length) return null
    const v = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + start,
      this.bytes.byteLength - start,
    )
    const type = v.getUint32(0, false)
    const length = v.getUint32(4, false)
    return {
      bytes: this.slice(start + 8, length),
      text: type === FPT_TEXT,
    }
  }
}
