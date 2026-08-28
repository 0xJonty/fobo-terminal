import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json' with { type: 'json' }

const FOMO = 'https://fomo.family/*'

export default defineManifest({
  manifest_version: 3,
  name: 'fobo terminal',
  short_name: 'fobo',
  description: pkg.description,
  version: pkg.version,
  minimum_chrome_version: '111',

  // Narrow by design: one host, plus storage for preferences. No tabs, no webRequest,
  // no <all_urls>. Every extra permission is a review-time and trust cost.
  //
  // `scripting` is quick buy's, and only quick buy's: the buy transaction fomo's server builds
  // has to be signed by the wallet living in fomo's own JavaScript world, which an isolated
  // content script cannot reach. One self-contained function is injected per click and returns
  // its result straight to the extension (src/background/index.ts) — no permanent script in the
  // page, no page-readable signing channel. It adds no new install warning: the prompt users
  // see comes from the fomo.family host permission, which is unchanged.
  permissions: ['storage', 'scripting'],
  host_permissions: [FOMO],

  icons: {
    16: 'src/assets/icon-16.png',
    32: 'src/assets/icon-32.png',
    48: 'src/assets/icon-48.png',
    128: 'src/assets/icon-128.png',
  },

  action: {
    default_title: 'fobo terminal',
    default_popup: 'src/popup/index.html',
    default_icon: {
      16: 'src/assets/icon-16.png',
      32: 'src/assets/icon-32.png',
    },
  },

  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },

  content_scripts: [
    {
      // Isolated world only. fobo opens its own connection to fomo's API rather than
      // patching the page, so nothing is injected into fomo's JS context at all.
      matches: [FOMO],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
      world: 'ISOLATED',
    },
  ],
})
