import { describe, it, expect } from 'vitest'
import { CASE_STYLES, toCase } from '../src/utilities/case.js'

const written = {
  camel: 'userAccountId',
  pascal: 'UserAccountId',
  snake: 'user_account_id',
  kebab: 'user-account-id',
  screaming: 'USER_ACCOUNT_ID',
  dot: 'user.account.id',
  title: 'User Account Id',
} as const

describe('toCase', () => {
  it('offers every style it writes', () => {
    expect(CASE_STYLES).toEqual(Object.keys(written))
  })

  it.each(Object.entries(written))('writes %s', (style, expected) => {
    expect(toCase('user account id', style as keyof typeof written)).toBe(
      expected,
    )
  })

  it('reads every style it writes', () => {
    for (const value of Object.values(written)) {
      expect(toCase(value, 'snake')).toBe('user_account_id')
    }
  })

  it('splits camelCase and acronyms, keeping digits with their word', () => {
    expect(toCase('XMLHttpRequest', 'snake')).toBe('xml_http_request')
    expect(toCase('userID2Token', 'kebab')).toBe('user-id2-token')
  })

  it('treats runs of spaces and punctuation as one break', () => {
    expect(toCase('  hello,,  world!! ', 'kebab')).toBe('hello-world')
  })

  it('keeps accents and numbers', () => {
    expect(toCase('Olá mundo 2024', 'camel')).toBe('oláMundo2024')
    expect(toCase('Olá mundo 2024', 'title')).toBe('Olá Mundo 2024')
  })

  it('converts each line on its own and keeps blank lines', () => {
    expect(toCase('first name\n\nlast name', 'snake')).toBe(
      'first_name\n\nlast_name',
    )
  })
})
