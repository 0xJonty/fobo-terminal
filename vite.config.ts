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
    /*
     * No dev-server config, on purpose. `vite` (CRXJS serve mode) is not usable here:
     *
     *  - CRXJS hardcodes `localhost` into its dev loader, and across a mirrored-networking WSL
     *    boundary Windows resolves that to IPv6 `::1`, which never answers. The extension cannot
     *    reach the dev server at all.
     *  - CRXJS 2.7.1 ships a broken HMR client regardless: it substitutes its `__LIVE_RELOAD__`
     *    placeholder with `String.prototype.replace` and a string pattern, which rewrites only
     *    the first of the two occurrences. The one left in the socket-close handler throws
     *    `ReferenceError: __LIVE_RELOAD__ is not defined` the moment the connection drops, taking
     *    the service worker down and leaving the content script talking to a dead port
     *    ("Attempting to use a disconnected port object", "Extension context invalidated").
     *
     * `vite build --watch` produces a self-contained build with none of that machinery, so both
     * `npm run dev` and `npm run watch` use it.
     */
  }
})
