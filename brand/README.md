# Brand source artwork

Master files. Nothing here ships in the extension package or is uploaded to the store — these
are the originals the shipped images were rendered from.

| File | Size | What it feeds |
|---|---|---|
| `fobo-square-rounded.png` | 1024×1024 | The extension icons: `src/assets/icon-{16,32,48,128}.png` and `store/icon-128.png`. |
| `fobo-icon.png` | 1024×1024 | The older mark. Still the source for `store/promo-small-440x280.png` and `store/promo-marquee-1400x560.png`. |
| `fobo-twitter-header-3000x1000.png` | 3000×1000 | X/Twitter profile header (2× the 1500×500 slot). Launch social asset, not a store upload. |

## Regenerating the extension icons

Measured off the committed files, so a regeneration matches byte-for-byte in intent:

- **16 / 32 / 48** — full-bleed LANCZOS downscales of the 1024² master.
- **128** — the artwork resized to 96×96 and centred on a transparent 128×128 canvas. That
  16 px of padding is the Chrome Web Store's icon convention.
- `store/icon-128.png` is a byte copy of `src/assets/icon-128.png`.

Rendered with Python's Pillow (`python3 -c` one-liners); there is no ImageMagick on the build
machine and no icon step in the Vite build — the PNGs in `src/assets/` are committed and the
manifest points straight at them.

## Related

- `store/` — the finished Chrome Web Store uploads, plus `LISTING.md`.
- `marketing/` — raw 2× terminal captures (gitignored, local only).
- The demo video's source of truth is the "fobo launch demo" Claude Design canvas, not this
  folder.
