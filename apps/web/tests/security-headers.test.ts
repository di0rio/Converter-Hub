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

async function headers(): Promise<Record<string, string>> {
  const [rule] = (await nextConfig.headers?.()) ?? []
  return Object.fromEntries(
    (rule?.headers ?? []).map((header) => [header.key, header.value]),
  )
}

describe('security headers', () => {
  it('keeps file data in the browser: no connection but to this origin', async () => {
    const csp = (await headers())['Content-Security-Policy'] ?? ''
    const directives = csp.split('; ')

    expect(directives).toContain("default-src 'self'")
    expect(directives).toContain("connect-src 'self'")
    expect(directives).toContain("frame-ancestors 'none'")
    expect(directives).toContain("object-src 'none'")
  })

  it('sets the transport and sniffing headers', async () => {
    const all = await headers()

    expect(all['Strict-Transport-Security']).toMatch(/max-age=\d{7,}/)
    expect(all['X-Content-Type-Options']).toBe('nosniff')
    expect(all['Referrer-Policy']).toBe('no-referrer')
    expect(all['Permissions-Policy']).toContain('camera=()')
  })
})
