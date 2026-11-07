/**
 * Animated buffering indicator. Mono label + rotating arc ring — the only
 * motion is `transform: rotate` (GPU-composited, collapses under
 * prefers-reduced-motion via the global rule in theme.css) and nothing else
 * animates. Two flavors:
 *  - `overlay`: full-cover veil for the Now Playing artwork (sits above the
 *    live <video> slot at z-30).
 *  - `inline`:  tiny badge that drops into the PlayerBar title row.
 */
export function BufferBadge({ variant = "overlay" }: { variant?: "overlay" | "inline" }) {
  if (variant === "inline") {
    return (
      <span className="flex shrink-0 items-center gap-1.5 font-mono text-11 text-ice">
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border border-line border-t-ice"
          aria-hidden
        />
        buffering
      </span>
    );
  }
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-void/70">
      <div className="flex flex-col items-center gap-2.5 px-4 py-3">
        <span
          className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-line border-t-ice"
          aria-hidden
        />
        <span className="font-mono text-11 uppercase tracking-[0.18em] text-ice">
          Buffering
        </span>
      </div>
    </div>
  );
}
