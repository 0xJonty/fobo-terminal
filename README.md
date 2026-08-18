# fobo-terminal

A Chrome extension. Early scaffolding — the specification has not been written yet, so this README
describes the repository, not the feature set. Feature docs land here once the spec exists.

## Status

Pre-spec. The repo currently holds project scaffolding only:

- `README.md` — this file
- `CLAUDE.md` — working instructions for Claude Code in this repo
- `.gitignore`

No extension source, no manifest, no build yet.

## Planned shape

Manifest V3 Chrome extension. Concrete stack (bundler, language, UI layer) is decided as part of
the spec, so nothing is pinned here yet.

## Getting started

Nothing to build or run at this point. Once a manifest and build exist, loading the unpacked
extension will be:

1. Build the extension (command TBD once tooling is chosen).
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. **Load unpacked** → select the build output directory.

## License

Not yet chosen.
