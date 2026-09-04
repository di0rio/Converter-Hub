import { describe, it, expect } from 'vitest'
import {
  MAX_DUMP_BYTES,
  formatBytes,
  isOversizedDump,
  oversizedDumpMessage,
} from '../src/limits/index.js'

describe('formatBytes', () => {
  it('leaves a small count in bytes', () => {
    expect(formatBytes(0)).toBe('0 bytes')
    expect(formatBytes(999)).toBe('999 bytes')
  })

  it('steps up a unit at a time', () => {
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB')
  })

  it('keeps one decimal only while it still says something', () => {
    expect(formatBytes(1.25 * 1024 * 1024 * 1024)).toBe('1.3 GB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
  })

  it('does not throw on a nonsense count', () => {
    expect(formatBytes(-1)).toBe('0 bytes')
    expect(formatBytes(Number.NaN)).toBe('0 bytes')
  })
})

describe('isOversizedDump', () => {
  it('accepts a file exactly at the ceiling', () => {
    expect(isOversizedDump(MAX_DUMP_BYTES)).toBe(false)
    expect(isOversizedDump(MAX_DUMP_BYTES + 1)).toBe(true)
  })

  it('honours a caller-supplied limit', () => {
    expect(isOversizedDump(100, 50)).toBe(true)
    expect(isOversizedDump(50, 50)).toBe(false)
  })
})

describe('oversizedDumpMessage', () => {
  it('names both sizes', () => {
    const message = oversizedDumpMessage(300 * 1024 * 1024)
    expect(message).toContain('300 MB')
    expect(message).toContain('250 MB')
  })

  it('carries nothing from the file itself', () => {
    // The message reaches a user as-is, so it must hold no path and no content.
    expect(oversizedDumpMessage(1)).toBe(
      'That file is 1 bytes. The largest dump this tool reads is 250 MB.',
    )
  })
})
