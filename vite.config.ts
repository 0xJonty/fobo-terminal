import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import manifest from './manifest.config.ts'

const SOURCEMAP_MARK = '//# sourceMappingURL='

/**
 * Move any code that was appended after the sourcemap comment back in front of it.
 * Returns null when the file needs no repair.
 */
function repairTrailingCode(code: string): string | null {
  const at = code.lastIndexOf(SOURCEMAP_MARK)
  if (at === -1) return null

  const lineEnd = code.indexOf('\n', at)
  const line = lineEnd === -1 ? code.slice(at) : code.slice(at, lineEnd)

  // A sourcemap URL cannot contain a brace, so the first one begins the appended code.
  const brace = line.indexOf('}')
  if (brace === -1) return null

  const url = line.slice(SOURCEMAP_MARK.length, brace)
  const tail = line.slice(brace)
  const rest = lineEnd === -1 ? '' : code.slice(lineEnd + 1)

  return `${code.slice(0, at)}${tail}\n${SOURCEMAP_MARK}${url}\n${rest}`
}

/**
 * Repairs CRXJS's IIFE wrapping of the content script.
 *
 * @crxjs/vite-plugin 2.7.1 wraps the content-script chunk (dist/index.mjs:1164) with:
 *
 *     bundleFileInfo.code = `(function(){${bundleFileInfo.code}})()\n`
 *
 * Rollup's chunk ends with `//# sourceMappingURL=...` and no trailing newline, so the appended
 * `})()` lands *inside* that line comment. The IIFE is never closed and Chrome rejects the whole
 * file with `Uncaught SyntaxError: Unexpected end of input` — the extension does not load at all.
 *
 * It only triggers when sourcemaps are on, which is what makes it look intermittent: turn them
 * off and the chunk ends in real code, so the wrap is harmless.
 *
 * Runs in closeBundle, after every writer, so it does not depend on plugin ordering. Remove this
 * once CRXJS separates the wrapper from the trailing comment.
 */
function fixCrxIifeSourcemap(): Plugin {
  let assetsDir = ''
  let label = 'assets'

  return {
    name: 'fobo:fix-crx-iife-sourcemap',
    enforce: 'post',
    configResolved(config) {
      label = config.build.assetsDir
      assetsDir = join(resolve(config.root, config.build.outDir), label)
    },
    async closeBundle() {
      let names: string[]
      try {
        names = await readdir(assetsDir)
      } catch {
        return
      }

      for (const name of names) {
        if (!name.endsWith('.js')) continue
        const file = join(assetsDir, name)
        const code = await readFile(file, 'utf8')
        const fixed = repairTrailingCode(code)
        if (fixed === null || fixed === code) continue
        await writeFile(file, fixed)
        this.warn(`repaired CRXJS IIFE/sourcemap ordering in ${label}/${name}`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  // Loaded from .env.local (gitignored) or the shell. Lets a WSL checkout build straight onto
  // the Windows filesystem so Chrome on Windows can load the unpacked extension, without
  // committing a machine-specific path. Defaults to a repo-local ./dist.
  const env = loadEnv(mode, process.cwd(), 'FOBO_')
  const outDir = process.env.FOBO_OUT_DIR ?? env.FOBO_OUT_DIR ?? 'dist'

  return {
    plugins: [react(), crx({ manifest }), fixCrxIifeSourcemap()],
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
