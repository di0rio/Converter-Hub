import { describe, it, expect } from 'vitest'
import {
  decodeBase64,
  decodeHex,
  decodeHtmlEntities,
  decodeUrl,
  encodeBase64,
  encodeHex,
  encodeHtmlEntities,
  encodeUrl,
} from '../src/utilities/encoding.js'
import { DataFormatError } from '../src/records/index.js'

describe('base64', () => {
  it.each([
    ['', ''],
    ['a', 'YQ=='],
    ['ab', 'YWI='],
    ['hello', 'aGVsbG8='],
    ['ação', 'YcOnw6Nv'],
    ['😀', '8J+YgA=='],
  ])('round-trips %j as UTF-8', (text, encoded) => {
    expect(encodeBase64(text)).toBe(encoded)
    expect(decodeBase64(encoded)).toBe(text)
  })

  it('accepts base64 without padding and across line breaks', () => {
    expect(decodeBase64('aGVs\nbG8')).toBe('hello')
  })

  it('refuses text that is not base64', () => {
    for (const bad of ['###', 'aGVsbG8=x', 'a']) {
      expect(() => decodeBase64(bad)).toThrow(DataFormatError)
    }
  })

  it('refuses bytes that are not UTF-8 text', () => {
    expect(() => decodeBase64('/w==')).toThrow(DataFormatError)
  })
})

describe('hex', () => {
  it('writes the UTF-8 bytes of text, and reads them back', () => {
    expect(encodeHex('hé')).toBe('68c3a9')
    expect(decodeHex('68 C3 a9')).toBe('hé')
    expect(decodeHex('')).toBe('')
  })

  it('refuses text that is not hex', () => {
    for (const bad of ['zz', 'abc', '6'])
      expect(() => decodeHex(bad)).toThrow(DataFormatError)
  })
})

describe('url encoding', () => {
  it('encodes every reserved and non-ASCII character', () => {
    expect(encodeUrl('a b&c/ç?')).toBe('a%20b%26c%2F%C3%A7%3F')
    expect(decodeUrl('a%20b%26c%2F%C3%A7%3F')).toBe('a b&c/ç?')
  })

  it('refuses a broken escape', () => {
    expect(() => decodeUrl('%E0%A4%A')).toThrow(DataFormatError)
  })
})

describe('html entities', () => {
  it('escapes the characters HTML gives meaning to', () => {
    expect(encodeHtmlEntities(`<a href="x">Tom & Jerry's</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;',
    )
  })

  it('reads named, decimal and hex entities in one pass', () => {
    expect(
      decodeHtmlEntities('&lt;b&gt; &amp;amp; &#39; &#x1F600; &#233; &nbsp;|'),
    ).toBe("<b> &amp; ' 😀 é  |")
  })

  it('leaves an entity it does not know as it was', () => {
    expect(decodeHtmlEntities('&unknown; &#xZZ;')).toBe('&unknown; &#xZZ;')
  })
})
