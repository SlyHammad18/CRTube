import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowsOut, Minus, PencilSimple, Plus } from "@phosphor-icons/react";
import { usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { activeIndex } from "../../lib/lrc";
import type { LyricsState } from "../../hooks/useLyrics";
import type { LibraryEntry } from "../../types/library";
import { LyricsSearchModal } from "./LyricsSearchModal";

/// True when `text` contains Arabic-script characters (incl. all Urdu letters).
/// Used to render lyric lines in the Nastaliq Urdu font with correct RTL flow.
function isUrduScript(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (
      (c >= 0x0600 && c <= 0x06ff) || // Arabic
      (c >= 0x0750 && c <= 0x077f) || // Arabic Supplement
      (c >= 0x08a0 && c <= 0x08ff) || // Arabic Extended-A
      (c >= 0xfb50 && c <= 0xfdff) || // Arabic Presentation Forms-A
      (c >= 0xfe70 && c <= 0xfeff) // Arabic Presentation Forms-B
    ) {
      return true;
    }
  }
  return false;
}

/// Per-press nudge for the lyrics sync offset (ms).
const LYRICS_OFFSET_STEP_MS = 50;

function fmtOffset(ms: number): string {
  const s = ms / 1000;
  const sign = ms > 0 ? "+" : "";
  return `${sign}${s.toFixed(2)}s`;
}

/**
 * Caption Deck — the Player's signature motif (§4.8). Renders synced lyrics
 * with the active line held at center (spring scroll, masked edges), click a
 * line to seek, and a fallback ladder for plain / instrumental / no-result
 * states. When lyrics are missing or wrong, a modal LRCLIB search (opened via
 * the pencil on the loaded deck, or a "Search lyrics" CTA when none are found)
 * lets the user pick the right track (or reset to auto-fetch).
 */
export function CaptionDeck({
  entry,
  lyrics,
}: {
  entry: LibraryEntry | null;
  lyrics: LyricsState;
}) {
  const reduce = useReducedMotion();
  const currentTimeS = usePlayerStore((s) => s.currentTimeS);
  const seek = usePlayerStore((s) => s.seek);
  const [lyricsModal, setLyricsModal] = useState<null | "edit" | "find">(null);

  if (lyrics.status === "idle") return null;

  let content: ReactNode;
  if (lyrics.status === "loading") {
    content = (
      <div className="px-4 py-6 font-mono text-12 text-dim">{"> loading lyrics_"}</div>
    );
  } else if (lyrics.status === "instrumental") {
    content = <CenteredTag>INSTRUMENTAL</CenteredTag>;
  } else if (lyrics.status === "none" || lyrics.status === "error") {
    content = (
      <LyricsMissing
        prompt={
          lyrics.status === "error" ? "> lyrics service error_" : "> no lyrics found_"
        }
        onSearch={() => setLyricsModal("find")}
      />
    );
  } else {
    content = (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 px-4 pt-3">
          <button
            aria-label="Edit lyrics"
            title="Change lyrics"
            onClick={() => setLyricsModal("edit")}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ice active:scale-[0.98]"
          >
            <PencilSimple size={13} weight="light" aria-hidden />
          </button>
          <div className="ml-auto flex items-center gap-1 rounded-card border border-line bg-raise px-1 py-0.5">
            <button
              aria-label="Lyrics earlier"
              title="Lyrics earlier"
              onClick={() => lyrics.setOffset(lyrics.offsetMs - LYRICS_OFFSET_STEP_MS)}
              className="grid h-6 w-6 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-panel hover:text-ice active:scale-[0.98]"
            >
              <Minus size={13} weight="light" aria-hidden />
            </button>
            <span className="min-w-[3.25rem] text-center font-mono text-11 text-mute tabular-nums">
              {fmtOffset(lyrics.offsetMs)}
            </span>
            <button
              aria-label="Lyrics later"
              title="Lyrics later"
              onClick={() => lyrics.setOffset(lyrics.offsetMs + LYRICS_OFFSET_STEP_MS)}
              className="grid h-6 w-6 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-panel hover:text-ice active:scale-[0.98]"
            >
              <Plus size={13} weight="light" aria-hidden />
            </button>
          </div>
          <button
            aria-label="Expand lyrics"
            title="Expand lyrics"
            onClick={() => useUIStore.getState().setLyricsFullscreen(true)}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-card text-mute opacity-0 transition-opacity duration-150 hover:bg-raise hover:text-ice group-hover:opacity-100 focus-visible:opacity-100 active:scale-[0.98]"
          >
            <ArrowsOut size={13} weight="light" aria-hidden />
          </button>
        </div>
        <Deck
          lines={lyrics.lines}
          source={lyrics.source}
          currentTimeMs={Math.max(0, currentTimeS * 1000 - lyrics.offsetMs)}
          onSeek={(ms) => seek((ms + lyrics.offsetMs) / 1000)}
          reduce={!!reduce}
        />
      </div>
    );
  }

  return (
    <>
      {content}
      <LyricsSearchModal
        open={lyricsModal !== null}
        mode={lyricsModal ?? "find"}
        entry={entry}
        lyrics={lyrics}
        onClose={() => setLyricsModal(null)}
      />
    </>
  );
}

function CenteredTag({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <span className="rounded-full border border-line px-3 py-1 font-mono text-11 uppercase tracking-wide text-dim">
        {children}
      </span>
    </div>
  );
}

/// Shown when no lyrics are found (or the service errored): a console prompt
/// plus an ice CTA that opens the search modal.
function LyricsMissing({
  prompt,
  onSearch,
}: {
  prompt: string;
  onSearch: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-mono text-12 text-dim">{prompt}</p>
      <button
        onClick={onSearch}
        className="rounded-card bg-ice px-3 py-1.5 text-13 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98]"
      >
        Search lyrics
      </button>
    </div>
  );
}

/**
 * One lyric line. Memoized so that on each playback tick only the line whose
 * `active`/`past` state actually changed re-renders — the other ~N-2 lines pass
 * `React.memo` and skip the DOM diff entirely. Without this, every `timeupdate`
 * (~4 Hz) re-rendered the whole lyric list.
 */
const Line = memo(function Line({
  line,
  synced,
  active,
  past,
  urdu,
  onSeek,
  registerRef,
}: {
  line: { tMs: number; text: string };
  synced: boolean;
  active: boolean;
  past: boolean;
  urdu: boolean;
  onSeek: (ms: number) => void;
  registerRef: (el: HTMLButtonElement | null) => void;
}) {
  if (!synced) {
    return (
      <p
        className={`px-3 py-0.5 text-mute${urdu ? " font-urdu text-right" : ""}`}
        dir={urdu ? "auto" : undefined}
      >
        {line.text}
      </p>
    );
  }
  return (
    <button
      ref={registerRef}
      onClick={() => onSeek(line.tMs)}
      dir={urdu ? "rtl" : undefined}
      className={`flex items-start gap-2 rounded-card py-0.5 ${
        urdu ? "font-urdu" : "text-left"
      } transition-colors duration-200 ${
        active
          ? `${urdu ? "font-urdu" : "font-display"} text-15 font-semibold text-ink`
          : past
            ? "text-dim"
            : "text-mute"
      }`}
    >
      <span
        className="mt-1 h-4 w-1 shrink-0 rounded-full bg-ice"
        style={{ visibility: active ? "visible" : "hidden" }}
        aria-hidden
      />
      <span
        className={`min-w-0${urdu ? " font-urdu" : ""}`}
        dir={urdu ? "auto" : undefined}
      >
        {line.text}
      </span>
    </button>
  );
});

function Deck({
  lines,
  source,
  currentTimeMs,
  onSeek,
  reduce,
}: {
  lines: { tMs: number; text: string }[];
  source: "synced" | "plain" | null;
  currentTimeMs: number;
  onSeek: (ms: number) => void;
  reduce: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Recompute the active line only when the time actually moves to a new line,
  // not on every parent re-render.
  const idx = useMemo(
    () => (source === "synced" ? activeIndex(lines, currentTimeMs) : -1),
    [source, lines, currentTimeMs],
  );
  // Whether the view is currently centered on the active line (drives the sync button).
  const [synced, setSynced] = useState(true);
  // Window during which programmatic smooth-scroll events should be ignored.
  const programmaticUntil = useRef(0);
  // Last user scroll time, used to pause auto-follow for a few seconds.
  const userScrollRef = useRef(0);

  const scrollToActive = () => {
    const c = containerRef.current;
    const el = lineRefs.current[idx];
    if (!c || !el) return;
    programmaticUntil.current = Date.now() + 500;
    setSynced(true);
    c.scrollTo({
      top: el.offsetTop - c.clientHeight / 2 + el.offsetHeight / 2,
      behavior: reduce ? "auto" : "smooth",
    });
  };

  const evaluateSync = () => {
    const c = containerRef.current;
    const el = lineRefs.current[idx];
    if (!c || !el) return;
    const target = el.offsetTop - c.clientHeight / 2 + el.offsetHeight / 2;
    setSynced(Math.abs(c.scrollTop - target) <= 24);
  };

  // Auto-follow: keep the active line centered, unless the user recently scrolled.
  useEffect(() => {
    if (idx < 0) return;
    if (Date.now() - userScrollRef.current < 2500) {
      evaluateSync();
      return;
    }
    scrollToActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, lines]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        onScroll={() => {
          // Ignore the in-flight programmatic smooth-scroll; react to real user scrolls.
          if (Date.now() < programmaticUntil.current) return;
          userScrollRef.current = Date.now();
          evaluateSync();
        }}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 18%, black 82%, transparent)",
        }}
      >
        <div className="flex flex-col gap-1 px-4 pt-10 pb-8">
        {lines.map((l, i) => (
          <Line
            key={i}
            line={l}
            synced={source === "synced"}
            active={i === idx}
            past={i < idx}
            urdu={isUrduScript(l.text)}
            onSeek={onSeek}
            registerRef={(el) => {
              lineRefs.current[i] = el;
            }}
          />
        ))}
      </div>
      </div>
      {!synced && source === "synced" && (
        <button
          aria-label="Sync to current lyric"
          title="Sync to current lyric"
          onClick={scrollToActive}
          className="absolute bottom-4 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center justify-center rounded-full border border-ice/40 bg-panel px-4 text-13 font-semibold text-ice transition-all duration-150 hover:scale-[1.04] hover:shadow-[0_0_28px_8px_rgba(77,216,255,0.6)] active:scale-[0.98]"
        >
          <span>sync</span>
        </button>
      )}
    </div>
  );
}
