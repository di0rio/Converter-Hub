import type { MetadataRoute } from 'next'
import { HUB_NAME, HUB_TAGLINE } from '@/lib/tools'

/** Installable app: opens in its own window and, with the service worker, works offline. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: HUB_NAME,
    short_name: 'cd/hub',
    description: HUB_TAGLINE,
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4ee',
    theme_color: '#1c1c1c',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
