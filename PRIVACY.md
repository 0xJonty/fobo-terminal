# fobo terminal — Privacy Policy

_Last updated: 2026-09-11_

fobo terminal ("the extension") is an independent browser extension that adds a home-screen
view to fomo.family. It is not affiliated with, endorsed by, or maintained by fomo.family.

## What the extension does with data

The extension runs only on pages under `https://fomo.family/`. It does not run anywhere else,
does not inject code into other sites, and has no server of its own.

### Data it reads

- **Your fomo.family session token.** fomo.family stores a login token (a Privy JSON Web
  Token) in the page's local storage. The extension reads that token each time it needs to
  call fomo.family's own API, so that it can show you the same data fomo shows you: your cash
  and portfolio value, your open positions, your watchlist, your alerts feed and the social
  feed, plus the public token lists. The token is sent **only** to fomo.family's own API
  (`prod-api.fomo.family`), over HTTPS, exactly as fomo.family's website sends it. It is
  never stored by the extension, never logged, and never sent anywhere else.
- **Your fomo.family profile and balances.** Fetched from fomo.family's API and shown on
  screen. They are held in memory only while the page is open.
- **Public token data** from fomo.family's API and websocket, and holder/risk metrics for
  those tokens from Mobula (see below).

### Data it stores

- **Preferences only**, in Chrome's extension storage (`chrome.storage.sync`): whether the
  terminal is on, which columns show, panel side and width, alert-sound on/off, your per-column
  filters and sort, and which data points each token card shows. These sync with your Chrome
  profile if you have Chrome sync enabled. No account data, tokens or financial data are ever
  written to storage.
- A few **tab-scoped flags** in the page's session storage (which page the terminal was
  summoned on, whether you dismissed it). These vanish when the tab closes.

### Data it sends to third parties

- **fomo.family** — your session token and the API requests described above. This is the
  service you are already logged into.
- **Mobula (`fomo-api.mobula.io`)** — a public, unauthenticated request per blockchain to
  fetch holder-concentration metrics for tokens on screen. No account data is sent; Mobula
  receives your IP address and the request itself, as with any web request.
- **status.fomo.family** — fomo's public status endpoint, for the status dot.

Nothing else. The extension contains no analytics, no telemetry, no advertising, and no
remote code.

## Data the developer receives

None. The developer has no server and receives no data from the extension. Support requests
you send by email naturally include whatever you choose to write.

## Permissions

- `storage` — to save the preferences listed above.
- Host access to `https://fomo.family/*` — to run on fomo.family pages and relay the on/off
  toggle to open fomo.family tabs. The extension does not request access to any other site.

## Your choices

- Turn the terminal off from the toolbar popup; the site is left exactly as fomo ships it.
- Remove the extension from `chrome://extensions` to delete its stored preferences.

## Changes

Material changes to this policy will be reflected in the extension's store listing and in
this document's "Last updated" date.

## Contact

Questions about this policy: open an issue at
<https://github.com/0xJonty/fobo-terminal/issues>, or use the support contact shown on the
extension's Chrome Web Store listing.
