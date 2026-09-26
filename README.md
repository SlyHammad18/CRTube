# CRTube

<p align="center">
  <img src="./docs/home.png" alt="CRTube library" width="900" />
</p>

<p align="center">
  <a href="https://github.com/SlyHammad18/CRTube/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/SlyHammad18/CRTube?color=4DD8FF" /></a>
  <img alt="License" src="https://img.shields.io/badge/License-MIT-4DD8FF" />
  <img alt="Platforms" src="https://img.shields.io/badge/Platforms-Linux%20%7C%20Windows-4DD8FF" />
</p>

CRTube is a local-first desktop YouTube downloader and media player built with
[Tauri v2](https://v2.tauri.app/), React, and Rust. Search for a video, choose a
format, download it, and keep playback, lyrics, playlists, and favourites in one
place. Processing stays on your machine through
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg; CRTube does not require a
server or telemetry.

## Highlights

- **Download and play** — search YouTube or paste a link, choose audio/video
  formats, queue concurrent downloads, and play the library with persistent
  sessions.
- **Lyrics everywhere** — LRCLIB synced lyrics, per-song timing offsets, manual
  lyric search/override, bottom-docked lyrics, and an optional always-on-top
  floating lyrics window.
- **Full floating-player controls** — play/pause, previous/next, shuffle,
  repeat, seek timeline, favourite, add-to-playlist, mute, and an “Open main
  app” button without creating a second playback engine.
- **Library organisation** — playlists, membership checkmarks, favourites,
  track/artist renaming, reordering, custom artwork, and collapsible artist
  views.
- **Desktop integration** — MPRIS media controls, cached square artwork in the
  system media card, keyboard shortcuts, resumable playback, and remembered
  mute/volume/loop/shuffle/speed state.
- **Local and resilient** — friendly tool/download errors, atomic yt-dlp
  updates with checksum verification, cached thumbnails, and no cloud account.

## v0.4.1 release notes

- Fixed XWayland workspace switching so the always-on-top floating lyrics
  window no longer steals focus while remaining interactive and draggable.

### Included from v0.4.0

- Added the floating lyrics control surface with transport, shuffle/repeat,
  seeking, favourites, playlist membership, mute, and main-window focus.
- Reworked floating-lyrics timing around an authoritative playback clock and
  sequence-guarded snapshots to prevent stale lyric rollbacks.
- Added smooth optimistic seeking so the overlay does not jump back while the
  main player applies a seek.
- Removed the translucent edge halo and persistent engine/version line from the
  search surface; the transient `updating yt-dlp` state remains visible.
- Persisted mute state in the resume session and fixed focus handling around
  the floating seek bar.

## Download

The v0.4.1 release includes:

- **Windows 10/11 (x64): `CRTube_0.4.1_x64-setup.exe`**
- **Debian/Ubuntu: `CRTube_0.4.1_amd64.deb`**

AppImage is not included in this release. The Windows installer is not
code-signed, so SmartScreen may warn on first run — choose "More info" →
"Run anyway".

## Build from source

Requirements: Node.js 20+, Rust, and the Tauri 2 system dependencies for your
platform (WebKitGTK and libsoup on Linux; the WebView2 SDK and Visual Studio
Build Tools on Windows).

```bash
npm install
npm run tauri build -- --bundles deb   # Linux
npm run tauri build -- --bundles nsis  # Windows
```

Artifacts are written to `src-tauri/target/release/bundle/{deb,nsis}/`.

For development with hot reload:

```bash
npm run tauri dev
```

## License

MIT — see [LICENSE](LICENSE).
