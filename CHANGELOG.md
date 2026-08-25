# Changelog

All notable work is tracked here, grouped by the task breakdown in
[`DESIGN.md`](./DESIGN.md) (T1–T11). Versions follow the task milestones.

## [0.1.0] — 2026-08-26

Initial release: a complete, locally-processed YouTube downloader with a
dark "Ice Console" interface.

### T1 — Scaffold & shell
- Tauri v2 + React 18 + TypeScript + Vite project; frameless window.
- Custom titlebar (drag region, min/max/close, double-click maximize).
- Icon rail + view routing; full token system in `theme.css` with self-hosted
  `@fontsource` fonts; boot overlay.

### T2 — Tool manager
- Installer service for yt-dlp + ffmpeg (sha256 verify, atomic replace).
- Progress events, version probes, update-on-launch, first-run overlay wired
  to real progress.

### T3 — Search & info
- `search_youtube` (paginated) and `fetch_info` with normalized formats
  (height, fps, ext, size estimate, codec). URL-vs-query detection.

### T4 — Download engine
- Pure arg builders (unit-tested), process spawner + job registry, progress
  parser (unit-tested), cancel support, completion/error events, thumbnail
  cache, partial-file cleanup on cancel/error.

### T5 — Persistence
- rusqlite layer + migrations, settings JSON, `pick_folder` wiring, reveal/open
  via opener, duplicate detection by `video_id`.

### T6 — Home/Search UI + Format Sheet
- Hero dock, skeleton loaders, result cards (stagger-in, hover lift,
  in-library badge), infinite scroll, format sheet with real probed formats
  and quality/container/bitrate selectors.

### T7 — Downloads queue UI
- Live rows (motion-value progress + sheen), mono speed/ETA, cancel, frontend
  queue honoring concurrency, completion flash, toast choreography.

### T8 — Library UI
- Stats header, filter pills, local search, grid/list toggle, play/reveal/
  delete with confirm, missing-file status handling.

### T9 — Settings
- All four sections bound to real settings; engine section with live versions
  + force-update; concurrency applies immediately.

### T10 — Motion & polish pass
- View transitions, spring hovers, toast stack animation, boot refinement
  (flicker fix, chromatic split, sheen sweep).
- Contrast sweep to WCAG AA, error-state retry affordances, copy audit.
- Reduced-motion walkthrough verified (animations collapse to static).
- Home hero redesign: 64px wordmark, live status line, titlebar telemetry
  removed; subtle ghost-burn pulse (idle only, reduced-motion gated).

### T11 — Hardening & packaging
- Friendly error matrix: disk-full, region-block, bot-check, private/
  unavailable, rate-limit, extract-failure, bad-URL, and network errors map
  to short user-facing copy for search, info, and downloads.
- Offline / update-failure boot resilience (falls back to installed tools).
- Filename sanitization (illegal chars, control chars, length cap, Unicode
  preserved).
- Duplicate-download guard (in-flight + already-in-library), both backend and
  UI.
- Full app icon set; bundle config (`targets: "all"`, valid category and
  descriptions). `npm run tauri build` produces deb + AppImage (and rpm on
  Linux; NSIS on Windows).

[0.1.0]: https://github.com/SlyHammad18/CRTube/releases/tag/v0.1.0
