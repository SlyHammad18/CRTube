import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { activeIndex } from "../../lib/lrc";
import type { LyricsState } from "../../hooks/useLyrics";
import type { LibraryEntry } from "../../types/library";

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

/**
 * Caption Deck — the Player's signature motif (§4.8). Renders synced lyrics
 * with the active line held at center (spring scroll, masked edges), click a
 * line to seek, and a fallback ladder for plain / instrumental / no-result
 * states with a manual artist/title override form.
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

  if (lyrics.status === "idle") return null;
  if (lyrics.status === "loading") {
    return (
      <div className="px-4 py-6 font-mono text-12 text-dim">{"> loading lyrics_"}</div>
    );
  }
  if (lyrics.status === "instrumental") {
    return <CenteredTag>INSTRUMENTAL</CenteredTag>;
  }
  if (lyrics.status === "error") {
    return (
      <div className="px-4 py-6 font-mono text-12 text-dim">
        {"> lyrics service error_"}
        <br />
        try the manual search below
        <ManualForm entry={entry} lyrics={lyrics} />
      </div>
    );
  }
  if (lyrics.status === "none") {
    return (
      <div className="px-4 py-6 font-mono text-12 text-dim">
        {"> no lyrics found_ try manual search"}
        <ManualForm entry={entry} lyrics={lyrics} />
      </div>
    );
  }
  // loaded
  return (
    <Deck
      lines={lyrics.lines}
      source={lyrics.source}
      currentTimeMs={currentTimeS * 1000}
      onSeek={(ms) => seek(ms / 1000)}
      reduce={!!reduce}
    />
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

function ManualForm({
  entry,
  lyrics,
}: {
  entry: LibraryEntry | null;
  lyrics: LyricsState;
}) {
  const [title, setTitle] = useState(entry?.title ?? "");
  const [artist, setArtist] = useState(entry?.channel ?? "");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-1.5 rounded-card border border-line px-3 py-1.5 text-12 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
      >
        <MagnifyingGlass size={13} weight="light" />
        manual search
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        lyrics.refetch({ title: title.trim(), artist: artist.trim() });
        setOpen(false);
      }}
      className="mt-3 flex flex-col gap-2"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Track title"
        aria-label="Track title"
        className="rounded-card border border-line bg-panel px-3 py-1.5 text-12 text-ink outline-none placeholder:text-dim focus:border-ice"
      />
      <input
        value={artist}
        onChange={(e) => setArtist(e.target.value)}
        placeholder="Artist"
        aria-label="Artist"
        className="rounded-card border border-line bg-panel px-3 py-1.5 text-12 text-ink outline-none placeholder:text-dim focus:border-ice"
      />
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="flex items-center gap-1.5 rounded-card bg-ice px-3 py-1.5 text-12 font-semibold text-void transition-colors duration-150 hover:bg-ink active:scale-[0.98]"
        >
          <MagnifyingGlass size={13} weight="light" />
          search
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Cancel"
          className="grid h-7 w-7 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink"
        >
          <X size={13} weight="bold" />
        </button>
      </div>
    </form>
  );
}

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
  const idx = source === "synced" ? activeIndex(lines, currentTimeMs) : -1;
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
    <div
      onDoubleClick={() => useUIStore.getState().setLyricsFullscreen(true)}
      className="relative flex min-h-0 flex-1 flex-col"
    >
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
        <div className="flex flex-col gap-1 px-4 py-8">
        {lines.map((l, i) => {
          const active = i === idx;
          const urdu = isUrduScript(l.text);
          if (source === "synced") {
            return (
              <button
                key={i}
                ref={(el) => {
                  lineRefs.current[i] = el;
                }}
                onClick={() => onSeek(l.tMs)}
                dir={urdu ? "rtl" : undefined}
                className={`flex items-start gap-2 rounded-card py-0.5 ${urdu ? "text-right" : "text-left"} transition-colors duration-200 ${
                  active
                    ? `${urdu ? "font-urdu" : "font-display"} text-15 font-semibold text-ink`
                    : i < idx
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
                  {l.text}
                </span>
              </button>
            );
          }
          return (
            <p
              key={i}
              className={`px-3 py-0.5 text-mute${urdu ? " font-urdu text-right" : ""}`}
              dir={urdu ? "auto" : undefined}
            >
              {l.text}
            </p>
          );
        })}
      </div>
      </div>
      {!synced && source === "synced" && (
        <button
          aria-label="Sync to current lyric"
          title="Sync to current lyric"
          onClick={scrollToActive}
          className="absolute bottom-4 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center justify-center rounded-full border border-ice/40 bg-panel/90 px-4 text-13 font-semibold text-ice backdrop-blur-sm transition-all duration-150 hover:scale-[1.04] hover:shadow-[0_0_28px_8px_rgba(77,216,255,0.6)] active:scale-[0.98]"
        >
          <span>sync</span>
        </button>
      )}
    </div>
  );
}
