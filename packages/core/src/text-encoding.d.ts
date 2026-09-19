// Only these two, so the core does not pull in the DOM or Node typings.
declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean })
  decode(input?: Uint8Array): string
}
