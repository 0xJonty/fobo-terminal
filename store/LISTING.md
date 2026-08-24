# Chrome Web Store listing — fobo terminal

Everything the developer dashboard asks for, ready to paste. Files in this folder are the
image uploads; `npm run package` produces the zip (`release/fobo-terminal-<version>.zip`).

## Before the first upload (one-time)

1. Register a Chrome Web Store developer account at
   <https://chrome.google.com/webstore/devconsole> — one-time US$5 registration fee. Use a
   Google account whose email you will keep: **the account email cannot be changed later**.
   Google recommends a dedicated publishing address.
2. Turn on 2-Step Verification on that Google account (required for the developer console).
3. In the console's **Account** page: verify the contact email (it is shown publicly on the
   listing), and complete the trader / non-trader declaration (EU DSA) — as an individual
   publishing a free extension you will normally declare **non-trader**.
4. Host `PRIVACY.md` at a public URL (a GitHub Gist, a GitHub Pages site, or any page you
   control). The privacy-policy URL is mandatory for this extension because it handles the
   user's authentication token.

## Package

- `npm run package` → `release/fobo-terminal-<version>.zip`
  (runs typecheck + lint + tests + build into `./dist`, zips with `manifest.json` at the root,
  excludes `.map` files, prints the SHA-256 and file list).
- Bump `version` in `package.json` before every upload — the store rejects a re-upload of an
  existing version number. The manifest version is generated from it.

## Store listing tab

**Name** (from manifest): `fobo terminal`

**Summary** (from manifest `description`, ≤132 chars):
`A live three-column token terminal for fomo.family: Bonding, Graduated and Trending side by side, plus alerts, watchlist and feed.`

**Detailed description** (paste):

```
fobo terminal replaces the fomo.family landing page with a dense, live home screen: the
Bonding, Graduated and Trending token lists side by side, streamed from fomo's own websocket
in fomo's own order, with market cap, volume, liquidity, age, price change, trade pressure
and holder-concentration metrics on every card.

Beside the columns, the FOMO Panel switches between your Alerts (the trading activity of the
traders you follow), your Watchlist, and fomo's social Feed — with fomo's own filters. The top
bar shows your cash and portfolio value with fomo's arithmetic, the holdings strip shows your
open positions, and the bottom bar mirrors fomo's ticker and status dot.

Everything is read-only: clicking a card, alert or trader opens it on fomo.family. Deposit,
withdraw and account actions hand off to fomo's own dialogs. There is no wallet access, no
signing and no trade submission.

How it works
• Runs only on fomo.family pages, using the session you are already logged into.
• Reads fomo's own API and websocket — the same data fomo's pages show, nothing invented.
• Holder metrics come from Mobula's public Pulse endpoint; everything else is fomo's.
• Preferences (panel side/width, sound, column filters) are saved to your Chrome profile.
• Toolbar icon toggles it; Esc dismisses it; the fobo button brings it back.

Not affiliated with, endorsed by or maintained by fomo.family. Uses fomo's public web API
under your own account; if fomo changes its API, features may degrade until updated.
```

**Category**: Productivity (alternatively Developer Tools / Finance if offered — pick one).

**Language**: English.

**Images** (this folder):
- Store icon: `icon-128.png` (128×128, 96×96 artwork with 16 px transparent padding).
- Screenshots: `screenshot-1-1280x800.png`, `screenshot-2-1280x800.png` (1280×800; 1–5 allowed).
  Check them before upload — retake with `opencli browser <session> screenshot --width 1280 --height 800`
  if the terminal was not fully loaded when captured.
- Small promo tile: `promo-small-440x280.png` (440×280 — effectively required; listings
  without one rank behind those with one).
- Marquee: `promo-marquee-1400x560.png` (optional, only used if featured).

**Official URL / Homepage / Support URL**: optional. If the repo stays private, a public
support email or a GitHub Issues page on a public repo is the usual choice.

## Privacy practices tab

**Single purpose description**:
`Adds a live token-list home screen (Bonding / Graduated / Trending, alerts, watchlist, feed) to fomo.family pages, using the user's existing fomo session.`

**Permission justifications**:
- `storage`: "Saves the user's preferences: terminal on/off, panel side and width, alert
  sound, and per-column filter/sort settings."
- Host permission `https://fomo.family/*`: "The extension only works on fomo.family. The
  content script renders the terminal on fomo.family pages, and the background worker uses
  this host permission to notify open fomo.family tabs when the toolbar toggle changes. No
  other sites are accessed."

**Remote code**: No — all code ships in the package; nothing is fetched and executed.

**Data usage** (check these, describe as below):
- ☑ **Authentication information** — "Reads the fomo.family session token from the page's
  local storage and sends it only to fomo.family's own API to fetch the user's data. Not
  stored, not logged, not sent elsewhere."
- ☑ **Personally identifiable information** — "Displays the user's own fomo profile (handle,
  display name, avatar) fetched from fomo's API. Not stored or transmitted elsewhere."
- ☑ **Financial and payment information** — "Displays the user's own fomo balances and open
  positions fetched from fomo's API. Not stored or transmitted elsewhere."
- ☐ Health, ☐ Location, ☐ Web history, ☐ User activity, ☐ Website content — leave unchecked
  (public token data is read from fomo's API, not scraped from pages).
- Certify all three statements: not sold to third parties; not used for purposes unrelated
  to the single purpose; not used to determine creditworthiness or for lending.

**Privacy policy URL**: the public URL where `PRIVACY.md` is hosted.

## Distribution tab

- Visibility: Public (or Unlisted for a soft launch — installable by link, not searchable).
- Price: free. Regions: all.

## Test instructions tab

Reviewers need a fomo.family login to see anything. Provide either a test account (email +
password / login method) or this note:

```
The extension only activates on https://fomo.family/ for a logged-in user. Without a
fomo.family account the page shows fomo's marketing site and the extension stays inactive
by design. To review: log in to fomo.family, open https://fomo.family/ — the terminal
mounts over the landing page. Esc dismisses it; the "fobo" button restores it; the toolbar
popup toggles it off entirely.
```

## After submission

- Review typically takes from a day to a few days for a new listing; a rejection email lists
  the policy section — fix, bump the version, re-upload.
- Keep `release/*.zip` (gitignored) and note the SHA-256 printed by `npm run package` for
  each version you upload.
