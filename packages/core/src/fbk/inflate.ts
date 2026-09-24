// A small zlib inflater for `gbak -zip` backups.
//
// gbak never finishes its zlib stream: it stops at a flush and pads the last
// block, so a strict decoder reports the stream as truncated. The browser's
// DecompressionStream does, and when it does it may drop output it had not yet
// handed over — how much depends on how the input was chunked. This decoder
// instead returns everything decoded before the input ran out, and whether the
// result is whole is left to the record parser, which knows where the backup
// ends. It follows RFC 1951 directly: stored, fixed and dynamic blocks.

class OutOfInput extends Error {}

interface Tree {
  /** How many codes have each bit length. */
  counts: Uint16Array
  /** Symbols ordered by code. */
  symbols: Uint16Array
}

function tree(lengths: Uint8Array, count: number): Tree {
  const counts = new Uint16Array(16)
  for (let i = 0; i < count; i++) counts[lengths[i] as number]!++
  counts[0] = 0
  const offsets = new Uint16Array(16)
  for (let i = 1; i < 16; i++) {
    offsets[i] = (offsets[i - 1] as number) + (counts[i - 1] as number)
  }
  const symbols = new Uint16Array(count)
  for (let i = 0; i < count; i++) {
    const length = lengths[i] as number
    if (length) symbols[offsets[length]!++] = i
  }
  return { counts, symbols }
}

const LENGTH_BASE = new Uint16Array([
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67,
  83, 99, 115, 131, 163, 195, 227, 258,
])
const LENGTH_EXTRA = new Uint8Array([
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5,
  5, 5, 0,
])
const DISTANCE_BASE = new Uint16Array([
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769,
  1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
])
const DISTANCE_EXTRA = new Uint8Array([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11,
  11, 12, 12, 13, 13,
])
const CODE_LENGTH_ORDER = [
  16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
]

const FIXED_LITERALS = (() => {
  const lengths = new Uint8Array(288)
  lengths.fill(8, 0, 144)
  lengths.fill(9, 144, 256)
  lengths.fill(7, 256, 280)
  lengths.fill(8, 280, 288)
  return tree(lengths, 288)
})()
const FIXED_DISTANCES = tree(new Uint8Array(30).fill(5), 30)

class Inflater {
  private at = 0
  private bits = 0
  private bitCount = 0
  private out: Uint8Array
  private length = 0

  constructor(private readonly input: Uint8Array) {
    this.out = new Uint8Array(Math.max(1024, input.length * 4))
  }

  private bit(): number {
    if (this.bitCount === 0) {
      const byte = this.input[this.at]
      if (byte === undefined) throw new OutOfInput()
      this.at++
      this.bits = byte
      this.bitCount = 8
    }
    const bit = this.bits & 1
    this.bits >>= 1
    this.bitCount--
    return bit
  }

  private read(count: number): number {
    let value = 0
    for (let i = 0; i < count; i++) value |= this.bit() << i
    return value
  }

  private symbol(t: Tree): number {
    let code = 0
    let first = 0
    let index = 0
    for (let length = 1; length < 16; length++) {
      code |= this.bit()
      const count = t.counts[length] as number
      if (code - first < count) return t.symbols[index + code - first] as number
      index += count
      first = (first + count) << 1
      code <<= 1
    }
    throw new Error('invalid Huffman code')
  }

  private emit(byte: number): void {
    if (this.length === this.out.length) {
      const grown = new Uint8Array(this.out.length * 2)
      grown.set(this.out)
      this.out = grown
    }
    this.out[this.length++] = byte
  }

  private stored(): void {
    this.bitCount = 0
    if (this.at + 4 > this.input.length) throw new OutOfInput()
    const size =
      (this.input[this.at] as number) |
      ((this.input[this.at + 1] as number) << 8)
    this.at += 4
    for (let i = 0; i < size; i++) {
      const byte = this.input[this.at]
      if (byte === undefined) throw new OutOfInput()
      this.at++
      this.emit(byte)
    }
  }

  private dynamicTrees(): [Tree, Tree] {
    const literals = this.read(5) + 257
    const distances = this.read(5) + 1
    const codes = this.read(4) + 4
    const codeLengths = new Uint8Array(19)
    for (let i = 0; i < codes; i++) {
      codeLengths[CODE_LENGTH_ORDER[i] as number] = this.read(3)
    }
    const codeTree = tree(codeLengths, 19)
    const lengths = new Uint8Array(literals + distances)
    for (let i = 0; i < literals + distances; ) {
      const sym = this.symbol(codeTree)
      if (sym < 16) {
        lengths[i++] = sym
        continue
      }
      let repeat: number
      let value = 0
      if (sym === 16) {
        if (i === 0) throw new Error('repeat with nothing before it')
        value = lengths[i - 1] as number
        repeat = 3 + this.read(2)
      } else if (sym === 17) {
        repeat = 3 + this.read(3)
      } else {
        repeat = 11 + this.read(7)
      }
      if (i + repeat > lengths.length) throw new Error('too many code lengths')
      lengths.fill(value, i, i + repeat)
      i += repeat
    }
    return [
      tree(lengths.subarray(0, literals), literals),
      tree(lengths.subarray(literals), distances),
    ]
  }

  private compressed(literals: Tree, distances: Tree): void {
    for (;;) {
      const sym = this.symbol(literals)
      if (sym < 256) {
        this.emit(sym)
        continue
      }
      if (sym === 256) return
      const l = sym - 257
      if (l >= 29) throw new Error('invalid length code')
      const length =
        (LENGTH_BASE[l] as number) + this.read(LENGTH_EXTRA[l] as number)
      const d = this.symbol(distances)
      if (d >= 30) throw new Error('invalid distance code')
      const distance =
        (DISTANCE_BASE[d] as number) + this.read(DISTANCE_EXTRA[d] as number)
      if (distance > this.length) throw new Error('distance too far back')
      for (let i = 0; i < length; i++)
        this.emit(this.out[this.length - distance] as number)
    }
  }

  run(): Uint8Array {
    try {
      for (let last = 0; !last; ) {
        last = this.bit()
        const type = this.read(2)
        if (type === 0) this.stored()
        else if (type === 1) this.compressed(FIXED_LITERALS, FIXED_DISTANCES)
        else if (type === 2) this.compressed(...this.dynamicTrees())
        else throw new Error('invalid block type')
      }
    } catch (cause) {
      if (!(cause instanceof OutOfInput)) throw cause
    }
    return this.out.subarray(0, this.length)
  }
}

/**
 * Inflate a zlib stream, returning what it holds up to where the input ends.
 * Trailing zero padding reads as an empty stored block, which adds nothing.
 */
export function inflateZlib(input: Uint8Array): Uint8Array {
  if (input.length < 2 || ((input[0] as number) & 0x0f) !== 8) {
    throw new Error('not a zlib stream')
  }
  return new Inflater(input.subarray(2)).run()
}
