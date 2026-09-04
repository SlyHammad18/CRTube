import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { useLyrics } from "../../hooks/useLyrics";
import { CaptionDeck } from "./CaptionDeck";

/**
 * Bottom-docked lyrics panel (§requested) — toggled from the player bar and
 * available on any view. Sits above the player bar (scoped to the content
 * column, so it never covers the left Rail) and reuses <CaptionDeck> verbatim,
 * keeping the scroll / auto-follow / "sync" button identical to elsewhere.
 */
export function LyricsDock() {
  const open = useUIStore((s) => s.lyricsDockOpen);
  const setOpen = useUIStore((s) => s.setLyricsDockOpen);
  const entry = usePlayerStore(selectCurrentEntry);
  const lyrics = useLyrics(entry);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  if (!open) return null;

  return (
    <div className="relative shrink-0 flex h-80 flex-col border-t border-line bg-panel">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <p className="truncate text-14 font-semibold text-ink">
          {entry?.title ?? "Lyrics"}
        </p>
        <button
          aria-label="Close lyrics"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <X size={18} weight="light" aria-hidden />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <CaptionDeck entry={entry} lyrics={lyrics} />
      </div>
    </div>
  );
}
