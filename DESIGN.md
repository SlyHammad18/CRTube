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
- **Urdu/Arabic-script lyrics** render in **Noto Naskh Arabic** by default (`--font-urdu`) with **≈2.3× leading** (`.font-urdu` overrides the Latin text-token leading; the 220px floating overlay caps at 1.9×), an 18px body, and a **24px active line** (karaoke hierarchy; Latin lines stay equal-size) — sizes are user-configurable (Settings → Lyrics, `lyrics_size_latin` / `lyrics_size_urdu`, applied inline per line). Lines flow RTL (`dir="rtl"` — the ice caret bar moves to the right edge and grows with the active line). The face is selectable in Settings → Lyrics (`urdu_font`): bundled **Naskh** (default) or **Custom…** — any font file the user picked themselves (ttf/otf/woff/woff2), copied into `{app_data}/fonts/`, served via the loopback server, and loaded as a runtime FontFace with a `400–900` weight range (prevents faux-bold smearing). No Nastaliq face is bundled and nothing is auto-downloaded — Urdu users bring their own Nastaliq (e.g. Jameel Noori Nastaleeq).

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
- Titlebar telemetry readout in JetBrains Mono, top-right before the window controls: boot shows `checking for updates` (pulsing `ice` dot) → `updating yt-dlp` (amber dot) **only while a download is actually running** (check-then-update — a no-op check never says "updating") → the busy label lingers ~2s after completion, then the chip **hides entirely** (no permanent version readout). `update failed` (signal dot) persists until handled. Click opens Settings.
- Empty states written as console prompts: `> awaiting input_`, `> nothing archived yet_`.
- The Player surface echoes the broadcast motif with the **Caption Deck** (§4.8) — synced lyrics set like closed-captioning.

**Reduced motion:** the scanline overlay renders static and no animation of the motif runs under `prefers-reduced-motion`.

---

## 4. Screens

### 4.1 App shell

```
┌──────────────────────────────────────────────────────────┐
│ ◉ CRTUBE                                     ─  □  ✕    │ ← 40px custom titlebar
├────┬─────────────────────────────────────────────────────┤
│ ⌂  │                                                     │
│ ♪  │                MAIN VIEW                            │
│ ⇩³ │              (animated swap)                        │
│ ▦  │                                                     │
│    ├─────────────────────────────────────────────────────┤
│ ⚙  │ PLAYERBAR (64px, global — appears when queue ≠ ∅)   │
└────┴─────────────────────────────────────────────────────┘
```

- **Default view on launch: `home`.**
- **Titlebar (40px):** full-width drag region (`data-tauri-drag-region`). Left: logo mark + telemetry readout. Right: minimize, maximize, close — close hover fills `signal`. Double-click toggles maximize.
- **Icon rail (64px):** Home (`House`), **Player** (`MusicNote`), Downloads (badge = active count), Library; Settings pinned bottom. There is **no dedicated Search tab** — search lives inside Home and the Player tab (§4.2). Active view gets an `ice` left notch + subtle icon tint. While audio plays, a 4px `ice` dot under the Player icon pulses (opacity keyframes; static dot under reduced motion).
- View transitions: fade + 8px rise in (240ms, `cubic-bezier(0.16,1,0.3,1)`), fade out (120ms), orchestrated with `AnimatePresence` (exit collapses to ~instant under WebKitGTK for perf).

### 4.2 Home + Player search (unified results)

Search is a first-class flow in **two entry points** — the Home dashboard and the Player
tab — sharing one data layer and one results model:

```
│            ┌───────────────────────────────┐             │
│            │ ⌕ Paste a link or search…  ↵ │ ← dock      │
│            └───────────────────────────────┘             │
│              recent: lofi mix · synthwave …              │
│                                                          │
│  LIBRARY · 3 matches                                     │
│  ┌────────┐ ┌────────┐ ┌────────┐                        │
│  │ thumb  │ │ thumb  │ │ thumb  │ ← local copies         │
│  └────────┘ └────────┘ └────────┘                        │
│  YOUTUBE · 20                                            │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐             │
│  │ thumb  │ │ thumb  │ │✓in lib │ │        │             │
│  │ 12:04▓ │ │        │ │        │ │        │             │
│  │ Title… │ │ Title… │ │ Title… │ │        │             │
│  │ Ch ·1M │ │        │ │        │ │        │             │
│  └────────┘ └────────┘ └────────┘ └────────┘             │
```

- **Home:** the dock sits under the greeting; when a query is active the results grid
  replaces the dashboard sections (✕ clears and restores the dashboard). Empty-library
  CTA focuses the dock.
- **Player tab:** the ContextHeader carries a ⌕ button; while searching, the middle pane
  swaps to a search pane (auto-focused compact dock + results as compact rows). Library
  matches filter live as you type; `Enter` commits the YouTube search. `Escape` returns to
  the previous context (playlist/artist/favourites) fully intact. The dock owns the only
  ✕ in the bar — it clears the text when there is text and closes the pane when empty
  (no second ✕ beside the dock). Pasted URLs route to the format sheet instead of
  searching.
- **Unified results:** matching library tracks (title/channel contains) under a mono
  `LIBRARY` header first — click plays the local file with its library matches as the
  play context — then `YOUTUBE` results (20/page, infinite scroll, skeleton shimmer,
  console-prompt error/empty states).
- **Click = play (audio)** in the main player (PlayerBar + Now Playing pane). A YouTube
  result plays as a **live stream** through the loopback relay (§5.6) — no download
  required; an already-downloaded videoId plays the local copy (full quality). A
  monitor-play button plays it as **video** instead (also live).
- Hover pre-resolves the stream backend-side (400ms, latest-result-only) so click-to-play
  starts near-instantly; `preload="auto"`; streams capped at 360p muxed H.264 (fastest
  start), audio kind prefers AAC.
- **Download stays independent:** the Download pill/row action opens the Format Sheet
  (§4.3) — download audio or video whether or not it is playing.
- Already-downloaded results show a persistent ✓ "in library" badge. The `＋` action
  adds to a playlist — for not-yet-downloaded results this **auto-downloads** (§4.8).

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
- Footer: destination path chip (click → inline folder picker) + **PLAY** (secondary — plays this tab's flavor now in the main player: local copy if in library, else live stream; live streams disabled) + primary DOWNLOAD button.
- On queue: sheet closes, toast confirms `Added to queue`.

### 4.4 Downloads

- Rows: mini thumbnail, title, 4-phase strip (`prepare · download · process · save`), `ice` progress bar with moving sheen highlight, mono stats line `8.2 MB/s · ETA 00:31 · 47%`, cancel ✕.
- Progress bar width driven by a Motion value (not React state churn).
- Completed: check flash on the row, then item moves out to Library automatically.
- Queue owned by frontend store; concurrency limit from settings (default 3). Queued rows dimmed with position number.
- Cancel kills the process backend-side; partial files removed.

### 4.5 Library

- Header stats in mono: `142 items · 38.4 GB`; filter pills `(All)(Audio)(Video)`; library-local search field; grid/list density toggle.
- Grid cards: thumbnail with corner type icon (music note / film), duration, size, date added.
- Row/card hover actions: ▶ Open (default player), ⌗ Reveal (file manager), 🗑 Delete with confirm popover (removes file + DB row).
- Files that vanished from disk flip to "missing" status styling instead of silently breaking.
- Empty state: `> nothing archived yet_` + CTA to Home (search dock).

### 4.6 Settings

Grouped sections, bound live (no restart required):

- **Storage:** download path picker + "open folder".
- **Engine:** yt-dlp version + *Check for update* button; ffmpeg version; auto-update-on-launch toggle (default ON).
- **Downloads:** concurrency stepper (1–5), applies immediately to the running queue.
- **Lyrics:** Urdu font selector — bundled Naskh (default) or Custom… (any user-picked font file, copied into the app-owned cache); lyric size steppers for English (12–32 px, default 15) and Urdu (14–40 px, default 18 — active line ×4⁄3).
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
- Empty states (console-prompt style): `> awaiting media_ search something to play` / `> this playlist is empty_ add tracks with +`.
- **Search mode:** the header's ⌕ swaps this pane for the unified search pane (§4.2, rows variant).

**Playlists view** (a sidebar playlist selected): same list plus total-runtime header chip (mono) + primary **PLAY ALL** button. Rows gain a grip handle and support **drag-to-reorder** via Motion `Reorder.Group/Item` (spring physics, `layout` animation, reduced-motion collapse); order persists through `reorder_playlist_items`. Duplicate adds are silent no-ops (`UNIQUE(playlist_id, download_id)`).

**Add-to-playlist auto-download:** the `＋` popover accepts two target kinds. A library track behaves as before (checkmark toggles membership). A **YouTube search result** (or a currently-streaming track) opens an inline quality chooser — **MP3 audio: Best (≈320) / 192 / 128** and **Video MP4: 1080p / 720p / 480p** — then queues the download at the chosen quality with the playlist attached; the queue store adds the finished download to the playlist automatically (`Downloading — will be added to "X"` toast). If the videoId is already in the library at the requested kind, it attaches instantly without downloading.

**Now Playing pane (320px, collapsible via `PanelRight` toggle, state in ui store)**

- Artwork frame: radius 10 + scanline overlay; shows cached thumbnail. For video tracks (downloaded or streamed), the live `<video>` element overlays this frame (positioned by MediaHost over `#nowplaying-media-slot`, §4.9 — never reparented). A pencil edit control appears only while the artwork frame is hovered (and on keyboard focus) for library tracks; it opens a native image picker and replaces the displayed artwork without modifying the downloaded media file.
- **Stream tracks** (played from a search result without downloading): the title row carries an always-visible **stream-kind toggle** (`audio ⇄ video` — re-resolves the other stream, position preserved), a **Download** button (opens the Format Sheet — download while playing, independent of playback) and `＋` (auto-downloading add, below). The fullscreen button appears on the artwork frame (hover) while the stream kind is video. Favourite/rename are library-only and hidden. Stream picture is **not** governed by `videoDisabled`/the "disable video playback" setting — the kind toggle is the picture control.
- Title (Chakra Petch 24, 2-line clamp) + channel (Manrope, `mute`).
- Seek bar: 2px `line` track, `ice` fill, grows to 4px on hover; flanking times in mono (`0:00` elapsed / `-3:41` remaining toggleable by click).
- Transport row: shuffle · previous · **play/pause (44px `ice` circle, `void` icon — the only filled accent circle in the app)** · next · repeat (cycles off → all → one; `one` shows mono superscript `1` badge).
- Secondary row: volume slider (icon + thin slider) and **SpeedMenu** popover: `0.50× 0.75× 1× 1.25× 1.5× 1.75× 2×` mono pills, current selection `ice` fill; the `[`/`]` shortcut steps ±0.05× anywhere inside the 0.25–4× range, and an off-preset value gets its own checked row above the presets (so the menu never shows no selection). Volume + speed persist in settings (§5.5).

**Caption Deck — synced lyrics (the Player's signature motif)**

- Fills the remainder of the Now Playing pane. Inner line-track translates vertically so the active line holds center; mask-image fade top/bottom edges; only `transform` animates.
- Line states: past lines `dim` at 45% opacity · **active line `ink`, Chakra Petch, 4px `ice` caret bar on the left edge** · upcoming lines `mute`.
- Click any line → seek to its timestamp (spring feedback on the deck).
- Deck header: pencil (opens the LRCLIB edit/replace modal) · **per-song delay control** — `−`/`+` 50ms nudges flanking a mono text field showing the current offset (`+0.05s`); the field is editable, so the delay can be typed exactly (seconds by default — `0.5`, `-1.25` — or with an `ms` suffix, e.g. `250ms`), `Enter`/blur applies, `Escape` reverts without closing the dock/fullscreen behind it; values clamp to ±100s and persist per-song (§5.7) · PictureInPicture toggle for the floating lyrics window (§4.10) · expand-to-fullscreen.
- Fallback ladder: synced LRC → plain text (static scrollable block, same typography, no caret) → `instrumental` flag renders an `INSTRUMENTAL` status tag → no result: console prompt `> no lyrics found_ try manual search` with an inline artist/title override form prefilled from parsed metadata (§5.7).
- Lyrics fetch lazily on first play of a track; cached hits render instantly (§5.7).

**Keyboard map (global, ignored while focus is in a text-editable field):** `Space` play/pause · `←/→` seek ∓1s · `↑/↓` volume ±1% (unmutes on raise) · `m` mute/unmute · `[`/`]` speed ∓0.05× · `,`/`.` next/previous track · `l` toggle lyrics dock · `r` cycle repeat · `s` toggle shuffle · `Ctrl+N` new playlist · `F2` rename selected playlist (else edit the playing song).

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
- **Media host contract:** exactly one `<video>` DOM node lives in a persistent `MediaHost` mounted at shell level. The node is **never reparented** — under WebKitGTK's GStreamer video sink, moving a `<video>` to a new DOM parent tears down the native compositing surface and blacks out / kills controls on Linux. Instead the single node stays mounted at app root and is *positioned over the active stage via CSS* (`top/left/width/height` from the target slot's measured rect, `object-fit` cover/contain). Slots `#nowplaying-media-slot` (Player tab artwork frame), `#playerbar-media-slot` (bar thumb), and the fullscreen stage are pure measurement placeholders; a rAF loop + ResizeObserver keeps the node tracking the stage through view transitions and the PlayerBar spring. Playback (audio included) is continuous across every view and fullscreen — the video keeps playing (picture shrinks into the bar) exactly like audio does. The same element also serves **live stream tracks** (§4.2): the source URL is the loopback relay's `/stream/{v|a}/{videoId}` route, and an expired signed upstream re-resolves once silently with position preserved.
- Audio-only tracks never show video — the node hides (`visibility:hidden`, never `display:none`) while still decoding audio.

### 4.10 Floating Lyrics Window

- The Caption Deck's `PictureInPicture` control opens one optional, frameless
  `lyrics-overlay` Tauri webview. It is fully opaque — a bordered panel filling
  the window, with no transparent margin or rounded corners: an alpha surface
  flickers on XWayland while WebKit repaints during playback, so the window is
  created `.transparent(false)` with an opaque background. It is
  excluded from the taskbar, non-focusable, does not steal focus when opened,
  and remains always-on-top across normal application windows. On Linux, the app
  prefers XWayland (`GDK_BACKEND=x11,wayland`) because GTK3's native Wayland
  keep-above implementation is a no-op; XWayland supplies the EWMH
  `_NET_WM_STATE_ABOVE` state. The X11 overlay also removes `WM_TAKE_FOCUS`
  from `WM_PROTOCOLS`: GTK advertises it even when `WM_HINTS.input` is false,
  and Mutter otherwise treats the sticky overlay as a workspace focus
  candidate. The native topmost hint is reasserted after focus loss, move,
  resize, and DPI transitions without activating or focusing the window.
- Default logical size is `420 × 220` (user-resizable within `360–520 × 190–320`).
  The compact surface shows the previous/current/next synced line, plain-text or
  instrumental fallbacks, track identity, and mono elapsed/total time. A thin
  seek timeline above the footer supports click, drag, and keyboard seeking.
  Its footer exposes icon-only transport, shuffle/repeat, favourite, playlist,
  and mute controls; each command is forwarded to the main player rather than
  creating a second playback owner.
- The title bar is the drag handle. After movement settles, each axis magnetically
  snaps to left/center/right or top/middle/bottom within 24px, yielding all nine
  corner/edge/screen anchors. Released positions away from an anchor remain free.
- Enabled state and physical position persist atomically in
  `{app_config}/lyrics-overlay.json`, separate from frequently-written player
  settings. Restored coordinates are validated against current monitor work areas.
- Playback stays owned by the main webview. The overlay polls a lightweight Rust
  snapshot, interpolates between positions, and reuses the same cached lyrics and
  per-song offset; it never creates or reparents a second media element. State
  pushes are sequence-numbered and coalesced, carry their sample time, and are
  advanced authoritatively in Rust between samples so late IPC responses cannot
  rewind the overlay clock or build an unbounded command backlog.

### 4.11 Search playback & the stream relay

The former floating preview popup is **removed** — its "play before download" role is
now the main player itself (§4.2): clicking a search result plays it in the PlayerBar /
Now Playing pane via the single media element. The supporting machinery is unchanged:

- **Fast startup (web.dev fast-playback guidance):** the stream URL is *prefetched* —
  hovering a result (400ms, latest-result-only) or lingering on a sheet tab pre-resolves
  it backend-side into the `StreamSessions` cache, so the 2–5s yt-dlp extraction happens
  before the click. Stream video is capped at **360p** (H.264/AAC muxed — the
  fastest-starting stream YouTube serves), audio kind prefers AAC; `preload="auto"`.
- **Single decode policy:** the main player's one `<video>` element plays streams and
  downloaded files alike (§4.9) — there is no second media element anywhere. When a new
  track or stream kind is requested, the previous source is **stopped immediately**
  (pause + src reset) and a `buffering` state shows a **`BufferBadge`** — a full-cover
  veil over the Now Playing artwork (rotating arc ring + mono `BUFFERING`, transform-only
  motion, reduced-motion collapse) and an inline badge in the PlayerBar. Truth model: the
  flag rises on source-resolve start and on `waiting` (only while playing); it falls on
  `loadeddata` (first decoded frame), `canplay`, `playing`, **`seeked`**, resolve failure,
  when the store's `playing` goes false, and via a `timeupdate` backstop (frames advancing
  + readyState ≥ 2 ⇒ clear — WebKitGTK resumes stalled seeks by firing ONLY `seeked` with
  readyState parked at HAVE_CURRENT_DATA, so `canplay`/`playing` never refire). The
  element's own `pause` event is deliberately unused — those queue as tasks and would
  race the resolve flag.
- **Stream failure semantics:** expired signed URLs re-resolve once silently (below).
  If a **video** stream has no muxed (directly playable) format — increasingly common on
  YouTube — the kind silently reverts to the audio stream with a
  `Video stream unavailable…` toast instead of skipping the track (audio failures still
  advance). This also removes the staged-black-rectangle state a failed kind toggle
  used to leave behind.
- **Stream lifecycle:** results resolve through `stream_media_url` → `StreamSessions`
  (30-min TTL, single-flight, live broadcasts rejected) → the loopback relay's
  `/stream/{v|a}/{videoId}` route (UA/Referer-injected upstream, Range passthrough).
  The relay **follows the upstream's redirect chain** (up to 5 hops, headers re-applied,
  final URL written back into the session): googlevideo intermittently 302s requests to
  a different CDN edge (`rrN---sn-*`), and an unfollowed redirect reaches the element as
  a 502 — killing playback and every seek after it.
  Expired signed URLs (relay 502 → element error) re-resolve **once silently with the
  playhead preserved**; a second failure toasts `Stream failed` and advances.
- **Downloads stay independent of playback** at every point: result rows/cards, the Now
  Playing pane, and the Format Sheet all reach the same queue (§4.3).

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
│  ├─ settings.rs    # get_settings / set_settings (JSON), pick_urdu_font, urdu_custom_font_url
│  ├─ lyrics_overlay.rs # floating window lifecycle, prefs, magnetic snap, snapshot
│  └─ player.rs      # playlists CRUD, fetch_lyrics, media_url
├─ services/
│  ├─ installer.rs   # GitHub release fetch, sha256 verify, atomic replace
│  ├─ ytdlp.rs       # arg builders + progress-line parser (pure, unit-tested fns)
│  ├─ lyrics.rs      # LRCLIB client + cache (pure helpers, unit-tested)
│  ├─ lyrics_overlay.rs # atomic prefs + pure magnetic-snap helpers
│  ├─ media.rs       # loopback Range-capable media streamer (pure helpers, unit-tested)
│  ├─ fonts.rs       # user-picked font cache helpers (dir + font magic checks, unit-tested)
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
pick_track_thumbnail(app, db, id) -> Option<LibraryEntry>  -- app-only custom artwork
get_lyrics_overlay_prefs(app) -> LyricsOverlayPrefs
set_lyrics_overlay_enabled(app, enabled) -> LyricsOverlayPrefs
snap_lyrics_overlay(app) -> OverlayPosition
lyrics_overlay_snapshot(db, mpris) -> Option<LyricsOverlaySnapshot>
                                                              -- entry is a tagged union:
                                                              -- {trackKind:"library"} = DB row,
                                                              -- {trackKind:"stream"} = live stream
                                                              -- (identity = video id; favourite/
                                                              -- playlist controls hidden)
fetch_lyrics(app, video_id, title, channel, duration_s) -> Option<LyricsPayload>
-- LyricsPayload { synced, plain, instrumental, track_name, artist_name, cached }
 media_url(db, server, id) -> Option<String>                  -- loopback stream URL for a download
 stream_media_url(server, video_id, kind, force) -> String    -- pre-download preview: resolve a direct
                                                              -- upstream stream into StreamSessions and
                                                              -- return its loopback proxy URL
 pick_urdu_font(app) -> {file, label}                        -- native dialog → copy the picked font
                                                              -- into {app_data}/fonts/ (magic-checked)
 urdu_custom_font_url(server) -> String                      -- loopback URL for the persisted custom
                                                              -- Urdu font (runtime FontFace)
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
--progress-template "download:PROG|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s" \
-P {download_dir} -o "{title} [{id}].{ext}"
```

- Progress lines parsed in Rust by a pure function (unit-tested) → emitted as `dl://progress`. Template emits `downloaded_bytes` + `total_bytes` + `total_bytes_estimate`; parser prefers the exact total, then the estimate, then the probe `expected_size` from the format sheet; `pct` is clamped monotonically so estimates never make the bar regress. Stage is richer than a bare percent: `preparing → downloading (stream n/m) → merging / extracting audio / embedding tags → finalizing`. Rows show a compact 4-step strip (`prepare · download · process · save`), and when no total is known at all (yt-dlp `NA` + no probe size) the bar renders an indeterminate pulse with a live bytes/speed readout instead of a frozen `%`.
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

Later additive migration v6 stores per-track app artwork as
`downloads.custom_thumb_path TEXT`; `thumb_url` remains the original YouTube/cache
source so a custom cover never destroys the downloaded thumbnail.

Settings persisted as JSON at `{app_config}/settings.json`: `{ download_dir, concurrent, autoupdate_ytdlp, filename_template, player_volume, player_speed }` — the two new fields carry serde defaults (`1.0`), so pre-v0.2 files load unchanged.

### 5.6 Security & capabilities

Minimal Tauri capability set: dialog, opener, core window permissions. The main and `lyrics-overlay` labels share the existing drag/close window permissions; monitor geometry, persistence, and position mutation stay Rust-side. The frontend never touches the fs plugin — file ops happen Rust-side; paths cross the bridge as strings only. No secrets involved; GitHub API used unauthenticated (rate limits acceptable for a desktop client); LRCLIB is keyless.

**Media serving.** WebKitGTK's media pipeline (GStreamer) cannot fetch from custom URI schemes, so the asset protocol can serve thumbnails but not playback. Downloaded audio/video is instead streamed by a loopback-only HTTP server (`services/media.rs`, tokio, no new crates):

- Binds `127.0.0.1:0` (ephemeral port) at startup; URLs look like `http://127.0.0.1:{port}/{token}/{download_id}`.
- The token is a per-session SHA256 nonce — first path segment, constant-time-compared.
- Files are addressed strictly by `downloads.id`; paths resolve server-side from the DB and are re-validated against canonicalised allowed roots (the effective download dir, updated on `set_settings`). No client-supplied paths, no traversal surface.
- Full HTTP Range support (`206 Partial Content`, `Accept-Ranges: bytes`) so seeking works; `HEAD` honored.
- **Pre-download stream previews** (`/{token}/stream/{v|a}/{video_id}`): `stream_media_url` resolves a *muxed* progressive format (H.264/AAC preferred, height ≤ 360 for fast startup — audio previews use bestaudio/m4a) via the pinned probe invocation, caching the URL + its `User-Agent`/`Referer` in a `StreamSessions` map (30 min TTL; hover/sheet prefetch populates it before the click). The proxy relays `Range` requests upstream with those headers and pipes the response through; upstream 403/410 (signed-URL expiry) answers 502 and the preview popup silently re-resolves once (position preserved). Playback lives in the popup's own element (§4.11) — the main player's queue, session, and lyrics state are never touched, and nothing is written to disk.
- **Fonts route** (`/{token}/fonts/{name}`): serves the app-owned `{app_data}/fonts/` cache (the on-demand Jameel Noori Nastaleeq for Settings → Lyrics). Name is validated (`[A-Za-z0-9._-]`, no leading dot / `..`), the response carries `Access-Control-Allow-Origin: *` (webview font fetches are CORS-mode, unlike `<img>`), and file paths resolve server-side only.

The static asset-protocol scope stays minimal (`$APPDATA/thumbs/**`, `$APPDATA/bin/**`) for cover art; a runtime `allow_directory` for the download root is still applied (harmless, useful for any `<img>` use), but playback never depends on it.

### 5.7 Lyrics service (LRCLIB)

Endpoints (no key, no rate limit):

```
GET https://lrclib.net/api/get?artist_name={a}&track_name={t}&duration={s}
GET https://lrclib.net/api/search?track_name={t}&artist_name={a}   # structured search
GET https://lrclib.net/api/search?q={query}                        # free-text search
→ 200 { id, trackName, artistName, duration, instrumental,
        plainLyrics, syncedLyrics }                  # syncedLyrics = LRC text
```

Flow inside `fetch_lyrics(app, video_id, title, channel, duration_s)`:

1. Cache-first: return `{app_data}/lyrics/{video_id}.lrc` (synced) or `.txt` (plain) if present, `cached: true`.
2. Derive search terms with pure fn `parse_title_artist(title, channel)` — splits `"Artist - Title"` patterns, strips parenthetical noise (`(Official Video)`, `[HD]`…); falls back to artist = cleaned channel (`- Topic`/`VEVO` suffixes stripped, junk rejected → empty).
3. Staged chain, each stage gated by pure fn `pick_best(results, duration_s)` (min duration delta ≤ 3s, prefer entries with `syncedLyrics`); a stage that errors is remembered but never aborts the chain:
   1. `/api/get` with the exact (track, artist) and duration
   2. `/api/search?track_name&artist_name` — structured search (best signal)
   3. `/api/search?q="{track} {artist}"` — song name + artist free text (song name only when no artist)
4. Persist atomically (temp-write → rename) into the lyrics cache; return payload.

The manual lyrics search modal (`search_lyrics`) reads the query structurally, merging results best-first: free-text `q=` → dash-split (`Artist - Song`, both readings) as structured `track_name`/`artist_name` searches → bare multi-word queries tried at every 2-way word split as (track, artist) then (artist, track) → contiguous sub-phrases as free-text queries, longest first (rescues tracks recorded under different metadata, e.g. "Tera Woh Pyar (Nawazishein Karam)"). Near-duplicates collapse; the merged list caps at 60.

Frontend owns LRC rendering: pure TS `lib/lrc.ts` — `parseLrc(text) -> [{tMs, s}]` sorted (multiple timestamps per line supported) and `activeIndex(lines, tMs)` pointer-walk against `<video>.currentTime`. Both pure and unit-testable.

---

## 6. Frontend Structure

```
src/
├─ main.tsx / App.tsx        # providers, router shell, PlayerBar + MediaHost mount
├─ theme.css                 # Tailwind v4 tokens (@theme), fonts, scanlines, caption-deck utils
├─ components/
│  ├─ titlebar/              # drag region, telemetry, window buttons
│  ├─ rail/                  # nav rail (home/player/downloads/library + settings) + active notch
│  ├─ search/                # SearchDock (home hero + player pane), SearchResults (grid+rows),
│  │                         # ResultCard, skeletons — unified library+YouTube results
│  ├─ sheet/                 # format slide-over
│  ├─ downloads/             # queue rows, progress bars
│  ├─ library/               # grid/list, filters, action rows
│  ├─ player/                # PlayerTab, SearchPane, PlaylistsPane, TrackList/Row, NowPlaying,
│  │                         # CaptionDeck, Transport, SeekBar, SpeedMenu, VolumeSlider,
│  │                         # AddToPlaylistMenu (library + auto-download stream targets)
│  ├─ player-bar/            # global PlayerBar + MediaHost (slot positioning, stream sources)
│  ├─ lyrics-overlay/         # always-on-top lightweight lyric webview
│  ├─ settings/              # sections
│  └─ common/                # toast stack, pills, empty states, confirm popover
├─ stores/                   # zustand: queue, settings, library, search, ui,
│                            #           player, playlists, lyricsOverlay
├─ lib/
│  ├─ ipc.ts                 # typed command wrappers + event listeners
│  ├─ lrc.ts                 # pure LRC parser + active-line finder
│  ├─ playResult.ts          # click-to-play: local copy else live stream
│  ├─ download.ts            # DownloadRequest builder (sheet + playlist auto-download)
│  └─ format.ts              # bytes/duration/ETA formatters (mono output)
└─ types/                    # shared DTOs mirroring Rust serde structs
```

Player store (`stores/player.ts`) shape:

```
queue: PlayableTrack[]       // LibraryEntry (downloaded) | StreamTrack (live stream)
order: number[]              // permutation — shuffled or linear
pos: number                  // index into order
playing, currentTimeS, durationS, muted
repeat: 'off'|'all'|'one'    shuffle: boolean
context: {type:'library'|'playlist', id?} | null
actions: playAll(entries,start) playStream(item,kind) setStreamKind(kind) enqueue
         toggle next prev cycleRepeat toggleShuffle(current stays first)
         setSpeed setVolume seek onEnded onError
```

Advance rules: `onEnded` honors repeat-one (seek 0) → repeat-all (wrap) → off (stop at queue end); `next()` manual always advances; both skip `status === 'missing'` entries (streams are never "missing"); media `error` event → toast + skip (never a dead queue). Stream tracks are **not persisted in the resume session** — the saved queue/order are remapped onto the surviving library entries when a stream is present.

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

### T16 — Floating lyrics window
Dedicated always-on-top `lyrics-overlay` webview; PictureInPicture toggle; active
line + neighbors; command-based playback snapshot with interpolation; cached
lyrics revision refresh; atomic enabled/position persistence; magnetic nine-anchor
snapping; multi-monitor validation; main-window shutdown cleanup.

**Verify:** overlay stays above other normal app windows without stealing focus;
track/pause/seek/speed changes stay synchronized; lyric and offset edits refresh;
all nine anchors snap while open-space dragging remains free; position and enabled
state survive restart; disconnecting the saved monitor falls back safely; closing
the main window leaves no overlay process; `cargo test` + `cargo clippy` +
`npm run build` clean.

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
