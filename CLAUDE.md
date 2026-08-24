# CLAUDE.md

Project instructions for Claude Code working in this repository.

## What this is

`fobo-terminal` is a Chrome extension (Manifest V3) that replaces fomo.family's home screen with an
Axiom-Pulse-style three-column token terminal. Source is in `src/`: React 19 + TypeScript, built by
Vite with `@crxjs/vite-plugin`.

## Ground rules

- Never invent product behaviour, metrics, or data sources. fomo owns list membership and order;
  Mobula only decorates. A card renders what it has and omits what it does not — a guessed number
  is worse than a blank. See the header of `src/types/token.ts`.
- Keep `README.md` truthful about what actually exists. It is not a wishlist.
- Never commit secrets, API keys, or an extension signing key (`*.pem`). See `.gitignore`.
- Never commit build output (`dist/`, `build/`) or packaged extensions (`*.zip`, `*.crx`).

## Chrome extension specifics

- Target Manifest V3. MV2 is not an option — Chrome no longer accepts it.
- Background logic is a **service worker**, not a persistent page. It is terminated when idle, so
  never hold state in module-level variables across events; persist to `chrome.storage`.
- Request the narrowest permissions that work. Prefer `activeTab` and optional permissions over
  broad `host_permissions`; every added permission is a review-time and trust cost.
- Content scripts run in an isolated world. They cannot see page JS variables, and vice versa —
  cross the boundary explicitly via `window.postMessage` or an injected script if needed.
- MV3 blocks remote code execution. All executable code must ship inside the extension package.

## Verification

`npm run build` writes to `$FOBO_OUT_DIR` from `.env.local` (a Windows path, so Chrome on Windows
can load a WSL checkout) — not `./dist`. Resolve it before inspecting output.

**A green `tsc` and a successful `vite build` do not mean the extension loads.** CRXJS rewrites the
bundle after Rollup, so always syntax-check the emitted files:

    for f in "$OUT"/*.js "$OUT"/assets/*.js; do node --check "$f" || echo "FAIL $f"; done

Then `chrome://extensions` → Developer mode → Load unpacked → the build output. Reload the extension
after each change; content scripts also need the host page reloaded.

If the overlay never appears, read the page console for `[fobo] <decision> — <path>`; it names the
branch that suppressed the mount. No line at all means the content script never ran.

## Build quirks (@crxjs/vite-plugin 2.7.1)

- No dev server. `npm run dev` aliases `vite build --watch`. CRXJS's HMR client throws on socket
  close (it substitutes `__LIVE_RELOAD__` with a string-pattern `replace`, leaving the second
  occurrence), and its hardcoded `localhost` loader is unreachable across WSL. Do not restore `vite`.
- `fixCrxIifeSourcemap` in `vite.config.ts` is load-bearing, not cleanup. CRXJS appends `})()` to a
  chunk ending in `//# sourceMappingURL=...` with no trailing newline, commenting out the closing
  brace and breaking the whole script. Keep it while on 2.7.1.

## fomo.family specifics

- There is no `/` home route. fomo redirects `/` straight to a coin page, so anything gating on a
  URL shape silently never fires.
- Isolated-world content scripts cannot intercept the page's `history.pushState`, so observing
  route changes needs the poll in `src/content/index.tsx`. Driving the router the other way DOES
  work: `history.pushState` + a synthetic `PopStateEvent` crosses the world boundary and fomo's
  router follows it (verified live) — never fall back to `location.assign` for in-app navigation.
- fomo's REST API works from the content script (same-origin CORS): wrapper, endpoints, and the
  header arithmetic all live in `src/lib/fomoApi.ts`, each mirrored from fomo's own bundle call
  sites. Extend that file the same way — read their code, never guess a shape or a formula.
- fomo's frontend is minified but readable: `curl fomo.family` lists `/assets/*.js` chunks
  (download all, grep). Endpoints appear as `"/v2/..."` literals; UI strings live in the i18n
  chunk — find the string, take its key, grep other chunks for the key to locate the component.
- The index page names only ~40 chunks; the app has ~430. Get the rest by regexing
  `[\w.-]+-<hash>.js` names out of downloaded chunks and fetching `/assets/<name>` (parallel
  xargs curl). Known homes: `authenticated-*` (app shell: footer, status dot),
  `tradeSettings-*` (pnl selectors, chain icon glyphs), `token-0uj*` (list endpoints,
  watchlist, $2 dust split), `chains-*` (chain defs, market-cap formula), `manifest-*` (route
  list), `i18n-*` (strings). Resolve minified imports via each chunk's `import{X as y}` header
  against the source chunk's `export{...}` list.
- Server facts (verified live): fomo serves its full app shell with 200 for ANY unknown path —
  there is no server-side 404, so made-up paths still boot the SPA. CSP sends
  `frame-ancestors 'self'` + `X-Frame-Options: DENY` — fomo cannot be iframed. The Privy
  access JWT (`privy:token`) has a 60-minute TTL, refreshed by fomo's own app.
- Live verification: `opencli browser <session> open|state|eval|screenshot` drives the user's
  real logged-in Chrome. `eval` runs in page context, so fetches to prod-api.fomo.family carry
  the real session — use it to confirm response shapes and computed styles before coding.
- opencli quirks: the session tab resets to about:blank between uses — always `open` the URL
  and sleep a few seconds before `eval`; `network` capture returns count:0 (dead); `tab new`
  rejects chrome:// schemes, so the extension cannot be reloaded programmatically — the user
  reloads at chrome://extensions. History experiments (bare replaceState, pushState+popstate)
  are safe if you restore the URL afterwards; DOM node count is a usable cost proxy.
- The terminal is away-by-default: it mounts only on paths marked in sessionStorage
  (`fobo:terminal-paths`) — the `/` entry's landing page, an explicit summon, or Back onto one.
  Everything else (profiles, coin pages, fomo-internal links) belongs to fomo. Do not regress to
  mount-everywhere; that covered pages the user had just navigated to.
- fomo's home routes are `/` AND `/token` — the header logo is `<a href="/token">`, and
  `/token` redirects to the autoload coin page in <200ms (verified live; an in-app popstate
  to bare `/` does NOT redirect). `HOME_PATHS` in content/index.tsx is the single source of
  truth; beware `a.href` on an href-less anchor resolving to "" -> pathname `/` (false home
  positives — always check getAttribute).
- Home clicks are INTERCEPTED (capture-phase; match against HOME_PATHS, not `/` alone):
  preventDefault + summon the terminal over the current page. Never chase fomo's `/` redirect —
  it resolves inside one 300ms poll tick, hops through transit paths (a bare `/token`, observed
  live), and can land on the very page it left. Anything that must happen once per DESTINATION
  (spending the home intent, masking the URL) is settle-gated (600ms of path stillness):
  mounting over a transit hop used to consume the intent, leave the real landing page unmarked,
  and mask the transit history entry — terminal dead until a toolbar toggle. Related: navigating
  to the exact path the terminal sits on (top holding == the `/` landing page) must unmark +
  hide, with nothing pushed — there is no popstate to raise.
- While the terminal is visible, fomo's page underneath gets `content-visibility: hidden` on its
  top-level body children (saved/restored verbatim, like the scroll lock) so the landing token
  page's chart stops paying layout/paint costs; its JS and sockets keep running. A synthetic
  resize is dispatched on restore. Do NOT resurrect URL parking (replaceState + synthetic
  popstate onto a reserved path): routing fomo onto its 404 view broke the alerts feed and
  flashed on every handoff — reverted after live use.
- fomo REST wraps everything in {success, responseObject} — fomoCall unwraps; raw fetches
  (opencli eval probes) must read .responseObject themselves.
- More chunk homes: ClanWindowSelector-* = the side panel (alerts feed + filters, the /feed
  social feed + its 8 filter groups, the alert-ding sound). Token id helper (chains chunk)
  is `${address}:${networkId}` — same as our tokenKey.
- Endpoints (verified live): GET /watchlist -> ids, then POST /proxy/filterTokens with a
  JSON array of "address:networkId" ids -> rows in fomo's standard list-row shape
  (fromFomoRow-compatible). GET /feed REQUIRES feedTypes params (400s without; groups
  mirrored in src/lib/feed.ts). /feed/tradingActivity takes threshold / minEquity (only
  when >0) / minMarketCap / maxMarketCap; fomo's stock threshold is 1000.
- Header menus are Radix navigation-menu: triggers are
  `nav[class*=navigation-menu] button[data-state]` ([0] cash, [1] profile); menu content
  mounts only while open, and opening programmatically needs the full pointer sequence
  (pointerenter/move/down/up/click). Modal-backed items are driven via requestHeaderMenu
  in content/index.tsx — never recreated.
- Alert sound: /sounds/alert-ding.mp3, 2s throttle, 10s freshness (replica: src/lib/sound.ts).
- The visible terminal MASKS the tab instead: URL shown as `/fobo-terminal` and title as
  "fobo terminal" via bare replaceState / document.title with NO synthetic popstate, so fomo's
  router never notices and the real page stays live underneath. The mask lifts on every handoff
  (navigate/Esc/unmount); a document that boots on the masked address is driven home
  (recoverFromMaskedLoad) so fomo never sits on its 404.

## Session tooling quirks (this machine)

- Extension reloads cannot be automated (chrome:// blocked). Detect a reload with a
  background Monitor polling `data-fobo-build` on the host element (`vite.config.ts` stamps
  `__FOBO_BUILD__`; read the stamp from the emitted bundle), then E2E. The shadow root is
  CLOSED, so nothing inside it is inspectable from the page — while the extension is
  mid-reload/disabled the host and launcher are both absent (not a bug).
- Content-script fetches do NOT appear in the page's `performance.getEntriesByType('resource')`
  and `opencli browser <s> console` captures nothing. The only window into the terminal's own
  traffic is the host's `data-fobo-requests` (per-endpoint counters), `data-fobo-socket`,
  `data-fobo-last-frame` and `data-fobo-active`. The Resource Timing buffer also caps at 250
  entries and fills during fomo's boot — clear/enlarge it before measuring fomo's traffic.
- fomo's own coin page re-reads `/watchlist` + `/proxy/filterTokens` every ~2.5 s and
  `/balances` every 10 s on its own; do not attribute those to the extension.
- Tab-scoped test residue: Esc leaves `fobo:dismissed=1` and panel tests leave
  `fobo:panel-view` in the session tab's sessionStorage — clear them before mount checks.
- Main-world injection harness (E2E extension code WITHOUT reloading the extension):
  build the content script standalone (vite lib-mode IIFE; the config file must sit in
  the project root or `import 'vite'` fails), base64 the bundle, transfer in <100KB
  chunks (execve caps one argv at ~128KB), assemble in a window var, then inject via a
  <script> carrying the PAGE's own nonce (fomo's CSP has script-src nonce, no
  unsafe-eval; CDP top-level eval is CSP-exempt, nested eval is not). Collides with a
  live extension instance (same host id) — only useful while the extension is off/stale.
- A 432-chunk bundle mirror may persist at
  /tmp/claude-1000/-home-jonty-build-fobo-terminal/804ada0e-*/scratchpad/chunks.
- Emitted bundles write string literals as BACKTICK template literals (esbuild), so grepping
  dist for '"/token"' or single-quoted strings finds nothing — match the bare substring or
  backticks when verifying a build contains a change.

- Output-compression hooks mangle multi-file grep results ("N matches in M files" interleaving)
  and piped opencli output sometimes emits a spurious "claude native binary not installed"
  error. Reliable pattern: redirect command output to a scratchpad file, then post-process with
  a python3 heredoc.
- zsh: an unquoted `=====` separator triggers equals-expansion ("==== not found") — quote it or
  use python prints.
- Broad regexes over the ~430-chunk mirror can hit the 120s Bash timeout — keep patterns
  backtrack-safe (no nested `[^"']*` around alternations) or scan per-file in python.

## Git

- Default branch is `main`.
- Repo is private.
- **Commit and push every change.** Do not leave work uncommitted at the end of a task — stage,
  commit with a descriptive message, and `git push`. This overrides any earlier "commit only when
  asked" instruction.
