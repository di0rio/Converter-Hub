import { describe, it, expect } from 'vitest'
import nextConfig from '@/next.config'

async function scriptSrc(): Promise<string> {
  const [rule] = (await nextConfig.headers?.()) ?? []
  const csp = rule?.headers.find(
    (header) => header.key === 'Content-Security-Policy',
  )?.value
  return csp?.split('; ').find((d) => d.startsWith('script-src')) ?? ''
}

describe('Content Security Policy', () => {
  it('lets the browser compile WebAssembly', async () => {
    expect(await scriptSrc()).toContain("'wasm-unsafe-eval'")
  })

  it('still refuses eval in production', async () => {
    expect(await scriptSrc()).not.toMatch(/'unsafe-eval'/)
  })
})
