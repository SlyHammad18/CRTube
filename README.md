# CRTube

<p align="center">
  <img src="./docs/home.png" alt="CRTube home screen" width="720" />
</p>

<p align="center">
  <a href="https://github.com/SlyHammad18/CRTube/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/SlyHammad18/CRTube?color=4DD8FF" /></a>
  <img alt="License" src="https://img.shields.io/badge/License-MIT-4DD8FF" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-v2-4DD8FF?logo=tauri&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-18-4DD8FF?logo=react&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-1.70%2B-4DD8FF?logo=rust&logoColor=white" />
  <img alt="Platforms" src="https://img.shields.io/badge/Platforms-Linux%20%7C%20Windows-4DD8FF" />
  <img alt="Engine" src="https://img.shields.io/badge/engine-yt--dlp-4DD8FF" />
</p>

A desktop client for downloading YouTube videos and audio, built on
[Tauri v2](https://v2.tauri.app/) + React + Rust. Search, pick a format, and
queue downloads with live progress — everything runs locally through
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and ffmpeg, with no telemetry.

## Features

- **Search & instant formats** — search YouTube or paste a link; the format
  sheet shows real probed resolutions, codecs, and size estimates.
- **Audio + video** — download as MP4 / WebM / MKV, or extract MP3 with
  embedded cover art and tags.
- **Live queue** — concurrent downloads with real-time progress, speed, and
  ETA readouts, cancel, and a library that persists across restarts.
- **Self-updating engine** — yt-dlp is kept current via atomic, checksummed
  GitHub releases; ffmpeg is installed once. Updates never call `yt-dlp -U`.
- **Resilient** — friendly messages for offline boots, region-blocked videos,
  disk-full, rate limits, and bad links. Never crashes on a tool error.
- **Resume where you left off** — the queue, current song, timestamp, repeat,
  shuffle, and speed are remembered and reapplied on next launch.
- **Editable lyrics** — fix synced lyrics via an LRCLIB search modal, nudge each
  song's timing offset, or use them as subtitles in fullscreen video.
- **Favourites** — heart any track into a Favourites playlist, rename tracks and
  artists, and reorder playlists with up/down arrows.
- **Ice Console design** — dark-only, cool-neutral palette with a single ice
  accent, monospaced numerics, and motion that collapses under
  `prefers-reduced-motion`.

## What's new in v0.3.0

v0.3.0 builds on v0.2.0's in-app playback with a bigger lyrics experience,
session resume, and library management:

- **Resume session** — CRTube remembers where you left off: the open playlist,
  the queue and current song, its timestamp, loop, shuffle, and speed are saved
  and applied at the next launch (always resuming paused).
- **Lyrics** — editable per-song lyrics with an LRCLIB search modal; per-song
  sync-offset `+/-` nudges that persist; live lyrics as subtitles in fullscreen
  video; and Now Playing re-ordered so lyrics sit above the transport row.
- **Player** — fullscreen video controls (favourite, speed, loop-one), a
  per-track "audio only" toggle with an auto-disable setting, global keyboard
  shortcuts (Space, seek, volume, lyrics, repeat, shuffle, and more), and
  shuffle/repeat/speed controls in the global player bar.
- **Library & playlists** — a Favourites playlist with heart toggles, track
  title + multi-artist renaming, a collapsible Artists tab, auto-scroll to the
  playing track, and playlist reordering via up/down arrows.
- **OS integration** — the GNOME Notification Center media card now shows
  square-cropped, undistorted artwork from locally cached thumbnails.
- **Polish** — faster startup (boot animation removed), hardened webview
  (inspect/right-click/copy blocked), and a fixed volume-slider focus bug so
  keyboard shortcuts always work after dragging the volume.

## Download

Prebuilt installers for Linux are attached to the latest
[GitHub release](https://github.com/SlyHammad18/CRTube/releases):

- **Debian / Ubuntu** — `CRTube_0.3.0_amd64.deb`
- **Fedora / openSUSE / RHEL** — `CRTube-0.3.0-1.x86_64.rpm`
- **Portable Linux** — `CRTube_0.3.0_amd64.AppImage` (make executable, then run)

Windows (NSIS) installers are produced automatically when built on Windows.

## Build from source

Requirements: Rust toolchain, Node 20+, and the Tauri 2 Linux system
dependencies (webkit2gtk-4.1, libsoup, etc.).

```bash
npm install
npm run tauri build
```

The resulting artifacts land in `src-tauri/target/release/bundle/`.

To run the dev server with hot reload:

```bash
npm run tauri dev
```

## Project layout

| Path | Purpose |
|------|---------|
| `src-tauri/src/commands` | Tauri command handlers (search, tools, download, library, settings) |
| `src-tauri/src/services` | installer, ytdlp arg builder + parser, download engine, db, thumbs |
| `src-tauri/src/jobs.rs` | in-flight download process registry |
| `src/components` | React UI (search, sheet, downloads, library, settings) |
| `src/stores` | Zustand state |
| `DESIGN.md` | Locked design + build spec (authoritative) |
| `AGENTS.md` | Developer workflow notes |

## Notes

- Binaries, the library database, and cached thumbnails live under the app
  data directory (`~/.local/share/io.github.slyhammad18.crtube` on Linux).
- Downloads default to `~/Downloads/CRTube` and are configurable in Settings.

## License

MIT
