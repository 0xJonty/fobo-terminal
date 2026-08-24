# fobo-terminal

A Chrome extension (Manifest V3) that gives [fomo.family](https://fomo.family/) the home screen it
doesn't have: a dense, live, three-column token feed modelled on Axiom's Pulse page, rendered in
fomo's own design language.

Independent project — not affiliated with, endorsed by, or maintained by fomo.family. It uses
fomo's web API under your own login; see [PRIVACY.md](PRIVACY.md) for exactly what it reads and
where it goes.

## Why

fomo has no home screen. After login `/` redirects to `/token`, which redirects to whichever token
is currently #1 trending — so you land on an arbitrary coin page. Its three interesting subsets
(Bonding, Graduated, Trending) exist only as tabs in one narrow side panel, so you can watch exactly
one of them at a time.

fobo shows all three at once.

## Status

Working and in daily use. Every endpoint, socket frame and formula is verified against the live
API and fomo's own bundle; the terminal is exercised end-to-end in Chrome after each change (see
`CLAUDE.md` for the verification tooling).

- [x] MV3 scaffold (Vite + CRXJS + React + TypeScript)
- [x] WebSocket client for fomo's three token lists, with its challenge handshake
- [x] Diff reducer matching fomo's `snapshot / new / update / remove` semantics
- [x] Mobula Pulse enrichment for holder/risk metrics
- [x] Three virtualised columns, Axiom-style cards, shadow-DOM isolation
- [x] FOMO Panel: a side rail switching between fomo's Alerts (followed-traders activity),
      the user's Watchlist, and fomo's social Feed — the view dropdown remembers its choice
      per tab; side and visibility set in the toolbar popup, width dragged on the panel's
      edge; fomo's alert ding replicated for live alerts with a popup toggle. Both live views
      carry fomo's own filters: the Feed's eight type groups, and the Alerts' trade-size /
      portfolio / market-cap bounds (fomo's $1k trade-size default), re-applied to live
      socket frames where the fields exist
- [x] Bottom bar: fomo's own footer recreated one-to-one — majors, watchlist ticker, status dot
- [x] Holdings bar: the account's open positions under the top bar, Axiom-style chips
- [x] Chain identifiers on column cards, using fomo's own chain glyph tiles
- [x] Header dropdowns: fomo's cash menu (Deposit / Withdraw) and profile menu (Your
      profile, Manage account, Settings, Transfers, Referrals, Log out) recreated with
      fomo's own icons; modal-backed items step aside and drive fomo's real menu
- [x] Render suppression: while the terminal is visible, fomo's page underneath skips
      layout/paint (`content-visibility`), so the landing token page's chart costs ~nothing
- [x] Tab mask: the visible terminal shows fomo.family/fobo-terminal and "fobo terminal" in
      the tab — a pure display mask; fomo's router never notices, and it lifts on handoff
- [x] Per-column filters and sort: sort by market cap / volume / holders / liquidity / age
      (highest or lowest first), filter by chain and min/max market cap, liquidity, holders,
      volume, and token age; saved in `chrome.storage.sync` so they survive reloads. The
      Graduated column defaults to newest-first
- [x] Visibility-aware: every poller, the Mobula warm-up and the socket reducer pause while
      the terminal is hidden behind fomo's own pages or the tab is in the background, and
      resume (with an immediate refresh) when it comes back
- [x] Socket liveness: handshake deadline, idle watchdog, reconnect on `online` / tab focus,
      and a "stale" badge in the column headers when frames stop arriving
- [x] Unit tests (`vitest`) for the protocol-mirroring modules and `eslint`; both run as part
      of `npm run build`
- [ ] More side-panel tabs (fomo's Tokens / Leaderboard)

## What it does

Three columns — **Bonding**, **Graduated**, **Trending** — fed live from fomo's own
`wss://prod-api.fomo.family/ws`, using the Privy session already in your browser. Cards show market
cap, volume, liquidity, age, price change, trade pressure, and holder-concentration metrics
(holder count, top-10 %, dev holdings), with a bonding-curve progress bar on the Bonding column.

Clicking a card opens that token on fomo. That is the only action a card has.

### Alerts panel

A fourth rail showing fomo's own Alerts feed — the trading activity of traders you follow:
swaps and transfers, multi-user buy/sell clusters, theses, and profit milestones. Backfilled
from `GET /feed/tradingActivity` and updated live over the same WebSocket (topic
`trading_activity`), both mirrored from fomo's own client. Scrolling the panel pages further
back; clicking a row opens the token, clicking a trader opens their profile.

The toolbar popup controls on/off, left or right side (default right) and the alert sound;
the width (280–560 px) is dragged on the panel's inner edge. Rows on chains fobo cannot name are
dropped rather than mislabelled, and a row only ever shows fields the feed actually carried.

### Bottom bar

fomo's own footer, recreated one-to-one inside the terminal: BTC/ETH/SOL/HYPE prices on the
left, then your watchlist as a drag-scrollable ticker (newest-starred first, capped at 15, market
cap under $10B shown as MC, otherwise price — fomo's own display rule), and on the right the
status dot (`status.fomo.family`), Privacy/Terms/Help, and the X/Discord icons. Prices refresh
every minute and status every five, matching fomo's intervals. The star beside a watchlist entry
un-stars it via the same `DELETE /watchlist` call fomo makes.

### Holdings bar

A slim strip under the top bar — modelled on Axiom Pulse's holdings bar, drawn in fomo's palette —
showing every token the account currently holds: icon, symbol, current value
(amount x fomo's price), and the trade's PnL percent using fomo's own open-position arithmetic
(realized + unrealized over cost basis, from `GET /v2/users/:id/balances`, the endpoint fomo's
positions list reads). USDC cash rows are not holdings; unpriceable rows are dropped. Sorted by
value, polled on fomo's 10s header cadence, absent entirely when there is nothing to show.
Clicking a chip opens the token on fomo.

### Scope limits

- **Read-only.** Cash, portfolio value and open positions are *displayed* from fomo's own API
  (the same endpoints fomo's header and positions list read); there are no keys, no signing and
  no trade submission. Anything transactional (deposit, withdraw, buy) hands off to fomo's own
  UI.
- Profile pages and coin pages are left exactly as fomo ships them.
- Nothing is injected into fomo's JavaScript context. fobo renders into a **closed** shadow root
  on a sibling element and opens its own API connection, so it never patches `fetch`,
  `WebSocket`, or React's DOM — and fomo's scripts cannot reach into the terminal's DOM either.
  Disabling the extension leaves the site untouched.
- The Privy JWT is read from the page's own `localStorage` at connect time, sent only to fomo's own
  API, and is never persisted by the extension or logged.
- **Third parties.** Besides fomo's API, the extension talks to two other hosts from your
  browser: `fomo-api.mobula.io` (Mobula's public Pulse endpoint, for holder/risk metrics —
  polled per chain on screen while the terminal is visible) and `status.fomo.family` (fomo's
  status page). Mobula therefore sees your IP address and that you are on fomo; nothing else is
  sent to it. If either host is blocked or fomo's CSP changes, the cards simply omit those
  metrics and a single warning is logged.
- **The address bar** shows `fomo.family/fobo-terminal` while the terminal is visible (a display
  mask; fomo's router never sees it). Copying that URL gives a link that only works with the
  extension installed — anyone else lands on fomo's 404 view. Copy the token's own link from a
  card (right-click → copy link) when sharing.

## Build

```bash
npm install
npm run build     # typecheck + lint + tests, then a one-off build
npm run watch     # rebuild on every save (no checks)
npm run check     # typecheck + lint + tests only
```

`npm run build` refuses to write into an output directory that is not named `dist`, is not
empty, and holds no `manifest.json` — a guard against a mistyped `FOBO_OUT_DIR` wiping something
else.

Then load it:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the build output directory
4. Open <https://fomo.family/> while signed in

Hit **Reload** on the extension card after a rebuild; the host page needs reloading too. The toolbar
icon toggles fobo on and off, and `Esc` dismisses the overlay (a small `fobo` button brings it back).

### Building from WSL for Chrome on Windows

The source can live in WSL while Chrome runs on Windows. Set the output directory to a Windows path
in `.env.local` (gitignored):

```
FOBO_OUT_DIR=/mnt/c/Users/<you>/fobo-terminal/dist
```

`npm run watch` then rewrites that directory on every save, so Chrome always sees current code —
load `C:\Users\<you>\fobo-terminal\dist` once and just hit Reload after a change.

Do **not** point Chrome at a `\\wsl.localhost\...` UNC path; use a real Windows path.

**There is no HMR dev server.** `npm run dev` is an alias for `npm run watch`, and the Vite
dev-server path has been removed, for two independent reasons:

- CRXJS hard-codes `http://localhost:<port>` into the dev loader, and Windows resolves `localhost`
  to IPv6 `::1` first. Across a mirrored-networking WSL boundary only the IPv4 loopback is shared —
  `127.0.0.1:<port>` answers, `[::1]:<port>` times out — so the extension can never reach it.
- CRXJS 2.7.1's HMR client is broken regardless. It substitutes its `__LIVE_RELOAD__` placeholder
  with a string-pattern `String.prototype.replace`, which rewrites only the first of two
  occurrences; the survivor throws `ReferenceError: __LIVE_RELOAD__ is not defined` as soon as the
  socket drops. That kills the service worker and leaves the page holding a dead port
  (`Attempting to use a disconnected port object`, `Extension context invalidated`).

`npm run watch` produces a self-contained build with none of that machinery.

If a reload ever lands on `Uncaught SyntaxError: Unexpected end of input`, Chrome read a chunk
while the watcher was still writing it — rebuild finishes in under a second, so just reload again.

## Publishing to the Chrome Web Store

Everything the store asks for lives in [`store/LISTING.md`](store/LISTING.md): account setup
(one-time fee, 2-Step Verification, trader declaration), the listing copy, the permission
justifications and data-usage answers for the Privacy tab, and the test instructions for
reviewers. The image uploads are in `store/` (icon, two 1280×800 screenshots, promo tiles), and
[`PRIVACY.md`](PRIVACY.md) is the privacy policy to host at a public URL.

```bash
npm run package   # checks + build into ./dist, then release/fobo-terminal-<version>.zip
```

The zip has `manifest.json` at its root and no sourcemaps. Bump `version` in `package.json`
before each upload — the store refuses a version it has already seen.

## How it works

| Piece | Role |
|---|---|
| `src/content/` | The UI. Mounts a shadow root on a sibling of fomo's tree and renders the columns. |
| `src/lib/fomoSocket.ts` | Connects to fomo's WebSocket, does the challenge handshake, subscribes to all three topics. |
| `src/lib/listStore.ts` | Applies fomo's list diff protocol, mirroring their reducer exactly. |
| `src/lib/mobula.ts` | Fetches Mobula's open Pulse endpoint for the holder/risk metrics fomo's rows don't carry. |
| `src/background/` | Preferences and the toolbar toggle. Deliberately does no fetching. |

Two design notes worth knowing:

**We open our own socket rather than observing fomo's.** fomo subscribes to only one list at a time
— whichever tab its panel has open. Verified live: switching to Bonding froze `trending_tokens` at
12 frames while `pre_graduated_tokens` climbed past 100. Passive mirroring could only ever fill one
column, so fobo is a second client of the same session instead.

**All network access happens in the page, not the service worker.** `prod-api.fomo.family` sits
behind Cloudflare bot management that rejects non-browser clients; a service-worker fetch gets a 403.

## License

Not yet chosen.
