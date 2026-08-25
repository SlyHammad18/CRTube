import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowClockwise } from "@phosphor-icons/react";
import { useToolsStore } from "../../stores/tools";
import type { ToolProgress } from "../../types/tools";

function ToolBar({ label, info }: { label: string; info: ToolProgress }) {
  const started = info.stage !== "idle";
  return (
    <div className="w-[340px]">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-13 text-mute">{label}</span>
        <span className="font-mono text-12 text-dim">
          {started ? `${info.stage} · ${Math.round(info.pct)}%` : "waiting"}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-raise">
        <motion.div
          className="h-full w-full origin-left rounded-full bg-ice"
          initial={false}
          animate={
            !started
              ? { scaleX: 0, opacity: 0 }
              : info.pct > 0
                ? { scaleX: Math.max(info.pct / 100, 0.02), opacity: 1 }
                : { scaleX: 0.04, opacity: [0.4, 1, 0.4] }
          }
          transition={
            info.pct > 0 || !started
              ? {
                  scaleX: { duration: 0.18, ease: "easeOut" },
                  opacity: { duration: 0.15 },
                }
              : {
                  scaleX: { duration: 0 },
                  opacity: { duration: 1.2, repeat: Infinity, ease: "easeInOut" },
                }
          }
        />
      </div>
    </div>
  );
}

export function FirstRunOverlay() {
  const state = useToolsStore((s) => s.state);
  const showOverlay = useToolsStore((s) => s.showOverlay);
  const error = useToolsStore((s) => s.error);
  const progress = useToolsStore((s) => s.progress);
  const retry = useToolsStore((s) => s.retry);
  const reduce = useReducedMotion();

  const visible = showOverlay && (state === "updating" || state === "error");

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="first-run"
          className="fixed inset-0 z-[60] grid place-items-center bg-void/95"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0.01 : 0.22 }}
        >
          <div className="flex flex-col items-center">
            <h1 className="font-display text-24 font-semibold tracking-tight">
              Calibrating display…
            </h1>
            {error ? (
              <>
                <p className="mt-3 font-mono text-13 text-signal">
                  &gt; engine calibration failed
                </p>
                <p className="mt-2 max-w-[420px] break-all text-center font-mono text-12 text-dim">
                  {error}
                </p>
                <button
                  onClick={() => void retry()}
                  className="mt-6 flex items-center gap-2 rounded-card bg-ice px-4 py-2 text-13 font-semibold text-void hover:bg-ink active:scale-[0.98]"
                >
                  <ArrowClockwise size={15} weight="light" aria-hidden />
                  Retry calibration
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 font-mono text-13 text-dim">
                  &gt; fetching engines
                </p>
                <div className="mt-8 flex flex-col gap-5">
                  <ToolBar label="ffmpeg + ffprobe" info={progress.ffmpeg} />
                  <ToolBar label="yt-dlp" info={progress.ytdlp} />
                </div>
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
