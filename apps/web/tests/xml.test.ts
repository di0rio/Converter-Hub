import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DataFormatError, recordsToTable } from '@sql-extractor/core'
import { parseXml } from '@/lib/xml'

const fixture = (name: string) =>
  readFileSync(
    join(__dirname, '..', '..', '..', 'examples', 'data', name),
    'utf8',
  )

describe('parseXml', () => {
  it('turns elements, attributes and text into one value', () => {
    expect(
      parseXml(
        '<book id="1" lang="en"><title>Dune</title><author>Frank Herbert</author></book>',
      ),
    ).toEqual({
      book: {
        '@id': '1',
        '@lang': 'en',
        title: 'Dune',
        author: 'Frank Herbert',
      },
    })
  })

  it('collects a repeated element into a list, in document order', () => {
    expect(
      parseXml('<list><item>a</item><item>b</item><note>x</note></list>'),
    ).toEqual({ list: { item: ['a', 'b'], note: 'x' } })
  })

  it('keeps text that sits beside attributes or children under #text', () => {
    expect(parseXml('<p class="x">Hello <b>you</b></p>')).toEqual({
      p: { '@class': 'x', '#text': 'Hello', b: 'you' },
    })
  })

  it('writes an empty element as an empty string', () => {
    expect(parseXml('<a><b/></a>')).toEqual({ a: { b: '' } })
  })

  it('keeps namespace prefixes as the parser reports them', () => {
    expect(parseXml('<x:root xmlns:x="urn:x"><x:v>1</x:v></x:root>')).toEqual({
      'x:root': { '@xmlns:x': 'urn:x', 'x:v': '1' },
    })
  })

  it('reads CDATA as text and leaves comments out', () => {
    expect(parseXml('<a><![CDATA[1 < 2]]><!-- note --></a>')).toEqual({
      a: '1 < 2',
    })
  })

  it('reads a document of repeated records as a table', () => {
    const value = parseXml(fixture('people.xml'))

    expect(recordsToTable('people', value).rows).toEqual([
      ['1', 'Ada Lovelace', 'London'],
      ['2', 'Grace Hopper', 'New York, NY'],
    ])
  })

  it('refuses malformed XML without quoting it', () => {
    const run = () => parseXml('<a><secret-value></a>')

    expect(run).toThrow(DataFormatError)
    expect(run).not.toThrow(/secret/)
  })

  it('never resolves an external entity into the value', () => {
    const xml =
      '<?xml version="1.0"?><!DOCTYPE a [<!ENTITY e SYSTEM "http://example.com/x">]><a>&e;</a>'

    let value: unknown
    try {
      value = parseXml(xml)
    } catch (cause) {
      expect(cause).toBeInstanceOf(DataFormatError)
      return
    }
    expect(JSON.stringify(value)).not.toContain('example.com')
  })
})
