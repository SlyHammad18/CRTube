// z-index layers: views 0 · format sheet 40 · scanlines 90 · boot overlay 100 · toasts 110
export function Scanlines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[90] opacity-[0.03]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(7,9,12,0.9) 3px)",
      }}
    />
  );
}
