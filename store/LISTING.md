# Chrome Web Store listing — fobo terminal

Everything the developer dashboard asks for, ready to paste. Every file in this folder is a
store upload — nothing else belongs here; `npm run package` produces the zip
(`release/fobo-terminal-<version>.zip`). Off-store artwork (the 1024² icon sources, the X/Twitter
header) lives in `brand/`.

Note: the five screenshots below are also the README's visuals. Renaming one breaks the README.

## Before the first upload (one-time)

1. Register a Chrome Web Store developer account at
   <https://chrome.google.com/webstore/devconsole> — one-time US$5 registration fee. Use a
   Google account whose email you will keep: **the account email cannot be changed later**.
   Google recommends a dedicated publishing address.
2. Turn on 2-Step Verification on that Google account (required for the developer console).
3. In the console's **Account** page: verify the contact email (it is shown publicly on the
   listing), and complete the trader / non-trader declaration (EU DSA) — as an individual
   publishing a free extension you will normally declare **non-trader**.
4. Host `PRIVACY.md` at a public URL. The repo is public, so the GitHub blob URL
   <https://github.com/0xJonty/fobo-terminal/blob/main/PRIVACY.md> is sufficient; a Gist or
   GitHub Pages site works equally well. The privacy-policy URL is mandatory for this extension
   because it handles the user's authentication token.

## Package

- `npm run package` → `release/fobo-terminal-<version>.zip`
  (runs typecheck + lint + tests + build into `./dist`, zips with `manifest.json` at the root,
  excludes `.map` files, prints the SHA-256 and file list).
- Bump `version` in `package.json` before every upload — the store rejects a re-upload of an
  existing version number. The manifest version is generated from it.

## Store listing tab

**Name** (from manifest): `fobo terminal`

**Summary** (from manifest `description`, ≤132 chars):
`Advanced memecoin trading terminal for fomo`

**Detailed description** (paste):

```
fobo terminal replaces the landing page on fomo.family with a dense, live home screen: the
Bonding, Graduated and Trending token lists side by side, streamed from the site's own
websocket in the order it publishes them, with market cap, volume, liquidity, age, price
change, trade pressure and holder-concentration metrics on every card.

Beside the columns, a side panel switches between your Alerts (the trading activity of the
traders you follow), your Watchlist, and the social Feed, each carrying the same filters the
site itself offers. The top bar shows your cash and portfolio value using its own arithmetic,
the holdings strip shows your open positions, and the bottom bar mirrors the ticker and
status dot.

A quick buy button on each card spends an amount you set per column, and asks the wallet the
site has already loaded to approve it — the extension holds no key and never sees one. The
site's own server builds, prices and fees every swap, and the button waits for the chain to
confirm before it says filled. Everything else is read-only: clicking a card, alert or trader
opens it there, and deposit, withdraw and account actions hand off to its own dialogs.

How it works
• Runs only on fomo.family pages, using the session you are already logged into.
• Reads the site's own API and websocket — the same data its pages show, nothing invented.
• Holder metrics come from Mobula's public Pulse endpoint; every other number comes from
  the site itself.
• Preferences (panel side and width, alert sound, column filters, and which data points each
  card shows) are saved to your Chrome profile.
• Quick buy asks the wallet already loaded on the page to approve one transaction per click.
  No key is held, read or stored, the amount is yours to set per column, and the result is
  reported rather than assumed.
• The toolbar icon toggles the terminal, Esc dismisses it, and a small button restores it.

Not affiliated with, endorsed by or maintained by fomo.family. Uses its public web API under
your own account; if that API changes, features may degrade until updated.
```

> **Keep the name's density low.** A 2026-08-27 submission was auto-rejected under "excessive
> keywords in the item's description" (violation reference *Yellow Argon*) for 17 occurrences
> of `fomo` / `fomo's` / `fomo.family` in roughly 250 words. The copy above names the site
> three times — once to say what the extension attaches to, once in the host-permission
> bullet, once in the disclaimer — and uses "the site" / "its" everywhere else. If you edit
> this description, re-count before submitting.

**Category**: Productivity (alternatively Developer Tools / Finance if offered — pick one).

**Language**: English.

**Images** (this folder):
- Store icon: `icon-128.png` (128×128, 96×96 artwork with 16 px transparent padding).
- Screenshots (1280×800, upload all five in this order):
  1. `screenshot-1-1280x800.png` — full terminal, live capture.
  2. `screenshot-2-1280x800.png` — the fomo bar: alerts, watchlist and feed side by side.
  3. `screenshot-3-1280x800.png` — column filters popover, demo-video styling.
  4. `screenshot-4-1280x800.png` — holdings strip, demo-video styling.
  5. `screenshot-5-1280x800.png` — promo poster (wordmark + tagline + terminal).
  2–5 are composed from the raw captures in `marketing/snapshots/` with the demo-video
  look (Aeonik, brand background `#0b091f`, accent `#516af6`).
- Small promo tile: `promo-small-440x280.png` (440×280 — effectively required; listings
  without one rank behind those with one).
- Marquee: `promo-marquee-1400x560.png` (optional, only used if featured).

**Official URL / Homepage**: <https://foboterminal.com/>
**Support URL**: <https://github.com/0xJonty/fobo-terminal/issues>

## Privacy practices tab

**Single purpose description**:
`Adds a live token-list home screen (Bonding / Graduated / Trending, alerts, watchlist, feed) to fomo.family pages, with a per-card quick buy that places an order through that site's own trade API, using the session the user is already logged into.`

**Permission justifications**:
- `storage`: "Saves the user's preferences: terminal on/off, panel side and width, alert
  sound, per-column filter/sort settings, which data points each token card shows, and the
  quick buy amounts (a default plus any per-column ones) and button size."
- `scripting`: "Quick buy only. The site builds and signs the swap on its server; the user's own
  signature has to come from the wallet the site has already loaded into its page, which a
  content script in an isolated world cannot reach. On each click the extension injects one
  self-contained function into that page to request that signature, and the result is returned
  directly to the extension. Nothing is left in the page between clicks, no key is read or
  stored, and injection is limited to the fomo.family frame that asked for it."
- Host permission `https://fomo.family/*`: "This is the only site the extension works on.
  The content script renders the terminal on its pages, and the background worker uses this
  host permission to notify those open tabs when the toolbar toggle changes. No other site
  is accessed."

**Remote code**: No — all code ships in the package; nothing is fetched and executed.

**Data usage** (check these, describe as below):
- ☑ **Authentication information** — "Reads the fomo.family session token from the page's
  local storage and sends it only to that site's own API to fetch the user's data. Not
  stored, not logged, not sent elsewhere."
- ☑ **Personally identifiable information** — "Displays the user's own profile (handle,
  display name, avatar) fetched from the same API. Not stored or transmitted elsewhere."
- ☑ **Financial and payment information** — "Displays the user's own balances and open
  positions fetched from the same API. On an explicit click, also asks that API to build a swap
  and submits it once the wallet already loaded on the page has signed it, then reads back
  whether it succeeded. No key, balance or transaction is stored by the extension or sent
  anywhere other than that site's own API and the submission and status endpoints its own
  client uses."
- ☐ Health, ☐ Location, ☐ Web history, ☐ User activity, ☐ Website content — leave unchecked
  (public token data is read from that API, not scraped from pages).
- Certify all three statements: not sold to third parties; not used for purposes unrelated
  to the single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL**: <https://github.com/0xJonty/fobo-terminal/blob/main/PRIVACY.md>
(or wherever you host `PRIVACY.md`).

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch — installable by link, not searchable).
- Price: free. Regions: all.

**Changing visibility re-triggers review.** Going from Trusted Testers (or Unlisted) to
Public is a new submission, not a settings toggle — the item is re-reviewed against the full
public-listing bar, which is stricter than the one a tester-only build passed. Budget for a
fresh review cycle, and re-read the metadata below before flipping it.

## Test instructions tab

Reviewers need a login on the host site to see anything. Provide either a test account
(email + password / login method) or this note:

```
The extension only activates on https://fomo.family/ for a logged-in user. Without an
account there, the page shows the site's marketing content and the extension stays
inactive by design. To review: sign in, then open https://fomo.family/ — the terminal
mounts over the landing page. Esc dismisses it, the "fobo" button (bottom right) restores
it, and the toolbar popup turns it off entirely.

The quick buy button on each card cannot be exercised on an unfunded account: the site
rejects any swap under $2 and the button reports that back instead of trading. It is
also not silent — it arms on the first click and only spends on a second. Nothing about
it is hidden behind that: the button issues the site's own swap request, and the injected
function that requests a signature is the whole of what runs in the page (see the
`scripting` justification). To see it without funds, deposit $5 of USDC on the site.
```

## After submission

- Review typically takes from a day to a few days for a new listing; a rejection email lists
  the policy section — fix, bump the version, re-upload.
- Keep `release/*.zip` (gitignored) and note the SHA-256 printed by `npm run package` for
  each version you upload.

## Rejection log

| Date | Reference | Reason | Fix |
|---|---|---|---|
| 2026-08-27 | Yellow Argon | "Having excessive keywords in the item's description" — 17 occurrences of `fomo` / `fomo's` / `fomo.family` in a ~250-word description, flagged on the submission that would have flipped the item from Trusted Testers to Public. | Rewrote every metadata field to name the site only where it is load-bearing and use "the site" / "its" elsewhere. Count across all fields went 37 → 9; the description itself went 17 → 3. |

Google's policy here covers *all* metadata — description, developer name, title, icon,
screenshots and promotional images — not just the description field, so keep the density
sane everywhere. Nothing about the code changed for this rejection, so a resubmission does
not need a version bump unless the package itself changed.
