import { describe, it, expect } from 'vitest'
import { convertColor } from '../src/utilities/color.js'
import { DataFormatError } from '../src/records/index.js'

const orange = {
  hex: '#ff8800',
  rgb: 'rgb(255, 136, 0)',
  hsl: 'hsl(32, 100%, 50%)',
}

describe('convertColor', () => {
  it('reads a full and a short hex color', () => {
    expect(convertColor('#ff8800')).toEqual(orange)
    expect(convertColor('#F80')).toEqual(orange)
  })

  it('reads rgb with commas or with spaces', () => {
    expect(convertColor('rgb(255, 136, 0)')).toEqual(orange)
    expect(convertColor('rgb(255 136 0)')).toEqual(orange)
  })

  it('reads hsl', () => {
    expect(convertColor('hsl(32, 100%, 50%)')).toEqual(orange)
    expect(convertColor('hsl(32 100% 50%)')).toEqual(orange)
  })

  it('reads the limits', () => {
    expect(convertColor('#000')).toEqual({
      hex: '#000000',
      rgb: 'rgb(0, 0, 0)',
      hsl: 'hsl(0, 0%, 0%)',
    })
    expect(convertColor('rgb(255, 255, 255)').hsl).toBe('hsl(0, 0%, 100%)')
    expect(convertColor('hsl(360, 100%, 50%)').hex).toBe('#ff0000')
  })

  it('refuses a value out of range rather than clamping it', () => {
    for (const bad of [
      'rgb(256, 0, 0)',
      'rgb(-1, 0, 0)',
      'hsl(361, 50%, 50%)',
      'hsl(10, 101%, 50%)',
      'hsl(10, 50%, -1%)',
    ]) {
      expect(() => convertColor(bad)).toThrow(DataFormatError)
    }
  })

  it('refuses what is not a hex, rgb or hsl color', () => {
    for (const bad of ['#ff88', '#ggg', 'red', 'rgb(1, 2)', '']) {
      expect(() => convertColor(bad)).toThrow(DataFormatError)
    }
  })
})
