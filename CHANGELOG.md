# Changelog

All notable work is tracked here, grouped by the task breakdown in
[`DESIGN.md`](./DESIGN.md) (T1–T15). Versions follow the task milestones.

## [0.2.0] — 2026-08-26

Player milestone: music/video playback tab with playlists and synced lyrics.

### T12 — Player backend foundation
- DB migration v2: `playlists` + `playlist_items` (FK cascade, unique per
  playlist/download); `foreign_keys` pragma enabled on open.
- Playlist data layer + 8 commands: create/rename/delete/list playlists,
  add/remove/list items, transactional reorder. Duplicate adds are no-ops.
- `services/lyrics.rs`: LRCLIB client (keyless), pure helpers
  `parse_title_artist` (strips YouTube decoration) and `pick_best`
  (duration-tolerance match preferring synced LRC), atomic lyrics cache at
  `{app_data}/lyrics/{video_id}.lrc|.txt`; `fetch_lyrics` command.
- Settings gains `player_volume` / `player_speed` (serde defaults keep
  pre-v0.2 settings.json files loading unchanged); sanitize clamps both.
- Asset protocol scope widened at runtime to the effective download dir on
  startup and after every `set_settings` (superseded for playback in T13 by
  the loopback streamer; still covers any `<img>` use).
- Verified: clippy clean, 42 unit tests pass, live LRCLIB network test
  returns synced LRC for a known track.

### T13 — Playback engine
- Default view flipped to Player; rail gains MusicNote item with a pulsing
  ice dot while audio plays.
- Loopback media streamer (`services/media.rs`): ephemeral 127.0.0.1 port,
  per-session token, DB-id addressation, root confinement, HTTP Range/206 +
  HEAD — required because WebKitGTK's GStreamer pipeline cannot fetch custom
  URI schemes (`asset://`); served via new `media_url` command.
- `stores/player.ts`: queue + order permutation (shuffle keeps current first),
  repeat off/all/one, prev restart-if->3s, ended/advance logic skipping
  missing files, error toast + skip, seek nonce protocol.
- `MediaHost` owns the single `<video>` element (plays audio-only files too)
  and portals it between slots without unmounting — playback survives every
  view switch; global hotkeys (Space / arrows).
- Global `PlayerBar`: signal-meter hairline progress (MotionValue), compact
  transport, mono time readout, shuffle/repeat/volume/speed controls, caret
  nav into the Player tab; slides up only when queue non-empty.
- Volume + speed persist through settings (`player_volume`/`player_speed`),
  debounced writes, hydrated on launch.
- Library gains a "Play all" button feeding the queue with current filter/
  search context.
- Verified live: mp3 playback advanced in real time (mono clock 0:41→0:56)
  across automatic player/search/library/downloads switches without
  interruption; no media errors.

### T14 — Player lists & playlists UI
- Three-pane Player tab: playlists sidebar (232px) · track list · now-playing
  pane (340px, toggleable); edge-to-edge layout for the player view.
- PlaylistsPane: LIBRARY section (All Tracks, Recently Added) + PLAYLISTS
  with inline create/rename, confirm-guarded delete via row ⋯ menu, mono
  counts, storage footer.
- TrackList: pill filter chips, search, sort pills (custom/title/duration/
  added with direction arrows), playlist header with runtime chip + PLAY ALL,
  console-prompt empty states for empty library / no matches / empty
  playlist.
- TrackRow: index-or-EQ glyph column (staggered scaleY loop, frozen under
  reduced motion), thumb, title + channel, mono duration, hover actions —
  add-to-playlist popover (membership checkmarks, inline composer), reveal,
  delete-file confirm (library) or remove-from-playlist (playlist).
- Drag-to-reorder in manual order via Motion `Reorder` + grip handles;
  optimistic resequence persisted through `reorder_playlist_items`.
- Playlists store mirrors backend dedupe — duplicate adds surface as
  checkmark state and never create rows.
- Verified live over real IPC: create → add ×4 (deduped to 3) → reorder
  reversed (first row flipped) → rename survived restart; empty-state prompt
  captured; toolbar/chips/sort rendered.

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

[0.2.0]: https://github.com/SlyHammad18/CRTube/releases/tag/v0.2.0
[0.1.0]: https://github.com/SlyHammad18/CRTube/releases/tag/v0.1.0
