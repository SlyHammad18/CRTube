# Contributing to CRTube

Thanks for helping out. This is a small hobby project, so keep it simple.

## Setup

```bash
npm install
npm run tauri dev
```

You need Node.js 20+, Rust, and the Tauri 2 system dependencies (WebKitGTK and
libsoup on Linux, WebView2 SDK and Visual Studio Build Tools on Windows).

## Before you open a PR

Run the checks and make sure they pass:

```bash
cargo clippy          # in src-tauri, no warnings
cargo test            # pure logic is unit-tested
npm run build         # tsc + vite, no errors
```

## House rules

- `DESIGN.md` is the spec. Match the existing theme, fonts, and component
  patterns instead of inventing new ones.
- Event names (`dl://*`, `tools://*`) and command names are fixed contracts.
  Extend, don't rename.
- Never commit or push without a green check run.
- Keep PRs small and focused. One feature or fix per PR, with a short
  description of what changed and why.

## Commit style

Follow the existing history: `feat(scope):`, `fix(scope):`, `chore:`, `docs:`.
Subject lines stay short, details go in the body.

## Reporting bugs

Open an issue with:

- What you did and what happened instead
- Your OS, windowing system (Wayland/X11), and app version
- Relevant logs or a screenshot if it is visual
