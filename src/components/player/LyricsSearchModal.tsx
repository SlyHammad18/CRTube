import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { fmtDuration } from "../../lib/format";
import type { LyricsState } from "../../hooks/useLyrics";
import type { LyricsCandidate } from "../../types/lyrics";
import type { LibraryEntry } from "../../types/library";

function Pill({ ice = false, children }: { ice?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${
        ice ? "border-ice/40 text-ice" : "border-line text-mute"
      }`}
    >
      {children}
    </span>
  );
}

/**
 * Centered lyrics search dialog (the "change lyrics" / "find lyrics" picker,
 * formerly an in-pane resolver). Mirrors the global modal shell
 * (ConfirmModal / RenameTrackModal): `fixed inset-0 z-[70]` backdrop, spring
 * in/out, Escape/backdrop close, full reduced-motion collapse. Portaled to
 * <body> so `fixed` is never trapped by a transformed ancestor (the Deck uses
 * transform springs for its scroll). Auto-runs a search on open using the
 * track's own title/artist; selecting a candidate persists it as a per-song
 * override via `lyrics.apply` and closes.
 */
export function LyricsSearchModal({
  entry,
  lyrics,
  mode,
  open,
  onClose,
}: {
  entry: LibraryEntry | null;
  lyrics: LyricsState;
  mode: "edit" | "find";
  open: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LyricsCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const doSearch = (term: string) => {
    const q = term.trim();
    if (!q) return;
    setLoading(true);
    lyrics
      .search(q)
      .then((r) => {
        setResults(r);
        setSearched(true);
      })
      .catch(() => {
        setResults([]);
        setSearched(true);
      })
      .finally(() => setLoading(false));
  };

  // Reset + auto-search whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    const q = `${entry?.channel ?? ""} ${entry?.title ?? ""}`.trim();
    setQuery(q);
    setResults([]);
    setSearched(false);
    setLoading(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    doSearch(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const apply = (c: LyricsCandidate) => {
    lyrics.apply({
      synced: c.syncedLyrics,
      plain: c.plainLyrics,
      instrumental: c.instrumental,
      trackName: c.trackName,
      artistName: c.artistName,
      cached: false,
    });
    onClose();
  };

  const reset = () => {
    if (entry) lyrics.clearLyrics(entry.videoId);
    onClose();
  };

  const prompt = mode === "edit" ? "> change lyrics_" : "> find lyrics_";
  const durationS = entry?.durationS ?? null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center bg-void/60 p-4"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.15 }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={mode === "edit" ? "Change lyrics" : "Find lyrics"}
            onClick={(e) => e.stopPropagation()}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 6 }}
            transition={
              reduce
                ? { duration: 0.01 }
                : { type: "spring", stiffness: 320, damping: 26 }
            }
            className="flex max-h-[80vh] w-[min(92vw,440px)] flex-col rounded-card border border-line bg-panel shadow-panel"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="font-mono text-12 text-dim">{prompt}</p>
              <button
                aria-label="Close"
                onClick={onClose}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ice active:scale-[0.98]"
              >
                <X size={14} weight="bold" aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-2 px-4 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-card border border-line bg-raise px-3 py-1 focus-within:border-ice">
                <MagnifyingGlass
                  size={14}
                  weight="light"
                  className="shrink-0 text-dim"
                  aria-hidden
                />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSearch(query);
                  }}
                  placeholder="Search title or artist"
                  spellCheck={false}
                  aria-label="Search lyrics"
                  className="h-6 w-full min-w-0 bg-transparent text-12 text-ink outline-none placeholder:text-dim"
                />
              </div>
              <button
                aria-label="Search"
                onClick={() => doSearch(query)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ice active:scale-[0.98]"
              >
                <MagnifyingGlass size={15} weight="light" aria-hidden />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
              {loading && (
                <p className="font-mono text-12 text-dim">{"> searching_"}</p>
              )}
              {!loading && searched && results.length === 0 && (
                <p className="font-mono text-12 text-dim">
                  {"> no matches_ try another query"}
                </p>
              )}
              <ul className="flex flex-col gap-1.5">
                {results.map((c, i) => (
                  <li key={i}>
                    <button
                      onClick={() => apply(c)}
                      className="flex w-full flex-col gap-1.5 rounded-card border border-line px-3 py-2 text-left transition-colors duration-150 hover:bg-raise"
                    >
                      <span className="block truncate text-13 font-semibold text-ink">
                        {c.trackName}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-12 text-mute">
                          {c.artistName}
                          {c.durationS != null && (
                            <span className="font-mono">
                              {" "}
                              · {fmtDuration(c.durationS)}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {c.synced && <Pill ice>SYNCED</Pill>}
                          {c.plain && !c.synced && <Pill>PLAIN</Pill>}
                          {c.instrumental && <Pill>INST</Pill>}
                          {durationS != null &&
                            c.durationS != null &&
                            Math.abs(c.durationS - durationS) <= 3 && (
                              <span
                                className="h-1.5 w-1.5 rounded-full bg-ice"
                                title="Duration matches this track"
                              />
                            )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {mode === "edit" && (
              <div className="border-t border-line px-4 py-3">
                <button
                  onClick={reset}
                  className="rounded-card border border-line px-3 py-1.5 text-13 text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
                >
                  Reset to automatic
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
