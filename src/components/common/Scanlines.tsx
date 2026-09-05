// z-index layers: views 0 · format sheet 40 · first-run overlay 60 · scanlines 90 · toasts 110
export function Scanlines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[90] opacity-[0.03]"
      style={{
        backgroundImage:
          "repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(7,9,12,0.9) 3px)",
        // Promote to its own compositing layer so it never forces repaints of
        // the content scrolling/below it (cheap on WebKitGTK).
        transform: "translateZ(0)",
        backfaceVisibility: "hidden",
      }}
    />
  );
}
