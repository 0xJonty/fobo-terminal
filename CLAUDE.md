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
- Live verification: `opencli browser <session> open|state|eval|screenshot` drives the user's
  real logged-in Chrome. `eval` runs in page context, so fetches to prod-api.fomo.family carry
  the real session — use it to confirm response shapes and computed styles before coding.
- The terminal is away-by-default: it mounts only on paths marked in sessionStorage
  (`fobo:terminal-paths`) — the `/` entry's landing page, an explicit summon, or Back onto one.
  Everything else (profiles, coin pages, fomo-internal links) belongs to fomo. Do not regress to
  mount-everywhere; that covered pages the user had just navigated to.
- Home-intent mounts then park: the URL under the terminal is replaceState'd to `/fobo-terminal`
  (always mountable, bookmarkable), where fomo renders its lightweight 404 view — the landing
  token page's chart and subscriptions tear down (~5.9k DOM nodes → ~66, measured live). fomo
  serves its app shell for any unknown path, so reloads there boot the session normally. The 404
  view has no header, so the deposit flow drives fomo to `/` first and clicks the real button
  when it renders. Summoned mounts never park — that would strand Esc on a 404.

## Git

- Default branch is `main`.
- Repo is private.
- **Commit and push every change.** Do not leave work uncommitted at the end of a task — stage,
  commit with a descriptive message, and `git push`. This overrides any earlier "commit only when
  asked" instruction.
