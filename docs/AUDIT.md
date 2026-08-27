# fobo-terminal audit

Date: 2026-08-24. Scope: every file under `src/`, `manifest.config.ts`, `vite.config.ts`,
`package.json`, `README.md`. Method: full source read, `npm audit` (0 vulnerabilities across
prod and dev deps), `tsc --noEmit` (clean). No code was changed; this file is the only output.

Severity: **High** = user-visible breakage or silent wrong/stale data · **Medium** = degraded
behaviour or measurable waste · **Low** = hardening / polish · **Info** = worth knowing, no action
required.

## Summary

| # | Area | Severity | Issue |
|---|---|---|---|
| S1 | Security | Medium | Shadow root is `open`; page scripts can read and drive the terminal UI |
| S2 | Security | Low | Terminal control state lives in page-shared `sessionStorage` |
| S3 | Security | Low | Navigation hrefs built from unencoded API strings, with a `location.assign` fallback |
| S4 | Security | Low | Remote image URLs from API/socket rendered without scheme or referrer policy |
| S5 | Security | Low | Third-party/off-manifest endpoints depend on fomo's CSP and leak browsing to Mobula |
| S6 | Security | Low | Synthetic clicks on fomo's real menu items are matched by visible text (includes "Log out") |
| S7 | Security | Low | `emptyOutDir: true` on an env-supplied output path |
| S8 | Security | Info | Sourcemaps shipped in the build |
| S9 | Security | Info | `isLoggedIn` reads the refresh-token value; `onMessage` has no sender check |
| P1 | Performance | High | Every poller, the socket and React updates keep running while the terminal is hidden |
| P2 | Performance | Medium | Mobula Pulse: up to ~9 MB/min of JSON parsed on the main thread, no timeout, no visibility gate |
| P3 | Performance | Medium | 300 ms `setInterval` route poll with `sessionStorage` reads per tick, for the page's whole life |
| P4 | Performance | Medium | Duplicate requests: `/v2/users/current` ×3 at mount, `/watchlist` polled twice, balances polled by two unaligned timers |
| P5 | Performance | Low | Every socket frame triggers a full filter+sort recompute of all three columns |
| P6 | Performance | Low | List store is unbounded; the 100-row cap only applies at render |
| P7 | Performance | Low | AudioContext and the ding MP3 are created on first click even with sound off |
| F1 | Functionality | High | The `/` search shortcut swallows `/` keystrokes in fomo's own inputs while the terminal is hidden |
| F2 | Functionality | High | One-shot `currentUser()` in TopBar and App: header chips and live alerts never recover from one failed call |
| F3 | Functionality | High | Socket has no heartbeat, auth timeout or `error`-frame handling; lists can freeze while showing "authenticated" |
| F4 | Functionality | High | Alerts filters write `chrome.storage.sync` and refetch (wiping the list) on every keystroke |
| F5 | Functionality | Medium | Popup writes a stale full settings object, clobbering width/filters changed since it opened |
| F6 | Functionality | Medium | `content-visibility: hidden` on all body children also hides fomo's toast/portal roots created at boot |
| F7 | Functionality | Medium | Bottom-bar watchlist strip blanks on a transient `/watchlist` failure |
| F8 | Functionality | Medium | Nested `<button>` inside `<button>` rows (invalid HTML, broken a11y) |
| F9 | Functionality | Low | Any server redirect (`redirectCount > 0`) is treated as home intent |
| F10 | Functionality | Low | Masked address `/fobo-terminal` is what gets copied/shared and 404s without the extension |
| F11 | Functionality | Low | Storage reads other than `readEnabled` have no timeout guard |
| F12 | Functionality | Low | 401/403 are indistinguishable from network errors; UI shows "-" with no hint |
| F13 | Functionality | Low | No `icons` / `action.default_icon` in the manifest |
| F14 | Functionality | Low | `usd()` renders negatives as `$-1.2K` |
| M1 | Docs | Medium | README contradicts the code in six places (CLAUDE.md requires it to stay truthful) |
| M2 | Maintainability | Low | Dead code and duplicated literals |
| M3 | Maintainability | Medium | No lint config despite `eslint-disable` comments; no tests for the protocol-mirroring modules |

What is already solid and worth keeping: minimal permissions (`storage` + one host), isolated
world only, no remote code, every wire shape parsed defensively with drop-not-guess semantics,
React text rendering (no `dangerouslySetInnerHTML`), `rel="noopener noreferrer"` on external
links, bounded caps on alerts/feed/marks, debounced column-pref writes, the CRXJS sourcemap
repair, and the scroll-lock/render-suppression save-and-restore discipline.

---

## Security

### S1 · Open shadow root exposes the terminal to page scripts — Medium

**Description.** `src/content/index.tsx:510` calls `host.attachShadow({ mode: 'open' })`. Any
script running in fomo's main world (fomo itself, its analytics/third-party tags, or an XSS on
fomo) can do `document.getElementById('fobo-terminal-root').shadowRoot` and read the search
input, the holdings/cash figures rendered in the top bar, and synthesise clicks on terminal
controls (including the header-menu items that drive fomo's own Withdraw / Log out flows).
The isolated world protects the extension's JS state, not its DOM.

**Solution.** Use `mode: 'closed'` and keep the `ShadowRoot` reference in the content-script
closure (`const shadow = host.attachShadow({ mode: 'closed' })` — the code already keeps
`host`/`root` in module scope, so nothing else needs the open handle). `composedPath()`-based
click-away logic inside the shadow tree keeps working because those listeners run inside it.
The `sound.ts:60` visibility check that queries the host by id still works (it only reads
`dataset` on the host element, not the shadow tree).

**Benefits.** Page scripts cannot inspect or drive the terminal; the rendered balances and
search text are no longer reachable from fomo's world; no behaviour change for the user.

### S2 · Control state in page-shared `sessionStorage` — Low

**Description.** `fobo:terminal-paths`, `fobo:dismissed`, `fobo:pending-home` and
`fobo:panel-view` (`index.tsx:19,32,762`, `settings.ts:142`) are read from
`window.sessionStorage`, which fomo's main-world code shares. A page script can mark arbitrary
paths so the terminal mounts over any page, or clear dismissal. The values are sanitised on
read (`readMarks` filters to strings, `isPendingHome` validates the number), so this is a
nuisance vector, not a code-execution one.

**Solution.** Keep the sanitisation, and treat the values as untrusted hints: cap `readMarks()`
to `MARK_LIMIT` on read as well as write, and only honour `fobo:pending-home` when it was set
within the current document (compare against a per-document nonce stored in a module
variable). If stronger isolation is wanted, `chrome.storage.session` (MV3, Chrome 102+) is
extension-private and tab-keyed via `chrome.tabs` metadata — but it is async, so `decide()`
would need an in-memory mirror.

**Benefits.** A compromised or misbehaving page cannot steer where the terminal appears.

### S3 · Hrefs from API strings are unencoded; `navigate` falls back to `location.assign` — Low

**Description.** Paths are assembled by template: `/tokens/${chain}/${address}`
(`App.tsx:436`, `TokenCard.tsx:77`, `HoldingsBar.tsx:27`, `BottomBar.tsx:69`,
`AlertsPanel.tsx:278`, `FeedView.tsx:320`) and `/profile/${userHandle}` (`TopBar.tsx:215`,
`AlertsPanel.tsx:279`, `FeedView.tsx:321-323`). `address` and `userHandle` come from REST and
socket payloads unvalidated; a value containing `/`, `?`, `#` or `..` rewrites the destination.
`navigate()` (`index.tsx:545-576`) then does `history.pushState(null, '', href)` and, if that
throws, `window.location.assign(href)`. Because every href starts with a fixed `/tokens/` or
`/profile/` prefix a cross-origin `//host` form is not reachable today, so this is hardening
rather than an exploitable open redirect — but the fallback would become one the moment a
caller passes a less constrained string.

**Solution.** `encodeURIComponent` every interpolated segment (or validate `address` against
the `EVM_ADDRESS` / `SOLANA_ADDRESS` patterns already in `fomoApi.ts:388-389` and handles
against `/^[\w.-]+$/`). In `navigate()`, resolve with `new URL(href, origin)`, require
`url.origin === location.origin`, and only ever `assign()` the resolved same-origin `pathname +
search + hash`.

**Benefits.** Destinations are exactly the intended fomo page; no path traversal or future
open-redirect surface.

### S4 · Remote images rendered without scheme or referrer policy — Low

**Description.** `token.logo`, `tokenImageUrl`, `profilePictureLink` and `userImageUrl` are
rendered straight into `<img src>` (`TokenCard.tsx:31-38`, `AlertsPanel.tsx:46,64,130-137`,
`FeedView.tsx:37,93-100`, `TopBar.tsx:82`, `HoldingsBar.tsx:39`, `BottomBar.tsx:80`). They are
attacker-influenced strings (token metadata is user-submitted upstream). Images cannot execute
script, but `http:` URLs trigger mixed-content blocks, `data:` URLs bypass fomo's `img-src`
allow-list intent, and every load sends fomo's current URL as `Referer` to whatever host the
token creator chose.

**Solution.** Add a tiny `safeImageUrl(raw)` that returns `undefined` unless
`new URL(raw).protocol === 'https:'`, use it at the parse boundary (`fromFomoRow`,
`parseAlert`, `parseFeedItem`, `fromFlatRow`), and set `referrerPolicy="no-referrer"` on the
`<img>` elements.

**Benefits.** No mixed-content noise, no referrer leakage of the user's fomo route to arbitrary
hosts, and the "drop-not-guess" rule extends to media.

### S5 · Off-manifest endpoints rely on fomo's CSP and disclose browsing to Mobula — Low

**Description.** `mobula.ts:14,66` fetches `https://fomo-api.mobula.io/api/2/pulse` and
`fomoApi.ts:520` fetches `https://status.fomo.family/prod`. Neither host is in
`host_permissions` (`manifest.config.ts:16`), so the requests go out as page requests, subject
to fomo's `connect-src`. That is a deliberate choice and is the right permission posture, but
it means (a) a CSP tightening by fomo silently strips enrichment and the status dot, and (b)
every minute, per chain, the user's IP and the fact they are on fomo are sent to Mobula from an
extension the user did not read Mobula's privacy terms for. README does not mention Mobula as a
data recipient.

**Solution.** Document Mobula and status.fomo.family as third-party recipients in README (and
the store listing if published). Log a single `console.warn` when a Mobula fetch fails with a
`TypeError` (CSP/network) so a silent enrichment loss is diagnosable. Consider an opt-in toggle
for enrichment in the popup.

**Benefits.** Honest disclosure; enrichment failures become diagnosable instead of "cards got
sparser".

### S6 · Text-matched synthetic clicks on fomo's real menu items — Low

**Description.** `requestHeaderMenu()` (`index.tsx:456-497`) dispatches a pointer sequence on
fomo's Radix trigger and then clicks the first `a, button` whose `textContent` equals the label,
including `'Log out'`. If fomo reorders, renames or localises the menu, or a page script
injects an element with matching text inside that `<li>`, the terminal fires a different
action than the one the user chose. `findDepositButton()` (`index.tsx:392-399`) has the same
shape.

**Solution.** Prefer stable selectors where fomo has them (`a[href="/profile/..."]`,
`a[href="/settings"]`, `data-*` attributes if present) and fall back to text only when no
href-bearing element matches. For destructive items (Log out, Withdraw) require that exactly
one candidate matched; if zero or more than one, do nothing — which is the file's own stated
philosophy ("nothing happens rather than something invented").

**Benefits.** No mis-click on a destructive item after an upstream menu change.

### S7 · `emptyOutDir: true` on an env-supplied path — Low

**Description.** `vite.config.ts:99-103` sets `outDir` from `FOBO_OUT_DIR` and
`emptyOutDir: true`. A typo in `.env.local` (e.g. `/mnt/c/Users/<you>`) makes the next
`npm run build` delete everything in that directory.

**Solution.** Refuse to build unless the resolved `outDir` basename is `dist` or the directory
is empty / already contains a `manifest.json`, e.g. a guard in `defineConfig` that throws with a
clear message otherwise.

**Benefits.** A one-character mistake in a gitignored file cannot wipe a user directory.

### S8 · Sourcemaps shipped — Info

**Description.** `vite.config.ts:100` `sourcemap: true` emits `.map` files (and the repair
plugin depends on the sourcemap comment being present). For a private unpacked extension that
is fine; for any distributed build it ships full readable source and roughly doubles package
size.

**Solution.** Use `sourcemap: 'hidden'` for release builds (keeps the `.map` for local
debugging, omits the `//# sourceMappingURL` comment) — note this also sidesteps the CRXJS IIFE
bug the repair plugin exists for, so the plugin can stay as a no-op safety net.

**Benefits.** Smaller package; source not shipped to end users.

### S9 · Token reads and message-sender checks — Info

**Description.** `index.tsx:157` reads the value of `privy:refresh_token` (only to compare it
to `"deprecated"`), and `readJwt()` (`fomoApi.ts:17-26`) reads the access token on every REST
call. Neither is persisted or logged — the README's claim holds. `chrome.runtime.onMessage`
(`index.tsx:730`) does not check `sender.id`; with no `externally_connectable` only the
extension's own contexts can send, so this is defence in depth only.

**Solution.** `isLoggedIn` can test presence (`getItem(...) !== null`) rather than reading the
value into a string. Add `if (sender.id !== chrome.runtime.id) return` to the message listener.

**Benefits.** Smaller handling surface for a refresh token; message handler is explicit about
trust.

---

## Performance

### P1 · Everything keeps running while the terminal is hidden — High

**Description.** A handoff calls `hide()` (`index.tsx:370-378`), which sets
`data-fobo-hidden`; CSS makes the host `visibility: hidden` (`styles.css:42-45`) but the React
tree stays mounted by design so Back is instant. Nothing else pauses. On every fomo coin page
the user has navigated to, the extension still runs:

- the WebSocket with three list topics plus alerts, and `setLists` on every frame
  (`App.tsx:323-353`), which re-runs the `enriched` memo (`App.tsx:402-419`) and re-renders
  three virtualised columns into an invisible tree — `visibility: hidden` elements are still
  laid out;
- balances every 10 s from two components (`TopBar.tsx:37,192-205`,
  `HoldingsBar.tsx:20,67-80`), the ticker every 60 s and status every 5 min
  (`BottomBar.tsx:49-50,161-172`), the watchlist and feed views every 60 s
  (`App.tsx:250-268,279-303`), Mobula every 30 s (`App.tsx:375-389`), and the 30 s relative-time
  clocks (`AlertsPanel.tsx:18,256-259`, `FeedView.tsx:26,298-301`);
- none of it checks `document.hidden`, so a backgrounded tab pays the same.

This runs on top of fomo's own token page, which is the heaviest page on the site.

**Solution.** Introduce one visibility signal — e.g. a `terminalVisible` boolean exported from
`content/index.tsx` via a custom `fobo:shown` event to pair with the existing `fobo:hidden`,
combined with `document.visibilityState` — and a `useWhenVisible(callback, intervalMs)` hook
that starts the interval on show and clears it on hide (running the callback once on show so
data is fresh). Apply it to every poller above. For the socket, keep the connection warm but
buffer diffs into a ref while hidden and flush them (as one `setLists`) on show; likewise skip
`warm()` and the enrich stamp while hidden. Optionally set `content-visibility: hidden` on the
`.shell` container while hidden so the invisible tree also skips layout (the virtualisers
re-measure on show via their ResizeObservers; test that the columns do not flash empty).

**Benefits.** Near-zero CPU and network from the extension on fomo's own pages and in
background tabs; less battery; less contention with fomo's chart. The user-facing behaviour
(instant Back) is unchanged.

### P2 · Mobula Pulse payload size and polling — Medium

**Description.** `mobula.ts:16-17` notes the payload is ~1.5 MB per chain. `warm()` is invoked
every 30 s (`App.tsx:381-384`) for every chain on screen (up to six), with a 60 s TTL — so up
to ~9 MB/min downloaded and `JSON.parse`d on the page's main thread, then reduced to a map of
which only the ≤300 rendered tokens are read. There is no `AbortController` timeout, so a
stalled response holds the `inflight` slot indefinitely; a failed fetch is retried on the next
30 s tick with no backoff.

**Solution.** Gate on visibility (P1). Add a fetch timeout (`AbortSignal.timeout(15_000)`) and
exponential backoff per chain after failures. Send `Accept-Encoding` is automatic, but check
whether Mobula honours `If-None-Match`/ETag and use it if so. Consider whether the `model` /
`assetMode` query parameters or a per-token lookup endpoint can return a smaller slice; if
not, at least raise `TTL_MS` when the terminal is hidden.

**Benefits.** Substantially lower bandwidth and main-thread parse time; no stuck in-flight
slot; failure behaviour is bounded.

### P3 · 300 ms route poll for the page's lifetime — Medium

**Description.** `watchRoute()` (`index.tsx:649-703`) installs `setInterval(check, 300)` that is
never cleared. Each tick with an unchanged path still evaluates `isPendingHome()`
(`index.tsx:778-791`), which reads and parses `sessionStorage` every 300 ms. The comment
explains why: isolated-world scripts cannot see fomo's `pushState`.

**Solution.** The Navigation API is available from Chrome 102 (manifest already requires 111)
and its events fire on the shared `document`, so an isolated-world listener sees fomo's
client-side navigations: `window.navigation.addEventListener('currententrychange', check)`
alongside the existing `popstate`/`hashchange`/`pageshow` listeners. Keep a slow fallback poll
(e.g. 2 s) for safety, and make `isPendingHome()` cheap on the hot path by caching the parsed
timestamp in a module variable and only re-reading storage when the path actually changes.
Verify live with the opencli harness that `currententrychange` fires for fomo's redirects.

**Benefits.** Route changes are detected immediately instead of up to 300 ms late (which also
shrinks the transit-hop race the settle logic exists for), and idle cost drops to nothing.

### P4 · Duplicate requests at mount and on timers — Medium

**Description.** At mount `/v2/users/current` is requested three times — `App.tsx:349`,
`TopBar.tsx:184`, `HoldingsBar.tsx:55`. `/watchlist` is polled by both the bottom bar
(`BottomBar.tsx:143`) and the watchlist view (`watchlist.ts:23`) on their own 60 s clocks.
Balances are polled by TopBar and HoldingsBar on independent 10 s timers with a 5 s cache
(`fomoApi.ts:161-173`), so whenever their phases differ by more than 5 s it is two requests per
10 s instead of one. `appStatus`, the majors and the watchlist ticker share nothing with the
side panel.

**Solution.** A small module-level resource layer: `currentUser()` memoised as a single promise
with retry-until-success (which also fixes F2); `useBalances(userId)` / `useWatchlist()` hooks
that hold one interval and one subscriber list (or a minimal SWR-style cache keyed by path with
TTL + `subscribe`). Components then read from the shared store instead of running their own
timers.

**Benefits.** One request per resource per interval; fewer Cloudflare bot-management round
trips; consistent numbers across the header and holdings bar; a single place to add P1's
visibility gate.

### P5 · Full recompute per socket frame — Low

**Description.** Each socket `data` frame calls `setLists` (`App.tsx:335`); `applyDiff` copies
the list; then the `enriched` memo (`App.tsx:402-419`) maps, filters and sorts all three lists
because its dependency is the whole `lists` object. During bursts (trending re-orders several
times a second) that is several full passes per second plus three column re-renders.

**Solution.** Coalesce diffs: push frames into a ref and flush once per animation frame (or
every ~100 ms) with a single `setLists`. Split the memo per list (`useMemo` per `ListKey`
keyed on `lists[key]`, `colPrefs[key]`, `enrichStamp`) so an update to trending does not
re-sort bonding and graduated.

**Benefits.** Bounded render rate under load; smoother scrolling during bursts.

### P6 · Unbounded list store — Low

**Description.** `listStore.ts:22` documents that the store keeps fomo's full list and applies
`MAX_ROWS` only at render. `applyDiff` never caps, so if fomo's server sends more `new` than
`remove` frames over a long session the arrays grow without limit, and every `applyDiff` copy
and every `enriched` pass scale with that length.

**Solution.** Cap the store after `new`/`update` at a generous multiple of the render cap (e.g.
`5 × MAX_ROWS`), trimming from the tail — the tail is exactly what fomo's own client never
renders.

**Benefits.** Memory and per-frame work stay bounded for a tab left open all day.

### P7 · AudioContext created on first click regardless of settings — Low

**Description.** `App.tsx:126-129` calls `unlockAudio` on any capture-phase `pointerdown` on
the whole window — including while the terminal is hidden on fomo's pages — and `unlockAudio`
(`sound.ts:39-50`) constructs an `AudioContext` and fetches the MP3 even when the panel is off
or sound is disabled.

**Solution.** Check `soundRef.current && panelEnabled` before calling `unlockAudio`, and only
while the terminal is visible.

**Benefits.** No audio graph or asset fetch for users who never hear a ding.

---

## Functionality

### F1 · `/` shortcut steals keystrokes from fomo's inputs — High

**Description.** `TopBar.tsx:150-162` registers a `window` `keydown` listener that, on `/`,
calls `event.preventDefault()` and focuses the terminal's search box. The only guard is "the
terminal input is not already focused". Because the terminal is hidden rather than unmounted
on handoff, this listener is live on every fomo page the user visits: typing `/` in fomo's own
search field, a thesis comment box, or any textarea is cancelled and focus jumps to an
invisible input. `preventDefault` at the window bubble phase suppresses the character insertion
even though fomo's handlers ran first.

**Solution.** Bail unless the terminal is visible (`host.dataset.foboHidden === undefined` — the
same check `sound.ts:60-61` performs), ignore the event when `event.composedPath()` contains an
editable element (`input`, `textarea`, `[contenteditable]`, `select`) or when any modifier key
is held, and ignore `event.isComposing`. Better still, register/unregister the listener in an
effect keyed on the visibility signal from P1.

**Benefits.** No lost characters or focus jumps in fomo's own UI; the shortcut still works
inside the terminal.

### F2 · One-shot `currentUser()` leaves the header and live alerts dead — High

**Description.** `TopBar.tsx:182-190` and `App.tsx:349-351` call `currentUser()` exactly once
when the app mounts. `fomoCall` returns `null` on any failure — including the common case where
the content script (run at `document_idle`) mounts before Privy has written `privy:token`, so
`readJwt()` is `null` and the call short-circuits (`fomoApi.ts:43-44`). When that happens the
cash/portfolio chips never appear and `socket.setAlertUser` is never called, so the
`trading_activity` topic is never subscribed and the Alerts view shows only the backfill for the
rest of the session. `HoldingsBar.tsx:51-65` already retries every 5 s, which is why the
holdings strip can appear while the header stays blank.

**Solution.** One shared `currentUser()` with retry (exponential up to 30 s, until success), or
the resource layer from P4. On success, both TopBar and App consume the same promise. Also
re-run it when the socket status transitions to `authenticated` — that event proves a JWT now
exists.

**Benefits.** Header numbers and live alerts appear reliably after login and cold loads; fewer
duplicate requests.

### F3 · Socket liveness: no heartbeat, no auth timeout, `error` frames ignored — High

**Description.** `fomoSocket.ts`:

- `case 'error'` (`:143-147`) does nothing, assuming the server will close. If the server
  keeps the connection open after rejecting the challenge (expired JWT is the realistic case),
  `ready` stays `false`, no retry is scheduled, and the status is stuck at `connecting` forever.
- There is no timeout between `open` and `challengeAccepted`; a half-open connection hangs in
  `connecting` indefinitely.
- There is no idle watchdog. After laptop sleep or a network change the TCP connection can be
  dead for minutes before the OS surfaces a `close`; during that window the columns stop
  updating while the status still reads `authenticated`. For a product whose value is "live",
  silently stale is the worst failure mode.
- Reconnect is not triggered by `online` or `visibilitychange`.

**Solution.** On an `error` frame call `socket.close()` (the existing `close` handler then
schedules the retry). Add an auth timer (e.g. 10 s from `connect()` without
`challengeAccepted` → `close()`). Add a watchdog: record `lastFrameAt` on every message and, if
nothing arrives for N seconds (choose N by observing fomo's own frame cadence — trending is
frequent; or mirror fomo's ping if its client sends one), close and reconnect. Listen for
`window.online` and `visibilitychange → visible` to reconnect immediately when `closed`.
Surface `lastFrameAt` in the UI (the column header could show "stale" after N seconds).

**Benefits.** Columns never freeze silently; recovery from sleep/network changes is seconds,
not minutes; the status indicator becomes trustworthy.

### F4 · Alerts filters write storage and refetch on every keystroke — High

**Description.** `PanelFilters.tsx:63-64` calls `onAlertsFiltersChange` per `onChange`;
`App.tsx:162-169` immediately `saveAlertsSettings()` (an unthrottled `chrome.storage.sync.set`,
`settings.ts:97-103`) and the effect at `App.tsx:207-228` is keyed on the parsed filters, so it
runs `setAlerts([])` and a fresh `/feed/tradingActivity` request for each character. Typing
`50000` produces five writes and five requests, and the list blanks and reloads five times.
`chrome.storage.sync` allows 120 writes per minute; the `void`ed promise rejects unhandled when
that is exceeded. Column prefs already solve this with a 400 ms debounce
(`columnPrefs.ts:272-293`); the panel filters do not.

**Solution.** Keep a local draft in `PanelFilters`, commit on blur / Enter / 400 ms idle; route
the commit through a debounced `saveAlertsSettings` like `saveColumnPrefs`. In the backfill
effect, keep the current list on screen until the new first page arrives (replace rather than
clear), and cancel the in-flight request when the key changes.

**Benefits.** One request and one write per edit; no flicker; no sync-quota rejections.

### F5 · Popup overwrites concurrent settings changes — Medium

**Description.** `popup/main.ts:38-47` loads `AlertsSettings` once when the popup opens and
`save()` spreads that snapshot with the one patched field, writing the whole object. Width is
committed by the content script on drag end, and feed groups / alert filters by the panel. If
any of those change while the popup is open (or the user has two windows), toggling sound in
the popup writes the stale width/filters back.

**Solution.** Make `save()` read-modify-write: `const stored = await readAlertsSettings();
set({ ...stored, ...patch })`. Additionally subscribe the popup to `chrome.storage.onChanged`
and re-`reflect()`.

**Benefits.** No preference is silently reverted.

### F6 · Render suppression hides fomo's boot-time portal/toast roots — Medium

**Description.** `suppressPageRender()` (`index.tsx:330-340`) applies `content-visibility:
hidden` to every element that is a direct child of `<body>` at the moment the terminal shows.
The comment notes that nodes portalled in later stay live. Toast libraries (sonner,
react-hot-toast, Radix Toast) and many modal roots create their container `<div>` once at boot
and reuse it — those are hidden too, so a trade confirmation, error toast or session-expiry
notice fomo raises while the terminal is visible is invisible. Whether fomo's toaster is
boot-created needs a live check (`opencli … eval "[...document.body.children].map(e=>e.id||e.className)"`).

**Solution.** Suppress only fomo's app root (the child containing fomo's `nav`/router outlet)
and leave siblings alone; or exclude children matching `[role=status], [role=alert],
[data-sonner-toaster], [data-radix-portal], [aria-live]`. Re-verify after fomo deploys.

**Benefits.** fomo's notifications remain visible over the terminal; the performance win from
suppressing the chart is unchanged.

### F7 · Bottom-bar watchlist blanks on a transient failure — Medium

**Description.** `BottomBar.tsx:143` does `(await watchlist()) ?? []`. If `/watchlist` fails
(network blip, 401 during token refresh) but `/proxy/filterTokens` for the majors succeeds,
`setWatched([])` removes the whole strip until the next 60 s tick. The side panel's watchlist
view explicitly keeps its last good list (`App.tsx:258-260`); the bottom bar does not. `remove()`
(`:174-181`) is optimistic with no rollback when `watchlistRemove` returns `false`.

**Solution.** Return early when `watchlist()` is `null` (refresh only the majors), and on a
failed `watchlistRemove` restore the row (or skip the optimistic removal and wait for the
refresh).

**Benefits.** The ticker degrades to "stale" rather than "empty"; an un-star that failed does
not lie.

### F8 · Nested interactive controls — Medium

**Description.** Alert and feed rows are `<button className="alert-row">`
(`AlertsPanel.tsx:307`, `FeedView.tsx:349`) and contain further `<button>`s: `TraderName`
(`AlertsPanel.tsx:85-94`) and post links (`FeedView.tsx:260-269`). HTML forbids interactive
content inside `<button>`; React logs `validateDOMNesting` warnings; screen readers announce
one control; keyboard activation of the inner button also activates the outer one in some
browsers (the code relies on `stopPropagation` on click only).

**Solution.** Make the row a `<div role="button" tabIndex={0}>` with `onClick` and an
Enter/Space `onKeyDown`, or a `<a href=…>` (matching `TokenCard`, which already uses an anchor
and preserves modified-click behaviour), and keep the inner trader/post links as real
`<button>`/`<a>` elements.

**Benefits.** Valid DOM, correct accessibility tree, predictable keyboard behaviour, and
middle-click / ctrl-click "open in new tab" on alert rows for free if they become anchors.

### F9 · Any server redirect counts as home intent — Low

**Description.** `recordEntryIntent()` (`index.tsx:820-825`) treats `entry.redirectCount > 0`
as a home entry. That is correct for fomo's `/` → coin redirect, but also true for an
`http://` → `https://` upgrade or any short-link/marketing redirect that lands on a deep page
the user explicitly asked for — the terminal then mounts over it.

**Solution.** Only honour `redirectCount > 0` when the referrer is empty (typed/bookmarked
entry) *and* the entry path is a home path, or drop the clause and rely on the `entryPath` /
referrer checks that follow it. Verify with a live `http://fomo.family/tokens/...` navigation.

**Benefits.** Deep links are always honoured as "that page".

### F10 · The masked address is what users copy and share — Low

**Description.** While the terminal is visible the address bar reads
`fomo.family/fobo-terminal` (`index.tsx:251-263`). Copying it and sending it to someone without
the extension lands them on fomo's 404 view (fomo serves its shell for any path). A bookmark
works only because `recoverFromMaskedLoad()` drives fomo home.

**Solution.** Either document this trade-off in README, or mask the title only and leave the
real coin URL in place (the tab title already says "fobo terminal"), or make the masked path
self-describing so fomo's 404 is never reached by others — e.g. keep the real path and append
`#fobo` (hash changes do not touch fomo's router any more than `replaceState` does, and the
link still resolves for non-users).

**Benefits.** Shared links work for everyone; no reliance on the recovery path.

### F11 · Storage reads without a timeout guard — Low

**Description.** `readEnabled()` (`index.tsx:135-148`) races `chrome.storage.sync.get` against a
1 s timer because a context being invalidated can hang the promise forever.
`readAlertsSettings()` (`settings.ts:87-94`) and `readColumnPrefs()` (`columnPrefs.ts:263-270`)
have no such guard, so in the same situation `alertsSettings` stays `null` and the side panel
never renders.

**Solution.** Extract `withTimeout(promise, ms, fallback)` and use it in all three readers.

**Benefits.** Consistent degradation when the extension is reloaded under a live page.

### F12 · Auth failures are indistinguishable from network failures — Low

**Description.** `fomoApi.ts:60` returns `null` for any non-2xx, so a 401 after the Privy JWT
expires (60 min TTL, refreshed by fomo's app — but not if fomo's tab logic stalls) looks the
same as a network error: the header shows "-", the holdings bar disappears, and nothing tells
the user to re-authenticate. The socket layer already has an `unauthenticated` status; REST
does not.

**Solution.** Have `call()` return a discriminated result (`{ ok: true, data } | { ok: false,
status }`) or at least track a module-level `lastAuthFailureAt`; expose it to the TopBar to
render the same "signed out" hint the socket status could drive.

**Benefits.** Users learn why numbers vanished; support questions become diagnosable.

### F13 · No icons in the manifest — Low

**Description.** `manifest.config.ts` defines no `icons` and no `action.default_icon`; Chrome
shows the generic puzzle icon, and the Web Store rejects packages without a 128 px icon.

**Solution.** Add `icons: { 16, 32, 48, 128 }` PNGs under `src/assets/` and reference them from
`icons` and `action.default_icon` (CRXJS copies them).

**Benefits.** Recognisable toolbar/extension-page icon; store-ready.

### F14 · `usd()` renders negatives as `$-1.2K` — Low

**Description.** `format.ts:6-11` prefixes `$` before `Intl` compact output, which carries its
own sign. Most call sites pass `Math.abs`, but `usd(item.positionUsd)`, `usd(mc)` and
`usd(item.totalVolume)` pass raw values, and a negative (or a negative snapshot delta upstream)
would show `$-…`.

**Solution.** Format `Math.abs(value)` and prepend the sign, as `usdDelta` already does.

**Benefits.** Consistent currency formatting under all inputs.

---

## Documentation and maintainability

### M1 · README contradicts the code — Medium

**Description.** CLAUDE.md requires README to stay truthful. Current drift:

- "the extension has **not yet been loaded in a browser end-to-end**" and "[ ] Manual
  verification in Chrome" — CLAUDE.md documents extensive live verification.
- "holder-concentration metrics (top-10 %, dev holdings, snipers, insiders, bundled supply)" —
  sniper/insider/bundler cohorts were removed (`TokenCard.tsx:161-165`).
- Alerts panel "width (280–480 px)" set in the popup — the range is 280–560
  (`settings.ts:11-12`) and width is dragged on the panel edge, not set in the popup.
- "**Wallet is never read, touched, or displayed.** No balances" — the top bar shows cash and
  portfolio value and the holdings bar shows positions (README's own later sections say so).
- "[ ] More side-panel tabs (fomo's Tokens / Leaderboard / Feed)" — Feed is done.
- Mobula is not disclosed as a third-party data recipient (see S5).

**Solution.** Rewrite Status and Scope limits to match `src/`; reword the wallet bullet to what
is true ("read-only: balances and positions are displayed from fomo's API; no keys, signing or
trade submission").

**Benefits.** The README is the file a reviewer or store listing reads first; it should not
under- or over-claim.

### M2 · Dead code and duplicated literals — Low

**Description.** `cacheStamp` (`mobula.ts:112-116`) is exported but unused (`App.tsx` uses its
own `enrichStamp`). `.launcher` in `styles.css:1047` is unused — the launcher is styled inline
(`index.tsx:184-201`) because it lives outside the shadow root. `'fobo-terminal-root'` is
duplicated as a literal in `sound.ts:60`. `tradeUsd` takes a `type` argument it immediately
`void`s (`feed.ts:172-178`). `App.tsx:227,302` carry `eslint-disable-next-line` comments for a
linter that is not installed.

**Solution.** Delete `cacheStamp` and `.launcher`; move `HOST_ID` (and the hidden-check) to a
tiny shared module imported by both `index.tsx` and `sound.ts`; drop the unused parameter.

**Benefits.** Less to misread; one source of truth for the host id.

### M3 · No lint, no tests — Medium

**Description.** `package.json` has only `tsc` and `vite`. The modules that mirror fomo's
protocol and arithmetic (`listStore.ts`, `alerts.ts`, `feed.ts`, `columnPrefs.ts`,
`fomoApi.ts` header maths, `format.ts`, the `content/index.tsx` state machine) are pure or
nearly pure and are exactly the code that silently breaks when fomo redeploys. There is no
automated check that a change to `applyDiff` still matches the four documented cases, that
`parseAmount('1.5m')` is `1_500_000`, or that `passesAlertsFilters` and `mergeAlerts` behave.

**Solution.** Add `vitest` with unit tests for the pure modules (fixtures captured from live
frames — the opencli harness already produces them) and `eslint` with
`@typescript-eslint` + `react-hooks` (the code already assumes the `react-hooks/exhaustive-deps`
rule). Wire `npm test` and `npm run lint` into `npm run build`.

**Benefits.** Protocol drift and reducer regressions are caught locally instead of as a blank
column in production; the hook-dependency assumptions in `App.tsx` are actually enforced.

---

## Remediation status (2026-08-24)

All findings addressed in the follow-up commit. Where a fix changed the design rather than a
line, the new home is named so the entry above can be read against the code.

| # | Status | Where |
|---|---|---|
| S1 | Fixed | `content/index.tsx` — `attachShadow({ mode: 'closed' })` |
| S2 | Fixed | `content/index.tsx` `readMarks()` — only `/`-prefixed strings, capped to `MARK_LIMIT` on read |
| S3 | Fixed | `lib/url.ts` — `tokenPath` / `profilePath` encode every segment; `navigate()` accepts only `sameOriginHref()` results, so the `location.assign` fallback can never leave fomo |
| S4 | Fixed | `lib/url.ts` `safeImageUrl` applied at every parse boundary (`fromFomoRow`, `fromFlatRow`, `parseAlert`, `parseFeedItem`, `currentUser`, `searchUsers`); every `<img>` carries `referrerPolicy="no-referrer"` |
| S5 | Fixed | README "Third parties" section; `lib/mobula.ts` logs one `console.warn` when a request cannot be sent |
| S6 | Fixed | `content/index.tsx` — header-menu items must match exactly one candidate (href-bearing links preferred); `findDepositButton` likewise |
| S7 | Fixed | `vite.config.ts` `assertSafeOutDir` — refuses a directory not named `dist`, not empty, and without a `manifest.json` |
| S8 | Fixed | `vite.config.ts` `sourcemap: 'hidden'` (maps still written locally, no `sourceMappingURL` shipped) |
| S9 | Fixed | `isLoggedIn` is a presence check; `onMessage` verifies `sender.id === chrome.runtime.id` |
| P1 | Fixed | `lib/visibility.ts` (`isActive`, `useTerminalActive`, `useActiveInterval`) + `lib/resource.ts`; `content/index.tsx` dispatches `fobo:shown` / `fobo:hidden`. Every poller, both clocks, Mobula warming and the socket reducer (diffs queue while hidden, replay on show) pause when the terminal is hidden or the tab is backgrounded |
| P2 | Fixed | `lib/mobula.ts` — `AbortSignal.timeout(15s)`, per-chain exponential backoff (30s → 10min), warming only while active |
| P3 | Fixed | `content/index.tsx` `watchRoute` — Navigation API `currententrychange` listener, a settle re-check timer, and a 1s fallback poll (300ms only when the API is absent) |
| P4 | Fixed | `lib/session.ts` — one shared `currentUser` store (retry until success), one `balances` resource feeding TopBar + HoldingsBar, one `ticker` + `status` resource for the bottom bar, one `watchlistTokens` resource; `fomoApi.ts` dedupes in-flight `/balances` and caches `/watchlist` for 5s |
| P5 | Fixed | `content/App.tsx` — socket diffs batched per animation frame; per-list `useMemo` so one list's frame does not re-sort the others |
| P6 | Fixed | `lib/listStore.ts` `STORE_CAP = 5 × MAX_ROWS` applied after every insert |
| P7 | Fixed | `content/App.tsx` — `unlockAudio` only registered when the panel and sound are on, and only fires while the terminal is active |
| F1 | Fixed | `ui/TopBar.tsx` — the `/` shortcut ignores hidden terminal, editable targets, modifiers and IME composition |
| F2 | Fixed | `lib/session.ts` `currentUserStore` retries with backoff and is re-tried when the socket authenticates; App subscribes and calls `setAlertUser` when the user lands |
| F3 | Fixed | `lib/fomoSocket.ts` — `error` frame closes the socket, 10s handshake deadline, 60s idle watchdog, reconnect on `online` / tab visible, `onFrame` feeds a "stale" badge in the column headers |
| F4 | Fixed | `ui/PanelFilters.tsx` local draft committed on blur / Enter / 400ms idle; `settings.ts` `saveAlertsSettings` debounced 400ms; the backfill effect keeps the current list until the new page arrives |
| F5 | Fixed | `popup/main.ts` — read-modify-write on every save, subscribes to `chrome.storage.onChanged` |
| F6 | Fixed | `content/index.tsx` `suppressPageRender` — only body children with ≥100 descendants that are not live regions (verified live: fomo's `.desktop-content` is the only such child) |
| F7 | Fixed | `lib/session.ts` `ticker` returns null (keeps the last strip) when `/watchlist` fails; `ui/BottomBar.tsx` rolls back an optimistic un-star that fomo refused |
| F8 | Fixed | `ui/AlertsPanel.tsx` / `ui/FeedView.tsx` — rows are blocks with a stretched `<a class="alert-row-link">` underneath (middle-click / ctrl-click now open a new tab); trader names and post links are real `<a>` elements above it |
| F9 | Fixed | `content/index.tsx` `recordEntryIntent` — a server redirect counts as home intent only without an external referrer |
| F10 | Documented | README "Scope limits" explains the masked address and how to copy a shareable link |
| F11 | Fixed | `lib/async.ts` `withTimeout` used by `readEnabled`, `readAlertsSettings`, `readColumnPrefs` |
| F12 | Fixed | `lib/fomoApi.ts` tracks the last 401/403 (`isAuthFailing`); TopBar shows "Signed out of fomo" |
| F13 | Fixed | `src/assets/icon-{16,32,48,128}.png`, wired into `icons` and `action.default_icon` |
| F14 | Fixed | `lib/format.ts` `usd()` puts the sign before the symbol |
| M1 | Fixed | README Status, What it does, Alerts panel, Scope limits and Build sections rewritten to match the code |
| M2 | Fixed | `cacheStamp`, `.launcher` CSS and the unused `tradeUsd` parameter removed; `HOST_ID` lives in `lib/host.ts` |
| M3 | Fixed | `eslint` (typescript-eslint + react-hooks) and `vitest` (44 tests across `listStore`, `columnPrefs`, `alerts`, `feed`, `format`, `url`) run via `npm run check`, which `npm run build` invokes first |

### Live verification (2026-08-24, builds `mt6n4aqc` → `mt6o0nwa`)

Driven through the opencli harness against the real logged-in session; the terminal's own
traffic was read from the new `data-fobo-requests` counters on the host element (see below).

- Mount, closed shadow root, URL/title mask, Back-remount, Navigation-API route pickup
  (~320 ms round-trip, consistently under the 1 s fallback poll) — all confirmed.
- Pollers: at boot `/v2/users/current` ×1 (was ×3), `/watchlist` ×1 shared by ticker and
  panel, `/balances` on a single 10 s clock, Mobula `pulse` ×1 per chain, status ×1. Hidden
  for 30 s: **zero** requests, `active=false`, socket kept warm. Summon: immediate refresh.
- `/` typed into fomo's own inputs while hidden is no longer swallowed; from the body it
  focuses the terminal only while visible.
- Render suppression: the first build missed at boot (fomo's tree was still < 100 nodes at
  `document_idle`) — fixed in `f6d0aed` (incremental, re-run on route ticks); confirmed
  suppressed 3 s after load, restored on hide, re-applied on show.
- Not live-testable from outside the closed shadow root and left at unit/code level: the
  alerts-filter draft/commit, the popup read-modify-write, row anatomy, the signed-out hint,
  and the socket watchdog (needs a network drop).

Two harness facts learned the hard way, recorded in CLAUDE.md: content-script fetches never
appear in the page's Resource Timing (earlier network counts were fomo's own traffic), and
`opencli console` captures nothing. The host element now carries `data-fobo-requests`,
`data-fobo-socket`, `data-fobo-last-frame` and `data-fobo-active` for this purpose.
