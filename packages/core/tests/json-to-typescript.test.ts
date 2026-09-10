import { describe, it, expect } from 'vitest'
import { jsonToTypeScript } from '../src/utilities/json-to-typescript.js'
import { DataFormatError } from '../src/records/index.js'

describe('jsonToTypeScript', () => {
  it('types primitives and null', () => {
    expect(jsonToTypeScript('{"a":"x","b":1,"c":true,"d":null}')).toBe(
      'export interface Root {\n  a: string\n  b: number\n  c: boolean\n  d: null\n}\n',
    )
  })

  it('names a nested object after its key', () => {
    expect(
      jsonToTypeScript(
        '{"user":{"name":"Ada","address":{"city":"London"}}}',
      ),
    ).toBe(
      [
        'export interface Root {\n  user: User\n}\n',
        'export interface User {\n  name: string\n  address: Address\n}\n',
        'export interface Address {\n  city: string\n}\n',
      ].join('\n'),
    )
  })

  it('merges the objects of a list, marking fields some lack as optional', () => {
    expect(
      jsonToTypeScript('{"people":[{"id":1,"name":"Ada"},{"id":2,"email":null}]}'),
    ).toBe(
      [
        'export interface Root {\n  people: PeopleItem[]\n}\n',
        'export interface PeopleItem {\n  id: number\n  name?: string\n  email?: null\n}\n',
      ].join('\n'),
    )
  })

  it('writes a union for mixed values, in the order they appear', () => {
    expect(jsonToTypeScript('{"v":[1,"a",null],"w":[1,{"x":1}]}')).toBe(
      [
        'export interface Root {\n  v: (number | string | null)[]\n  w: (number | WItem)[]\n}\n',
        'export interface WItem {\n  x: number\n}\n',
      ].join('\n'),
    )
  })

  it('writes unknown for a list with nothing in it, never any', () => {
    const types = jsonToTypeScript('{"v":[]}')

    expect(types).toBe('export interface Root {\n  v: unknown[]\n}\n')
    expect(types).not.toMatch(/\bany\b/)
  })

  it('quotes a key that is not an identifier', () => {
    expect(jsonToTypeScript('{"my-key":1,"ok_key":2,"2x":3,"$id":4}')).toBe(
      'export interface Root {\n  "my-key": number\n  ok_key: number\n  "2x": number\n  $id: number\n}\n',
    )
  })

  it('writes a type alias for a list or a primitive at the top', () => {
    expect(jsonToTypeScript('[1,2]')).toBe('export type Root = number[]\n')
    expect(jsonToTypeScript('"x"')).toBe('export type Root = string\n')
  })

  it('keeps type names unique and deterministic', () => {
    expect(jsonToTypeScript('{"a":{"x":1},"b":{"a":{"y":2}}}')).toBe(
      [
        'export interface Root {\n  a: A\n  b: B\n}\n',
        'export interface A {\n  x: number\n}\n',
        'export interface B {\n  a: A2\n}\n',
        'export interface A2 {\n  y: number\n}\n',
      ].join('\n'),
    )
  })

  it('refuses text that is not JSON', () => {
    expect(() => jsonToTypeScript('{nope')).toThrow(DataFormatError)
  })
})
