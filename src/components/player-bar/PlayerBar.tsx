import { useEffect } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import { CaretUp, Pause, Play, SkipBack, SkipForward, TextAlignLeft } from "@phosphor-icons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { fmtDuration } from "../../lib/format";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { setSecondarySlot } from "./mediaSlots";
import { VolumeSlider } from "../player/VolumeSlider";

/**
 * Global player bar (DESIGN §4.9) — persistent across every view once the
 * queue is non-empty. Top edge carries a full-width ice hairline progress.
 */
export function PlayerBar() {
  const reduce = useReducedMotion();
  const active = usePlayerStore((s) => s.pos >= 0 && s.queue.length > 0);
  // The Now Playing pane is the full player (seek + transport + lyrics) — the
  // global mini-bar is redundant while it's open, so hide to avoid duplicate
  // controls. The bar returns on other views or when the pane is collapsed.
  const paneOpen = useUIStore((s) => s.nowPlayingOpen && s.view === "player");
  const entry = usePlayerStore(selectCurrentEntry);
  const playing = usePlayerStore((s) => s.playing);
  const currentTimeS = usePlayerStore((s) => s.currentTimeS);
  const durationS = usePlayerStore((s) => s.durationS);

  // Hairline progress driven by a MotionValue — no re-render per tick.
  const progress = useMotionValue(0);
  useEffect(
    () =>
      usePlayerStore.subscribe((s) => {
        progress.set(s.durationS > 0 ? Math.min(1, s.currentTimeS / s.durationS) : 0);
      }),
    [progress],
  );

  const setView = useUIStore((s) => s.setView);
  const lyricsDockOpen = useUIStore((s) => s.lyricsDockOpen);
  const setLyricsDockOpen = useUIStore((s) => s.setLyricsDockOpen);
  const videoDisabled = useUIStore((s) => s.videoDisabled);
  const store = usePlayerStore;

  const handleSeek = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const d = store.getState().durationS;
    if (d > 0) store.getState().seek(frac * d);
  };

  return (
    <AnimatePresence>
      {active && !paneOpen && (
        <motion.div
          initial={{ height: 0 }}
          animate={{ height: "auto" }}
          exit={{ height: 0 }}
          transition={
            reduce
              ? { duration: 0.01 }
              : { type: "spring", stiffness: 300, damping: 30 }
          }
          className="relative shrink-0 overflow-hidden bg-panel"
        >
          {/* Click-to-seek hairline */}
          <button
            aria-label="Seek"
            onClick={handleSeek}
            className="group absolute inset-x-0 top-0 z-10 -mt-px h-3 cursor-pointer"
          >
            <div className="absolute inset-x-0 top-0 h-[2px] bg-line transition-[height] duration-150 group-hover:h-[3px]">
              <motion.div
                style={{ scaleX: progress }}
                className="h-full w-full origin-left bg-ice"
              />
            </div>
          </button>

          <div className="grid h-16 grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-line px-4">
            {/* Left: thumb + title */}
            <div className="flex min-w-0 items-center gap-3">
              <button
                aria-label="Open player"
                onClick={() => setView("player")}
                className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-card border border-line bg-raise"
              >
                <div
                  ref={(el) => {
                    setSecondarySlot(el);
                  }}
                  id="playerbar-media-slot"
                  className="absolute inset-0"
                />
                {(entry?.kind !== "video" || videoDisabled) && thumbSrc(entry)}
                {entry == null && (
                  <span className="grid h-full w-full place-items-center font-mono text-11 text-dim">
                    ——
                  </span>
                )}
              </button>

              <button onClick={() => setView("player")} className="min-w-0 flex-1 text-left">
                <p className="truncate text-13 font-semibold text-ink">
                  {entry?.title ?? "Nothing playing"}
                </p>
                <p className="truncate text-12 text-mute">
                  {entry?.channel ?? "queue a track from Library"}
                </p>
              </button>
            </div>

            {/* Center: transport only */}
            <div className="flex shrink-0 items-center gap-1">
              <IconBtn label="Previous" onClick={() => store.getState().prev()}>
                <SkipBack size={17} weight="light" aria-hidden />
              </IconBtn>
              <button
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => store.getState().toggle()}
                className="mx-1 grid h-9 w-9 place-items-center rounded-full bg-ice text-void transition-transform duration-150 hover:bg-ink active:scale-[0.98]"
              >
                {playing ? (
                  <Pause size={16} weight="fill" aria-hidden />
                ) : (
                  <Play size={16} weight="fill" aria-hidden />
                )}
              </button>
              <IconBtn label="Next" onClick={() => store.getState().next()}>
                <SkipForward size={17} weight="light" aria-hidden />
              </IconBtn>
            </div>

            {/* Right: time, volume, expand */}
            <div className="flex shrink-0 items-center justify-end gap-2.5">
              <span className="hidden shrink-0 font-mono text-12 tabular-nums text-mute md:block">
                {fmtDuration(currentTimeS) ?? "0:00"} / {fmtDuration(durationS) ?? "0:00"}
              </span>
              <div className="h-4 w-px bg-line" />
              <IconBtn
                label="Lyrics"
                active={lyricsDockOpen}
                onClick={() => setLyricsDockOpen(!lyricsDockOpen)}
              >
                <TextAlignLeft size={16} weight="light" aria-hidden />
              </IconBtn>
              <VolumeSlider />
              <IconBtn label="Expand player" onClick={() => setView("player")}>
                <CaretUp size={16} weight="light" aria-hidden />
              </IconBtn>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function thumbSrc(entry: ReturnType<typeof selectCurrentEntry>) {
  if (!entry?.thumbUrl) return null;
  const src = entry.thumbUrl.startsWith("http")
    ? entry.thumbUrl
    : convertFileSrc(entry.thumbUrl);
  return <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />;
}

function IconBtn({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-card transition-colors duration-150 active:scale-[0.98] ${
        active ? "text-ice" : "text-mute hover:bg-raise hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
