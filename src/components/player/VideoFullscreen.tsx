import { useEffect } from "react";
import { ArrowsIn, Pause, Play, X } from "@phosphor-icons/react";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { setFullscreenSlot } from "../player-bar/mediaSlots";
import { SeekBar } from "./SeekBar";
import { VolumeSlider } from "./VolumeSlider";

/**
 * In-app fullscreen video overlay (§requested): the single <video> element is
 * NOT a child of this overlay — MediaHost keeps it mounted at app root and
 * positions it over `els.fullscreen` via CSS. Playback (audio included) never
 * restarts and, crucially, the video surface is never reparented under a
 * promoted compositing layer, which previously made it go black under
 * WebKitGTK. This overlay only provides the timeline/timestamp (SeekBar) +
 * volume controls and the stage rect to measure.
 */
export function VideoFullscreen() {
  const open = useUIStore((s) => s.videoFullscreen);
  const setOpen = useUIStore((s) => s.setVideoFullscreen);
  const entry = usePlayerStore(selectCurrentEntry);
  const playing = usePlayerStore((s) => s.playing);
  const toggle = usePlayerStore((s) => s.toggle);

  const isVideo = entry?.kind === "video" && entry.path !== "";
  const videoDisabled = useUIStore((s) => s.videoDisabled);

  // Escape closes fullscreen; auto-close if there's no video to show.
  useEffect(() => {
    if (!open || !isVideo || videoDisabled) {
      if (open) setOpen(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, isVideo, videoDisabled, setOpen]);

  const registerSlot = (el: HTMLDivElement | null) => {
    setFullscreenSlot(el);
  };

  if (!open || !isVideo) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col bg-void"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      {/* Top bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-14 font-semibold text-ink">
            {entry?.title}
          </p>
          <p className="truncate font-mono text-12 text-mute">
            {entry?.channel ?? "—"}
          </p>
        </div>
        <button
          aria-label="Exit fullscreen"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
        >
          <X size={18} weight="light" aria-hidden />
        </button>
      </div>

      {/* Video stage — the portaled <video> lands here (object-contain). */}
      <div className="relative min-h-0 flex-1">
        <div ref={registerSlot} className="absolute inset-0" />
      </div>

      {/* Controls */}
      <div className="flex shrink-0 flex-col gap-3 px-5 py-4">
        <SeekBar />
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => toggle()}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ice text-void transition-transform duration-150 hover:bg-ink active:scale-[0.98]"
          >
            {playing ? (
              <Pause size={18} weight="fill" aria-hidden />
            ) : (
              <Play size={18} weight="fill" aria-hidden />
            )}
          </button>
          <VolumeSlider />
          <button
            aria-label="Exit fullscreen"
            onClick={() => setOpen(false)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-card text-mute transition-colors duration-150 hover:bg-raise hover:text-ink active:scale-[0.98]"
          >
            <ArrowsIn size={18} weight="light" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
