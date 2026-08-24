import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

// Separate from vite.config.ts on purpose: the build config loads the CRXJS plugin and
// asserts on the output directory, neither of which a unit-test run should touch.
export default defineConfig({
  define: { __FOBO_BUILD__: JSON.stringify('test') },
  resolve: {
    alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
