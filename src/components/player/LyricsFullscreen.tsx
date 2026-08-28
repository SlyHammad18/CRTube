import { useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { useLyrics } from "../../hooks/useLyrics";
import { CaptionDeck } from "./CaptionDeck";

/**
 * Expanded lyrics overlay (§requested): covers the player's left region
 * (PlaylistsPane + TrackList) while leaving the right Now Playing pane and the
 * global player bar visible. Reuses <CaptionDeck> verbatim, so the scroll /
 * auto-follow / "sync" button behaviour is identical to the inline view.
 */
export function LyricsFullscreen({ nowPlayingOpen }: { nowPlayingOpen: boolean }) {
  const open = useUIStore((s) => s.lyricsFullscreen);
  const setOpen = useUIStore((s) => s.setLyricsFullscreen);
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
    <div
      className="absolute inset-y-0 left-0 z-30 flex flex-col bg-void"
      style={{ right: nowPlayingOpen ? 320 : 0 }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <p className="truncate text-14 font-semibold text-ink">
          {entry?.title ?? "Lyrics"}
        </p>
        <button
          aria-label="Close fullscreen lyrics"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <X size={18} weight="light" aria-hidden />
        </button>
      </div>
      <div className="mx-auto flex min-h-0 flex-1 w-full max-w-[900px] flex-col px-8 py-6">
        <CaptionDeck entry={entry} lyrics={lyrics} />
      </div>
    </div>
  );
}
