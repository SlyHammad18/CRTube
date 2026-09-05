# CRTube — Design & Build Specification (v0.2)

A YouTube downloader **and** local music/video player desktop app. Rust + Tauri v2 shell, React + TypeScript UI, powered by `yt-dlp` (auto-installed, auto-updated) and static `ffmpeg` (installed once). Downloads land in a library the built-in Player tab plays back — audio-first, video secondary — with playlists and synced lyrics.

**Design thesis:** *cathode-ray-tube nostalgia fused with modern dark-tech.* One signature idea (the "power-on" moment, §3) carries the whole UI; the Player surface adds a second motif — the **Caption Deck** (§4.8) — so the screen finally does what a cathode-ray tube was built for: broadcast.

**Design dials:** `VARIANCE 6 · MOTION 7 · DENSITY 4`

**Locked decisions**

| Decision | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Accent | Ice cyan `#4DD8FF` |
| Packaging targets | Linux (deb, AppImage) + Windows (NSIS) |
| Media engine | Webview-native `<video>` element fed by a loopback HTTP streamer |
| Lyrics provider | LRCLIB (`lrclib.net`) — free, keyless, synced LRC |

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri v2** (Rust) | Requested |
| Frontend | **React 18 + TypeScript + Vite** | Mature Tauri ecosystem, matches motion/styling tooling |
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite` | Token-driven utilities, no postcss plugin needed for v4 |
| Motion | **Motion** (`motion/react`) | Springs, layout animations, `AnimatePresence`, `Reorder` |
| Icons | **@phosphor-icons/react** | One icon family only; global stroke width 1.5 |
| Fonts | **Self-hosted `@fontsource/*`** | Desktop app → zero runtime font CDN requests |
| State | **Zustand** | Queue / settings / library / search / player / playlists stores |
| DB | **rusqlite** (bundled SQLite) | Download history + playlist persistence |
| HTTP | **reqwest** (rustls-tls) | Fetch yt-dlp releases, ffmpeg bundles, thumbnails, LRCLIB lyrics |
| Playback | **HTML `<video>` element** fed by a loopback HTTP streamer (`services/media.rs`) | Native seek / `playbackRate` / ended+error events; WebKitGTK's GStreamer pipeline cannot fetch custom URI schemes, so `asset://` cannot feed media |
| Tauri plugins | `dialog`, `opener`, `core:window` | Folder picker, reveal/play file, window controls |

No other UI/component libraries. Never hand-roll SVG icons.

---

## 2. Theme System

### 2.1 Palette — "Ice Console"

One accent, locked app-wide. Cool neutrals only — **no warm grays anywhere in the app.**

| Token | Hex | Role |
|---|---|---|
| `void` | `#07090C` | App background |
| `panel` | `#0E1218` | Cards, rail, sheets |
| `raise` | `#151B24` | Hover states, elevated surfaces, inputs |
| `line` | `#FFFFFF14` | Hairlines, borders, dividers |
| `ink` | `#E7ECF3` | Primary text |
| `mute` | `#96A1B3` | Secondary text |
| `dim` | `#5D6878` | Tertiary text, disabled |
| `ice` | `#4DD8FF` | **THE accent** — CTAs, progress, active nav, focus rings |
| `amber` | `#FFC24B` | Warnings, ETA highlights only — sparingly |
| `signal` | `#FF5F57` | Close button, delete, errors |

Hard rules:

- Primary button = `ice` fill + `void` text (contrast ≈ 12:1).
- No purple anywhere. No neon outer glows.
- No pure `#000000`, no pure `#FFFFFF`.
- Shadows are tinted to the background hue (`0 8px 24px rgba(0,0,0,.35)`), never pure black on panels.

### 2.2 Typography — three roles

| Role | Face | Weights | Usage |
|---|---|---|---|
| Display | **Chakra Petch** | 600 / 700 | Wordmark, headings, quality chips, active lyric line — squared techno grotesk |
| Body/UI | **Manrope** | 400–600 | Titles, labels, body copy |
| Telemetry | **JetBrains Mono** | 400 / 500 | Durations, sizes, speeds, versions, ETAs, lyric timestamps |

Rules:

- **Everything numeric is mono.** File sizes, percentages, timestamps, version strings.
 - Type scale: `11 / 12 / 13 / 15 / 18 / 24 / 32`. The **11px micro tier** is reserved for status tags, badges, section labels, and the mono sort/speed pills — never body copy.
- Display headings: tight tracking (`tracking-tight`), no all-caps eyebrows except the titlebar telemetry readout.
- Italic/bold emphasis within a headline uses the same family — never inject a second display face.

### 2.3 Shape & elevation

- Radius lock: **10px** everywhere — cards, inputs, buttons, sheets, artwork frames.
- Full-pill radius reserved exclusively for filter chips and status tags.
- Elevation = 1px `line` border + tinted shadow. No glow-based elevation.

### 2.4 Interactive state contract

Every interactive element ships all states:

- Hover: surface shift to `raise`, 160ms ease-out.
- Active/press: `scale-[0.98]` or `-translate-y-[1px]` physical push.
- Focus-visible: 2px `ice` ring, offset 2px — keyboard visible at all times.
- Loading: skeleton shimmer matching final layout shape — never bare spinners.
- Empty/error states: written as console prompts (see §3), always offering an action.
- Disabled: `dim` text + `line` border, no pointer events.

---

## 3. Signature Element — CRT Motif

The broadcast motif echoes quietly across the app without a boot sequence:

- Fixed scanline overlay at 3% opacity, `pointer-events-none`, z-index layer documented in code.
- Titlebar telemetry readout in JetBrains Mono: `● ytdlp 2026.08.20 · ready`. Status dot: `ice` = ready, `amber` = updating tools, `signal` = error.
- Empty states written as console prompts: `> awaiting input_`, `> nothing archived yet_`.
- The Player surface echoes the broadcast motif with the **Caption Deck** (§4.8) — synced lyrics set like closed-captioning.

**Reduced motion:** the scanline overlay renders static and no animation of the motif runs under `prefers-reduced-motion`.

---

## 4. Screens

### 4.1 App shell

```
┌──────────────────────────────────────────────────────────┐
│ ◉ CRTUBE   ● ytdlp 2026.08.20·ready          ─  □  ✕    │ ← 40px custom titlebar
├────┬─────────────────────────────────────────────────────┤
│ ♪  │                                                     │
│ ⌕  │                MAIN VIEW                            │
│ ⇩³ │              (animated swap)                        │
│ ▦  │                                                     │
│    ├─────────────────────────────────────────────────────┤
│ ⚙  │ PLAYERBAR (64px, global — appears when queue ≠ ∅)   │
└────┴─────────────────────────────────────────────────────┘
```

- **Default view on launch: `player`.**
- **Titlebar (40px):** full-width drag region (`data-tauri-drag-region`). Left: logo mark + telemetry readout. Right: minimize, maximize, close — close hover fills `signal`. Double-click toggles maximize.
- **Icon rail (64px):** **Player** (`MusicNote`, first), Search/home, Downloads (badge = active count), Library; Settings pinned bottom. Active view gets an `ice` left notch + subtle icon tint. While audio plays, a 4px `ice` dot under the Player icon pulses (opacity keyframes; static dot under reduced motion).
- View transitions: fade + 8px rise in (240ms, `cubic-bezier(0.16,1,0.3,1)`), fade out (120ms), orchestrated with `AnimatePresence`.

### 4.2 Home / Search

```
│            ┌───────────────────────────────┐             │
│            │ ⌕ Paste a link or search…  ↵ │ ← hero dock │
│            └───────────────────────────────┘             │
│              recent: lofi mix · synthwave …              │
│                                                          │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│  │ thumb  │ │ thumb  │ │ thumb  │ │ thumb  │             │
│  │ 12:04▓ │ │        │ │✓in lib │ │        │             │
│  │ Title… │ │ Title… │ │ Title… │ │        │             │
│  │ Ch ·1M │ │        │ │        │ │        │             │
│  └────────┘ └────────┘ └────────┘ └────────┘             │
```

- Hero dock: single large input. URL regex detection auto-switches to link mode — skips search entirely, opens the format sheet directly.
- Recent-search chips below dock (pill radius).
- Results grid: responsive cards, stagger-in on mount (40ms delay per card). Card = 16:9 thumbnail, duration badge (mono), title (2-line clamp), channel · views.
- Hover: card lifts `y:-3` spring; Download affordance appears.
- Already-downloaded videos (matched by `video_id` against DB) show a persistent ✓ "in library" badge.
- Infinite scroll, 20 results per page.
- While searching: skeleton shimmer cards matching exact final layout.

### 4.3 Format Sheet (right slide-over, 420px)

```
│ ┌────────────────────────────┐
│ │ [thumb]  Title two-line…   │
│ │          Channel · 12:04   │
│ ├────────────────────────────┤
│ │      [ MP4 ]  [ MP3 ]      │  ← segmented control
│ ├────────────────────────────┤
│ │ ◉ 2160p  4K · 1.2 GB est   │  ← real formats from --dump-json
│ │ ○ 1080p      412 MB        │
│ │ ○ 720p       214 MB        │
│ │ container: (mp4)(webm)(mkv)│
│ ├────────────────────────────┤
│ │ → ~/Downloads/CRTube    ⌗  │  ← click to change location
│ │ [      ⬇ DOWNLOAD      ]   │
│ └────────────────────────────┘
```

- Opens with spring slide `x:100% → 0` (stiffness 380, damping 34).
- MP4 tab: every quality the source actually offers (from format probe), each row shows height badge, FPS badge when >30, HDR tag when present, filesize estimate when available. Container choice where multiple exist.
- MP3 tab: quality select (**Best** ≈ V0/320, 192, 128); toggles: **Embed cover art** (default ON — core requirement), Embed metadata (default ON).
- Footer: destination path chip (click → inline folder picker) + primary DOWNLOAD button.
- On queue: sheet closes, toast confirms `Added to queue`.

### 4.4 Downloads

- Rows: mini thumbnail, title, `ice` progress bar with moving sheen highlight, mono stats line `8.2 MB/s · ETA 00:31 · 47%`, cancel ✕.
- Progress bar width driven by a Motion value (not React state churn).
- Completed: check flash on the row, then item moves out to Library automatically.
- Queue owned by frontend store; concurrency limit from settings (default 3). Queued rows dimmed with position number.
- Cancel kills the process backend-side; partial files removed.

### 4.5 Library

- Header stats in mono: `142 items · 38.4 GB`; filter pills `(All)(Audio)(Video)`; library-local search field; grid/list density toggle.
- Grid cards: thumbnail with corner type icon (music note / film), duration, size, date added.
- Row/card hover actions: ▶ Open (default player), ⌗ Reveal (file manager), 🗑 Delete with confirm popover (removes file + DB row).
- Files that vanished from disk flip to "missing" status styling instead of silently breaking.
- Empty state: `> nothing archived yet_` + CTA back to search.

### 4.6 Settings

Grouped sections, bound live (no restart required):

- **Storage:** download path picker + "open folder".
- **Engine:** yt-dlp version + *Check for update* button; ffmpeg version; auto-update-on-launch toggle (default ON).
- **Downloads:** concurrency stepper (1–5), applies immediately to the running queue.
- **About:** app version, yt-dlp attribution + unaffiliation disclaimer, licenses note.

Changing the download directory re-applies the runtime asset-protocol allow rule (§5.6) immediately.

### 4.7 First-run setup overlay

Full-screen overlay before any search is possible: "Calibrating display…" — two real progress bars (`yt-dlp`, `ffmpeg`) fed by installer progress events, then auto-dismisses. Blocks interaction until tools are ready.

### 4.8 Player (default view — music-first, video minor)

Three panes inside the main view area:

```
┌ SIDEBAR 216px ─┬─ TRACK LIST (1fr) ───────────────┬─ NOW PLAYING 320px ─┐
│ LIBRARY        │ [ALL][AUDIO][VIDEO]  ⌕ search  │ ┌─────────────────┐ │
│  ♪ All Tracks  │ ┌────────────────────────────┐ │ │ artwork r10     │ │
│  ◷ Recently    │ │ #  THUMB  TITLE    ⏱   ⋯  │ │ │ or <video> slot │ │
│                │ │ 1  ▦     Song A    3:41 ＋│ │ └─────────────────┘ │
│ PLAYLISTS   ＋ │ │ 2  ▮▮    Song B ●  4:02 ＋│ │ SONG TITLE (Petch24)│
│  ▤ Focus Mix 12│ │ 3  ▦     Song C    2:55 ＋│ │ Channel · Manrope   │
│  ▤ Night Drive │ └────────────────────────────┘ │ 0:00 ━━●━━━━━ 3:41  │
│                │  sortable header, scroll list  │ ⇄ ⏮ ▶(ice) ⏭ ↻     │
│ ────────────── │                                │ vol ──●──  speed ⌄  │
│ 12 tracks      │                                │ ╔══ CAPTION DECK ╗═╗│
│ 1.2 GB (mono)  │                                │ ║ past lines  dim  ║│
└────────────────┴────────────────────────────────┴─╫▶ ACTIVE LINE ice ╟┤
                                                    ║ next lines mute  ║│
                                                    ╚══════════════════╝╝
```

**Sidebar (232px)**

- `LIBRARY` section: **All Tracks**, **Recently Added** (sort shortcut).
- `PLAYLISTS` section with `＋ New` (turns into an inline text input, `↵` commits / `esc` cancels). Playlist rows show name + mono track count; overflow `⋯` menu: Play, Rename (inline edit), Delete (signal-red confirm popover — deletes playlist rows only, never media files).
- Footer: mono stats `12 tracks · 1.2 GB` (sum of `size_bytes`).

**Track list (center, 1fr)**

- Header row: pill filter chips `(All)(Audio)(Video)` reusing library vocabulary, local search field, and a compact **sort popover** (`sort custom ↑`, opens a menuitemradio list of custom/title/duration/added with an asc/desc toggle row — mirrors the SpeedMenu vocabulary). Toolbar is single-row `flex-nowrap` so it never wraps.
- Row anatomy: index (mono) · 44px **square** rounded-10 thumb · title (Manrope 600) + channel (`mute`) · duration (mono) · hover actions: `＋` add-to-playlist, `⌗` reveal, trash w/ confirm.
- **Active row:** `ice`-tinted title + 3-bar EQ glyph (2px bars, staggered scaleY loop; frozen bars under reduced motion).
- Missing files render an amber `MISSING` pill tag (pill radius reserved for status tags), row disabled, skipped on queue advance.
- Interactions: double-click or hover ▶ starts playback and sets the play context (current view/filter or playlist); `＋` opens a popover listing playlists with checkmarks + `New playlist…`.
- Empty states (console-prompt style): `> awaiting media_ download something in SEARCH` / `> this playlist is empty_ add tracks with +`.

**Playlists view** (a sidebar playlist selected): same list plus total-runtime header chip (mono) + primary **PLAY ALL** button. Rows gain a grip handle and support **drag-to-reorder** via Motion `Reorder.Group/Item` (spring physics, `layout` animation, reduced-motion collapse); order persists through `reorder_playlist_items`. Duplicate adds are silent no-ops (`UNIQUE(playlist_id, download_id)`).

**Now Playing pane (320px, collapsible via `PanelRight` toggle, state in ui store)**

- Artwork frame: radius 10 + scanline overlay; shows cached thumbnail. For `kind === 'video'` tracks, the live `<video>` element overlays this frame (positioned by MediaHost over `#nowplaying-media-slot`, §4.9 — never reparented).
- Title (Chakra Petch 24, 2-line clamp) + channel (Manrope, `mute`).
- Seek bar: 2px `line` track, `ice` fill, grows to 4px on hover; flanking times in mono (`0:00` elapsed / `-3:41` remaining toggleable by click).
- Transport row: shuffle · previous · **play/pause (44px `ice` circle, `void` icon — the only filled accent circle in the app)** · next · repeat (cycles off → all → one; `one` shows mono superscript `1` badge).
- Secondary row: volume slider (icon + thin slider) and **SpeedMenu** popover: `0.50× 0.75× 1× 1.25× 1.5× 1.75× 2×` mono pills, current selection `ice` fill. Volume + speed persist in settings (§5.5).

**Caption Deck — synced lyrics (the Player's signature motif)**

- Fills the remainder of the Now Playing pane. Inner line-track translates vertically so the active line holds center; mask-image fade top/bottom edges; only `transform` animates.
- Line states: past lines `dim` at 45% opacity · **active line `ink`, Chakra Petch, 4px `ice` caret bar on the left edge** · upcoming lines `mute`.
- Click any line → seek to its timestamp (spring feedback on the deck).
- Fallback ladder: synced LRC → plain text (static scrollable block, same typography, no caret) → `instrumental` flag renders an `INSTRUMENTAL` status tag → no result: console prompt `> no lyrics found_ try manual search` with an inline artist/title override form prefilled from parsed metadata (§5.7).
- Lyrics fetch lazily on first play of a track; cached hits render instantly (§5.7).

**Keyboard map (global, ignored while focus is in a text-editable field):** `Space` play/pause · `←/→` seek ∓1s · `↑/↓` volume ±1% (unmutes on raise) · `m` mute/unmute · `,`/`.` next/previous track · `l` toggle lyrics dock · `r` cycle repeat · `s` toggle shuffle · `Ctrl+N` new playlist · `F2` rename selected playlist (else edit the playing song).

### 4.9 Global Player Bar & Media Host

```
│ ━━━━━━━━━ 2px ice hairline (click-to-seek) across full width ━━━━━━━━ │
│ [thumb48] Title… Channel   ⏮ ▶(36px) ⏭   1:24/3:41 | vol ━━●━━ ⌃  │
└──────────────────────────────────────────────────────────────────┘
```

- **Persistent across every view** (Spotify/YT-Music pattern): slides up once the play queue is non-empty, springs away when the queue is cleared. Height 64px; sits right of the rail.
- Top edge carries a full-width 2px `ice` hairline progress fill that **also acts as a click-to-seek strip** (grows to 3px on hover) — reads like a channel signal meter you can scrub.
- **Three-zone layout** via `grid-cols-[1fr_auto_1fr]`: **left** = 48px thumb (or title/channel, `flex-1 min-w-0`) · **center (truly centered)** = compact transport only (prev · play/pause 36px `ice` circle · next) · **right** = mono time `1:24 / 3:41`, a vertical `line` divider, volume (custom-styled `.range-ice` slider with inline ice-fill gradient — no native widget), and the `⌃` caret navigating to the Player tab.
- Shuffle/repeat/speed deliberately live in the **Now Playing transport** (§4.8), not the bar — the global bar stays a minimal now-playing indicator.
- **Media host contract:** exactly one `<video>` DOM node lives in a persistent `MediaHost` mounted at shell level. The node is **never reparented** — under WebKitGTK's GStreamer video sink, moving a `<video>` to a new DOM parent tears down the native compositing surface and blacks out / kills controls on Linux. Instead the single node stays mounted at app root and is *positioned over the active stage via CSS* (`top/left/width/height` from the target slot's measured rect, `object-fit` cover/contain). Slots `#nowplaying-media-slot` (Player tab artwork frame), `#playerbar-media-slot` (bar thumb), and the fullscreen stage are pure measurement placeholders; a rAF loop + ResizeObserver keeps the node tracking the stage through view transitions and the PlayerBar spring. Playback (audio included) is continuous across every view and fullscreen — the video keeps playing (picture shrinks into the bar) exactly like audio does.
- Audio-only tracks never show video — the node hides (`visibility:hidden`, never `display:none`) while still decoding audio.

---

## 5. Backend Architecture

```
src-tauri/src/
├─ lib.rs            # builder, plugins, managed state, event wiring, media-server + asset-scope setup
├─ commands/
│  ├─ tools.rs       # ensure_tools, tool_versions, update_ytdlp(force)
│  ├─ search.rs      # search_youtube(query, page), fetch_info(url)
│  ├─ download.rs    # start_download(opts) -> job_id, cancel_download(id)
│  ├─ library.rs     # list_library, add_entry, delete_entry, reveal_path
│  ├─ settings.rs    # get_settings / set_settings (JSON)
│  └─ player.rs      # playlists CRUD, fetch_lyrics, media_url
├─ services/
│  ├─ installer.rs   # GitHub release fetch, sha256 verify, atomic replace
│  ├─ ytdlp.rs       # arg builders + progress-line parser (pure, unit-tested fns)
│  ├─ lyrics.rs      # LRCLIB client + cache (pure helpers, unit-tested)
│  ├─ media.rs       # loopback Range-capable media streamer (pure helpers, unit-tested)
│  └─ db.rs          # rusqlite migrations (v1 downloads, v2 playlists)
└─ jobs.rs           # Mutex<HashMap<job_id, Child>> process registry
```

### 5.1 Events (backend → frontend)

Unchanged — playback timing is webview-local and lyrics are request/response, so the Player adds **no new events**.

| Event | Payload |
|---|---|
| `tools://progress` | `{tool, stage, pct}` — installer/setup bars |
| `tools://status` | `{state: "updating" \| "ready" \| "error"}` — titlebar dot |
| `dl://progress` | `{id, pct, speed_bps, eta_s, downloaded, total}` |
| `dl://done` | `{id, path}` |
| `dl://error` | `{id, message}` |

### 5.2 Commands

Existing: `ensure_tools · tool_versions · update_ytdlp · search_youtube · fetch_info · start_download · cancel_download · list_library · delete_entry · reveal_path · open_path · has_download · pick_folder · get_settings · set_settings`

Added (v0.2):

```
list_playlists(db) -> Vec<Playlist{id,name,track_count,created_at}>
create_playlist(db, name) -> Playlist
rename_playlist(db, id, name)
delete_playlist(db, id)
add_playlist_item(db, playlist_id, download_id)
remove_playlist_item(db, item_id)
list_playlist_items(db, playlist_id) -> Vec<PlaylistTrack>   -- JOIN downloads, ordered by position
reorder_playlist_items(db, playlist_id, item_ids: Vec<i64>)
fetch_lyrics(app, video_id, title, channel, duration_s) -> Option<LyricsPayload>
-- LyricsPayload { synced, plain, instrumental, track_name, artist_name, cached }
media_url(db, server, id) -> Option<String>                  -- loopback stream URL for a download
```

### 5.3 Tool installation

Binaries live in `{app_data}/bin/`; that dir is injected into child-process env, and `--ffmpeg-location` is always passed explicitly.

**yt-dlp** — install latest + update every launch:
- Query `https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest`.
- Pick OS asset: `yt-dlp` (Linux) / `yt-dlp.exe` (Windows). macOS assets kept behind constants but unsupported.
- Verify SHA256 against the release checksums file.
- Write to temp file → atomic rename over old binary.
- First run: blocking, surfaced through the first-run overlay.
- Every launch: async compare installed vs latest → silent replace + toast `yt-dlp updated → {version}`. Never use `yt-dlp -U` (permission/fragility issues).
- Toggleable via settings.

**ffmpeg** — installed once, never updated:
- Static bundles including **ffprobe**: johnvansickle static builds (Linux), BtbN win64 builds (Windows).
- Source URLs isolated as constants in `installer.rs` for easy maintenance.

Version probes: `yt-dlp --version`, first line of `ffmpeg -version`.

### 5.4 yt-dlp invocation cheat-sheet

```bash
# Search (paginated flat metadata, no API key)
yt-dlp "ytsearch{page*20}:{query}" --flat-playlist --dump-json

# Probe a pasted link (full format list)
yt-dlp --dump-single-json --no-playlist {url}

# MP4
-f "bv*[ext={container}][height<={h}]+ba[ext=m4a]/b[height<={h}]" \
--merge-output-format {container} --embed-metadata --embed-thumbnail

# MP3
-x --audio-format mp3 --audio-quality {0|2|5} \
--embed-thumbnail --embed-metadata          # Best≈V0/320, 192, 128

# Common
--newline --no-colors --ffmpeg-location {bin_dir} \
--progress-template "download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes_estimate)s" \
-P {download_dir} -o "{title} [{id}].{ext}"
```

- Progress lines parsed in Rust by a pure function (unit-tested) → emitted as `dl://progress`.
- Cancel: `child.kill()` via job registry; cleanup of `.part` files.
- Thumbnails cached separately via reqwest into `{app_data}/thumbs/{video_id}.jpg` — keeps download folders clean, library covers survive offline.

### 5.5 Database schema

Migration v1 (existing, unchanged):

```sql
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY,
  video_id TEXT UNIQUE,
  url TEXT,
  title TEXT,
  channel TEXT,
  duration_s INTEGER,
  kind TEXT,               -- 'audio' | 'video'
  quality TEXT,            -- e.g. '1080p' | 'Best'
  container TEXT,          -- 'mp4' | 'webm' | 'mkv' | 'mp3'
  path TEXT,
  size_bytes INTEGER,
  thumb_url TEXT,
  status TEXT,             -- 'done' | 'missing'
  created_at INTEGER
);
```

Migration v2 (player):

```sql
CREATE TABLE playlists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE playlist_items (
  id INTEGER PRIMARY KEY,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  download_id INTEGER NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  added_at INTEGER NOT NULL,
  UNIQUE(playlist_id, download_id)
);
```

Settings persisted as JSON at `{app_config}/settings.json`: `{ download_dir, concurrent, autoupdate_ytdlp, filename_template, player_volume, player_speed }` — the two new fields carry serde defaults (`1.0`), so pre-v0.2 files load unchanged.

### 5.6 Security & capabilities

Minimal Tauri capability set: dialog, opener, core window permissions. The frontend never touches the fs plugin — file ops happen Rust-side; paths cross the bridge as strings only. No secrets involved; GitHub API used unauthenticated (rate limits acceptable for a desktop client); LRCLIB is keyless.

**Media serving.** WebKitGTK's media pipeline (GStreamer) cannot fetch from custom URI schemes, so the asset protocol can serve thumbnails but not playback. Downloaded audio/video is instead streamed by a loopback-only HTTP server (`services/media.rs`, tokio, no new crates):

- Binds `127.0.0.1:0` (ephemeral port) at startup; URLs look like `http://127.0.0.1:{port}/{token}/{download_id}`.
- The token is a per-session SHA256 nonce — first path segment, constant-time-compared.
- Files are addressed strictly by `downloads.id`; paths resolve server-side from the DB and are re-validated against canonicalised allowed roots (the effective download dir, updated on `set_settings`). No client-supplied paths, no traversal surface.
- Full HTTP Range support (`206 Partial Content`, `Accept-Ranges: bytes`) so seeking works; `HEAD` honored.

The static asset-protocol scope stays minimal (`$APPDATA/thumbs/**`, `$APPDATA/bin/**`) for cover art; a runtime `allow_directory` for the download root is still applied (harmless, useful for any `<img>` use), but playback never depends on it.

### 5.7 Lyrics service (LRCLIB)

Endpoints (no key, no rate limit):

```
GET https://lrclib.net/api/get?artist_name={a}&track_name={t}&duration={s}
GET https://lrclib.net/api/search?q={query}          # fallback when /get misses
→ 200 { id, trackName, artistName, duration, instrumental,
        plainLyrics, syncedLyrics }                  # syncedLyrics = LRC text
```

Flow inside `fetch_lyrics(app, video_id, title, channel, duration_s)`:

1. Cache-first: return `{app_data}/lyrics/{video_id}.lrc` (synced) or `.txt` (plain) if present, `cached: true`.
2. Derive search terms with pure fn `parse_title_artist(title, channel)` — splits `"Artist - Title"` patterns, strips parenthetical noise (`(Official Video)`, `[HD]`…); falls back to artist = channel.
3. Try `/api/get` with duration tolerance; miss → `/api/search?q="{artist} {track}"` and pick via pure fn `pick_best(results, duration_s)` (min duration delta ≤ 3s, prefer entries with `syncedLyrics`).
4. Persist atomically (temp-write → rename) into the lyrics cache; return payload.

Frontend owns LRC rendering: pure TS `lib/lrc.ts` — `parseLrc(text) -> [{tMs, s}]` sorted (multiple timestamps per line supported) and `activeIndex(lines, tMs)` pointer-walk against `<video>.currentTime`. Both pure and unit-testable.

---

## 6. Frontend Structure

```
src/
├─ main.tsx / App.tsx        # providers, router shell, PlayerBar + MediaHost mount
├─ theme.css                 # Tailwind v4 tokens (@theme), fonts, scanlines, caption-deck utils
├─ components/
│  ├─ titlebar/              # drag region, telemetry, window buttons
│  ├─ rail/                  # nav rail + active notch + playing pulse dot
│  ├─ search/                # hero dock, result cards, skeletons
│  ├─ sheet/                 # format slide-over
│  ├─ downloads/             # queue rows, progress bars
│  ├─ library/               # grid/list, filters, action rows
│  ├─ player/                # PlayerTab, PlaylistsPane, TrackList/Row, NowPlaying,
│  │                         # CaptionDeck, Transport, SeekBar, SpeedMenu,
│  │                         # VolumeSlider, AddToPlaylistMenu
│  ├─ player-bar/            # global PlayerBar + MediaHost (portal slots)
│  ├─ settings/              # sections
│  └─ common/                # toast stack, pills, empty states, confirm popover
├─ stores/                   # zustand: queue, settings, library, search, ui,
│                            #           player, playlists
├─ lib/
│  ├─ ipc.ts                 # typed command wrappers + event listeners
│  ├─ lrc.ts                 # pure LRC parser + active-line finder
│  └─ format.ts              # bytes/duration/ETA formatters (mono output)
└─ types/                    # shared DTOs mirroring Rust serde structs
```

Player store (`stores/player.ts`) shape:

```
queue: LibraryEntry[]        // logical queue (play context snapshot)
order: number[]              // permutation — shuffled or linear
pos: number                  // index into order
playing, currentTimeS, durationS
repeat: 'off'|'all'|'one'    shuffle: boolean
context: {type:'library'|'playlist', id?} | null
actions: playAll(entries,start) enqueue toggle next prev cycleRepeat
         toggleShuffle(current stays first) setSpeed setVolume seek onEnded onError
```

Advance rules: `onEnded` honors repeat-one (seek 0) → repeat-all (wrap) → off (stop at queue end); `next()` manual always advances; both skip `status === 'missing'` entries; media `error` event → toast + skip (never a dead queue).

Motion rules (project-wide):

- Animate only `transform` and `opacity`.
- Springs for interactive elements (`stiffness 300, damping 22` range); eased curves for entrances.
- Stagger children via variants, not per-item timers where avoidable.
- All motion gated behind `useReducedMotion()` / media query collapse — CaptionDeck snapping, EQ bars freezing, Reorder going instant included.

---

## 7. Task Breakdown

Each task ends with its verify gate run and passing **before** the next task begins.

### T1 — Scaffold & shell
Tauri v2 + React-TS + Tailwind v4 project; frameless window config; custom titlebar (drag region, min/max/close, double-click maximize); icon rail + view routing; full token system in `theme.css` incl. @fontsource fonts.

**Verify:** `cargo clippy` clean, `npm run build` clean, `npm run tauri dev` → frameless dark window, all three window buttons work, rail switches placeholder views.

### T2 — Tool manager
Installer service (yt-dlp + ffmpeg/ffprobe, sha256 verify, atomic replace), progress events, version probes, update-on-start logic, first-run overlay wired to real progress.

**Verify:** wipe app-data dir → launch → overlay shows real progress, binaries exist in `{app_data}/bin`, versions logged; relaunch → "up to date"; seed fake older version constant → silent update + toast.

### T3 — Search & info
`search_youtube` (paginated), `fetch_info` with normalized formats (height, fps, ext, filesize estimate, codec); Zustand search store; URL-vs-query detection helper.

**Verify:** Rust integration test hits yt-dlp for a known query + known URL and asserts typed output; manual check: search renders correct data, pasted URL jumps straight to sheet.

### T4 — Download engine
Arg builders (unit-tested), process spawner + job registry, progress parser (unit-tested), cancel support, completion/error events, thumbnail cacher.

**Verify:** test downloads a tiny video as mp4-720p and mp3-best; ffprobe confirms embedded cover art + ID3 tags on the mp3; cancel mid-download leaves no partial file; `dl://progress` observed in webview console.

### T5 — Persistence
rusqlite layer + migrations, settings JSON read/write, `pick_folder` wiring, reveal/open via opener plugin, duplicate-detection query by `video_id`.

**Verify:** download lands in DB; restart persists; changed download dir takes effect for next download; reveal opens the system file manager at the file.

### T6 — Home/Search UI + Format Sheet
Hero dock, skeleton loaders, result cards (stagger-in, hover lift, ✓-in-library badge), infinite scroll, format sheet with real probed formats, quality/container/bitrate selectors, destination chip.

**Verify:** full happy path manually: search → sheet → queue an mp4 and an mp3 with cover art → both files correct on disk and playable.

### T7 — Downloads queue UI
Live rows (motion-value progress + sheen), mono speed/ETA readouts, cancel, frontend queue honoring concurrency setting, completion flash, toast choreography.

**Verify:** queue 5 items with concurrency 2 → exactly 2 active at once, order preserved; cancel works; finished items appear in Library.

### T8 — Library UI
Stats header, filter pills, search, grid/list toggle, play/reveal/delete actions with confirm, missing-file status handling.

**Verify:** filters + local search correct; play opens default player; delete removes file + row; externally deleting the file flips entry to "missing".

### T9 — Settings
All four sections bound to real settings; engine section shows live versions + force-update button; concurrency applies immediately.

**Verify:** every toggle/picker persists across restart and takes effect without relaunch.

### T10 — Motion & polish pass
View transitions, spring hovers, toast stack animation, scanline overlay, empty/error-state audit (offline search, bad URL, failed download), copy audit, reduced-motion collapse verified.

**Verify:** walkthrough with reduced-motion ON and OFF; screenshot review of every screen + every empty/error state; contrast spot-checks pass WCAG AA.

### T11 — Hardening & packaging
Error-path matrix (no network at boot, yt-dlp update failure, disk full, region-blocked video), long/unicode filename sanitization, duplicate-download guard, app icon, bundler configs: deb + AppImage (Linux), NSIS (Windows).

**Verify:** `npm run tauri build` produces installable artifacts; each error scenario shows a friendly inline/toast message, never a crash.

### T12 — Player backend foundation
DB migration v2 (playlists, playlist_items); `commands/player.rs` with the eight playlist commands; `services/lyrics.rs` (cache, `parse_title_artist`, `pick_best`, LRCLIB client) + `fetch_lyrics`; settings gains `player_volume`/`player_speed`.

**Verify:** `cargo clippy` + `cargo test` clean (pure fns covered); manual IPC: create/list/rename/delete playlist persists across restart; dup add is a no-op; `fetch_lyrics("Bohemian Rhapsody","Queen",354)` returns LRC and second call reports `cached:true`.

### T13 — Playback engine
Default view flips to `player`; rail gains Player item + playing pulse dot; `stores/player.ts` with order/permutation logic (shuffle keeps current first); `services/media.rs` loopback Range-capable streamer + `media_url` command (WebKitGTK cannot fetch media over custom schemes — §5.6); `MediaHost` single-`<video>` node + portal slots; global `PlayerBar` (hairline progress, compact transport, mini-video thumb slot, caret nav); transport wiring: repeat off/all/one, shuffle, speed (`playbackRate`), seek, volume, prev restart-if->3s, ended/advance/skip-missing, error toast+skip; keyboard map; volume/speed persisted via settings.

**Verify:** start an mp3 → walk every view: audio never stops (automated screenshot pass: mono clock advanced 0:41→0:56 across player/search/library/downloads switches); repeat-one loops seamlessly; shuffle regenerates order without replaying current; 1.5× audibly faster and survives restart; missing track skipped with toast; Space/arrows work outside inputs; queue-end stops cleanly with repeat off.

### T14 — Player lists & playlists UI
Three-pane `PlayerTab`; TrackList with chips/sort/search/EQ-glyph active row/missing pills/hover actions; AddToPlaylist picker popover; PlaylistsPane CRUD (inline create/rename, delete confirm, mono counts, storage footer); playlist view with runtime header, PLAY ALL, Motion `Reorder` drag-to-reorder persistence; console-prompt empty states.

**Verify:** CRUD + reorder survive restart; duplicate add no-op visible (checkmark state); chips/search/sort correct against ≥20 mixed tracks; empty states for empty library and empty playlist; drag reorder respects reduced-motion.

### T15 — Now Playing + Caption Deck
Artwork frame + video portal swap between slots; SeekBar hover-grow + remaining-time toggle; SpeedMenu + VolumeSlider bound to settings; CaptionDeck: lazy fetch, synced highlight tracking `currentTime` (~200ms tolerance), click-line-to-seek, centered spring scroll, plain/instrumental/none fallback ladder, manual search override form; reduced-motion pass; screenshot review.

 **Verify:** synced highlight stays within ~200ms of vocals on a known LRC-backed track; clicking a line seeks; video keeps playing (position + audio unbroken) while portaling between tab ↔ bar; offline relaunch replays cached lyrics instantly; fallback ladder exercised on an instrumental and a gibberish-title track; `cargo clippy` + `npm run build` clean.

 **Done (verified):** synced LRC highlight tracked playback live ("HIM - Join Me In Death" advanced 0:00 → 0:21); click-line-seek, SeekBar hover-grow + remaining toggle, transport row, VolumeSlider + SpeedMenu, and the instrumental/plain/none fallback ladder (with manual-search override) all implemented; reduced-motion collapses the deck spring. Clippy + build clean, 48 unit tests pass.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| YouTube breaks yt-dlp extraction | Auto-update on every launch is a core feature, not an afterthought |
| `yt-dlp -U` blocked by permissions | Always replace binary atomically via GitHub releases, never self-update |
| Static ffmpeg URLs rot | URLs isolated as constants in `installer.rs`, checksummed downloads |
| IP blocks / rate limiting | Surface yt-dlp's own error text in friendly toasts; retry affordance |
| Partial files on crash/kill | `.part` cleanup on cancel/error; temp-write → atomic rename pattern everywhere |
| WebKitGTK codec gaps (mkv/H.264 variance across Linux distros) | Media `error` event → toast "format can't play in-app" + `open_path` escape hatch; mp3/mp4/webm treated as first-class |
| YT titles defeat lyric matching ("Song (Official Video)") | `parse_title_artist` strips decoration; `/api/search` fallback; manual override form is the guaranteed exit |
| Very large libraries (1k+ rows) | Plain scroll list acceptable at v1 scale; virtualization noted as future work |
