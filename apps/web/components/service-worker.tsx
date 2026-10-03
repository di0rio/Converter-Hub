'use client'

import { useEffect } from 'react'

/** Registers the offline service worker in production builds only (dev reloads would fight it). */
export function ServiceWorker(): null {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Offline support is a bonus; the app works the same without it.
    })
  }, [])
  return null
}
