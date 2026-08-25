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

### T14.5 — Player UI typography & layout fix
- Added an `11px` micro type tier to `theme.css` `@theme` so the 22 usages of
  `text-10`/`text-11` (section labels, sort/speed pills, badges, MISSING tags,
  footer stats) render at the intended size instead of inheriting 15px body
  text — the root cause of the oversized sort cluster and "loud" micro-copy.
- Toolbar rewritten as a single non-wrapping row: filter chips + search + a new
  **SortMenu** popover (`sort custom ↑` → menuitemradio list + asc/desc toggle),
  replacing the four always-visible sort pills that wrapped to a second row.
- Global PlayerBar slimmed to a three-zone `grid-cols-[1fr_auto_1fr]`: left
  (48px thumb + title/channel, `flex-1 min-w-0`), centered transport only
  (prev · 36px play · next), right (mono time · divider · custom `.range-ice`
  volume slider with ice fill · caret). Removed shuffle/repeat/speed from the
  bar — they belong to the Now Playing transport. Hairline is now click-to-seek.
- TrackRow densified: 44px square thumbs, tighter padding/gaps.
- Sidebar 232→216px, Now Playing 340→320px; idle Now Playing shows a CRT idle
  block instead of an empty artwork square. Default window 1150→1240 (min 1000).
- DESIGN.md §2.2 (type scale), §4.8 (panes, sort popover), §4.9 (bar anatomy)
  updated to match. Verified: `npm run build` clean, `.text-11{}` present in
  bundle, re-critique of screenshots.

### T15 — Now Playing + Caption Deck
- `lib/lrc.ts`: pure `parseLrc` (multi-stamp + sorted) and binary-search
  `activeIndex` for synced-line lookup.
- `types/lyrics.ts` + `ipc.fetchLyrics` binding to the existing
  `fetch_lyrics` Rust command (LRCLIB; cache-first).
- `hooks/useLyrics.ts`: lazy fetch on active-entry change, state machine
  (idle/loading/loaded/instrumental/none/error), and manual artist/title
  override `refetch` for the fallback ladder.
- `SeekBar.tsx`: 2px track, ice fill, grows to 4px on hover; flanking mono
  times with click-to-toggle remaining/total; click/drag-to-seek.
- `VolumeSlider.tsx`: reusable custom `.range-ice` control bound to settings.
- `CaptionDeck.tsx`: the signature synced-lyrics deck — active line held at
  center via spring scroll with masked edges, click-line-to-seek, 4px ice
  caret; fallback ladder (instrumental tag / plain static block / no-result
  prompt + manual-search form prefilled from metadata). Reduced-motion
  collapses the spring.
- `NowPlayingPane.tsx`: artwork + primary video portal slot, title, SeekBar,
  transport row (shuffle·prev·44px play·next·repeat w/ "1" badge),
  VolumeSlider + SpeedMenu, and CaptionDeck filling the remainder; idle block
  preserved.
- Verified live: LRCLIB lookup for "HIM - Join Me In Death" returned synced
  LRC; active line highlighted and advanced with playback (0:00 → "Baby, join
  me in death" → 0:21 "Not wearing half your perfume"); SeekBar/transport/
  volume/speed all render. `cargo clippy` + `npm run build` clean, 48 unit
  tests pass.

### T15 fix — duplicate controls + empty artwork frame
- The Now Playing pane already renders its own seek bar + transport (per
  §4.8), so the global PlayerBar showing the same controls alongside it read as
  duplicated UI. PlayerBar now hides while the Now Playing pane is open in the
  player view (`nowPlayingOpen && view === "player"`); it returns on other
  views and when the pane is collapsed. The window then has exactly one seek
  bar + one transport row.
- Now Playing artwork frame always paints a poster (cached thumbnail) behind
  the portaled `<video>`, with a music-note placeholder when there is no art —
  so the frame is never an empty black box ("video not working" perception).
- Verified: single control set in the pane, artwork shows an image, and the
  pane-collapse → bar-return + video-portal fallback path is unchanged
  (PlayerTab unmounts the pane on collapse, releasing the primary slot to the
  bar's secondary slot). `npm run build` clean.

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
