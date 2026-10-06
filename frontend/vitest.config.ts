/**
 * Frontend UI test runner (Vitest + jsdom + Testing Library).
 *
 * Separate from `vite.config.ts` so the production build is never affected by
 * test-only settings. It reuses the same `@` -> `./src` alias and the React
 * plugin, so test imports behave exactly like app imports.
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['tests/ui/**/*.test.{ts,tsx}'],
    css: false,
  },
})