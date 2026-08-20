# fobo-terminal

A Chrome extension (Manifest V3) that gives [fomo.family](https://fomo.family/) the home screen it
doesn't have: a dense, live, three-column token feed modelled on Axiom's Pulse page, rendered in
fomo's own design language.

## Why

fomo has no home screen. After login `/` redirects to `/token`, which redirects to whichever token
is currently #1 trending — so you land on an arbitrary coin page. Its three interesting subsets
(Bonding, Graduated, Trending) exist only as tabs in one narrow side panel, so you can watch exactly
one of them at a time.

fobo shows all three at once.

## Status

Early. The data layer and UI are implemented and the protocol is verified against the live API, but
the extension has **not yet been loaded in a browser end-to-end** — that is the next step.

- [x] MV3 scaffold (Vite + CRXJS + React + TypeScript)
- [x] WebSocket client for fomo's three token lists, with its challenge handshake
- [x] Diff reducer matching fomo's `snapshot / new / update / remove` semantics
- [x] Mobula Pulse enrichment for holder/risk metrics
- [x] Three virtualised columns, Axiom-style cards, shadow-DOM isolation
- [x] FOMO Panel: a side rail switching between fomo's Alerts (followed-traders activity),
      the user's Watchlist, and fomo's social Feed — the view dropdown remembers its choice
      per tab; side and visibility set in the toolbar popup, width dragged on the panel's
      edge; fomo's alert ding replicated for live alerts with a popup toggle
- [x] Bottom bar: fomo's own footer recreated one-to-one — majors, watchlist ticker, status dot
- [x] Holdings bar: the account's open positions under the top bar, Axiom-style chips
- [x] Chain identifiers on column cards, using fomo's own chain glyph tiles
- [x] Render suppression: while the terminal is visible, fomo's page underneath skips
      layout/paint (`content-visibility`), so the landing token page's chart costs ~nothing
- [x] Tab mask: the visible terminal shows fomo.family/fobo-terminal and "fobo terminal" in
      the tab — a pure display mask; fomo's router never notices, and it lifts on handoff
- [x] Per-column filters and sort: sort by market cap / volume / holders / liquidity / age
      (highest or lowest first), filter by chain and min/max market cap, liquidity, holders,
      volume, and token age; saved in `chrome.storage.sync` so they survive reloads. The
      Graduated column defaults to newest-first
- [ ] Manual verification in Chrome
- [ ] More side-panel tabs (fomo's Tokens / Leaderboard / Feed)

## What it does

Three columns — **Bonding**, **Graduated**, **Trending** — fed live from fomo's own
`wss://prod-api.fomo.family/ws`, using the Privy session already in your browser. Cards show market
cap, volume, liquidity, age, price change, trade pressure, and holder-concentration metrics
(top-10 %, dev holdings, snipers, insiders, bundled supply), with a bonding-curve progress bar on
the Bonding column.

Clicking a card opens that token on fomo. That is the only action a card has.

### Alerts panel

A fourth rail showing fomo's own Alerts feed — the trading activity of traders you follow:
swaps and transfers, multi-user buy/sell clusters, theses, and profit milestones. Backfilled
from `GET /feed/tradingActivity` and updated live over the same WebSocket (topic
`trading_activity`), both mirrored from fomo's own client. Scrolling the panel pages further
back; clicking a row opens the token, clicking a trader opens their profile.

The toolbar popup controls it: on/off, left or right side (default right), and width
(280–480 px). Rows on chains fobo cannot name are dropped rather than mislabelled, and a row
only ever shows fields the feed actually carried.

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

- **Wallet is never read, touched, or displayed.** No balances, no keys, no signing, no trade
  submission. Cards are read-only and hand off to fomo for anything transactional.
- Profile pages and coin pages are left exactly as fomo ships them.
- Nothing is injected into fomo's JavaScript context. fobo renders into a shadow root on a sibling
  element and opens its own API connection, so it never patches `fetch`, `WebSocket`, or React's
  DOM. Disabling the extension leaves the site untouched.
- The Privy JWT is read from the page's own `localStorage` at connect time, sent only to fomo's own
  API, and is never persisted by the extension or logged.

## Build

```bash
npm install
npm run build     # one-off build
npm run watch     # rebuild on every save
```

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
