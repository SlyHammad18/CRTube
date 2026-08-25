import { useState } from "react";
import { usePlayerStore, fmtSpeed } from "../../stores/player";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Compact playback-speed popover; current value renders as a mono pill. */
export function SpeedMenu({ up = true }: { up?: boolean }) {
  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        aria-label="Playback speed"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`h-7 rounded-full border px-2 font-mono text-11 transition-colors duration-150 active:scale-[0.98] ${
          speed !== 1
            ? "border-ice bg-ice text-void"
            : "border-line text-mute hover:bg-raise hover:text-ink"
        }`}
      >
        {fmtSpeed(speed)}
      </button>
      {open && (
        <>
          <button
            aria-label="Close speed menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            aria-label="Playback speed options"
            className={`absolute right-0 z-50 flex flex-col gap-0.5 rounded-card border border-line bg-panel p-1 shadow-panel ${
              up ? "bottom-full mb-2" : "top-full mt-2"
            }`}
          >
            {SPEEDS.map((v) => (
              <button
                key={v}
                role="menuitemradio"
                aria-checked={speed === v}
                onClick={() => {
                  setSpeed(v);
                  setOpen(false);
                }}
                className={`rounded-card px-3 py-1 text-left font-mono text-12 transition-colors duration-150 ${
                  speed === v
                    ? "bg-ice text-void"
                    : "text-mute hover:bg-raise hover:text-ink"
                }`}
              >
                {fmtSpeed(v)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
