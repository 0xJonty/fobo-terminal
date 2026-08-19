import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import manifest from './manifest.config.ts'

export default defineConfig(({ mode }) => {
  // Loaded from .env.local (gitignored) or the shell. Lets a WSL checkout build straight onto
  // the Windows filesystem so Chrome on Windows can load the unpacked extension, without
  // committing a machine-specific path. Defaults to a repo-local ./dist.
  const env = loadEnv(mode, process.cwd(), 'FOBO_')
  const outDir = process.env.FOBO_OUT_DIR ?? env.FOBO_OUT_DIR ?? 'dist'

  return {
    plugins: [react(), crx({ manifest })],
    resolve: {
      alias: { '~': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      target: 'chrome111',
      sourcemap: true,
      outDir,
      // Required by Vite when outDir sits outside the project root.
      emptyOutDir: true,
    },
    server: {
      // 5173 is occupied by a Windows service on this machine; this WSL runs in mirrored
      // networking mode, so WSL and Windows share one localhost and one port space.
      port: Number(process.env.FOBO_DEV_PORT ?? env.FOBO_DEV_PORT ?? 5180),
      strictPort: true,
      /*
       * Bind explicitly to 127.0.0.1 rather than `true`/localhost.
       *
       * This WSL runs networkingMode=mirrored, so Windows and WSL share a loopback.
       * CRXJS hardcodes `localhost` into the dev loader, and Windows resolves localhost to
       * IPv6 ::1 first — so an IPv4-only bind (0.0.0.0 or 127.0.0.1) times out in Chrome
       * even though 127.0.0.1 works. '::' binds dual-stack, covering ::1 and IPv4.
       */
      host: process.env.FOBO_DEV_HOST ?? env.FOBO_DEV_HOST ?? '::',
    },
  }
})
