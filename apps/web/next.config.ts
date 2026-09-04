import type { NextConfig } from 'next'

/**
 * The app reads dump files entirely in the browser and sends nothing anywhere.
 * These headers make that enforceable rather than merely true: `connect-src`
 * and `form-action` leave no route for a compromised dependency to ship a
 * user's data out, `object-src` and `base-uri` close the usual ways of getting
 * around that, and `frame-ancestors` keeps the page out of other sites.
 *
 * `script-src` allows inline scripts, and deliberately. Next hydrates through
 * an inline bootstrap script, and the only way to allow it without the keyword
 * is a per-request nonce — which requires every page to render dynamically,
 * giving up the static prerender that lets this app be served as files from a
 * CDN with no server at all. The exchange is worth making here because the
 * injection this would defend against has nowhere to enter: the app renders no
 * user-supplied HTML (no `dangerouslySetInnerHTML`, no `innerHTML`), takes
 * nothing from the URL, and has no server or database behind it. The
 * directives that carry this threat model — keeping a user's dump from leaving
 * the browser — are unaffected either way.
 */
const isDev = process.env.NODE_ENV === 'development'

const csp = [
  "default-src 'self'",
  // 'unsafe-eval' is React Refresh in development only.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  // Tailwind and Next inject styles through <style> tags.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // The archive is handed to the browser as a blob: URL by the download step.
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Nothing here needs a device or a location.
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
