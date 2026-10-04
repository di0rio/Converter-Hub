import { deflateSync } from 'node:zlib'
import { describe, it, expect } from 'vitest'
import { InflateLimitError, inflateZlib } from '../src/fbk/inflate.js'

describe('inflateZlib output limit', () => {
  const zeros = deflateSync(new Uint8Array(1_000_000))

  it('inflates a stream that fits under the default limit', () => {
    expect(inflateZlib(zeros).length).toBe(1_000_000)
  })

  it('inflates a stream that exactly fills the limit', () => {
    expect(inflateZlib(zeros, 1_000_000).length).toBe(1_000_000)
  })

  it('refuses a stream that would inflate past the limit', () => {
    expect(() => inflateZlib(zeros, 999_999)).toThrow(InflateLimitError)
    expect(() => inflateZlib(zeros, 4096)).toThrow(InflateLimitError)
  })

  it('does not allocate past the limit while growing', () => {
    const start = performance.now()
    expect(() => inflateZlib(zeros, 10_000)).toThrow(InflateLimitError)
    expect(performance.now() - start).toBeLessThan(500)
  })
})
