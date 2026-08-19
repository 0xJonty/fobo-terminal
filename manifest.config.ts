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
  permissions: ['storage'],
  host_permissions: [FOMO],

  action: {
    default_title: 'Toggle fobo terminal',
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
