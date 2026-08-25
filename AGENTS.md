# AGENTS.md

## Source of truth
- `DESIGN.md` is the complete design/build spec. Read it before any work; never contradict its locked decisions (stack, palette §2, packaging targets).
- Implementation follows DESIGN.md §7 task order (T1→T11). Each task's **Verify** gate must pass before starting the next.

## Stack (locked — do not substitute)
- Tauri v2 (Rust) + React 18 + TypeScript + Vite; Zustand for state; rusqlite (bundled) for persistence.
- Tailwind CSS v4 via `@tailwindcss/vite` — no PostCSS config/plugin.
- Icons: `@phosphor-icons/react` only, stroke width 1.5. Never hand-roll SVG icons or add other UI/component libraries.
- Fonts self-hosted via `@fontsource/*` (Chakra Petch / Manrope / JetBrains Mono) — zero runtime CDN requests.

## Hard rules from the spec
- Never invoke `yt-dlp -U`. Updates = download release asset from GitHub API → sha256 verify → atomic rename over old binary (`services/installer.rs`). ffmpeg installed once, never updated.
- Frontend must not use the Tauri fs plugin — all file ops happen Rust-side; paths cross IPC as strings only.
- Theme tokens live in `src/theme.css` (Tailwind v4 `@theme`). Single accent ice `#4DD8FF`; cool neutrals only (no warm grays, no purple); no pure `#000000`/`#FFFFFF`; radius 10px everywhere except pill chips/status tags; one allowed gradient (`ice → #38E0C8`) reserved for the boot logo.
- Everything numeric (sizes, durations, speeds, ETAs, versions) renders in JetBrains Mono.
- Motion: animate only `transform`/`opacity`; springs for interactive elements; all motion collapses under `prefers-reduced-motion`.

## Architecture contracts
- Backend layout per §5: `src-tauri/src/commands/*`, `services/` (installer, ytdlp, db), `jobs.rs` = `Mutex<HashMap<job_id, Child>>` process registry.
- Event names are fixed: `tools://progress`, `tools://status`, `dl://progress`, `dl://done`, `dl://error`. Command list in §5.2 — extend, don't rename.
- yt-dlp flags (search/probe/download formats, `--progress-template`) are pinned in §5.4 — reuse those exact invocations.
- yt-dlp arg builders and the progress-line parser stay pure, unit-tested Rust functions.
- Thumbnails cached to `{app_data}/thumbs/{video_id}.jpg`; binaries in `{app_data}/bin/` injected into child-process env.

## Git
- Remote: `git@github.com:SlyHammad18/CRTube.git`. Commit after completing each task (T1–T11), once its Verify gate passes.

## Verification
- Standing gates: `cargo clippy` clean, `npm run build` clean, plus each task's manual checks in §7.
- Integration tests hit real yt-dlp (network required). Download tests verify embedded cover art/tags via ffprobe and that cancel leaves no partial files.
