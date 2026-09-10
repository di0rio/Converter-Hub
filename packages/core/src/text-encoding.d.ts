/**
 * The two text codecs the core uses. Browsers, Bun and Node all have them, but
 * they are not part of the ES2022 lib, and pulling in DOM or Node types for
 * two classes would let the core reach for everything else in them too.
 */
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean })
  decode(input?: Uint8Array): string
}
