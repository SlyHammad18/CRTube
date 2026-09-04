import { useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { usePlayerStore } from "../../stores/player";
import { fmtDuration } from "../../lib/format";

/**
 * Now Playing seek bar (§4.8): 2px `line` track, `ice` fill, grows to 4px on
 * hover; flanking mono times with a click-to-toggle remaining/total on the
 * right; click or drag anywhere on the bar to seek.
 */
export function SeekBar() {
  const currentTimeS = usePlayerStore((s) => s.currentTimeS);
  const durationS = usePlayerStore((s) => s.durationS);
  const seek = usePlayerStore((s) => s.seek);
  const reduce = useReducedMotion();
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [gripping, setGripping] = useState(false);
  const [showRemaining, setShowRemaining] = useState(true);

  const frac =
    durationS > 0 ? Math.min(1, Math.max(0, currentTimeS / durationS)) : 0;

  const seekToClientX = (clientX: number) => {
    const el = barRef.current;
    if (!el || durationS <= 0) return;
    const r = el.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    seek(f * durationS);
  };

  return (
    <div className="shrink-0 px-1">
      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationS)}
        aria-valuenow={Math.round(currentTimeS)}
        onPointerDown={(e) => {
          dragging.current = true;
          setGripping(true);
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekToClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) seekToClientX(e.clientX);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          setGripping(false);
          (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setGripping(false);
        }}
        className="group relative flex h-4 cursor-pointer items-center"
      >
        <div
          className={`h-[2px] w-full rounded-full bg-line ${
            reduce ? "" : "transition-[height] duration-150 group-hover:h-1"
          }`}
        >
          <div
            className="h-full origin-left rounded-full bg-ice"
            style={{ width: `${frac * 100}%` }}
          />
        </div>
        <div
          aria-hidden
          className={`pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-ice transition-[opacity,scale] duration-150 ${
            gripping
              ? "scale-100 opacity-100"
              : "scale-75 opacity-0 group-hover:scale-100 group-hover:opacity-100"
          }`}
          style={{ left: `calc(${frac * 100}% - 5px)` }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-11 tabular-nums text-mute">
        <span>{fmtDuration(currentTimeS) ?? "0:00"}</span>
        <button
          onClick={() => setShowRemaining((v) => !v)}
          className="rounded px-1 hover:text-ink"
          title="Toggle remaining / total"
        >
          <span>
            {showRemaining
              ? `-${fmtDuration(Math.max(0, durationS - currentTimeS)) ?? "0:00"}`
              : fmtDuration(durationS) ?? "0:00"}
          </span>
        </button>
      </div>
    </div>
  );
}
