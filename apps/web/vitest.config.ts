import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Bun workspaces keep react/react-dom in the .bun store; apps/web/node_modules/react is a
// hard-link mirror (same inode, different resolved path). react-dom (CJS) resolves react to
// its .bun scope while Vite-inlined source (lucide-react, app components) resolves react to
// the app's node_modules — two module identities for one physical file, breaking React 19
// hooks.
//
// We resolve that by symlinking apps/web/node_modules/react & react-dom to the .bun store
// realpath, so every import converges on one resolved path (see node_modules setup).
// resolve.dedupe keeps a single module identity even for hard-link mirrors.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@sql-extractor/core': fileURLToPath(
        new URL('../../packages/core/dist/index.js', import.meta.url),
      ),
    },
  },
})