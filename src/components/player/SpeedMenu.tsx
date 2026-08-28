import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePlayerStore, fmtSpeed } from "../../stores/player";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Compact playback-speed popover; current value renders as a mono pill. */
export function SpeedMenu({ up = true, zClass = "z-50" }: { up?: boolean; zClass?: string }) {
  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Anchor the portal to the trigger; keep it aligned on scroll/resize so it
  // never drifts while open.
  useEffect(() => {
    if (!open) return;
    const update = () => setRect(btnRef.current?.getBoundingClientRect() ?? null);
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  const menuStyle: React.CSSProperties | undefined = rect
    ? up
      ? {
          position: "fixed",
          bottom: window.innerHeight - rect.top + 8,
          right: window.innerWidth - rect.right,
        }
      : {
          position: "fixed",
          top: rect.bottom + 8,
          right: window.innerWidth - rect.right,
        }
    : undefined;

  return (
    <div className="relative">
      <button
        ref={btnRef}
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
      {open &&
        rect &&
        createPortal(
          <>
             <button
               aria-label="Close speed menu"
               tabIndex={-1}
               onClick={() => setOpen(false)}
               className={`fixed inset-0 cursor-default ${zClass}`}
             />
             <div
               role="menu"
               aria-label="Playback speed options"
               style={menuStyle}
               className={`${zClass} flex flex-col gap-0.5 rounded-card border border-line bg-panel p-1 shadow-panel`}
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
          </>,
          document.body,
        )}
    </div>
  );
}
