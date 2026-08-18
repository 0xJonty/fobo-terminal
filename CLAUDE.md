# CLAUDE.md

Project instructions for Claude Code working in this repository.

## What this is

`fobo-terminal` is a Chrome extension (Manifest V3). The repository is pre-spec: scaffolding files
exist, source does not. Do not infer features, architecture, or a tech stack that has not been
written down — if something is undecided, ask rather than inventing it.

## Ground rules

- The spec comes first. Until a spec exists in the repo, do not scaffold source, add dependencies,
  or pick a bundler/framework unprompted.
- Keep `README.md` truthful about what actually exists. It is not a wishlist.
- Never commit secrets, API keys, or an extension signing key (`*.pem`). See `.gitignore`.
- Never commit build output (`dist/`, `build/`) or packaged extensions (`*.zip`, `*.crx`).

## Chrome extension specifics

Relevant once source lands:

- Target Manifest V3. MV2 is not an option — Chrome no longer accepts it.
- Background logic is a **service worker**, not a persistent page. It is terminated when idle, so
  never hold state in module-level variables across events; persist to `chrome.storage`.
- Request the narrowest permissions that work. Prefer `activeTab` and optional permissions over
  broad `host_permissions`; every added permission is a review-time and trust cost.
- Content scripts run in an isolated world. They cannot see page JS variables, and vice versa —
  cross the boundary explicitly via `window.postMessage` or an injected script if needed.
- MV3 blocks remote code execution. All executable code must ship inside the extension package.

## Verification

Manual load is the check until a test setup exists: build, then `chrome://extensions` →
Developer mode → Load unpacked → select the build output. Reload the extension after each change;
content scripts also need the host page reloaded.

## Git

- Default branch is `main`.
- Repo is private.
- Commit when asked, not automatically.
