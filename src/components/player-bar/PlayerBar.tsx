import { useEffect } from "react";
import { AnimatePresence, motion, useMotionValue, useReducedMotion } from "motion/react";
import {
  ArrowClockwise,
  CaretUp,
  Pause,
  Play,
  Shuffle,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  SpeakerSlash,
} from "@phosphor-icons/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { fmtDuration } from "../../lib/format";
import { selectCurrentEntry, usePlayerStore } from "../../stores/player";
import { useUIStore } from "../../stores/ui";
import { setSecondarySlot } from "./mediaSlots";
import { SpeedMenu } from "../player/SpeedMenu";

/**
 * Global player bar (DESIGN §4.9) — persistent across every view once the
 * queue is non-empty. Top edge carries a full-width ice hairline progress.
 */
export function PlayerBar() {
  const reduce = useReducedMotion();
  const active = usePlayerStore((s) => s.pos >= 0 && s.queue.length > 0);
  const entry = usePlayerStore(selectCurrentEntry);
  const playing = usePlayerStore((s) => s.playing);
  const currentTimeS = usePlayerStore((s) => s.currentTimeS);
  const durationS = usePlayerStore((s) => s.durationS);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const volume = usePlayerStore((s) => s.volume);

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
  const store = usePlayerStore;

  return (
    <AnimatePresence>
      {active && (
        <motion.div
          initial={reduce ? { opacity: 0 } : { y: 66 }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: 66 }}
          transition={
            reduce
              ? { duration: 0.01 }
              : { type: "spring", stiffness: 300, damping: 26 }
          }
          className="relative shrink-0 border-t border-line bg-panel"
        >
          {/* Signal-meter hairline */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-line">
            <motion.div
              style={{ scaleX: progress }}
              className="h-full w-full origin-left bg-ice"
            />
          </div>

          <div className="flex h-16 items-center gap-3 px-4">
            {/* Thumb / mini-video slot — portals land here for video tracks */}
            <button
              aria-label="Open player"
              onClick={() => setView("player")}
              className="group relative h-12 w-[72px] shrink-0 overflow-hidden rounded-card border border-line bg-raise"
            >
              <div
                ref={(el) => {
                  setSecondarySlot(el);
                }}
                id="playerbar-media-slot"
                className="absolute inset-0"
              />
              {entry?.kind !== "video" && thumbSrc(entry)}
              {entry == null && (
                <span className="grid h-full w-full place-items-center font-mono text-10 text-dim">
                  ——
                </span>
              )}
            </button>

            {/* Title block */}
            <button
              onClick={() => setView("player")}
              className="min-w-0 max-w-[220px] flex-1 text-left"
            >
              <p className="truncate text-13 font-semibold text-ink">
                {entry?.title ?? "Nothing playing"}
              </p>
              <p className="truncate text-12 text-mute">
                {entry?.channel ?? "queue a track from Library"}
              </p>
            </button>

            {/* Transport */}
            <div className="flex shrink-0 items-center gap-1">
              <IconBtn label="Shuffle" active={shuffle} onClick={() => store.getState().toggleShuffle()}>
                <Shuffle size={16} weight="light" aria-hidden />
              </IconBtn>
              <IconBtn label="Previous" onClick={() => store.getState().prev()}>
                <SkipBack size={17} weight="light" aria-hidden />
              </IconBtn>
              <button
                aria-label={playing ? "Pause" : "Play"}
                onClick={() => store.getState().toggle()}
                className="mx-1 grid h-10 w-10 place-items-center rounded-full bg-ice text-void transition-transform duration-150 hover:bg-ink active:scale-[0.98]"
              >
                {playing ? (
                  <Pause size={18} weight="fill" aria-hidden />
                ) : (
                  <Play size={18} weight="fill" aria-hidden />
                )}
              </button>
              <IconBtn label="Next" onClick={() => store.getState().next()}>
                <SkipForward size={17} weight="light" aria-hidden />
              </IconBtn>
              <span className="relative">
                <IconBtn
                  label={`Repeat: ${repeat}`}
                  active={repeat !== "off"}
                  onClick={() => store.getState().cycleRepeat()}
                >
                  <ArrowClockwise size={16} weight="light" aria-hidden />
                </IconBtn>
                {repeat === "one" && (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5 grid h-3 w-3 place-items-center rounded-full bg-ice font-mono text-[8px] leading-none text-void">
                    1
                  </span>
                )}
              </span>
            </div>

            {/* Mono time readout */}
            <span className="hidden shrink-0 font-mono text-12 tabular-nums text-mute md:block">
              {fmtDuration(currentTimeS) ?? "0:00"} / {fmtDuration(durationS) ?? "0:00"}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-2.5">
              <SpeedMenu />
              <div className="flex items-center gap-1.5">
                <span className="text-mute" aria-hidden>
                  {volume > 0 ? (
                    <SpeakerHigh size={15} weight="light" />
                  ) : (
                    <SpeakerSlash size={15} weight="light" />
                  )}
                </span>
                <input
                  aria-label="Volume"
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => store.getState().setVolume(Number(e.target.value))}
                  className="w-20 accent-ice"
                />
              </div>
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
