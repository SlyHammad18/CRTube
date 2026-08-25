# CRTube — Design & Build Specification

A YouTube downloader desktop app. Rust + Tauri v2 shell, React + TypeScript UI, powered by `yt-dlp` (auto-installed, auto-updated) and static `ffmpeg` (installed once).

**Design thesis:** *cathode-ray-tube nostalgia fused with modern dark-tech.* The name is the identity — one signature idea (the "power-on" moment, §3) carries the whole UI.

**Design dials:** `VARIANCE 6 · MOTION 7 · DENSITY 4`

**Locked decisions**

| Decision | Choice |
|---|---|
| Frontend | React 18 + TypeScript + Vite |
| Accent | Ice cyan `#4DD8FF` |
| Packaging targets | Linux (deb, AppImage) + Windows (NSIS) |

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Shell | **Tauri v2** (Rust) | Requested |
| Frontend | **React 18 + TypeScript + Vite** | Mature Tauri ecosystem, matches motion/styling tooling |
| Styling | **Tailwind CSS v4** via `@tailwindcss/vite` | Token-driven utilities, no postcss plugin needed for v4 |
| Motion | **Motion** (`motion/react`) | Springs, layout animations, `AnimatePresence` |
| Icons | **@phosphor-icons/react** | One icon family only; global stroke width 1.5 |
| Fonts | **Self-hosted `@fontsource/*`** | Desktop app → zero runtime font CDN requests |
| State | **Zustand** | Queue / settings / library / search stores |
| DB | **rusqlite** (bundled SQLite) | Download history persistence |
| HTTP | **reqwest** (rustls-tls) | Fetch yt-dlp releases, ffmpeg bundles, thumbnails |
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
- The only gradient allowed: `#4DD8FF → #38E0C8`, reserved for the boot logo sheen and nothing else.
- No pure `#000000`, no pure `#FFFFFF`.
- Shadows are tinted to the background hue (`0 8px 24px rgba(0,0,0,.35)`), never pure black on panels.

### 2.2 Typography — three roles

| Role | Face | Weights | Usage |
|---|---|---|---|
| Display | **Chakra Petch** | 600 / 700 | Wordmark, headings, quality chips — squared techno grotesk |
| Body/UI | **Manrope** | 400–600 | Titles, labels, body copy |
| Telemetry | **JetBrains Mono** | 400 / 500 | Durations, sizes, speeds, versions, ETAs |

Rules:

- **Everything numeric is mono.** File sizes, percentages, timestamps, version strings.
- Type scale: `12 / 13 / 15 / 18 / 24 / 32`.
- Display headings: tight tracking (`tracking-tight`), no all-caps eyebrows except the titlebar telemetry readout.
- Italic/bold emphasis within a headline uses the same family — never inject a second display face.

### 2.3 Shape & elevation

- Radius lock: **10px** everywhere — cards, inputs, buttons, sheets.
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

## 3. Signature Element — "Power-On"

Every launch plays a 700ms CRT boot sequence:

1. Screen flicker (opacity keyframes),
2. Horizontal scanline sweep,
3. `CRTUBE` logotype resolves with brief chromatic split (`#4DD8FF → #38E0C8` sheen),
4. Dissolve; app content scales `0.98 → 1`.

Echoed quietly elsewhere so the motif stays coherent without repeating itself loudly:

- Fixed scanline overlay at 3% opacity, `pointer-events-none`, z-index layer documented in code.
- Titlebar telemetry readout in JetBrains Mono: `● ytdlp 2026.08.20 · ready`. Status dot: `ice` = ready, `amber` = updating tools, `signal` = error.
- Empty states written as console prompts: `> awaiting input_`, `> nothing archived yet_`.

**Reduced motion:** the entire signature collapses under `prefers-reduced-motion` — instant crossfade instead of flicker, scanline overlay rendered static.

---

## 4. Screens

### 4.1 App shell

```
┌──────────────────────────────────────────────────────────┐
│ ◉ CRTUBE   ● ytdlp 2026.08.20·ready          ─  □  ✕    │ ← 40px custom titlebar
├────┬─────────────────────────────────────────────────────┤
│ ⌕  │                                                     │
│ ⇩³ │                MAIN VIEW                            │
│ ▦  │              (animated swap)                        │
│    │                                                     │
│ ⚙  │                                                     │
└────┴─────────────────────────────────────────────────────┘
```

- **Titlebar (40px):** full-width drag region (`data-tauri-drag-region`). Left: logo mark + telemetry readout. Right: minimize, maximize, close — close hover fills `signal`. Double-click toggles maximize.
- **Icon rail (64px):** Search/home, Downloads (badge = active count), Library; Settings pinned bottom. Active view gets an `ice` left notch + subtle icon tint.
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
│  │ Title… │ │ Title… │ │ Title… │ │ Title… │             │
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

### 4.7 First-run setup overlay

Full-screen overlay before any search is possible: "Calibrating display…" — two real progress bars (`yt-dlp`, `ffmpeg`) fed by installer progress events, then auto-dismisses into the boot sequence's tail. Blocks interaction until tools are ready.

---

## 5. Backend Architecture

```
src-tauri/src/
├─ lib.rs            # builder, plugins, managed state, event wiring
├─ commands/
│  ├─ tools.rs       # ensure_tools, tool_versions, update_ytdlp(force)
│  ├─ search.rs      # search_youtube(query, page), fetch_info(url)
│  ├─ download.rs    # start_download(opts) -> job_id, cancel_download(id)
│  ├─ library.rs     # list_library, add_entry, delete_entry, reveal_path
│  └─ settings.rs    # get_settings / set_settings (JSON)
├─ services/
│  ├─ installer.rs   # GitHub release fetch, sha256 verify, atomic replace
│  ├─ ytdlp.rs       # arg builders + progress-line parser (pure, unit-tested fns)
│  └─ db.rs          # rusqlite migrations
└─ jobs.rs           # Mutex<HashMap<job_id, Child>> process registry
```

### 5.1 Events (backend → frontend)

| Event | Payload |
|---|---|
| `tools://progress` | `{tool, stage, pct}` — installer/setup bars |
| `tools://status` | `{state: "updating" \| "ready" \| "error"}` — titlebar dot |
| `dl://progress` | `{id, pct, speed_bps, eta_s, downloaded, total}` |
| `dl://done` | `{id, path}` |
| `dl://error` | `{id, message}` |

### 5.2 Commands

`ensure_tools · tool_versions · update_ytdlp · search_youtube · fetch_info · start_download · cancel_download · list_library · delete_entry · reveal_path · pick_folder · get_settings · set_settings`

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

Settings persisted as JSON at `{app_config}/settings.json`: `{ download_dir, concurrent, autoupdate_ytdlp, filename_template }`.

### 5.6 Security & capabilities

Minimal Tauri capability set: dialog, opener, core window permissions. The frontend never touches the fs plugin — file ops happen Rust-side; paths cross the bridge as strings only. No secrets involved; GitHub API used unauthenticated (rate limits acceptable for a desktop client).

---

## 6. Frontend Structure

```
src/
├─ main.tsx / App.tsx        # providers, router shell, boot gate
├─ theme.css                 # Tailwind v4 tokens (@theme), fonts, scanlines
├─ components/
│  ├─ titlebar/              # drag region, telemetry, window buttons
│  ├─ rail/                  # nav rail + active notch
│  ├─ boot/                  # power-on sequence overlay
│  ├─ search/                # hero dock, result cards, skeletons
│  ├─ sheet/                 # format slide-over
│  ├─ downloads/             # queue rows, progress bars
│  ├─ library/               # grid/list, filters, action rows
│  ├─ settings/              # sections
│  └─ common/                # toast stack, pills, empty states, confirm popover
├─ stores/                   # zustand: queue, settings, library, search, ui
├─ lib/
│  ├─ ipc.ts                 # typed command wrappers + event listeners
│  └─ format.ts              # bytes/duration/ETA formatters (mono output)
└─ types/                    # shared DTOs mirroring Rust serde structs
```

Motion rules (project-wide):

- Animate only `transform` and `opacity`.
- Springs for interactive elements (`stiffness 300, damping 22` range); eased curves for entrances.
- Stagger children via variants, not per-item timers where avoidable.
- All motion gated behind `useReducedMotion()` / media query collapse.

---

## 7. Task Breakdown

Each task ends with its verify gate run and passing **before** the next task begins.

### T1 — Scaffold & shell
Tauri v2 + React-TS + Tailwind v4 project; frameless window config; custom titlebar (drag region, min/max/close, double-click maximize); icon rail + view routing; full token system in `theme.css` incl. @fontsource fonts; boot overlay stub.

**Verify:** `cargo clippy` clean, `npm run build` clean, `npm run tauri dev` → frameless dark window, all three window buttons work, rail switches placeholder views, boot flicker plays once.

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
View transitions, spring hovers, toast stack animation, boot sequence refinement, scanline overlay, empty/error-state audit (offline search, bad URL, failed download), copy audit, reduced-motion collapse verified.

**Verify:** walkthrough with reduced-motion ON and OFF; screenshot review of every screen + every empty/error state; contrast spot-checks pass WCAG AA.

### T11 — Hardening & packaging
Error-path matrix (no network at boot, yt-dlp update failure, disk full, region-blocked video), long/unicode filename sanitization, duplicate-download guard, app icon, bundler configs: deb + AppImage (Linux), NSIS (Windows).

**Verify:** `npm run tauri build` produces installable artifacts; each error scenario shows a friendly inline/toast message, never a crash.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| YouTube breaks yt-dlp extraction | Auto-update on every launch is a core feature, not an afterthought |
| `yt-dlp -U` blocked by permissions | Always replace binary atomically via GitHub releases, never self-update |
| Static ffmpeg URLs rot | URLs isolated as constants in `installer.rs`, checksummed downloads |
| IP blocks / rate limiting | Surface yt-dlp's own error text in friendly toasts; retry affordance |
| Partial files on crash/kill | `.part` cleanup on cancel/error; temp-write → atomic rename pattern everywhere |
