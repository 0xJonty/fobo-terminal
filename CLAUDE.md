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
- Isolated-world content scripts cannot intercept the page's `history.pushState`, so client-side
  route changes must be polled — see `src/content/index.tsx`.

## Git

- Default branch is `main`.
- Repo is private.
- **Commit and push every change.** Do not leave work uncommitted at the end of a task — stage,
  commit with a descriptive message, and `git push`. This overrides any earlier "commit only when
  asked" instruction.
