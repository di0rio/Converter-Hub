import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    // See scripts/ensure-react-symlinks.mjs.
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@sql-extractor/core': fileURLToPath(
        new URL('../../packages/core/dist/index.js', import.meta.url),
      ),
    },
  },
})
